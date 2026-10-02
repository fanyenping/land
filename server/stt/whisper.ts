import { SttError, type AudioInput, type SttProvider, type Transcript } from "./types";

/**
 * 任何相容 `/v1/audio/transcriptions` 的 Whisper 服務（自架 faster-whisper、whisper.cpp server、
 * 雲端代管等）。以 prompt 提示繁體與居護常用詞，降低同音錯字與簡體輸出。
 */
const DOMAIN_PROMPT =
  "以下是台灣居家護理訪視的對話，使用繁體中文。常見詞：體溫、脈搏、呼吸、血壓、血氧、血糖、" +
  "鼻胃管、導尿管、氣切、胃造口、壓傷、翻身、灌食、抽痰、便秘、居服員、外籍看護。";

interface WhisperVerbose {
  text: string;
  duration?: number;
  segments?: { start: number; end: number; text: string; avg_logprob?: number }[];
}

export class WhisperCompatible implements SttProvider {
  readonly name = "whisper";

  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly model = "whisper-1",
  ) {}

  async transcribe(audio: AudioInput, signal?: AbortSignal): Promise<Transcript> {
    const form = new FormData();
    form.append("file", new Blob([audio.data], { type: audio.mimeType }), audio.filename);
    form.append("model", this.model);
    form.append("language", "zh");
    form.append("response_format", "verbose_json");
    form.append("prompt", DOMAIN_PROMPT);

    const res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/audio/transcriptions`, {
      method: "POST",
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
      body: form,
      signal,
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new SttError(`轉譯服務回應 ${res.status}`, retryable);
    }

    const body = (await res.json()) as WhisperVerbose;
    const segments = (body.segments ?? []).map((s) => ({
      startMs: Math.round(s.start * 1000),
      endMs: Math.round(s.end * 1000),
      text: s.text.trim(),
      confidence: s.avg_logprob !== undefined ? Math.max(0, Math.min(1, Math.exp(s.avg_logprob))) : undefined,
    }));
    return {
      text: body.text,
      segments,
      durationMs: Math.round((body.duration ?? (segments.at(-1)?.endMs ?? 0) / 1000) * 1000),
      provider: this.name,
    };
  }
}
