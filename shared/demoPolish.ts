/**
 * 示範用的口述計畫整理（沒有 AI 金鑰時的伺服器回應，也是本機／試用版的引擎）。
 * 只做決定性的切句與歸段：輸出的每一段都是口述原文（去贅詞後）的片段，不改數字、不新增內容；
 * 「依據：」行由 finalizePolishedPlanCore 加上（伺服器與本機共用）。純 TypeScript、無 Node 依賴。
 */
import { NOT_MENTIONED_SENTENCE, finalizePolishedPlanCore, normalizeDictation } from "./planPolish";
import { PLAN_HEADINGS } from "./templates";
import type { DocSection, GeneratedDoc, PolishPlanRequest } from "./types";

export { normalizeDictation } from "./planPolish";

/**
 * 句首的問題標記：「第一個問題是」「第 2 個護理問題」「問題一：」「問題1」「另外還有一個問題是」，
 * 前面可以有口語的接話（好，那第二個問題是…、再來第二個問題是…）；接話一併去掉，不放進題目。
 */
const PROBLEM_MARKER =
  /^(?:(?:好的?|那麼?|再來|接下來|接著|另外|還有|然後|最後)[，、,\s]*)*(?:第\s*([一二三四五六七八九十\d]+)\s*個?\s*(?:護理)?問題|(?:護理)?問題\s*(?!一(?:直|定|樣|般|起|些|下|點))([一二三四五六七八九十\d]+)|下?一個(?:護理)?問題(?=\s*(?:是|：|:)))\s*(?:是|：|:)?\s*/;
const FAMILY_START = /^(?:家屬|照顧者|主要照顧者)/;
const FAMILY_WHO = /家屬|女兒|兒子|先生|太太|看護|照顧者/;
const FAMILY_DOES = /願意|負責|會幫|幫忙|協助/;
const FAMILY_LEAD = /^(?:家屬|照顧者|主要照顧者)的?(?:部分|方面)[，、：:]?\s*/;
const SUMMARY_START = /^(?:下次|整體|追蹤)/;
const DIAGNOSIS = /診斷|病史/;
const GOAL = /^(?:護理)?目標(?:是|：|:)?\s*/;
const MEASURE = /^(?:護理)?措施(?:是|：|:)?\s*/;
const EVALUATION = /^評值(?:是|：|:)?\s*/;
/** 只有贅字的句子或子句（好、對）。 */
const JUNK = /^(?:好|好的|對|是|喔|哦|啊|那|OK|ok)$/;
/** 只是在說這題沿用／調整／新增（當作標記，不當內容）。 */
const TAG_ONLY = /^(?:這(?:個|題)?(?:問題)?)?(?:繼續|本次|這次)?(?:沿用|調整|新增)(?:的)?(?:問題)?$/;
/** 口述明說要調整這題（「不要自己調整」「醫師調整劑量」不算）。 */
const ADJUST = /(?:目標|措施|計畫|問題)[^，。；]{0,6}調整|調整[^，。；]{0,4}(?:目標|措施|計畫)|^調整$/;

type Label = "basis" | "goal" | "measures" | "evaluation";

interface Problem {
  title: string;
  /** 屬於這題的口述（判斷沿用、調整、新增）。 */
  said: string[];
  basis: string[];
  goal: string[];
  measures: string[];
  evaluation: string[];
  label: Label | null;
}

const clean = (s: string) => s.replace(/^[\s，、；：,;:]+|[\s，、；：。,;:.]+$/g, "");

/** 題目內的子句：「目標…」「措施…」（一個子句一項）「評值…」，其他接在目前的項目後面，還沒有項目時是「依據」。 */
function route(p: Problem, sentence: string): void {
  for (const raw of sentence.split(/[，；]/)) {
    let c = clean(raw);
    if (!c || JUNK.test(c)) continue;
    if (TAG_ONLY.test(c)) {
      p.said.push(c);
      continue;
    }
    let m: RegExpExecArray | null;
    if ((m = GOAL.exec(c))) p.label = "goal";
    else if ((m = MEASURE.exec(c))) p.label = "measures";
    else if ((m = EVALUATION.exec(c))) p.label = "evaluation";
    else p.label ??= "basis";
    if (m) c = clean(c.slice(m[0].length));
    if (c) p[p.label].push(c);
  }
}

function tagOf(p: Problem, hasCurrentPlan: boolean): string {
  const said = p.said.join("。");
  if (/沿用/.test(said)) return "（沿用）";
  if (p.said.some((s) => ADJUST.test(s))) return "（調整）";
  if (/新增/.test(said) || !hasCurrentPlan) return "（本次新增）";
  return "";
}

function problemLines(p: Problem, n: number, hasCurrentPlan: boolean): string[] {
  const line = (label: string, parts: string[]) => (parts.length ? [`　${label}：${parts.join("，")}。`] : []);
  return [
    `問題 ${n}：${p.title}${tagOf(p, hasCurrentPlan)}`,
    ...line("依據", p.basis),
    ...line("目標", p.goal),
    ...(p.measures.length ? [`　措施：${p.measures.map((m, i) => `(${i + 1}) ${m}。`).join("")}`] : []),
    ...line("評值", p.evaluation),
  ];
}

const prose = (sentences: string[]) => (sentences.length ? sentences.map((s) => `${s}。`).join("") : NOT_MENTIONED_SENTENCE);

/** 示範整理：切句 → 歸段（問題、家屬、下次訪視、診斷）→ 依計畫格式排好。沒有問題標記時，內容依序編號放在「三」。 */
export function demoPolishPlan(req: PolishPlanRequest): { sections: DocSection[] } {
  const sentences = normalizeDictation(req.dictation)
    .split(/[。！？\n]/)
    .map(clean)
    .filter((s) => s && !JUNK.test(s));
  const hasMarkers = sentences.some((s) => PROBLEM_MARKER.test(s));
  const intro: string[] = [];
  const dx: string[] = [];
  const family: string[] = [];
  const summary: string[] = [];
  const loose: string[] = [];
  const problems: Problem[] = [];
  let cur: Problem | null = null;

  for (const s of sentences) {
    const marker = PROBLEM_MARKER.exec(s);
    if (marker) {
      const rest = clean(s.slice(marker[0].length));
      const cut = rest.indexOf("，");
      cur = { title: clean(cut < 0 ? rest : rest.slice(0, cut)), said: [s], basis: [], goal: [], measures: [], evaluation: [], label: null };
      problems.push(cur);
      if (cut >= 0) route(cur, rest.slice(cut + 1));
      continue;
    }
    // 題目內以「目標／措施／評值」開頭的句子一定屬於這題
    const labelled = !!cur && (GOAL.test(s) || MEASURE.test(s) || EVALUATION.test(s));
    if (!labelled && (FAMILY_START.test(s) || (FAMILY_WHO.test(s) && FAMILY_DOES.test(s)))) {
      const who = clean(s.replace(FAMILY_LEAD, ""));
      if (who) family.push(who);
    } else if (!labelled && SUMMARY_START.test(s)) summary.push(s);
    else if (!labelled && DIAGNOSIS.test(s)) dx.push(s);
    else if (cur) {
      cur.said.push(s);
      route(cur, s);
    } else (hasMarkers ? intro : loose).push(s);
  }

  const three = hasMarkers ? problems.flatMap((p, i) => problemLines(p, i + 1, req.hasCurrentPlan)) : loose.map((s, i) => `${i + 1}. ${s}。`);
  return {
    sections: [
      { heading: PLAN_HEADINGS[0], body: prose(intro) },
      { heading: PLAN_HEADINGS[1], body: prose(dx) },
      { heading: PLAN_HEADINGS[2], body: three.length ? three.join("\n") : NOT_MENTIONED_SENTENCE },
      { heading: PLAN_HEADINGS[3], body: prose(family) },
      { heading: PLAN_HEADINGS[4], body: prose(summary) },
    ],
  };
}

/** 本機／試用版的口述整理：示範整理＋與伺服器相同的收尾與檢查。 */
export function localPolishPlan(req: PolishPlanRequest): { doc: GeneratedDoc; warnings: string[] } {
  return finalizePolishedPlanCore(demoPolishPlan(req), req);
}
