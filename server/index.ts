import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { analyzeRoute } from "./routes/analyze";
import { transcribeRoute } from "./routes/transcribe";
import { createSttProvider } from "./stt";
import { llmStatus } from "./ai/client";

const app = new Hono();
const stt = createSttProvider();

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
app.post("/api/analyze", bodyLimit({ maxSize: 40 * 1024 * 1024 }), analyzeRoute);

if (process.env.NODE_ENV === "production") {
  app.use("/*", serveStatic({ root: "./dist" }));
  app.get("*", serveStatic({ path: "./dist/index.html" }));
}

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`TaiOne Care API on :${port} — STT=${stt.name}, LLM=${llmStatus().mode}`);
});
