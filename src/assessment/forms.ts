/**
 * 全人評估：基本資料＋13 張評估表（依機構雲端硬碟「13項評估表單」）。
 * 表單以資料描述，畫面、計分、給 AI 的摘要都由這裡產生。
 */

export type FormId =
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

export interface Option {
  value: string;
  label: string;
  score?: number;
}

export type Field =
  | { kind: "choice"; id: string; label: string; options: Option[] }
  | { kind: "multi"; id: string; label: string; options: Option[] }
  | { kind: "text"; id: string; label: string; placeholder?: string; long?: boolean; type?: "date" }
  | { kind: "number"; id: string; label: string; unit: string }
  | { kind: "scale"; id: string; label: string; min: number; max: number; low: string; high: string }
  | { kind: "check"; id: string; label: string };

export type FieldValue = string | string[] | boolean;
export type FormValues = Record<string, FieldValue | undefined>;

export type Level = { label: string; tone: "ok" | "warn" | "risk" };

export interface FormDef {
  id: FormId;
  title: string;
  /** 清單與分數膠囊用的短名。 */
  short: string;
  hint?: string;
  fields: Field[];
  score?: {
    max: number;
    /** 計分題全部作答才有分數。 */
    compute: (v: FormValues) => number | null;
    level: (n: number) => Level;
    /** 「分」或「項」。 */
    unit: string;
  };
}

const yesNo = (yesScore = 1): Option[] => [
  { value: "no", label: "否", score: 0 },
  { value: "yes", label: "是", score: yesScore },
];

const scored = (fields: Field[]) => fields.filter((f): f is Extract<Field, { kind: "choice" }> => f.kind === "choice" && f.options.some((o) => o.score !== undefined));

/** 計分題的總和；有任一題未作答就回傳 null。 */
function sumScores(fields: Field[]) {
  return (v: FormValues) => {
    let total = 0;
    for (const f of scored(fields)) {
      const opt = f.options.find((o) => o.value === v[f.id]);
      if (!opt) return null;
      total += opt.score ?? 0;
    }
    return total;
  };
}

const ok = (label: string): Level => ({ label, tone: "ok" });
const warn = (label: string): Level => ({ label, tone: "warn" });
const risk = (label: string): Level => ({ label, tone: "risk" });

/* ------------------------------ 表單 ------------------------------ */

const BRADEN: Field[] = [
  { kind: "choice", id: "sensory", label: "感知能力", options: [{ value: "1", label: "完全受限", score: 1 }, { value: "2", label: "非常受限", score: 2 }, { value: "3", label: "微弱受限", score: 3 }, { value: "4", label: "無受損", score: 4 }] },
  { kind: "choice", id: "moisture", label: "潮濕程度", options: [{ value: "1", label: "持續潮濕", score: 1 }, { value: "2", label: "非常潮濕", score: 2 }, { value: "3", label: "偶爾潮濕", score: 3 }, { value: "4", label: "很少潮濕", score: 4 }] },
  { kind: "choice", id: "activity", label: "活動能力", options: [{ value: "1", label: "臥床", score: 1 }, { value: "2", label: "坐輪椅", score: 2 }, { value: "3", label: "偶爾行走", score: 3 }, { value: "4", label: "經常行走", score: 4 }] },
  { kind: "choice", id: "mobility", label: "移動能力", options: [{ value: "1", label: "完全無法", score: 1 }, { value: "2", label: "嚴重受限", score: 2 }, { value: "3", label: "輕微受限", score: 3 }, { value: "4", label: "不受限", score: 4 }] },
  { kind: "choice", id: "nutrition", label: "營養攝取", options: [{ value: "1", label: "非常差", score: 1 }, { value: "2", label: "可能不足", score: 2 }, { value: "3", label: "足夠", score: 3 }, { value: "4", label: "非常好", score: 4 }] },
  { kind: "choice", id: "friction", label: "摩擦力與剪力", options: [{ value: "1", label: "有問題", score: 1 }, { value: "2", label: "潛在問題", score: 2 }, { value: "3", label: "無明顯問題", score: 3 }] },
];

const FALL: Field[] = [
  { kind: "choice", id: "history", label: "過去三個月內曾跌倒", options: yesNo(25) },
  { kind: "choice", id: "diagnosis", label: "多重疾病診斷（超過一個）", options: yesNo(15) },
  { kind: "choice", id: "aid", label: "使用行走輔具", options: [{ value: "none", label: "不需／臥床／他人協助", score: 0 }, { value: "crutches", label: "柺杖／助行器／手杖", score: 15 }, { value: "furniture", label: "扶靠家具行走", score: 30 }] },
  { kind: "choice", id: "iv", label: "使用靜脈注射／留置針", options: yesNo(20) },
  { kind: "choice", id: "gait", label: "步態", options: [{ value: "normal", label: "正常／臥床／輪椅", score: 0 }, { value: "weak", label: "軟弱", score: 10 }, { value: "impaired", label: "失損／不穩", score: 20 }] },
  { kind: "choice", id: "mental", label: "認知狀態", options: [{ value: "oriented", label: "量力而為", score: 0 }, { value: "forget", label: "高估自己／忘記限制", score: 15 }] },
];

const ADL: Field[] = [
  { kind: "choice", id: "feeding", label: "進食", options: [{ value: "0", label: "完全依賴", score: 0 }, { value: "5", label: "需協助切食", score: 5 }, { value: "10", label: "可自行進食", score: 10 }] },
  { kind: "choice", id: "transfers", label: "移位（床↔椅）", options: [{ value: "0", label: "完全依賴", score: 0 }, { value: "5", label: "大量協助", score: 5 }, { value: "10", label: "少量協助", score: 10 }, { value: "15", label: "可自行移位", score: 15 }] },
  { kind: "choice", id: "grooming", label: "個人修飾（洗臉、梳頭）", options: [{ value: "0", label: "需協助", score: 0 }, { value: "5", label: "可自行完成", score: 5 }] },
  { kind: "choice", id: "toilet", label: "如廁", options: [{ value: "0", label: "完全依賴", score: 0 }, { value: "5", label: "需協助", score: 5 }, { value: "10", label: "可自行完成", score: 10 }] },
  { kind: "choice", id: "bathing", label: "洗澡", options: [{ value: "0", label: "需協助", score: 0 }, { value: "5", label: "可自行完成", score: 5 }] },
  { kind: "choice", id: "mobility", label: "行走／活動", options: [{ value: "0", label: "無法行走", score: 0 }, { value: "5", label: "輪椅推行", score: 5 }, { value: "10", label: "需扶持行走", score: 10 }, { value: "15", label: "可獨立行走", score: 15 }] },
  { kind: "choice", id: "stairs", label: "上下樓梯", options: [{ value: "0", label: "無法", score: 0 }, { value: "5", label: "需協助", score: 5 }, { value: "10", label: "可自行上下", score: 10 }] },
  { kind: "choice", id: "dressing", label: "穿脫衣物", options: [{ value: "0", label: "完全依賴", score: 0 }, { value: "5", label: "需協助", score: 5 }, { value: "10", label: "可自行完成", score: 10 }] },
  { kind: "choice", id: "bowels", label: "大便控制", options: [{ value: "0", label: "失禁", score: 0 }, { value: "5", label: "偶爾失禁", score: 5 }, { value: "10", label: "可控制", score: 10 }] },
  { kind: "choice", id: "bladder", label: "小便控制", options: [{ value: "0", label: "失禁", score: 0 }, { value: "5", label: "偶爾失禁", score: 5 }, { value: "10", label: "可控制", score: 10 }] },
];

export const IADL_ITEMS = ["使用電話", "購物", "備餐", "家務維持", "洗衣服", "外出交通", "服用藥物", "處理財務"] as const;

const SPMSQ_ITEMS = ["今天是幾號？", "今天是星期幾？", "這裡是哪裡？", "您的電話號碼或地址？", "您幾歲？", "您出生年月日？", "現任總統是誰？", "前任總統是誰？", "媽媽叫什麼名字？", "20 減 3 等於多少？再減 3？"];

const BSRS_ITEMS = ["感覺緊張不安", "覺得容易苦惱或動怒", "感覺憂鬱、心情低落", "覺得比不上別人", "睡眠困難"];
const BSRS_OPTIONS: Option[] = [
  { value: "0", label: "完全沒有", score: 0 },
  { value: "1", label: "輕微", score: 1 },
  { value: "2", label: "中等", score: 2 },
  { value: "3", label: "厲害", score: 3 },
  { value: "4", label: "非常厲害", score: 4 },
];

const MNA: Field[] = [
  { kind: "choice", id: "intake", label: "過去三個月食慾是否減少", options: [{ value: "0", label: "嚴重減少", score: 0 }, { value: "1", label: "中度減少", score: 1 }, { value: "2", label: "無改變", score: 2 }] },
  { kind: "choice", id: "weightLoss", label: "過去三個月體重減輕", options: [{ value: "0", label: "大於 3 公斤", score: 0 }, { value: "1", label: "不知道", score: 1 }, { value: "2", label: "1～3 公斤", score: 2 }, { value: "3", label: "無減輕", score: 3 }] },
  { kind: "choice", id: "mobility", label: "活動能力", options: [{ value: "0", label: "需臥床／輪椅", score: 0 }, { value: "1", label: "可下床但無法外出", score: 1 }, { value: "2", label: "可自由外出", score: 2 }] },
  { kind: "choice", id: "stress", label: "過去三個月有心理壓力或急性疾病", options: [{ value: "yes", label: "是", score: 0 }, { value: "no", label: "否", score: 2 }] },
  { kind: "choice", id: "neuro", label: "神經心理問題（失智／憂鬱）", options: [{ value: "0", label: "嚴重失智／憂鬱", score: 0 }, { value: "1", label: "輕度失智", score: 1 }, { value: "2", label: "無", score: 2 }] },
  { kind: "choice", id: "bmi", label: "BMI", options: [{ value: "0", label: "小於 19", score: 0 }, { value: "1", label: "19～未滿 21", score: 1 }, { value: "2", label: "21～未滿 23", score: 2 }, { value: "3", label: "23 以上", score: 3 }] },
];

const FRAILTY: Field[] = [
  { kind: "choice", id: "f1", label: "體重減輕（過去一年非刻意減輕超過 4.5 公斤或 5%）", options: yesNo() },
  { kind: "choice", id: "f2", label: "覺得疲憊（做任何事都費力、無法出門）", options: yesNo() },
  { kind: "choice", id: "f3", label: "肌力下降（握力明顯減退）", options: yesNo() },
  { kind: "choice", id: "f4", label: "行走速度變慢（10 公尺行走困難或緩慢）", options: yesNo() },
  { kind: "choice", id: "f5", label: "體能活動度低（每週活動量少）", options: yesNo() },
];

export const FORMS: FormDef[] = [
  {
    id: "basic",
    title: "基本資料",
    short: "基本資料",
    fields: [
      { kind: "text", id: "chartNo", label: "病歷號碼" },
      { kind: "text", id: "dob", label: "出生日期", type: "date" },
      { kind: "text", id: "idNo", label: "身分證字號" },
      { kind: "choice", id: "education", label: "教育程度", options: ["不識字", "國小", "國中", "高中職", "大專以上"].map((l) => ({ value: l, label: l })) },
      { kind: "text", id: "caregiver", label: "主要照顧者", placeholder: "姓名／關係，例如 王小美／女兒" },
      { kind: "text", id: "address", label: "通訊地址" },
    ],
  },
  {
    id: "habits",
    title: "健康習慣",
    short: "健康習慣",
    fields: [
      { kind: "choice", id: "smoking", label: "吸菸", options: ["無", "偶爾", "每天", "已戒菸"].map((l) => ({ value: l, label: l })) },
      { kind: "choice", id: "alcohol", label: "飲酒", options: ["無", "偶爾", "經常", "酗酒"].map((l) => ({ value: l, label: l })) },
      { kind: "choice", id: "betelnut", label: "嚼食檳榔", options: ["無", "有", "已戒除"].map((l) => ({ value: l, label: l })) },
      { kind: "text", id: "exercise", label: "運動習慣（頻率／類型）", placeholder: "例如 每天床上被動運動 2 次" },
    ],
  },
  {
    id: "history",
    title: "疾病史",
    short: "疾病史",
    fields: [
      { kind: "multi", id: "diseases", label: "既往病史（可複選）", options: ["高血壓", "糖尿病", "心臟病", "腦中風", "慢性腎臟病", "氣喘／COPD", "癌症", "失智症", "關節炎", "肝炎"].map((l) => ({ value: l, label: l })) },
      { kind: "text", id: "surgeries", label: "手術史", placeholder: "年份／手術名稱" },
      { kind: "text", id: "allergies", label: "過敏史（藥物／食物）", placeholder: "無，或寫出過敏原" },
    ],
  },
  {
    id: "meds",
    title: "藥物安全性評估",
    short: "藥物安全",
    fields: [
      { kind: "choice", id: "polypharmacy", label: "多重用藥（5 種以上）", options: [{ value: "是", label: "是" }, { value: "否", label: "否" }] },
      { kind: "choice", id: "compliance", label: "服藥遵從性", options: ["完全配合", "偶爾忘記", "經常忘記／不吃"].map((l) => ({ value: l, label: l })) },
      { kind: "choice", id: "highRiskMeds", label: "使用高風險藥物（抗凝血、降血糖、鎮靜安眠）", options: [{ value: "是", label: "是" }, { value: "否", label: "否" }] },
      { kind: "choice", id: "otc", label: "自行購買成藥／中草藥", options: [{ value: "是", label: "是" }, { value: "否", label: "否" }] },
      { kind: "text", id: "medList", label: "目前主要用藥", placeholder: "藥名／劑量／頻次", long: true },
    ],
  },
  {
    id: "physical",
    title: "身體評估",
    short: "身體評估",
    fields: [
      { kind: "number", id: "height", label: "身高", unit: "cm" },
      { kind: "number", id: "weight", label: "體重", unit: "kg" },
      { kind: "number", id: "bt", label: "體溫", unit: "°C" },
      { kind: "number", id: "hr", label: "脈搏", unit: "次/分" },
      { kind: "number", id: "rr", label: "呼吸", unit: "次/分" },
      { kind: "number", id: "sbp", label: "收縮壓", unit: "mmHg" },
      { kind: "number", id: "dbp", label: "舒張壓", unit: "mmHg" },
      { kind: "number", id: "painScore", label: "疼痛分數", unit: "0–10" },
      { kind: "choice", id: "consciousness", label: "意識狀態", options: ["清楚（E4V5M6）", "嗜睡", "混亂", "昏迷"].map((l) => ({ value: l, label: l })) },
      { kind: "text", id: "otherFindings", label: "其他身體發現", long: true },
    ],
  },
  {
    id: "braden",
    title: "Braden 壓力性損傷風險評估",
    short: "Braden 壓傷",
    hint: "分數越低風險越高：12 分以下高危險、13–14 中危險、15–16 低危險",
    fields: BRADEN,
    score: { max: 23, unit: "分", compute: sumScores(BRADEN), level: (n) => (n <= 12 ? risk("高危險") : n <= 14 ? warn("中危險") : n <= 16 ? warn("低危險") : ok("無明顯風險")) },
  },
  {
    id: "fall",
    title: "跌倒危險因子評估（Morse）",
    short: "跌倒",
    hint: "45 分以上高危險、25–44 中度危險",
    fields: FALL,
    score: { max: 125, unit: "分", compute: sumScores(FALL), level: (n) => (n >= 45 ? risk("高危險") : n >= 25 ? warn("中度危險") : ok("低危險")) },
  },
  {
    id: "adl",
    title: "日常生活功能（巴氏量表）",
    short: "ADL",
    hint: "0–20 完全依賴、21–60 嚴重依賴、61–90 中度依賴、91–99 輕度依賴、100 獨立",
    fields: ADL,
    score: {
      max: 100,
      unit: "分",
      compute: sumScores(ADL),
      level: (n) => (n <= 20 ? risk("完全依賴") : n <= 60 ? risk("嚴重依賴") : n <= 90 ? warn("中度依賴") : n < 100 ? warn("輕度依賴") : ok("獨立")),
    },
  },
  {
    id: "iadl",
    title: "工具性日常生活活動（IADL）",
    short: "IADL",
    hint: "勾選可獨立完成的項目",
    fields: IADL_ITEMS.map((l, i) => ({ kind: "check" as const, id: `i${i + 1}`, label: l })),
    score: {
      max: 8,
      unit: "項",
      compute: (v) => (v._saved ? IADL_ITEMS.filter((_, i) => v[`i${i + 1}`] === true).length : null),
      level: (n) => (n <= 3 ? risk("需大量協助") : n <= 6 ? warn("部分需協助") : ok("可獨立生活")),
    },
  },
  {
    id: "cognitive",
    title: "認知功能（SPMSQ）",
    short: "認知",
    hint: "每答錯一題 1 分：0–2 正常、3–4 輕度、5–7 中度、8–10 重度障礙",
    fields: SPMSQ_ITEMS.map((l, i) => ({ kind: "choice" as const, id: `q${i + 1}`, label: l, options: [{ value: "correct", label: "答對", score: 0 }, { value: "wrong", label: "答錯", score: 1 }] })),
    score: {
      max: 10,
      unit: "分",
      compute: (v) => sumScores(SPMSQ_ITEMS.map((_, i) => ({ kind: "choice", id: `q${i + 1}`, label: "", options: [{ value: "correct", label: "", score: 0 }, { value: "wrong", label: "", score: 1 }] })))(v),
      level: (n) => (n <= 2 ? ok("正常") : n <= 4 ? warn("輕度障礙") : n <= 7 ? risk("中度障礙") : risk("重度障礙")),
    },
  },
  {
    id: "emotional",
    title: "情緒問題（簡式健康量表 BSRS-5）",
    short: "情緒",
    hint: "過去一週的困擾程度；總分 10 分以上建議轉介；有自殺意念需立即處理",
    fields: [
      ...BSRS_ITEMS.map((l, i) => ({ kind: "choice" as const, id: `e${i + 1}`, label: l, options: BSRS_OPTIONS })),
      { kind: "choice", id: "suicide", label: "有無自殺意念", options: [{ value: "no", label: "無" }, { value: "yes", label: "有（需立即介入）" }] },
    ],
    score: {
      max: 20,
      unit: "分",
      compute: (v) => sumScores(BSRS_ITEMS.map((_, i) => ({ kind: "choice", id: `e${i + 1}`, label: "", options: BSRS_OPTIONS })))(v),
      level: (n) => (n >= 15 ? risk("重度") : n >= 10 ? risk("中度，建議轉介") : n >= 6 ? warn("輕度") : ok("正常")),
    },
  },
  {
    id: "nutrition",
    title: "簡易營養評估（MNA-SF）",
    short: "營養",
    hint: "12–14 正常、8–11 營養不良高風險、0–7 營養不良",
    fields: MNA,
    score: { max: 14, unit: "分", compute: sumScores(MNA), level: (n) => (n >= 12 ? ok("正常") : n >= 8 ? warn("營養不良高風險") : risk("營養不良")) },
  },
  {
    id: "pain",
    title: "疼痛評估",
    short: "疼痛",
    fields: [
      { kind: "scale", id: "intensity", label: "疼痛強度（NPRS）", min: 0, max: 10, low: "無痛", high: "最痛" },
      { kind: "text", id: "location", label: "疼痛位置", placeholder: "例如 右髖部" },
      { kind: "choice", id: "nature", label: "疼痛性質", options: ["悶痛", "刺痛", "燒灼感", "壓迫感", "絞痛"].map((l) => ({ value: l, label: l })) },
      { kind: "choice", id: "freq", label: "發作頻率", options: ["持續性", "間歇性", "偶發性"].map((l) => ({ value: l, label: l })) },
      { kind: "text", id: "relieving", label: "緩解因素（做什麼會比較舒服）" },
    ],
    score: {
      max: 10,
      unit: "分",
      compute: (v) => (typeof v.intensity === "string" && v.intensity !== "" ? Number(v.intensity) : null),
      level: (n) => (n >= 7 ? risk("重度疼痛") : n >= 4 ? warn("中度疼痛") : n >= 1 ? warn("輕度疼痛") : ok("無痛")),
    },
  },
  {
    id: "frailty",
    title: "衰弱評估（Fried 衰弱表現型）",
    short: "衰弱",
    hint: "符合 0 項強健、1–2 項衰弱前期、3 項以上衰弱",
    fields: FRAILTY,
    score: { max: 5, unit: "項", compute: sumScores(FRAILTY), level: (n) => (n >= 3 ? risk("衰弱") : n >= 1 ? warn("衰弱前期") : ok("強健")) },
  },
];

export const FORM_BY_ID = Object.fromEntries(FORMS.map((f) => [f.id, f])) as Record<FormId, FormDef>;

/** 13 張評估表（不含基本資料）。 */
export const ASSESSMENT_FORMS = FORMS.filter((f) => f.id !== "basic");

/** 全人評估每半年重做一次（初訪日起算；重新評估後依該次日期重算）。 */
export const REASSESS_DAYS = 182;

export interface FormRecord {
  values: FormValues;
  savedAt: string;
  savedBy: string;
}

export interface HolisticAssessment {
  forms: Partial<Record<FormId, FormRecord>>;
  /** 13 張都完成的日期（YYYY-MM-DD）；用來算下次評估。 */
  completedOn: string | null;
  updatedAt: string;
  updatedBy: string;
}

export function scoreOf(form: FormDef, rec: FormRecord | undefined): { score: number; level: Level } | null {
  if (!form.score || !rec) return null;
  const n = form.score.compute({ ...rec.values, _saved: true });
  return n === null ? null : { score: n, level: form.score.level(n) };
}

export function completedCount(a: HolisticAssessment | null | undefined): number {
  return ASSESSMENT_FORMS.filter((f) => a?.forms[f.id]).length;
}

function answerText(field: Field, value: FieldValue | undefined): string | null {
  if (value === undefined || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  switch (field.kind) {
    case "choice":
      return field.options.find((o) => o.value === value)?.label ?? String(value);
    case "multi":
      return (value as string[]).join("、");
    case "check":
      return value === true ? "可獨立" : null;
    case "number":
      return `${value} ${field.unit}`;
    default:
      return String(value);
  }
}

/** 單張表的摘要文字，例如「Braden 壓傷 12 分（高危險）：感知能力 非常受限、潮濕程度 持續潮濕…」。 */
export function formSummary(form: FormDef, rec: FormRecord | undefined): string | null {
  if (!rec) return null;
  const s = scoreOf(form, rec);
  const head = s ? `${form.short} ${s.score}${form.score!.unit}（${s.level.label}）` : form.short;
  if (form.id === "iadl") {
    const can = IADL_ITEMS.filter((_, i) => rec.values[`i${i + 1}`] === true);
    const cannot = IADL_ITEMS.filter((_, i) => rec.values[`i${i + 1}`] !== true);
    return `${head}：可獨立 ${can.join("、") || "無"}；需協助 ${cannot.join("、") || "無"}`;
  }
  const parts: string[] = [];
  for (const f of form.fields) {
    const t = answerText(f, rec.values[f.id]);
    if (!t) continue;
    // 計分表只列出失分（非滿分）的項目，避免摘要太長。
    if (s && f.kind === "choice") {
      const opt = f.options.find((o) => o.value === rec.values[f.id]);
      const best = Math.max(...f.options.map((o) => o.score ?? 0));
      const worst = Math.min(...f.options.map((o) => o.score ?? 0));
      const good = form.id === "fall" || form.id === "cognitive" || form.id === "emotional" || form.id === "frailty" ? opt?.score === worst : opt?.score === best;
      if (good) continue;
    }
    parts.push(`${f.label} ${t}`);
  }
  return parts.length ? `${head}：${parts.join("、")}` : head;
}

/** 給 AI 擬定護理計畫的全人評估摘要（只含已完成的表；基本資料只給教育程度，不給姓名、身分證、地址）。 */
export function assessmentSummary(a: HolisticAssessment | null | undefined): string | null {
  if (!a) return null;
  const lines = ASSESSMENT_FORMS.map((f) => formSummary(f, a.forms[f.id])).filter((x): x is string => !!x);
  const edu = a.forms.basic?.values.education;
  if (typeof edu === "string" && edu) lines.unshift(`基本資料：教育程度 ${edu}`);
  return lines.length ? lines.join("\n") : null;
}

/** 下次全人評估日期（完成日＋半年）；還沒完成時為 null。 */
export function nextAssessmentDue(a: HolisticAssessment | null | undefined): string | null {
  if (!a?.completedOn) return null;
  const d = new Date(`${a.completedOn}T00:00:00`);
  d.setDate(d.getDate() + REASSESS_DAYS);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
