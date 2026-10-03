/**
 * 全人評估（13 張表）：初次訪視時護理師填寫，前端整理成「一張表一行」的摘要放在 GenerateRequest.assessment，
 * 例如「Braden 壓傷 12分（高危險）：感知能力 非常受限、潮濕程度 持續潮濕…」（計分表只列失分的項目）。
 * 這裡是摘要的解析與「評估風險 → 護理問題」對應規則；伺服器的提示詞、輸出檢核與示範引擎共用同一份。
 * 純 TypeScript、無 Node 依賴（前端也會打包）。
 */

/** 摘要字數上限（請求驗證用）。 */
export const ASSESSMENT_MAX_CHARS = 6000;

/** 全人評估的表單數（不含基本資料）。 */
export const ASSESSMENT_FORM_COUNT = 13;

export type AssessmentFormId =
  | "basic"
  | "habits"
  | "history"
  | "meds"
  | "physical"
  | "braden"
  | "fall"
  | "adl"
  | "iadl"
  | "cognitive"
  | "emotional"
  | "nutrition"
  | "pain"
  | "frailty";

/** 行首名稱（前端的表單短名與常見別名）→ 表單；IADL 要排在 ADL 前面。 */
const FORM_NAMES: [AssessmentFormId, RegExp][] = [
  ["basic", /基本資料/],
  ["habits", /健康習慣/],
  ["history", /疾病史|過去病史/],
  ["meds", /藥物安全|用藥安全/],
  ["physical", /身體評估/],
  ["braden", /Braden|壓傷|壓力性損傷/i],
  ["fall", /跌倒|Morse/i],
  ["iadl", /IADL|工具性/i],
  ["adl", /ADL|巴氏|Barthel/i],
  ["cognitive", /認知|SPMSQ/i],
  ["emotional", /情緒|BSRS/i],
  ["nutrition", /營養|MNA/i],
  ["pain", /疼痛|NPRS/i],
  ["frailty", /衰弱|Fried/i],
];

/** 引用分數時用的量表名稱，例如「Braden 12 分（高危險）」。 */
export const SCALE_NAME: Partial<Record<AssessmentFormId, string>> = {
  braden: "Braden",
  fall: "Morse",
  adl: "ADL",
  iadl: "IADL",
  cognitive: "SPMSQ",
  emotional: "BSRS-5",
  nutrition: "MNA-SF",
  pain: "NPRS",
  frailty: "Fried",
};

export interface AssessmentItem {
  /** 無法辨識的行為 null（只當作背景文字）。 */
  form: AssessmentFormId | null;
  /** 行首名稱，例如「Braden 壓傷」。 */
  name: string;
  score: number | null;
  /** 「分」或「項」。 */
  unit: string | null;
  /** 括號內的等級，例如「高危險」。 */
  level: string | null;
  /** 冒號後的內容（失分項目或填寫內容）。 */
  detail: string;
  line: string;
}

const LINE = /^([^：:\n]+?)(?:\s*(\d+(?:\.\d+)?)\s*(分|項)(?:\s*[（(]([^）)\n]*)[）)])?)?\s*(?:[：:]\s*(.*))?$/;
const BULLET = /^(?:\d{1,2}[.、．]|[-・•*])\s*/;

function formOf(name: string): AssessmentFormId | null {
  return FORM_NAMES.find(([, re]) => re.test(name))?.[0] ?? null;
}

/** 解析摘要：一行一張表；空白行與無法解析的內容略過。 */
export function parseAssessment(text: string | null | undefined): AssessmentItem[] {
  if (!text?.trim()) return [];
  const out: AssessmentItem[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().replace(BULLET, "");
    if (!line) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    out.push({
      form: formOf(name),
      name,
      score: m[2] !== undefined ? Number(m[2]) : null,
      unit: m[3] ?? null,
      level: m[4]?.trim() || null,
      detail: (m[5] ?? "").trim(),
      line,
    });
  }
  return out;
}

/** 以「、」「；」切開項目（括號內的頓號不切，例如「個人修飾（洗臉、梳頭） 需協助」）。 */
export function splitItems(detail: string): string[] {
  const items: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of detail) {
    if (ch === "（" || ch === "(") depth++;
    else if ((ch === "）" || ch === ")") && depth > 0) depth--;
    if (depth === 0 && (ch === "、" || ch === "；" || ch === ";")) {
      if (cur.trim()) items.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) items.push(cur.trim());
  return items;
}

/** 有分數的表：「Braden 12 分（高危險）」；withLevel=false 時只寫「Braden 12 分」。 */
export function citeScore(item: AssessmentItem, withLevel = true): string {
  const scale = (item.form && SCALE_NAME[item.form]) || item.name;
  if (item.score === null) return scale;
  const head = `${scale} ${item.score} ${item.unit ?? "分"}`;
  return withLevel && item.level ? `${head}（${item.level}）` : head;
}

/** 已完成的表單數（不含基本資料）；摘要格式無法辨識時為 0。 */
export function assessmentFormCount(text: string | null | undefined): number {
  return new Set(parseAssessment(text).map((i) => i.form).filter((f) => f && f !== "basic")).size;
}

/** 依據行用的名稱：「全人評估（13 項）」；沒有評估時為 null。 */
export function assessmentBasisLabel(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const n = assessmentFormCount(text);
  return n > 0 ? `全人評估（${n} 項）` : "全人評估";
}

/* ------------------------------ 生命徵象 ------------------------------ */

/** 身體評估中的生命徵象項目（以本次確認值為準，不交給撰寫、也不列入數字白名單）。 */
const VITAL_ITEM = /^(?:體溫|耳溫|額溫|脈搏|心跳|心率|呼吸(?!道|音|聲)|收縮壓|舒張壓|血壓|血氧|SpO2|血糖)/i;

/**
 * 給撰寫與輸出檢核用的摘要：去掉身體評估裡的生命徵象（體溫、脈搏、呼吸、血壓、血氧、血糖），
 * 避免評估當時的數值蓋過本次已確認的生命徵象。其他內容原樣保留。
 */
export function assessmentForWriting(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((raw) => {
      const line = raw.trim();
      const at = line.search(/[：:]/);
      if (at < 0 || formOf(line.slice(0, at)) !== "physical") return line;
      const kept = splitItems(line.slice(at + 1)).filter((x) => !VITAL_ITEM.test(x));
      return kept.length ? `${line.slice(0, at)}：${kept.join("、")}` : "";
    })
    .filter(Boolean);
  return lines.length ? lines.join("\n") : null;
}

/* ------------------------------ 風險 → 護理問題 ------------------------------ */

const SUICIDE = /自殺意念\s*[：:]?\s*(?:有|是)/;
const POLYPHARMACY = /多重用藥(?:（[^）]*）|\([^)]*\))?\s*[：:]?\s*是/;
const HIGH_RISK_MEDS = /高風險藥物(?:（[^）]*）|\([^)]*\))?\s*[：:]?\s*是/;
const MED_POSITIVE = /(?:多重用藥|高風險藥物|成藥|中草藥).*?\s是$|遵從性\s*(?:偶爾忘記|經常忘記)/;

export interface AssessmentRule {
  form: AssessmentFormId;
  /** 護理問題名稱。 */
  problem: string;
  /** 提示詞中的條件說明。 */
  when: string;
  /** 已有同類問題時（例如逐字稿的「皮膚完整性受損（薦骨壓傷）」）合併，不重複列題。 */
  covers: RegExp;
  test: (item: AssessmentItem) => boolean;
}

const scoreAt = (pred: (n: number) => boolean) => (i: AssessmentItem) => i.score !== null && pred(i.score);

/** 依優先順序排列（自殺意念最優先）。 */
export const ASSESSMENT_RULES: readonly AssessmentRule[] = [
  { form: "emotional", problem: "有自殺的危險", when: "情緒 BSRS-5 有自殺意念（最優先）", covers: /自殺/, test: (i) => SUICIDE.test(i.detail) },
  { form: "braden", problem: "皮膚完整性受損的危險性", when: "Braden ≤16 分（已有壓傷時寫皮膚完整性受損）", covers: /皮膚|壓傷/, test: scoreAt((n) => n <= 16) },
  { form: "fall", problem: "有跌倒的危險", when: "跌倒 Morse ≥25 分", covers: /跌倒/, test: scoreAt((n) => n >= 25) },
  { form: "nutrition", problem: "營養不均衡（少於身體需要）", when: "營養 MNA-SF ≤11 分", covers: /營養/, test: scoreAt((n) => n <= 11) },
  { form: "pain", problem: "疼痛", when: "疼痛 NPRS ≥4 分", covers: /疼痛/, test: scoreAt((n) => n >= 4) },
  { form: "adl", problem: "自我照顧能力缺失", when: "ADL（巴氏）≤60 分", covers: /自我照顧/, test: scoreAt((n) => n <= 60) },
  { form: "cognitive", problem: "記憶障礙", when: "認知 SPMSQ 答錯 ≥3 題（記憶／認知功能障礙相關問題）", covers: /記憶|認知|混亂/, test: scoreAt((n) => n >= 3) },
  { form: "emotional", problem: "焦慮／憂鬱", when: "情緒 BSRS-5 ≥6 分", covers: /焦慮|憂鬱|情緒/, test: scoreAt((n) => n >= 6) },
  { form: "frailty", problem: "衰弱", when: "衰弱 Fried ≥3 項", covers: /衰弱/, test: scoreAt((n) => n >= 3) },
  {
    form: "meds",
    problem: "藥物使用安全",
    when: "藥物安全：多重用藥或使用高風險藥物",
    covers: /藥物|用藥/,
    test: (i) => POLYPHARMACY.test(i.detail) || HIGH_RISK_MEDS.test(i.detail),
  },
];

export interface AssessmentRisk {
  rule: AssessmentRule;
  item: AssessmentItem;
  /** 依據的開頭：「Braden 12 分（高危險）」；藥物安全為「藥物安全評估」。 */
  cite: string;
  /** 依據引用的失分或陽性項目（最多 3 項）。 */
  items: string[];
}

/** 題目本身含頓號（「感覺憂鬱、心情低落 輕微」）時，切開的前半段沒有答案（沒有空白），併回下一項。 */
function joinLabelFragments(pieces: string[]): string[] {
  const out: string[] = [];
  let carry = "";
  for (const p of pieces) {
    if (!/\s/.test(p)) {
      carry += `${p}、`;
      continue;
    }
    out.push(carry + p);
    carry = "";
  }
  if (carry) out.push(carry.replace(/、$/, ""));
  return out;
}

function citedItems(rule: AssessmentRule, item: AssessmentItem): string[] {
  const all = joinLabelFragments(splitItems(item.detail));
  if (rule.form === "meds") return all.filter((x) => MED_POSITIVE.test(x)).slice(0, 3);
  if (rule.problem === "有自殺的危險") return all.filter((x) => SUICIDE.test(x)).slice(0, 1);
  return all.filter((x) => !/自殺意念/.test(x)).slice(0, 3);
}

/** 摘要中符合規則的風險（依規則的優先順序；同一張表的同一規則只列一次）。 */
export function assessmentRisks(text: string | null | undefined): AssessmentRisk[] {
  const items = parseAssessment(text);
  const out: AssessmentRisk[] = [];
  for (const rule of ASSESSMENT_RULES) {
    const item = items.find((i) => i.form === rule.form && rule.test(i));
    if (!item) continue;
    const cite = rule.form === "meds" ? "藥物安全評估" : citeScore(item);
    out.push({ rule, item, cite, items: citedItems(rule, item) });
  }
  return out;
}

/** 評估摘要用的分數重點：身體（ADL、IADL、Braden、Morse、MNA-SF、NPRS、Fried）與心理（SPMSQ、BSRS-5、自殺意念）。 */
export function assessmentHighlights(text: string | null | undefined): { body: string[]; mind: string[] } {
  const items = parseAssessment(text).filter((i) => i.score !== null);
  const pick = (forms: AssessmentFormId[]) =>
    forms.flatMap((f) => items.filter((i) => i.form === f).slice(0, 1)).map((i) => citeScore(i));
  const mind = pick(["cognitive", "emotional"]);
  if (parseAssessment(text).some((i) => i.form === "emotional" && SUICIDE.test(i.detail))) mind.push("有自殺意念");
  return { body: pick(["adl", "iadl", "braden", "fall", "nutrition", "pain", "frailty"]), mind };
}
