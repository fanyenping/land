import { addDays, clock, maskName } from "../lib/format";
import { TRIAL } from "../lib/env";
import { SHIFT_RANGE, type CareEvent, type Patient, type Settings, type Visit } from "../lib/model";
import { currentSections, docBody, planVersionFor } from "../lib/compose";
import type { CareRecordData, CareRecordRow } from "./types";

/** 照護紀錄導出的固定選項（依原文件常見寫法）。 */
export const SOURCE_OPTIONS = ["家訪", "電訪", "視訊", "門診"] as const;
export const RESIDENCE_OPTIONS = ["在宅(居家)", "住宿式機構", "社區式機構", "其他"] as const;
export const RESOURCE_OPTIONS = ["健保第一類", "健保第二類", "健保第三類", "健保第四類", "健保第五類", "健保第六類", "長照", "自費"] as const;
export const SERVICE_OPTIONS = ["留置鼻胃管護理", "留置導尿管護理", "氣切管護理", "傷口護理", "一般護理指導", "抽血檢驗", "注射", "安寧居家療護"] as const;

/** 事件區塊的查詢範圍：訪視日往前 30 天。 */
export const EVENT_WINDOW_DAYS = 30;

const TUBE_SERVICE: [RegExp, string][] = [
  [/鼻胃管|NG/i, "留置鼻胃管護理"],
  [/導尿管|尿管|Foley/i, "留置導尿管護理"],
  [/氣切/, "氣切管護理"],
  [/胃造/, "胃造廔管護理"],
];

/** 服務項目：護理師選過就用選的；否則依個案管路推算。 */
export function serviceItemsFor(visit: Visit, patient: Patient): string[] {
  if (visit.serviceItems?.length) return visit.serviceItems;
  const items: string[] = [];
  for (const t of patient.tubes) {
    const hit = TUBE_SERVICE.find(([re]) => re.test(t.name));
    if (hit && !items.includes(hit[1])) items.push(hit[1]);
  }
  return items.length ? items : ["一般護理指導"];
}

const num = (s: string | null | undefined) => {
  const n = Number.parseFloat(s ?? "");
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** BMI：體重(kg) ÷ 身高(m)²，取到小數一位（整數時不寫 .0，與原文件一致）。 */
export function bmiOf(heightCm: string | null | undefined, weightKg: string | null | undefined): string {
  const h = num(heightCm);
  const w = num(weightKg);
  if (!h || !w) return "";
  const v = Math.round((w / (h / 100) ** 2) * 10) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)} kg/m²`;
}

const withUnit = (v: string | null | undefined, unit: string) => (v && v.trim() ? `${v.trim()} ${unit}` : "");

/** 「2026/10/3 下午 02:15:08」（與 HIS 匯出時間同格式）。 */
export function exportStamp(d = new Date()): string {
  const h = d.getHours();
  const hh = String(h % 12 === 0 ? 12 : h % 12).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${h < 12 ? "上午" : "下午"} ${hh}:${mm}:${ss}`;
}

function visitTime(visit: Visit): { start: string; end: string } {
  const start = visit.recordingStartedAt ? clock(visit.recordingStartedAt) : (visit.time ?? "");
  const end = visit.recordingEndedAt ? clock(visit.recordingEndedAt) : "";
  return { start, end };
}

/** 訪視日前 30 天內（含當天）的事件，依日期排序。 */
export function eventsInWindow(patient: Patient, visit: Visit): CareEvent[] {
  const from = addDays(visit.date, -EVENT_WINDOW_DAYS);
  return (patient.events ?? []).filter((e) => e.date >= from && e.date <= visit.date).sort((a, b) => a.date.localeCompare(b.date));
}

export function eventRows(patient: Patient, visit: Visit, kind: CareEvent["kind"]): CareRecordRow[] {
  return eventsInWindow(patient, visit)
    .filter((e) => e.kind === kind)
    .map((e) => ({ when: e.shift ? `${e.date}，${e.shift}（${SHIFT_RANGE[e.shift]}）` : e.date, reason: e.reason.trim() || "—" }));
}

/** 生命徵象表：只用確認過的數值；一項都沒有時回傳 null。 */
function vitalsRow(visit: Visit): CareRecordData["vitals"] {
  const v = (k: keyof Visit["vitals"]) => {
    const r = visit.vitals[k];
    return r && r.confirmed && r.value ? r : null;
  };
  const keys = ["temp", "pulse", "resp", "bp", "glucose", "spo2"] as const;
  if (!keys.some((k) => v(k))) return null;
  const bp = v("bp")?.value?.split("/") ?? [];
  const glu = v("glucose");
  const { start } = visitTime(visit);
  const dash = "—";
  return {
    measuredAt: `${visit.date}${start ? `\n${start}` : ""}`,
    temp: v("temp") ? `${v("temp")!.value}°C` : dash,
    pulse: v("pulse") ? `${v("pulse")!.value}bpm` : dash,
    resp: v("resp") ? `${v("resp")!.value}次/分` : dash,
    sbp: bp[0] ? `${bp[0]}mmHg` : dash,
    dbp: bp[1] ? `${bp[1]}mmHg` : dash,
    glucose: glu ? `${glu.value}mg/dL${glu.qualifier && /^(飯前|飯後|餐前|餐後|空腹|睡前|隨機)/.test(glu.qualifier) ? `\n(${glu.qualifier.split(/[，,、\s]/)[0]})` : ""}` : dash,
    spo2: v("spo2") ? `${v("spo2")!.value}%` : dash,
  };
}

/** 照護紀錄欄：護理紀錄的段落（生命徵象另有表格，這裡不重複）。 */
function recordText(visit: Visit): string {
  const blocks: string[] = [];
  for (const s of currentSections(visit.outputs.record)) {
    const body = s.body.trim();
    if (s.heading && body) blocks.push(`${s.heading}\n${body}`);
    else if (s.heading) blocks.push(s.heading);
    else if (body) blocks.push(body);
  }
  return blocks.join("\n\n");
}

/** 由一筆訪視組出照護紀錄導出的全部文字。 */
export function careRecordData(visit: Visit, patient: Patient, settings: Settings, now = new Date()): CareRecordData {
  const { start, end } = visitTime(visit);
  const height = patient.heightCm ?? "";
  const body = visit.body ?? {};
  const nurse = settings.nurseName || "護理師";
  const plan = visit.outputs.plan;
  const edu = visit.outputs.edu;
  const from = addDays(visit.date, -EVENT_WINDOW_DAYS);
  return {
    title: "照護紀錄",
    clinicName: settings.clinicName || "",
    patientName: patient.name,
    intakeDate: patient.intakeDate ?? patient.createdAt.slice(0, 10),
    main: {
      visitDateTime: `${visit.date}${start ? `，${start}${end ? `～${end}` : ""}` : ""}`,
      source: visit.source ?? "家訪",
      height: withUnit(height, "cm"),
      weight: withUnit(body.weightKg, "kg"),
      bmi: bmiOf(height, body.weightKg),
      mac: withUnit(body.macCm, "cm"),
      calf: withUnit(body.calfCm, "cm"),
      residence: patient.residence ?? "",
      area: patient.area ?? "",
      resource: patient.resource ?? "",
      serviceItems: serviceItemsFor(visit, patient).join("、"),
      record: recordText(visit),
      recorder: visit.outputs.record.confirmedBy ?? nurse,
    },
    vitals: visit.intakeOnly ? null : vitalsRow(visit),
    admissions: eventRows(patient, visit, "admission"),
    erVisits: eventRows(patient, visit, "er"),
    eventRange: `${from} 至 ${visit.date}`,
    plan: plan.versions.length
      ? { version: `第 ${planVersionFor(visit, patient)} 版${plan.confirmedAt ? `（${plan.confirmedAt.slice(0, 10)} 確認）` : ""}`, text: docBody("plan", visit, settings), confirmedBy: plan.confirmedBy ?? nurse }
      : null,
    edu: edu.versions.length ? { text: docBody("edu", visit, settings), confirmedBy: edu.confirmedBy ?? nurse } : null,
    exporter: nurse,
    exportedAt: exportStamp(now),
    demo: TRIAL || patient.isDemo || visit.analysisMeta?.mode === "demo",
  };
}

/** 檔名用遮罩後的姓名（檔名會出現在聊天室與檔案清單）；內文仍是全名。 */
export function careRecordFilename(visit: Visit, patient: Patient): string {
  return `照護紀錄_${maskName(patient.name)}_${visit.date}.pdf`;
}

/** 導出前要補的欄位（不擋導出，只提醒）。 */
export function missingFields(visit: Visit, patient: Patient, settings: Settings): string[] {
  const miss: string[] = [];
  if (!settings.clinicName) miss.push("機構名稱");
  if (!patient.heightCm) miss.push("身高");
  if (!visit.body?.weightKg) miss.push("體重");
  if (!patient.residence) miss.push("居住所");
  if (!patient.area) miss.push("居住區域");
  if (!patient.resource) miss.push("使用資源");
  return miss;
}
