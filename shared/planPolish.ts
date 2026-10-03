/**
 * 護理計畫「護理師口述 → AI 只整理語句」的共用收尾（伺服器與本機／試用版示範引擎都跑這一份）：
 * 1. 依模板組成五段，最前面加「依據：護理師口述（日期）」；口述沒提到的段落寫「口述未提及。」。
 * 2. 對照口述原文：口述沒有的數字、英文用詞、量表分數／分期／風險等級標〔待核對〕（確認前要改掉）；
 *    看起來是新增或漏掉的句子只提醒。
 * 純 TypeScript、無 Node 依賴（前端也會打包）。
 */
import { numbersInText } from "./clinical";
import { maskPii } from "./pii";
import { PLAN_HEADINGS, slashDate } from "./templates";
import type { DocSection, GeneratedDoc, PolishPlanRequest } from "./types";

export const PLAN_DICTATION_MAX_CHARS = 6000;
export const NOT_MENTIONED_SENTENCE = "口述未提及。";
export const UNVERIFIED_MARK = "〔待核對〕";
export const POLISH_PROMPT_VERSION = "plan-polish-1";

/** 口語贅詞（連同後面的逗號與空白）。「然後」是「雖然後來」「不然後果」「當然後續」的一部分時不算。 */
export const FILLER_RE = /(?:嗯+|呃+|欸+|那個|(?<![雖既不當突忽顯居竟偶固必依仍自])然後(?![果續])呢?|就是說?|對啊|這樣子)[，、,\s]*/g;

/** 「依據：護理師口述（2026/10/03）」 */
export const dictationBasisLine = (visitDate: string) => `依據：護理師口述（${slashDate(visitDate)}）`;

export const hasUnverifiedText = (text: string) => text.includes(UNVERIFIED_MARK);

/* ============================== 口述正規化 ============================== */

const HOMOPHONES: [RegExp, string][] = [
  [/翻生/g, "翻身"],
  // 「更換要用無菌技術」「替換要…」不是換藥
  [/(?<![更替交轉切變])換要/g, "換藥"],
  [/雪糖/g, "血糖"],
];
const FULL_PUNCT: Record<string, string> = { ",": "，", ".": "。", ";": "；", ":": "：" };

/** 家屬或照顧者的稱呼：同一句（或上一句）提到時，句首的她／他可能是在說家屬，不改成「個案」。 */
const FAMILY_ROLE = /家屬|女兒|兒子|先生|太太|老公|老婆|丈夫|妻子|媳婦|女婿|孫子|孫女|看護|外籍|照顧者|爸爸|媽媽/;
/** 句首是新的護理問題（第二個問題是…）：上一句的家屬不算這句的主詞。 */
const PROBLEM_LEAD = /^\s*(?:第\s*[一二三四五六七八九十\d]+\s*個?\s*(?:護理)?問題|(?:護理)?問題\s*[一二三四五六七八九十\d]+)/;

/** 子句開頭的她／他改成「個案」；附近說的是家屬時不改（「女兒白天上班，她晚上會幫忙」）。 */
function subjectToPatient(text: string): string {
  let prevFamily = false;
  return text
    .split(/(?<=[。！？\n])/)
    .map((s) => {
      const family = !PROBLEM_LEAD.test(s) && prevFamily;
      prevFamily = FAMILY_ROLE.test(s);
      return s.replace(/(^|[，；])\s*[她他](?!們)/g, (m, lead: string, at: number) => (family || FAMILY_ROLE.test(s.slice(0, at)) ? m : `${lead}個案`));
    })
    .join("");
}

/** 去贅詞、修常見同音錯字、半形標點轉全形（數字中間的除外）、子句開頭指個案的她／他改成「個案」、整理空白。 */
export function normalizeDictation(text: string): string {
  let t = text.replace(/\r\n?/g, "\n");
  t = t.replace(FILLER_RE, "");
  t = t.replace(/護理計畫我?來?口述一下[，。,.]?/g, "");
  for (const [re, to] of HOMOPHONES) t = t.replace(re, to);
  const s = t;
  t = s.replace(/[,.;:]/g, (ch, i: number) => (/\d/.test(s[i - 1] ?? "") && /\d/.test(s[i + 1] ?? "") ? ch : FULL_PUNCT[ch]));
  t = subjectToPatient(t);
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
  // 「三、護理問題與護理計畫」這類變體：三還沒對到時，標題有「護理問題」或「計畫」的段落當成三（內容照樣檢查）。
  if (!byHeading.has(PLAN_HEADINGS[2])) {
    const i = extra.findIndex((x) => x.body.trim() && /護理問題|計畫/.test(coreOf(x.heading)));
    if (i >= 0) byHeading.set(PLAN_HEADINGS[2], extra.splice(i, 1)[0].body);
  }
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
const CJK_CHAR = /[㐀-䶿一-鿿]/g;

/** 相鄰兩個中文字（只在連續的中文字之內取）。 */
function bigrams(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(CJK_RUN)) for (let i = 0; i + 1 < m[0].length; i++) out.push(m[0].slice(i, i + 2));
  return out;
}

/** 計畫格式本身會用到的詞：不算新增內容。 */
const ALLOW = ["個案", "毫升", "每日", "本次", "訪視", "護理", "問題", "目標", "措施", "評值", "依據", "家屬", "新增", "沿用", "調整", "口述", "未提"];

const SOFT_MIN_BIGRAMS = 6;
/** 措施的 (1)(2) 各項通常很短：少一點字也比對。 */
const MEASURE_MIN_BIGRAMS = 3;
/** 口述裡逗號分開的短子句（列舉的措施）：至少這麼多字詞才比對。 */
const CLAUSE_MIN_BIGRAMS = 3;
const SOFT_MIN_RATIO = 0.35;
/** 護理問題的題目要大多出現在口述中。 */
const TITLE_MIN_RATIO = 0.5;
/** 短子句的字也大多不在計畫中才提醒（容許「滲液變多」寫成「滲液增加」這類書面化）。 */
const CLAUSE_MIN_CHAR_RATIO = 0.5;
const STOP_CHARS = new Set("的是了在和跟也就都會要有再先把讓給用".split(""));

const share = (list: string[], set: Set<string>) => list.filter((b) => set.has(b)).length / list.length;
const compact = (s: string) => s.replace(/\s/g, "");
const preview = (s: string) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > 20 ? `${t.slice(0, 20)}…` : t;
};

const CN_NUM = "〇零一二兩三四五六七八九十百千";

/**
 * 比對字詞前兩邊一致的整理：西西＝毫升、一天／每天＝每日、禮拜／星期＝週、這個月＝本月、沒有＝無、不要＝不；
 * 數字（中文或阿拉伯，連同後面的「個」）不算字詞，計畫照規則把中文數字改成阿拉伯數字時不會被當成漏掉或新增。
 */
function forWords(s: string): string {
  return s
    .replace(/西西/g, "毫升")
    .replace(/[一每]天/g, "每日")
    .replace(/禮拜|星期/g, "週")
    .replace(/這個?月/g, "本月")
    .replace(/這個?週/g, "本週")
    .replace(/沒有/g, "無")
    .replace(/不要/g, "不")
    .replace(new RegExp(`(?:[${CN_NUM}]+|[\\d０-９]+(?:[.．][\\d０-９]+)?)\\s*個?`, "g"), " ");
}

/** 全形數字換成半形（長度不變，標記位置照用）。 */
const halfDigits = (s: string) => s.replace(/[０-９．]/g, (c) => (c === "．" ? "." : String.fromCharCode(c.charCodeAt(0) - 0xfee0)));

/** 不用口述原文的單位（英文用詞檢查的例外）。 */
const EXEMPT_UNITS = new Set(["mmhg", "mg/dl", "ml", "cm", "kg", "fr"]);

/** AI 界線（與伺服器輸出檢核相同的三類）：量表分數、傷口或疾病分期、風險分級（含「跌倒高危險群」「風險高」）。 */
const BOUNDARY: [RegExp, string][] = [
  [/(?:Barthel|Braden|ADL|IADL|MMSE|CDR|SPMSQ|巴氏|柏拉登|量表)[^。\n]{0,12}?\d+\s*分/i, "量表分數"],
  [/第\s*[一二三四1-4]\s*(?:級|期)|stage\s*[1-4IV]+|分期/i, "傷口或疾病分期"],
  [/(?:高|中|低)(?:度)?(?:風險|危險)(?:群)?|(?:風險|危險)(?:性)?(?:偏)?(?:高|中|低)/, "風險分級"],
];
const SCALE_NAME = /Barthel|Braden|ADL|IADL|MMSE|CDR|SPMSQ|巴氏|柏拉登|量表/i;
const CN_SMALL: Record<string, string> = { 一: "1", 二: "2", 兩: "2", 三: "3", 四: "4" };
/** 「第二級」與「第 2 級」視為相同。 */
const digitize = (s: string) => s.replace(/[一二兩三四]/g, (c) => CN_SMALL[c]);

/** 完整日期（2026/10/17）：年、月可以是訪視日期的，日要口述有說。 */
const DATE_TOKEN = /\d{4}[/.-]\d{1,2}[/.-]\d{1,2}/g;

/** 數量的單位：數字後面有單位時，口述要有同一個數字配同一種單位（口述「兩週」不能變成「每 2 小時」）。 */
const UNIT = "小時|鐘頭|分鐘|秒|天|日|週|周|禮拜|星期|月|年|次|回|餐|顆|粒|片|包|瓶|罐|匙|杯|碗|公分|公斤|公克|毫升|西西|毫克|單位|度|歲|圈|趟|分(?![配之外別開])";
const UNIT_SAME: Record<string, string> = { 鐘頭: "小時", 日: "天", 周: "週", 禮拜: "週", 星期: "週", 西西: "毫升", 回: "次", 粒: "顆" };
const unitKey = (u: string) => UNIT_SAME[u] ?? u;
const UNIT_AFTER = new RegExp(`^\\s*個?\\s*(${UNIT})`);
const NUM_TOKEN = `(?:[${CN_NUM}]+(?:點[〇零一二三四五六七八九]+)?|\\d+(?:\\.\\d+)?)`;
/** 口述的「數字＋單位」：範圍（兩到三天、2-3 天）與乘號（三乘二公分）的兩端都配這個單位。 */
const SPOKEN_PAIR = new RegExp(`(${NUM_TOKEN})(?:\\s*[～~到至\\-－乘×xX*]\\s*(${NUM_TOKEN}))?\\s*個?\\s*(${UNIT})`, "g");
/** 中文數字＋單位（每兩小時、翻身一次、三天）：數量要口述有說。 */
const CN_QUANTITY = new RegExp(`([${CN_NUM}]+(?:點[〇零一二三四五六七八九]+)?)(\\s*個?\\s*(?:${UNIT}))`, "g");

/** 口述裡的結構用語（第一個問題是、再來第二個問題是、另外還有一個問題是、目標是、措施是、家屬的部分）：不算要放進計畫的內容。 */
const SPOKEN_STRUCTURE =
  /(?:(?:好的?|那麼?|再來|接下來|接著|另外|還有|然後|最後)[，、,\s]*)*(?:第\s*[一二三四五六七八九十\d]+\s*個?\s*(?:護理)?問題|(?:護理)?問題\s*[一二三四五六七八九十\d]+|下?一個(?:護理)?問題(?=\s*(?:是|：|:)))\s*(?:是|：|:)?|(?:護理)?(?:目標|措施|評值)(?:是|：|:)?|(?:家屬|照顧者)的?(?:部分|方面)/g;

/** 口述中不是數量的字：坐一下、有一點、一直、一起、十分（很）…（「一點半」「十分鐘」「三十分」照算）。 */
const NON_NUMERIC = new RegExp(`(?<![${CN_NUM}])一(?:下|點(?![〇零一二兩三四五六七八九半\\d])|些|直|起|定|樣|般|邊|旦|切|向)|(?<![${CN_NUM}])十分(?!鐘)`, "g");

/** 一個數字詞的值：中文數字照念法；口語範圍「兩三」「五六」兩端也算（逐字念法會讀成 23、56）。 */
function valuesOf(tok: string): number[] {
  if (/^\d/.test(tok)) return [Number(tok)];
  const out = numbersInText(tok);
  if (tok.length === 2 && !/[十百千點]/.test(tok)) for (const c of tok) out.push(...numbersInText(c));
  return out;
}

/**
 * 口述裡說到的數字（不含問題的序號「第一個問題」與「一下」「一點」這類不是數量的字），
 * 以及「數字＋單位」的組合；口語範圍（兩三天、五六次）兩端都算，「三十七度五」「一個半小時」「八點半」也算。
 */
function spokenNumbers(text: string): { nums: number[]; pairs: Set<string> } {
  const t = text.replace(SPOKEN_STRUCTURE, "，").replace(NON_NUMERIC, "，");
  const nums = numbersInText(t);
  const pairs = new Set<string>();
  const cn = (s: string) => (/^\d/.test(s) ? Number(s) : numbersInText(s)[0]);
  for (const m of t.matchAll(new RegExp(`[${CN_NUM}]+`, "g"))) if (m[0].length === 2) nums.push(...valuesOf(m[0]));
  for (const m of t.matchAll(SPOKEN_PAIR)) {
    for (const tok of [m[1], m[2]]) if (tok) for (const v of valuesOf(tok)) pairs.add(`${v}|${unitKey(m[3])}`);
  }
  for (const m of t.matchAll(new RegExp(`([${CN_NUM}]+|\\d+)度([一二三四五六七八九])(?![十百千])`, "g"))) {
    const int = cn(m[1]);
    if (int === undefined) continue;
    const x = Number(`${int}.${numbersInText(m[2])[0]}`);
    nums.push(x);
    pairs.add(`${x}|度`);
  }
  for (const m of t.matchAll(new RegExp(`([${CN_NUM}]+|\\d+)\\s*個?\\s*(度|點)?半\\s*(${UNIT})?`, "g"))) {
    const int = cn(m[1]);
    if (int === undefined) continue;
    nums.push(int + 0.5);
    if (m[2] === "點") nums.push(30);
    const unit = m[3] ?? (m[2] === "度" ? "度" : null);
    if (unit) pairs.add(`${int + 0.5}|${unitKey(unit)}`);
  }
  return { nums, pairs };
}

const QUOTED = /（原句）\s*[。．.]?\s*$/;

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
  /** 口述說過的數字（不含問題序號、「一下」這類）。 */
  hasNumber: (x: number) => boolean;
  /** 口述說過這個數字配這種單位（「兩週」＝2 週）。 */
  hasPair: (x: number, unit: string) => boolean;
  /** 訪視日期的數字：只用在完整日期的年、月（模型看不到日期，單獨出現的數字不算）。 */
  inVisitDate: (x: number) => boolean;
  /** 去空白、小寫的口述原文（含正規化後的版本）。 */
  text: string;
  bigrams: Set<string>;
}

function sourceIndex(dictation: string, visitDate: string): SourceIndex {
  const normalized = normalizeDictation(dictation);
  const source = `${dictation}\n${normalized}`;
  const { nums, pairs } = spokenNumbers(source);
  const dateNums = numbersInText(visitDate);
  const has = (list: number[]) => (x: number) => list.some((n) => Math.abs(n - x) < 1e-9);
  return {
    normalized,
    hasNumber: has(nums),
    hasPair: (x, unit) => pairs.has(`${x}|${unitKey(unit)}`),
    inVisitDate: has(dateNums),
    text: compact(source).toLowerCase(),
    bigrams: new Set([...bigrams(forWords(source)), ...ALLOW]),
  };
}

/** 一行的硬性檢查：口述沒有的數字（含中文數字、全形數字）、英文用詞、量表分數／分期／風險等級，在後面標〔待核對〕。 */
function markLine(line: string, heading: string, src: SourceIndex, warnings: string[]): string {
  // 全形數字當半形比對（長度相同，標記位置不變）
  const probe = halfDigits(line);
  const marks = new Set<number>();
  /** 已標記的量表分數／分期／風險片語：片語內的其他標記併到片語後面（「Braden 12 分〔待核對〕」）。 */
  const phrases: [number, number][] = [];
  const flag = (end: number, warning: string) => {
    marks.add(end);
    warnings.push(warning);
  };
  const dates = [...probe.matchAll(DATE_TOKEN)].map((m) => [m.index ?? 0, (m.index ?? 0) + m[0].length] as const);

  // (a) 數字：問題編號、(n)、行首「n. 」不算；完整日期的年、月可以是訪視日期
  for (const m of probe.matchAll(/\d+(?:\.\d+)?/g)) {
    const at = m.index ?? 0;
    const before = probe.slice(0, at);
    const after = probe.slice(at + m[0].length);
    if (/問題\s*$/.test(before)) continue;
    if (/[(（]\s*$/.test(before) && /^\s*[)）]/.test(after)) continue;
    if (/^\s*$/.test(before) && /^\.(?!\d)/.test(after)) continue;
    if (/[A-WYZa-wyz]$/.test(before)) continue; // 英文用詞的一部分（SpO2），由下面的用詞檢查處理
    const x = Number(m[0]);
    const unit = UNIT_AFTER.exec(after)?.[1];
    if (unit ? src.hasPair(x, unit) : src.hasNumber(x)) continue;
    if (src.inVisitDate(x) && dates.some(([a, b]) => at >= a && at < b)) continue;
    flag(at + m[0].length, `護理計畫「${heading}」有口述沒有的數字「${m[0]}」，已標${UNVERIFIED_MARK}。`);
  }

  // (a2) 中文數字＋單位（每兩小時）：口述原句就有（兩週）或數字口述有說就不標
  for (const m of probe.matchAll(CN_QUANTITY)) {
    const run = m[1];
    if (src.text.includes(compact(m[0]))) continue;
    const unit = m[2].replace(/[\s個]/g, "");
    const nums = numbersInText(run);
    if (nums.length && nums.every((x) => src.hasPair(x, unit))) continue;
    flag((m.index ?? 0) + run.length, `護理計畫「${heading}」有口述沒有的數字「${run}」，已標${UNVERIFIED_MARK}。`);
  }

  // (b) 英文用詞（藥名、縮寫）：要出現在口述原文中；常用單位與乘號（3 x 2）除外
  for (const m of probe.matchAll(/[A-Za-z][A-Za-z0-9/.-]*/g)) {
    const word = m[0].replace(/[./-]+$/, "");
    const at = m.index ?? 0;
    if (EXEMPT_UNITS.has(word.toLowerCase())) continue;
    if (/^[xX]\d*$/.test(word) && /\d\s*$/.test(probe.slice(0, at))) continue;
    if (src.text.includes(word.toLowerCase())) continue;
    flag(at + word.length, `護理計畫「${heading}」有口述沒有的用詞「${word}」，已標${UNVERIFIED_MARK}。`);
  }

  // (c) 量表分數、分期、風險等級：口述有說才可以寫
  for (const [re, what] of BOUNDARY) {
    for (const m of probe.matchAll(new RegExp(re.source, `${re.flags}g`))) {
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
 * (d) 新增的內容：每個護理問題整題比對（題目大多不在口述中，或整題的字詞大多不在口述中）；
 * 其他各句、措施的 (1)(2) 各項分開比對。「（原句）」與「口述未提及。」不檢查。
 */
function noveltyWarnings(body: string, heading: string, src: SourceIndex, soft: string[]): void {
  const lines = body.split("\n");
  const starts = lines.flatMap((l, i) => (PROBLEM_LINE.test(l) ? [i] : []));
  const covered = new Set<number>();
  starts.forEach((a, k) => {
    const b = starts[k + 1] ?? lines.length;
    if (QUOTED.test(lines[a])) return;
    const title = stripForNovelty(lines[a]);
    const tb = bigrams(forWords(title));
    const all = bigrams(forWords(lines.slice(a, b).filter((l) => !QUOTED.test(l)).map(stripForNovelty).join("，")));
    if ((tb.length && share(tb, src.bigrams) < TITLE_MIN_RATIO) || (all.length >= MEASURE_MIN_BIGRAMS && share(all, src.bigrams) < SOFT_MIN_RATIO)) {
      soft.push(`護理計畫「${heading}」的「${preview(title)}」在口述中找不到明顯對應，請對照口述原文。`);
      for (let i = a; i < b; i++) covered.add(i);
    }
  });
  lines.forEach((line, i) => {
    if (covered.has(i)) return;
    line.split(/\([0-9]+\)|（[0-9]+）/).forEach((unit, j) => {
      if (QUOTED.test(unit) || unit.includes("口述未提及")) return;
      const text = stripForNovelty(unit);
      const bg = bigrams(forWords(text));
      if (bg.length < (j > 0 ? MEASURE_MIN_BIGRAMS : SOFT_MIN_BIGRAMS) || share(bg, src.bigrams) >= SOFT_MIN_RATIO) return;
      soft.push(`護理計畫「${heading}」這句在口述中找不到明顯對應，請對照口述原文：「${preview(text)}」`);
    });
  });
}

/**
 * (e) 漏掉的口述：以正規化後的口述逐句比對；整句大致有放進去時，再逐一看逗號分開的子句（列舉的措施）。
 * 短子句的字詞與字都大多不在計畫中才提醒（容許書面化的改寫）。
 */
function omissionWarnings(src: SourceIndex, output: string, soft: string[]): void {
  const words = forWords(output);
  const outBigrams = new Set(bigrams(words));
  const outChars = new Set(words.match(CJK_CHAR) ?? []);
  for (const sentence of src.normalized.split(/[。！？；\n]/)) {
    const bg = bigrams(forWords(sentence.replace(SPOKEN_STRUCTURE, "，")));
    if (bg.length >= SOFT_MIN_BIGRAMS && share(bg, outBigrams) < SOFT_MIN_RATIO) {
      soft.push(`口述中這段可能沒有放進計畫：「${preview(sentence)}」`);
      continue;
    }
    const clauses = sentence.split(/[，、,]/);
    if (clauses.length < 2 && bg.length >= SOFT_MIN_BIGRAMS) continue;
    for (const clause of clauses) {
      const w = forWords(clause.replace(SPOKEN_STRUCTURE, "，"));
      const cb = bigrams(w);
      if (cb.length < CLAUSE_MIN_BIGRAMS || share(cb, outBigrams) >= SOFT_MIN_RATIO) continue;
      if (cb.length < SOFT_MIN_BIGRAMS) {
        const chars = (w.match(CJK_CHAR) ?? []).filter((c) => !STOP_CHARS.has(c));
        if (!chars.length || chars.filter((c) => outChars.has(c)).length / chars.length >= CLAUSE_MIN_CHAR_RATIO) continue;
      }
      soft.push(`口述中這段可能沒有放進計畫：「${preview(clause)}」`);
    }
  }
}

/** 最前面的「依據：護理師口述（日期）」行（系統產生，不檢查）。 */
const isBasisLine = (s: DocSection, i: number) => i === 0 && s.heading === "" && /^依據：/.test(s.body);

/**
 * 對照口述原文檢查計畫的每一段（最前面的依據行除外；不在模板中的段落也檢查）：
 * 硬性（標〔待核對〕，護理師改掉才能確認）：(a) 數字（含中文數字、全形數字）(b) 英文用詞 (c) 量表分數／分期／風險等級。
 * 軟性（只提醒）：(d) 護理問題或句子大多不在口述中 (e) 口述的某段或某個子句大多沒出現在計畫中。
 */
export function checkDictationFidelity(dictation: string, sections: DocSection[], visitDate: string): { sections: DocSection[]; warnings: string[] } {
  const src = sourceIndex(dictation, visitDate);
  const hard: string[] = [];
  const soft: string[] = [];

  const out = sections.map((s, i) => {
    if (isBasisLine(s, i)) return s;
    const name = s.heading || "（無標題）";
    noveltyWarnings(s.body, name, src, soft);
    return { heading: s.heading, body: s.body.split("\n").map((line) => markLine(line, name, src, hard)).join("\n") };
  });

  omissionWarnings(
    src,
    sections
      .filter((s, i) => !isBasisLine(s, i))
      .map((s) => s.body)
      .join("\n"),
    soft,
  );
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

/** 家屬對個案的稱呼（兩個字以上，例如「阿嬤」）改成「個案」，個資遮蔽並提醒（伺服器與本機共用）。 */
export function scrubPolishedSections(sections: DocSection[], familyCallsAs: string | null): { sections: DocSection[]; warnings: string[] } {
  const name = familyCallsAs?.trim() ?? "";
  const warnings: string[] = [];
  const out = sections.map((s) => {
    let body = s.body ?? "";
    if (name.length >= 2) body = body.replaceAll(name, "個案");
    const masked = maskPii(body);
    for (const what of masked.found) warnings.push(`護理計畫出現疑似${what}，已遮蔽。`);
    return { heading: s.heading ?? "", body: masked.text };
  });
  return { sections: out, warnings };
}

/** 口述整理的決定性收尾：稱呼與個資 → 組成模板 → 對照口述原文 → 提醒去重（最多 8 則）。 */
export function finalizePolishedPlanCore(out: { sections: DocSection[] }, req: PolishPlanRequest): { doc: GeneratedDoc; warnings: string[] } {
  const scrubbed = scrubPolishedSections(out.sections, req.familyCallsAs);
  const assembled = assemblePolishedPlan(scrubbed.sections, req);
  const checked = checkDictationFidelity(req.dictation, assembled.sections, req.visitDate);
  return { doc: { kind: "plan", sections: checked.sections }, warnings: capWarnings([...scrubbed.warnings, ...assembled.warnings, ...checked.warnings]) };
}
