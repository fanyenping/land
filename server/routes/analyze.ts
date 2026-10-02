import { analyzeVisit } from "../ai/analyze";
import { AnalyzeRequestSchema, DOCUMENT_TYPES } from "../ai/schemas";
import type { AnalyzeRequest } from "../../shared/types";
import { aiRoute } from "./aiRoute";

const BASE64 = /^[A-Za-z0-9+/\s]+={0,2}\s*$/;

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
    const types: readonly string[] = DOCUMENT_TYPES;
    const unsupported = body.documents.find((d) => !types.includes(d.mimeType));
    if (unsupported) {
      return { code: "bad_type", message: `「${unsupported.name}」不是支援的文件格式，請改用 PDF 或照片（JPG、PNG）。`, status: 415 };
    }
    const bad = body.documents.find((d) => !BASE64.test(d.data));
    if (bad) return { code: "bad_document", message: `「${bad.name}」的檔案內容無法讀取，請重新選擇檔案。` };
    return null;
  },
);
