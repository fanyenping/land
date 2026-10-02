export interface TranscriptSegment {
  /** Offset from the start of the whole visit recording, in ms. */
  startMs: number;
  endMs: number;
  text: string;
  /** Diarized speaker label when the provider supports it (e.g. "S1"). */
  speaker?: string;
  /** 0–1 recognition confidence when the provider reports one. */
  confidence?: number;
}

export interface Transcript {
  text: string;
  segments: TranscriptSegment[];
  durationMs: number;
  provider: string;
}

export interface AudioInput {
  data: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface SttProvider {
  readonly name: string;
  transcribe(audio: AudioInput, signal?: AbortSignal): Promise<Transcript>;
}

export class SttError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SttError";
  }
}
