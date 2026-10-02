import { VITAL_LABEL, VITAL_UNIT, type Analysis, type VitalKey, type VitalReading } from "../../shared/types";
import type { ResolvedVital, Settings, Visit } from "./model";

export const VITAL_ORDER: Record<Settings["vitalsOrder"], VitalKey[]> = {
  standard: ["temp", "pulse", "resp", "bp", "spo2", "glucose", "consciousness"],
  line: ["temp", "bp", "pulse", "spo2", "resp", "consciousness", "glucose"],
};

const RANGES: Partial<Record<VitalKey, [number, number]>> = {
  temp: [34, 42],
  pulse: [30, 200],
  resp: [6, 60],
  spo2: [50, 100],
  glucose: [20, 600],
};

/** 數值是否在合理範圍（不合理代表多半是聽錯或打錯）。 */
export function plausible(key: VitalKey, value: string): boolean {
  if (key === "consciousness") return value.trim().length > 0;
  if (key === "bp") {
    const m = value.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!m) return false;
    const s = Number(m[1]);
    const d = Number(m[2]);
    return s >= 60 && s <= 260 && d >= 30 && d <= 160 && s > d;
  }
  const n = Number(value);
  const r = RANGES[key];
  return Number.isFinite(n) && !!r && n >= r[0] && n <= r[1];
}

export function clinicalFlag(key: VitalKey, value: string, qualifier: string | null): "high" | "low" | null {
  if (key === "bp") {
    const m = value.match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!m) return null;
    const s = Number(m[1]);
    const d = Number(m[2]);
    if (s >= 140 || d >= 90) return "high";
    if (s < 90) return "low";
    return null;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  switch (key) {
    case "temp":
      return n >= 37.5 ? "high" : n < 35.5 ? "low" : null;
    case "pulse":
      return n > 100 ? "high" : n < 60 ? "low" : null;
    case "resp":
      return n > 24 ? "high" : n < 12 ? "low" : null;
    case "spo2":
      return n < 94 ? "low" : null;
    case "glucose": {
      const fasting = qualifier?.includes("飯前") || qualifier?.includes("空腹");
      if (n < 70) return "low";
      return n >= (fasting ? 130 : 180) ? "high" : null;
    }
    default:
      return null;
  }
}

/** 由分析結果與護理師輸入，建立初始的數值狀態（手動值永遠勝過語音）。 */
export function initialVitals(analysis: Analysis, typed: Visit["typedVitals"], typedQ: Visit["typedQualifiers"]) {
  const out: Partial<Record<VitalKey, ResolvedVital>> = {};
  for (const r of analysis.vitals) {
    out[r.key] = {
      value: r.value,
      qualifier: r.qualifier,
      by: "ai",
      confirmed: r.status === "ok",
    };
  }
  for (const [k, v] of Object.entries(typed) as [VitalKey, string][]) {
    if (!v) continue;
    out[k] = { value: v, qualifier: typedQ[k] ?? out[k]?.qualifier ?? null, by: "nurse", confirmed: true };
  }
  return out;
}

/** 需要護理師處理的數值（先看這裡），低信心排前。 */
export function pendingVitals(visit: Visit): VitalReading[] {
  if (!visit.analysis) return [];
  return visit.analysis.vitals
    .filter((r) => r.status !== "ok")
    .filter((r) => {
      const res = visit.vitals[r.key];
      return !res || (!res.confirmed && res.by === "ai");
    })
    .sort((a, b) => a.confidence - b.confidence);
}

export function readingOf(visit: Visit, key: VitalKey): VitalReading | undefined {
  return visit.analysis?.vitals.find((r) => r.key === key);
}

export function formatVital(key: VitalKey, value: string, qualifier: string | null): string {
  const unit = VITAL_UNIT[key];
  const body = key === "consciousness" ? value : `${value}${unit === "%" || unit === "℃" ? "" : " "}${unit}`;
  const q = qualifier ? `（${qualifier}）` : "";
  if (key === "glucose" && qualifier) return `${qualifier}血糖 ${value} ${unit}`;
  return `${VITAL_LABEL[key]} ${body}${q}`;
}

/** 輸出文件中的生命徵象行：由已確認數值組成，AI 不重寫數字。 */
export function vitalsLine(visit: Visit, order: VitalKey[]): string | null {
  const parts: string[] = [];
  for (const key of order) {
    const v = visit.vitals[key];
    if (!v || v.value === null) continue;
    parts.push(formatVital(key, v.value, v.qualifier));
  }
  const notMeasured = order.filter((k) => visit.vitals[k] && visit.vitals[k]!.value === null).map((k) => VITAL_LABEL[k]);
  if (parts.length === 0 && notMeasured.length === 0) return null;
  let line = `生命徵象：${parts.join("、")}`;
  if (notMeasured.length) line += `${parts.length ? "；" : ""}本次未測：${notMeasured.join("、")}`;
  return `${line}。`;
}

export function confirmedVitalList(visit: Visit) {
  return (Object.entries(visit.vitals) as [VitalKey, ResolvedVital][])
    .filter(([, v]) => v.value !== null)
    .map(([key, v]) => ({ key, value: v.value as string, qualifier: v.qualifier }));
}
