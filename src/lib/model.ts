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
  last: { date: string; summary: string; vitals: { key: VitalKey; value: string; qualifier: string | null }[]; findings: string[] } | null;
  isDemo: boolean;
  isTemporary: boolean;
  createdAt: string;
  updatedAt: string;
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
  suggestions: Record<string, "adopted" | "skipped">;
  outputs: Record<DocKind, OutputState>;
  translations: Partial<Record<TranslateLang, { text: string; at: string; status: "writing" | "done" | "failed"; error: string | null }>>;
  reviewedAt: string | null;
  reviewedBy: string | null;
  completedAt: string | null;
  intakeOnly: boolean;
  recordingStartedAt: string | null;
  recordingEndedAt: string | null;
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
