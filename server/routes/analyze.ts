import { analyzeVisit } from "../ai/analyze";
import { AnalyzeRequestSchema, DOCUMENT_TYPES, type DocumentType } from "../ai/schemas";
import type { AnalyzeRequest, UploadedDocument } from "../../shared/types";
import { aiRoute } from "./aiRoute";

/** Claude API 單張影像上限（base64 解碼後 5 MB）。 */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPE_LABEL: Record<DocumentType, string> = {
  "application/pdf": "PDF",
  "image/jpeg": "JPG",
  "image/png": "PNG",
  "image/webp": "WebP",
  "image/gif": "GIF",
};

const ascii = (bytes: Uint8Array, from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));

/** 檔頭（magic bytes）是否符合宣告的格式。 */
const MAGIC: Record<DocumentType, (b: Uint8Array) => boolean> = {
  "application/pdf": (b) => ascii(b, 0, 5) === "%PDF-",
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  "image/png": (b) => b[0] === 0x89 && ascii(b, 1, 4) === "PNG",
  "image/webp": (b) => ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 12) === "WEBP",
  "image/gif": (b) => ascii(b, 0, 4) === "GIF8",
};

const isDocumentType = (t: string): t is DocumentType => (DOCUMENT_TYPES as readonly string[]).includes(t);

type Problem = { code: string; message: string; status?: 400 | 415 };

/**
 * 逐份檢查文件：格式、base64、檔頭與宣告格式一致、影像大小。
 * base64 檢查是線性時間（先去空白再用沒有回溯風險的正規式），長度已由 zod 限制。
 */
export function checkDocument(d: UploadedDocument): Problem | null {
  if (!isDocumentType(d.mimeType)) {
    return {
      code: "bad_type",
      message: `「${d.name}」不是支援的文件格式，請改用 PDF 或照片（JPG、PNG、WebP、GIF）。`,
      status: 415,
    };
  }
  const s = d.data.replace(/\s+/g, "");
  if (s.length === 0 || s.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) {
    return { code: "bad_document", message: `「${d.name}」的檔案內容無法讀取，請重新選擇檔案。` };
  }
  const head = new Uint8Array(Buffer.from(s.slice(0, 16), "base64"));
  if (!MAGIC[d.mimeType](head)) {
    return {
      code: "bad_document",
      message: `「${d.name}」的內容不是 ${TYPE_LABEL[d.mimeType]} 檔（檔案可能損毀或格式標示錯誤），請重新選擇檔案。`,
    };
  }
  const bytes = (s.length / 4) * 3 - (s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0);
  if (d.mimeType !== "application/pdf" && bytes > MAX_IMAGE_BYTES) {
    const mb = (bytes / 1024 / 1024).toFixed(1);
    return {
      code: "bad_document",
      message: `「${d.name}」有 ${mb} MB，超過照片上限 5 MB，請縮小照片或降低解析度後再上傳。`,
    };
  }
  return null;
}

/** POST /api/analyze — 逐字稿＋文件＋手動值 → Analysis（JSON）。 */
export const analyzeRoute = aiRoute(
  AnalyzeRequestSchema,
  (body, signal) => analyzeVisit(body satisfies AnalyzeRequest, signal),
  (body) => {
    const typed = Object.values(body.typedVitals).some((v) => v?.trim());
    const hasTranscript = !!body.transcript && (body.transcript.segments.length > 0 || body.transcript.text.trim().length > 0);
    if (!hasTranscript && body.documents.length === 0 && !body.notes?.trim() && !typed) {
      return { code: "empty_input", message: "沒有可以整理的內容：請錄音、匯入文件，或輸入補充。" };
    }
    for (const d of body.documents) {
      const problem = checkDocument(d);
      if (problem) return problem;
    }
    return null;
  },
);
