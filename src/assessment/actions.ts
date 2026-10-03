import { db, getSettings, updatePatient } from "../lib/db";
import { todayStr } from "../lib/format";
import { ASSESSMENT_FORMS, type FormId, type FormValues, type HolisticAssessment } from "./forms";

const HISTORY_LIMIT = 200;

async function who() {
  return (await getSettings()).nurseName || "護理師";
}

/**
 * 儲存一張評估表。舊的那份放進修改歷程（只增不刪）。
 * 13 張第一次全部完成時記下完成日，作為下次（半年後）全人評估的基準。
 */
export async function saveAssessmentForm(patientId: string, formId: FormId, values: FormValues) {
  const p = await db.patients.get(patientId);
  if (!p) return;
  const by = await who();
  const at = new Date().toISOString();
  const prev = p.assessment ?? null;
  const forms = { ...(prev?.forms ?? {}), [formId]: { values: stripEmpty(values), savedAt: at, savedBy: by } };
  const allDone = ASSESSMENT_FORMS.every((f) => forms[f.id]);
  const next: HolisticAssessment = {
    forms,
    completedOn: prev?.completedOn ?? (allDone ? todayStr() : null),
    updatedAt: at,
    updatedBy: by,
  };
  const old = prev?.forms[formId];
  const history = old ? [...(p.assessmentHistory ?? []), { formId, record: old, replacedAt: at }].slice(-HISTORY_LIMIT) : p.assessmentHistory;
  await updatePatient(patientId, { assessment: next, assessmentHistory: history });
}

/** 完成本次（重新）評估：以今天為基準重算下次評估日。 */
export async function completeAssessment(patientId: string) {
  const p = await db.patients.get(patientId);
  if (!p?.assessment) return;
  await updatePatient(patientId, { assessment: { ...p.assessment, completedOn: todayStr(), updatedAt: new Date().toISOString(), updatedBy: await who() } });
}

function stripEmpty(values: FormValues): FormValues {
  const out: FormValues = {};
  for (const [k, v] of Object.entries(values)) {
    if (k.startsWith("_")) continue;
    if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = v;
  }
  return out;
}
