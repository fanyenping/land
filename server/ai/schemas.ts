/**
 * zod 結構定義：
 * 1. 請求驗證（路由用）：對應 shared/types 的 AnalyzeRequest／GenerateRequest／TranslateRequest。
 * 2. 模型輸出（structured outputs 用）：限制在 API 支援的 JSON Schema 子集——
 *    物件一律必填、陣列、enum、`.nullable()`；不用 record、物件聯集、數值或長度限制。
 *    id 由程式補上，`speakers` 以陣列輸出再轉成物件，`flag` 由程式計算。
 */
import * as z from "zod/v4";
import { ASSESSMENT_MAX_CHARS } from "../../shared/assessment";
import { PLAN_DICTATION_MAX_CHARS } from "../../shared/planPolish";

/* ------------------------------ 共用 ------------------------------ */

export const VitalKeySchema = z.enum(["temp", "pulse", "resp", "bp", "spo2", "glucose", "consciousness"]);
const VitalStatusSchema = z.enum(["ok", "uncertain", "implausible", "conflict"]);
const ChangeKindSchema = z.enum(["new", "worse", "better", "resolved"]);
const OriginSchema = z.enum(["audio", "document", "typed"]);
const DocKindSchema = z.enum(["record", "plan", "edu"]);
export const TranslateLangSchema = z.enum(["id", "vi", "th"]);

/* ------------------------------ 請求 ------------------------------ */

const PatientSchema = z.object({
  displayName: z.string(),
  gender: z.enum(["女", "男"]).nullable(),
  age: z.number().nullable(),
  familyCallsAs: z.string().nullable(),
  diagnoses: z.array(z.string()),
  tubes: z.array(z.object({ name: z.string(), nextDue: z.string().nullable() })),
});

const PreviousSchema = z.object({
  date: z.string(),
  summary: z.string(),
  vitals: z.array(z.object({ key: VitalKeySchema, value: z.string(), qualifier: z.string().nullable() })),
  findings: z.array(z.string()),
});

const TranscriptSchema = z.object({
  text: z.string(),
  segments: z.array(
    z.object({
      startMs: z.number(),
      endMs: z.number(),
      text: z.string(),
      speaker: z.string().optional(),
      confidence: z.number().optional(),
    }),
  ),
  durationMs: z.number(),
  provider: z.string(),
});

/** Claude 可直接讀取的文件格式（PDF 與 4 種影像）。 */
export const DOCUMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif"] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];

/** 單份文件 base64 字元上限（約 10 MB 原檔）；zod 先擋超長字串，之後的檢查才不會處理巨量資料。 */
export const MAX_DOCUMENT_BASE64_CHARS = 14_000_000;

const DocumentSchema = z.object({
  name: z.string().max(300),
  /** 允許的格式在路由檢查（回 415 與明確說明）。 */
  mimeType: z.string().max(100),
  data: z.string().min(1).max(MAX_DOCUMENT_BASE64_CHARS),
});

export const AnalyzeRequestSchema = z.object({
  visitDate: z.string().min(1),
  patient: PatientSchema,
  transcript: TranscriptSchema.nullable(),
  documents: z.array(DocumentSchema).max(10),
  typedVitals: z.partialRecord(VitalKeySchema, z.string()),
  notes: z.string().max(20_000).nullable(),
  previous: PreviousSchema.nullable(),
  currentPlan: z.string().max(50_000).nullable(),
});

const VitalReadingSchema = z.object({
  key: VitalKeySchema,
  value: z.string(),
  qualifier: z.string().nullable(),
  sourceQuote: z.string().nullable(),
  sourceMs: z.number().nullable(),
  confidence: z.number(),
  status: VitalStatusSchema,
  suggestion: z.string().nullable(),
  reason: z.string().nullable(),
  flag: z.enum(["high", "low"]).nullable(),
});

/** 完整的 Analysis（前端回傳給 /api/generate 時驗證用）。 */
export const AnalysisSchema = z.object({
  summary: z.string(),
  speakers: z.record(z.string(), z.string()),
  vitals: z.array(VitalReadingSchema),
  findings: z.array(
    z.object({
      domain: z.string(),
      text: z.string(),
      sourceQuote: z.string().nullable(),
      sourceMs: z.number().nullable(),
      origin: OriginSchema,
    }),
  ),
  tubes: z.array(z.object({ name: z.string(), detail: z.string(), changedToday: z.boolean(), nextDue: z.string().nullable() })),
  wounds: z.array(z.object({ site: z.string(), detail: z.string(), care: z.string().nullable() })),
  interventions: z.array(z.string()),
  changes: z.array(z.object({ id: z.string(), kind: ChangeKindSchema, text: z.string(), evidence: z.string().nullable() })),
  planSuggestions: z.array(z.object({ id: z.string(), problem: z.string(), basis: z.string() })),
  educationTopics: z.array(z.string()),
  redFlags: z.array(z.string()),
  docFacts: z.array(
    z.object({ id: z.string(), category: z.string(), text: z.string(), page: z.number().nullable(), unclear: z.boolean() }),
  ),
  documents: z.array(
    z.object({ title: z.string(), date: z.string().nullable(), pages: z.number().nullable(), patientHint: z.string().nullable() }),
  ),
  identityConcern: z.string().nullable(),
  missingDomains: z.array(z.string()),
  languageNotes: z.array(z.string()),
  conflicts: z
    .array(
      z.object({ id: z.string(), topic: z.string(), text: z.string(), options: z.array(z.string()), evidence: z.string().nullable() }),
    )
    .optional(),
});

export const GenerateRequestSchema = z.object({
  kind: DocKindSchema,
  visitDate: z.string().min(1),
  patient: PatientSchema,
  analysis: AnalysisSchema,
  confirmedVitals: z.array(z.object({ key: VitalKeySchema, value: z.string(), qualifier: z.string().nullable() })),
  currentPlan: z.string().max(50_000).nullable(),
  adoptedSuggestions: z.array(z.string()),
  options: z.object({
    recordStyle: z.enum(["four", "narrative"]),
    instructions: z.array(z.string().max(200)).max(10),
    custom: z.string().max(500).nullable(),
    nurseName: z.string().max(50).nullable(),
    clinicPhone: z.string().max(50).nullable(),
  }),
  intakeOnly: z.boolean(),
  previous: PreviousSchema.nullable().optional(),
  /** 沒有時視為再次訪視（舊版前端不會送）。 */
  visitKind: z.enum(["first", "follow"]).optional(),
  assessment: z.string().max(ASSESSMENT_MAX_CHARS).nullable().optional(),
});

/**
 * 口述計畫整理：只收口述文字與格式選項。一般的 z.object 會丟掉不認識的欄位（analysis、assessment、currentPlan…），
 * 這就是「AI 只看得到口述」的保證。
 */
export const PolishPlanRequestSchema = z.object({
  visitDate: z.string().min(1).max(20),
  dictation: z.string().trim().min(1).max(PLAN_DICTATION_MAX_CHARS),
  familyCallsAs: z.string().max(20).nullable(),
  hasCurrentPlan: z.boolean(),
  options: z.object({
    instructions: z.array(z.string().max(200)).max(5),
    custom: z.string().max(500).nullable(),
  }),
});

export const TranslateRequestSchema = z.object({
  text: z.string().min(1).max(20_000),
  lang: TranslateLangSchema,
});

/* ------------------------------ 模型輸出 ------------------------------ */

const d = <T extends z.ZodType>(schema: T, text: string): T => schema.describe(text) as T;

export const AnalysisOutputSchema = z.object({
  summary: z.string().describe("一句話（40 字內）總結本次訪視重點"),
  speakers: z.array(z.object({ id: z.string().describe("照抄逐字稿行首的講者代號，例如 S1、P2-S1"), role: z.string().describe("護理師、個案、家屬（女兒）、看護、不明") })),
  vitals: z.array(
    z.object({
      key: VitalKeySchema,
      value: z.string().describe("原句實際說出的數值（阿拉伯數字，不帶單位）；意識為短句"),
      qualifier: d(z.string().nullable(), "量測情境：飯前、飯後、未使用氧氣、氧氣 2L、拍痰後、復測…"),
      sourceQuote: d(z.string().nullable(), "逐字稿原句片段，照抄不修正"),
      sourceMs: d(z.number().nullable(), "原句所在行行首的起始毫秒"),
      confidence: z.number().describe("0–1"),
      status: VitalStatusSchema,
      suggestion: d(z.string().nullable(), "只有唯一明顯更正時才給，否則 null"),
      reason: d(z.string().nullable(), "需要護理師確認的原因"),
    }),
  ),
  findings: z.array(
    z.object({
      domain: z.string(),
      text: z.string(),
      sourceQuote: z.string().nullable(),
      sourceMs: z.number().nullable(),
      origin: OriginSchema,
    }),
  ),
  tubes: z.array(
    z.object({
      name: z.string(),
      detail: z.string(),
      changedToday: z.boolean(),
      nextDue: d(z.string().nullable(), "YYYY-MM-DD；來源沒有說就 null"),
    }),
  ),
  wounds: z.array(z.object({ site: z.string(), detail: z.string(), care: z.string().nullable() })),
  interventions: z.array(z.string()),
  changes: z.array(z.object({ kind: ChangeKindSchema, text: z.string(), evidence: z.string().nullable() })),
  planSuggestions: z.array(z.object({ problem: z.string(), basis: z.string() })),
  educationTopics: z.array(z.string()),
  redFlags: z.array(z.string()),
  docFacts: z.array(z.object({ category: z.string(), text: z.string(), page: z.number().nullable(), unclear: z.boolean() })),
  documents: z.array(
    z.object({
      title: z.string(),
      date: d(z.string().nullable(), "YYYY-MM-DD"),
      pages: z.number().nullable(),
      patientHint: d(z.string().nullable(), "只寫年齡、性別或病歷號末 4 碼"),
    }),
  ),
  conflicts: z.array(z.object({ topic: z.string(), text: z.string(), options: z.array(z.string()), evidence: z.string().nullable() })),
  identityConcern: z.string().nullable(),
  missingDomains: z.array(z.string()),
  languageNotes: z.array(z.string()),
});

export type AnalysisOutput = z.infer<typeof AnalysisOutputSchema>;

export const DocOutputSchema = z.object({
  sections: z.array(z.object({ heading: z.string(), body: z.string() })),
});

export type DocOutput = z.infer<typeof DocOutputSchema>;

export const TranslationOutputSchema = z.object({
  translation: z.string().describe("完整譯文，保留原文的分行與編號"),
});
