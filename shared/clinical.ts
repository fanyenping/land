/**
 * 生命徵象與身分的決定性檢核（規格 §7.7 C2–C11），不呼叫 AI。
 * 純 TypeScript、無 Node 依賴：伺服器檢核、示範引擎與前端共用。
 */
import {
  VITAL_LABEL,
  type AssessmentChange,
  type PatientContext,
  type PreviousVisit,
  type VitalKey,
  type VitalReading,
  type VitalStatus,
} from "./types";
import { shortDate, slashDate } from "./templates";

export type NumericVitalKey = Exclude<VitalKey, "consciousness">;
type Range = readonly [number, number];

/** 生理合理範圍（機構可調）。 */
export const PLAUSIBLE_RANGE: Record<Exclude<NumericVitalKey, "bp">, Range> & { sbp: Range; dbp: Range } = {
  temp: [34, 42],
  pulse: [30, 200],
  resp: [6, 50],
  spo2: [50, 100],
  glucose: [20, 600],
  sbp: [60, 250],
  dbp: [30, 150],
};

/** 成人臨床異常門檻（機構可調）。 */
export const FLAG_THRESHOLD = {
  temp: { high: 37.5, low: 35.5 },
  pulse: { high: 100, low: 60 },
  resp: { high: 24, low: 12 },
  sbp: { high: 140, low: 90 },
  dbp: { high: 90 },
  spo2: { low: 95 },
  glucose: { fastingHigh: 130, otherHigh: 180, low: 70 },
} as const;

/** 與上次確認值相比的大幅變化（C9）。 */
export const DELTA_THRESHOLD = { temp: 1.0, pulse: 25, sbp: 30, spo2Drop: 4, glucose: 80 } as const;

/** 低於此值的 AI 信心一律待確認（§6.3）。 */
export const MIN_VITAL_CONFIDENCE = 0.8;

const UNIT_SUFFIX = /\s*(℃|°C|°c|度|%|％|趴|mmHg|mmhg|mg\/dL|mg\/dl|次\/分鐘?|次|下|bpm|\/min)\s*$/;

/** 正規化數值文字：全形轉半形、去單位與空白；意識照原文。 */
export function normalizeVitalValue(key: VitalKey, raw: string): string {
  const s = raw.trim();
  if (key === "consciousness") return s;
  let v = s.replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0)).replace(/[．]/g, ".").replace(/[／]/g, "/");
  for (let i = 0; i < 2; i++) v = v.replace(UNIT_SUFFIX, "");
  return v.replace(/\s+/g, "");
}

/** 解析數值：血壓回傳 [收縮壓, 舒張壓]，其他回傳 [值]；無法解析回傳 null。 */
export function parseVital(key: VitalKey, value: string): number[] | null {
  if (key === "consciousness") return null;
  const v = normalizeVitalValue(key, value);
  if (key === "bp") {
    const m = /^(\d{2,3})\/(\d{2,3})$/.exec(v);
    return m ? [Number(m[1]), Number(m[2])] : null;
  }
  return /^\d{1,3}(\.\d+)?$/.test(v) ? [Number(v)] : null;
}

const RANGE_TEXT: Record<Exclude<NumericVitalKey, "bp">, string> = {
  temp: "34–42℃",
  pulse: "30–200 次/分",
  resp: "6–60 次/分",
  spo2: "50–100%",
  glucose: "20–600 mg/dL",
};

const inRange = (n: number, [lo, hi]: Range) => n >= lo && n <= hi;

/** 合理範圍檢核（C3）：通過回傳 null，否則回傳原因。 */
export function plausibilityReason(key: VitalKey, value: string): string | null {
  if (key === "consciousness") return null;
  const n = parseVital(key, value);
  if (!n) return "數值格式無法辨識";
  if (key === "bp") {
    const [s, d] = n;
    if (!inRange(s, PLAUSIBLE_RANGE.sbp) || !inRange(d, PLAUSIBLE_RANGE.dbp)) {
      return "不在合理範圍（收縮壓 60–260、舒張壓 30–160 mmHg）";
    }
    return s > d ? null : "收縮壓應高於舒張壓";
  }
  return inRange(n[0], PLAUSIBLE_RANGE[key]) ? null : `不在 ${RANGE_TEXT[key]} 合理範圍`;
}

export const isPlausible = (key: VitalKey, value: string) => plausibilityReason(key, value) === null;

const isFasting = (q: string | null) => !!q && /飯前|空腹|餐前/.test(q);

/** 臨床判讀（C10）：偏高／偏低，與 AI 狀態是兩條通道；不合理或無法解析時為 null。 */
export function computeFlag(key: VitalKey, value: string, qualifier: string | null): "high" | "low" | null {
  if (key === "consciousness" || !isPlausible(key, value)) return null;
  const n = parseVital(key, value)!;
  const t = FLAG_THRESHOLD;
  switch (key) {
    case "temp":
      return n[0] >= t.temp.high ? "high" : n[0] < t.temp.low ? "low" : null;
    case "pulse":
      return n[0] > t.pulse.high ? "high" : n[0] < t.pulse.low ? "low" : null;
    case "resp":
      return n[0] > t.resp.high ? "high" : n[0] < t.resp.low ? "low" : null;
    case "bp":
      return n[0] >= t.sbp.high || n[1] >= t.dbp.high ? "high" : n[0] < t.sbp.low ? "low" : null;
    case "spo2":
      return n[0] < t.spo2.low ? "low" : null;
    case "glucose": {
      const high = isFasting(qualifier) ? t.glucose.fastingHigh : t.glucose.otherHigh;
      return n[0] >= high ? "high" : n[0] < t.glucose.low ? "low" : null;
    }
  }
}

/**
 * 唯一候選值（C8）：依已知辨識錯誤樣式（首位數字遺失或聽錯，例：16.8 → 36.8），
 * 只有恰好一個候選落在合理範圍時才回傳。
 */
export function candidateCorrection(key: VitalKey, value: string): string | null {
  if (key === "consciousness" || key === "bp") return null;
  const v = normalizeVitalValue(key, value);
  const m = /^(\d{1,3})(\.\d+)?$/.exec(v);
  if (!m) return null;
  const [, int, frac = ""] = m;
  const options = new Set<string>();
  for (let d = 1; d <= 9; d++) {
    options.add(`${d}${int}${frac}`); // 首位遺失：6.8 → 36.8
    if (int.length >= 2) options.add(`${d}${int.slice(1)}${frac}`); // 首位聽錯：16.8 → 36.8
  }
  options.delete(v);
  const ok = [...options].filter((c) => !c.startsWith("0") && isPlausible(key, c));
  return ok.length === 1 ? ok[0] : null;
}

/* --------------------------- 中文數字（C2 雙讀） --------------------------- */

const CN_DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };

function parseCnInteger(s: string): number | null {
  if (!s) return null;
  if (![...s].some((c) => c in CN_UNIT)) {
    // 逐字念法：「一六」→ 16
    let n = 0;
    for (const c of s) {
      if (!(c in CN_DIGIT)) return null;
      n = n * 10 + CN_DIGIT[c];
    }
    return n;
  }
  let total = 0;
  let digit: number | null = null;
  let lastUnit = 0;
  let afterUnit = false;
  for (const c of s) {
    if (c in CN_DIGIT) {
      afterUnit = digit === null && lastUnit > 0 && CN_DIGIT[c] !== 0 && !s.includes("零");
      digit = CN_DIGIT[c];
    } else if (c in CN_UNIT) {
      total += (digit ?? 1) * CN_UNIT[c];
      lastUnit = CN_UNIT[c];
      digit = null;
    } else return null;
  }
  // 口語省略：「一百六」＝160、「兩千五」＝2500（「一百零八」不適用）
  if (digit !== null) total += afterUnit && lastUnit >= 100 ? digit * (lastUnit / 10) : digit;
  return total;
}

/** 擷取文字中的所有數字（阿拉伯數字與中文數字，含「點」的小數）。 */
export function numbersInText(text: string): number[] {
  const out: number[] = [];
  const re = /\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百千]+(?:點[零〇一二三四五六七八九]+)?/g;
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    if (/^\d/.test(tok)) {
      out.push(Number(tok));
      continue;
    }
    const [intPart, fracPart] = tok.split("點");
    const int = parseCnInteger(intPart);
    if (int === null) continue;
    if (fracPart) {
      const frac = [...fracPart].map((c) => CN_DIGIT[c]).join("");
      out.push(Number(`${int}.${frac}`));
    } else out.push(int);
  }
  return out;
}

/** 數值是否出現在原句的數字索引中（C2）。 */
export function valueInQuote(key: VitalKey, value: string, quote: string): boolean {
  const parts = parseVital(key, value);
  if (!parts) return false;
  const found = numbersInText(quote);
  return parts.every((p) => found.some((f) => Math.abs(f - p) < 1e-9));
}

/* ------------------------------ 數值檢核 ------------------------------ */

const STATUS_RANK: Record<VitalStatus, number> = { ok: 0, uncertain: 1, conflict: 2, implausible: 3 };

/** 只升級不降級：檢核只會讓狀態更嚴格。 */
export function escalate(r: VitalReading, status: VitalStatus, reason: string): void {
  if (STATUS_RANK[status] > STATUS_RANK[r.status]) {
    r.status = status;
    r.reason = reason;
  } else if (r.status !== "ok" && !r.reason) {
    r.reason = reason;
  }
}

export interface VitalCheckOptions {
  /** 低信心字詞比例過高或瀏覽器聽寫等高風險來源（C6）：所有數值待確認。 */
  highRiskSource?: boolean;
}

export const TYPED_SOURCE_QUOTE = "護理師手動輸入";

/**
 * 對 AI（或示範）擷取的數值做決定性檢核，並以手動值覆蓋（C2、C3、C6、C7、C8、C10、C12）。
 * 回傳新陣列，不改動輸入。
 */
export function finalizeVitals(
  input: VitalReading[],
  typed: Partial<Record<VitalKey, string>>,
  opts: VitalCheckOptions = {},
): VitalReading[] {
  const readings = input.map((r) => ({ ...r, value: normalizeVitalValue(r.key, r.value) }));

  for (const r of readings) {
    r.confidence = Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0;
    if (r.key === "consciousness") {
      if (!r.sourceQuote) escalate(r, "uncertain", "找不到原句");
      continue;
    }
    const implausible = plausibilityReason(r.key, r.value);
    if (implausible) {
      escalate(r, "implausible", implausible);
      r.reason = implausible;
      r.suggestion = candidateCorrection(r.key, r.value);
    } else if (r.suggestion !== null && !isPlausible(r.key, r.suggestion)) {
      r.suggestion = null;
    }
    if (!r.sourceQuote) escalate(r, "uncertain", "找不到原句");
    else if (!valueInQuote(r.key, r.value, r.sourceQuote)) escalate(r, "uncertain", "原句中找不到這個數值，請核對");
    if (r.confidence < MIN_VITAL_CONFIDENCE) escalate(r, "uncertain", "語音辨識信心偏低");
    if (opts.highRiskSource) escalate(r, "uncertain", "這次錄音辨識品質較差，請特別注意數值");
  }

  // C7：同一項多個不同值，且沒有復測線索（qualifier）→ 衝突
  const byKey = new Map<VitalKey, VitalReading[]>();
  for (const r of readings) if (r.key !== "consciousness") byKey.set(r.key, [...(byKey.get(r.key) ?? []), r]);
  for (const group of byKey.values()) {
    if (group.length < 2 || new Set(group.map((r) => r.value)).size < 2) continue;
    const ordered = [...group].sort((a, b) => (a.sourceMs ?? 0) - (b.sourceMs ?? 0));
    if (ordered.slice(1).some((r) => !r.qualifier)) {
      for (const r of group) escalate(r, "conflict", "同一次訪視出現不同數值，未見復測線索，請選擇或兩次都記");
    }
  }

  for (const r of readings) {
    if (r.status === "ok") {
      r.suggestion = null;
      r.reason = null;
    }
    r.flag = r.status === "implausible" ? null : computeFlag(r.key, r.value, r.qualifier);
  }

  // C12：手動值永遠勝過語音
  const result: VitalReading[] = [];
  const done = new Set<VitalKey>();
  for (const r of readings) {
    const t = typed[r.key];
    if (t === undefined || !t.trim()) {
      result.push(r);
      continue;
    }
    if (done.has(r.key)) continue;
    done.add(r.key);
    result.push(typedReading(r.key, t, readings));
  }
  for (const [key, t] of Object.entries(typed) as [VitalKey, string | undefined][]) {
    if (t?.trim() && !done.has(key)) result.push(typedReading(key, t, readings));
  }
  return result;
}

function typedReading(key: VitalKey, raw: string, audio: VitalReading[]): VitalReading {
  const value = normalizeVitalValue(key, raw);
  const same = audio.filter((r) => r.key === key);
  const qualifier = (same.find((r) => r.value === value) ?? (same.length === 1 ? same[0] : undefined))?.qualifier ?? null;
  return {
    key,
    value,
    qualifier,
    sourceQuote: TYPED_SOURCE_QUOTE,
    sourceMs: null,
    confidence: 1,
    status: "ok",
    suggestion: null,
    reason: null,
    flag: computeFlag(key, value, qualifier),
  };
}

/* ------------------------------ 顯示格式（K3） ------------------------------ */

/** 依 K3：`142/86 mmHg`、`88 次/分`、`36.3℃`、`96%`、`168 mg/dL`。 */
export function formatVitalValue(key: VitalKey, value: string): string {
  const v = normalizeVitalValue(key, value);
  switch (key) {
    case "temp":
      return `${v}℃`;
    case "spo2":
      return `${v}%`;
    case "pulse":
    case "resp":
      return `${v} 次/分`;
    case "bp":
      return `${v} mmHg`;
    case "glucose":
      return `${v} mg/dL`;
    default:
      return v;
  }
}

/** 「飯前血糖」「血氧」：血糖帶飯前／飯後，其他用一般名稱。 */
export function vitalLabel(key: VitalKey, qualifier: string | null): string {
  if (key === "glucose" && qualifier) {
    const m = /飯前|飯後|空腹|睡前|隨機/.exec(qualifier);
    if (m) return `${m[0]}血糖`;
  }
  return VITAL_LABEL[key];
}

export interface ConfirmedVital {
  key: VitalKey;
  value: string;
  qualifier: string | null;
}

function previousMatch(key: VitalKey, qualifier: string | null, previous: PreviousVisit | null | undefined) {
  const same = previous?.vitals.filter((v) => v.key === key) ?? [];
  if (key === "glucose") return same.find((v) => isFasting(v.qualifier) === isFasting(qualifier)) ?? null;
  return same[0] ?? null;
}

function deltaExceeded(key: NumericVitalKey, now: number[], before: number[]): boolean {
  const d = DELTA_THRESHOLD;
  switch (key) {
    case "temp":
      return Math.abs(now[0] - before[0]) >= d.temp;
    case "pulse":
      return Math.abs(now[0] - before[0]) >= d.pulse;
    case "bp":
      return Math.abs(now[0] - before[0]) >= d.sbp;
    case "spo2":
      return before[0] - now[0] >= d.spo2Drop;
    case "glucose":
      return Math.abs(now[0] - before[0]) >= d.glucose;
    default:
      return false;
  }
}

/**
 * 數值異常提醒句（規格 §8.1 二）：依確認值、門檻與上次確認值產生，不經 AI。
 * 例：「血壓 142/86 mmHg，較前次（09/18，132/78 mmHg）上升。」
 */
export function vitalAlertLines(confirmed: ConfirmedVital[], previous?: PreviousVisit | null): string[] {
  const lines: string[] = [];
  for (const v of confirmed) {
    if (v.key === "consciousness" || !isPlausible(v.key, v.value)) continue;
    const flag = computeFlag(v.key, v.value, v.qualifier);
    const prev = previousMatch(v.key, v.qualifier, previous);
    const now = parseVital(v.key, v.value)!;
    const before = prev && isPlausible(prev.key, prev.value) ? parseVital(prev.key, prev.value) : null;
    const big = before ? deltaExceeded(v.key, now, before) : false;
    if (!flag && !big) continue;
    const head = `${vitalLabel(v.key, v.qualifier)} ${formatVitalValue(v.key, v.value)}`;
    if (prev && before) {
      const dir = now[0] > before[0] ? "上升" : now[0] < before[0] ? "下降" : "相同";
      lines.push(`${head}，較前次（${shortDate(previous!.date)}，${formatVitalValue(prev.key, prev.value)}）${dir}。`);
    } else {
      lines.push(`${head}，${flag === "high" ? "偏高" : "偏低"}。`);
    }
  }
  return lines;
}

/** 計畫「二、疾病診斷與異常值」的異常值一行；沒有任何確認的數值時回傳 null。 */
export function abnormalValuesLine(confirmed: ConfirmedVital[], visitDate: string): string | null {
  const numeric = confirmed.filter((v) => v.key !== "consciousness" && isPlausible(v.key, v.value));
  if (numeric.length === 0) return null;
  const abnormal = numeric.filter((v) => computeFlag(v.key, v.value, v.qualifier));
  if (abnormal.length === 0) return "異常值：本次生命徵象未見異常。";
  const items = abnormal.map((v) => `${vitalLabel(v.key, v.qualifier)} ${formatVitalValue(v.key, v.value)}`);
  return `異常值：${slashDate(visitDate)} ${items.join("、")}。`;
}

/**
 * 與上次確認值比較的大幅變化（C9），列入評估異動。
 * 只比較狀態為 ok 的本次數值；AI 已經列出同一項時不重複。
 */
export function numericDeltaChanges(
  vitals: VitalReading[],
  previous: PreviousVisit | null | undefined,
  existing: AssessmentChange[],
): Omit<AssessmentChange, "id">[] {
  if (!previous) return [];
  const out: Omit<AssessmentChange, "id">[] = [];
  const seen = new Set<VitalKey>();
  for (const r of vitals) {
    if (r.key === "consciousness" || r.status !== "ok" || seen.has(r.key)) continue;
    seen.add(r.key);
    const prev = previousMatch(r.key, r.qualifier, previous);
    if (!prev || !isPlausible(prev.key, prev.value)) continue;
    const now = parseVital(r.key, r.value)!;
    const before = parseVital(prev.key, prev.value)!;
    if (!deltaExceeded(r.key, now, before)) continue;
    const label = vitalLabel(r.key, r.qualifier);
    if (existing.some((c) => c.text.includes(VITAL_LABEL[r.key]))) continue;
    const worse = r.key === "spo2" ? true : computeFlag(r.key, r.value, r.qualifier) !== null;
    out.push({
      kind: worse ? "worse" : "better",
      text: `${label}由 ${formatVitalValue(prev.key, prev.value)} 變為 ${formatVitalValue(r.key, r.value)}（較前次 ${shortDate(previous.date)}）`,
      evidence: r.sourceQuote,
    });
  }
  return out;
}

/* ------------------------------ 身分一致（C11） ------------------------------ */

const FEMALE_TERMS = /阿嬤|奶奶|外婆|阿婆/g;
const MALE_TERMS = /阿公|爺爺|外公|阿伯/g;

/** 逐字稿只用異性的稱謂稱呼個案時，回傳說明；否則 null。 */
export function identityConcernFromText(text: string, patient: PatientContext): string | null {
  if (!patient.gender) return null;
  const female = text.match(FEMALE_TERMS) ?? [];
  const male = text.match(MALE_TERMS) ?? [];
  if (patient.gender === "女" && male.length > 0 && female.length === 0) {
    return `錄音中稱個案為「${male[0]}」，但個案資料為女性，請確認是否為同一位個案。`;
  }
  if (patient.gender === "男" && female.length > 0 && male.length === 0) {
    return `錄音中稱個案為「${female[0]}」，但個案資料為男性，請確認是否為同一位個案。`;
  }
  return null;
}

/** 依序以 c1、c2… 補上缺漏或重複的 id。 */
export function ensureIds<T extends object>(items: T[], prefix: string): (T & { id: string })[] {
  const used = new Set<string>();
  let n = 0;
  return items.map((item) => {
    const raw = (item as { id?: unknown }).id;
    let id = typeof raw === "string" ? raw.trim() : "";
    if (!id || used.has(id)) {
      do id = `${prefix}${++n}`;
      while (used.has(id));
    }
    used.add(id);
    return { ...item, id };
  });
}
