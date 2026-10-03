import type { AnalyzeRequest, DocKind, GenerateRequest, GenerateResponse, PatientContext, PlanSource, PolishPlanRequest, PreviousVisit, TranslateLang, VisitKind } from "../../shared/types";
import { PLAN_DICTATION_MAX_CHARS, normalizeDictation } from "../../shared/planPolish";
import { PipelineError, analyze, currentEngine, generate, polishPlan, probeEngine, transcribe, translate } from "./api";
import { PLAN_AUDIO_MAX_BYTES, withAudioMime } from "./audioFiles";
import { db, getBlob, getSettings, putBlob, updateVisit } from "./db";
import { ageOf } from "./format";
import { assessmentSummary } from "../assessment/forms";
import { TRIAL } from "./env";
import { emptyOutput, newId, type AppError, type OutputState, type OutputVersion, type Patient, type PlanDictation, type Settings, type Stage, type Visit } from "./model";
import { autoPlanStale, planAutoWritable, planBaseFor, planSlot, recoverOutput, undeferPatch, visitComplete } from "./planSlot";
import { audioDuration } from "./recorder";
import { confirmedVitalList, initialVitals } from "./vitals";

const KINDS: DocKind[] = ["record", "plan", "edu"];
const running = new Map<string, Promise<void>>();

/** 這個分頁正在跑的背景工作（各份撰寫、口述轉文字／整理）。App 重新開啟後不在這裡的就是被中斷了。 */
const liveJobs = new Map<string, number>();
const jobKey = (visitId: string, what: DocKind | "dictation") => `${visitId}:${what}`;

async function tracked<T>(key: string, job: () => Promise<T>): Promise<T> {
  liveJobs.set(key, (liveJobs.get(key) ?? 0) + 1);
  try {
    return await job();
  } finally {
    const n = (liveJobs.get(key) ?? 1) - 1;
    if (n > 0) liveJobs.set(key, n);
    else liveJobs.delete(key);
  }
}

/** 處理途中紀錄被改到其他個案（或復原）：這一輪作廢，依新狀態重來。 */
class Moved extends Error {}

function samePatient(v: Visit | undefined, patientId: string): Visit {
  if (!v || v.patientId !== patientId) throw new Moved();
  return v;
}

function now() {
  return new Date().toISOString();
}

export function patientContext(p: Patient): PatientContext {
  return {
    displayName: p.familyCallsAs || "個案",
    gender: p.gender,
    age: ageOf(p.birthYear),
    familyCallsAs: p.familyCallsAs,
    diagnoses: p.diagnoses,
    tubes: p.tubes.map((t) => ({ name: t.name, nextDue: nextDue(t.changedAt, t.intervalDays) })),
  };
}

/** 這筆訪視要比較的「上次」：用第一次整理時的快照；個案的「上次」若就是這筆自己，不拿來比。 */
function baselineFor(visit: Visit, patient: Patient): Patient["last"] {
  if (visit.previous !== undefined) return visit.previous;
  const last = patient.last;
  if (!last) return null;
  const isSelf = last.visitId ? last.visitId === visit.id : last.date === visit.date;
  return isSelf ? null : last;
}

function toPrevious(last: Patient["last"]): PreviousVisit | null {
  return last ? { date: last.date, summary: last.summary, vitals: last.vitals, findings: last.findings } : null;
}

export function nextDue(changedAt: string | null, intervalDays: number | null): string | null {
  if (!changedAt || !intervalDays) return null;
  const d = new Date(`${changedAt}T00:00:00`);
  d.setDate(d.getDate() + intervalDays);
  return d.toISOString().slice(0, 10);
}

function toError(stage: AppError["stage"], err: unknown): AppError {
  if (err instanceof PipelineError) return { stage, code: err.code, message: err.message, retryable: err.retryable, at: now() };
  return { stage, code: "unexpected", message: "發生預期外的問題，資料都還在這台裝置。", retryable: true, at: now() };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

async function withRetry<T>(fn: () => Promise<T>, tries = 3): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      if (!(err instanceof PipelineError) || !err.retryable || err.code === "network") throw err;
      await new Promise((r) => setTimeout(r, 1200 * (i + 1)));
    }
  }
  throw last;
}

async function setStage(id: string, stage: Stage) {
  await updateVisit(id, { status: "processing", stage, stageStartedAt: now(), error: null });
}

/** 依目前進度接續處理：上傳／轉文字 → 整理重點 → 三份平行撰寫。可重複呼叫。 */
export function processVisit(visitId: string): Promise<void> {
  const existing = running.get(visitId);
  if (existing) return existing;
  const job = run(visitId).finally(() => running.delete(visitId));
  running.set(visitId, job);
  return job;
}

export function isRunning(visitId: string) {
  return running.has(visitId);
}

/**
 * 這筆紀錄要不要用 App 內建示範引擎：只有使用者開啟示範模式，或「示範個案」在連不到伺服器時。
 * 真實個案在連不到伺服器時一律等網路，絕不換成示範內容。
 */
async function engineFor(patient: Patient): Promise<"local" | "server" | "wait"> {
  if (TRIAL) return "local";
  const settings = await getSettings();
  if (settings.demoMode) return "local";
  const engine = await probeEngine(currentEngine()?.kind === "local");
  if (engine.kind === "server") return navigator.onLine ? "server" : "wait";
  return patient.isDemo ? "local" : "wait";
}

async function run(visitId: string) {
  let visit = await db.visits.get(visitId);
  if (!visit) return;
  const patient = await db.patients.get(visit.patientId);
  if (!patient) return;

  const mode = await engineFor(patient);
  if (mode === "wait") {
    await updateVisit(visitId, { status: "waiting", stage: null, error: null });
    return;
  }
  const local = mode === "local";

  let stage: Stage = "upload";
  try {
    if (visit.parts.length > 0 && !visit.transcript) {
      stage = "upload";
      await setStage(visitId, "upload");
      const files: { blob: Blob; name: string }[] = [];
      for (const p of visit.parts) {
        const blob = await getBlob(p.blobKey);
        if (blob) files.push({ blob, name: p.fileName ?? `visit-${p.id}.${p.mimeType.includes("mp4") ? "m4a" : "webm"}` });
      }
      if (files.length === 0) throw new PipelineError("audio_missing", "找不到這次的錄音檔，可能已被清除。", false);
      stage = "transcribe";
      await setStage(visitId, "transcribe");
      const transcript = await withRetry(() => transcribe(files, local));
      await updateVisit(visitId, { transcript });
    }

    visit = samePatient(await db.visits.get(visitId), patient.id);
    if (!visit.analysis) {
      stage = "analyze";
      await setStage(visitId, "analyze");
      const documents: { name: string; mimeType: string; data: string }[] = [];
      for (const d of visit.documents) {
        const blob = await getBlob(d.blobKey);
        if (blob) documents.push({ name: d.name, mimeType: d.mimeType, data: await blobToBase64(blob) });
      }
      const req: AnalyzeRequest = {
        visitDate: visit.date,
        patient: patientContext(patient),
        transcript: visit.transcript,
        documents,
        typedVitals: visit.typedVitals,
        notes: visit.notes,
        previous: toPrevious(baselineFor(visit, patient)),
        currentPlan: patient.plan?.text ?? null,
      };
      const res = await withRetry(() => analyze(req, local));
      await updateVisit(visitId, (v) =>
        v.patientId !== patient.id
          ? undefined
          : {
              analysis: res.analysis,
              analysisMeta: res.meta,
              vitals: initialVitals(res.analysis, v.typedVitals, v.typedQualifiers),
              identityConfirmed: !res.analysis.identityConcern,
              previous: baselineFor(v, patient),
            },
      );
    }

    samePatient(await db.visits.get(visitId), patient.id);
    stage = "write";
    await setStage(visitId, "write");
    // 計畫依「這次訪視前」的計畫判斷；待口述、口述、本次不擬的計畫不自動寫，紀錄與衛教照寫。
    await ensurePlanBase(visitId);
    const pt = (await db.patients.get(patient.id)) ?? patient;
    visit = samePatient(await db.visits.get(visitId), patient.id);
    const auto = planAutoWritable(visit, pt);
    if (!auto && visit.outputs.plan.status === "writing") {
      await updateVisit(visitId, (v) => ({ outputs: { ...v.outputs, plan: { ...v.outputs.plan, status: v.outputs.plan.versions.length ? "draft" : "idle", error: null, busy: false } } }));
      visit = samePatient(await db.visits.get(visitId), patient.id);
    }
    const todo = KINDS.filter((k) => (k !== "plan" || auto) && (visit!.outputs[k].versions.length === 0 || visit!.outputs[k].status === "failed" || visit!.outputs[k].status === "writing"));
    const results = await Promise.allSettled(todo.map((k) => writeDoc(visitId, k, { local, propagateNetwork: true, auto: true })));
    const lost = results.find((r) => r.status === "rejected");
    if (lost) throw (lost as PromiseRejectedResult).reason;

    const after = samePatient(await db.visits.get(visitId), patient.id);
    const allFailed = KINDS.filter((k) => k !== "plan" || auto).every((k) => after.outputs[k].status === "failed");
    // 撰寫期間護理師已確認完（確認不會在處理中直接改成已完成）：寫完才算完成。補資料重整的（reviewedAt 已清掉）回到待確認。
    const done = !allFailed && (after.status === "done" || (!!after.reviewedAt && visitComplete(after)));
    await updateVisit(visitId, {
      status: allFailed ? "failed" : done ? "done" : "review",
      ...(done && !after.completedAt ? { completedAt: now() } : {}),
      stage: null,
      stageStartedAt: null,
      error: allFailed ? after.outputs.record.error : null,
      reprocessQueued: null,
    });
    // 處理中又補了資料：等這輪結束（running 清掉）後再重新整理。
    if (after.reprocessQueued) {
      const audio = after.reprocessQueued.audio;
      setTimeout(() => void reprocessWithNewMaterial(visitId, audio), 0);
    }
  } catch (err) {
    if (err instanceof Moved) {
      const cur = await db.visits.get(visitId);
      if (cur && (cur.status === "processing" || cur.status === "waiting")) setTimeout(() => void processVisit(visitId), 0);
      return;
    }
    const e = toError(stage, err);
    await updateVisit(visitId, {
      status: e.code === "network" ? "waiting" : "failed",
      error: e.code === "network" ? null : e,
    });
  }
}

interface WriteOptions {
  local?: boolean;
  instructions?: string[];
  custom?: string | null;
  note?: string | null;
  /** 在主流程中：網路中斷時整筆改為「等網路」，而不是標成失敗。 */
  propagateNetwork?: boolean;
  /** 系統自動觸發（主流程、數值更新、採用建議…）：絕不動待口述、本次不擬與口述的計畫。 */
  auto?: boolean;
  /** 護理師明確選擇計畫來源（依全人評估擬定／沿用並評值）。 */
  source?: "assessment" | "carried";
}

const UNTOUCHED = new Set<OutputState["status"]>(["draft", "writing", "failed", "idle"]);

/**
 * 撰寫請求（純函式）。紀錄與衛教：照舊（不帶全人評估，現行計畫當背景）。
 * 計畫：依全人評估（13/13 才帶評估摘要）或沿用這次訪視前的計畫；待口述、口述、本次不擬回傳 null。
 */
export function buildGenerateRequest(
  visit: Visit,
  patient: Patient,
  settings: Settings,
  kind: DocKind,
  opts: { instructions?: string[]; custom?: string | null; source?: "assessment" | "carried" } = {},
): GenerateRequest | null {
  if (!visit.analysis) return null;
  let visitKind: VisitKind = visit.kind ?? "follow";
  let assessment: string | null = null;
  let currentPlan = patient.plan?.text ?? null;
  if (kind === "plan") {
    const slot = planSlot(visit, patient);
    const mode = opts.source ?? slot.mode;
    if (mode !== "assessment" && mode !== "carried") return null;
    const base = planBaseFor(visit, patient);
    // 未填完的全人評估不送給 AI 擬計畫。
    assessment = slot.done >= slot.total ? assessmentSummary(patient.assessment) : null;
    currentPlan = base?.text ?? null;
    // 依全人評估：一律用初訪規則（第 1 版或沿用＋依評估補充）；沿用：再次訪視的評值規則。
    visitKind = mode === "assessment" ? "first" : "follow";
  }
  const analysis = visit.analysis;
  return {
    visitKind,
    assessment,
    kind,
    visitDate: visit.date,
    patient: patientContext(patient),
    analysis,
    confirmedVitals: confirmedVitalList(visit),
    currentPlan,
    adoptedSuggestions: analysis.planSuggestions.filter((s) => visit.suggestions[s.id] === "adopted").map((s) => s.problem),
    options: {
      recordStyle: settings.recordStyle,
      instructions: opts.instructions ?? [],
      custom: opts.custom ?? null,
      nurseName: settings.nurseName || null,
      clinicPhone: settings.clinicPhone || null,
    },
    intakeOnly: visit.intakeOnly,
    previous: toPrevious(baselineFor(visit, patient)),
  };
}

/** 目前版本的口述原文（口述被捨棄後重新整理用）。 */
function currentSourceText(visit: Visit): string | null {
  const out = visit.outputs.plan;
  return out.versions[out.current]?.sourceText ?? null;
}

/** 口述整理請求（純函式）：只有口述文字與格式選項，絕不帶分析、數值、評估或現行計畫內容。 */
export function buildPolishRequest(visit: Visit, patient: Patient, opts: { instructions?: string[]; custom?: string | null } = {}): PolishPlanRequest | null {
  const text = (visit.planDictation?.text ?? currentSourceText(visit))?.trim();
  if (!text) return null;
  const calls = patient.familyCallsAs?.trim() || null;
  return {
    visitDate: visit.date,
    dictation: text.slice(0, PLAN_DICTATION_MAX_CHARS),
    familyCallsAs: calls && calls.length <= 20 ? calls : null,
    hasCurrentPlan: !!planBaseFor(visit, patient),
    options: { instructions: (opts.instructions ?? []).slice(0, 5).map((x) => x.slice(0, 200)), custom: opts.custom?.trim() ? opts.custom.trim().slice(0, 500) : null },
  };
}

interface ApplyOptions {
  note: string | null;
  patientId: string;
  source?: PlanSource;
  dictationId?: string;
  sourceText?: string;
  /** 護理師明確選的來源：成為目前版本時直接改掉 planSource。 */
  explicit?: boolean;
  /** 同一次寫入要一併更新的欄位。 */
  patch?: (v: Visit) => Partial<Visit>;
}

/** 新版本寫入：未動過的草稿直接換新；已修改或已確認的只放成「新版本可比較」，絕不覆寫。 */
async function applyVersion(visitId: string, kind: DocKind, res: GenerateResponse, o: ApplyOptions) {
  await updateVisit(visitId, (v) => {
    // 產生期間被改到其他個案：這份是依原個案寫的，丟棄。
    if (v.patientId !== o.patientId) return { outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], busy: false } } };
    const out = v.outputs[kind];
    // 系統自動寫的計畫：寫好時護理師已改用口述、換了來源或本次不擬，這份不採用。
    if (kind === "plan" && !o.explicit && o.source && autoPlanStale(v, o.source)) {
      const status = out.status === "writing" ? (out.versions.length ? "draft" : "idle") : out.status;
      return { outputs: { ...v.outputs, plan: { ...out, status, busy: false } } };
    }
    const version: OutputVersion = {
      id: newId(),
      sections: res.doc.sections,
      origin: out.versions.length ? "regen" : "ai",
      note: o.note,
      createdAt: now(),
      meta: res.meta,
      warnings: res.warnings?.length ? res.warnings : undefined,
      ...(kind === "plan" && o.source ? { source: o.source } : {}),
      ...(o.dictationId ? { dictationId: o.dictationId } : {}),
      ...(o.sourceText !== undefined ? { sourceText: o.sourceText } : {}),
    };
    const versions = [...out.versions, version];
    // 以「完成當下」的狀態決定：護理師在產生期間修改或確認過，就只放成新版本比較，絕不覆寫。
    const current = UNTOUCHED.has(out.status);
    const next: OutputState = current
      ? { ...out, versions, current: versions.length - 1, candidate: null, status: "draft", error: null, busy: false, warningsAck: false, confirmedAt: null, confirmedBy: null, copiedAt: null, sharedAt: null }
      : { ...out, versions, candidate: versions.length - 1, error: null, busy: false };
    const replacedEdu = kind === "edu" && current;
    const source = kind === "plan" && o.source && current ? { planSource: o.explicit ? o.source : (v.planSource ?? o.source) } : {};
    // 已完成的訪視多了一份待確認的草稿：退回待確認。
    const reopen = current && v.status === "done" ? { status: "review" as const, completedAt: null } : {};
    return { outputs: { ...v.outputs, [kind]: next }, ...(replacedEdu ? { translations: {} } : {}), ...source, ...reopen, ...(o.patch?.(v) ?? {}) };
  });
}

function writeDoc(visitId: string, kind: DocKind, opts: WriteOptions): Promise<void> {
  return tracked(jobKey(visitId, kind), () => doWrite(visitId, kind, opts));
}

async function doWrite(visitId: string, kind: DocKind, opts: WriteOptions) {
  let mode: PlanSource | null = null;
  if (kind === "plan") {
    await ensurePlanBase(visitId);
    const v0 = await db.visits.get(visitId);
    const p0 = v0 && (await db.patients.get(v0.patientId));
    if (!v0 || !p0) return;
    const m = opts.source ?? planSlot(v0, p0).mode;
    if (m === "awaiting" || m === "deferred") return;
    if (m === "dictation") {
      // 口述的計畫只由護理師要求時重新整理（只用口述原文），系統自動觸發的一律不動。
      if (opts.auto) return;
      await polishPlanDictation(visitId, { instructions: opts.instructions, custom: opts.custom, note: opts.note?.replace(/^重新產生/, "重新整理") ?? undefined });
      return;
    }
    mode = m;
  }
  const visit = await db.visits.get(visitId);
  if (!visit?.analysis) return;
  const patient = await db.patients.get(visit.patientId);
  if (!patient) return;
  const settings = await getSettings();
  const req = buildGenerateRequest(visit, patient, settings, kind, { instructions: opts.instructions, custom: opts.custom, source: opts.source });
  if (!req) return;
  const local = opts.local ?? (await engineFor(patient)) === "local";

  // 未動過的草稿顯示「撰寫中」；已修改或已確認的保持原狀，只標示背景產生中。
  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    return { outputs: { ...v.outputs, [kind]: { ...out, status: UNTOUCHED.has(out.status) ? "writing" : out.status, busy: true, error: null } } };
  });

  try {
    const res = await withRetry(() => generate(req, local));
    await applyVersion(visitId, kind, res, { note: opts.note ?? null, patientId: patient.id, source: mode ?? undefined, explicit: !!opts.source, ...(opts.source ? { patch: undeferPatch } : {}) });
  } catch (err) {
    const e = toError(kind, err);
    const network = e.code === "network";
    await updateVisit(visitId, (v) => {
      const out = v.outputs[kind];
      const status = out.versions.length ? (out.status === "writing" ? "draft" : out.status) : network && opts.propagateNetwork ? "writing" : "failed";
      return { outputs: { ...v.outputs, [kind]: { ...out, status, busy: false, error: network && opts.propagateNetwork ? null : e } } };
    });
    if (network && opts.propagateNetwork) throw err;
  }
}

/**
 * 單份重新產生：草稿直接換新；已修改或已確認的放成「新版本可比較」，絕不覆寫。
 * auto＝系統觸發：不動待口述、本次不擬與口述的計畫。口述的計畫由護理師要求時只重新整理口述原文。
 */
export async function regenerate(visitId: string, kind: DocKind, instructions: string[], custom: string | null, note?: string, opts?: { auto?: boolean; source?: "assessment" | "carried" }) {
  const label = [...instructions, custom].filter(Boolean).join("、") || null;
  await writeDoc(visitId, kind, { instructions, custom, note: note ?? (label ? `重新產生：${label}` : "重新產生"), auto: opts?.auto, source: opts?.source });
}

const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** 數值改變後（停 1.5 秒）重新撰寫紀錄與計畫，讓異常值提醒與確認值一致。 */
export function scheduleVitalsRefresh(visitId: string) {
  clearTimeout(refreshTimers.get(visitId));
  refreshTimers.set(
    visitId,
    setTimeout(async () => {
      refreshTimers.delete(visitId);
      const v = await db.visits.get(visitId);
      if (!v?.analysis || isRunning(visitId)) return;
      for (const k of ["record", "plan"] as DocKind[]) {
        if (v.outputs[k].versions.length) void regenerate(visitId, k, [], null, "數值更新後的新版本", { auto: true });
      }
    }, 1500),
  );
}

/** 補資料（文件或錄音）後重新整理：未動過的草稿自動更新，改過或確認過的只提供新版本比較。 */
export async function reprocessWithNewMaterial(visitId: string, audioAdded: boolean) {
  const visit = await db.visits.get(visitId);
  if (!visit) return;
  const patientId = visit.patientId;
  const patient = await db.patients.get(patientId);
  // 待口述、口述與本次不擬的計畫不跟著補資料重寫。
  const kinds = KINDS.filter((k) => k !== "plan" || (!!patient && planAutoWritable(visit, patient)));
  const touched = kinds.filter((k) => visit.outputs[k].status === "edited" || visit.outputs[k].status === "confirmed");
  await updateVisit(visitId, (v) => {
    const outputs = { ...v.outputs };
    for (const k of kinds) {
      if (!touched.includes(k)) outputs[k] = { ...v.outputs[k], status: "writing", error: null, candidate: null };
    }
    return {
      transcript: audioAdded ? null : v.transcript,
      analysis: null,
      analysisMeta: null,
      changesConfirmed: null,
      dismissedChanges: [],
      docsChecked: null,
      conflictChoices: {},
      suggestions: {},
      reviewedAt: null,
      reviewedBy: null,
      status: "processing",
      outputs,
    };
  });
  await processVisit(visitId);
  const after = await db.visits.get(visitId);
  if (!after?.analysis || after.patientId !== patientId) return;
  for (const k of touched) await writeDoc(visitId, k, { note: "補資料後的新版本", auto: true });
}

/* ----------------------------- 護理計畫：來源與口述 ----------------------------- */

/** 第一次需要時記下「這次訪視前」的計畫（之後個案計畫被這次確認的版本取代，仍以快照判斷）。 */
export async function ensurePlanBase(visitId: string): Promise<void> {
  const v = await db.visits.get(visitId);
  if (!v || v.planBase !== undefined || v.outputs.plan.planVersion) return;
  const p = await db.patients.get(v.patientId);
  if (!p) return;
  await updateVisit(visitId, (cur) => (cur.planBase !== undefined || cur.outputs.plan.planVersion || cur.patientId !== p.id ? undefined : { planBase: p.plan ?? null }));
}

async function nurseName() {
  const s = await getSettings();
  return s.nurseName || "護理師";
}

const NO_CONTENT = "沒有聽到內容，請再口述一次或改用打字";

/** 只更新同一筆口述（期間換成新的口述就不動）。 */
async function patchDictation(visitId: string, id: string, patch: Partial<PlanDictation>) {
  await updateVisit(visitId, (v) => (v.planDictation?.id === id ? { planDictation: { ...v.planDictation, ...patch, updatedAt: now() } } : undefined));
}

/** 存下口述的錄音（App 內錄音或選檔），然後轉文字；轉好會自動整理成計畫。錄音只存在本機，不進訪視錄音段。 */
export async function savePlanDictationAudio(
  visitId: string,
  blob: Blob,
  meta: { input: "mic" | "file"; fileName: string | null; durationMs?: number },
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (blob.size === 0) return { ok: false, message: "檔案是空的，請改存到「我的 iPhone」再選" };
  if (blob.size > PLAN_AUDIO_MAX_BYTES) return { ok: false, message: "這段錄音太大（口述上限 50 MB），整段訪視錄音請用「選錄音檔」加入護理紀錄" };
  const visit = await db.visits.get(visitId);
  if (!visit) return { ok: false, message: "找不到這筆訪視紀錄。" };
  const stored = meta.input === "file" ? withAudioMime(blob, meta.fileName ?? "recording.m4a") : blob;
  const mimeType = stored.type || "audio/webm";
  const durationMs = Math.round(meta.durationMs ?? (await audioDuration(stored)));
  const by = await nurseName();
  const blobKey = await putBlob(stored, { visitId });
  let old: string | undefined;
  const dictation: PlanDictation = {
    id: newId(),
    input: meta.input,
    audio: { blobKey, mimeType, durationMs, fileName: meta.fileName },
    text: null,
    provider: null,
    status: "transcribing",
    error: null,
    updatedAt: now(),
    by,
  };
  await updateVisit(visitId, (v) => {
    old = v.planDictation?.audio?.blobKey;
    return { planDictation: dictation, ...undeferPatch(v) };
  });
  if (old && old !== blobKey) await db.blobs.delete(old);
  void transcribePlanDictation(visitId);
  return { ok: true };
}

function joinSegments(parts: string[]): string {
  let text = "";
  for (const p of parts.map((x) => x.trim()).filter(Boolean)) {
    // 段落之間沒有標點時換行，保留斷句（不自己加標點）。
    text += text && !/[。！？；，、.!?;,\n]$/.test(text) ? `\n${p}` : p;
  }
  return text;
}

/** 口述錄音轉文字（不含講者標記）；成功後自動整理成計畫，原文保留可修正。 */
export function transcribePlanDictation(visitId: string): Promise<void> {
  return tracked(jobKey(visitId, "dictation"), () => doTranscribe(visitId));
}

/** 轉出的文字太少（只有「嗯，好。」或靜音時的「謝謝觀看」）：當作沒聽到，不自動整理。 */
const MIN_DICTATION_CJK = 10;
export const dictationHasContent = (text: string) => (normalizeDictation(text).match(/[㐀-䶿一-鿿]/g) ?? []).length >= MIN_DICTATION_CJK;

async function doTranscribe(visitId: string): Promise<void> {
  const visit = await db.visits.get(visitId);
  const d = visit?.planDictation;
  if (!visit || !d?.audio) return;
  const patient = await db.patients.get(visit.patientId);
  if (!patient) return;
  const id = d.id;
  await patchDictation(visitId, id, { status: "transcribing", error: null });
  const mode = await engineFor(patient);
  if (mode === "wait") {
    await patchDictation(visitId, id, { status: "failed", error: { stage: "dictation", code: "network", message: "連不上伺服器，口述錄音已存在這台裝置，連上網路後按「重試轉文字」。", retryable: true, at: now() } });
    return;
  }
  try {
    const blob = await getBlob(d.audio.blobKey);
    if (!blob) throw new PipelineError("audio_missing", "找不到口述的錄音檔，可能已被清除，請重新口述或改用打字。", false);
    const name = d.audio.fileName ?? `plan-${d.id}.${d.audio.mimeType.includes("mp4") ? "m4a" : "webm"}`;
    const t = await withRetry(() => transcribe([{ blob, name }], mode === "local", undefined, "plan"));
    const text = (t.segments.length ? joinSegments(t.segments.map((s) => s.text)) : t.text).trim();
    if (!dictationHasContent(text)) {
      // 有字（贅詞、雜音）就留著讓護理師改，不整理成計畫。
      await patchDictation(visitId, id, { status: "failed", ...(text ? { text, provider: t.provider } : {}), error: { stage: "dictation", code: "empty", message: NO_CONTENT, retryable: false, at: now() } });
      return;
    }
    if (text.length > PLAN_DICTATION_MAX_CHARS) {
      // 文字留著讓護理師刪短，不自動整理。
      await patchDictation(visitId, id, { status: "failed", text, provider: t.provider, error: { stage: "dictation", code: "too_long", message: "口述太長（上限 6000 字），請分段或改用打字。", retryable: false, at: now() } });
      return;
    }
    await patchDictation(visitId, id, { status: "polishing", text, provider: t.provider, error: null });
    const cur = await db.visits.get(visitId);
    if (cur?.planDictation?.id === id && cur.planDictation.status === "polishing") await polishPlanDictation(visitId);
  } catch (err) {
    const e = toError("dictation", err);
    const msg = e.code === "network" ? "連不上伺服器，口述錄音已存在這台裝置，連上網路後按「重試轉文字」。" : e.message;
    await patchDictation(visitId, id, { status: "failed", error: { ...e, message: msg } });
  }
}

/**
 * 打字或貼上的口述（或修正轉好的文字）：先給護理師看，按「AI 整理成計畫」才整理。
 * provider：打字的口述是「typed」，按「填入示範口述」的是「demo」（標示示範口述）；不給時沿用原本的。
 */
export async function setPlanDictationText(visitId: string, text: string, input?: "typed", provider?: "typed" | "demo"): Promise<void> {
  const by = await nurseName();
  let old: string | undefined;
  await updateVisit(visitId, (v) => {
    const cur = v.planDictation;
    // 改用打字取代錄音的口述：換成新的一筆（舊錄音一併刪除）。
    if (!cur || (input === "typed" && cur.input !== "typed")) {
      old = cur?.audio?.blobKey;
      return { ...undeferPatch(v), planDictation: { id: newId(), input: "typed", audio: null, text, provider: provider ?? "typed", status: "review", error: null, updatedAt: now(), by } };
    }
    return { ...undeferPatch(v), planDictation: { ...cur, text, ...(provider ? { provider } : {}), status: "review", error: null, updatedAt: now() } };
  });
  if (old) await db.blobs.delete(old);
}

const polishing = new Map<string, Promise<void>>();

/** 口述整理成計畫：只送口述原文與格式選項；結果是護理計畫的新版本（來源＝護理師口述）。同一份口述連按只整理一次。 */
export async function polishPlanDictation(visitId: string, opts: { instructions?: string[]; custom?: string | null; note?: string } = {}): Promise<void> {
  await ensurePlanBase(visitId);
  const visit = await db.visits.get(visitId);
  const patient = visit && (await db.patients.get(visit.patientId));
  if (!visit || !patient) return;
  const req = buildPolishRequest(visit, patient, opts);
  if (!req) return;
  const key = `${visitId}\u0000${visit.planDictation?.id ?? ""}\u0000${JSON.stringify(req)}`;
  const existing = polishing.get(key);
  if (existing) return existing;
  const job = tracked(jobKey(visitId, "dictation"), () => doPolish(visit, patient, req, opts)).finally(() => polishing.delete(key));
  polishing.set(key, job);
  return job;
}

async function doPolish(visit: Visit, patient: Patient, req: PolishPlanRequest, opts: { note?: string }) {
  const visitId = visit.id;
  const out = visit.outputs.plan;
  const dictationId = visit.planDictation?.id ?? out.versions[out.current]?.dictationId;
  const id = visit.planDictation?.id;
  const fail = async (error: AppError) => {
    if (id) await patchDictation(visitId, id, { status: "failed", error });
    await updateVisit(visitId, (v) => ({ outputs: { ...v.outputs, plan: { ...v.outputs.plan, busy: false, ...(id ? {} : { error }) } } }));
  };
  const mode = await engineFor(patient);
  if (mode === "wait") {
    await fail({ stage: "dictation", code: "network", message: "連不上 AI 伺服器，口述已存在這台裝置。連上網路後按「再整理一次」。", retryable: true, at: now() });
    return;
  }
  await updateVisit(visitId, (v) => ({
    ...(id && v.planDictation?.id === id ? { planDictation: { ...v.planDictation, status: "polishing" as const, error: null, updatedAt: now() } } : {}),
    outputs: { ...v.outputs, plan: { ...v.outputs.plan, busy: true, error: null } },
  }));
  try {
    const res = await withRetry(() => polishPlan(req, mode === "local"));
    // 整理期間護理師捨棄或換了口述：這份不採用。
    const still = await db.visits.get(visitId);
    if (id && still?.planDictation?.id !== id) {
      await updateVisit(visitId, (v) => ({ outputs: { ...v.outputs, plan: { ...v.outputs.plan, busy: false } } }));
      return;
    }
    await applyVersion(visitId, "plan", res, {
      note: opts.note ?? "依口述整理",
      patientId: patient.id,
      source: "dictation",
      dictationId,
      sourceText: req.dictation,
      explicit: true,
      patch: (v) => ({ ...undeferPatch(v), ...(id && v.planDictation?.id === id ? { planDictation: { ...v.planDictation, status: "done" as const, error: null, updatedAt: now() } } : {}) }),
    });
    // 整理期間被改到其他個案（這份沒有採用）：口述退回待整理，依新個案再整理一次。
    const after = await db.visits.get(visitId);
    if (id && after?.planDictation?.id === id && after.planDictation.status === "polishing") await patchDictation(visitId, id, { status: "review" });
  } catch (err) {
    const e = toError("dictation", err);
    await fail(e.code === "network" ? { ...e, message: "連不上 AI 伺服器，口述已存在這台裝置。連上網路後按「再整理一次」。" } : e);
  }
}

/** 捨棄這次口述（錄音一併刪除）；已整理好的計畫版本不受影響。 */
export async function discardPlanDictation(visitId: string): Promise<void> {
  let old: string | undefined;
  await updateVisit(visitId, (v) => {
    old = v.planDictation?.audio?.blobKey;
    return { planDictation: null };
  });
  if (old) await db.blobs.delete(old);
}

/** 護理師明確選擇：依全人評估擬定，或沿用現行計畫並評值。 */
export async function draftPlanFrom(visitId: string, source: "assessment" | "carried"): Promise<void> {
  await ensurePlanBase(visitId);
  await updateVisit(visitId, undeferPatch);
  await regenerate(visitId, "plan", [], null, source === "assessment" ? "依全人評估擬定" : "沿用現行計畫", { source });
}

export async function translateEdu(visitId: string, lang: TranslateLang, text: string) {
  const visit = await db.visits.get(visitId);
  const patient = visit && (await db.patients.get(visit.patientId));
  if (!visit || !patient) return;
  const mode = await engineFor(patient);
  await updateVisit(visitId, (v) => ({ translations: { ...v.translations, [lang]: { text: "", at: now(), status: "writing", error: null } } }));
  if (mode === "wait") {
    await updateVisit(visitId, (v) => ({ translations: { ...v.translations, [lang]: { text: "", at: now(), status: "failed", error: "連不上 AI 伺服器，請連上網路後再試。" } } }));
    return;
  }
  try {
    const res = await translate({ text, lang }, mode === "local");
    await updateVisit(visitId, (v) => ({ translations: { ...v.translations, [lang]: { text: res.text, at: now(), status: "done", error: null } } }));
  } catch (err) {
    const e = toError("translate", err);
    await updateVisit(visitId, (v) => ({ translations: { ...v.translations, [lang]: { text: "", at: now(), status: "failed", error: e.message } } }));
  }
}

/**
 * 被中斷的背景工作（App 在轉文字、整理或撰寫時被關掉，iPhone 常在背景回收網頁）：
 * 口述轉文字／整理接著做；卡在「撰寫中」的文件放回可以操作的狀態（有版本→草稿；計畫沒有版本→可擬定；其他→沒有產生成功）。
 * 只處理這個分頁沒在跑的工作，可以重複呼叫。
 */
export async function recoverInterrupted() {
  const visits = await db.visits
    .filter((v) => {
      const d = v.planDictation?.status;
      return d === "transcribing" || d === "polishing" || KINDS.some((k) => v.outputs[k].status === "writing" || v.outputs[k].busy);
    })
    .toArray();
  for (const v of visits) {
    const d = v.planDictation;
    const dictLive = liveJobs.has(jobKey(v.id, "dictation"));
    if (d && !dictLive && (d.status === "transcribing" || d.status === "polishing")) {
      if (d.status === "transcribing" && d.audio && !d.text) void transcribePlanDictation(v.id);
      else if (d.text?.trim()) void polishPlanDictation(v.id);
      else await patchDictation(v.id, d.id, { status: "failed", error: { stage: "dictation", code: "interrupted", message: "轉文字中斷了，請重新口述或改用打字。", retryable: false, at: now() } });
    }
    // 整筆還在處理（或等網路）的由 processVisit 接續。
    if (v.status === "processing" || v.status === "waiting" || isRunning(v.id)) continue;
    const reset: DocKind[] = KINDS.filter((k) => (v.outputs[k].status === "writing" || v.outputs[k].busy) && !liveJobs.has(jobKey(v.id, k)) && !(k === "plan" && (dictLive || d?.status === "polishing")));
    if (!reset.length) continue;
    await updateVisit(v.id, (cur) => {
      const outputs = { ...cur.outputs };
      for (const k of reset) if (!liveJobs.has(jobKey(cur.id, k))) outputs[k] = recoverOutput(cur.outputs[k], k, now());
      return { outputs };
    });
  }
}

/** App 開啟或恢復連線時，接續所有未完成的處理。 */
export async function resumePending() {
  await recoverInterrupted();
  const pending = await db.visits.where("status").anyOf("waiting", "processing").toArray();
  for (const v of pending) void processVisit(v.id);
}

export function startAutoResume() {
  const retry = async () => {
    const waiting = await db.visits.where("status").equals("waiting").count();
    if (waiting === 0) return;
    await probeEngine(true);
    await resumePending();
  };
  window.addEventListener("online", () => void retry());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void retry();
  });
  // 等網路的紀錄每分鐘再試一次（伺服器恢復時自動接續）。
  setInterval(() => void retry(), 60_000);
  void resumePending();
}

export function newVisit(patientId: string, date: string, time: string | null): Visit {
  return {
    id: newId(),
    patientId,
    date,
    time,
    createdAt: now(),
    status: "scheduled",
    stage: null,
    stageStartedAt: null,
    error: null,
    parts: [],
    documents: [],
    typedVitals: {},
    typedQualifiers: {},
    notes: null,
    transcript: null,
    analysis: null,
    analysisMeta: null,
    vitals: {},
    changesConfirmed: null,
    dismissedChanges: [],
    docsChecked: null,
    identityConfirmed: true,
    conflictChoices: {},
    suggestions: {},
    outputs: { record: emptyOutput(), plan: emptyOutput(), edu: emptyOutput() },
    translations: {},
    reviewedAt: null,
    reviewedBy: null,
    completedAt: null,
    intakeOnly: false,
    recordingStartedAt: null,
    recordingEndedAt: null,
  };
}
