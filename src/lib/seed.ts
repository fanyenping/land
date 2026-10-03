import { demoAnalysis } from "../../shared/demo";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import { EDU_CLOSING, EDU_HEADINGS, PLAN_HEADINGS } from "../../shared/templates";
import type { Analysis, DocKind, DocSection, VitalKey, VitalReading } from "../../shared/types";
import { ASSESSMENT_FORMS, type FormId, type FormValues, type HolisticAssessment } from "../assessment/forms";
import { DEMO_ASSESSMENTS } from "./demoAssessments";
import { db } from "./db";
import { DEMO_CONTENT, type DemoPatientContent, type DemoRecord } from "./demoRecords";
import { addDays, todayStr } from "./format";
import { newId, type OutputState, type Patient, type ResolvedVital, type Visit } from "./model";
import { newVisit, patientContext } from "./pipeline";
import { clinicalFlag, confirmedVitalList, initialVitals } from "./vitals";

const NURSE = "林護理師";
const DEMO_META = { mode: "demo" as const, model: null, promptVersion: "demo" };

/** 示範個案：全部為虛構人物與資料。 */
function patient(p: Partial<Patient> & Pick<Patient, "name" | "gender" | "birthYear">): Patient {
  const t = new Date().toISOString();
  return {
    id: newId(),
    familyCallsAs: null,
    diagnoses: [],
    tubes: [],
    consent: null,
    consentRefusedAt: null,
    plan: null,
    last: null,
    isDemo: true,
    isTemporary: false,
    createdAt: t,
    updatedAt: t,
    ...p,
  };
}

/** 個案層的照護紀錄欄位（收案日、身高、居住、資源、近 30 天事件）。 */
function profile(c: DemoPatientContent, today: string): Partial<Patient> {
  return {
    intakeDate: addDays(today, -c.patient.intakeDaysAgo),
    heightCm: c.patient.heightCm,
    residence: c.patient.residence,
    area: c.patient.area,
    resource: c.patient.resource,
    events: c.patient.events.map((e) => ({ id: newId(), kind: e.kind, date: addDays(today, -e.daysAgo), shift: e.shift, reason: e.reason })),
  };
}

/** 全人評估：上次完成日（半年後提醒）。 */
function assessment(key: keyof typeof DEMO_ASSESSMENTS, completedDaysAgo: number, today: string): HolisticAssessment | null {
  const entries = DEMO_ASSESSMENTS[key];
  if (!entries) return null;
  const at = `${addDays(today, -completedDaysAgo)}T10:00:00.000Z`;
  const forms: HolisticAssessment["forms"] = {};
  for (const [formId, values] of Object.entries(entries) as [FormId, FormValues][]) forms[formId] = { values, savedAt: at, savedBy: NURSE };
  const done = ASSESSMENT_FORMS.every((f) => forms[f.id]);
  return { forms, completedOn: done ? addDays(today, -completedDaysAgo) : null, updatedAt: at, updatedBy: NURSE };
}

export async function seedDemo(): Promise<boolean> {
  // 已經有示範個案就不再加一份（避免重複的個案與訪視）。
  if ((await db.patients.filter((p) => p.isDemo).count()) > 0) return false;
  const today = todayStr();
  const y = new Date().getFullYear();
  const C = DEMO_CONTENT;

  const chen = patient({
    name: "陳秀蘭",
    gender: "女",
    birthYear: y - 84,
    familyCallsAs: "阿嬤",
    diagnoses: ["腦中風後遺症", "高血壓", "第二型糖尿病"],
    tubes: [
      { id: newId(), name: "鼻胃管", changedAt: addDays(today, -30), intervalDays: 30 },
      { id: newId(), name: "導尿管", changedAt: addDays(today, -12), intervalDays: 30 },
    ],
    consent: { by: "家屬", at: `${addDays(today, -14)}T09:40:00.000Z`, version: "2026.10", expiresAt: addDays(today, 166) },
    ...profile(C.chen, today),
    assessment: assessment("chen", 150, today),
  });
  const wang = patient({
    name: "王志明",
    gender: "男",
    birthYear: y - 78,
    familyCallsAs: "阿公",
    diagnoses: ["慢性阻塞性肺病", "攝護腺肥大"],
    tubes: [{ id: newId(), name: "導尿管", changedAt: addDays(today, -25), intervalDays: 30 }],
    consent: { by: "個案本人", at: `${addDays(today, -40)}T09:00:00.000Z`, version: "2026.10", expiresAt: addDays(today, 140) },
    ...profile(C.wang, today),
    assessment: assessment("wang", 120, today),
  });
  const lin = patient({
    name: "林阿妹",
    gender: "女",
    birthYear: y - 90,
    familyCallsAs: "阿祖",
    diagnoses: ["失智症", "骨質疏鬆"],
    tubes: [{ id: newId(), name: "鼻胃管", changedAt: addDays(today, -20), intervalDays: 30 }],
    consent: { by: "家屬", at: `${addDays(today, -60)}T10:00:00.000Z`, version: "2026.10", expiresAt: addDays(today, 120) },
    ...profile(C.lin, today),
    assessment: assessment("lin", 90, today),
  });
  const chang = patient({
    name: "張建德",
    gender: "男",
    birthYear: y - 69,
    familyCallsAs: "張伯伯",
    diagnoses: ["脊髓損傷", "神經性膀胱"],
    tubes: [{ id: newId(), name: "恥骨上膀胱造口", changedAt: addDays(today, -8), intervalDays: 28 }],
    ...profile(C.chang, today),
    assessment: assessment("chang", 60, today),
  });
  const lee = patient({
    name: "李玉珠",
    gender: "女",
    birthYear: y - 81,
    familyCallsAs: "李奶奶",
    diagnoses: ["心臟衰竭", "慢性腎臟病"],
    ...profile(C.lee, today),
    assessment: assessment("lee", 100, today),
  });
  const huang = patient({
    name: "黃文雄",
    gender: "男",
    birthYear: y - 73,
    familyCallsAs: "黃伯",
    diagnoses: ["帕金森氏症"],
    tubes: [{ id: newId(), name: "胃造口", changedAt: addDays(today, -50), intervalDays: 90 }],
    ...profile(C.huang, today),
    // 超過半年未重新評估：個案頁以紅字提醒。
    assessment: assessment("huang", 190, today),
  });
  const wu = patient({
    name: "吳美惠",
    gender: "女",
    birthYear: y - 88,
    familyCallsAs: "吳阿嬤",
    diagnoses: ["髖關節骨折術後", "高血壓"],
    ...profile(C.wu, today),
    assessment: assessment("wu", 40, today),
  });
  // 新收案：今天初次訪視，全人評估已填 8 張、剩 5 張現場完成，計畫依評估擬定。
  const kao = patient({
    name: "高美珍",
    gender: "女",
    birthYear: y - 76,
    familyCallsAs: "高阿姨",
    diagnoses: ["第二型糖尿病", "高血壓", "左足糖尿病足潰瘍"],
    intakeDate: today,
    heightCm: "155",
    residence: "在宅(居家)",
    area: "臺南市東區",
    resource: "健保第一類",
    consent: { by: "個案本人", at: `${today}T08:30:00.000Z`, version: "2026.10", expiresAt: addDays(today, 180) },
    assessment: assessment("kao", 0, today),
  });

  const visits: Visit[] = [];
  // 過去的訪視（由舊到新），完成後更新個案的現行計畫與上次重點。舊個案的計畫都已沿用過，所以從第 2 版起。
  const history: [Patient, DemoPatientContent, number][] = [
    [chen, C.chen, 3],
    [lin, C.lin, 2],
    [chang, C.chang, 2],
    [lee, C.lee, 2],
    [huang, C.huang, 2],
    [wu, C.wu, 2],
  ];
  for (const [p, content, version] of history) {
    for (const r of content.records.filter((x) => x.key === "past").sort((a, b) => b.daysAgo - a.daysAgo)) visits.push(doneVisit(p, r, today, version));
  }

  // 今天：王（已完成）、陳（待確認，逐字稿含一個聽錯的數值）、林／張／李（排定）、高（初訪）。
  visits.push(doneVisit(wang, C.wang.records.find((r) => r.key === "today")!, today, 2));
  visits.push(reviewVisit(chen, C.chen.records.find((r) => r.key === "today")!, today));
  visits.push({ ...newVisit(lin.id, today, "10:50"), kind: "follow" });
  visits.push({ ...newVisit(chang.id, today, "13:30"), kind: "follow" });
  visits.push({ ...newVisit(lee.id, today, "15:00"), kind: "follow" });
  visits.push({ ...newVisit(kao.id, today, "16:00"), kind: "first" });

  await db.transaction("rw", db.patients, db.visits, async () => {
    await db.patients.bulkPut([chen, wang, lin, chang, lee, huang, wu, kao]);
    await db.visits.bulkPut(visits);
  });
  return true;
}

/* ----------------------------- 組成訪視 ----------------------------- */

function times(date: string, time: string, minutes: number) {
  const [h, m] = time.split(":").map(Number);
  const start = new Date(`${date}T00:00:00`);
  start.setHours(h, m, 0, 0);
  return { start: start.toISOString(), end: new Date(start.getTime() + minutes * 60_000).toISOString() };
}

const VITAL_KEYS: [VitalKey, keyof DemoRecord["vitals"], keyof DemoRecord["vitals"] | null][] = [
  ["temp", "temp", null],
  ["pulse", "pulse", null],
  ["resp", "resp", null],
  ["bp", "bp", null],
  ["spo2", "spo2", "spo2Qualifier"],
  ["glucose", "glucose", "glucoseQualifier"],
  ["consciousness", "consciousness", null],
];

function readings(r: DemoRecord): VitalReading[] {
  const out: VitalReading[] = [];
  for (const [key, field, qField] of VITAL_KEYS) {
    const value = r.vitals[field];
    if (!value) continue;
    const qualifier = qField ? r.vitals[qField] : null;
    out.push({ key, value, qualifier, sourceQuote: null, sourceMs: null, confidence: 0.95, status: "ok", suggestion: null, reason: null, flag: key === "consciousness" ? null : clinicalFlag(key, value, qualifier) });
  }
  return out;
}

function analysisOf(r: DemoRecord): Analysis {
  return {
    summary: r.summary,
    speakers: {},
    vitals: readings(r),
    findings: r.findings.map((text) => ({ domain: "其他", text, sourceQuote: null, sourceMs: null, origin: "audio" })),
    tubes: [],
    wounds: [],
    interventions: [],
    changes: [],
    planSuggestions: [],
    educationTopics: [],
    redFlags: [],
    docFacts: [],
    documents: [],
    identityConcern: null,
    missingDomains: [],
    languageNotes: [],
    conflicts: [],
  };
}

/** 照護紀錄欄＝17 項評估逐行＋一段敘述（與 HIS 照護紀錄相同）。 */
function sectionsOf(kind: DocKind, r: DemoRecord): DocSection[] {
  if (kind === "record") {
    return [
      { heading: "", body: r.assessment.join("\n") },
      { heading: "", body: r.narrative },
    ];
  }
  if (kind === "plan") {
    const p = r.plan;
    return [
      { heading: "", body: p.basis },
      { heading: PLAN_HEADINGS[0], body: p.assessmentSummary },
      { heading: PLAN_HEADINGS[1], body: p.diagnosis },
      { heading: PLAN_HEADINGS[2], body: p.problems },
      { heading: PLAN_HEADINGS[3], body: p.family },
      { heading: PLAN_HEADINGS[4], body: p.evaluation },
    ];
  }
  const e = r.edu;
  return [
    { heading: "", body: e.opening },
    { heading: EDU_HEADINGS.attention, body: e.attention },
    { heading: EDU_HEADINGS.daily, body: e.daily },
    ...(e.tubes ? [{ heading: EDU_HEADINGS.tubes, body: e.tubes }] : []),
    { heading: EDU_HEADINGS.redFlags, body: e.redFlags },
    { heading: "", body: EDU_CLOSING },
  ];
}

function output(v: Visit, kind: DocKind, r: DemoRecord, confirmed: boolean, planVersion: number | null): OutputState {
  const at = v.recordingEndedAt!;
  return {
    ...v.outputs[kind],
    status: confirmed ? "confirmed" : "draft",
    versions: [{ id: newId(), sections: sectionsOf(kind, r), origin: "ai", note: null, createdAt: at, meta: DEMO_META }],
    current: 0,
    confirmedAt: confirmed ? at : null,
    confirmedBy: confirmed ? NURSE : null,
    copiedAt: confirmed ? at : null,
    planVersion: confirmed && kind === "plan" ? planVersion : null,
  };
}

function planText(sections: DocSection[]) {
  return sections.map((s) => (s.heading ? `${s.heading}\n${s.body}` : s.body)).join("\n\n");
}

function visitShell(p: Patient, r: DemoRecord, today: string): Visit {
  const date = addDays(today, -r.daysAgo);
  const v: Visit = { ...newVisit(p.id, date, r.time), kind: "follow" };
  const t = times(date, r.time, r.durationMin);
  v.recordingStartedAt = t.start;
  v.recordingEndedAt = t.end;
  v.source = r.source;
  v.serviceItems = r.serviceItems;
  v.body = { ...r.body };
  v.previous = p.last;
  return v;
}

/** 已完成的訪視：三份已確認並複製，個案的現行計畫與上次重點跟著更新。 */
function doneVisit(p: Patient, r: DemoRecord, today: string, planVersion: number): Visit {
  const v = visitShell(p, r, today);
  v.analysis = analysisOf(r);
  v.analysisMeta = DEMO_META;
  const vitals: Partial<Record<VitalKey, ResolvedVital>> = {};
  for (const x of v.analysis.vitals) vitals[x.key] = { value: x.value, qualifier: x.qualifier, by: "ai", confirmed: true };
  v.vitals = vitals;
  for (const k of ["record", "plan", "edu"] as DocKind[]) v.outputs[k] = output(v, k, r, true, planVersion);
  const at = v.recordingEndedAt!;
  v.status = "done";
  v.changesConfirmed = { by: NURSE, at };
  v.docsChecked = { by: NURSE, at };
  v.reviewedAt = at;
  v.reviewedBy = NURSE;
  v.completedAt = at;
  p.plan = { version: planVersion, text: planText(v.outputs.plan.versions[0].sections), confirmedAt: at, by: NURSE };
  p.last = { date: v.date, summary: r.summary, vitals: confirmedVitalList(v), findings: r.findings.slice(0, 4), visitId: v.id };
  return v;
}

/**
 * 今天待確認的訪視：用示範逐字稿分析（保留「三十六點八」被聽成「十六點八」的數值核對），
 * 三份草稿是依照護紀錄框架寫好的內容。
 */
function reviewVisit(p: Patient, r: DemoRecord, today: string): Visit {
  const v = visitShell(p, r, today);
  v.transcript = {
    text: DEMO_SEGMENTS.map((s) => s.text).join(""),
    segments: DEMO_SEGMENTS.map((s) => ({ ...s })),
    durationMs: DEMO_DURATION_MS,
    provider: "demo",
  };
  v.analysis = demoAnalysis({
    visitDate: v.date,
    patient: patientContext(p),
    transcript: v.transcript,
    documents: [],
    typedVitals: {},
    notes: null,
    previous: p.last,
    currentPlan: p.plan?.text ?? null,
  });
  v.analysisMeta = DEMO_META;
  v.vitals = initialVitals(v.analysis, {}, {});
  for (const k of ["record", "plan", "edu"] as DocKind[]) v.outputs[k] = output(v, k, r, false, null);
  v.status = "review";
  return v;
}
