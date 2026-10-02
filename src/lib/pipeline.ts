import type { AnalyzeRequest, DocKind, GenerateRequest, PatientContext, TranslateLang } from "../../shared/types";
import { PipelineError, analyze, currentEngine, generate, probeEngine, transcribe, translate } from "./api";
import { db, getBlob, getSettings, updateVisit } from "./db";
import { ageOf } from "./format";
import { emptyOutput, newId, type AppError, type OutputState, type Patient, type Stage, type Visit } from "./model";
import { confirmedVitalList, initialVitals } from "./vitals";

const KINDS: DocKind[] = ["record", "plan", "edu"];
const running = new Map<string, Promise<void>>();

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
        previous: patient.last,
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
            },
      );
    }

    samePatient(await db.visits.get(visitId), patient.id);
    stage = "write";
    await setStage(visitId, "write");
    visit = samePatient(await db.visits.get(visitId), patient.id);
    const todo = KINDS.filter((k) => visit!.outputs[k].versions.length === 0 || visit!.outputs[k].status === "failed" || visit!.outputs[k].status === "writing");
    const results = await Promise.allSettled(todo.map((k) => writeDoc(visitId, k, { local, propagateNetwork: true })));
    const lost = results.find((r) => r.status === "rejected");
    if (lost) throw (lost as PromiseRejectedResult).reason;

    const after = samePatient(await db.visits.get(visitId), patient.id);
    const allFailed = KINDS.every((k) => after.outputs[k].status === "failed");
    await updateVisit(visitId, {
      status: allFailed ? "failed" : after.status === "done" ? "done" : "review",
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
}

const UNTOUCHED = new Set<OutputState["status"]>(["draft", "writing", "failed", "idle"]);

async function writeDoc(visitId: string, kind: DocKind, opts: WriteOptions) {
  const visit = await db.visits.get(visitId);
  if (!visit?.analysis) return;
  const patient = await db.patients.get(visit.patientId);
  if (!patient) return;
  const settings = await getSettings();
  const local = opts.local ?? (await engineFor(patient)) === "local";

  // 未動過的草稿顯示「撰寫中」；已修改或已確認的保持原狀，只標示背景產生中。
  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    return { outputs: { ...v.outputs, [kind]: { ...out, status: UNTOUCHED.has(out.status) ? "writing" : out.status, busy: true, error: null } } };
  });

  const req: GenerateRequest = {
    kind,
    visitDate: visit.date,
    patient: patientContext(patient),
    analysis: visit.analysis,
    confirmedVitals: confirmedVitalList(visit),
    currentPlan: patient.plan?.text ?? null,
    adoptedSuggestions: visit.analysis.planSuggestions.filter((s) => visit.suggestions[s.id] === "adopted").map((s) => s.problem),
    options: {
      recordStyle: settings.recordStyle,
      instructions: opts.instructions ?? [],
      custom: opts.custom ?? null,
      nurseName: settings.nurseName || null,
      clinicPhone: settings.clinicPhone || null,
    },
    intakeOnly: visit.intakeOnly,
    previous: patient.last,
  };

  try {
    const res = await withRetry(() => generate(req, local));
    await updateVisit(visitId, (v) => {
      // 產生期間被改到其他個案：這份是依原個案寫的，丟棄。
      if (v.patientId !== patient.id) return { outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], busy: false } } };
      const out = v.outputs[kind];
      const version = {
        id: newId(),
        sections: res.doc.sections,
        origin: out.versions.length ? ("regen" as const) : ("ai" as const),
        note: opts.note ?? null,
        createdAt: now(),
        meta: res.meta,
        warnings: res.warnings?.length ? res.warnings : undefined,
      };
      const versions = [...out.versions, version];
      // 以「完成當下」的狀態決定：護理師在產生期間修改或確認過，就只放成新版本比較，絕不覆寫。
      const next: OutputState = UNTOUCHED.has(out.status)
        ? { ...out, versions, current: versions.length - 1, candidate: null, status: "draft", error: null, busy: false, warningsAck: false, confirmedAt: null, confirmedBy: null, copiedAt: null, sharedAt: null }
        : { ...out, versions, candidate: versions.length - 1, error: null, busy: false };
      const replacedEdu = kind === "edu" && UNTOUCHED.has(out.status);
      return { outputs: { ...v.outputs, [kind]: next }, ...(replacedEdu ? { translations: {} } : {}) };
    });
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

/** 單份重新產生：草稿直接換新；已修改或已確認的放成「新版本可比較」，絕不覆寫。 */
export async function regenerate(visitId: string, kind: DocKind, instructions: string[], custom: string | null, note?: string) {
  const label = [...instructions, custom].filter(Boolean).join("、") || null;
  await writeDoc(visitId, kind, { instructions, custom, note: note ?? (label ? `重新產生：${label}` : "重新產生") });
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
        if (v.outputs[k].versions.length) void regenerate(visitId, k, [], null, "數值更新後的新版本");
      }
    }, 1500),
  );
}

/** 補資料（文件或錄音）後重新整理：未動過的草稿自動更新，改過或確認過的只提供新版本比較。 */
export async function reprocessWithNewMaterial(visitId: string, audioAdded: boolean) {
  const visit = await db.visits.get(visitId);
  if (!visit) return;
  const patientId = visit.patientId;
  const touched = KINDS.filter((k) => visit.outputs[k].status === "edited" || visit.outputs[k].status === "confirmed");
  await updateVisit(visitId, (v) => {
    const outputs = { ...v.outputs };
    for (const k of KINDS) {
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
  for (const k of touched) await writeDoc(visitId, k, { note: "補資料後的新版本" });
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

/** App 開啟或恢復連線時，接續所有未完成的處理。 */
export async function resumePending() {
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
