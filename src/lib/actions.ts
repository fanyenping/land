import { VITAL_LABEL, type DocKind, type DocSection, type VitalKey } from "../../shared/types";
import { allDocsText, docBody, docCopyText, docHeader, writeClipboard } from "./compose";
import { db, deleteVisitDeep, getSettings, putBlob, updatePatient, updateVisit, type StoredBlob } from "./db";
import { addDays, todayStr } from "./format";
import { CONSENT_VERSION, newId, type AudioPart, type Patient, type Visit, type VisitDocument } from "./model";
import { newVisit, processVisit, regenerate, reprocessWithNewMaterial } from "./pipeline";
import { audioDuration, recorder } from "./recorder";
import { confirmedVitalList, pendingVitals } from "./vitals";

const nowIso = () => new Date().toISOString();
const hhmm = () => new Date().toTimeString().slice(0, 5);

async function confirmer() {
  const s = await getSettings();
  return s.nurseName ? `${s.nurseName}` : "護理師";
}

/* ----------------------------- 個案 ----------------------------- */

export interface PatientForm {
  name: string;
  gender: Patient["gender"];
  birthYear: number | null;
  familyCallsAs: string | null;
  diagnoses: string[];
}

export async function createPatient(form: PatientForm, opts: { temporary?: boolean } = {}): Promise<Patient> {
  const t = nowIso();
  const p: Patient = {
    id: newId(),
    name: form.name.trim(),
    gender: form.gender,
    birthYear: form.birthYear,
    familyCallsAs: form.familyCallsAs?.trim() || null,
    diagnoses: form.diagnoses,
    tubes: [],
    consent: null,
    consentRefusedAt: null,
    plan: null,
    last: null,
    isDemo: false,
    isTemporary: !!opts.temporary,
    createdAt: t,
    updatedAt: t,
  };
  await db.patients.put(p);
  return p;
}

export async function recordConsent(patientId: string, by: "個案本人" | "家屬") {
  const at = nowIso();
  await updatePatient(patientId, {
    consent: { by, at, version: CONSENT_VERSION, expiresAt: addDays(todayStr(), 180) },
    consentRefusedAt: null,
  });
}

export async function refuseConsent(patientId: string) {
  await updatePatient(patientId, { consent: null, consentRefusedAt: nowIso() });
}

export function consentValid(p: Patient): boolean {
  return !!p.consent && p.consent.expiresAt >= todayStr();
}

/* ----------------------------- 訪視 ----------------------------- */

/** 取得今天這位個案「還沒開始收尾」的訪視；沒有就建立一筆。 */
export async function ensureTodayVisit(patientId: string): Promise<Visit> {
  const today = todayStr();
  const existing = (await db.visits.where("patientId").equals(patientId).toArray()).find(
    (v) => v.date === today && ["scheduled", "recording", "paused", "interrupted"].includes(v.status),
  );
  if (existing) return existing;
  const v = newVisit(patientId, today, hhmm());
  await db.visits.put(v);
  return v;
}

export async function scheduleVisit(patientId: string, date: string, time: string | null) {
  const exists = (await db.visits.where("patientId").equals(patientId).toArray()).find((v) => v.date === date && v.status === "scheduled");
  if (exists) return exists;
  const v = newVisit(patientId, date, time);
  await db.visits.put(v);
  return v;
}

export async function startRecording(visitId: string) {
  return recorder.start(visitId);
}

/** 完成訪視：結束錄音並在背景開始處理。 */
export async function finishVisit(visitId: string) {
  const snap = recorder.getSnapshot();
  if (snap.visitId === visitId && (snap.state === "recording" || snap.state === "paused")) await recorder.stop();
  const v = await db.visits.get(visitId);
  if (!v) return;
  if (v.parts.length === 0 && v.documents.length === 0 && Object.keys(v.typedVitals).length === 0 && !v.notes) {
    await updateVisit(visitId, { status: "scheduled" });
    return "empty" as const;
  }
  await updateVisit(visitId, (cur) => ({
    status: "processing",
    recordingEndedAt: cur.recordingEndedAt ?? nowIso(),
    intakeOnly: cur.parts.length === 0 && cur.documents.length > 0,
  }));
  void processVisit(visitId);
  return "ok" as const;
}

function isAudio(f: File) {
  return f.type.startsWith("audio/") || /\.(m4a|mp3|wav|aac|webm|ogg|opus|amr|3gp)$/i.test(f.name);
}

function isDocument(f: File) {
  return f.type === "application/pdf" || f.type.startsWith("image/") || /\.(pdf|jpe?g|png|webp|heic)$/i.test(f.name);
}

export function classifyFiles(files: File[]) {
  return {
    audio: files.filter(isAudio),
    docs: files.filter((f) => !isAudio(f) && isDocument(f)),
    rejected: files.filter((f) => !isAudio(f) && !isDocument(f)),
  };
}

/** BodyCam 檔名 A_yyyyMMddHHmmss → 依時間排序。 */
function audioSortKey(f: File) {
  const m = f.name.match(/(\d{14})/);
  return m ? m[1] : `${f.lastModified}`;
}

export async function storeFiles(visitId: string, files: File[]) {
  const { audio, docs } = classifyFiles(files);
  const parts: AudioPart[] = [];
  for (const f of [...audio].sort((a, b) => audioSortKey(a).localeCompare(audioSortKey(b)))) {
    const blobKey = await putBlob(f, { visitId });
    parts.push({ id: newId(), blobKey, mimeType: f.type || "audio/mp4", durationMs: await audioDuration(f), startedAt: new Date(f.lastModified).toISOString(), fileName: f.name });
  }
  const documents: VisitDocument[] = [];
  for (const f of docs) {
    const blobKey = await putBlob(f, { visitId });
    documents.push({ id: newId(), name: f.name, mimeType: f.type || "application/pdf", size: f.size, blobKey, addedAt: nowIso() });
  }
  await updateVisit(visitId, (v) => ({ parts: [...v.parts, ...parts], documents: [...v.documents, ...documents] }));
  return { audio: parts.length, docs: documents.length };
}

/** 匯入檔案到某位個案：建立今天的一筆訪視並開始產生 3 份。 */
export async function importToPatient(patientId: string, files: File[]): Promise<string> {
  const today = todayStr();
  const reuse = (await db.visits.where("patientId").equals(patientId).toArray()).find((v) => v.date === today && v.status === "scheduled");
  const visit = reuse ?? newVisit(patientId, today, hhmm());
  if (!reuse) await db.visits.put(visit);
  await storeFiles(visit.id, files);
  await finishVisit(visit.id);
  return visit.id;
}

/** 在既有訪視補資料（文件或錄音）。 */
export async function addMaterial(visitId: string, files: File[]) {
  const v = await db.visits.get(visitId);
  if (!v) return;
  const res = await storeFiles(visitId, files);
  if (["review", "done", "failed"].includes(v.status)) {
    await updateVisit(visitId, (cur) => ({ intakeOnly: cur.parts.length === 0 && cur.documents.length > 0 }));
    void reprocessWithNewMaterial(visitId, res.audio > 0);
  } else if (["scheduled", "interrupted"].includes(v.status)) {
    await finishVisit(visitId);
  }
  return res;
}

export async function moveVisit(visitId: string, patientId: string) {
  const v = await db.visits.get(visitId);
  if (!v) return null;
  const from = v.patientId;
  await updateVisit(visitId, { patientId });
  return () => updateVisit(visitId, { patientId: from });
}

/** 刪除訪視：回傳「復原」函式（5 秒內可救回錄音與文件）。 */
export async function deleteVisit(visitId: string) {
  const v = await db.visits.get(visitId);
  if (!v) return null;
  if (recorder.getSnapshot().visitId === visitId) await recorder.stop();
  const blobs: StoredBlob[] = await db.blobs.where("visitId").equals(visitId).toArray();
  await deleteVisitDeep(visitId);
  return async () => {
    await db.transaction("rw", db.visits, db.blobs, async () => {
      await db.blobs.bulkPut(blobs);
      await db.visits.put(v);
    });
  };
}

export async function deletePatient(patientId: string) {
  const p = await db.patients.get(patientId);
  if (!p) return null;
  const visits = await db.visits.where("patientId").equals(patientId).toArray();
  const blobs = (await Promise.all(visits.map((v) => db.blobs.where("visitId").equals(v.id).toArray()))).flat();
  await db.transaction("rw", db.patients, db.visits, db.blobs, async () => {
    for (const v of visits) await db.blobs.where("visitId").equals(v.id).delete();
    await db.visits.where("patientId").equals(patientId).delete();
    await db.patients.delete(patientId);
  });
  return async () => {
    await db.transaction("rw", db.patients, db.visits, db.blobs, async () => {
      await db.patients.put(p);
      await db.visits.bulkPut(visits);
      await db.blobs.bulkPut(blobs);
    });
  };
}

/* ----------------------------- 核對 ----------------------------- */

export async function setVital(visitId: string, key: VitalKey, value: string | null, qualifier?: string | null) {
  await updateVisit(visitId, (v) => {
    const typed = { ...v.typedVitals };
    const typedQ = { ...v.typedQualifiers };
    if (value) typed[key] = value;
    else delete typed[key];
    const q = qualifier === undefined ? (v.vitals[key]?.qualifier ?? null) : qualifier;
    if (q) typedQ[key] = q;
    else delete typedQ[key];
    return {
      typedVitals: typed,
      typedQualifiers: typedQ,
      vitals: { ...v.vitals, [key]: { value, qualifier: q, by: "nurse", confirmed: true } },
    };
  });
}

export async function confirmChanges(visitId: string) {
  await updateVisit(visitId, { changesConfirmed: { by: await confirmer(), at: nowIso() } });
}

export async function dismissChange(visitId: string, changeId: string) {
  await updateVisit(visitId, (v) => ({ dismissedChanges: [...v.dismissedChanges, changeId] }));
}

export async function confirmDocs(visitId: string) {
  await updateVisit(visitId, { docsChecked: { by: await confirmer(), at: nowIso() } });
}

export async function confirmIdentity(visitId: string) {
  await updateVisit(visitId, { identityConfirmed: true });
}

export async function decideSuggestion(visitId: string, id: string, decision: "adopted" | "skipped") {
  await updateVisit(visitId, (v) => ({ suggestions: { ...v.suggestions, [id]: decision } }));
  if (decision === "adopted") await regenerate(visitId, "plan", [], null);
}

export interface Blocker {
  kind: "identity" | "vital" | "docs" | "changes";
  label: string;
  key?: VitalKey;
}

export function openChanges(v: Visit) {
  return (v.analysis?.changes ?? []).filter((c) => !v.dismissedChanges.includes(c.id));
}

/** 複製前必須先處理的項目（規格「先看這裡」）。評估異動只擋護理計畫。 */
export function blockersFor(v: Visit, kind: DocKind | "all"): Blocker[] {
  const out: Blocker[] = [];
  if (!v.analysis) return out;
  if (v.analysis.identityConcern && !v.identityConfirmed) out.push({ kind: "identity", label: "確認個案身分" });
  for (const r of pendingVitals(v)) out.push({ kind: "vital", label: `確認${VITAL_LABEL[r.key]}`, key: r.key });
  if (v.analysis.docFacts.some((f) => f.unclear) && !v.docsChecked) out.push({ kind: "docs", label: "對照文件重點" });
  if ((kind === "plan" || kind === "all") && openChanges(v).length > 0 && !v.changesConfirmed) out.push({ kind: "changes", label: "確認評估異動" });
  return out;
}

async function markConfirmed(visitId: string, kind: DocKind, extra: { copied?: boolean; shared?: boolean }) {
  const by = await confirmer();
  const at = nowIso();
  const visit = await db.visits.get(visitId);
  if (!visit) return;
  const patient = await db.patients.get(visit.patientId);
  let planVersion = visit.outputs.plan.planVersion;

  if (kind === "plan" && patient && !planVersion) {
    const settings = await getSettings();
    planVersion = (patient.plan?.version ?? 0) + 1;
    await updatePatient(patient.id, { plan: { version: planVersion, text: docBody("plan", visit, settings), confirmedAt: at, by } });
  }

  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    const outputs = {
      ...v.outputs,
      [kind]: {
        ...out,
        status: "confirmed" as const,
        confirmedAt: at,
        confirmedBy: by,
        copiedAt: extra.copied ? at : out.copiedAt,
        sharedAt: extra.shared ? at : out.sharedAt,
        planVersion: kind === "plan" ? planVersion : out.planVersion,
      },
    };
    const allDone = (["record", "plan", "edu"] as DocKind[]).every((k) => outputs[k].status === "confirmed");
    return {
      outputs,
      reviewedAt: v.reviewedAt ?? at,
      reviewedBy: v.reviewedBy ?? by,
      status: allDone ? "done" : v.status,
      completedAt: allDone ? at : v.completedAt,
    };
  });

  const after = await db.visits.get(visitId);
  if (after?.status === "done" && patient && after.analysis) {
    await updatePatient(patient.id, {
      last: { date: after.date, summary: after.analysis.summary, vitals: confirmedVitalList(after), findings: after.analysis.findings.slice(0, 4).map((f) => f.text) },
    });
  }
}

/** 確認並複製：同一次點擊內寫入剪貼簿。 */
export async function confirmAndCopy(visit: Visit, kind: DocKind, patient?: Patient): Promise<{ ok: boolean; chars: number; blockers: Blocker[] }> {
  const blockers = blockersFor(visit, kind);
  if (blockers.length) return { ok: false, chars: 0, blockers };
  const settings = await getSettings();
  const text = docCopyText(kind, visit, patient, settings);
  const ok = await writeClipboard(text);
  if (ok) await markConfirmed(visit.id, kind, { copied: true });
  return { ok, chars: Array.from(text.replace(/\s/g, "")).length, blockers: [] };
}

export async function confirmOnly(visit: Visit, kind: DocKind) {
  const blockers = blockersFor(visit, kind);
  if (blockers.length) return blockers;
  await markConfirmed(visit.id, kind, {});
  return [];
}

export async function confirmAll(visit: Visit, patient: Patient | undefined): Promise<{ ok: boolean; blockers: Blocker[]; kinds: DocKind[] }> {
  const kinds = (["record", "plan", "edu"] as DocKind[]).filter((k) => visit.outputs[k].versions.length > 0);
  const blockers = blockersFor(visit, "all");
  if (blockers.length) return { ok: false, blockers, kinds };
  const settings = await getSettings();
  const ok = await writeClipboard(allDocsText(visit, patient, settings, kinds));
  if (ok) for (const k of kinds) await markConfirmed(visit.id, k, { copied: true });
  return { ok, blockers: [], kinds };
}

export async function markEduShared(visitId: string) {
  await markConfirmed(visitId, "edu", { shared: true });
}

/* ----------------------------- 版本 ----------------------------- */

export async function saveEdit(visitId: string, kind: DocKind, sections: DocSection[]) {
  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    const versions = [...out.versions, { id: newId(), sections, origin: "nurse" as const, note: "護理師修改", createdAt: nowIso(), meta: null }];
    return {
      status: v.status === "done" ? "review" : v.status,
      completedAt: v.status === "done" ? null : v.completedAt,
      outputs: { ...v.outputs, [kind]: { ...out, versions, current: versions.length - 1, status: "edited" as const, confirmedAt: null, confirmedBy: null } },
    };
  });
}

/** 改用某一版：還原也是新版本（歷程只增不刪）。 */
export async function restoreVersion(visitId: string, kind: DocKind, index: number) {
  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    const src = out.versions[index];
    if (!src) return;
    const versions = [...out.versions, { ...src, id: newId(), note: `改用 v${index + 1}`, createdAt: nowIso() }];
    return {
      status: v.status === "done" ? "review" : v.status,
      completedAt: v.status === "done" ? null : v.completedAt,
      outputs: { ...v.outputs, [kind]: { ...out, versions, current: versions.length - 1, candidate: null, status: "edited" as const, confirmedAt: null, confirmedBy: null } },
    };
  });
}

export async function resolveCandidate(visitId: string, kind: DocKind, accept: boolean) {
  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    if (out.candidate === null) return;
    return {
      status: accept && v.status === "done" ? "review" : v.status,
      completedAt: accept && v.status === "done" ? null : v.completedAt,
      outputs: {
        ...v.outputs,
        [kind]: accept
          ? { ...out, current: out.candidate, candidate: null, status: "draft" as const, confirmedAt: null, confirmedBy: null }
          : { ...out, candidate: null },
      },
    };
  });
}

export { docHeader };
