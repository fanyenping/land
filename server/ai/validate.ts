/**
 * 決定性檢核（規格 §7.7 ⑤ 與 §7.9 ⑦），不呼叫 AI，全部是純函式：
 * 繁體關卡、原句定位、數值檢核、手動值覆蓋、輸出格式（K2／K3）、數字白名單、AI 界線與個資掃描。
 */
import * as OpenCC from "opencc-js/cn2t";
import { assessmentBasisLabel, assessmentForWriting } from "../../shared/assessment";
import {
  abnormalValuesLine,
  ensureIds,
  escalate,
  finalizeVitals,
  identityConcernFromText,
  normalizeVitalValue,
  numbersInText,
  numericDeltaChanges,
  vitalAlertLines,
  isPlausible,
  type ConfirmedVital,
} from "../../shared/clinical";
import {
  EDU_CLOSING,
  EDU_HEADINGS,
  EDU_MAX_CHARS,
  EDU_PLAIN_WORDS,
  INTAKE_HEADINGS,
  NOT_ASSESSED_SENTENCE,
  PLAN_HEADINGS,
  PLAN_MAX_PROBLEMS,
  RECORD_HEADINGS,
  RECORD_NARRATIVE_HEADING,
  TERM_REPLACEMENTS,
  addDays,
  composeAlertBody,
  parsePlanProblems,
  slashDate,
  tubeIntervalDays,
} from "../../shared/templates";
import {
  DOC_LABEL,
  type Analysis,
  type AnalyzeRequest,
  type DocSection,
  type GenerateRequest,
  type GeneratedDoc,
  type PreviousVisit,
  type TranscriptSegment,
  type VitalKey,
  type VitalReading,
} from "../../shared/types";
import type { AnalysisOutput, DocOutput } from "./schemas";

/* ============================== 繁體關卡 ============================== */

const cn2tw = OpenCC.Converter({ from: "cn", to: "tw" });

/**
 * OpenCC 在正體文字上會誤改的「兩岸共用字」（實測：排泄→排洩、干擾→幹擾、台灣→臺灣、面板→麵板、了解→瞭解）。
 * 這些字只有出現在簡體片段裡（前後 2 字內有確定的簡體字）才轉換；台、泄一律保留。
 */
const AMBIGUOUS = new Set([..."台克念表了面准泄布干只才系几周范志谷丑斗卷余回向制致松借游占采凶症杰舍云朴吁夸么"]);
const ALWAYS_KEEP = new Set([..."台泄"]);

export function toTraditionalSafe(text: string): string {
  const converted = cn2tw(text);
  if (converted === text) return text;
  const a = [...text];
  const b = [...converted];
  if (a.length !== b.length) return converted;
  const simplified = a.map((ch, i) => b[i] !== ch && !AMBIGUOUS.has(ch));
  const nearSimplified = (i: number) => simplified.slice(Math.max(0, i - 2), i + 3).some(Boolean);
  return b
    .map((ch, i) => {
      if (ch === a[i] || simplified[i]) return ch;
      if (ALWAYS_KEEP.has(a[i])) return a[i];
      return nearSimplified(i) ? ch : a[i];
    })
    .join("");
}

/** 遞迴轉換所有字串；`skip` 中的欄位（原句、依據）保持逐字原樣。 */
export function deepTraditional<T>(value: T, skip: ReadonlySet<string> = new Set()): T {
  const walk = (v: unknown, key?: string): unknown => {
    if (typeof v === "string") return key && skip.has(key) ? v : toTraditionalSafe(v);
    if (Array.isArray(v)) return v.map((x) => walk(x));
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x, k)]));
    return v;
  };
  return walk(value) as T;
}

/* ============================== 輸出格式（K2／K3） ============================== */

const CJK = "\\u3400-\\u4dbf\\u4e00-\\u9fff";
const RE_SPACE_CJK_DIGIT = new RegExp(`([${CJK}])(\\d)`, "g");
const RE_SPACE_DIGIT_CJK = new RegExp(`(\\d)([${CJK}])`, "g");
const RE_COMMA = new RegExp(`(?<=[${CJK}])\\s*,\\s*|\\s*,\\s*(?=[${CJK}])`, "g");
const RE_SEMI = new RegExp(`(?<=[${CJK}])\\s*;\\s*|\\s*;\\s*(?=[${CJK}])`, "g");
const RE_COLON = new RegExp(`(?<=[${CJK}])\\s*:\\s*`, "g");
const RE_PERIOD = new RegExp(`(?<=[${CJK}])\\.(?=\\s|$|[${CJK}])`, "g");
const RE_QMARK = new RegExp(`(?<=[${CJK}])\\?`, "g");
const RE_BANG = new RegExp(`(?<=[${CJK}])!`, "g");
const RE_PAREN = new RegExp(`\\(([^()]*[${CJK}][^()]*)\\)`, "g");
const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu;
const UNIT_AFTER_DIGIT = /(\d)(mmHg|mg\/dL|mg|mL|ml|kg|cm|bpm)\b/g;

/** 依 K2／K3 整理一段內文：去 Markdown 與 emoji、全形標點、數字與單位間距、範圍「～」、條列「1. 」、用語表。 */
export function polishText(text: string, opts: { edu?: boolean } = {}): string {
  let t = text.replace(/\r\n?/g, "\n").replace(/\t/g, "　").replace(EMOJI, "");
  t = t.replace(/\*\*|__/g, "");
  const lines = t.split("\n").map((line) => line.replace(/^#{1,6}\s+/, "").replace(/^>\s?/, ""));
  // 「- 」「* 」「• 」與「1、」「1）」條列一律改成「1. 」
  let n = 0;
  const listed = lines.map((line) => {
    const bullet = /^\s*[-*•・●]\s+(.*)$/.exec(line);
    if (bullet) return `${++n}. ${bullet[1]}`;
    n = 0;
    return line.replace(/^(\s*)(\d{1,2})\s*(?:[、．）)]|\.(?!\d))\s*/, "$1$2. ");
  });
  t = listed.join("\n");
  for (const [re, to] of TERM_REPLACEMENTS) t = t.replace(re, to);
  if (opts.edu) for (const [re, to] of EDU_PLAIN_WORDS) t = t.replace(re, to);
  t = t
    .replace(RE_PAREN, "（$1）")
    .replace(RE_COMMA, "，")
    .replace(RE_SEMI, "；")
    .replace(RE_COLON, "：")
    .replace(RE_PERIOD, "。")
    .replace(RE_QMARK, "？")
    .replace(RE_BANG, "！")
    .replace(/(\d)\s*[~〜–—]\s*(?=\d)/g, "$1～")
    .replace(/(\d)\s*～\s*(\d)/g, "$1～$2")
    .replace(UNIT_AFTER_DIGIT, "$1 $2")
    .replace(RE_SPACE_CJK_DIGIT, "$1 $2")
    .replace(RE_SPACE_DIGIT_CJK, "$1 $2")
    .replace(/[  ]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n");
  return t.trim();
}

/* ============================== 原句定位（C1、C5） ============================== */

const STRIP = /[\s，。、；：！？「」『』（）()…,.!?;:"'“”‘’～~—–-]/g;
const norm = (s: string) => s.replace(STRIP, "");

function lcs(a: string, b: string): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = tmp;
    }
  }
  return prev[b.length];
}

/**
 * 在逐字稿中找原句：正規化（去空白與標點）後比對；以「……」分段的引用要依序都找得到。
 * 完全比對不到時，用相似度 ≥0.9 的模糊比對（單段或相鄰兩段）。
 */
export function locateQuote(quote: string, segments: TranscriptSegment[]): TranscriptSegment | null {
  const frags = quote.split(/……|…|\.\.\./).map(norm).filter((f) => f.length >= 2);
  if (frags.length === 0 || segments.length === 0) return null;
  let full = "";
  const owner: number[] = [];
  segments.forEach((s, i) => {
    const n = norm(s.text);
    full += n;
    for (let k = 0; k < n.length; k++) owner.push(i);
  });
  let from = 0;
  let first = -1;
  for (const f of frags) {
    const at = full.indexOf(f, from);
    if (at < 0) {
      first = -1;
      break;
    }
    if (first < 0) first = at;
    from = at + f.length;
  }
  if (first >= 0) return segments[owner[first]];

  const target = frags.join("");
  let best: { seg: TranscriptSegment; score: number } | null = null;
  segments.forEach((s, i) => {
    const window = norm(s.text) + (segments[i + 1] ? norm(segments[i + 1].text) : "");
    const score = lcs(target, window) / target.length;
    if (!best || score > best.score) best = { seg: s, score };
  });
  const found = best as { seg: TranscriptSegment; score: number } | null;
  return found && found.score >= 0.9 ? found.seg : null;
}

/* ============================== 分析檢核 ============================== */

/** 低信心段落比例過高或瀏覽器聽寫（C6）。 */
export function isHighRiskTranscript(segments: TranscriptSegment[], provider: string): boolean {
  if (/browser/.test(provider)) return true;
  const scored = segments.filter((s) => typeof s.confidence === "number");
  if (scored.length < 3) return false;
  return scored.filter((s) => (s.confidence ?? 1) < 0.6).length / scored.length > 0.4;
}

const QUOTE_FIELDS = new Set(["sourceQuote", "evidence"]);

/** 模型輸出 → 契約中的 Analysis：補 id、定位原句、數值檢核、手動值覆蓋、管路到期日、異動、繁體。 */
export function finalizeAnalysis(out: AnalysisOutput, req: AnalyzeRequest): Analysis {
  const segments = req.transcript?.segments ?? [];
  const notes = req.notes ?? "";
  const highRisk = req.transcript ? isHighRiskTranscript(segments, req.transcript.provider) : false;
  const segStarts = new Set(segments.map((s) => s.startMs));

  const locate = (q: string | null, ms: number | null) => {
    if (!q) return { found: false, ms: null as number | null, conf: undefined as number | undefined, inNotes: false };
    const seg = locateQuote(q, segments);
    if (seg) return { found: true, ms: seg.startMs, conf: seg.confidence, inNotes: false };
    const inNotes = !!notes && norm(notes).includes(norm(q));
    return { found: inNotes, ms: ms !== null && segStarts.has(ms) ? ms : null, conf: undefined, inNotes };
  };

  const readings: VitalReading[] = [];
  for (const v of out.vitals) {
    const r: VitalReading = { ...v, value: normalizeVitalValue(v.key, v.value), flag: null };
    const at = locate(r.sourceQuote, r.sourceMs);
    // 沒有逐字稿時（只有文件），文件上的數值不能進今日生命徵象（N7）
    if (!req.transcript && !at.inNotes) continue;
    r.sourceMs = at.inNotes ? null : at.ms;
    if (r.sourceQuote && !at.found) escalate(r, "uncertain", "逐字稿中找不到原句，請核對");
    if (at.conf !== undefined && at.conf < 0.6) escalate(r, "uncertain", `這句語音辨識信心偏低（${Math.round(at.conf * 100)}%）`);
    readings.push(r);
  }
  const vitals = finalizeVitals(readings, req.typedVitals, { highRiskSource: highRisk });

  const findings = out.findings.map((f) => {
    const at = f.origin === "audio" ? locate(f.sourceQuote, f.sourceMs) : { ms: null };
    return { ...f, sourceMs: at.ms };
  });

  const tubes = out.tubes.map((t) => {
    const days = tubeIntervalDays(t.name);
    const nextDue = t.nextDue ?? (t.changedToday && days ? addDays(req.visitDate, days) : null);
    return { ...t, nextDue };
  });

  const changes = ensureIds(out.changes, "c");
  const plan = req.currentPlan ?? "";
  const transcriptText = segments.map((s) => s.text).join("");

  const analysis: Analysis = {
    summary: out.summary,
    speakers: speakerRoles(out.speakers, segments),
    vitals,
    findings,
    tubes,
    wounds: out.wounds,
    interventions: out.interventions,
    changes: [...changes, ...ensureIds(numericDeltaChanges(vitals, req.previous, changes), `c${changes.length + 1}-`)],
    planSuggestions: ensureIds(
      out.planSuggestions.filter((s) => !plan.includes(s.problem)),
      "s",
    ),
    educationTopics: out.educationTopics,
    redFlags: out.redFlags,
    docFacts: ensureIds(out.docFacts, "d"),
    documents: out.documents,
    identityConcern: out.identityConcern ?? (transcriptText ? identityConcernFromText(transcriptText, req.patient) : null),
    missingDomains: req.transcript ? out.missingDomains : [],
    languageNotes: out.languageNotes,
    conflicts: ensureIds(out.conflicts, "x"),
  };
  return polishAnalysis(deepTraditional(analysis, QUOTE_FIELDS));
}

const speakerKey = (id: string) => id.normalize("NFKC").replace(/\s+/g, "").toUpperCase();

/**
 * 講者代號 → 角色。鍵一律用逐字稿裡實際出現的代號（多段錄音為 P2-S1 這種形式），
 * 模型寫法略有出入（全形、大小寫、空白）時對回原代號；逐字稿沒有的代號不收。
 */
export function speakerRoles(list: { id: string; role: string }[], segments: TranscriptSegment[]): Record<string, string> {
  const ids = new Map<string, string>();
  for (const s of segments) if (s.speaker) ids.set(speakerKey(s.speaker), s.speaker);
  const out: Record<string, string> = {};
  for (const { id, role } of list) {
    const real = ids.get(speakerKey(id));
    if (real && !(real in out)) out[real] = role;
  }
  return out;
}

/** 分析中給人看的文字套用同樣的格式與用語（原句與依據保持原樣）。 */
function polishAnalysis(a: Analysis): Analysis {
  const p = (s: string) => polishText(s);
  return {
    ...a,
    summary: p(a.summary),
    vitals: a.vitals.map((v) => (v.key === "consciousness" ? { ...v, value: p(v.value) } : v)),
    findings: a.findings.map((f) => ({ ...f, text: p(f.text) })),
    tubes: a.tubes.map((t) => ({ ...t, detail: p(t.detail) })),
    wounds: a.wounds.map((w) => ({ ...w, detail: p(w.detail), care: w.care === null ? null : p(w.care) })),
    interventions: a.interventions.map(p),
    changes: a.changes.map((c) => ({ ...c, text: p(c.text) })),
    planSuggestions: a.planSuggestions.map((s) => ({ ...s, problem: p(s.problem), basis: p(s.basis) })),
    educationTopics: a.educationTopics.map(p),
    redFlags: a.redFlags.map(p),
    docFacts: a.docFacts.map((d) => ({ ...d, text: p(d.text) })),
  };
}

/* ============================== 數字白名單（N2） ============================== */

const NEUTRAL = "〔見生命徵象〕";

const LABELS: [RegExp, VitalKey | "any"][] = [
  [/體溫|耳溫|額溫|肛溫|腋溫|\bBT\b/, "temp"],
  [/脈搏|心跳|心率|\bHR\b|\bPR\b/, "pulse"],
  [/呼吸(?!道|音|聲|器|治療|訓練|照護|困難|型態|喘)|\bRR\b/, "resp"],
  [/血壓|收縮壓|舒張壓|\bBP\b/, "bp"],
  [/血氧|SpO2|SPO2|spo2/, "spo2"],
  [/血糖|\bGLU\b/, "glucose"],
  [/\bTPR\b|生命徵象/, "any"],
];

const TOKEN = /(?<![\d./])(\d{1,3}(?:\.\d+)?)(?:\/(\d{1,3}))?(?![\d/.])(\s*(?:℃|°C|度|%|％|mmHg|mg\/dL|次\/分鐘?|次|下|bpm))?/g;
const OTHER_UNIT =
  /^\s*(?:公分|cm|毫升|mL|ml|cc|CC|c\.c\.|公升|L\b|mg(?!\/)|公克|g\b|單位|IU|U\b|顆|錠|粒|包|支|瓶|罐|片|杯|匙|份|餐|劑|分鐘|小時|天|日|週|個月|月|年|歲|號|點|Fr|公斤|kg|頁|項|題|位|版|×|x\b|X\b|\*)/;
/**
 * 真正的比較詞才算門檻（「超過 38 度」「血糖低於 70」）。「達」「高達」「維持在」「控制在」「目標」
 * 常用來描述實際量到的值（體溫高達 38.6℃、血壓維持在 150/95 mmHg），不算門檻。
 */
const COMPARE_BEFORE = /(?:超過|高於|低於|大於|小於|多於|少於|不超過|不低於|未滿|未達|≥|≤|>|<|＞|＜|≧|≦)(?:或等於)?\s*$/;
const THRESHOLD_AFTER = /^\s*(?:以上|以下|以內)/;
/** 就醫警訊或照護目標的句子：帶 ℃／mmHg 的門檻只有在這類句子裡才可能是門檻。 */
const THRESHOLD_CONTEXT = /就醫|急診|送醫|119|立即|立刻|馬上|儘快|盡快|聯絡|通知|回診|警訊|目標/;
const STRONG_UNIT = /℃|°C|mmHg/;
const RANGE_BEFORE = /\d\s*[～~〜–—\-至到]\s*$/;
const RANGE_AFTER = /^\s*[～~〜–—\-至到]\s*\d/;
/** 句子以句號等切開；同一句中逗號、頓號後的數字沿用前面最近的生命徵象字眼。 */
const SENTENCE = /[^。！？\n]+/g;
const CLAUSE_BREAK = /[，、；：,;:]/g;

export interface NumberAllowList {
  byKey: Map<VitalKey, Set<number>>;
  any: Set<number>;
}

export function buildAllowList(
  confirmed: ConfirmedVital[],
  previous: PreviousVisit | null | undefined,
  docTexts: string[],
): NumberAllowList {
  const byKey = new Map<VitalKey, Set<number>>();
  for (const v of [...confirmed, ...(previous?.vitals ?? [])]) {
    const set = byKey.get(v.key) ?? new Set<number>();
    for (const n of numbersInText(normalizeVitalValue(v.key, v.value))) set.add(n);
    byKey.set(v.key, set);
  }
  const any = new Set<number>();
  for (const t of docTexts) for (const n of numbersInText(t)) any.add(n);
  return { byKey, any };
}

/** 依單位與字眼判斷是哪一項生命徵象；單位與字眼對不上（「血壓偏高，床頭抬高 30 度」）就不是生命徵象。 */
function keyForToken(u: string, hasSlash: boolean, decimal: boolean, label: VitalKey | "any" | null): VitalKey | null {
  if (hasSlash || u === "mmHg") return "bp";
  if (u === "mg/dL") return "glucose";
  if (u === "℃" || u === "°C") return "temp";
  if (u === "%" || u === "％") return label === "spo2" || label === "any" || label === null ? "spo2" : null;
  if (u === "度") return label === "temp" || (label === "any" && decimal) ? "temp" : null;
  if (u) return label === "pulse" || label === "resp" ? label : null; // 次/分、次、下、bpm
  if (label === "any") return decimal ? "temp" : null;
  return label;
}

/**
 * 門檻說法不算數值：真正的比較詞（超過、低於…）後面接整數，或數值後接「以上／以下／以內」。
 * 帶 ℃／mmHg 的值、小數、血壓（142/86）只有在就醫警訊或照護目標的句子裡才可能是門檻。
 */
function isThreshold(before: string, after: string, a: string, b: string | undefined, u: string, context: boolean): boolean {
  const plainInteger = !b && !a.includes(".") && !STRONG_UNIT.test(u);
  if (COMPARE_BEFORE.test(before)) {
    const integer = !b && !a.includes(".");
    return integer && (plainInteger || context);
  }
  if (THRESHOLD_AFTER.test(after)) return plainInteger || context;
  return false;
}

export interface NeutralizeOptions {
  /** 整段都是就醫警訊（衛教「出現這些情況…」段落）。 */
  redFlagSection?: boolean;
}

/**
 * 內文中的生命徵象數值必須屬於確認值、上次確認值或文件值（N2）；
 * 找不到依據的改成「〔見生命徵象〕」並回報。門檻（超過 38 度）與範圍（80～130）不算。
 */
export function neutralizeVitalNumbers(body: string, allow: NumberAllowList, opts: NeutralizeOptions = {}): { text: string; leaks: string[] } {
  const leaks: string[] = [];
  const text = body.replace(SENTENCE, (sentence) => {
    const labels = LABELS.flatMap(([re, key]) => {
      const m = new RegExp(re.source, "g");
      return [...sentence.matchAll(m)].map((x) => ({ key, at: x.index ?? 0 }));
    }).sort((a, b) => a.at - b.at);
    const breaks = [...sentence.matchAll(CLAUSE_BREAK)].map((m) => m.index ?? 0);
    const context = !!opts.redFlagSection || THRESHOLD_CONTEXT.test(sentence);
    return sentence.replace(TOKEN, (match, a: string, b: string | undefined, unit: string | undefined, offset: number) => {
      const u = (unit ?? "").trim();
      const before = sentence.slice(Math.max(0, offset - 8), offset);
      const after = sentence.slice(offset + match.length);
      if (!u && OTHER_UNIT.test(after)) return match;
      if (isThreshold(before, after, a, b, u, context)) return match;
      if (RANGE_BEFORE.test(before) || RANGE_AFTER.test(after)) return match;
      // 字眼：同一句中前面最近的一個；前面沒有時，才看同一個子句中後面的字眼
      const clauseStart = breaks.filter((x) => x < offset).reduce((_, x) => x + 1, 0);
      const clauseEnd = breaks.find((x) => x >= offset) ?? sentence.length;
      const prior = labels.filter((l) => l.at <= offset).pop();
      const label = prior ?? labels.find((l) => l.at > offset && l.at < clauseEnd);
      const carried = !!prior && prior.at < clauseStart;
      const key = keyForToken(u, !!b, a.includes("."), label?.key ?? null);
      if (!key) return match;
      // 沒有生命徵象字眼時，只抓明確的血壓（帶 mmHg）與體溫（小數＋℃）樣式
      if (!label && !((key === "bp" && u === "mmHg") || (key === "temp" && a.includes(".") && /℃|°C/.test(u)))) return match;
      if (key === "bp" && !b) return match;
      const value = b ? `${a}/${b}` : a;
      // 形狀明顯不是生命徵象的數字（例如「呼吸訓練 3 次」）不處理；體溫帶 ℃ 或同一子句的小數一律檢查（含 16.8 這類錯誤值）。
      // 從前面子句沿用字眼時一定要在合理範圍內，避免「體溫正常，傷口 2.5 x 3」這類誤判。
      const tempShaped = key === "temp" && (/℃|°C/.test(u) || (!carried && (a.includes(".") || u === "度")));
      if (!tempShaped && !isPlausible(key, value)) return match;
      const nums = b ? [Number(a), Number(b)] : [Number(a)];
      const ok = nums.every((x) => allow.byKey.get(key)?.has(x) || allow.any.has(x));
      if (ok) return match;
      leaks.push(match.trim());
      return NEUTRAL;
    });
  });
  return { text: text.replace(new RegExp(`[  ]+${NEUTRAL}`, "g"), NEUTRAL), leaks };
}

/* ============================== AI 界線與個資（N6、N10） ============================== */

const BOUNDARY: [RegExp, string][] = [
  [/(?:Barthel|Braden|ADL|IADL|MMSE|CDR|SPMSQ|巴氏|柏拉登|量表)[^。\n]{0,12}?\d+\s*分/i, "量表分數"],
  [/第\s*[一二三四1-4]\s*(?:級|期)|stage\s*[1-4IV]+|分期/i, "傷口或疾病分期"],
  [/(?:高|中|低)(?:度)?風險/, "風險分級"],
];

const PII: [RegExp, string][] = [
  [/\b[A-Z][12]\d{8}\b/g, "身分證字號"],
  [/(?<!\d)09\d{2}[-\s]?\d{3}[-\s]?\d{3}(?!\d)/g, "手機號碼"],
  [/(?<![\d/])0\d{1,2}-\d{3,4}-\d{4}(?!\d)/g, "電話號碼"],
];

/* ============================== 撰寫輸出檢核 ============================== */

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

export interface FinalizeDocResult {
  doc: GeneratedDoc;
  warnings: string[];
}

/** 就醫警訊段落（衛教「三、出現這些情況，請馬上聯絡護理師或就醫」）。 */
const RED_FLAG_HEADING = /就醫|警訊/;

const VITAL_SUBJECT = /^(?:\d+\.\s*)?(?:飯前|飯後)?(?:體溫|脈搏|心跳|呼吸(?!道|音|聲)|血壓|血氧|血糖|生命徵象)/;

/** 模型輸出（或示範輸出）→ 依模板組成最終文件，附輸出檢核提醒。 */
export function finalizeDoc(out: DocOutput, req: GenerateRequest): FinalizeDocResult {
  const warnings: string[] = [];
  const label = DOC_LABEL[req.kind];
  const ai = out.sections.map((s) => ({ heading: s.heading.trim(), body: s.body ?? "" }));
  let sections: DocSection[];

  const take = (map: Map<string, string>, h: string, required = true) => {
    const body = map.get(h);
    if (body !== undefined && body.trim()) return body;
    if (required) warnings.push(`${label}缺少「${h}」，已暫填「${NOT_ASSESSED_SENTENCE}」。`);
    return NOT_ASSESSED_SENTENCE;
  };
  const confirmed = req.confirmedVitals.filter((v) => v.value.trim());

  if (req.kind === "record" && req.intakeOnly) {
    const { byHeading, extra } = matchSections(ai.filter((s) => !/^資料來源/.test(s.body.trim()) || s.heading), INTAKE_HEADINGS);
    sections = [sec("", sourceLine(req)), ...INTAKE_HEADINGS.map((h) => sec(h, take(byHeading, h))), ...extraSections(extra, warnings, label)];
  } else if (req.kind === "record" && req.options.recordStyle === "narrative") {
    const body = ai.map((s) => s.body.trim()).filter(Boolean).join("\n");
    sections = [sec(RECORD_NARRATIVE_HEADING, body || NOT_ASSESSED_SENTENCE)];
  } else if (req.kind === "record") {
    const { byHeading, extra } = matchSections(ai, RECORD_HEADINGS);
    const other = (byHeading.get(RECORD_HEADINGS[1]) ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !VITAL_SUBJECT.test(l) && l !== NOT_ASSESSED_SENTENCE && !l.includes("本次生命徵象未見異常"))
      .map((l) => l.replace(/^\d+\.\s*/, ""));
    sections = [
      sec(RECORD_HEADINGS[0], take(byHeading, RECORD_HEADINGS[0])),
      sec(RECORD_HEADINGS[1], composeAlertBody(vitalAlertLines(confirmed, req.previous), other, alertStatus(req))),
      sec(RECORD_HEADINGS[2], take(byHeading, RECORD_HEADINGS[2], false)),
      sec(RECORD_HEADINGS[3], take(byHeading, RECORD_HEADINGS[3])),
      ...extraSections(extra, warnings, label),
    ];
  } else if (req.kind === "plan") {
    const { byHeading, extra } = matchSections(
      ai.filter((s) => !/^依據/.test(s.heading) && !(s.heading === "" && /^依據/.test(s.body.trim()))),
      PLAN_HEADINGS,
    );
    const dx = (byHeading.get(PLAN_HEADINGS[1]) ?? "")
      .split("\n")
      // 本次的異常值行由程式依確認值產生；收案（只有文件）時保留 AI 依文件寫的異常值行
      .filter((l) => l.trim() && (req.intakeOnly || !/^\s*異常值/.test(l)))
      .join("\n");
    const abnormal = req.intakeOnly ? null : abnormalValuesLine(confirmed, req.visitDate);
    const problems = renumberProblems(take(byHeading, PLAN_HEADINGS[2]));
    sections = [
      sec("", basisLine(req)),
      sec(PLAN_HEADINGS[0], take(byHeading, PLAN_HEADINGS[0])),
      sec(PLAN_HEADINGS[1], [dx.trim() || "未提供病摘，待補。", abnormal].filter(Boolean).join("\n")),
      sec(PLAN_HEADINGS[2], problems),
      sec(PLAN_HEADINGS[3], take(byHeading, PLAN_HEADINGS[3])),
      sec(PLAN_HEADINGS[4], take(byHeading, PLAN_HEADINGS[4])),
      ...extraSections(extra, warnings, label),
    ];
    warnings.push(...planWarnings(problems, req.currentPlan));
  } else {
    const eduHeadings = Object.values(EDU_HEADINGS);
    const untitled = ai.filter((s) => s.heading === "");
    const opening = untitled.find((s) => !s.body.includes(EDU_CLOSING))?.body ?? "";
    // 其他無標題段落：去掉固定結語與署名（前端會加）後仍有內容才列為多出的段落
    const signature = (l: string) => /電話[：:]|\d{2,4}-\d{3,4}-\d{3,4}/.test(l) || (!!req.options.nurseName && l.includes(req.options.nurseName));
    const strays = untitled
      .filter((s) => s.body !== opening)
      .map((s) => ({ heading: "", body: s.body.replaceAll(EDU_CLOSING, "").split("\n").filter((l) => l.trim() && !signature(l)).join("\n") }));
    const { byHeading, extra } = matchSections(
      ai.filter((s) => s.heading !== ""),
      eduHeadings,
    );
    extra.push(...strays);
    const hasTubes = req.analysis.tubes.length > 0 || byHeading.has(EDU_HEADINGS.tubes);
    sections = [
      ...(opening.trim() ? [sec("", opening)] : []),
      sec(EDU_HEADINGS.attention, take(byHeading, EDU_HEADINGS.attention)),
      sec(EDU_HEADINGS.daily, take(byHeading, EDU_HEADINGS.daily)),
      ...(hasTubes && byHeading.get(EDU_HEADINGS.tubes)?.trim() ? [sec(EDU_HEADINGS.tubes, byHeading.get(EDU_HEADINGS.tubes)!)] : []),
      sec(EDU_HEADINGS.redFlags, take(byHeading, EDU_HEADINGS.redFlags)),
      ...extraSections(extra, warnings, label),
    ].map((s) => ({ ...s, body: s.body.replaceAll(EDU_CLOSING, "").trim() }));
  }

  // 格式、繁體、個資、數字白名單、AI 界線
  // 護理師填寫的全人評估（只交給護理計畫）是數字來源：「Braden 12 分」不算外洩；身體評估的生命徵象不算，以本次確認值為準。
  const assessment = req.kind === "plan" ? assessmentForWriting(req.assessment) : null;
  const allow = buildAllowList(confirmed, req.previous, [
    ...req.analysis.docFacts.filter((f) => !f.unclear).map((f) => f.text),
    ...(assessment ? [assessment] : []),
  ]);
  const sourced = sourcedByAssessment(assessment);
  const name = req.patient.displayName.trim();
  const subject = req.kind === "edu" ? req.patient.familyCallsAs?.trim() || "長輩" : "個案";
  sections = sections.map((s) => {
    let body = polishText(toTraditionalSafe(s.body), { edu: req.kind === "edu" });
    if (name.length >= 2) body = body.replaceAll(name, subject);
    for (const [re, what] of PII) {
      if (re.test(body)) warnings.push(`${label}出現疑似${what}，已遮蔽。`);
      body = body.replace(re, "〔已遮蔽〕");
    }
    const { text, leaks } = neutralizeVitalNumbers(body, allow, { redFlagSection: RED_FLAG_HEADING.test(s.heading) });
    for (const leak of leaks) {
      warnings.push(`${label}${s.heading ? `「${s.heading}」` : ""}出現找不到依據的生命徵象數值「${leak}」，已改為${NEUTRAL}，請以生命徵象行為準。`);
    }
    for (const [re, what] of BOUNDARY) {
      const hits = [...text.matchAll(new RegExp(re.source, `${re.flags}g`))].map((m) => m[0]);
      if (hits.some((h) => !sourced(h, what))) {
        warnings.push(`${label}${s.heading ? `「${s.heading}」` : ""}疑似包含${what}，AI 不應自行判定，請確認是否有來源。`);
      }
    }
    return { heading: s.heading, body: text };
  });

  if (req.kind === "edu") {
    sections.push(sec("", EDU_CLOSING));
    const chars = sections.map((s) => s.body).join("").replace(/\s/g, "").length;
    if (chars > EDU_MAX_CHARS) warnings.push(`家屬衛教約 ${chars} 字，超過建議的 ${EDU_MAX_CHARS} 字，可按「更精簡」重新產生。`);
  }
  return { doc: { kind: req.kind, sections }, warnings: [...new Set(warnings)] };
}

const sec = (heading: string, body: string): DocSection => ({ heading, body });

const compact = (s: string) => s.replace(/\s/g, "");

/**
 * AI 界線的例外：分數、等級若來自護理師填寫的全人評估就不提醒。
 * 量表分數看數字是否都出現在評估中（「Braden 12 分」對「Braden 壓傷 12分」）；其他看原字串是否出現在評估中。
 */
function sourcedByAssessment(assessment: string | null): (hit: string, what: string) => boolean {
  if (!assessment) return () => false;
  const text = compact(assessment);
  const nums = new Set(numbersInText(assessment));
  return (hit, what) => {
    if (text.includes(compact(hit))) return true;
    if (what !== "量表分數") return false;
    const n = (hit.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
    return n.length > 0 && n.every((x) => nums.has(x));
  };
}

function extraSections(extra: DocSection[], warnings: string[], label: string): DocSection[] {
  for (const s of extra) if (s.body.trim()) warnings.push(`${label}有不在模板中的段落「${s.heading || "（無標題）"}」，請確認內容。`);
  return extra.filter((s) => s.body.trim());
}

function alertStatus(req: GenerateRequest) {
  const confirmed = req.confirmedVitals.filter((v) => v.value.trim());
  const keys = new Set(confirmed.map((v) => v.key));
  const confirmedNumeric = confirmed.filter((v) => v.key !== "consciousness" && isPlausible(v.key, v.value)).length;
  const pending = new Set(req.analysis.vitals.filter((v) => v.key !== "consciousness" && !keys.has(v.key)).map((v) => v.key)).size;
  return { confirmedNumeric, pending };
}

function docList(req: GenerateRequest, withPages: boolean): string | null {
  const docs = req.analysis.documents;
  if (docs.length === 0) return null;
  return docs
    .map((d) => {
      const meta = [d.date ? slashDate(d.date) : null, withPages && d.pages ? `共 ${d.pages} 頁` : null].filter(Boolean).join("，");
      return meta ? `${d.title}（${meta}）` : d.title;
    })
    .join("、");
}

export function sourceLine(req: GenerateRequest): string {
  return `資料來源：${docList(req, true) ?? "匯入文件"}`;
}

export function basisLine(req: GenerateRequest): string {
  const docs = docList(req, false);
  // 有全人評估時放最前面：「依據：全人評估（13 項）及 2026/10/02 訪視評估」
  const assessed = assessmentBasisLabel(req.assessment);
  if (req.intakeOnly) return `依據：${[assessed, docs].filter(Boolean).join("、") || "匯入文件"}`;
  return `依據：${assessed ? `${assessed}及 ` : ""}${slashDate(req.visitDate)} 訪視評估${docs ? `、${docs}` : ""}`;
}

/** 「問題 n：」依出現順序重新連號。 */
export function renumberProblems(body: string): string {
  let n = 0;
  return body.replace(/^(\s*)(?:護理)?問題\s*\d+\s*[：:]/gm, (_m, indent: string) => `${indent}問題 ${++n}：`);
}

const looseNorm = (s: string) =>
  norm(s)
    .replace(/[〜~–—-]/g, "～")
    .replace(/兩/g, "2")
    .replace(/[。]/g, "");

/** 沿用的問題要逐字保留現行計畫的目標與措施（carried）；題數上限。 */
export function planWarnings(problemsBody: string, currentPlan: string | null): string[] {
  const warnings: string[] = [];
  const now = parsePlanProblems(problemsBody);
  if (now.length > PLAN_MAX_PROBLEMS) warnings.push(`護理計畫有 ${now.length} 個問題，超過建議的 ${PLAN_MAX_PROBLEMS} 個。`);
  const before = parsePlanProblems(currentPlan);
  now.forEach((p, i) => {
    if (p.tag !== "沿用") return;
    const src = before.find((b) => looseNorm(b.title) === looseNorm(p.title)) ?? before.find((b) => looseNorm(p.title).includes(looseNorm(b.title)));
    if (!src) {
      warnings.push(`護理計畫問題 ${i + 1}「${p.title}」標為沿用，但現行計畫中找不到這個問題，請核對。`);
      return;
    }
    const got = looseNorm([p.goal ?? "", ...p.measures].join(""));
    const missing = [src.goal, ...src.measures].filter((x): x is string => !!x).filter((x) => !got.includes(looseNorm(x)));
    if (missing.length) warnings.push(`護理計畫問題 ${i + 1}「${p.title}」的沿用內容與現行計畫原文不一致，請核對。`);
  });
  return warnings;
}

/** 翻譯輸出：去掉模型自行加上的前綴，統一加上語言標示行。 */
export function finalizeTranslation(prefix: string, translation: string): string {
  const body = translation
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*【[^】]*AI 翻譯[^】]*】\s*\n?/, "")
    .replace(/[ \t]+$/gm, "")
    .trim();
  return `${prefix}\n${body}`;
}
