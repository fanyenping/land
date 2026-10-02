import Dexie, { type EntityTable } from "dexie";
import { DEFAULT_SETTINGS, type Patient, type Settings, type Visit } from "./model";

export interface StoredBlob {
  key: string;
  visitId: string | null;
  patientId: string | null;
  blob: Blob;
  createdAt: string;
}

/** 錄音中每秒落地的片段：App 被關掉時仍可救回。 */
export interface StoredChunk {
  id?: number;
  partId: string;
  visitId: string;
  seq: number;
  blob: Blob;
}

class CareDb extends Dexie {
  patients!: EntityTable<Patient, "id">;
  visits!: EntityTable<Visit, "id">;
  blobs!: EntityTable<StoredBlob, "key">;
  chunks!: EntityTable<StoredChunk, "id">;
  settings!: EntityTable<Settings, "id">;

  constructor() {
    super("taione-care");
    this.version(1).stores({
      patients: "id, name, updatedAt",
      visits: "id, patientId, date, status, createdAt",
      blobs: "key, visitId, patientId",
      chunks: "++id, partId, [partId+seq]",
      settings: "id",
    });
  }
}

export const db = new CareDb();

export async function getSettings(): Promise<Settings> {
  return (await db.settings.get("me")) ?? DEFAULT_SETTINGS;
}

export async function saveSettings(patch: Partial<Settings>) {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: "me" });
}

export async function putBlob(blob: Blob, owner: { visitId?: string; patientId?: string }): Promise<string> {
  const key = crypto.randomUUID();
  await db.blobs.put({
    key,
    visitId: owner.visitId ?? null,
    patientId: owner.patientId ?? null,
    blob,
    createdAt: new Date().toISOString(),
  });
  return key;
}

export async function getBlob(key: string): Promise<Blob | null> {
  return (await db.blobs.get(key))?.blob ?? null;
}

export async function updateVisit(id: string, patch: Partial<Visit> | ((v: Visit) => Partial<Visit> | void)) {
  await db.transaction("rw", db.visits, async () => {
    const v = await db.visits.get(id);
    if (!v) return;
    const next = typeof patch === "function" ? patch(v) : patch;
    if (next) await db.visits.put({ ...v, ...next });
    else await db.visits.put(v);
  });
}

export async function updatePatient(id: string, patch: Partial<Patient>) {
  await db.patients.update(id, { ...patch, updatedAt: new Date().toISOString() });
}

/** 刪除訪視與其錄音、文件。 */
export async function deleteVisitDeep(id: string) {
  await db.transaction("rw", db.visits, db.blobs, async () => {
    await db.blobs.where("visitId").equals(id).delete();
    await db.visits.delete(id);
  });
}

export async function deletePatientDeep(id: string) {
  const visits = await db.visits.where("patientId").equals(id).toArray();
  await db.transaction("rw", db.visits, db.blobs, db.patients, async () => {
    for (const v of visits) {
      await db.blobs.where("visitId").equals(v.id).delete();
    }
    await db.visits.where("patientId").equals(id).delete();
    await db.blobs.where("patientId").equals(id).delete();
    await db.patients.delete(id);
  });
}

/** 依保存天數清除已完成訪視的錄音與文件（紀錄文字保留，供歷次查詢）。 */
export async function applyRetention(days: number) {
  const cutoff = Date.now() - days * 86_400_000;
  const old = await db.visits.filter((v) => v.status === "done" && !!v.completedAt && Date.parse(v.completedAt) < cutoff).toArray();
  for (const v of old) {
    if (v.parts.length === 0 && v.documents.length === 0) continue;
    await db.blobs.where("visitId").equals(v.id).delete();
    await db.visits.update(v.id, { parts: [], documents: [] });
  }
  return old.length;
}

export async function wipeAll() {
  await db.delete();
  await db.open();
}

export async function exportAll() {
  const [patients, visits, settings] = await Promise.all([db.patients.toArray(), db.visits.toArray(), db.settings.toArray()]);
  return { exportedAt: new Date().toISOString(), app: "TaiOne care", patients, visits, settings };
}
