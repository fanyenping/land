import { demoAnalysis, demoGenerate } from "../../shared/demo";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import type { DocKind } from "../../shared/types";
import { db } from "./db";
import { addDays, todayStr } from "./format";
import { newId, type OutputState, type Patient, type Visit } from "./model";
import { newVisit, patientContext } from "./pipeline";
import { confirmedVitalList, initialVitals } from "./vitals";

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

const PLAN_V3 = `護理問題 1：皮膚完整性受損（薦骨壓傷）
相關因素：長期臥床、翻身頻率不足、營養攝取不足
護理目標：兩週內傷口面積縮小，周圍皮膚無新發紅
護理措施：
1. 每次訪視評估傷口大小、滲液與周圍皮膚
2. 指導家屬與看護每兩小時翻身並記錄
3. 以生理食鹽水清潔，泡棉敷料覆蓋
評值：傷口滲液減少，持續追蹤

護理問題 2：營養不均衡（少於身體需要）
相關因素：吞嚥困難、經鼻胃管灌食
護理目標：一個月內體重維持不下降
護理措施：
1. 確認灌食配方與每日總量
2. 灌食時床頭抬高 30–45 度，灌後維持 30 分鐘
評值：家屬可正確執行灌食`;

export async function seedDemo() {
  const today = todayStr();
  const lastVisit = addDays(today, -14);

  const chen = patient({
    name: "陳秀蘭",
    gender: "女",
    birthYear: new Date().getFullYear() - 84,
    familyCallsAs: "阿嬤",
    diagnoses: ["腦中風後遺症", "高血壓", "第二型糖尿病"],
    tubes: [
      { id: newId(), name: "鼻胃管", changedAt: addDays(today, -30), intervalDays: 30 },
      { id: newId(), name: "導尿管", changedAt: addDays(today, -12), intervalDays: 30 },
    ],
    consent: { by: "家屬", at: `${lastVisit}T09:40:00.000Z`, version: "2026.10", expiresAt: addDays(lastVisit, 180) },
    plan: { version: 3, text: PLAN_V3, confirmedAt: `${lastVisit}T10:20:00.000Z`, by: "林護理師" },
    last: {
      date: lastVisit,
      summary: "飯前血糖偏高；薦骨壓傷換藥，滲液少量",
      vitals: [
        { key: "temp", value: "36.6", qualifier: null },
        { key: "bp", value: "136/82", qualifier: null },
        { key: "glucose", value: "152", qualifier: "飯前" },
      ],
      findings: ["痰液少量白色", "排便兩天一次", "可喚醒，點頭回應"],
    },
  });
  const wang = patient({
    name: "王志明",
    gender: "男",
    birthYear: new Date().getFullYear() - 78,
    familyCallsAs: "阿公",
    diagnoses: ["慢性阻塞性肺病", "攝護腺肥大"],
    tubes: [{ id: newId(), name: "導尿管", changedAt: addDays(today, -25), intervalDays: 30 }],
    consent: { by: "個案本人", at: `${addDays(today, -40)}T09:00:00.000Z`, version: "2026.10", expiresAt: addDays(today, 140) },
    last: { date: addDays(today, -28), summary: "呼吸平順，導尿管通暢", vitals: [], findings: [] },
  });
  const lin = patient({
    name: "林阿妹",
    gender: "女",
    birthYear: new Date().getFullYear() - 90,
    familyCallsAs: "阿祖",
    diagnoses: ["失智症", "骨質疏鬆"],
    tubes: [{ id: newId(), name: "鼻胃管", changedAt: addDays(today, -20), intervalDays: 30 }],
    consent: { by: "家屬", at: `${addDays(today, -60)}T10:00:00.000Z`, version: "2026.10", expiresAt: addDays(today, 120) },
    last: { date: addDays(today, -14), summary: "食慾差，體重下降 1 公斤", vitals: [], findings: [] },
  });
  const chang = patient({
    name: "張建德",
    gender: "男",
    birthYear: new Date().getFullYear() - 69,
    familyCallsAs: "張伯伯",
    diagnoses: ["脊髓損傷", "神經性膀胱"],
    tubes: [{ id: newId(), name: "恥骨上膀胱造口", changedAt: addDays(today, -8), intervalDays: 28 }],
  });
  const lee = patient({
    name: "李玉珠",
    gender: "女",
    birthYear: new Date().getFullYear() - 81,
    familyCallsAs: "李奶奶",
    diagnoses: ["心臟衰竭", "慢性腎臟病"],
  });
  const huang = patient({
    name: "黃文雄",
    gender: "男",
    birthYear: new Date().getFullYear() - 73,
    familyCallsAs: "黃伯",
    diagnoses: ["帕金森氏症"],
    tubes: [{ id: newId(), name: "胃造口", changedAt: addDays(today, -50), intervalDays: 90 }],
  });
  const wu = patient({
    name: "吳美惠",
    gender: "女",
    birthYear: new Date().getFullYear() - 88,
    familyCallsAs: "吳阿嬤",
    diagnoses: ["髖關節骨折術後"],
  });

  const patients = [chen, wang, lin, chang, lee, huang, wu];

  const vWang = newVisit(wang.id, today, "09:00");
  const vChen = newVisit(chen.id, today, "09:40");
  const vLin = newVisit(lin.id, today, "10:50");
  const vChang = newVisit(chang.id, today, "13:30");
  const vLee = newVisit(lee.id, today, "15:00");

  await finishDemoVisit(vWang, wang, "done");
  await finishDemoVisit(vLin, lin, "review");

  await db.transaction("rw", db.patients, db.visits, async () => {
    await db.patients.bulkPut(patients);
    await db.visits.bulkPut([vWang, vChen, vLin, vChang, vLee]);
  });
}

/** 用示範引擎直接產生一筆已處理的訪視（今日清單中的「已完成」「待確認」）。 */
async function finishDemoVisit(v: Visit, p: Patient, status: "done" | "review") {
  const start = new Date();
  start.setHours(Number(v.time?.slice(0, 2) ?? 9), Number(v.time?.slice(3) ?? 0), 0, 0);
  v.recordingStartedAt = start.toISOString();
  v.recordingEndedAt = new Date(start.getTime() + DEMO_DURATION_MS).toISOString();
  v.transcript = {
    text: DEMO_SEGMENTS.map((s) => s.text).join(""),
    segments: DEMO_SEGMENTS.map((s) => ({ ...s })),
    durationMs: DEMO_DURATION_MS,
    provider: "demo",
  };
  const analysis = demoAnalysis({
    visitDate: v.date,
    patient: patientContext(p),
    transcript: v.transcript,
    documents: [],
    typedVitals: {},
    notes: null,
    previous: p.last,
    currentPlan: p.plan?.text ?? null,
  });
  v.analysis = analysis;
  v.analysisMeta = { mode: "demo", model: null, promptVersion: "demo" };
  v.vitals = initialVitals(analysis, {}, {});
  if (status === "done") {
    for (const r of analysis.vitals) {
      v.vitals[r.key] = { value: r.suggestion ?? r.value, qualifier: r.qualifier, by: r.suggestion ? "nurse" : "ai", confirmed: true };
    }
    v.changesConfirmed = { by: "林護理師", at: v.recordingEndedAt };
    v.docsChecked = { by: "林護理師", at: v.recordingEndedAt };
    v.reviewedAt = v.recordingEndedAt;
    v.reviewedBy = "林護理師";
    v.completedAt = v.recordingEndedAt;
  }
  const kinds: DocKind[] = ["record", "plan", "edu"];
  for (const kind of kinds) {
    const doc = demoGenerate({
      kind,
      visitDate: v.date,
      patient: patientContext(p),
      analysis,
      confirmedVitals: confirmedVitalList(v),
      currentPlan: p.plan?.text ?? null,
      adoptedSuggestions: [],
      options: { recordStyle: "four", instructions: [], custom: null, nurseName: null, clinicPhone: null },
      intakeOnly: false,
      previous: p.last,
    });
    const out: OutputState = {
      ...v.outputs[kind],
      status: status === "done" ? "confirmed" : "draft",
      versions: [{ id: newId(), sections: doc.sections, origin: "ai", note: null, createdAt: v.recordingEndedAt!, meta: v.analysisMeta }],
      current: 0,
      confirmedAt: status === "done" ? v.recordingEndedAt : null,
      confirmedBy: status === "done" ? "林護理師" : null,
      copiedAt: status === "done" ? v.recordingEndedAt : null,
      planVersion: status === "done" && kind === "plan" ? 1 : null,
    };
    v.outputs[kind] = out;
  }
  v.status = status;
  if (status === "done") {
    p.plan = { version: 1, text: v.outputs.plan.versions[0].sections.map((s) => `${s.heading}\n${s.body}`).join("\n\n"), confirmedAt: v.recordingEndedAt!, by: "林護理師" };
    p.last = { date: v.date, summary: analysis.summary, vitals: confirmedVitalList(v), findings: analysis.findings.slice(0, 3).map((f) => f.text) };
  }
}
