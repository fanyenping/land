/**
 * 三份輸出的固定模板（規格 §8）：段落標題、固定句、衛教常數與日期格式。
 * 伺服器的提示詞、輸出檢核與示範引擎共用這一份，前端也可以直接引用。
 */
import type { DocKind, TranslateLang } from "./types";

/** 提示詞與模板版本（設定頁「Prompt 2026.10-3」、版本紀錄都引用這個值）。 */
export const PROMPT_VERSION = "2026.10-3";

/* ------------------------------ 護理紀錄 ------------------------------ */

export const RECORD_HEADINGS = [
  "一、今日護理事項及照護重點",
  "二、異常值提醒",
  "三、管路與傷口（含注射及輸液）",
  "四、總結與後續追蹤",
] as const;

export const RECORD_NARRATIVE_HEADING = "訪視紀錄";

/** 收案紀錄（依文件整理）：最前面另有一段無標題的「資料來源：…」。 */
export const INTAKE_HEADINGS = [
  "一、個案背景與照護需求",
  "二、疾病與用藥重點（依文件照錄）",
  "三、管路與傷口（依文件）",
  "四、首次訪視應確認事項",
] as const;

export const VITALS_NORMAL_SENTENCE = "本次生命徵象未見異常。";
export const NOT_ASSESSED_SENTENCE = "本次未評估。";

/* ------------------------------ 護理計畫 ------------------------------ */

/** 最前面另有一段無標題的「依據：…」。 */
export const PLAN_HEADINGS = [
  "一、評估摘要",
  "二、疾病診斷與異常值",
  "三、護理問題與計畫",
  "四、病人與家庭參與",
  "五、整體評值與調整",
] as const;

export const PLAN_MAX_PROBLEMS = 5;
export type PlanProblemTag = "沿用" | "調整" | "本次新增";

/* ------------------------------ 家屬衛教 ------------------------------ */

/** 開場（無標題）→ 一 → 二 →（有管路時）管路照護 → 三 → 固定結語（無標題）。署名由前端依設定加上。 */
export const EDU_HEADINGS = {
  attention: "一、今天要注意的事",
  daily: "二、每天可以這樣照顧",
  tubes: "管路照護",
  redFlags: "三、出現這些情況，請馬上聯絡護理師或就醫",
} as const;

/** 衛教固定結語（CV C4，一字不改）。 */
export const EDU_CLOSING = "有任何不清楚的衛教內容，歡迎與專業醫療團隊成員請教跟討論。";

export const EDU_MAX_CHARS = 400;
export const EDU_MAX_SENTENCE_CHARS = 25;

/** 機構核可的衛教常數（衛教中的數字只能來自本次事實或這份清單）。 */
export const EDU_CONSTANTS = [
  "每 2 小時翻身一次",
  "發燒超過 38 度",
  "床頭搖高 30～45 度",
  "灌食後坐 30 分鐘再躺下",
  "抽痰前先拍背，每邊 3～5 分鐘",
] as const;

/** 管路衛教標準句（有該管路時可直接引用）。 */
export const TUBE_CARE_STANDARD: Record<string, readonly string[]> = {
  鼻胃管: ["每次灌食前先反抽，確認管子在胃裡。", "鼻胃管滑出來時，請不要自己放回去。"],
  尿管: ["尿袋要放得比肚子低，不要壓到管子。", "尿變得很混濁、有血，或沒有尿流出來，請聯絡護理師。"],
  氣切管: ["氣切口周圍保持乾淨乾燥。", "管子滑脫或呼吸很喘，請馬上聯絡護理師。"],
};

/** 衛教中不用縮寫與醫學術語（規格 §8.3、§7.10 用語表）。 */
export const EDU_PLAIN_WORDS: [RegExp, string][] = [
  [/\bNG\b(?:\s*tube)?/gi, "鼻胃管"],
  [/\bFoley\b/gi, "尿管"],
  [/導尿管/g, "尿管"],
  [/\bSugar\b/gi, "血糖"],
  [/薦骨/g, "屁股尾椎附近"],
];

/* ------------------------------ 翻譯 ------------------------------ */

export const TRANSLATION_PREFIX: Record<TranslateLang, string> = {
  id: "【Bahasa Indonesia｜AI 翻譯，供照顧者參考】",
  vi: "【Tiếng Việt｜AI 翻譯，供照顧者參考】",
  th: "【ภาษาไทย｜AI 翻譯，供照顧者參考】",
};

/* ------------------------------ 共用 ------------------------------ */

/** 輸出用語替換（§7.10）。 */
export const TERM_REPLACEMENTS: [RegExp, string][] = [
  [/護理診斷/g, "護理問題"],
  [/護理摘要/g, "訪視紀錄"],
  [/疾病史/g, "過去病史"],
  [/過去過去病史/g, "過去病史"],
  [/鼻飼管/g, "鼻胃管"],
  [/(\d)\s*(?:西西|c\.c\.|cc|CC)(?![A-Za-z])/g, "$1 毫升"],
  [/西西/g, "毫升"],
  [/醫保/g, "健保"],
  [/信息/g, "資訊"],
];

export function sectionHeadingsFor(kind: DocKind, opts: { recordStyle: "four" | "narrative"; intakeOnly: boolean }): readonly string[] {
  if (kind === "plan") return PLAN_HEADINGS;
  if (kind === "edu") return Object.values(EDU_HEADINGS);
  if (opts.intakeOnly) return INTAKE_HEADINGS;
  return opts.recordStyle === "narrative" ? [RECORD_NARRATIVE_HEADING] : RECORD_HEADINGS;
}

/* ------------------------------ 日期 ------------------------------ */

const ISO = /^(\d{4})-(\d{2})-(\d{2})/;

/** "2026-10-02" → "2026/10/02"；無法解析時原樣回傳。 */
export function slashDate(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[1]}/${m[2]}/${m[3]}` : iso;
}

/** "2026-09-18" → "09/18" */
export function shortDate(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${m[2]}/${m[3]}` : iso;
}

/** "2026-11-01" → "11 月 1 日"（給家屬看的寫法） */
export function plainDate(iso: string): string {
  const m = ISO.exec(iso);
  return m ? `${Number(m[2])} 月 ${Number(m[3])} 日` : iso;
}

export function addDays(iso: string, days: number): string | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days));
  return d.toISOString().slice(0, 10);
}

const WEEKDAY = ["日", "一", "二", "三", "四", "五", "六"];

export function weekday(iso: string): string | null {
  const m = ISO.exec(iso);
  if (!m) return null;
  return WEEKDAY[new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()];
}

/** 機構預設的管路更換頻率（天）；未列出的管路不推算。 */
export const TUBE_INTERVAL_DAYS: [RegExp, number][] = [
  [/鼻胃管/, 30],
  [/導尿管|尿管/, 30],
];

export function tubeIntervalDays(name: string): number | null {
  for (const [re, days] of TUBE_INTERVAL_DAYS) if (re.test(name)) return days;
  return null;
}

/* ------------------------------ 組合 ------------------------------ */

/**
 * 「二、異常值提醒」：程式產生的數值句在前，AI 寫的非數值異常在後，統一編號。
 * 沒有數值異常、且所有數值都已確認時，以「本次生命徵象未見異常。」開頭（N4：由程式判斷，不由 AI 判斷）。
 */
export function composeAlertBody(
  vitalLines: string[],
  otherLines: string[],
  status: { confirmedNumeric: number; pending: number },
): string {
  const items = [...vitalLines, ...otherLines].map((l, i) => `${i + 1}. ${l}`);
  if (vitalLines.length === 0) {
    if (status.pending === 0 && status.confirmedNumeric > 0) return [VITALS_NORMAL_SENTENCE, ...items].join("\n");
    if (items.length === 0) return status.pending > 0 ? "生命徵象尚待護理師確認。" : NOT_ASSESSED_SENTENCE;
  }
  return items.join("\n");
}

export interface PlanProblem {
  title: string;
  tag: PlanProblemTag | null;
  basis: string | null;
  goal: string | null;
  measures: string[];
}

const PROBLEM_LINE = /^\s*(?:護理)?問題\s*(\d+)\s*[：:]\s*(.+?)\s*$/;
const TAG_SUFFIX = /\s*（(沿用|調整|本次新增)）\s*$/;
const SECTION_LINE = /^\s*[一二三四五六七八九十]、/;

function splitMeasures(text: string): string[] {
  return text
    .split(/\(\d+\)\s*/)
    .map((m) => m.trim())
    .filter(Boolean);
}

/** 解析現行護理計畫的問題、目標與措施（相容舊版「護理問題 n：」與 §8.2 的「問題 n：…（沿用）」）。 */
export function parsePlanProblems(text: string | null): PlanProblem[] {
  if (!text) return [];
  const problems: PlanProblem[] = [];
  let cur: PlanProblem | null = null;
  let inMeasures = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s　]+/, "").trimEnd();
    const head = PROBLEM_LINE.exec(line);
    if (head) {
      const tag = TAG_SUFFIX.exec(head[2]);
      cur = { title: head[2].replace(TAG_SUFFIX, ""), tag: (tag?.[1] as PlanProblemTag) ?? null, basis: null, goal: null, measures: [] };
      problems.push(cur);
      inMeasures = false;
      continue;
    }
    if (!cur) continue;
    if (SECTION_LINE.test(line)) {
      cur = null;
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = /^(?:相關因素|依據)[：:]\s*(.*)$/.exec(line))) {
      cur.basis = m[1] || null;
      inMeasures = false;
    } else if ((m = /^(?:護理)?目標[：:]\s*(.*)$/.exec(line))) {
      cur.goal = m[1] || null;
      inMeasures = false;
    } else if ((m = /^(?:護理)?措施[：:]\s*(.*)$/.exec(line))) {
      cur.measures.push(...splitMeasures(m[1]));
      inMeasures = true;
    } else if ((m = /^調整[：:]\s*(.*)$/.exec(line))) {
      // 「調整：新增措施 (4) …」：新增的措施下一版沿用
      const added = m[1].slice(m[1].search(/\(\d+\)/));
      if (/\(\d+\)/.test(m[1])) cur.measures.push(...splitMeasures(added));
      inMeasures = false;
    } else if (inMeasures && (m = /^(?:\d+[.、．]|\(\d+\))\s*(.+)$/.exec(line))) {
      cur.measures.push(m[1].trim());
    } else {
      inMeasures = false;
    }
  }
  return problems;
}
