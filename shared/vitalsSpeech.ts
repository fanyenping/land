/**
 * 數值速記的口述解析（按住麥克風說出數值）：純函式、不呼叫 AI，前端與測試共用。
 * 依關鍵字切段：從一個關鍵字到下一個關鍵字之間的文字屬於它，只取跟在關鍵字後面的數字。
 * 不修正不合理的數值（例：十六點八照樣是 16.8），由數值速記畫面的範圍提示提醒護理師。
 */
import { numbersInText } from "./clinical";
import type { VitalKey } from "./types";

export interface SpokenVital {
  value: string;
  qualifier?: string;
}

export interface SpokenVitals {
  values: Partial<Record<VitalKey, SpokenVital>>;
  /** 有填到值的項目，依說出的先後。 */
  heard: VitalKey[];
}

/** 試用版（不能用麥克風）按住放開時使用的示範口述。 */
export const DEMO_VITALS_UTTERANCE = "體溫三十六點八度，脈搏八十八，呼吸十八，血壓一百四十二之八十六，血氧九十六，室內空氣，飯前血糖一百二十六，意識清醒";

type Slot = VitalKey | "sbp" | "dbp";

interface Keyword {
  word: string;
  slot: Slot;
  /** 關鍵字本身帶的附註（飯前血糖 → 飯前）。 */
  qualifier?: string;
}

const KEYWORDS: Keyword[] = [
  ...["體溫", "溫度", "耳溫", "額溫", "肛溫", "腋溫", "口溫"].map((word) => ({ word, slot: "temp" as const })),
  ...["脈搏", "脈博", "心跳", "心律", "心率", "hr", "pr"].map((word) => ({ word, slot: "pulse" as const })),
  ...["呼吸次數", "呼吸速率", "呼吸", "rr"].map((word) => ({ word, slot: "resp" as const })),
  ...["血壓", "bp"].map((word) => ({ word, slot: "bp" as const })),
  ...["收縮壓", "高壓"].map((word) => ({ word, slot: "sbp" as const })),
  ...["舒張壓", "低壓"].map((word) => ({ word, slot: "dbp" as const })),
  ...["血氧飽和度", "血氧飽和", "血氧濃度", "含氧濃度", "含氧量", "血氧", "含氧", "spo2", "sao2"].map((word) => ({ word, slot: "spo2" as const })),
  { word: "飯前血糖", slot: "glucose", qualifier: "飯前" },
  { word: "餐前血糖", slot: "glucose", qualifier: "飯前" },
  { word: "空腹血糖", slot: "glucose", qualifier: "飯前" },
  { word: "飯後血糖", slot: "glucose", qualifier: "飯後" },
  { word: "餐後血糖", slot: "glucose", qualifier: "飯後" },
  { word: "隨機血糖", slot: "glucose", qualifier: "隨機" },
  { word: "血糖", slot: "glucose" },
  ...["意識", "神智", "神志"].map((word) => ({ word, slot: "consciousness" as const })),
];

const BY_WORD = new Map(KEYWORDS.map((k) => [k.word, k]));
// 長的先比對（血氧飽和度 優先於 血氧）；英文縮寫後面不能再接字母（bpm 不是 bp）。
const KEYWORD_RE = new RegExp(
  [...KEYWORDS]
    .sort((a, b) => b.word.length - a.word.length)
    .map((k) => (/^[a-z]/.test(k.word) ? `${k.word}(?![a-z])` : k.word))
    .join("|"),
  "g",
);

const NUM_RE = /\d+(?:\.\d+)?|[零〇一二兩三四五六七八九十百千]+(?:點[零〇一二三四五六七八九]+)?/g;
const CN_UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000 };
const DIGIT: Record<string, string> = { 零: "0", 〇: "0", 一: "1", 二: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 半: "5" };

const blank = (s: string, from: number, to: number) => s.slice(0, from) + " ".repeat(to - from) + s.slice(to);

/** 全形轉半形、小寫，去掉含字母或「百」的單位（mmHg、mg/dL、百分之），長度不變以外的改動都在這一步。 */
function normalize(text: string): string {
  return text
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[　 ]/g, " ")
    .replace(/₂/g, "2")
    .toLowerCase()
    .replace(/(\d)\s*點\s*(\d)/g, "$1.$2")
    .replace(/mg\s*\/\s*dl|mmhg|bpm|毫米汞柱|毫克|百分之|巴仙/g, (m) => " ".repeat(m.length));
}

/**
 * 把連在一起的中文數字切開：「一百四十二八十六」→ 一百四十二｜八十六。
 * 個位數字後面沒有接單位就結束一個數；沒有任何單位的逐字念法（九六）整串當一個數。
 */
function splitCn(s: string): [number, number][] {
  if (![...s].some((c) => c in CN_UNIT)) return [[0, s.length]];
  const out: [number, number][] = [];
  let start = 0;
  let lastUnit = Infinity;
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c in CN_UNIT) {
      // 單位不比前一個小：前一個數已經結束（例：一百四十 → 十）。
      if (CN_UNIT[c] >= lastUnit) {
        out.push([start, i]);
        start = i;
      }
      lastUnit = CN_UNIT[c];
      i++;
      continue;
    }
    if (c === "零" || c === "〇") {
      i++;
      continue;
    }
    const next = s[i + 1];
    if (next !== undefined && next in CN_UNIT) {
      if (CN_UNIT[next] >= lastUnit) {
        out.push([start, i]);
        start = i;
        lastUnit = Infinity;
      }
      i++;
      continue;
    }
    out.push([start, i + 1]);
    start = i + 1;
    lastUnit = Infinity;
    i++;
  }
  if (start < s.length) out.push([start, s.length]);
  return out;
}

interface NumTok {
  /** 阿拉伯數字寫法，小數照說的位數（三十七點零 → 37.0）。 */
  text: string;
  start: number;
  end: number;
}

/** 中文整數（可帶「點」後的小數位）→ 阿拉伯數字字串；無法解析回傳 null。 */
function cnText(int: string, frac?: string): string | null {
  const n = numbersInText(int)[0];
  if (n === undefined) return null;
  return frac ? `${n}.${[...frac].map((c) => DIGIT[c]).join("")}` : String(n);
}

/** 文字中的數字（含位置）：阿拉伯數字、中文數字與「點」小數。 */
function numberTokens(s: string): NumTok[] {
  const out: NumTok[] = [];
  for (const m of s.matchAll(NUM_RE)) {
    const tok = m[0];
    const at = m.index;
    if (/^\d/.test(tok)) {
      // 照說的寫（37.0 不變成 37），只去掉開頭多餘的 0。
      out.push({ text: tok.replace(/^0+(?=\d)/, ""), start: at, end: at + tok.length });
      continue;
    }
    const [int, frac] = tok.split("點");
    const ranges = splitCn(int);
    ranges.forEach(([a, b], i) => {
      const last = i === ranges.length - 1;
      const text = cnText(int.slice(a, b), last ? frac : undefined);
      if (text !== null) out.push({ text, start: at + a, end: at + (last ? tok.length : b) });
    });
  }
  return out;
}

type KeywordHit = Keyword & { start: number; end: number };

function keywordHits(s: string): KeywordHit[] {
  const hits: KeywordHit[] = [];
  for (const m of s.matchAll(KEYWORD_RE)) {
    const kw = BY_WORD.get(m[0])!;
    // 英文縮寫前面也不能接字母（例：asbp）。
    if (/^[a-z]/.test(kw.word) && /[a-z]/.test(s[m.index - 1] ?? "")) continue;
    hits.push({ ...kw, start: m.index, end: m.index + m[0].length });
  }
  return hits;
}

const ROOM_AIR = /室內空氣|room\s*air|未給氧|沒有?給氧|沒有?用氧氣?|沒有?戴氧氣/g;
const LITER = /公升|升|l(?![a-z])/g;
const O2_PRE = /(?:氧氣|給氧|鼻導管|(?<![a-z])o2)\s*(?:給|開|用|是|在)?\s*$/;
/** 血氧關鍵字到公升數之間只有數值、單位與標點（SpO2 96% 2L）。 */
const ONLY_NUMBERS = /^[\s\d.%,，、。;；:：零〇一二兩三四五六七八九十百千點趴]*$/;

/** 公升數緊跟在血氧數值後面（沒說「氧氣」）。 */
function rightAfterSpo2(s: string, at: number): boolean {
  const kw = keywordHits(s)
    .filter((h) => h.end <= at)
    .at(-1);
  return kw?.slot === "spo2" && ONLY_NUMBERS.test(s.slice(kw.end, at));
}

/** 血氧的給氧方式（全句找）：氧氣 N 公升 → 「氧氣 NL」、室內空氣；找到後從句中抹掉，數字不會被當成數值。 */
function extractOxygen(s: string, found: { at: number; q: string }[]): string {
  let out = s;
  for (const m of s.matchAll(ROOM_AIR)) {
    found.push({ at: m.index, q: "室內空氣" });
    out = blank(out, m.index, m.index + m[0].length);
  }
  const fixed = out;
  const toks = numberTokens(fixed);
  for (const m of fixed.matchAll(LITER)) {
    const at = m.index;
    const tok = toks.filter((k) => k.end <= at && /^\s*$/.test(fixed.slice(k.end, at))).at(-1);
    if (!tok) continue;
    const pre = O2_PRE.exec(fixed.slice(Math.max(0, tok.start - 8), tok.start));
    // 公升數要跟給氧有關：前面說了氧氣／給氧／鼻導管，或緊跟在血氧數值後面（喝水兩公升、尿量一公升不算）。
    // 單一個「升」容易誤認（上升），一定要有氧氣。
    if (!pre && (m[0] === "升" || !rightAfterSpo2(fixed, tok.start))) continue;
    const start = pre ? tok.start - pre[0].length : tok.start;
    let end = at + m[0].length;
    const per = /^\s*(?:\/|每)\s*分鐘?/.exec(fixed.slice(end));
    if (per) end += per[0].length;
    // 跟選項同一種寫法：二點零公升 → 「氧氣 2L」。
    found.push({ at: start, q: `氧氣 ${Number(tok.text)}L` });
    out = blank(out, start, end);
  }
  return out;
}

const NUMERAL = "零〇一二兩三四五六七八九十百千\\d";
/** 不是數值的數字字：有一點、一下、再量一次、十分、第二次。 */
const NOT_NUMBER: RegExp[] = [
  new RegExp(`(^|[^${NUMERAL}])(一(?:下|些|直|樣|起|般|會兒?|定|共|切|邊|點(?![${NUMERAL}])))`, "g"),
  new RegExp(`(^|[^${NUMERAL}])([一二兩三]次)`, "g"),
  new RegExp(`(^|[^${NUMERAL}])(十分(?!鐘))`, "g"),
  new RegExp(`()(第[${NUMERAL}]+次?)`, "g"),
];

const DURATION = /\s*個?\s*半?\s*(?:小時|鐘頭|分鐘|秒鐘?)|\s*(?:hours?|hrs?|h)(?![a-z])/g;

/**
 * 時間長度（兩小時、五分鐘、三十秒）不是數值：只抹掉緊接在單位前的那一個數，
 * 黏在前面的數值保留（脈搏八十八一分鐘 → 88）。英文 h／hr 只在飯後、餐後才算時間，其他地方的 HR 是心跳。
 */
function blankDurations(s: string): string {
  const toks = numberTokens(s);
  let out = s;
  for (const m of s.matchAll(DURATION)) {
    const tok = toks.find((t) => t.end === m.index);
    if (!tok) continue;
    if (/[a-z]/.test(m[0]) && !/(?:飯|餐)後\s*$/.test(s.slice(0, tok.start))) continue;
    out = blank(out, tok.start, m.index + m[0].length);
  }
  return out;
}

/** 口語體溫：「三十六度八」「36度8」「36°8」→ 36.8、「三十六度半」→ 36.5。 */
const TEMP_COLLOQUIAL = /(\d{2}|[二三四]十[一二三四五六七八九]?)\s*[度°]\s*([0-9零〇一二三四五六七八九半])(?![0-9零〇一二兩三四五六七八九十百點.])/;

function tempText(seg: string): string {
  return seg.replace(TEMP_COLLOQUIAL, (_m, int: string, frac: string) => {
    const i = /^\d/.test(int) ? int : String(numbersInText(int)[0]);
    return `${i}.${DIGIT[frac] ?? frac}`;
  });
}

/** 血壓兩個數字之間可接受的說法：/、空白、比、之、對、、、over。 */
const BP_SEP = /^[\s,，、。.\/:：;；\-–—~～]*(?:比|之|對|over|to|跟|和)?[\s,，、。.\/:：;；\-–—~～]*$/;

function bpOf(seg: string): string | null {
  const toks = numberTokens(seg);
  for (let i = 0; i + 1 < toks.length; i++) {
    if (BP_SEP.test(seg.slice(toks[i].end, toks[i + 1].start))) return `${toks[i].text}/${toks[i + 1].text}`;
  }
  return null;
}

const firstNumber = (seg: string): string | null => numberTokens(seg)[0]?.text ?? null;

const CONSCIOUS_WORDS: [RegExp, string][] = [
  [/可喚醒|可以喚醒|叫得醒|喚得醒/g, "可喚醒"],
  [/嗜睡/g, "嗜睡"],
  [/混亂|混淆|錯亂/g, "混亂"],
  [/昏迷/g, "昏迷"],
  [/清醒|清楚|清(?=$|[\s,，、。])/g, "清醒"],
];

/** 否定詞直接接在狀態前面（不清醒、沒有很清楚、不太清楚）。 */
const NEGATED = /(?:不|沒有?|未)(?:是|很|太|那麼|怎麼|算)*$/;

/** 意識：取最先出現的選項；直接被否定的不算。「意識不清，嗜睡」的「不」只否定「清」，嗜睡照填。 */
function consciousnessOf(seg: string): string | null {
  let best: { at: number; value: string } | null = null;
  for (const [re, value] of CONSCIOUS_WORDS) {
    for (const m of seg.matchAll(re)) {
      if (NEGATED.test(seg.slice(0, m.index))) continue;
      if (!best || m.index < best.at) best = { at: m.index, value };
    }
  }
  return best?.value ?? null;
}

const AFTER_SUCTION = /拍痰後|拍完痰|拍痰完/;

const MEAL: Record<string, string> = { 飯前: "飯前", 餐前: "飯前", 空腹: "飯前", 飯後: "飯後", 餐後: "飯後", 隨機: "隨機" };
const MEAL_RE = /飯前|餐前|空腹|飯後|餐後|隨機/;

/** 說出的口述 → 數值速記各欄位。只回傳有聽到數值的項目。 */
export function parseSpokenVitals(text: string): SpokenVitals {
  const oxygen: { at: number; q: string }[] = [];
  let s = extractOxygen(normalize(text ?? ""), oxygen);
  for (const re of NOT_NUMBER) s = s.replace(re, (_m, pre: string, body: string) => pre + " ".repeat(body.length));
  s = blankDurations(s);

  const hits = keywordHits(s);

  const values: SpokenVitals["values"] = {};
  const heard: VitalKey[] = [];
  const put = (key: VitalKey, v: SpokenVital) => {
    values[key] = v;
    if (!heard.includes(key)) heard.push(key);
  };
  let sbp: string | null = null;
  let dbp: string | null = null;

  hits.forEach((h, i) => {
    const seg = s.slice(h.end, i + 1 < hits.length ? hits[i + 1].start : s.length);
    // 關鍵字前面一小段（不跨過上一個關鍵字）：「飯前測的血糖」「拍痰後血氧」。
    const beforeFrom = Math.max(i > 0 ? hits[i - 1].end : 0, h.start - 6);
    const before = s.slice(beforeFrom, h.start);
    switch (h.slot) {
      case "temp": {
        const v = firstNumber(tempText(seg));
        if (v) put("temp", { value: v });
        break;
      }
      case "pulse":
      case "resp": {
        const v = firstNumber(seg);
        if (v) put(h.slot, { value: v });
        break;
      }
      case "bp": {
        const v = bpOf(seg);
        if (v) put("bp", { value: v });
        break;
      }
      case "sbp":
      case "dbp": {
        const v = firstNumber(seg);
        if (!v) break;
        if (h.slot === "sbp") sbp = v;
        else dbp = v;
        if (sbp && dbp) put("bp", { value: `${sbp}/${dbp}` });
        break;
      }
      case "spo2": {
        const v = firstNumber(seg);
        if (!v) break;
        // 給氧方式取最後說的那個；「拍痰後」只看血氧這一段與關鍵字前面。
        const cands = [...oxygen];
        const inSeg = AFTER_SUCTION.exec(seg);
        const inBefore = AFTER_SUCTION.exec(before);
        if (inSeg) cands.push({ at: h.end + inSeg.index, q: "拍痰後" });
        else if (inBefore) cands.push({ at: beforeFrom + inBefore.index, q: "拍痰後" });
        const q = cands.sort((a, b) => a.at - b.at).at(-1)?.q;
        put("spo2", q ? { value: v, qualifier: q } : { value: v });
        break;
      }
      case "glucose": {
        const v = firstNumber(seg);
        if (!v) break;
        const meal = h.qualifier ?? MEAL[(MEAL_RE.exec(seg) ?? MEAL_RE.exec(before))?.[0] ?? ""];
        put("glucose", meal ? { value: v, qualifier: meal } : { value: v });
        break;
      }
      case "consciousness": {
        const v = consciousnessOf(seg);
        if (v) put("consciousness", { value: v });
        break;
      }
    }
  });

  return { values, heard };
}
