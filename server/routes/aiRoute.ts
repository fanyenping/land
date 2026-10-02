import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import * as z from "zod/v4";
import { toAiError } from "../ai/claude";

type Check<T> = (body: T) => { code: string; message: string; status?: ContentfulStatusCode } | null;

/** 只描述哪個欄位不符，不回傳內容（避免個資出現在錯誤訊息或日誌）。 */
function describe(error: z.ZodError): string {
  const issue = error.issues[0];
  const path = issue?.path.join(".") || "（根）";
  return `欄位「${path}」格式不符`;
}

/**
 * JSON 請求 → zod 驗證 → 執行；AI 錯誤轉成 {error:{code,message,retryable}}。
 * 錯誤訊息一律是給護理師看的中文。
 */
export function aiRoute<S extends z.ZodType, R>(schema: S, run: (body: z.infer<S>, signal: AbortSignal) => Promise<R>, check?: Check<z.infer<S>>) {
  return async (c: Context) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: { code: "bad_json", message: "請求內容不是有效的 JSON。", retryable: false } }, 400);
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: { code: "bad_request", message: `請求格式不正確：${describe(parsed.error)}。`, retryable: false } }, 400);
    }
    const problem = check?.(parsed.data);
    if (problem) return c.json({ error: { code: problem.code, message: problem.message, retryable: false } }, problem.status ?? 400);
    try {
      return c.json(await run(parsed.data, c.req.raw.signal));
    } catch (err) {
      const e = toAiError(err);
      if (!e) throw err;
      return c.json({ error: { code: e.code, message: e.message, retryable: e.retryable } }, e.status);
    }
  };
}
