/**
 * 前後端共用的資料契約。
 * 管線：錄音／文件 →（STT）逐字稿 → 語意分析 Analysis → 三份文件 GeneratedDoc（平行撰寫）。
 * 生命徵象一律由程式依「已確認數值」組成，AI 不在文件內文重寫數字（規格 ★2）。
 */

export type VitalKey = "temp" | "pulse" | "resp" | "bp" | "spo2" | "glucose" | "consciousness";

export const VITAL_LABEL: Record<VitalKey, string> = {
  temp: "體溫",
  pulse: "脈搏",
  resp: "呼吸",
  bp: "血壓",
  spo2: "血氧",
  glucose: "血糖",
  consciousness: "意識",
};

export const VITAL_UNIT: Record<VitalKey, string> = {
  temp: "℃",
  pulse: "次/分",
  resp: "次/分",
  bp: "mmHg",
  spo2: "%",
  glucose: "mg/dL",
  consciousness: "",
};

export type VitalStatus = "ok" | "uncertain" | "implausible" | "conflict";

export interface VitalReading {
  key: VitalKey;
  /** 正規化後的值，例如 "36.8"、"142/86"、"96"；意識為短句。 */
  value: string;
  /** 附註：飯前／飯後、室內空氣／氧氣 2L、拍痰後… */
  qualifier: string | null;
  /** 逐字稿或文件中的原句。 */
  sourceQuote: string | null;
  /** 原句在整份錄音中的時間（毫秒），供 ▶ 原音。 */
  sourceMs: number | null;
  confidence: number;
  status: VitalStatus;
  /** 只有唯一合理解時才給（例如 16.8 → 36.8）。 */
  suggestion: string | null;
  /** 為什麼需要確認，例如「不在 34–42℃ 合理範圍」。 */
  reason: string | null;
  /** 臨床判讀：偏高／偏低（與 AI 狀態是兩條通道）。 */
  flag: "high" | "low" | null;
}

export type FindingOrigin = "audio" | "document" | "typed";

export interface Finding {
  /** 領域：意識、呼吸、循環、消化、排泄、皮膚與傷口、管路、營養、活動、睡眠、心理社會、疼痛、用藥、其他 */
  domain: string;
  text: string;
  sourceQuote: string | null;
  sourceMs: number | null;
  origin: FindingOrigin;
}

export interface AssessmentChange {
  id: string;
  kind: "new" | "worse" | "better" | "resolved";
  text: string;
  evidence: string | null;
}

export interface PlanSuggestion {
  id: string;
  problem: string;
  basis: string;
}

export interface DocFact {
  id: string;
  /** 診斷、用藥、管路、過敏、病史、功能狀態… */
  category: string;
  text: string;
  page: number | null;
  /** 字跡不清或低信心：不寫入輸出，列入待訪視確認。 */
  unclear: boolean;
}

export interface DocumentSummary {
  title: string;
  date: string | null;
  pages: number | null;
  patientHint: string | null;
}

/** 不同來源互相矛盾、需要護理師選擇的事實（生命徵象的衝突用 VitalReading.status）。 */
export interface SourceConflict {
  id: string;
  /** 例如「過敏史」。 */
  topic: string;
  text: string;
  /** 各來源的說法，例如「病摘：無過敏」「錄音：對盤尼西林過敏」。 */
  options: string[];
  evidence: string | null;
}

export interface Analysis {
  /** 一句話總結本次訪視（給今日卡「上次重點」用）。 */
  summary: string;
  /** 講者代號 → 角色，例如 S1 → 護理師。 */
  speakers: Record<string, string>;
  vitals: VitalReading[];
  findings: Finding[];
  tubes: { name: string; detail: string; changedToday: boolean; nextDue: string | null }[];
  wounds: { site: string; detail: string; care: string | null }[];
  /** 今日執行的護理處置。 */
  interventions: string[];
  /** 與上次已確認資料相比的評估異動（只擋計畫確認）。 */
  changes: AssessmentChange[];
  planSuggestions: PlanSuggestion[];
  educationTopics: string[];
  /** 本次提到的就醫警訊。 */
  redFlags: string[];
  docFacts: DocFact[];
  documents: DocumentSummary[];
  /** 稱謂、性別、年齡與個案資料矛盾時的說明。 */
  identityConcern: string | null;
  /** 本次未提及的評估領域。 */
  missingDomains: string[];
  /** 例如「02:10–02:30 疑似台語，轉寫不完整」。 */
  languageNotes: string[];
  /** 跨來源衝突（先看這裡第 3 類，擋全部複製）；舊資料可能沒有這個欄位。 */
  conflicts?: SourceConflict[];
}

export type DocKind = "record" | "plan" | "edu";

export const DOC_LABEL: Record<DocKind, string> = {
  record: "護理紀錄",
  plan: "護理計畫",
  edu: "家屬衛教",
};

export interface DocSection {
  heading: string;
  body: string;
}

export interface GeneratedDoc {
  kind: DocKind;
  sections: DocSection[];
}

export interface PatientContext {
  displayName: string;
  gender: "女" | "男" | null;
  age: number | null;
  /** 家屬怎麼稱呼個案，例如「阿嬤」。 */
  familyCallsAs: string | null;
  diagnoses: string[];
  tubes: { name: string; nextDue: string | null }[];
}

export interface PreviousVisit {
  date: string;
  summary: string;
  vitals: { key: VitalKey; value: string; qualifier: string | null }[];
  findings: string[];
}

export interface TranscriptSegment {
  startMs: number;
  endMs: number;
  text: string;
  speaker?: string;
  confidence?: number;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  durationMs: number;
  provider: string;
}

export interface UploadedDocument {
  name: string;
  mimeType: string;
  /** base64，不含 data: 前綴。 */
  data: string;
}

/* ------------------------- API ------------------------- */

export interface AnalyzeRequest {
  visitDate: string;
  patient: PatientContext;
  transcript: Transcript | null;
  documents: UploadedDocument[];
  /** 護理師自行輸入的數值（永遠勝過語音）。 */
  typedVitals: Partial<Record<VitalKey, string>>;
  /** 口述補充文字。 */
  notes: string | null;
  previous: PreviousVisit | null;
  currentPlan: string | null;
}

export interface AiMeta {
  mode: "claude" | "demo";
  model: string | null;
  promptVersion: string;
}

export interface AnalyzeResponse {
  analysis: Analysis;
  meta: AiMeta;
}

export interface GenerateRequest {
  kind: DocKind;
  visitDate: string;
  patient: PatientContext;
  analysis: Analysis;
  /** 已由護理師確認的生命徵象（程式會另外組成生命徵象行）。 */
  confirmedVitals: { key: VitalKey; value: string; qualifier: string | null }[];
  currentPlan: string | null;
  /** 已採用的計畫建議。 */
  adoptedSuggestions: string[];
  options: {
    recordStyle: "four" | "narrative";
    /** 重新產生的快速指示：更精簡、更詳細、家屬更好懂… */
    instructions: string[];
    custom: string | null;
    nurseName: string | null;
    clinicPhone: string | null;
  };
  /** 只有匯入文件、沒有今日訪視錄音時為 true（收案紀錄模板）。 */
  intakeOnly: boolean;
  /** 上次已確認的訪視資料：異常值提醒句「較前次（09/18，132/78 mmHg）上升」用。 */
  previous?: PreviousVisit | null;
}

export interface GenerateResponse {
  doc: GeneratedDoc;
  meta: AiMeta;
  /** 輸出檢核的提醒（例如找不到依據而被移除的數字），給護理師看，不含在文件內。 */
  warnings?: string[];
}

export type TranslateLang = "id" | "vi" | "th";

export const LANG_LABEL: Record<TranslateLang, string> = {
  id: "印尼文",
  vi: "越南文",
  th: "泰文",
};

export interface TranslateRequest {
  text: string;
  lang: TranslateLang;
}

export interface TranslateResponse {
  text: string;
  meta: AiMeta;
}

export interface ApiError {
  error: { code: string; message: string; retryable?: boolean };
}

export interface HealthResponse {
  ok: boolean;
  stt: string;
  llm: { mode: "claude" | "demo"; model: string | null };
  /** 伺服器設定了機構通行碼：除 /api/health 外的請求都要帶 X-Access-Code。 */
  auth?: boolean;
}
