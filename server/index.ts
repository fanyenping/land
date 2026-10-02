import { serve } from "@hono/node-server";
import { llmStatus } from "./ai/client";
import { createApp } from "./app";

// 設定有誤（例如 STT_PROVIDER 指定了卻缺金鑰、ACCESS_CODE 含中文）時直接啟動失敗，不要悄悄退回示範。
const { app, stt, auth } = createApp({ staticRoot: process.env.NODE_ENV === "production" ? "./dist" : undefined });

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, () => {
  console.log(`TaiOne Care API on :${port} — STT=${stt.name}, LLM=${llmStatus().mode}, 通行碼=${auth ? "已啟用" : "未設定"}`);
  if (stt.name === "none") console.warn("尚未設定語音轉文字（AZURE_SPEECH_* 或 WHISPER_BASE_URL）：/api/transcribe 會回 503。");
});
