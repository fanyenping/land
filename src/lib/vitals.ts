import { computeFlag, isPlausible } from "../../shared/clinical";
import { VITAL_LABEL, VITAL_UNIT, type Analysis, type VitalKey, type VitalReading } from "../../shared/types";
import type { ResolvedVital, Settings, Visit } from "./model";

export const VITAL_ORDER: Record<Settings["vitalsOrder"], VitalKey[]> = {
  standard: ["temp", "pulse", "resp", "bp", "spo2", "glucose", "consciousness"],
  line: ["temp", "bp", "pulse", "spo2", "resp", "consciousness", "glucose"],
};

/** 數值是否在合理範圍（不合理多半是聽錯或打錯）；門檻與伺服器共用 shared/clinical。 */
export function plausible(key: VitalKey, value: string): boolean {
  return isPlausible(key, value);
}

export function clinicalFlag(key: VitalKey, value: string, qualifier: string | null): "high" | "low" | null {
  return computeFlag(key, value, qualifier);
}

/** 由分析結果與護理師輸入，建立初始的數值狀態（手動值永遠勝過語音）。 */
export function initialVitals(analysis: Analysis, typed: Visit["typedVitals"], typedQ: Visit["typedQualifiers"]) {
  const out: Partial<Record<VitalKey, ResolvedVital>> = {};
  for (const r of analysis.vitals) {
    const prev = out[r.key];
    if (prev && prev.value && r.value) {
      // 同一次訪視的復測（例：拍痰後血氧）併入附註，主值保留第一次量測；復測不確定時整項待確認。
      const unit = VITAL_UNIT[r.key];
      const again = `${r.qualifier ?? "復測"} ${r.value}${unit === "%" || unit === "℃" ? unit : ` ${unit}`}`;
      out[r.key] = { ...prev, qualifier: prev.qualifier ? `${prev.qualifier}，${again}` : again, confirmed: prev.confirmed && r.status === "ok" };
      continue;
    }
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

/** 需要護理師處理的數值（先看這裡），每項一筆、低信心排前。 */
export function pendingVitals(visit: Visit): VitalReading[] {
  if (!visit.analysis) return [];
  const seen = new Set<VitalKey>();
  return visit.analysis.vitals
    .filter((r) => r.status !== "ok")
    .filter((r) => {
      const res = visit.vitals[r.key];
      return !res || (!res.confirmed && res.by === "ai");
    })
    .sort((a, b) => a.confidence - b.confidence)
    .filter((r) => !seen.has(r.key) && !!seen.add(r.key));
}

export function readingOf(visit: Visit, key: VitalKey): VitalReading | undefined {
  return visit.analysis?.vitals.find((r) => r.key === key);
}

const MEAL = /^(飯前|飯後|餐前|餐後|空腹|睡前|隨機)(?:[，,、\s]+(.+))?$/;

export function formatVital(key: VitalKey, value: string, qualifier: string | null): string {
  const unit = VITAL_UNIT[key];
  const body = key === "consciousness" ? value : `${value}${unit === "%" || unit === "℃" ? "" : " "}${unit}`;
  // 血糖的用餐時機放前面（飯前血糖 128 mg/dL），其他附註一律放括號。
  const meal = key === "glucose" && qualifier ? qualifier.match(MEAL) : null;
  if (meal) return `${meal[1]}血糖 ${value} ${unit}${meal[2] ? `（${meal[2]}）` : ""}`;
  const q = qualifier ? `（${qualifier}）` : "";
  return `${VITAL_LABEL[key]} ${body}${q}`;
}

/** 輸出文件中的生命徵象行：由已確認數值組成，AI 不重寫數字。 */
export function vitalsLine(visit: Visit, order: VitalKey[]): string | null {
  const parts: string[] = [];
  for (const key of order) {
    const v = visit.vitals[key];
    if (!v || v.value === null) continue;
    const pending = !v.confirmed && v.by === "ai";
    parts.push(formatVital(key, v.value, v.qualifier) + (pending ? "（待確認）" : ""));
  }
  const notMeasured = order.filter((k) => visit.vitals[k] && visit.vitals[k]!.value === null).map((k) => VITAL_LABEL[k]);
  if (parts.length === 0 && notMeasured.length === 0) return null;
  let line = `生命徵象：${parts.join("、")}`;
  if (notMeasured.length) line += `${parts.length ? "；" : ""}本次未測：${notMeasured.join("、")}`;
  return `${line}。`;
}

/** 只送出護理師確認過（或語音判讀可信）的數值；待確認的不給 AI 也不寫入上次紀錄。 */
export function confirmedVitalList(visit: Visit) {
  return (Object.entries(visit.vitals) as [VitalKey, ResolvedVital][])
    .filter(([, v]) => v.confirmed && v.value !== null)
    .map(([key, v]) => ({ key, value: v.value as string, qualifier: v.qualifier }));
}
