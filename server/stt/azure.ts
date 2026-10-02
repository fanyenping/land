import { SttError, type AudioInput, type SttProvider, type Transcript } from "./types";

/**
 * Azure AI Speech「Fast Transcription」— 與現行 TaiOne-Care-API 相同的引擎（zh-TW）。
 * REST: POST {endpoint}/speechtotext/transcriptions:transcribe?api-version=2024-11-15
 */
interface AzurePhrase {
  offsetMilliseconds: number;
  durationMilliseconds: number;
  text: string;
  speaker?: number;
  confidence?: number;
}

interface AzureResponse {
  durationMilliseconds?: number;
  combinedPhrases?: { text: string }[];
  phrases?: AzurePhrase[];
}

export class AzureFastTranscription implements SttProvider {
  readonly name = "azure-speech";

  constructor(
    private readonly endpoint: string,
    private readonly key: string,
    private readonly locale = "zh-TW",
  ) {}

  async transcribe(audio: AudioInput, signal?: AbortSignal): Promise<Transcript> {
    const form = new FormData();
    form.append("audio", new Blob([audio.data], { type: audio.mimeType }), audio.filename);
    form.append(
      "definition",
      JSON.stringify({
        locales: [this.locale],
        diarization: { enabled: true, maxSpeakers: 4 },
        profanityFilterMode: "None",
      }),
    );

    const url = `${this.endpoint.replace(/\/$/, "")}/speechtotext/transcriptions:transcribe?api-version=2024-11-15`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Ocp-Apim-Subscription-Key": this.key },
      body: form,
      signal,
    });

    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new SttError(`Azure Speech 回應 ${res.status}`, retryable);
    }

    const body = (await res.json()) as AzureResponse;
    const phrases = body.phrases ?? [];
    return {
      text: body.combinedPhrases?.map((p) => p.text).join("\n") ?? phrases.map((p) => p.text).join(""),
      segments: phrases.map((p) => ({
        startMs: p.offsetMilliseconds,
        endMs: p.offsetMilliseconds + p.durationMilliseconds,
        text: p.text,
        speaker: p.speaker !== undefined ? `S${p.speaker}` : undefined,
        confidence: p.confidence,
      })),
      durationMs: body.durationMilliseconds ?? phrases.at(-1)?.offsetMilliseconds ?? 0,
      provider: this.name,
    };
  }
}
