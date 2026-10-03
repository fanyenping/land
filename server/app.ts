import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { HealthResponse } from "../shared/types";
import { llmStatus } from "./ai/client";
import { analyzeRoute } from "./routes/analyze";
import { generateRoute } from "./routes/generate";
import { polishPlanRoute } from "./routes/polishPlan";
import { transcribeRoute } from "./routes/transcribe";
import { translateRoute } from "./routes/translate";
import {
  RateLimiter,
  clientIp,
  rateLimit,
  readAccessCode,
  readPositiveInt,
  readTrustProxy,
  rejectCrossSite,
  requireAccessCode,
  requireJson,
} from "./security";
import { createSttProvider, type SttProvider } from "./stt";

export interface AppOptions {
  env?: NodeJS.ProcessEnv;
  /** 測試用：直接指定 STT（預設依環境變數選擇）。 */
  stt?: SttProvider;
  /** 測試用：限流的時鐘。 */
  now?: () => number;
  /** 正式環境：伺服前端靜態檔的目錄（一定排在 API 之後）。 */
  staticRoot?: string;
}

const MINUTE = 60_000;

type ErrorBody = { error: { code: string; message: string; retryable: boolean } };
const errorBody = (code: string, message: string, retryable: boolean): ErrorBody => ({ error: { code, message, retryable } });

const tooLarge = (message: string) => (c: Context) => c.json(errorBody("too_large", message, false), 413);

/** HTTPException（例如框架丟出的 413）→ 有代碼的 JSON；不要變成 500 可重試。 */
function httpExceptionBody(err: HTTPException): { status: ContentfulStatusCode; body: ErrorBody } {
  const status = err.status as ContentfulStatusCode;
  switch (status) {
    case 400:
      return { status, body: errorBody("bad_request", "請求格式不正確。", false) };
    case 401:
      return { status, body: errorBody("unauthorized", "機構通行碼不正確，請到設定重新輸入。", false) };
    case 413:
      return { status, body: errorBody("too_large", "上傳的內容太大，請減少內容或分次上傳。", false) };
    case 415:
      return { status, body: errorBody("bad_content_type", "不支援的內容格式。", false) };
    default:
      return status >= 500
        ? { status, body: errorBody("server_error", "伺服器發生錯誤，資料仍在這台裝置，請稍後再試。", true) }
        : { status, body: errorBody("bad_request", "請求無法處理。", false) };
  }
}

export function createApp(opts: AppOptions = {}) {
  const env = opts.env ?? process.env;
  const stt = opts.stt ?? createSttProvider(env);
  const accessCode = readAccessCode(env);
  const ip = clientIp(readTrustProxy(env));
  const now = opts.now ?? Date.now;
  const aiLimiter = new RateLimiter(readPositiveInt(env, "RATE_LIMIT_AI_PER_MIN", 30), MINUTE, now);
  const sttLimiter = new RateLimiter(readPositiveInt(env, "RATE_LIMIT_TRANSCRIBE_PER_MIN", 20), MINUTE, now);
  const authLimiter = new RateLimiter(10, MINUTE, now);

  const app = new Hono();

  // 不記錄請求內容（病歷個資），只記方法、路徑、狀態與耗時（F-I1）。
  app.use("/api/*", async (c, next) => {
    const started = performance.now();
    await next();
    console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - started)}ms`);
  });
  app.use("/api/*", rejectCrossSite);
  app.use("/api/*", requireAccessCode(accessCode, authLimiter, ip));

  app.get("/api/health", (c) =>
    c.json({
      ok: true,
      stt: stt.name,
      llm: llmStatus(),
      auth: accessCode !== null,
    } satisfies HealthResponse),
  );

  const ai = rateLimit(aiLimiter, "ai", ip);
  app.post(
    "/api/transcribe",
    rateLimit(sttLimiter, "stt", ip),
    bodyLimit({ maxSize: 300 * 1024 * 1024, onError: tooLarge("錄音檔太大（上限 300 MB），請分段錄音或分次上傳。") }),
    transcribeRoute(stt),
  );
  const docsTooLarge = tooLarge("上傳的內容太大，請減少文件頁數或分次上傳。");
  app.post("/api/analyze", requireJson, ai, bodyLimit({ maxSize: 40 * 1024 * 1024, onError: docsTooLarge }), analyzeRoute);
  app.post("/api/generate", requireJson, ai, bodyLimit({ maxSize: 2 * 1024 * 1024, onError: docsTooLarge }), generateRoute);
  // 護理計畫口述整理：只收口述文字（與撰寫共用 AI 限流額度）
  app.post("/api/polish-plan", requireJson, ai, bodyLimit({ maxSize: 64 * 1024, onError: tooLarge("口述內容太長，請分段整理。") }), polishPlanRoute);
  app.post(
    "/api/translate",
    requireJson,
    ai,
    bodyLimit({ maxSize: 256 * 1024, onError: tooLarge("要翻譯的內容太長，請分段翻譯。") }),
    translateRoute,
  );

  // 未預期的錯誤：只記錯誤類型，不記內容（F-I1）；回應一律是有代碼的中文訊息。
  app.onError((err, c) => {
    if (err instanceof HTTPException) {
      const { status, body } = httpExceptionBody(err);
      return c.json(body, status);
    }
    console.error(`${c.req.method} ${c.req.path} failed: ${err.name}`);
    return c.json(errorBody("server_error", "伺服器發生錯誤，資料仍在這台裝置，請稍後再試。", true), 500);
  });

  // 未定義的 API 路徑回 JSON 404，不要落到前端頁面（必須排在靜態檔之前）。
  app.all("/api/*", (c) => c.json(errorBody("not_found", "找不到這個 API。", false), 404));

  if (opts.staticRoot) {
    app.use("/*", serveStatic({ root: opts.staticRoot }));
    app.get("*", serveStatic({ path: `${opts.staticRoot.replace(/\/$/, "")}/index.html` }));
  }

  return { app, stt, auth: accessCode !== null };
}
