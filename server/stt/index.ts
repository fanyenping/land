import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import { AzureFastTranscription } from "./azure";
import { toTraditional } from "./traditional";
import type { AudioInput, SttProvider, Transcript } from "./types";
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

export function createSttProvider(env: NodeJS.ProcessEnv = process.env): SttProvider {
  const choice = env.STT_PROVIDER?.toLowerCase();
  if ((choice === "azure" || !choice) && env.AZURE_SPEECH_ENDPOINT && env.AZURE_SPEECH_KEY) {
    return new AzureFastTranscription(env.AZURE_SPEECH_ENDPOINT, env.AZURE_SPEECH_KEY, env.AZURE_SPEECH_LOCALE ?? "zh-TW");
  }
  if ((choice === "whisper" || !choice) && env.WHISPER_BASE_URL) {
    return new WhisperCompatible(env.WHISPER_BASE_URL, env.WHISPER_API_KEY, env.WHISPER_MODEL);
  }
  return new DemoStt();
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
  let offset = 0;
  const merged: Transcript = { text: "", segments: [], durationMs: 0, provider: provider.name };
  for (const part of parts) {
    const t = await provider.transcribe(part, signal);
    for (const seg of t.segments) {
      merged.segments.push({
        ...seg,
        text: toTraditional(seg.text),
        startMs: seg.startMs + offset,
        endMs: seg.endMs + offset,
      });
    }
    merged.text += (merged.text ? "\n" : "") + toTraditional(t.text);
    offset += t.durationMs;
    // 示範供應者每次都回傳整份示範稿，只取一次即可。
    if (provider.name === "demo") break;
  }
  merged.durationMs = offset;
  return merged;
}
