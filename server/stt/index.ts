import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import { hasCredentials } from "../ai/client";
import { AzureFastTranscription } from "./azure";
import { toTraditional } from "./traditional";
import { SttError, type AudioInput, type SttProvider, type Transcript } from "./types";
import { WhisperCompatible } from "./whisper";

export * from "./types";

/** 無金鑰時使用：回傳虛構的示範逐字稿，讓整條流程可完整操作。 */
class DemoStt implements SttProvider {
  readonly name = "demo";

  async transcribe(): Promise<Transcript> {
    await new Promise((r) => setTimeout(r, 900));
    return {
      text: DEMO_SEGMENTS.map((s) => s.text).join(""),
      segments: DEMO_SEGMENTS.map(({ speaker, ...rest }) => ({ ...rest, speaker })),
      durationMs: DEMO_DURATION_MS,
      provider: this.name,
    };
  }
}

export const STT_NOT_CONFIGURED = "尚未設定語音轉文字服務，請聯絡系統管理員。";

/** Claude 已連線但沒有設定 STT：不能拿虛構的示範逐字稿去分析，轉文字一律回 503。 */
class NoStt implements SttProvider {
  readonly name = "none";

  async transcribe(): Promise<Transcript> {
    throw new SttError(STT_NOT_CONFIGURED, false, "stt_not_configured");
  }
}

export const isSttConfigured = (p: SttProvider) => p.name !== "none";

/**
 * 依環境變數選擇 STT：
 * - STT_PROVIDER=azure|whisper：必須有對應的金鑰／網址，缺少時啟動失敗（不要悄悄退回示範）。
 * - 未指定：有 Azure 金鑰用 Azure，有 Whisper 網址用 Whisper。
 * - 都沒有：LLM 也是示範模式時才用示範逐字稿；Claude 已連線時轉文字回「尚未設定」。
 */
export function createSttProvider(env: NodeJS.ProcessEnv = process.env): SttProvider {
  const choice = env.STT_PROVIDER?.trim().toLowerCase();
  const azureEndpoint = env.AZURE_SPEECH_ENDPOINT?.trim();
  const azureKey = env.AZURE_SPEECH_KEY?.trim();
  const whisperUrl = env.WHISPER_BASE_URL?.trim();
  const azure = () => new AzureFastTranscription(azureEndpoint!, azureKey!, env.AZURE_SPEECH_LOCALE?.trim() || "zh-TW");
  const whisper = () => new WhisperCompatible(whisperUrl!, env.WHISPER_API_KEY?.trim() || undefined, env.WHISPER_MODEL?.trim() || undefined);

  if (choice) {
    if (choice === "azure") {
      if (!azureEndpoint || !azureKey) throw new Error("STT_PROVIDER=azure 需要同時設定 AZURE_SPEECH_ENDPOINT 與 AZURE_SPEECH_KEY。");
      return azure();
    }
    if (choice === "whisper") {
      if (!whisperUrl) throw new Error("STT_PROVIDER=whisper 需要設定 WHISPER_BASE_URL。");
      return whisper();
    }
    throw new Error(`STT_PROVIDER「${choice}」無法辨識，請設定為 azure 或 whisper（或不設定）。`);
  }
  if (!!azureEndpoint !== !!azureKey) {
    throw new Error("Azure Speech 設定不完整：AZURE_SPEECH_ENDPOINT 與 AZURE_SPEECH_KEY 必須同時設定。");
  }
  if (azureEndpoint && azureKey) return azure();
  if (whisperUrl) return whisper();
  return hasCredentials(env) ? new NoStt() : new DemoStt();
}

/**
 * 同一次訪視的多段錄音依時間排序逐段轉譯，合併成一份逐字稿（Q04）。
 * 每段的時間軸接續前一段，並統一轉為台灣正體（F-C1）。
 */
export async function transcribeSegments(
  provider: SttProvider,
  parts: AudioInput[],
  signal?: AbortSignal,
): Promise<Transcript> {
  const results: Transcript[] = [];
  for (const part of parts) {
    results.push(await provider.transcribe(part, signal));
    // 示範供應者每次都回傳整份示範稿，只取一次即可。
    if (provider.name === "demo") break;
  }
  // 各段錄音的講者分離是各自獨立的：第 2 段的 S1 不一定是第 1 段的 S1，多段時加上段次前綴（P2-S1）。
  const multi = results.length > 1;
  let offset = 0;
  const merged: Transcript = { text: "", segments: [], durationMs: 0, provider: provider.name };
  results.forEach((t, i) => {
    for (const seg of t.segments) {
      merged.segments.push({
        ...seg,
        speaker: multi && seg.speaker ? `P${i + 1}-${seg.speaker}` : seg.speaker,
        text: toTraditional(seg.text),
        startMs: seg.startMs + offset,
        endMs: seg.endMs + offset,
      });
    }
    merged.text += (merged.text ? "\n" : "") + toTraditional(t.text);
    offset += t.durationMs;
  });
  merged.durationMs = offset;
  return merged;
}
