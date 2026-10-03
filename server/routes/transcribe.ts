import type { Context } from "hono";
import { demoPlanTranscript } from "../../shared/demoTranscript";
import { STT_NOT_CONFIGURED, SttError, isSttConfigured, transcribeSegments, type AudioInput, type SttProvider } from "../stt";

const AUDIO_TYPES = /^(audio\/|video\/webm|video\/mp4|application\/octet-stream)/;

/**
 * POST /api/transcribe — multipart，欄位 `audio` 可重複（多段錄音，依上傳順序合併）。
 */
export function transcribeRoute(stt: SttProvider) {
  return async (c: Context) => {
    // 沒有設定 STT 時不必先收完整個音檔
    if (!isSttConfigured(stt)) {
      return c.json({ error: { code: "stt_not_configured", message: STT_NOT_CONFIGURED, retryable: false } }, 503);
    }
    let form: FormData;
    try {
      form = await c.req.formData();
    } catch {
      return c.json({ error: { code: "bad_form", message: "錄音上傳的格式不正確，請重新上傳。", retryable: false } }, 400);
    }
    const files = form.getAll("audio").filter((v): v is File => v instanceof File);
    if (files.length === 0) {
      return c.json({ error: { code: "no_audio", message: "沒有收到音檔，請重新選擇或錄音。", retryable: false } }, 400);
    }
    if (files.length > 10) {
      return c.json({ error: { code: "too_many", message: "一次最多合併 10 段錄音。", retryable: false } }, 400);
    }
    const bad = files.find((f) => f.type && !AUDIO_TYPES.test(f.type));
    if (bad) {
      return c.json({ error: { code: "bad_type", message: `「${bad.name}」不是可辨識的音檔格式。`, retryable: false } }, 415);
    }
    // 護理計畫口述（purpose=plan）：示範 STT 回示範口述；真正的 STT 不看 purpose
    if (form.get("purpose") === "plan" && stt.name === "demo") return c.json({ transcript: demoPlanTranscript() });

    const parts: AudioInput[] = await Promise.all(
      files.map(async (f) => ({
        data: new Uint8Array(await f.arrayBuffer()),
        mimeType: f.type || "application/octet-stream",
        filename: f.name || "recording.webm",
      })),
    );

    try {
      const transcript = await transcribeSegments(stt, parts, c.req.raw.signal);
      return c.json({ transcript });
    } catch (err) {
      if (err instanceof SttError) {
        if (err.code === "stt_not_configured") {
          return c.json({ error: { code: err.code, message: err.message, retryable: false } }, 503);
        }
        return c.json(
          { error: { code: "stt_failed", message: `語音轉文字失敗：${err.message}`, retryable: err.retryable } },
          502,
        );
      }
      throw err;
    }
  };
}
