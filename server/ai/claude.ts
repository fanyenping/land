/**
 * 呼叫 Claude 取得結構化輸出（規格 §7.13）：串流 → finalMessage、拒答備援、
 * 先檢查 stop_reason 再以 zod 驗證；錯誤一律轉成有代碼、有中文說明的 AiError。
 */
import Anthropic from "@anthropic-ai/sdk";
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaTextBlock,
  BetaTextBlockParam,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as z from "zod/v4";
import { MODEL, getClient } from "./client";

export type AiErrorCode =
  | "ai_refused"
  | "ai_bad_output"
  | "ai_busy"
  | "ai_unreachable"
  | "ai_timeout"
  | "ai_bad_request"
  | "ai_too_large"
  | "ai_auth"
  | "ai_config"
  | "ai_cancelled"
  | "ai_failed";

export class AiError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message: string,
    readonly retryable: boolean,
    readonly status: ContentfulStatusCode,
  ) {
    super(message);
    this.name = "AiError";
  }
}

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const FAST_BETA = "fast-mode-2026-02-01";

export type Effort = "low" | "medium" | "high";

export interface StructuredCall<T> {
  /** 固定規則放前面（加快取），每種文件不同的部分放後面。 */
  system: string[];
  content: BetaContentBlockParam[];
  schema: z.ZodType<T>;
  effort: Effort;
  maxTokens?: number;
  signal?: AbortSignal;
}

/**
 * zod → JSON Schema（structured outputs 子集）：保留 enum 與說明，物件一律
 * `additionalProperties: false` 且所有欄位必填。不用 SDK 的 betaZodOutputFormat，
 * 因為它會把 enum 移進說明文字，API 就不再強制列舉值。
 */
export function outputSchema(schema: z.ZodType): Record<string, unknown> {
  const strict = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(strict);
    if (!node || typeof node !== "object") return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node)) if (k !== "$schema") out[k] = strict(v);
    if (out.type === "object") {
      out.additionalProperties = false;
      out.required = Object.keys((out.properties as Record<string, unknown>) ?? {});
    }
    return out;
  };
  return strict(z.toJSONSchema(schema, { reused: "inline", unrepresentable: "throw" })) as Record<string, unknown>;
}

const fallbacksOn = () => process.env.CLAUDE_FALLBACKS !== "off";
const fastOn = () => process.env.CLAUDE_FAST === "1";

/** 備援模型接手時，只取最後一個 fallback 區塊之後的文字。 */
function finalText(message: BetaMessage): string {
  const types = message.content.map((b) => b.type as string);
  const start = types.lastIndexOf("fallback") + 1;
  return message.content
    .slice(start)
    .filter((b): b is BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

async function send(call: StructuredCall<unknown>, fast: boolean): Promise<BetaMessage> {
  const system: BetaTextBlockParam[] = call.system.map((text, i) =>
    i === 0 && call.system.length > 1 ? { type: "text", text, cache_control: { type: "ephemeral" } } : { type: "text", text },
  );
  const betas = [...(fallbacksOn() ? [FALLBACK_BETA] : []), ...(fast ? [FAST_BETA] : [])];
  const stream = getClient().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: call.maxTokens ?? 32_000,
      system,
      messages: [{ role: "user", content: call.content }],
      output_config: { effort: call.effort, format: { type: "json_schema", schema: outputSchema(call.schema) } },
      ...(betas.length ? { betas } : {}),
      ...(fallbacksOn() ? { fallbacks: "default" as const } : {}),
      ...(fast ? { speed: "fast" as const } : {}),
    },
    { signal: call.signal },
  );
  return stream.finalMessage();
}

/** 送出請求並回傳經 zod 驗證的結果與實際服務的模型。 */
export async function callStructured<T>(call: StructuredCall<T>): Promise<{ data: T; model: string }> {
  let message: BetaMessage;
  try {
    try {
      message = await send(call, fastOn());
    } catch (err) {
      // fast mode 有獨立限流：429 時退回標準速度再試一次
      if (fastOn() && err instanceof Anthropic.RateLimitError) message = await send(call, false);
      else throw err;
    }
  } catch (err) {
    throw toAiError(err) ?? err;
  }

  if (message.stop_reason === "refusal") {
    throw new AiError("ai_refused", "AI 服務婉拒處理這次的內容。請改為手動撰寫，或調整內容後再試。", false, 422);
  }
  if (message.stop_reason === "max_tokens") {
    throw new AiError("ai_bad_output", "AI 回覆不完整（內容過長被截斷），請重試。", true, 502);
  }
  let json: unknown;
  try {
    json = JSON.parse(finalText(message));
  } catch {
    throw new AiError("ai_bad_output", "AI 回覆的格式不完整，請重試。", true, 502);
  }
  const parsed = call.schema.safeParse(json);
  if (!parsed.success) throw new AiError("ai_bad_output", "AI 回覆的格式不符合預期，請重試。", true, 502);
  return { data: parsed.data, model: message.model };
}

/** SDK 錯誤 → AiError（由具體到一般）；不是 AI 呼叫的錯誤回傳 null。 */
export function toAiError(err: unknown): AiError | null {
  if (err instanceof AiError) return err;
  if (err instanceof Anthropic.APIUserAbortError) return new AiError("ai_cancelled", "請求已取消。", true, 503);
  if (err instanceof Anthropic.APIConnectionTimeoutError) {
    return new AiError("ai_timeout", "AI 服務回應逾時（已自動重試 2 次），請稍後再試。", true, 504);
  }
  if (err instanceof Anthropic.APIConnectionError) {
    return new AiError("ai_unreachable", "伺服器連不上 AI 服務（已自動重試 2 次），請稍後再試。", true, 503);
  }
  if (err instanceof Anthropic.RateLimitError) {
    return new AiError("ai_busy", "AI 服務忙碌（已自動重試 2 次），請稍後再試。", true, 503);
  }
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new AiError("ai_auth", "AI 服務金鑰無效或沒有權限，請聯絡系統管理員。", false, 503);
  }
  if (err instanceof Anthropic.NotFoundError) {
    return new AiError("ai_config", "AI 模型設定有誤（找不到模型），請聯絡系統管理員。", false, 503);
  }
  if (err instanceof Anthropic.BadRequestError) {
    return new AiError("ai_bad_request", "AI 服務無法處理這次的內容（文件可能損毀、加密或格式不支援），請檢查後再試。", false, 422);
  }
  if (err instanceof Anthropic.APIError) {
    if (err.status === 413) {
      return new AiError("ai_too_large", "內容太大，AI 服務無法處理；請減少文件頁數後再試。", false, 413);
    }
    if ((err.status !== undefined && err.status >= 500) || err.type === "overloaded_error" || err.type === "api_error") {
      return new AiError("ai_busy", "AI 服務暫時無法使用（已自動重試 2 次），請稍後再試。", true, 503);
    }
    return new AiError("ai_failed", "AI 服務發生錯誤，請稍後再試。", true, 502);
  }
  if (err instanceof Anthropic.AnthropicError) {
    return new AiError("ai_bad_output", "AI 回覆中斷或格式不完整，請重試。", true, 502);
  }
  return null;
}
