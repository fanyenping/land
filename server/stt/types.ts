import type { Transcript, TranscriptSegment } from "../../shared/types";

export type { Transcript, TranscriptSegment };

export interface AudioInput {
  data: Uint8Array<ArrayBuffer>;
  mimeType: string;
  filename: string;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: AudioInput, signal?: AbortSignal): Promise<Transcript>;
}

export type SttErrorCode = "stt_failed" | "stt_not_configured";

export class SttError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly code: SttErrorCode = "stt_failed",
  ) {
    super(message);
    this.name = "SttError";
  }
}
