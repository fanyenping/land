/**
 * 示範引擎（沒有 AI 金鑰時的伺服器回應，也是前端離線時的備援）。
 * 內容全部虛構；只有示範逐字稿與示範文件會得到完整內容，其他輸入只做誠實的最小整理，不編造事實。
 * 純 TypeScript、無 Node 依賴（前端也會打包）。
 */
import {
  abnormalValuesLine,
  ensureIds,
  finalizeVitals,
  identityConcernFromText,
  isPlausible,
  numericDeltaChanges,
  vitalAlertLines,
  type ConfirmedVital,
} from "./clinical";
import { DEMO_SEGMENTS, DEMO_SPEAKERS } from "./demoTranscript";
import {
  EDU_CLOSING,
  EDU_HEADINGS,
  INTAKE_HEADINGS,
  NOT_ASSESSED_SENTENCE,
  PLAN_HEADINGS,
  RECORD_HEADINGS,
  RECORD_NARRATIVE_HEADING,
  TRANSLATION_PREFIX,
  VITALS_NORMAL_SENTENCE,
  addDays,
  composeAlertBody,
  parsePlanProblems,
  plainDate,
  slashDate,
  tubeIntervalDays,
  type PlanProblem,
} from "./templates";
import type {
  Analysis,
  AnalyzeRequest,
  DocFact,
  DocSection,
  DocumentSummary,
  Finding,
  GenerateRequest,
  GeneratedDoc,
  PlanSuggestion,
  Transcript,
  TranslateLang,
  TranslateRequest,
  VitalReading,
} from "./types";

export const DEMO_VISIT_SUMMARY = "換鼻胃管及壓傷換藥；痰液增加黃黏、右下肺痰音，3 天未解便。";
export const DEMO_INTAKE_SUMMARY = "依出院病摘收案：腦梗塞後遺症、糖尿病、高血壓，留置鼻胃管與導尿管。";
const OFFLINE_NOTE = "示範模式沒有連接 AI 服務，未整理實際錄音內容。";

/* ================================ 分析 ================================ */

function quote(snippet: string): { sourceQuote: string; sourceMs: number } {
  const seg = DEMO_SEGMENTS.find((s) => s.text.includes(snippet));
  if (!seg) throw new Error(`示範逐字稿找不到原句：${snippet}`);
  return { sourceQuote: snippet, sourceMs: seg.startMs };
}

/** 逐字稿是否為內建的示範逐字稿（多數段落相同即視為示範）。 */
export function isDemoTranscript(t: Transcript | null): boolean {
  if (!t || t.segments.length === 0) return false;
  const texts = new Set(t.segments.map((s) => s.text.trim()));
  const hits = DEMO_SEGMENTS.filter((s) => texts.has(s.text)).length;
  return hits / DEMO_SEGMENTS.length >= 0.6;
}

const yearOf = (iso: string) => (/^\d{4}/.exec(iso)?.[0] ?? "2026");

function vital(
  key: VitalReading["key"],
  value: string,
  snippet: string,
  confidence: number,
  qualifier: string | null = null,
): VitalReading {
  return { key, value, qualifier, ...quote(snippet), confidence, status: "ok", suggestion: null, reason: null, flag: null };
}

function finding(domain: string, text: string, snippet: string): Finding {
  return { domain, text, ...quote(snippet), origin: "audio" };
}

function notesFinding(notes: string | null): Finding[] {
  const t = notes?.trim();
  return t ? [{ domain: "其他", text: t, sourceQuote: t, sourceMs: null, origin: "typed" }] : [];
}

function emptyAnalysis(summary: string): Analysis {
  return {
    summary,
    speakers: {},
    vitals: [],
    findings: [],
    tubes: [],
    wounds: [],
    interventions: [],
    changes: [],
    planSuggestions: [],
    educationTopics: [],
    redFlags: [],
    docFacts: [],
    documents: [],
    identityConcern: null,
    missingDomains: [],
    languageNotes: [],
    conflicts: [],
  };
}

const DEMO_SUGGESTIONS: Omit<PlanSuggestion, "id">[] = [
  { problem: "呼吸道清除功能失效", basis: "痰液增加、黃黏，每日抽痰 4～5 次；右下肺痰音" },
  { problem: "便秘", basis: "3 天未解便、腹部微脹、腸音減少" },
];

function visitAnalysis(req: AnalyzeRequest): Analysis {
  const year = yearOf(req.visitDate);
  const vitals = [
    vital("temp", "16.8", "體溫十六點八度", 0.62),
    vital("pulse", "88", "脈搏八十八下", 0.9),
    vital("resp", "18", "呼吸十八次", 0.9),
    vital("bp", "142/86", "血壓一百四十二之八十六", 0.88),
    vital("spo2", "96", "血氧九十六趴，沒有用氧氣", 0.9, "未使用氧氣"),
    vital("spo2", "97", "拍背抽痰之後，血氧現在九十七趴", 0.9, "拍痰後"),
    vital("glucose", "168", "飯前血糖剛剛測是一百六十八", 0.83, "飯前"),
    vital(
      "consciousness",
      "可喚醒，睜眼注視並點頭回應，言語不清（同前次）",
      "阿嬤叫得醒，眼睛會張開看我，問她會點頭，但是講話還是講不清楚，跟上次差不多",
      0.91,
    ),
  ];
  const finalVitals = finalizeVitals(vitals, req.typedVitals);
  const plan = req.currentPlan ?? "";
  const changes = req.previous
    ? [
        { kind: "new" as const, text: "痰液增加、黃黏，每日抽痰 4～5 次", evidence: "黃黃的，有點黏，一天大概抽四五次。" },
        { kind: "new" as const, text: "3 天未解便、腹脹", evidence: "她已經三天沒有大便了，肚子摸起來有點脹。" },
      ]
    : [];
  const withIds = ensureIds(changes, "c");
  return {
    ...emptyAnalysis(DEMO_VISIT_SUMMARY),
    speakers: { ...DEMO_SPEAKERS },
    vitals: finalVitals,
    findings: [
      finding("意識", "可喚醒，睜眼注視並點頭回應，言語仍不清楚，與前次相同", "阿嬤叫得醒，眼睛會張開看我"),
      finding("呼吸", "女兒表示本週痰量增加，夜間咳嗽較厲害", "她這禮拜痰比較多，晚上咳得比較厲害"),
      finding("呼吸", "看護表示痰液呈黃色黏稠，每日抽痰約 4～5 次", "黃黃的，有點黏，一天大概抽四五次"),
      finding("呼吸", "聽診右下肺有痰音，左側尚可", "肺音聽起來右下肺有一些痰音，左邊還好"),
      finding("呼吸", "拍背抽痰後呼吸音較清楚", "呼吸聲比較清楚了"),
      finding("消化", "女兒表示近期灌食後偶有嗆咳", "她最近灌完有時候會嗆到"),
      finding("排泄", "已 3 天未解便，腹部微脹", "她已經三天沒有大便了，肚子摸起來有點脹"),
      finding("排泄", "聽診腸音存在但減少", "腸音有，但是比較少"),
      finding("排泄", "導尿管留置，尿液淡黃清澈、量足、無沉澱", "尿液顏色淡黃、清澈，量夠，沒有沉澱"),
      finding("皮膚與傷口", "薦骨壓傷約 2×1.5 公分，少量黃色滲液，周圍皮膚微紅，無異味", "薦骨這邊的壓傷大概兩公分乘一點五公分"),
      finding("活動", "看護表示夜間翻身可能未達每 2 小時一次", "翻身可能沒有每兩個小時"),
      finding("心理社會", "主要照顧者為女兒，外籍看護協助照顧；看護較能理解放慢速度的中文說明", "她中文比較聽得懂慢慢講的"),
      ...notesFinding(req.notes),
    ],
    tubes: [
      {
        name: "鼻胃管",
        detail: "今日更換，14Fr，左鼻孔，固定於 55 公分；反抽有胃液並打氣聽診確認位置",
        changedToday: true,
        nextDue: addDays(req.visitDate, tubeIntervalDays("鼻胃管") ?? 30),
      },
      { name: "導尿管", detail: "09/20 更換；尿液淡黃清澈、量足、無沉澱", changedToday: false, nextDue: `${year}-10-20` },
    ],
    wounds: [
      { site: "薦骨", detail: "壓傷約 2×1.5 公分，少量黃色滲液，周圍皮膚微紅，無異味", care: "生理食鹽水清潔後更換泡棉敷料" },
    ],
    interventions: [
      "更換鼻胃管（14Fr，左鼻孔，固定於 55 公分），反抽胃液及打氣聽診確認位置",
      "薦骨壓傷以生理食鹽水清潔後更換泡棉敷料",
      "肺部聽診與腹部評估（腸音）",
      "指導看護抽痰前拍背，看護回覆示教手勢正確",
      "衛教灌食姿勢、翻身減壓、腹部按摩與增加水分、就醫警訊",
    ],
    changes: [...withIds, ...ensureIds(numericDeltaChanges(finalVitals, req.previous, withIds), `c${withIds.length + 1}-`)],
    planSuggestions: ensureIds(
      DEMO_SUGGESTIONS.filter((s) => !plan.includes(s.problem)),
      "s",
    ),
    educationTopics: ["抽痰前拍背", "灌食姿勢與預防嗆咳", "翻身減壓與皮膚觀察", "腹部按摩與增加水分", "鼻胃管滑脫處理", "就醫警訊"],
    redFlags: ["發燒超過 38 度", "呼吸很喘", "痰液轉綠或帶血", "鼻胃管滑出（不要自行放回）"],
    identityConcern: identityConcernFromText(DEMO_SEGMENTS.map((s) => s.text).join(""), req.patient),
    missingDomains: ["疼痛"],
  };
}

const DEMO_DOC_FACTS: Omit<DocFact, "id">[] = [
  { category: "診斷", text: "腦梗塞後遺症（右側偏癱）", page: 1, unclear: false },
  { category: "診斷", text: "第二型糖尿病", page: 1, unclear: false },
  { category: "診斷", text: "高血壓", page: 1, unclear: false },
  { category: "用藥", text: "Aspirin 100 mg 1# QD", page: 3, unclear: false },
  { category: "用藥", text: "Amlodipine 5 mg 1# QD", page: 3, unclear: false },
  { category: "用藥", text: "Metformin 500 mg 1# BID", page: 3, unclear: false },
  { category: "用藥", text: "Atorvastatin 20 mg 1# HS", page: 3, unclear: false },
  { category: "用藥", text: "Glimepiride：劑量字跡不清", page: 4, unclear: true },
  { category: "用藥", text: "Sennoside：用法字跡不清", page: 4, unclear: true },
  { category: "管路", text: "鼻胃管：09/26 置入", page: 2, unclear: false },
  { category: "管路", text: "導尿管：09/20 更換", page: 2, unclear: false },
  { category: "過敏", text: "文件未載明", page: 1, unclear: false },
  { category: "皮膚", text: "薦骨壓傷，大小未載明", page: 5, unclear: false },
  { category: "生命徵象（文件）", text: "09/27 血壓 150/88 mmHg、飯前血糖 156 mg/dL", page: 6, unclear: false },
];

function demoDocuments(req: AnalyzeRequest): DocumentSummary[] {
  return req.documents.map((d, i) =>
    i === 0
      ? { title: "出院病歷摘要", date: "2026-09-28", pages: 8, patientHint: "84 歲 女" }
      : { title: d.name.replace(/\.[^.]+$/, "") || `文件 ${i + 1}`, date: null, pages: null, patientHint: null },
  );
}

function intakeAnalysis(req: AnalyzeRequest): Analysis {
  const doc = (text: string, domain: string, src: string): Finding => ({ domain, text, sourceQuote: src, sourceMs: null, origin: "document" });
  return {
    ...emptyAnalysis(DEMO_INTAKE_SUMMARY),
    vitals: finalizeVitals([], req.typedVitals),
    findings: [
      doc("右側偏癱、臥床（依病摘）", "活動", "右側偏癱，臥床"),
      doc("經鼻胃管灌食（依病摘）", "營養", "經鼻胃管灌食"),
      doc("主要照顧者為女兒，另有外籍看護協助（依病摘）", "心理社會", "主要照顧者：女兒；外籍看護協助"),
      ...notesFinding(req.notes),
    ],
    tubes: [
      { name: "鼻胃管", detail: "09/26 置入（依病摘）", changedToday: false, nextDue: null },
      { name: "導尿管", detail: "09/20 更換（依病摘）", changedToday: false, nextDue: null },
    ],
    wounds: [{ site: "薦骨", detail: "壓傷，大小未載明（依病摘第 5 頁）", care: null }],
    educationTopics: ["鼻胃管灌食與反抽確認", "尿管與尿袋照護", "翻身減壓"],
  };
}

function offlineAnalysis(req: AnalyzeRequest): Analysis {
  const transcriptText = req.transcript?.segments.map((s) => s.text).join("") ?? "";
  return {
    ...emptyAnalysis(req.transcript ? "示範模式：未整理這段錄音內容。" : "示範模式：僅含護理師手動輸入的資料。"),
    vitals: finalizeVitals([], req.typedVitals),
    findings: notesFinding(req.notes),
    identityConcern: transcriptText ? identityConcernFromText(transcriptText, req.patient) : null,
    languageNotes: req.transcript ? [OFFLINE_NOTE] : [],
  };
}

/**
 * 示範分析：示範逐字稿得到完整的虛構分析（含 16.8℃ 辨識錯誤、2 項評估異動、計畫建議、血氧復測）；
 * 只有文件時得到收案整理；其他錄音不編造內容。手動輸入的數值一律勝過語音。
 */
export function demoAnalysis(req: AnalyzeRequest): Analysis {
  const hasDocs = req.documents.length > 0;
  const isDemo = isDemoTranscript(req.transcript);
  const analysis = isDemo ? visitAnalysis(req) : !req.transcript && hasDocs ? intakeAnalysis(req) : offlineAnalysis(req);
  if (hasDocs) {
    analysis.docFacts = ensureIds(DEMO_DOC_FACTS, "d");
    analysis.documents = demoDocuments(req);
  }
  return analysis;
}

/* ================================ 撰寫 ================================ */

interface Ctx {
  req: GenerateRequest;
  a: Analysis;
  date: string;
  demoVisit: boolean;
  demoIntake: boolean;
  term: string;
  confirmed: ConfirmedVital[];
  vitalLines: string[];
  alertStatus: { confirmedNumeric: number; pending: number };
  nextVisit: string | null;
  wants: (instruction: string) => boolean;
}

function makeCtx(req: GenerateRequest): Ctx {
  const a = req.analysis;
  const confirmed = req.confirmedVitals.filter((v) => v.value.trim());
  const confirmedKeys = new Set(confirmed.map((v) => v.key));
  const numericConfirmed = confirmed.filter((v) => v.key !== "consciousness" && isPlausible(v.key, v.value));
  const pending = new Set(a.vitals.filter((v) => v.key !== "consciousness" && !confirmedKeys.has(v.key)).map((v) => v.key)).size;
  const instructions = [...req.options.instructions, req.options.custom ?? ""].join("｜");
  return {
    req,
    a,
    date: req.visitDate,
    demoVisit: a.summary === DEMO_VISIT_SUMMARY,
    demoIntake: a.summary === DEMO_INTAKE_SUMMARY,
    term: req.patient.familyCallsAs?.trim() || "長輩",
    confirmed,
    vitalLines: vitalAlertLines(confirmed, req.previous),
    alertStatus: { confirmedNumeric: numericConfirmed.length, pending },
    nextVisit: addDays(req.visitDate, 14),
    wants: (s) => instructions.includes(s),
  };
}

const sec = (heading: string, body: string): DocSection => ({ heading, body });
const numbered = (lines: string[]) => lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
const sentences = (text: string) => text.match(/[^。]+。?/g)?.map((s) => s.trim()).filter(Boolean) ?? [];
/** 「改成條列」：一句一行並編號。 */
const asList = (text: string) => numbered(text.split("\n").flatMap(sentences));

function tubeNext(a: Analysis, name: RegExp, date: string): string | null {
  const t = a.tubes.find((x) => name.test(x.name));
  if (!t) return null;
  if (t.nextDue) return t.nextDue;
  const days = tubeIntervalDays(t.name);
  return t.changedToday && days ? addDays(date, days) : null;
}

function docSourceText(a: Analysis, withPages: boolean): string | null {
  if (a.documents.length === 0) return null;
  return a.documents
    .map((d) => {
      const meta = [d.date ? slashDate(d.date) : null, withPages && d.pages ? `共 ${d.pages} 頁` : null].filter(Boolean).join("，");
      return meta ? `${d.title}（${meta}）` : d.title;
    })
    .join("、");
}

function docDiagnoses(a: Analysis): string[] {
  return a.docFacts.filter((f) => f.category === "診斷" && !f.unclear).map((f) => f.text);
}

/* -------------------------------- 護理紀錄 -------------------------------- */

function demoRecordParts(c: Ctx) {
  const concise = c.wants("更精簡");
  const ng = tubeNext(c.a, /鼻胃管/, c.date);
  const foley = tubeNext(c.a, /導尿管|尿管/, c.date);
  const diagnoses = docDiagnoses(c.a);
  const docTitle = c.a.documents[0];
  const background =
    diagnoses.length && docTitle
      ? `依${docTitle.title}${docTitle.date ? `（${slashDate(docTitle.date)}）` : ""}，個案診斷為${diagnoses.join("、")}。`
      : "";
  let s1 = concise
    ? "個案臥床，女兒及外籍看護陪伴；可喚醒、點頭回應，言語不清（同前次）。痰液增加呈黃色黏稠，每日抽痰約 4～5 次，右下肺有痰音，已指導抽痰前拍背。今日更換鼻胃管並確認位置，薦骨壓傷換藥。灌食後偶有嗆咳；3 天未解便，腹部微脹。"
    : "個案臥床，由女兒及外籍看護陪伴。可喚醒、睜眼注視並點頭回應，言語仍不清楚，與前次相同。女兒表示本週痰量增加、夜間咳嗽較厲害；看護表示痰液呈黃色黏稠，每日抽痰約 4～5 次。聽診右下肺有痰音，左側尚可，已指導看護抽痰前先拍背，拍背抽痰後呼吸音較清楚。今日更換鼻胃管並確認位置，薦骨壓傷換藥。女兒表示近期灌食後偶有嗆咳，已再次說明灌食姿勢；個案已 3 天未解便，腹部微脹，聽診腸音減少。";
  if (c.wants("更詳細")) {
    s1 +=
      "\n看護表示夜間有時睡著，翻身可能未達每 2 小時一次，已建議以手機鬧鐘提醒，翻身時順便觀察皮膚有無發紅。女兒表示看護較能理解放慢速度的中文說明，衛教內容將以 LINE 傳送並提供印尼文版本。";
  }
  s1 = background + s1;

  const other = ["痰液增加，呈黃色黏稠，右下肺有痰音，需持續觀察呼吸道狀況。", "已 3 天未解便，腹部微脹，腸音減少。"];
  const tubes = [
    `鼻胃管：今日更換，14Fr，左鼻孔，固定於 55 公分${ng ? `；下次更換 ${slashDate(ng)}` : ""}。`,
    `導尿管：09/20 更換，尿液淡黃清澈、無沉澱${foley ? `；下次更換 ${slashDate(foley)}` : ""}。`,
    "薦骨壓傷：約 2×1.5 公分，少量黃色滲液，周圍皮膚微紅，無異味；以生理食鹽水清潔後更換泡棉敷料。",
  ];
  if (c.wants("加強管路照護")) {
    tubes.push("管路照護：已指導灌食前反抽確認鼻胃管位置；鼻胃管滑出時勿自行放回，須立即聯絡居護所或就醫；已回覆女兒導尿管下次更換時間。");
  }
  const next = c.nextVisit ? `下次訪視 ${slashDate(c.nextVisit)}。` : "";
  const s4 = concise
    ? `今日完成換管、換藥及拍背、灌食姿勢、翻身與便秘照護衛教；持續觀察痰液與排便，已說明就醫警訊。${next}`
    : `今日完成鼻胃管更換及薦骨壓傷換藥，並指導看護抽痰前拍背、灌食時床頭搖高 30～45 度、每 2 小時翻身。痰液與排便情形需持續觀察；已說明順時鐘按摩腹部、每日水分增加 200 毫升，若明日仍未解便請聯絡護理師。已說明發燒超過 38 度、呼吸喘、痰液轉綠或帶血、鼻胃管滑脫時須立即聯絡或就醫。${next}`;
  return { s1, other, tubes, s4, background };
}

function genericRecordParts(c: Ctx) {
  const a = c.a;
  const facts = a.findings.filter((f) => f.origin !== "document").map((f) => `${f.text.replace(/[。]$/, "")}。`);
  const done = a.interventions.length ? [`今日${a.interventions.join("；")}。`] : [];
  const s1 = [...facts, ...done].join("") || NOT_ASSESSED_SENTENCE;
  const other = a.changes.map((ch) => `${ch.text.replace(/[。]$/, "")}。`);
  const known = c.req.patient.tubes.map((t) => t.name).filter((n) => !a.tubes.some((t) => t.name.includes(n) || n.includes(t.name)));
  const tubes = [
    ...a.tubes.map((t) => `${t.name}：${t.detail.replace(/[。]$/, "")}${t.nextDue && !t.detail.includes("下次") ? `；下次更換 ${slashDate(t.nextDue)}` : ""}。`),
    ...a.wounds.map((w) => `${w.site}：${w.detail.replace(/[。]$/, "")}${w.care ? `；${w.care}` : ""}。`),
    ...known.map((n) => `${n}：本次未評估。`),
  ];
  const flags = a.redFlags.length ? `已說明${a.redFlags.join("、")}時須立即聯絡或就醫。` : "";
  const s4 = `${a.summary.replace(/[。]$/, "")}。${flags}`;
  return { s1, other, tubes, s4, background: "" };
}

function alertSentence(c: Ctx): string {
  if (c.vitalLines.length) return c.vitalLines.map((l) => l.replace(/。$/, "")).join("；") + "。";
  return c.alertStatus.pending === 0 && c.alertStatus.confirmedNumeric > 0 ? VITALS_NORMAL_SENTENCE : "";
}

function recordSections(c: Ctx): DocSection[] {
  if (c.req.intakeOnly) return intakeRecordSections(c);
  const p = c.demoVisit ? demoRecordParts(c) : genericRecordParts(c);
  const listStyle = c.wants("改成條列");

  if (c.req.options.recordStyle === "narrative") {
    let body: string;
    if (c.demoVisit) {
      const ng = "今日更換鼻胃管（14Fr，左鼻孔，固定於 55 公分），反抽有胃液並打氣聽診確認位置";
      body = c.wants("更精簡")
        ? `至案家訪視，個案臥床，女兒及外籍看護陪伴；可喚醒、點頭回應，言語不清（同前次）。痰液增加呈黃色黏稠，每日抽痰約 4～5 次，右下肺有痰音；灌食後偶有嗆咳，3 天未解便。${ng}，薦骨壓傷換藥。已衛教抽痰前拍背、灌食姿勢、翻身與便秘照護，並說明就醫警訊。${alertSentence(c)}${c.nextVisit ? `下次訪視 ${slashDate(c.nextVisit)}。` : ""}`
        : [
            `${p.background}至案家訪視，個案臥床，由女兒及外籍看護陪伴。意識可喚醒，睜眼注視並點頭回應，言語仍不清楚，以點頭回應溝通，與前次相同。聽診右下肺有痰音，左側尚可。女兒表示本週痰量增加、夜間咳嗽較厲害，近期灌食後偶有嗆咳，個案已 3 天未解便、腹部微脹；看護表示痰液呈黃色黏稠，每日抽痰約 4～5 次，夜間翻身可能未達每 2 小時一次。`,
            `${ng}；薦骨壓傷約 2×1.5 公分，少量黃色滲液，周圍皮膚微紅，無異味，以生理食鹽水清潔後更換泡棉敷料；導尿管 09/20 更換，尿液淡黃清澈、無沉澱。聽診腸音減少。`,
            `指導看護抽痰前先拍背，看護回覆示教手勢正確，拍背抽痰後呼吸音較清楚；衛教灌食時床頭搖高 30～45 度、灌食後坐 30 分鐘再躺下、以手機鬧鐘提醒翻身、順時鐘按摩腹部及每日水分增加 200 毫升。${alertSentence(c)}已說明發燒超過 38 度、呼吸喘、痰液轉綠或帶血、鼻胃管滑脫時須立即聯絡或就醫；若明日仍未解便請聯絡護理師。${c.nextVisit ? `下次訪視 ${slashDate(c.nextVisit)}。` : ""}`,
          ].join("\n");
    } else {
      body = [p.s1, alertSentence(c), p.tubes.join(""), p.s4].filter(Boolean).join("\n");
    }
    return [sec(RECORD_NARRATIVE_HEADING, listStyle ? asList(body) : body)];
  }

  return [
    sec(RECORD_HEADINGS[0], listStyle ? asList(p.s1) : p.s1),
    sec(RECORD_HEADINGS[1], composeAlertBody(c.vitalLines, p.other, c.alertStatus)),
    sec(RECORD_HEADINGS[2], p.tubes.length ? numbered(p.tubes) : NOT_ASSESSED_SENTENCE),
    sec(RECORD_HEADINGS[3], listStyle ? asList(p.s4) : p.s4),
  ];
}

function intakeRecordSections(c: Ctx): DocSection[] {
  const a = c.a;
  const source = `資料來源：${docSourceText(a, true) ?? "匯入文件"}`;
  if (c.demoIntake || (c.demoVisit && a.docFacts.length)) {
    return [
      sec("", source),
      sec(INTAKE_HEADINGS[0], "依病摘：個案右側偏癱、臥床，經鼻胃管灌食，留置導尿管；主要照顧者為女兒，另有外籍看護協助。"),
      sec(
        INTAKE_HEADINGS[1],
        [
          "慢性：腦梗塞後遺症（右側偏癱）、第二型糖尿病、高血壓。",
          "長期用藥：依病摘第 3～4 頁藥物清單，共 6 項（其中 2 項字跡不清，見四）。",
          "過敏史：文件未載明。",
          "文件紀錄的生命徵象（09/27）：血壓 150/88 mmHg、飯前血糖 156 mg/dL。",
        ].join("\n"),
      ),
      sec(INTAKE_HEADINGS[2], numbered(["鼻胃管：09/26 置入（依病摘）。", "導尿管：09/20 更換（依病摘）。", "薦骨壓傷：依病摘第 5 頁，大小未載明。"])),
      sec(
        INTAKE_HEADINGS[3],
        numbered([
          "確認藥物過敏史（文件未載明）。",
          "測量薦骨壓傷大小並評估傷口。",
          "確認鼻胃管與導尿管下次更換日。",
          "病摘第 4 頁有 2 項用藥字跡不清（Glimepiride 劑量、Sennoside 用法），請於訪視時對照藥袋。",
        ]),
      ),
    ];
  }
  const by = (cat: RegExp) => a.docFacts.filter((f) => cat.test(f.category) && !f.unclear);
  const page = (f: DocFact) => (f.page ? `（第 ${f.page} 頁）` : "");
  const background = a.findings.filter((f) => f.origin === "document").map((f) => f.text.replace(/[。]$/, ""));
  const facts = [
    by(/診斷/).length ? `診斷：${by(/診斷/).map((f) => f.text).join("、")}。` : null,
    by(/病史/).length ? `過去病史：${by(/病史/).map((f) => f.text).join("、")}。` : null,
    by(/用藥/).length ? `用藥：${by(/用藥/).map((f) => `${f.text}${page(f)}`).join("、")}。` : null,
    `過敏史：${by(/過敏/).map((f) => f.text).join("、") || "文件未載明"}。`,
  ].filter((x): x is string => !!x);
  const tubes = [
    ...a.tubes.map((t) => `${t.name}：${t.detail.replace(/[。]$/, "")}。`),
    ...a.wounds.map((w) => `${w.site}：${w.detail.replace(/[。]$/, "")}。`),
  ];
  const confirm = [
    ...a.docFacts.filter((f) => f.unclear).map((f) => `${f.text}${page(f)}，請於訪視時確認。`),
    ...(by(/過敏/).length ? [] : ["確認藥物過敏史（文件未載明）。"]),
    "測量生命徵象並評估管路與皮膚狀況。",
  ];
  return [
    sec("", source),
    sec(INTAKE_HEADINGS[0], background.length ? `依文件：${background.join("；")}。` : NOT_ASSESSED_SENTENCE),
    sec(INTAKE_HEADINGS[1], facts.join("\n")),
    sec(INTAKE_HEADINGS[2], tubes.length ? numbered(tubes) : NOT_ASSESSED_SENTENCE),
    sec(INTAKE_HEADINGS[3], numbered(confirm)),
  ];
}

/* -------------------------------- 護理計畫 -------------------------------- */

interface ProblemBlock {
  title: string;
  tag: "沿用" | "本次新增";
  lines: string[];
  adjusted: boolean;
}

/** 沿用原文時只統一範圍符號與句號（K3），不改字。 */
const tidy = (s: string) => {
  const t = s.trim().replace(/(\d)\s*[–—~〜]\s*(\d)/g, "$1～$2");
  return /[。！？]$/.test(t) ? t : `${t}。`;
};

function measuresLine(measures: string[]): string {
  return `措施：${measures.map((m, i) => `(${i + 1}) ${tidy(m)}`).join("")}`;
}

/** 示範個案沿用問題的本次評值（依關鍵字對應）。 */
function demoEvaluation(c: Ctx, p: PlanProblem): { evaluation: string; adjust: string | null } {
  if (!c.demoVisit) return { evaluation: "（示範模式：請依本次訪視評估填寫。）", adjust: null };
  if (/皮膚|壓傷/.test(p.title)) {
    return {
      evaluation: "部分達成。傷口約 2×1.5 公分，少量黃色滲液，周圍皮膚微紅；看護表示夜間翻身未能每 2 小時。",
      adjust: `新增措施 (${p.measures.length + 1}) 以手機鬧鐘提醒夜間翻身。`,
    };
  }
  if (/營養|灌食|吞嚥|吸入/.test(p.title)) return { evaluation: "持續中。今日更換鼻胃管；女兒表示灌食後偶有嗆咳，已再次說明灌食姿勢。", adjust: null };
  if (/呼吸道/.test(p.title)) return { evaluation: "未達成。痰液增加、呈黃色黏稠，右下肺有痰音。", adjust: null };
  if (/便秘/.test(p.title)) return { evaluation: "未達成。已 3 天未解便，腹部微脹。", adjust: null };
  return { evaluation: "持續追蹤。", adjust: null };
}

const NEW_PROBLEMS: Record<string, { basis: string; goal: string; measures: string[] }> = {
  呼吸道清除功能失效: {
    basis: "近一週痰液增加、呈黃色黏稠，每日抽痰約 4～5 次；右下肺有痰音。",
    goal: "一週內痰液顏色轉淡、每日抽痰次數減少。",
    measures: ["指導看護抽痰前拍背，每側 3～5 分鐘。", "每 2 小時協助翻身並更換姿勢。", "發燒、呼吸喘、痰液轉綠或帶血時，立即聯絡護理師或就醫。"],
  },
  便秘: {
    basis: "已 3 天未解便，腹部微脹，腸音減少。",
    goal: "三天內恢復排便，腹脹緩解。",
    measures: ["指導每天順時鐘按摩腹部。", "每日水分增加 200 毫升。", "明日仍未解便，由家屬聯絡護理師評估是否需要軟便藥。"],
  },
  "皮膚完整性受損（薦骨壓傷）": {
    basis: "薦骨壓傷約 2×1.5 公分，少量黃色滲液，周圍皮膚微紅；夜間翻身可能未達每 2 小時一次。",
    goal: "一個月內傷口縮小，且無新增壓傷。",
    measures: ["每次訪視評估傷口並以生理食鹽水清潔、更換泡棉敷料。", "指導照顧者每 2 小時翻身，夜間以手機鬧鐘提醒。", "翻身時觀察受壓部位皮膚有無發紅。"],
  },
  "有吸入的危險（鼻胃管灌食）": {
    basis: "經鼻胃管灌食，近期灌食後偶有嗆咳。",
    goal: "一週內照顧者能正確執行灌食姿勢，灌食後無嗆咳。",
    measures: ["灌食前反抽確認鼻胃管位置。", "灌食時床頭搖高 30～45 度，灌食後坐 30 分鐘再躺下。", "出現嗆咳或呼吸喘時暫停灌食並聯絡護理師。"],
  },
};

const INTAKE_PROBLEMS: Record<string, { basis: string; goal: string; measures: string[] }> = {
  "皮膚完整性受損（薦骨壓傷）": {
    basis: "依病摘第 5 頁有薦骨壓傷，大小未載明。",
    goal: "一個月內傷口縮小，且無新增壓傷。",
    measures: ["首次訪視測量傷口大小並評估。", "指導照顧者每 2 小時翻身。", "依醫囑換藥。"],
  },
  "有吸入的危險（鼻胃管灌食）": {
    basis: "依病摘經鼻胃管灌食。",
    goal: "一個月內灌食時無嗆咳，體重不下降。",
    measures: ["灌食前反抽確認鼻胃管位置。", "灌食時床頭搖高 30～45 度，灌食後坐 30 分鐘再躺下。"],
  },
  "有感染的危險（留置導尿管）": {
    basis: "依病摘留置導尿管，09/20 更換。",
    goal: "留置期間尿液清澈，無發燒。",
    measures: ["尿袋低於膀胱，避免管路扭折。", "每日以清水清潔尿道口。", "首次訪視確認下次更換日。"],
  },
};

function newProblemBlock(
  title: string,
  spec: { basis: string; goal: string; measures: string[] } | null,
  fallbackBasis: string | null,
  evaluation: string,
  concise: boolean,
): ProblemBlock {
  const measures = spec ? (concise ? spec.measures.slice(0, 2) : spec.measures) : [];
  return {
    title,
    tag: "本次新增",
    adjusted: false,
    lines: [
      `依據：${spec?.basis ?? (fallbackBasis ? `${fallbackBasis.replace(/[。]$/, "")}。` : "本次訪視評估。")}`,
      `目標：${spec?.goal ?? "（示範模式：請護理師訂定有時限且可量測的目標。）"}`,
      measures.length ? measuresLine(measures) : "措施：（示範模式：請護理師擬定。）",
      `評值：${evaluation}`,
    ],
  };
}

function adoptedSuggestions(c: Ctx): { problem: string; basis: string | null }[] {
  return c.req.adoptedSuggestions
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const hit = c.a.planSuggestions.find((p) => p.id === s || p.problem === s);
      return { problem: hit?.problem ?? s, basis: hit?.basis ?? null };
    });
}

function planSections(c: Ctx): DocSection[] {
  const a = c.a;
  const concise = c.wants("更精簡");
  const intake = c.req.intakeOnly;
  const docs = docSourceText(a, false);
  const basisLine = intake ? `依據：${docs ?? "匯入文件"}` : `依據：${slashDate(c.date)} 訪視評估${docs ? `、${docs}` : ""}`;
  const followUp = c.nextVisit ? `${slashDate(c.nextVisit)} 訪視時評估。` : "下次訪視時評估。";

  // 三、護理問題
  const blocks: ProblemBlock[] = [];
  const carried = intake ? [] : parsePlanProblems(c.req.currentPlan);
  for (const p of carried) {
    const { evaluation, adjust } = demoEvaluation(c, p);
    const lines = [
      ...(p.goal ? [`目標：${tidy(p.goal)}`] : []),
      ...(p.measures.length ? [measuresLine(p.measures)] : []),
      `本次評值：${evaluation}`,
      ...(adjust ? [`調整：${adjust}`] : []),
    ];
    blocks.push({ title: p.title, tag: "沿用", lines, adjusted: !!adjust });
  }
  if (carried.length === 0 && (c.demoVisit || c.demoIntake)) {
    const table = intake ? INTAKE_PROBLEMS : NEW_PROBLEMS;
    const base = intake
      ? Object.keys(INTAKE_PROBLEMS)
      : ["皮膚完整性受損（薦骨壓傷）", "有吸入的危險（鼻胃管灌食）"];
    for (const title of base) {
      blocks.push(newProblemBlock(title, table[title], null, intake ? "待首次訪視評估。" : followUp, concise));
    }
  }
  for (const s of adoptedSuggestions(c)) {
    if (blocks.some((b) => b.title === s.problem)) continue;
    blocks.push(newProblemBlock(s.problem, c.demoVisit ? (NEW_PROBLEMS[s.problem] ?? null) : null, s.basis, followUp, concise));
  }
  const problems = blocks.slice(0, 5);
  const problemText = problems.length
    ? problems.map((b, i) => [`問題 ${i + 1}：${b.title}（${b.tag}）`, ...b.lines.map((l) => `　${l}`)].join("\n")).join("\n")
    : "本次未提出護理問題，請護理師擬定。";

  // 五、整體評值與調整
  const idx = (pred: (b: ProblemBlock) => boolean) =>
    problems.map((b, i) => (pred(b) ? `問題 ${i + 1}` : null)).filter((x): x is string => !!x);
  const adjusted = idx((b) => b.tag === "沿用" && b.adjusted);
  const kept = idx((b) => b.tag === "沿用" && !b.adjusted);
  const added = idx((b) => b.tag === "本次新增");
  const summary =
    carried.length === 0
      ? "首次擬定，下次訪視評值。"
      : [
          adjusted.length ? `${adjusted.join("、")} 沿用並調整措施` : null,
          kept.length ? `${kept.join("、")} 沿用` : null,
          added.length ? `新增${added.join("、")}` : null,
        ]
          .filter(Boolean)
          .join("；") + "。";

  // 一、評估摘要；二、疾病診斷與異常值
  const assessment = c.demoVisit
    ? [
        "身體：臥床，經鼻胃管灌食，留置導尿管；薦骨壓傷約 2×1.5 公分。本次痰液增加、右下肺有痰音，3 天未解便。",
        "心理：可點頭回應，言語不清，與前次相同。",
        "社會：女兒為主要照顧者，外籍看護協助日常照顧。",
        "靈性：本次未評估。",
      ]
    : c.demoIntake
      ? [
          "身體：依病摘右側偏癱、臥床，經鼻胃管灌食，留置導尿管；薦骨壓傷，大小未載明。",
          "心理：本次未評估。",
          "社會：依病摘，主要照顧者為女兒，另有外籍看護協助。",
          "靈性：本次未評估。",
        ]
      : [
          `身體：${a.findings.filter((f) => !/心理|社會|靈性/.test(f.domain)).map((f) => f.text).join("；") || "本次未評估"}。`,
          `心理：${a.findings.filter((f) => /心理/.test(f.domain)).map((f) => f.text).join("；") || "本次未評估"}。`,
          `社會：${a.findings.filter((f) => /社會/.test(f.domain)).map((f) => f.text).join("；") || "本次未評估"}。`,
          "靈性：本次未評估。",
        ];
  const diagnoses = docDiagnoses(a);
  const doc0 = a.documents[0];
  const diagnosisLine = diagnoses.length
    ? `慢性（依${doc0?.title ?? "文件"}${doc0?.date ? ` ${slashDate(doc0.date)}` : ""} 照錄）：${diagnoses.join("、")}。`
    : c.req.patient.diagnoses.length
      ? `慢性（依個案資料）：${c.req.patient.diagnoses.join("、")}。`
      : "未提供病摘，待補。";
  const docVitals = a.docFacts.find((f) => /生命徵象/.test(f.category) && !f.unclear);
  const abnormal = intake
    ? docVitals
      ? `異常值：依文件 ${docVitals.text}。`
      : null
    : abnormalValuesLine(c.confirmed, c.date);

  const family = c.demoVisit
    ? "女兒會將衛教內容轉告看護；外籍看護負責翻身、拍背及灌食，今日已回覆示教拍背手勢。"
    : c.demoIntake
      ? "依病摘，主要照顧者為女兒，另有外籍看護協助；照顧分工待首次訪視確認。"
      : NOT_ASSESSED_SENTENCE;

  return [
    sec("", basisLine),
    sec(PLAN_HEADINGS[0], concise && c.demoVisit ? assessment.slice(0, 1).concat("心理、社會：同前次。", "靈性：本次未評估。").join("\n") : assessment.join("\n")),
    sec(PLAN_HEADINGS[1], [diagnosisLine, abnormal].filter(Boolean).join("\n")),
    sec(PLAN_HEADINGS[2], problemText),
    sec(PLAN_HEADINGS[3], family),
    sec(PLAN_HEADINGS[4], summary),
  ];
}

/* -------------------------------- 家屬衛教 -------------------------------- */

function eduSections(c: Ctx): DocSection[] {
  const X = c.term;
  const simple = c.wants("家屬更好懂");
  const concise = c.wants("更精簡");
  const detailed = c.wants("更詳細");
  const closing = sec("", EDU_CLOSING);

  if (c.req.intakeOnly || c.demoIntake) {
    return [
      sec("", `${X}剛出院回家，護理師第一次來訪前，請先注意下面幾件事：`),
      sec(EDU_HEADINGS.attention, numbered([`${X}剛出院，身上有鼻胃管和尿管。`, "屁股尾椎附近有傷口，要保持乾淨。"])),
      sec(EDU_HEADINGS.daily, numbered([`每 2 小時幫${X}翻身一次，晚上可以用手機鬧鐘提醒。`, "灌食時床頭搖高 30～45 度，灌完坐 30 分鐘再躺下。"])),
      sec(EDU_HEADINGS.tubes, numbered(["每次灌食前先反抽，確認管子在胃裡。", "尿袋要放得比肚子低，不要壓到管子。"])),
      sec(
        EDU_HEADINGS.redFlags,
        numbered(["發燒超過 38 度。", "鼻胃管滑出來（請不要自己放回去）。", "尿變得很混濁、有血，或沒有尿流出來。"]),
      ),
      closing,
    ];
  }

  if (!c.demoVisit) return genericEdu(c);

  const ng = tubeNext(c.a, /鼻胃管/, c.date);
  const foley = tubeNext(c.a, /導尿管|尿管/, c.date);
  const attention = [`${X}這一週痰比較多，黃黃黏黏的。`, `${X}已經 3 天沒有大便，肚子有一點脹。`, "灌食後有時會嗆到，灌食姿勢要特別注意。"];
  const pat = ["抽痰前先拍背：手彎成碗狀，由下往上、由外往內拍。", "避開脊椎和腰，每邊拍 3～5 分鐘。"];
  const daily = [
    simple ? pat : [pat.join("")],
    [`每 2 小時幫${X}翻身一次，晚上可以用手機鬧鐘提醒。`],
    ["灌食時床頭搖高 30～45 度，灌完坐 30 分鐘再躺下。"],
    ["順時鐘輕輕按摩肚子，每天水分多加 200 毫升。"],
    ...(detailed ? [["翻身時看看屁股和骨頭突出的地方有沒有變紅。"]] : []),
  ].flat();
  const tubeLines = [
    ...(ng ? [`鼻胃管今天換新的，下次換管是 ${plainDate(ng)}。每次灌食前先反抽，確認管子在胃裡。`] : []),
    ...(foley ? [`尿管下次更換是 ${plainDate(foley)}。尿袋要放得比肚子低，不要壓到管子。`] : []),
  ];
  const redFlags = ["發燒超過 38 度。", "呼吸很喘，或痰變成綠色、有血。", "鼻胃管滑出來（請不要自己放回去）。", "明天還沒有大便，請打電話給護理師。"];

  const pick = <T,>(xs: T[], n: number) => (concise ? xs.slice(0, n) : xs);
  return [
    sec("", concise ? `今天護理師幫${X}換了新的鼻胃管，也換了屁股尾椎附近傷口的敷料。` : `今天護理師幫${X}換了新的鼻胃管，也換了屁股尾椎附近傷口的敷料。這兩週請幫忙注意下面幾件事：`),
    sec(EDU_HEADINGS.attention, numbered(pick(attention, 2))),
    sec(EDU_HEADINGS.daily, numbered(pick(daily, 3))),
    ...(tubeLines.length ? [sec(EDU_HEADINGS.tubes, numbered(concise ? tubeLines.map((l) => sentences(l)[0]) : tubeLines))] : []),
    sec(EDU_HEADINGS.redFlags, numbered(pick(redFlags, 3))),
    closing,
  ];
}

function genericEdu(c: Ctx): DocSection[] {
  const a = c.a;
  const attention = (a.changes.length ? a.changes.map((ch) => ch.text) : a.educationTopics).slice(0, 3).map((t) => `${t.replace(/[。]$/, "")}。`);
  const daily = a.educationTopics.slice(0, 5).map((t) => `${t}：請依護理師今天的說明照做。`);
  const flags = a.redFlags.length ? a.redFlags : ["發燒超過 38 度", "呼吸很喘", "管子滑出來或阻塞"];
  const tubes = a.tubes.length ? a.tubes.map((t) => `${t.name}：請依護理師的說明照顧，有問題隨時聯絡。`) : [];
  return [
    sec("", `謝謝您用心照顧${c.term}。下面是今天護理師提醒的重點：`),
    sec(EDU_HEADINGS.attention, attention.length ? numbered(attention) : "1. 請依護理師今天的說明照顧。"),
    sec(EDU_HEADINGS.daily, daily.length ? numbered(daily) : "1. 請依護理師今天的說明照顧。"),
    ...(tubes.length ? [sec(EDU_HEADINGS.tubes, numbered(tubes))] : []),
    sec(EDU_HEADINGS.redFlags, numbered(flags.slice(0, 5).map((f) => `${f.replace(/[。]$/, "")}。`))),
    sec("", EDU_CLOSING),
  ];
}

/**
 * 示範撰寫：示範個案得到依 §8 模板寫好的三份（依記錄形式、快速指示、已採用建議、收案模板調整）；
 * 其他分析以分析內容組成保守的草稿，不補寫沒有的事實。數值異常句由確認值產生。
 */
export function demoGenerate(req: GenerateRequest): GeneratedDoc {
  const c = makeCtx(req);
  const sections = req.kind === "record" ? recordSections(c) : req.kind === "plan" ? planSections(c) : eduSections(c);
  return { kind: req.kind, sections };
}

/* ================================ 翻譯 ================================ */

type TermGroup = "female" | "male" | "elder" | "other";

function termGroup(term: string): TermGroup {
  if (/嬤|奶|婆/.test(term)) return "female";
  if (/公|爺|伯/.test(term)) return "male";
  if (/祖/.test(term)) return "elder";
  return "other";
}

const TERM_WORD: Record<TranslateLang, Record<TermGroup, string>> = {
  id: { female: "Nenek", male: "Kakek", elder: "Buyut", other: "pasien" },
  vi: { female: "bà", male: "ông", elder: "cụ", other: "người bệnh" },
  th: { female: "คุณยาย", male: "คุณตา", elder: "คุณทวด", other: "ผู้ป่วย" },
};

const MONTH: Record<TranslateLang, (m: number, d: number) => string> = {
  id: (m, d) => `${d} ${["Januari", "Februari", "Maret", "April", "Mei", "Juni", "Juli", "Agustus", "September", "Oktober", "November", "Desember"][m - 1]}`,
  vi: (m, d) => `ngày ${d} tháng ${m}`,
  th: (m, d) => `${d} ${["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม", "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"][m - 1]}`,
};

/** 示範衛教的固定譯句：{X} 個案稱呼、{D} 日期；越南文句首的稱呼用 {Xc}（大寫）。 */
const PHRASES: [string, Record<TranslateLang, string>][] = [
  ["一、今天要注意的事", { id: "I. Hal yang perlu diperhatikan hari ini", vi: "I. Những điều cần chú ý hôm nay", th: "I. สิ่งที่ต้องระวังวันนี้" }],
  ["二、每天可以這樣照顧", { id: "II. Perawatan yang bisa dilakukan setiap hari", vi: "II. Cách chăm sóc mỗi ngày", th: "II. การดูแลที่ทำได้ทุกวัน" }],
  ["管路照護", { id: "Perawatan selang", vi: "Chăm sóc ống thông", th: "การดูแลสายต่าง ๆ" }],
  [
    "三、出現這些情況，請馬上聯絡護理師或就醫",
    {
      id: "III. Jika muncul kondisi berikut, segera hubungi perawat atau pergi ke dokter",
      vi: "III. Khi có những tình trạng sau, hãy liên lạc ngay với điều dưỡng hoặc đi khám",
      th: "III. หากมีอาการต่อไปนี้ ให้ติดต่อพยาบาลหรือไปพบแพทย์ทันที",
    },
  ],
  [
    "今天護理師幫{X}換了新的鼻胃管，也換了屁股尾椎附近傷口的敷料。",
    {
      id: "Hari ini perawat mengganti selang makan (NGT) {X} dengan yang baru, dan juga mengganti perban luka di dekat tulang ekor.",
      vi: "Hôm nay điều dưỡng đã thay ống thông mũi dạ dày mới cho {X}, và thay băng vết thương gần xương cụt.",
      th: "วันนี้พยาบาลเปลี่ยนสายให้อาหารทางจมูกเส้นใหม่ให้{X} และเปลี่ยนผ้าปิดแผลบริเวณใกล้กระดูกก้นกบ",
    },
  ],
  ["這兩週請幫忙注意下面幾件事：", { id: "Selama dua minggu ini, mohon perhatikan hal-hal berikut:", vi: "Trong hai tuần tới, xin chú ý những điều sau:", th: "ในสองสัปดาห์นี้ กรุณาช่วยสังเกตเรื่องต่อไปนี้:" }],
  ["{X}這一週痰比較多，黃黃黏黏的。", { id: "Minggu ini dahak {X} lebih banyak, berwarna kekuningan dan kental.", vi: "Tuần này {X} có nhiều đờm hơn, đờm màu vàng và đặc.", th: "สัปดาห์นี้{X}มีเสมหะมากขึ้น สีเหลืองและเหนียว" }],
  ["{X}已經 3 天沒有大便，肚子有一點脹。", { id: "{X} sudah 3 hari tidak buang air besar, perutnya agak kembung.", vi: "{Xc} đã 3 ngày không đi đại tiện, bụng hơi chướng.", th: "{X}ไม่ได้ถ่ายอุจจาระมา 3 วันแล้ว ท้องอืดเล็กน้อย" }],
  ["灌食後有時會嗆到，灌食姿勢要特別注意。", { id: "Setelah diberi makan kadang tersedak, jadi posisi saat memberi makan harus diperhatikan.", vi: "Sau khi cho ăn đôi khi bị sặc, cần đặc biệt chú ý tư thế khi cho ăn.", th: "หลังให้อาหารบางครั้งมีอาการสำลัก ต้องระวังท่าทางขณะให้อาหารเป็นพิเศษ" }],
  ["抽痰前先拍背：手彎成碗狀，由下往上、由外往內拍。", { id: "Tepuk punggung sebelum menyedot dahak: tangan dibentuk seperti mangkuk, tepuk dari bawah ke atas dan dari luar ke dalam.", vi: "Vỗ lưng trước khi hút đờm: khum bàn tay như cái chén, vỗ từ dưới lên trên, từ ngoài vào trong.", th: "เคาะปอดก่อนดูดเสมหะ: ห่อมือเป็นรูปถ้วย เคาะจากล่างขึ้นบน จากด้านนอกเข้าด้านใน" }],
  ["避開脊椎和腰，每邊拍 3～5 分鐘。", { id: "Hindari tulang belakang dan pinggang, tepuk setiap sisi 3–5 menit.", vi: "Tránh cột sống và thắt lưng, mỗi bên vỗ 3–5 phút.", th: "หลีกเลี่ยงกระดูกสันหลังและเอว เคาะข้างละ 3–5 นาที" }],
  ["每 2 小時幫{X}翻身一次，晚上可以用手機鬧鐘提醒。", { id: "Balikkan badan {X} setiap 2 jam sekali; pada malam hari bisa memakai alarm ponsel sebagai pengingat.", vi: "Cứ 2 giờ trở mình cho {X} một lần; ban đêm có thể đặt báo thức điện thoại để nhắc.", th: "พลิกตัวให้{X}ทุก 2 ชั่วโมง ตอนกลางคืนตั้งนาฬิกาปลุกในโทรศัพท์เพื่อเตือนได้" }],
  ["灌食時床頭搖高 30～45 度，灌完坐 30 分鐘再躺下。", { id: "Saat memberi makan, naikkan kepala tempat tidur 30–45 derajat; setelah selesai, biarkan duduk 30 menit sebelum berbaring.", vi: "Khi cho ăn, nâng đầu giường lên 30–45 độ; ăn xong để ngồi 30 phút rồi mới nằm xuống.", th: "ขณะให้อาหาร ปรับหัวเตียงสูง 30–45 องศา ให้อาหารเสร็จแล้วให้นั่ง 30 นาทีก่อนนอนลง" }],
  ["順時鐘輕輕按摩肚子，每天水分多加 200 毫升。", { id: "Pijat perut dengan lembut searah jarum jam, dan tambahkan cairan 200 ml setiap hari.", vi: "Xoa bụng nhẹ nhàng theo chiều kim đồng hồ, mỗi ngày cho thêm 200 ml nước.", th: "นวดท้องเบา ๆ ตามเข็มนาฬิกา และเพิ่มน้ำวันละ 200 มิลลิลิตร" }],
  ["翻身時看看屁股和骨頭突出的地方有沒有變紅。", { id: "Saat membalikkan badan, periksa apakah bokong dan bagian tulang yang menonjol menjadi merah.", vi: "Khi trở mình, xem mông và những chỗ xương nhô ra có bị đỏ không.", th: "ขณะพลิกตัว ให้ดูว่าก้นและบริเวณปุ่มกระดูกมีรอยแดงหรือไม่" }],
  ["鼻胃管今天換新的，下次換管是 {D}。", { id: "Selang makan (NGT) hari ini diganti baru; penggantian berikutnya tanggal {D}.", vi: "Ống thông mũi dạ dày hôm nay đã thay mới; lần thay tiếp theo là {D}.", th: "สายให้อาหารทางจมูกเปลี่ยนใหม่วันนี้ ครั้งต่อไปจะเปลี่ยนวันที่ {D}" }],
  ["每次灌食前先反抽，確認管子在胃裡。", { id: "Setiap kali sebelum memberi makan, sedot balik dulu untuk memastikan selang berada di lambung.", vi: "Mỗi lần trước khi cho ăn, hút ngược lại trước để chắc chắn ống nằm trong dạ dày.", th: "ก่อนให้อาหารทุกครั้ง ให้ดูดกลับก่อนเพื่อยืนยันว่าสายอยู่ในกระเพาะ" }],
  ["尿管下次更換是 {D}。", { id: "Kateter urin akan diganti berikutnya tanggal {D}.", vi: "Ống thông tiểu sẽ thay lần tới vào {D}.", th: "สายสวนปัสสาวะจะเปลี่ยนครั้งต่อไปวันที่ {D}" }],
  ["尿袋要放得比肚子低，不要壓到管子。", { id: "Kantong urin harus diletakkan lebih rendah dari perut, dan jangan sampai selangnya tertekan.", vi: "Túi nước tiểu phải để thấp hơn bụng, đừng đè lên ống.", th: "ถุงปัสสาวะต้องวางต่ำกว่าท้อง และอย่าให้สายถูกกดทับ" }],
  ["發燒超過 38 度。", { id: "Demam lebih dari 38 derajat.", vi: "Sốt trên 38 độ.", th: "มีไข้สูงกว่า 38 องศา" }],
  ["呼吸很喘，或痰變成綠色、有血。", { id: "Napas sangat sesak, atau dahak menjadi hijau atau berdarah.", vi: "Thở rất mệt, hoặc đờm chuyển màu xanh, có máu.", th: "หายใจหอบมาก หรือเสมหะเป็นสีเขียวหรือมีเลือดปน" }],
  ["鼻胃管滑出來（請不要自己放回去）。", { id: "Selang makan (NGT) keluar (jangan memasukkannya kembali sendiri).", vi: "Ống thông mũi dạ dày bị tuột ra (xin đừng tự đặt lại).", th: "สายให้อาหารทางจมูกหลุดออกมา (อย่าใส่กลับเข้าไปเอง)" }],
  ["明天還沒有大便，請打電話給護理師。", { id: "Jika besok masih belum buang air besar, silakan telepon perawat.", vi: "Nếu ngày mai vẫn chưa đi đại tiện, hãy gọi điện cho điều dưỡng.", th: "ถ้าพรุ่งนี้ยังไม่ถ่าย กรุณาโทรหาพยาบาล" }],
  ["{X}剛出院回家，護理師第一次來訪前，請先注意下面幾件事：", { id: "{X} baru pulang dari rumah sakit. Sebelum kunjungan pertama perawat, mohon perhatikan hal-hal berikut:", vi: "{Xc} vừa xuất viện về nhà. Trước lần thăm đầu tiên của điều dưỡng, xin chú ý những điều sau:", th: "{X}เพิ่งออกจากโรงพยาบาลกลับบ้าน ก่อนพยาบาลมาเยี่ยมครั้งแรก กรุณาสังเกตเรื่องต่อไปนี้:" }],
  ["{X}剛出院，身上有鼻胃管和尿管。", { id: "{X} baru pulang dari rumah sakit dan memakai selang makan (NGT) serta kateter urin.", vi: "{Xc} vừa xuất viện, đang có ống thông mũi dạ dày và ống thông tiểu.", th: "{X}เพิ่งออกจากโรงพยาบาล มีสายให้อาหารทางจมูกและสายสวนปัสสาวะ" }],
  ["屁股尾椎附近有傷口，要保持乾淨。", { id: "Ada luka di dekat tulang ekor, harus dijaga tetap bersih.", vi: "Có vết thương gần xương cụt, cần giữ sạch sẽ.", th: "มีแผลบริเวณใกล้กระดูกก้นกบ ต้องรักษาให้สะอาด" }],
  ["尿變得很混濁、有血，或沒有尿流出來。", { id: "Urin menjadi sangat keruh, berdarah, atau tidak ada urin yang keluar.", vi: "Nước tiểu rất đục, có máu, hoặc không có nước tiểu chảy ra.", th: "ปัสสาวะขุ่นมาก มีเลือดปน หรือไม่มีปัสสาวะไหลออกมา" }],
  [
    EDU_CLOSING,
    {
      id: "Jika ada isi edukasi yang kurang jelas, silakan bertanya dan berdiskusi dengan tim tenaga medis profesional.",
      vi: "Nếu có nội dung hướng dẫn nào chưa rõ, xin vui lòng hỏi và trao đổi với đội ngũ nhân viên y tế chuyên nghiệp.",
      th: "หากมีเนื้อหาการให้ความรู้ที่ไม่เข้าใจ ยินดีให้สอบถามและปรึกษากับทีมบุคลากรทางการแพทย์",
    },
  ],
];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const COMPILED = PHRASES.map(([zh, tr]) => ({
  re: new RegExp(`^${escapeRe(zh).replace("\\{X\\}", "(.{1,6}?)").replace("\\{D\\}", "(\\d{1,2}) 月 (\\d{1,2}) 日")}$`),
  hasX: zh.includes("{X}"),
  hasD: zh.includes("{D}"),
  tr,
}));

const UI_TEXT: Record<TranslateLang, { title: string; phone: string; untranslated: string }> = {
  id: {
    title: "Catatan perawatan untuk keluarga",
    phone: "Telepon",
    untranslated: "(Mode demo: hanya kalimat contoh yang diterjemahkan; kalimat lain tetap dalam bahasa Mandarin.)",
  },
  vi: {
    title: "Lời dặn chăm sóc cho gia đình",
    phone: "Điện thoại",
    untranslated: "(Chế độ demo: chỉ các câu mẫu được dịch; các câu khác giữ nguyên tiếng Trung.)",
  },
  th: {
    title: "ข้อแนะนำการดูแลสำหรับครอบครัว",
    phone: "โทร",
    untranslated: "(โหมดสาธิต: แปลเฉพาะประโยคตัวอย่าง ประโยคอื่นยังเป็นภาษาจีน)",
  },
};

function translateSentence(s: string, lang: TranslateLang): string | null {
  for (const p of COMPILED) {
    const m = p.re.exec(s);
    if (!m) continue;
    let out = p.tr[lang];
    let i = 1;
    if (p.hasX) {
      const word = TERM_WORD[lang][termGroup(m[i++])];
      out = out.replace("{Xc}", word.charAt(0).toUpperCase() + word.slice(1)).replace("{X}", word);
    }
    if (p.hasD) out = out.replace("{D}", MONTH[lang](Number(m[i]), Number(m[i + 1])));
    return out;
  }
  return null;
}

/**
 * 示範翻譯：示範衛教逐句換成預先準備的譯文（印尼文、越南文、泰文）；
 * 示範以外的句子保留中文並在開頭註明，不假裝翻譯。
 */
export function demoTranslate(req: TranslateRequest): string {
  const { lang } = req;
  const ui = UI_TEXT[lang];
  let untranslated = 0;
  const lines = req.text.split(/\r?\n/).map((raw) => {
    const line = raw.trim();
    if (!line) return "";
    const title = /^【[^】]+】\s*(\d{4})\/(\d{2})\/(\d{2})$/.exec(line);
    if (title) return `${ui.title} – ${title[3]}/${title[2]}/${title[1]}`;
    if (/電話[：:]/.test(line)) return line.replace(/電話[：:]/, `${ui.phone}: `);
    const num = /^(\d+\.\s+)(.*)$/.exec(line);
    const prefix = num?.[1] ?? "";
    const content = num?.[2] ?? line;
    const whole = translateSentence(content, lang);
    if (whole) return prefix + whole;
    const parts = sentences(content).map((s) => translateSentence(s, lang));
    if (parts.length && parts.every((p): p is string => p !== null)) return prefix + parts.join(" ");
    untranslated++;
    return line;
  });
  const body = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return [TRANSLATION_PREFIX[lang], ...(untranslated ? [ui.untranslated] : []), body].join("\n");
}
