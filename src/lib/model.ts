import type { FormId, FormRecord, HolisticAssessment } from "../assessment/forms";
import type {
  AiMeta,
  Analysis,
  DocKind,
  DocSection,
  TranslateLang,
  Transcript,
  VitalKey,
} from "../../shared/types";

export type Gender = "女" | "男";

export interface Tube {
  id: string;
  name: string;
  /** 上次更換日（YYYY-MM-DD）。 */
  changedAt: string | null;
  intervalDays: number | null;
}

/** 非計畫性住院或急診（照護紀錄導出的兩個區塊），記在個案上，導出時取訪視日前 30 天內的。 */
export interface CareEvent {
  id: string;
  kind: "admission" | "er";
  /** YYYY-MM-DD */
  date: string;
  shift: "白班" | "小夜" | "大夜" | null;
  reason: string;
}

export const SHIFT_RANGE: Record<NonNullable<CareEvent["shift"]>, string> = {
  白班: "08：00～16：00",
  小夜: "16：00～24：00",
  大夜: "00：00～08：00",
};

export interface RecordingConsent {
  by: "個案本人" | "家屬";
  at: string;
  version: string;
  expiresAt: string;
}

export interface Patient {
  id: string;
  name: string;
  gender: Gender | null;
  birthYear: number | null;
  familyCallsAs: string | null;
  diagnoses: string[];
  tubes: Tube[];
  consent: RecordingConsent | null;
  consentRefusedAt: string | null;
  plan: { version: number; text: string; confirmedAt: string; by: string } | null;
  /** 上一次完成的訪視（visitId：是哪一筆完成時寫入的）。 */
  last: { date: string; summary: string; vitals: { key: VitalKey; value: string; qualifier: string | null }[]; findings: string[]; visitId?: string } | null;
  isDemo: boolean;
  isTemporary: boolean;
  createdAt: string;
  updatedAt: string;
  /* 照護紀錄導出用的個案資料（舊資料可能沒有）。 */
  /** 收案日期 YYYY-MM-DD。 */
  intakeDate?: string | null;
  /** 居住所：在宅(居家)、住宿式機構… */
  residence?: string | null;
  /** 居住區域：縣市＋行政區。 */
  area?: string | null;
  /** 使用資源：健保第一類…、長照、自費… */
  resource?: string | null;
  heightCm?: string | null;
  events?: CareEvent[];
  /** 全人評估（基本資料＋13 張表）。 */
  assessment?: HolisticAssessment | null;
  /** 全人評估的修改歷程（每次儲存前的舊版本，只增不刪）。 */
  assessmentHistory?: { formId: FormId; record: FormRecord; replacedAt: string }[];
}

export type VisitStatus =
  | "scheduled"
  | "recording"
  | "paused"
  | "interrupted"
  | "waiting"
  | "processing"
  | "review"
  | "done"
  | "failed";

export type Stage = "upload" | "transcribe" | "analyze" | "write";

export const STAGE_LABEL: Record<Stage, string> = {
  upload: "上傳",
  transcribe: "轉文字",
  analyze: "整理重點",
  write: "撰寫 3 份",
};

export interface AudioPart {
  id: string;
  blobKey: string;
  mimeType: string;
  durationMs: number;
  startedAt: string;
  /** 匯入的檔名（App 內錄音為 null）。 */
  fileName: string | null;
}

export interface VisitDocument {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  blobKey: string;
  addedAt: string;
}

export interface ResolvedVital {
  value: string | null;
  qualifier: string | null;
  by: "ai" | "nurse";
  confirmed: boolean;
}

export interface OutputVersion {
  id: string;
  sections: DocSection[];
  origin: "ai" | "nurse" | "regen";
  note: string | null;
  createdAt: string;
  meta: AiMeta | null;
  /** 伺服器輸出檢核的提醒（數字無來源、超出 AI 界線…），護理師看過才能複製。 */
  warnings?: string[];
}

export type OutputStatus = "idle" | "writing" | "draft" | "edited" | "confirmed" | "failed";

export interface OutputState {
  status: OutputStatus;
  versions: OutputVersion[];
  current: number;
  /** 背景重新產生、尚未採用的新版本索引。 */
  candidate: number | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  copiedAt: string | null;
  sharedAt: string | null;
  /** 護理計畫確認時設定的版號。 */
  planVersion: number | null;
  error: AppError | null;
  /** 背景正在產生新版本（已修改或已確認的不會被覆寫）。 */
  busy?: boolean;
  /** 目前版本的檢核提醒已由護理師看過。 */
  warningsAck?: boolean;
}

export interface AppError {
  stage: Stage | DocKind | "translate";
  code: string;
  message: string;
  retryable: boolean;
  at: string;
}

export interface Visit {
  id: string;
  patientId: string;
  date: string;
  time: string | null;
  createdAt: string;
  status: VisitStatus;
  stage: Stage | null;
  stageStartedAt: string | null;
  error: AppError | null;
  parts: AudioPart[];
  documents: VisitDocument[];
  typedVitals: Partial<Record<VitalKey, string>>;
  typedQualifiers: Partial<Record<VitalKey, string>>;
  notes: string | null;
  transcript: Transcript | null;
  analysis: Analysis | null;
  analysisMeta: AiMeta | null;
  vitals: Partial<Record<VitalKey, ResolvedVital>>;
  changesConfirmed: { by: string; at: string } | null;
  dismissedChanges: string[];
  docsChecked: { by: string; at: string } | null;
  identityConfirmed: boolean;
  /** 跨來源衝突：護理師選定的說法。 */
  conflictChoices: Record<string, string>;
  suggestions: Record<string, "adopted" | "skipped">;
  outputs: Record<DocKind, OutputState>;
  translations: Partial<Record<TranslateLang, { text: string; at: string; status: "writing" | "done" | "failed"; error: string | null }>>;
  reviewedAt: string | null;
  reviewedBy: string | null;
  completedAt: string | null;
  intakeOnly: boolean;
  recordingStartedAt: string | null;
  recordingEndedAt: string | null;
  /** 處理中又補了資料：這輪結束後重新整理。 */
  reprocessQueued?: { audio: boolean } | null;
  /** 初次訪視（需全人評估、依評估擬定計畫）或再次訪視。舊資料沒有時視為再次訪視。 */
  kind?: "first" | "follow";
  /* 照護紀錄導出用的訪視資料（舊資料可能沒有）。 */
  /** 紀錄來源：家訪、電訪… */
  source?: string;
  /** 服務項目（沒設定時依個案管路推算）。 */
  serviceItems?: string[];
  /** 身體測量：體重、臂中圍、小腿圍（身高在個案上）。字串保留護理師輸入的寫法。 */
  body?: { weightKg?: string; macCm?: string; calfCm?: string };
  /** 導出紀錄（誰、何時產生 PDF）。 */
  exports?: { at: string; by: string }[];
  /**
   * 第一次整理時拿來比較的「上次訪視」快照。這筆完成後個案的「上次」會換成它自己，
   * 之後重新產生仍要跟真正的上次比，不能跟自己比。
   */
  previous?: Patient["last"];
}

export interface Settings {
  id: "me";
  onboarded: boolean;
  consentVersion: string | null;
  consentAt: string | null;
  nurseName: string;
  clinicName: string;
  clinicPhone: string;
  theme: "system" | "light" | "dark";
  size: "standard" | "large";
  recordStyle: "four" | "narrative";
  recordTitle: "護理紀錄" | "訪視紀錄";
  vitalsOrder: "standard" | "line";
  translateLang: TranslateLang;
  retentionDays: number;
  copyBodyOnly: boolean;
  /** 示範模式：不呼叫 AI，新紀錄一律使用示範內容（並標示「示範資料」）。 */
  demoMode: boolean;
  /** 伺服器要求的機構通行碼。 */
  accessCode: string;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "me",
  onboarded: false,
  consentVersion: null,
  consentAt: null,
  nurseName: "",
  clinicName: "",
  clinicPhone: "",
  theme: "system",
  size: "standard",
  recordStyle: "four",
  recordTitle: "護理紀錄",
  vitalsOrder: "standard",
  translateLang: "id",
  retentionDays: 30,
  copyBodyOnly: false,
  demoMode: false,
  accessCode: "",
};

export const CONSENT_VERSION = "2026.10";

export function emptyOutput(): OutputState {
  return {
    status: "idle",
    versions: [],
    current: 0,
    candidate: null,
    confirmedAt: null,
    confirmedBy: null,
    copiedAt: null,
    sharedAt: null,
    planVersion: null,
    error: null,
  };
}

export function newId(): string {
  return crypto.randomUUID();
}
