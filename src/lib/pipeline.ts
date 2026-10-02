import type { AnalyzeRequest, DocKind, GenerateRequest, PatientContext, TranslateLang } from "../../shared/types";
import { PipelineError, analyze, generate, probeEngine, transcribe, translate } from "./api";
import { db, getBlob, getSettings, updateVisit } from "./db";
import { ageOf } from "./format";
import { emptyOutput, newId, type AppError, type OutputState, type Patient, type Stage, type Visit } from "./model";
import { confirmedVitalList, initialVitals } from "./vitals";

const KINDS: DocKind[] = ["record", "plan", "edu"];
const running = new Map<string, Promise<void>>();

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

async function run(visitId: string) {
  let visit = await db.visits.get(visitId);
  if (!visit) return;
  const patient = await db.patients.get(visit.patientId);
  if (!patient) return;

  const engine = await probeEngine();
  if (engine.kind === "server" && !navigator.onLine) {
    await updateVisit(visitId, { status: "waiting", error: null });
    return;
  }

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
      const transcript = await withRetry(() => transcribe(files));
      await updateVisit(visitId, { transcript });
    }

    visit = (await db.visits.get(visitId))!;
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
      const res = await withRetry(() => analyze(req));
      await updateVisit(visitId, (v) => ({
        analysis: res.analysis,
        analysisMeta: res.meta,
        vitals: initialVitals(res.analysis, v.typedVitals, v.typedQualifiers),
        identityConfirmed: !res.analysis.identityConcern,
      }));
    }

    stage = "write";
    await setStage(visitId, "write");
    visit = (await db.visits.get(visitId))!;
    const todo = KINDS.filter((k) => visit!.outputs[k].versions.length === 0 || visit!.outputs[k].status === "failed" || visit!.outputs[k].status === "writing");
    await Promise.all(todo.map((k) => writeDoc(visitId, k, { replace: true })));

    const after = (await db.visits.get(visitId))!;
    const allFailed = KINDS.every((k) => after.outputs[k].status === "failed");
    await updateVisit(visitId, {
      status: allFailed ? "failed" : "review",
      stage: null,
      stageStartedAt: null,
      error: allFailed ? after.outputs.record.error : null,
    });
  } catch (err) {
    const e = toError(stage, err);
    await updateVisit(visitId, {
      status: e.code === "network" ? "waiting" : "failed",
      error: e.code === "network" ? null : e,
    });
  }
}

interface WriteOptions {
  replace: boolean;
  instructions?: string[];
  custom?: string | null;
  note?: string | null;
}

async function writeDoc(visitId: string, kind: DocKind, opts: WriteOptions) {
  const visit = await db.visits.get(visitId);
  if (!visit?.analysis) return;
  const patient = await db.patients.get(visit.patientId);
  if (!patient) return;
  const settings = await getSettings();

  await updateVisit(visitId, (v) => ({
    outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], status: v.outputs[kind].versions.length && !opts.replace ? v.outputs[kind].status : "writing", error: null } },
  }));

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
    const res = await withRetry(() => generate(req));
    await updateVisit(visitId, (v) => {
      const out = v.outputs[kind];
      const version = { id: newId(), sections: res.doc.sections, origin: out.versions.length ? ("regen" as const) : ("ai" as const), note: opts.note ?? null, createdAt: now(), meta: res.meta };
      const versions = [...out.versions, version];
      const untouched = out.status === "draft" || out.status === "writing" || out.status === "failed" || out.status === "idle";
      const next: OutputState = untouched || opts.replace
        ? { ...out, versions, current: versions.length - 1, candidate: null, status: "draft", error: null, confirmedAt: null, confirmedBy: null, copiedAt: null, sharedAt: null }
        : { ...out, versions, candidate: versions.length - 1, error: null };
      return { outputs: { ...v.outputs, [kind]: next } };
    });
  } catch (err) {
    const e = toError(kind, err);
    await updateVisit(visitId, (v) => ({
      outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], status: v.outputs[kind].versions.length ? v.outputs[kind].status : "failed", error: e } },
    }));
  }
}

/** 單份重新產生：草稿直接換新；已修改或已確認的放成「新版本可比較」，絕不覆寫。 */
export async function regenerate(visitId: string, kind: DocKind, instructions: string[], custom: string | null) {
  const label = [...instructions, custom].filter(Boolean).join("、") || null;
  const visit = await db.visits.get(visitId);
  if (!visit) return;
  const out = visit.outputs[kind];
  const replace = out.status === "draft" || out.status === "failed";
  await writeDoc(visitId, kind, { replace, instructions, custom, note: label ? `重新產生：${label}` : "重新產生" });
}

/** 補資料（文件或錄音）後重新整理：未動過的草稿自動更新，改過或確認過的只提供新版本比較。 */
export async function reprocessWithNewMaterial(visitId: string, audioAdded: boolean) {
  const visit = await db.visits.get(visitId);
  if (!visit) return;
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
  for (const k of touched) await writeDoc(visitId, k, { replace: false, note: "補資料後的新版本" });
}

export async function translateEdu(visitId: string, lang: TranslateLang, text: string) {
  await updateVisit(visitId, (v) => ({ translations: { ...v.translations, [lang]: { text: "", at: now(), status: "writing", error: null } } }));
  try {
    const res = await translate({ text, lang });
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
  window.addEventListener("online", () => {
    void probeEngine(true).then(resumePending);
  });
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
