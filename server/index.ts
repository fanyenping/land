import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { analyzeRoute } from "./routes/analyze";
import { generateRoute } from "./routes/generate";
import { transcribeRoute } from "./routes/transcribe";
import { translateRoute } from "./routes/translate";
import { createSttProvider } from "./stt";
import { llmStatus } from "./ai/client";

const app = new Hono();
const stt = createSttProvider();

const tooLarge = (c: Context) =>
  c.json({ error: { code: "too_large", message: "上傳的內容太大，請減少文件頁數或分次上傳。", retryable: false } }, 413);

// 不記錄請求內容（病歷個資），只記方法、路徑、狀態與耗時（F-I1）。
app.use("/api/*", async (c, next) => {
  const started = performance.now();
  await next();
  console.log(`${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - started)}ms`);
});

app.get("/api/health", (c) =>
  c.json({
    ok: true,
    stt: stt.name,
    llm: llmStatus(),
  }),
);

app.post("/api/transcribe", bodyLimit({ maxSize: 300 * 1024 * 1024 }), transcribeRoute(stt));
app.post("/api/analyze", bodyLimit({ maxSize: 40 * 1024 * 1024, onError: tooLarge }), analyzeRoute);
app.post("/api/generate", bodyLimit({ maxSize: 2 * 1024 * 1024, onError: tooLarge }), generateRoute);
app.post("/api/translate", bodyLimit({ maxSize: 256 * 1024, onError: tooLarge }), translateRoute);

// 未預期的錯誤：只記錯誤類型，不記內容（F-I1）；回應一律是有代碼的中文訊息。
app.onError((err, c) => {
  console.error(`${c.req.method} ${c.req.path} failed: ${err.name}`);
  return c.json({ error: { code: "server_error", message: "伺服器發生錯誤，資料仍在這台裝置，請稍後再試。", retryable: true } }, 500);
});

// 未定義的 API 路徑回 JSON 404，不要落到前端頁面。
app.all("/api/*", (c) => c.json({ error: { code: "not_found", message: "找不到這個 API。", retryable: false } }, 404));

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`TaiOne Care API on :${port} — STT=${stt.name}, LLM=${llmStatus().mode}`);
});
