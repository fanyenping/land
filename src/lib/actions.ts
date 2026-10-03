import { DOC_LABEL, VITAL_LABEL, type DocKind, type DocSection, type VitalKey } from "../../shared/types";
import { allDocsText, docBody, docCopyText, docHeader, writeClipboard } from "./compose";
import { db, deleteVisitDeep, getSettings, putBlob, updatePatient, updateVisit, type StoredBlob } from "./db";
import { addDays, todayStr } from "./format";
import { CONSENT_VERSION, newId, type AudioPart, type OutputState, type Patient, type Settings, type Visit, type VisitDocument } from "./model";
import { isRunning, newVisit, processVisit, regenerate, reprocessWithNewMaterial, savePlanDictationAudio, scheduleVitalsRefresh } from "./pipeline";
import { audioDuration, recorder } from "./recorder";
import { isAudioFile, voiceMemoProblem, withAudioMime } from "./audioFiles";
import { dictation } from "./dictation";
import { changesOpen, hasUnverified, includedKinds, openWarnings, visitComplete } from "./planSlot";
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
  /* 照護紀錄導出用（選填）。 */
  intakeDate?: string | null;
  heightCm?: string | null;
  residence?: string | null;
  area?: string | null;
  resource?: string | null;
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
    intakeDate: form.intakeDate ?? t.slice(0, 10),
    heightCm: form.heightCm ?? null,
    residence: form.residence ?? null,
    area: form.area ?? null,
    resource: form.resource ?? null,
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

/** 取得今天這位個案「還沒結束」的訪視；沒有就建立一筆。 */
export async function ensureTodayVisit(patientId: string): Promise<Visit> {
  const today = todayStr();
  const existing = (await db.visits.where("patientId").equals(patientId).toArray()).find(
    (v) => v.date === today && ["scheduled", "recording", "paused", "interrupted"].includes(v.status),
  );
  if (existing) return existing;
  const v = { ...newVisit(patientId, today, hhmm()), kind: await visitKindFor(patientId) };
  await db.visits.put(v);
  return v;
}

/** 這位個案的第一次訪視是「初次訪視」（要做全人評估）；之後都是再次訪視。 */
export async function visitKindFor(patientId: string): Promise<"first" | "follow"> {
  const visits = await db.visits.where("patientId").equals(patientId).toArray();
  return visits.some((v) => v.status === "review" || v.status === "done") ? "follow" : "first";
}

export async function setVisitKind(visitId: string, kind: "first" | "follow") {
  await updateVisit(visitId, { kind });
}

export async function scheduleVisit(patientId: string, date: string, time: string | null) {
  const exists = (await db.visits.where("patientId").equals(patientId).toArray()).find((v) => v.date === date && v.status === "scheduled");
  if (exists) return exists;
  const v = { ...newVisit(patientId, date, time), kind: await visitKindFor(patientId) };
  await db.visits.put(v);
  return v;
}

export async function startRecording(visitId: string) {
  // 口述計畫的錄音先收好（兩個錄音器不同時進行）。
  const d = dictation.getSnapshot();
  if (d.state === "recording" || d.state === "starting") await finishPlanDictation(d.visitId);
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

const DOC_EXT = /\.(pdf|jpe?g|png|webp|gif|heic|heif)$/i;
const DOC_MIME = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif"]);
const untyped = (f: File) => !f.type || f.type === "application/octet-stream";

/** 上限與伺服器一致：每張照片 5 MB（先在手機縮圖）、每份 PDF 10 MB、文件合計約 28 MB、錄音合計 280 MB。 */
export const FILE_LIMITS = { docsPerVisit: 10, pdfBytes: 10 * 1024 * 1024, docsTotalBytes: 28 * 1024 * 1024, audioTotalBytes: 280 * 1024 * 1024, imageEdge: 1600 };

const isAudio = (f: File) => isAudioFile(f);

function isDocument(f: File) {
  return DOC_MIME.has(f.type) || (untyped(f) && DOC_EXT.test(f.name));
}

export function classifyFiles(files: File[]) {
  return {
    audio: files.filter(isAudio),
    docs: files.filter((f) => !isAudio(f) && isDocument(f)),
    rejected: files.filter((f) => !isAudio(f) && !isDocument(f)),
  };
}

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

/** 照片縮到長邊 1600 px 的 JPEG（文件照片足夠清楚，也避開伺服器 5 MB 上限；HEIC 在 Safari 可順便轉檔）。 */
async function prepareImage(f: File): Promise<File | null> {
  try {
    const bmp = await createImageBitmap(f);
    const scale = Math.min(1, FILE_LIMITS.imageEdge / Math.max(bmp.width, bmp.height));
    const keep = scale === 1 && f.size <= 1.5 * 1024 * 1024 && ["image/jpeg", "image/png", "image/webp"].includes(f.type);
    if (keep) {
      bmp.close();
      return f;
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.88));
    if (!blob) return null;
    return new File([blob], f.name.replace(/\.[^.]+$/, "") + ".jpg", { type: "image/jpeg", lastModified: f.lastModified });
  } catch {
    // 瀏覽器讀不了（例如非 Safari 的 HEIC）：一般格式且夠小就原檔上傳，否則略過。
    return ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(f.type) && f.size <= 5 * 1024 * 1024 ? f : null;
  }
}

/** BodyCam 檔名 A_yyyyMMddHHmmss → 依時間排序。 */
function audioSortKey(f: File) {
  const m = f.name.match(/(\d{14})/);
  return m ? m[1] : `${f.lastModified}`;
}

export interface StoreResult {
  audio: number;
  docs: number;
  skipped: { name: string; reason: string }[];
}

export async function storeFiles(visitId: string, files: File[]): Promise<StoreResult> {
  const { audio, docs, rejected } = classifyFiles(files);
  const skipped: StoreResult["skipped"] = rejected.map((f) => ({ name: f.name, reason: voiceMemoProblem(f) ?? "不支援的格式" }));
  const visit = await db.visits.get(visitId);
  let docCount = visit?.documents.length ?? 0;
  let docBytes = visit?.documents.reduce((n, d) => n + d.size, 0) ?? 0;
  let audioBytes = 0;
  for (const p of visit?.parts ?? []) audioBytes += (await db.blobs.get(p.blobKey))?.blob.size ?? 0;

  const parts: AudioPart[] = [];
  for (const f of [...audio].sort((a, b) => audioSortKey(a).localeCompare(audioSortKey(b)))) {
    const problem = voiceMemoProblem(f);
    if (problem) {
      skipped.push({ name: f.name, reason: problem });
      continue;
    }
    if (audioBytes + f.size > FILE_LIMITS.audioTotalBytes) {
      skipped.push({ name: f.name, reason: "錄音合計超過 280 MB" });
      continue;
    }
    audioBytes += f.size;
    // iPhone 給的類型可能是空白、octet-stream 或 video/mp4：存成正確的 audio MIME，伺服器才收得下。
    const typed = withAudioMime(f, f.name);
    const blobKey = await putBlob(typed, { visitId });
    parts.push({ id: newId(), blobKey, mimeType: typed.type, durationMs: await audioDuration(f), startedAt: new Date(f.lastModified).toISOString(), fileName: f.name });
  }
  const documents: VisitDocument[] = [];
  for (const raw of docs) {
    if (docCount >= FILE_LIMITS.docsPerVisit) {
      skipped.push({ name: raw.name, reason: `每筆最多 ${FILE_LIMITS.docsPerVisit} 份文件` });
      continue;
    }
    const f = isPdf(raw) ? raw : await prepareImage(raw);
    if (!f) {
      skipped.push({ name: raw.name, reason: "照片無法讀取，請改拍 JPG" });
      continue;
    }
    if (isPdf(f) && f.size > FILE_LIMITS.pdfBytes) {
      skipped.push({ name: f.name, reason: "PDF 超過 10 MB" });
      continue;
    }
    if (docBytes + f.size > FILE_LIMITS.docsTotalBytes) {
      skipped.push({ name: f.name, reason: "文件合計超過 28 MB" });
      continue;
    }
    docCount++;
    docBytes += f.size;
    const blobKey = await putBlob(f, { visitId });
    documents.push({ id: newId(), name: f.name, mimeType: isPdf(f) ? "application/pdf" : f.type, size: f.size, blobKey, addedAt: nowIso() });
  }
  if (parts.length || documents.length) await updateVisit(visitId, (v) => ({ parts: [...v.parts, ...parts], documents: [...v.documents, ...documents] }));
  return { audio: parts.length, docs: documents.length, skipped };
}

/** 存檔失敗（多半是裝置空間不足）時給護理師看的說明。 */
export function storageErrorMessage(err: unknown): string {
  const name = (err as { name?: string } | null)?.name ?? "";
  const inner = (err as { inner?: { name?: string } } | null)?.inner?.name ?? "";
  return name === "QuotaExceededError" || inner === "QuotaExceededError" ? "這台裝置的儲存空間不足，檔案沒有加入。請刪除舊紀錄或清出空間後再試。" : "檔案沒有加入，請再試一次。";
}

/** 檔案加入結果的提示文字。 */
export function storeSummary(res: StoreResult, tail = "") {
  const added = res.audio + res.docs;
  const skip = res.skipped.length ? `略過 ${res.skipped.length} 個（${[...new Set(res.skipped.map((s) => s.reason))].join("、")}）` : "";
  if (added === 0) return skip ? `沒有加入檔案：${skip}` : "沒有加入檔案";
  return `已加入 ${added} 個檔案${tail}${skip ? `，${skip}` : ""}`;
}

/** 匯入檔案到某位個案：用今天排定或中斷的那筆訪視（沒有就建立），並開始整理。 */
export async function importToPatient(patientId: string, files: File[]): Promise<{ visitId: string | null; result: StoreResult }> {
  const today = todayStr();
  const reuse = (await db.visits.where("patientId").equals(patientId).toArray()).find((v) => v.date === today && (v.status === "scheduled" || v.status === "interrupted"));
  const visit = reuse ?? { ...newVisit(patientId, today, hhmm()), kind: await visitKindFor(patientId) };
  if (!reuse) await db.visits.put(visit);
  let result: StoreResult;
  try {
    result = await storeFiles(visit.id, files);
  } catch (err) {
    // 存檔失敗（例如空間不足）：剛建立的空訪視不要留在今日清單。
    if (!reuse) await deleteVisitDeep(visit.id).catch(() => undefined);
    throw err;
  }
  if (result.audio + result.docs === 0) {
    if (!reuse) await db.visits.delete(visit.id);
    return { visitId: null, result };
  }
  await finishVisit(visit.id);
  return { visitId: visit.id, result };
}

/** 移除一份文件（拍錯、傳錯）；處理過的紀錄會重新整理。回傳復原函式。 */
export async function removeDocument(visitId: string, docId: string) {
  const v = await db.visits.get(visitId);
  const doc = v?.documents.find((d) => d.id === docId);
  if (!v || !doc) return null;
  const blob = await db.blobs.get(doc.blobKey);
  const processed = !!v.analysis || ["review", "done", "failed"].includes(v.status);
  await db.transaction("rw", db.visits, db.blobs, async () => {
    await db.blobs.delete(doc.blobKey);
    const cur = await db.visits.get(visitId);
    if (cur) await db.visits.put({ ...cur, documents: cur.documents.filter((d) => d.id !== docId), intakeOnly: cur.parts.length === 0 && cur.documents.length > 1 });
  });
  if (processed) void reprocessWithNewMaterial(visitId, false);
  return async () => {
    await db.transaction("rw", db.visits, db.blobs, async () => {
      if (blob) await db.blobs.put(blob);
      const cur = await db.visits.get(visitId);
      if (cur && !cur.documents.some((d) => d.id === docId)) await db.visits.put({ ...cur, documents: [...cur.documents, doc], intakeOnly: cur.parts.length === 0 });
    });
    if (processed) void reprocessWithNewMaterial(visitId, false);
  };
}

/** 在既有訪視補資料（文件或錄音）。 */
export async function addMaterial(visitId: string, files: File[]) {
  const v = await db.visits.get(visitId);
  if (!v) return;
  const res = await storeFiles(visitId, files);
  if (res.audio + res.docs === 0) return res;
  if (["review", "done", "failed"].includes(v.status)) {
    await updateVisit(visitId, (cur) => ({ intakeOnly: cur.parts.length === 0 && cur.documents.length > 0 }));
    void reprocessWithNewMaterial(visitId, res.audio > 0);
  } else if (v.status === "processing" || v.status === "waiting") {
    // 這輪處理用的是補資料前的內容：排隊，結束後重新整理一次。
    await updateVisit(visitId, (cur) => ({ reprocessQueued: { audio: (cur.reprocessQueued?.audio ?? false) || res.audio > 0 } }));
    if (v.status === "waiting" || !isRunning(visitId)) {
      await updateVisit(visitId, { reprocessQueued: null });
      void reprocessWithNewMaterial(visitId, res.audio > 0);
    }
  } else if (["scheduled", "interrupted"].includes(v.status)) {
    await finishVisit(visitId);
  }
  return res;
}

/**
 * 改到其他個案：三份是依原個案的背景（診斷、上次紀錄、現行計畫）寫的，
 * 所以要用新個案重新整理；已確認或已複製的標記一併清除。復原會還原整筆。
 */
export async function moveVisit(visitId: string, patientId: string) {
  const before = await db.visits.get(visitId);
  if (!before || before.patientId === patientId) return null;
  const copied = (["record", "plan", "edu"] as DocKind[]).some((k) => before.outputs[k].copiedAt || before.outputs[k].sharedAt);
  const processed = !!before.analysis || ["processing", "waiting", "review", "done", "failed"].includes(before.status);
  await updateVisit(visitId, (v) => {
    const outputs = { ...v.outputs };
    for (const k of ["record", "plan", "edu"] as DocKind[]) {
      const out = v.outputs[k];
      outputs[k] = { ...out, status: out.status === "confirmed" ? "edited" : out.status, planVersion: null, ...unconfirmed };
    }
    // 計畫來源依新個案重新判斷（口述的內容是護理師說的，保留）。
    return {
      patientId,
      identityConfirmed: true,
      outputs,
      status: v.status === "done" ? "review" : v.status,
      completedAt: null,
      previous: undefined,
      planSource: v.planSource === "dictation" ? "dictation" : null,
      planBase: undefined,
      planDeferred: null,
    };
  });
  // 未動過的草稿依新個案重寫；改過或確認過的以「新版本可比較」提供。
  if (processed) void reprocessWithNewMaterial(visitId, false);
  return {
    copied,
    undo: async () => {
      const cur = await db.visits.get(visitId);
      // 還沒處理過（錄音中）只改回個案，保留期間新錄的內容；處理過的整筆還原。
      await db.visits.put(processed || !cur ? before : { ...cur, patientId: before.patientId, identityConfirmed: before.identityConfirmed });
      if (processed && (before.status === "processing" || before.status === "waiting")) void processVisit(visitId);
    },
  };
}

/** 刪除訪視：回傳「復原」函式（5 秒內可救回錄音與文件）。 */
export async function deleteVisit(visitId: string) {
  // 先結束錄音，剛錄的這段才會存進訪視，復原時不會遺失。
  if (recorder.getSnapshot().visitId === visitId) await recorder.stop();
  if (dictation.getSnapshot().visitId === visitId) dictation.cancel();
  const v = await db.visits.get(visitId);
  if (!v) return null;
  const blobs: StoredBlob[] = await db.blobs.where("visitId").equals(visitId).toArray();
  await deleteVisitDeep(visitId);
  const restored: Visit = ["recording", "paused"].includes(v.status) ? { ...v, status: v.parts.length ? "interrupted" : "scheduled" } : v;
  return async () => {
    await db.transaction("rw", db.visits, db.blobs, async () => {
      await db.blobs.bulkPut(blobs);
      await db.visits.put(restored);
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

/**
 * 護理師輸入或確認數值（手動值永遠勝過語音）。數值行會跟著變，
 * 所以已確認的紀錄與計畫退回「待確認」，並在背景依新數值重寫。
 */
export async function setVital(visitId: string, key: VitalKey, value: string | null, qualifier?: string | null) {
  let valueChanged = false;
  await updateVisit(visitId, (v) => {
    const typed = { ...v.typedVitals };
    const typedQ = { ...v.typedQualifiers };
    if (value) typed[key] = value;
    else delete typed[key];
    const prev = v.vitals[key];
    const q = qualifier === undefined ? (prev?.qualifier ?? null) : qualifier;
    if (q) typedQ[key] = q;
    else delete typedQ[key];
    valueChanged = (prev?.value ?? null) !== value;
    const lineChanged = valueChanged || (prev?.qualifier ?? null) !== q;
    return {
      typedVitals: typed,
      typedQualifiers: typedQ,
      vitals: { ...v.vitals, [key]: { value, qualifier: q, by: "nurse", confirmed: true } },
      ...(lineChanged ? reopenForVitals(v) : {}),
    };
  });
  if (valueChanged) scheduleVitalsRefresh(visitId);
}

/** 「X 沒錯」：確認語音判讀的數值，保留已併入的復測附註。 */
export async function confirmVital(visitId: string, key: VitalKey) {
  const v = await db.visits.get(visitId);
  const cur = v?.vitals[key];
  const reading = v?.analysis?.vitals.find((r) => r.key === key);
  const value = cur?.value ?? reading?.value ?? null;
  await setVital(visitId, key, value, cur ? cur.qualifier : (reading?.qualifier ?? null));
}

function reopenForVitals(v: Visit): Partial<Visit> {
  const outputs = { ...v.outputs };
  let reopened = false;
  for (const k of ["record", "plan"] as DocKind[]) {
    if (outputs[k].status !== "confirmed") continue;
    // 口述的計畫不含數值行，數值改了不必重新確認。
    if (k === "plan" && v.planSource === "dictation") continue;
    outputs[k] = { ...outputs[k], status: "edited", confirmedAt: null, confirmedBy: null, copiedAt: null };
    reopened = true;
  }
  if (!reopened) return {};
  return { outputs, ...(v.status === "done" ? { status: "review" as const, completedAt: null } : {}) };
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
  if (decision === "adopted") await regenerate(visitId, "plan", [], null, undefined, { auto: true });
}

export interface Blocker {
  kind: "processing" | "writing" | "identity" | "vital" | "docs" | "changes" | "conflict" | "warning" | "unverified";
  label: string;
  key?: VitalKey;
  doc?: DocKind;
}

export function openConflicts(v: Visit) {
  return (v.analysis?.conflicts ?? []).filter((c) => !(v.conflictChoices ?? {})[c.id]);
}

/** 選定衝突的說法：寫入分析事實，並讓未動過的草稿依選定內容重寫。 */
export async function resolveConflict(visitId: string, conflictId: string, choice: string) {
  let topic = "";
  await updateVisit(visitId, (v) => {
    const c = v.analysis?.conflicts?.find((x) => x.id === conflictId);
    if (!v.analysis || !c) return;
    topic = c.topic;
    return {
      conflictChoices: { ...(v.conflictChoices ?? {}), [conflictId]: choice },
      analysis: {
        ...v.analysis,
        findings: [...v.analysis.findings, { domain: c.topic, text: `${c.topic}：${choice}（護理師確認）`, sourceQuote: null, sourceMs: null, origin: "typed" }],
      },
    };
  });
  if (!topic) return;
  const v = await db.visits.get(visitId);
  if (!v) return;
  for (const k of ["record", "plan", "edu"] as DocKind[]) {
    if (v.outputs[k].status === "draft") void regenerate(visitId, k, [], null, undefined, { auto: true });
  }
}

export function openChanges(v: Visit) {
  return (v.analysis?.changes ?? []).filter((c) => !v.dismissedChanges.includes(c.id));
}

const UNVERIFIED: Blocker = { kind: "unverified", label: "刪除或改正〔待核對〕", doc: "plan" };

/**
 * 複製前必須先處理的項目（規格「先看這裡」）。評估異動、〔待核對〕只擋護理計畫；
 * 「全部」只含可以一起複製的幾份，計畫沒準備好就不含，不擋紀錄。
 */
export function blockersFor(v: Visit, kind: DocKind | "all"): Blocker[] {
  const out: Blocker[] = [];
  // 口述的計畫只用護理師的口述：不等整理、不看數值與異動，只確認身分、寫完、〔待核對〕與提醒。
  if (kind === "plan" && v.planSource === "dictation") {
    const plan = v.outputs.plan;
    if (v.analysis?.identityConcern && !v.identityConfirmed) out.push({ kind: "identity", label: "確認個案身分" });
    if (plan.status === "writing") out.push({ kind: "writing", label: `等${DOC_LABEL.plan}寫完`, doc: "plan" });
    if (hasUnverified(plan)) out.push(UNVERIFIED);
    if (openWarnings(plan)) out.push({ kind: "warning", label: `看過${DOC_LABEL.plan}的提醒`, doc: "plan" });
    return out;
  }
  // 補資料或改個案後正在重新整理：等新的分析完成，才知道要核對什麼。
  if (!v.analysis || v.status === "waiting" || (v.status === "processing" && v.stage !== "write")) {
    return [{ kind: "processing", label: v.status === "waiting" ? "等網路恢復後整理完成" : "等資料整理完成" }];
  }
  // 「全部」只看可以一起複製的幾份（還沒寫完的第一版不擋，按鈕會標示未完成）。
  const kinds = kind === "all" ? includedKinds(v) : [kind];
  for (const k of kinds) {
    if (v.outputs[k].status === "writing") out.push({ kind: "writing", label: `等${DOC_LABEL[k]}寫完`, doc: k });
  }
  if (v.analysis.identityConcern && !v.identityConfirmed) out.push({ kind: "identity", label: "確認個案身分" });
  for (const r of pendingVitals(v)) out.push({ kind: "vital", label: `確認${VITAL_LABEL[r.key]}`, key: r.key });
  for (const c of openConflicts(v)) out.push({ kind: "conflict", label: `選定${c.topic}` });
  if (v.analysis.docFacts.some((f) => f.unclear) && !v.docsChecked) out.push({ kind: "docs", label: "對照文件重點" });
  if (kind === "plan" && changesOpen(v)) out.push({ kind: "changes", label: "確認評估異動" });
  if (kind === "plan" && hasUnverified(v.outputs.plan)) out.push(UNVERIFIED);
  for (const k of kinds) {
    if (hasOpenWarnings(v.outputs[k])) out.push({ kind: "warning", label: `看過${DOC_LABEL[k]}的提醒`, doc: k });
  }
  return out;
}

export function hasOpenWarnings(out: OutputState) {
  return openWarnings(out);
}

/** 護理師看過輸出檢核的提醒（數字沒有來源、超出 AI 界線…）。 */
export async function ackWarnings(visitId: string, kind: DocKind) {
  await updateVisit(visitId, (v) => ({ outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], warningsAck: true } } }));
}

async function markConfirmed(visitId: string, kind: DocKind, extra: { copied?: boolean; shared?: boolean }) {
  const by = await confirmer();
  const at = nowIso();
  const visit = await db.visits.get(visitId);
  if (!visit) return;
  const patient = await db.patients.get(visit.patientId);
  let planVersion = visit.outputs.plan.planVersion;

  if (kind === "plan" && patient) {
    const settings = await getSettings();
    const out = visit.outputs.plan;
    const source = out.versions[out.current]?.source ?? visit.planSource ?? undefined;
    const plan = (version: number): Patient["plan"] => ({ version, text: docBody("plan", visit, settings), confirmedAt: at, by, ...(source ? { source } : {}) });
    if (!planVersion) {
      planVersion = (patient.plan?.version ?? 0) + 1;
      await updatePatient(patient.id, { plan: plan(planVersion) });
    } else if (patient.plan?.version === planVersion) {
      // 同一版修改後再確認：個案的現行計畫跟著更新（版號不變）。
      await updatePatient(patient.id, { plan: plan(planVersion) });
    }
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
    const planDeferred = kind === "plan" ? null : v.planDeferred;
    // 完成：紀錄確認；衛教沒有或已確認；計畫沒有、已確認或本次不擬。
    const allDone = visitComplete({ ...v, outputs, planDeferred });
    return {
      outputs,
      ...(kind === "plan" ? { planDeferred: null } : {}),
      reviewedAt: v.reviewedAt ?? at,
      reviewedBy: v.reviewedBy ?? by,
      status: allDone ? "done" : v.status,
      completedAt: allDone ? at : v.completedAt,
    };
  });

  await updateLast(visitId);
}

/** 紀錄確認後，個案的「上次」換成這筆。只往前推：補完較早的訪視時不蓋掉較新的。 */
async function updateLast(visitId: string) {
  const after = await db.visits.get(visitId);
  const patient = after && (await db.patients.get(after.patientId));
  if (!after || !patient || !after.analysis || after.outputs.record.status !== "confirmed") return;
  if (patient.last && patient.last.visitId !== after.id && patient.last.date > after.date) return;
  await updatePatient(patient.id, {
    last: { date: after.date, summary: after.analysis.summary, vitals: confirmedVitalList(after), findings: after.analysis.findings.slice(0, 4).map((f) => f.text), visitId: after.id },
  });
}

/**
 * 確認並複製。剪貼簿寫入必須是點擊後的第一個非同步動作（iPhone Safari 與分享網頁的框架
 * 在等過資料庫之後就不再允許寫入），所以設定由畫面傳入，確認紀錄在複製之後才寫。
 */
export async function confirmAndCopy(visit: Visit, kind: DocKind, patient: Patient | undefined, settings: Settings): Promise<{ ok: boolean; chars: number; blockers: Blocker[] }> {
  const blockers = blockersFor(visit, kind);
  if (blockers.length) return { ok: false, chars: 0, blockers };
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

/** 全部確認並複製：只含可以一起複製的幾份；計畫沒準備好時不含（planLeftOut），紀錄照常複製。 */
export async function confirmAll(visit: Visit, patient: Patient | undefined, settings: Settings): Promise<{ ok: boolean; blockers: Blocker[]; kinds: DocKind[]; planLeftOut: boolean }> {
  const kinds = includedKinds(visit);
  const planLeftOut = !kinds.includes("plan");
  const blockers = blockersFor(visit, "all");
  if (blockers.length) return { ok: false, blockers, kinds, planLeftOut };
  const ok = await writeClipboard(allDocsText(visit, patient, settings, kinds));
  if (ok) for (const k of kinds) await markConfirmed(visit.id, k, { copied: true });
  return { ok, blockers: [], kinds, planLeftOut };
}

/**
 * 照護紀錄導出前：與「全部確認並複製」同一道關卡，可以一起確認的幾份標成確認；
 * 計畫只有護理師勾選（includePlan）且可以複製時才一起確認。回傳擋下的項目（有就不導出）。
 */
export async function confirmForExport(visit: Visit, opts: { includePlan: boolean } = { includePlan: true }): Promise<Blocker[]> {
  const blockers = blockersFor(visit, "all");
  if (blockers.length) return blockers;
  for (const k of includedKinds(visit).filter((k) => k !== "plan" || opts.includePlan)) {
    if (visit.outputs[k].status !== "confirmed") await markConfirmed(visit.id, k, {});
  }
  return [];
}

/** 記下這次導出（誰、何時），顯示在工作台並留作稽核。 */
export async function logExport(visitId: string) {
  const by = await confirmer();
  await updateVisit(visitId, (v) => ({ exports: [...(v.exports ?? []), { at: nowIso(), by }] }));
}

export async function markEduShared(visitId: string) {
  await markConfirmed(visitId, "edu", { shared: true });
}

/** 試用版的衛教只複製（沒有真的分享），記成「已複製」。 */
export async function markEduCopied(visitId: string) {
  await markConfirmed(visitId, "edu", { copied: true });
}

/* ----------------------------- 護理計畫：口述與本次不擬 ----------------------------- */

/** 開始口述護理計畫（訪視錄音進行中、試用版或不支援錄音時回傳說明）。滿 8 分鐘自動收好並整理。 */
export async function startPlanDictation(visitId: string, opts?: { onLimit?: () => void }): Promise<{ ok: true } | { ok: false; message: string }> {
  const snap = dictation.getSnapshot();
  if ((snap.state === "recording" || snap.state === "starting") && snap.visitId !== visitId) await finishPlanDictation(snap.visitId);
  const ok = await dictation.start(visitId, {
    onLimit: () => {
      void finishPlanDictation(visitId).then(() => opts?.onLimit?.());
    },
  });
  if (ok) return { ok: true };
  return { ok: false, message: dictation.getSnapshot().error ?? "麥克風無法啟動，請再試一次。" };
}

let finishing: Promise<void> | null = null;

/** 完成口述：收好錄音、存進這筆訪視的口述（不進訪視錄音段），然後轉文字並自動整理。重複呼叫只存一次。 */
export function finishPlanDictation(visitId?: string | null): Promise<void> {
  if (finishing) return finishing;
  const snap = dictation.getSnapshot();
  if (snap.state !== "recording" && snap.state !== "starting") return Promise.resolve();
  const target = snap.visitId ?? visitId ?? null;
  finishing = (async () => {
    const res = await dictation.stop();
    if (res && target && res.blob.size > 0) await savePlanDictationAudio(target, res.blob, { input: "mic", fileName: null, durationMs: res.durationMs });
  })().finally(() => {
    finishing = null;
  });
  return finishing;
}

export function cancelPlanDictation(): void {
  dictation.cancel();
}

/** 本次不擬計畫：紀錄照常完成，計畫維持現行版本。 */
export async function deferPlan(visitId: string) {
  const by = await confirmer();
  const at = nowIso();
  let complete = false;
  await updateVisit(visitId, (v) => {
    const next: Visit = { ...v, planDeferred: { by, at } };
    complete = visitComplete(next) && v.status !== "done";
    return { planDeferred: next.planDeferred, ...(complete ? { status: "done" as const, completedAt: at } : {}) };
  });
  if (complete) await updateLast(visitId);
}

/** 恢復擬計畫：已完成的訪視若因此還沒完成，退回待確認。 */
export async function resumePlan(visitId: string) {
  await updateVisit(visitId, (v) => {
    const next: Visit = { ...v, planDeferred: null };
    const reopen = v.status === "done" && !visitComplete(next);
    return { planDeferred: null, ...(reopen ? { status: "review" as const, completedAt: null } : {}) };
  });
}

/* ----------------------------- 版本 ----------------------------- */

/** 內容換了：先前的確認、複製、分享都不再代表這一版。 */
const unconfirmed = { confirmedAt: null, confirmedBy: null, copiedAt: null, sharedAt: null } as const;

export async function saveEdit(visitId: string, kind: DocKind, sections: DocSection[]) {
  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    const cur = out.versions[out.current];
    // 修改不改變來源：口述版仍保留口述編號與原文（對照用）。
    const keep = { ...(cur?.source ? { source: cur.source } : {}), ...(cur?.dictationId ? { dictationId: cur.dictationId } : {}), ...(cur?.sourceText !== undefined ? { sourceText: cur.sourceText } : {}) };
    const versions = [...out.versions, { id: newId(), sections, origin: "nurse" as const, note: "護理師修改", createdAt: nowIso(), meta: null, ...keep }];
    return {
      status: v.status === "done" ? "review" : v.status,
      completedAt: v.status === "done" ? null : v.completedAt,
      outputs: { ...v.outputs, [kind]: { ...out, versions, current: versions.length - 1, status: "edited" as const, ...unconfirmed } },
      ...(kind === "edu" ? { translations: {} } : {}),
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
      outputs: { ...v.outputs, [kind]: { ...out, versions, current: versions.length - 1, candidate: null, status: "edited" as const, warningsAck: false, ...unconfirmed } },
      ...(kind === "edu" ? { translations: {} } : {}),
      // 計畫的來源跟著改用的那一版。
      ...(kind === "plan" && src.source ? { planSource: src.source } : {}),
    };
  });
}

export async function resolveCandidate(visitId: string, kind: DocKind, accept: boolean) {
  await updateVisit(visitId, (v) => {
    const out = v.outputs[kind];
    if (out.candidate === null) return;
    const picked = out.versions[accept ? out.candidate : out.current];
    return {
      status: accept && v.status === "done" ? "review" : v.status,
      completedAt: accept && v.status === "done" ? null : v.completedAt,
      outputs: {
        ...v.outputs,
        [kind]: accept
          ? { ...out, current: out.candidate, candidate: null, status: "draft" as const, warningsAck: false, ...unconfirmed }
          : { ...out, candidate: null },
      },
      ...(accept && kind === "edu" ? { translations: {} } : {}),
      // 計畫的來源跟著留下的那一版。
      ...(kind === "plan" && picked?.source ? { planSource: picked.source } : {}),
    };
  });
}

export { docHeader };
