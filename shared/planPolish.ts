/**
 * 護理計畫「護理師口述 → AI 只整理語句」的共用收尾（伺服器與本機／試用版示範引擎都跑這一份）：
 * 1. 依模板組成五段，最前面加「依據：護理師口述（日期）」；口述沒提到的段落寫「口述未提及。」。
 * 2. 對照口述原文：口述沒有的數字、英文用詞、量表分數／分期／風險等級標〔待核對〕（確認前要改掉）；
 *    看起來是新增或漏掉的句子只提醒。
 * 純 TypeScript、無 Node 依賴（前端也會打包）。
 */
import { numbersInText } from "./clinical";
import { PLAN_HEADINGS, slashDate } from "./templates";
import type { DocSection, GeneratedDoc, PolishPlanRequest } from "./types";

export const PLAN_DICTATION_MAX_CHARS = 6000;
export const NOT_MENTIONED_SENTENCE = "口述未提及。";
export const UNVERIFIED_MARK = "〔待核對〕";
export const POLISH_PROMPT_VERSION = "plan-polish-1";

/** 口語贅詞（連同後面的逗號與空白）。 */
export const FILLER_RE = /(?:嗯+|呃+|欸+|那個|然後呢?|就是說?|對啊|這樣子)[，、,\s]*/g;

/** 「依據：護理師口述（2026/10/03）」 */
export const dictationBasisLine = (visitDate: string) => `依據：護理師口述（${slashDate(visitDate)}）`;

export const hasUnverifiedText = (text: string) => text.includes(UNVERIFIED_MARK);

/* ============================== 口述正規化 ============================== */

const HOMOPHONES: [RegExp, string][] = [
  [/翻生/g, "翻身"],
  [/換要/g, "換藥"],
  [/雪糖/g, "血糖"],
];
const FULL_PUNCT: Record<string, string> = { ",": "，", ".": "。", ";": "；", ":": "：" };

/** 去贅詞、修常見同音錯字、半形標點轉全形（數字中間的除外）、句首的她／他改成「個案」、整理空白。 */
export function normalizeDictation(text: string): string {
  let t = text.replace(/\r\n?/g, "\n");
  t = t.replace(FILLER_RE, "");
  t = t.replace(/護理計畫我?來?口述一下[，。,.]?/g, "");
  for (const [re, to] of HOMOPHONES) t = t.replace(re, to);
  const s = t;
  t = s.replace(/[,.;:]/g, (ch, i: number) => (/\d/.test(s[i - 1] ?? "") && /\d/.test(s[i + 1] ?? "") ? ch : FULL_PUNCT[ch]));
  t = t.replace(/(^|[，。；\n])\s*[她他](?!們)/g, "$1個案");
  return t
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

/* ============================== 組成模板 ============================== */

const coreOf = (h: string) => h.replace(/^[一二三四五六七八九十]+、/, "").replace(/[\s（）()、，：:]/g, "");

/** 依模板標題對應 AI 的段落（容許編號或標點差異）。 */
function matchSections(ai: DocSection[], expected: readonly string[]): { byHeading: Map<string, string>; extra: DocSection[] } {
  const byHeading = new Map<string, string>();
  const extra: DocSection[] = [];
  for (const s of ai) {
    const c = coreOf(s.heading);
    const hit = c ? expected.find((h) => !byHeading.has(h) && (coreOf(h) === c || coreOf(h).includes(c) || c.includes(coreOf(h)))) : undefined;
    if (hit) byHeading.set(hit, s.body);
    else extra.push(s);
  }
  return { byHeading, extra };
}

/** 「問題 n：」依出現順序重新連號（也接受「護理問題 1：」「問題一：」）。 */
function renumberProblems(body: string): string {
  let n = 0;
  return body.replace(/^(\s*)(?:護理)?問題\s*(?:\d+|[一二三四五六七八九十]+)\s*[：:]\s*/gm, (_m, indent: string) => `${indent}問題 ${++n}：`);
}

const PROBLEM_LINE = /^\s*問題 \d+：/;
const PROBLEM_TAG = /（(?:沿用|調整|本次新增)）/;

/** 沒有現行計畫時是第 1 版：沒有標記的問題一律標「（本次新增）」。 */
function tagNewProblems(body: string): string {
  return body
    .split("\n")
    .map((line) => (PROBLEM_LINE.test(line) && !PROBLEM_TAG.test(line) ? `${line.replace(/[。．.\s]+$/, "")}（本次新增）` : line))
    .join("\n");
}

const isNotMentioned = (body: string) => body.replace(/[\s。．.]/g, "") === "口述未提及";

/**
 * 模型輸出（或示範輸出）→ 依模板組成：「依據：」行＋五段＋不在模板中的段落（附提醒）。
 * 不加異常值行、不寫「未提供病摘」；口述沒提到的段落一律「口述未提及。」（不提醒）。
 */
export function assemblePolishedPlan(
  ai: DocSection[],
  req: Pick<PolishPlanRequest, "visitDate" | "hasCurrentPlan">,
): { sections: DocSection[]; warnings: string[] } {
  const warnings: string[] = [];
  const cleaned = ai
    .map((s) => ({ heading: (s.heading ?? "").trim(), body: (s.body ?? "").trim() }))
    .filter((s) => !/^依據/.test(s.heading) && !(s.heading === "" && /^依據/.test(s.body)));
  const { byHeading, extra } = matchSections(cleaned, PLAN_HEADINGS);
  const take = (h: string) => {
    const body = byHeading.get(h)?.trim() ?? "";
    return !body || isNotMentioned(body) ? NOT_MENTIONED_SENTENCE : body;
  };
  let problems = take(PLAN_HEADINGS[2]);
  if (problems === NOT_MENTIONED_SENTENCE) warnings.push("口述沒有提到護理問題。");
  else {
    problems = renumberProblems(problems);
    if (!req.hasCurrentPlan) problems = tagNewProblems(problems);
  }
  const kept = extra.filter((s) => s.body.trim());
  for (const s of kept) warnings.push(`護理計畫有不在模板中的段落「${s.heading || "（無標題）"}」，請確認內容。`);
  const sections: DocSection[] = [
    { heading: "", body: dictationBasisLine(req.visitDate) },
    ...PLAN_HEADINGS.map((h, i) => ({ heading: h, body: i === 2 ? problems : take(h) })),
    ...kept,
  ];
  return { sections, warnings };
}

/* ============================== 對照口述原文 ============================== */

const CJK_RUN = /[㐀-䶿一-鿿]+/g;

/** 相鄰兩個中文字（只在連續的中文字之內取）。 */
function bigrams(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CJK_RUN)) for (let i = 0; i + 1 < m[0].length; i++) out.push(m[0].slice(i, i + 2));
  return out;
}

/** 計畫格式本身會用到的詞：不算新增內容。 */
const ALLOW = ["個案", "毫升", "每日", "本次", "訪視", "護理", "問題", "目標", "措施", "評值", "依據", "家屬", "新增", "沿用", "調整", "口述", "未提"];

const SOFT_MIN_BIGRAMS = 6;
const SOFT_MIN_RATIO = 0.35;

const share = (list: string[], set: Set<string>) => list.filter((b) => set.has(b)).length / list.length;
const compact = (s: string) => s.replace(/\s/g, "");
const preview = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 20 ? `${t.slice(0, 20)}…` : t;
};

/** 不用口述原文的單位（英文用詞檢查的例外）。 */
const EXEMPT_UNITS = new Set(["mmhg", "mg/dl", "ml", "cm", "kg", "fr"]);

/** AI 界線（與伺服器輸出檢核相同的三類）：量表分數、傷口或疾病分期、風險分級。 */
const BOUNDARY: [RegExp, string][] = [
  [/(?:Barthel|Braden|ADL|IADL|MMSE|CDR|SPMSQ|巴氏|柏拉登|量表)[^。\n]{0,12}?\d+\s*分/i, "量表分數"],
  [/第\s*[一二三四1-4]\s*(?:級|期)|stage\s*[1-4IV]+|分期/i, "傷口或疾病分期"],
  [/(?:高|中|低)(?:度)?風險/, "風險分級"],
];
const SCALE_NAME = /Barthel|Braden|ADL|IADL|MMSE|CDR|SPMSQ|巴氏|柏拉登|量表/i;
const CN_SMALL: Record<string, string> = { 一: "1", 二: "2", 兩: "2", 三: "3", 四: "4" };
/** 「第二級」與「第 2 級」視為相同。 */
const digitize = (s: string) => s.replace(/[一二兩三四]/g, (c) => CN_SMALL[c]);

/** 口述裡的結構用語（第一個問題是、目標是、措施是、家屬的部分）：不算要放進計畫的內容。 */
const SPOKEN_STRUCTURE =
  /(?:第\s*[一二三四五六七八九十\d]+\s*個?\s*(?:護理)?問題|(?:護理)?問題\s*[一二三四五六七八九十\d]+)\s*(?:是|：|:)?|(?:護理)?(?:目標|措施|評值)(?:是|：|:)?|(?:家屬|照顧者)的?(?:部分|方面)/g;

/** 去掉格式標記後，只留給「新增句」比對的文字。 */
function stripForNovelty(text: string): string {
  return text
    .replaceAll(UNVERIFIED_MARK, "")
    .replace(/（(?:沿用|調整|本次新增|原句)）/g, "")
    .replace(/^\s*(?:護理)?問題\s*\d+\s*[：:]/, "")
    .replace(/(?:本次)?(?:依據|相關因素|目標|措施|評值|調整)[：:]/g, "")
    .replace(/^\s*\d+\.\s*/, "")
    .trim();
}

interface SourceIndex {
  normalized: string;
  hasNumber: (x: number) => boolean;
  /** 去空白、小寫的口述原文（含正規化後的版本）。 */
  text: string;
  bigrams: Set<string>;
}

function sourceIndex(dictation: string, visitDate: string): SourceIndex {
  const normalized = normalizeDictation(dictation);
  const source = `${dictation}\n${normalized}`;
  const nums = [...numbersInText(source), ...numbersInText(visitDate)];
  return {
    normalized,
    hasNumber: (x) => nums.some((n) => Math.abs(n - x) < 1e-9),
    text: compact(source).toLowerCase(),
    bigrams: new Set([...bigrams(source), ...ALLOW]),
  };
}

/** 一行的硬性檢查：口述沒有的數字、英文用詞、量表分數／分期／風險等級，在後面標〔待核對〕。 */
function markLine(line: string, heading: string, src: SourceIndex, warnings: string[]): string {
  const marks = new Set<number>();
  /** 已標記的量表分數／分期／風險片語：片語內的其他標記併到片語後面（「Braden 12 分〔待核對〕」）。 */
  const phrases: [number, number][] = [];
  const flag = (end: number, warning: string) => {
    marks.add(end);
    warnings.push(warning);
  };

  // (a) 數字：問題編號、(n)、行首「n. 」不算
  for (const m of line.matchAll(/\d+(?:\.\d+)?/g)) {
    const at = m.index ?? 0;
    const before = line.slice(0, at);
    const after = line.slice(at + m[0].length);
    if (/問題\s*$/.test(before)) continue;
    if (/[(（]\s*$/.test(before) && /^\s*[)）]/.test(after)) continue;
    if (/^\s*$/.test(before) && /^\.(?!\d)/.test(after)) continue;
    if (/[A-WYZa-wyz]$/.test(before)) continue; // 英文用詞的一部分（SpO2），由下面的用詞檢查處理
    if (src.hasNumber(Number(m[0]))) continue;
    flag(at + m[0].length, `護理計畫「${heading}」有口述沒有的數字「${m[0]}」，已標${UNVERIFIED_MARK}。`);
  }

  // (b) 英文用詞（藥名、縮寫）：要出現在口述原文中；常用單位與乘號（3 x 2）除外
  for (const m of line.matchAll(/[A-Za-z][A-Za-z0-9/.-]*/g)) {
    const word = m[0].replace(/[./-]+$/, "");
    const at = m.index ?? 0;
    if (EXEMPT_UNITS.has(word.toLowerCase())) continue;
    if (/^[xX]\d*$/.test(word) && /\d\s*$/.test(line.slice(0, at))) continue;
    if (src.text.includes(word.toLowerCase())) continue;
    flag(at + word.length, `護理計畫「${heading}」有口述沒有的用詞「${word}」，已標${UNVERIFIED_MARK}。`);
  }

  // (c) 量表分數、分期、風險等級：口述有說才可以寫
  for (const [re, what] of BOUNDARY) {
    for (const m of line.matchAll(new RegExp(re.source, `${re.flags}g`))) {
      const hit = compact(m[0]).toLowerCase();
      if (src.text.includes(hit) || digitize(src.text).includes(digitize(hit))) continue;
      if (what === "量表分數") {
        const name = SCALE_NAME.exec(m[0])?.[0].toLowerCase() ?? "";
        const nums = (m[0].match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
        if (name && src.text.includes(name) && nums.every((x) => src.hasNumber(x))) continue;
      }
      const at = m.index ?? 0;
      phrases.push([at, at + m[0].length]);
      flag(at + m[0].length, `護理計畫「${heading}」疑似加入口述沒有的${what}，已標${UNVERIFIED_MARK}。`);
    }
  }

  let out = line;
  const positions = [...marks].filter((p) => !phrases.some(([a, b]) => p > a && p < b));
  for (const end of positions.sort((a, b) => b - a)) {
    if (out.startsWith(UNVERIFIED_MARK, end)) continue;
    out = out.slice(0, end) + UNVERIFIED_MARK + out.slice(end);
  }
  return out;
}

/**
 * 對照口述原文檢查五段內容：
 * 硬性（標〔待核對〕，護理師改掉才能確認）：(a) 數字 (b) 英文用詞 (c) 量表分數／分期／風險等級。
 * 軟性（只提醒）：(d) 某句的字詞大多不在口述中 (e) 口述的某段大多沒出現在計畫中。
 */
export function checkDictationFidelity(dictation: string, sections: DocSection[], visitDate: string): { sections: DocSection[]; warnings: string[] } {
  const src = sourceIndex(dictation, visitDate);
  const content = new Set<string>(PLAN_HEADINGS);
  const hard: string[] = [];
  const soft: string[] = [];

  const out = sections.map((s) => {
    if (!content.has(s.heading)) return s;
    const lines = s.body.split("\n");
    for (const line of lines) {
      // (d) 新增句：措施的 (1)(2) 各算一句；「（原句）」與「口述未提及。」不檢查
      for (const unit of line.split(/\([0-9]+\)|（[0-9]+）/)) {
        if (/（原句）\s*[。．.]?\s*$/.test(unit) || unit.includes("口述未提及")) continue;
        const text = stripForNovelty(unit);
        const bg = bigrams(text);
        if (bg.length < SOFT_MIN_BIGRAMS || share(bg, src.bigrams) >= SOFT_MIN_RATIO) continue;
        soft.push(`護理計畫「${s.heading}」這句在口述中找不到明顯對應，請對照口述原文：「${preview(text)}」`);
      }
    }
    return { heading: s.heading, body: lines.map((line) => markLine(line, s.heading, src, hard)).join("\n") };
  });

  // (e) 漏掉的口述：以正規化後的口述逐句比對
  const outBigrams = new Set(sections.filter((s) => content.has(s.heading)).flatMap((s) => bigrams(s.body)));
  for (const clause of src.normalized.split(/[。！？；\n]/)) {
    const bg = bigrams(clause.replace(SPOKEN_STRUCTURE, "，"));
    if (bg.length < SOFT_MIN_BIGRAMS || share(bg, outBigrams) >= SOFT_MIN_RATIO) continue;
    soft.push(`口述中這段可能沒有放進計畫：「${preview(clause)}」`);
  }
  return { sections: out, warnings: [...hard, ...soft] };
}

/* ============================== 收尾 ============================== */

const MAX_WARNINGS = 8;

function capWarnings(list: string[]): string[] {
  const unique = [...new Set(list)];
  if (unique.length <= MAX_WARNINGS) return unique;
  const keep = MAX_WARNINGS - 1;
  return [...unique.slice(0, keep), `另有 ${unique.length - keep} 處提醒，請對照口述原文。`];
}

/** 口述整理的決定性收尾：組成模板 → 對照口述原文 → 提醒去重（最多 8 則）。 */
export function finalizePolishedPlanCore(out: { sections: DocSection[] }, req: PolishPlanRequest): { doc: GeneratedDoc; warnings: string[] } {
  const assembled = assemblePolishedPlan(out.sections, req);
  const checked = checkDictationFidelity(req.dictation, assembled.sections, req.visitDate);
  return { doc: { kind: "plan", sections: checked.sections }, warnings: capWarnings([...assembled.warnings, ...checked.warnings]) };
}
