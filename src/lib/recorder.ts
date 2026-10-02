import { db, putBlob, updateVisit } from "./db";
import { newId, type AudioPart } from "./model";

export type RecState = "idle" | "starting" | "recording" | "paused" | "error";

export interface RecSnapshot {
  state: RecState;
  visitId: string | null;
  /** 本段已錄時間（不含暫停）。 */
  elapsedMs: number;
  /** 0–1 音量。 */
  level: number;
  error: string | null;
}

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac"];

function pickMime(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "";
}

class Recorder {
  private snap: RecSnapshot = { state: "idle", visitId: null, elapsedMs: 0, level: 0, error: null };
  private listeners = new Set<() => void>();
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private raf = 0;
  private partId = "";
  private seq = 0;
  private startedAt = "";
  private runStart = 0;
  private accumulated = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private stopping: Promise<AudioPart | null> | null = null;
  private resolveStop: ((p: AudioPart | null) => void) | null = null;
  private expectedStop = false;
  private tick = 0;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<RecSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  get supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  async start(visitId: string): Promise<boolean> {
    if (this.snap.state === "recording" || this.snap.state === "paused") {
      if (this.snap.visitId === visitId) return true;
      await this.stop();
    }
    if (!this.supported) {
      this.set({ state: "error", error: "這個瀏覽器不支援錄音，請改用「選錄音檔」。", visitId });
      return false;
    }
    this.set({ state: "starting", visitId, elapsedMs: 0, level: 0, error: null });
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
    } catch (err) {
      const name = (err as DOMException).name;
      const msg =
        name === "NotAllowedError"
          ? "沒有麥克風權限。請在瀏覽器或系統設定允許「麥克風」後再試一次。"
          : name === "NotFoundError"
            ? "找不到麥克風。可以改用「選錄音檔」匯入。"
            : "麥克風無法啟動，請關閉其他正在錄音的 App 後再試。";
      this.set({ state: "error", error: msg });
      return false;
    }

    const mimeType = pickMime();
    this.media = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : undefined);
    this.partId = newId();
    this.seq = 0;
    this.startedAt = new Date().toISOString();
    this.accumulated = 0;
    this.runStart = performance.now();
    this.expectedStop = false;

    this.media.ondataavailable = (e) => {
      if (e.data.size > 0) void db.chunks.add({ partId: this.partId, seq: this.seq++, blob: e.data });
    };
    this.media.onstop = () => void this.finalize();
    this.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (!this.expectedStop) void this.stop(true);
    });
    this.media.start(1000);

    this.setupMeter();
    await this.lockScreen();
    await updateVisit(visitId, (v) => ({ status: "recording", recordingStartedAt: v.recordingStartedAt ?? this.startedAt }));
    this.set({ state: "recording" });
    return true;
  }

  pause() {
    if (this.media?.state !== "recording") return;
    this.media.pause();
    this.accumulated += performance.now() - this.runStart;
    this.set({ state: "paused", elapsedMs: this.accumulated, level: 0 });
    if (this.snap.visitId) void updateVisit(this.snap.visitId, { status: "paused" });
  }

  resume() {
    if (this.media?.state !== "paused") return;
    this.media.resume();
    this.runStart = performance.now();
    this.set({ state: "recording" });
    if (this.snap.visitId) void updateVisit(this.snap.visitId, { status: "recording" });
  }

  /** 結束本段並存成一個錄音段；interrupted=true 表示被系統中斷。 */
  stop(interrupted = false): Promise<AudioPart | null> {
    if (this.stopping) return this.stopping;
    if (!this.media || this.media.state === "inactive") return Promise.resolve(null);
    this.expectedStop = !interrupted;
    if (this.media.state === "recording") this.accumulated += performance.now() - this.runStart;
    this.stopping = new Promise((resolve) => {
      this.resolveStop = resolve;
    });
    this.media.stop();
    return this.stopping;
  }

  private async finalize() {
    const visitId = this.snap.visitId;
    const interrupted = !this.expectedStop;
    const mimeType = this.media?.mimeType || pickMime() || "audio/webm";
    this.teardown();
    let part: AudioPart | null = null;
    if (visitId) {
      part = await assemblePart(this.partId, visitId, mimeType, this.accumulated, this.startedAt, null);
      if (part) {
        const saved = part;
        await updateVisit(visitId, (v) => ({
          parts: [...v.parts, saved],
          recordingEndedAt: new Date().toISOString(),
          status: interrupted ? "interrupted" : v.status,
        }));
      }
    }
    this.set({ state: "idle", level: 0, elapsedMs: 0 });
    this.resolveStop?.(part);
    this.resolveStop = null;
    this.stopping = null;
  }

  private setupMeter() {
    if (!this.stream) return;
    try {
      this.ctx = new AudioContext();
      const src = this.ctx.createMediaStreamSource(this.stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const data = new Uint8Array(this.analyser.fftSize);
      const loop = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        const rms = Math.sqrt(sum / data.length);
        const elapsed = this.snap.state === "recording" ? this.accumulated + performance.now() - this.runStart : this.accumulated;
        // 約每 100ms 更新一次畫面，避免過度重繪。
        if (++this.tick % 6 === 0) this.set({ level: Math.min(1, rms * 4), elapsedMs: elapsed });
        this.raf = requestAnimationFrame(loop);
      };
      this.raf = requestAnimationFrame(loop);
    } catch {
      // 沒有音量表不影響錄音。
    }
  }

  private async lockScreen() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      this.wakeLock = null;
    }
  }

  /** 從背景回到前景時重新取得螢幕常亮。 */
  async relock() {
    if (this.snap.state === "recording" && (!this.wakeLock || this.wakeLock.released)) await this.lockScreen();
  }

  private teardown() {
    cancelAnimationFrame(this.raf);
    this.analyser = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.media = null;
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
  }
}

async function assemblePart(
  partId: string,
  visitId: string,
  mimeType: string,
  durationMs: number,
  startedAt: string,
  fileName: string | null,
): Promise<AudioPart | null> {
  const chunks = await db.chunks.where("partId").equals(partId).sortBy("seq");
  if (chunks.length === 0) return null;
  const blob = new Blob(chunks.map((c) => c.blob), { type: mimeType });
  const blobKey = await putBlob(blob, { visitId });
  await db.chunks.where("partId").equals(partId).delete();
  return { id: partId, blobKey, mimeType, durationMs: Math.round(durationMs), startedAt, fileName };
}

export const recorder = new Recorder();

/**
 * App 被關掉或當機時，錄音中的片段仍在本機：重新開啟時組回錄音段，
 * 並把訪視標為「中斷」，讓護理師選擇繼續錄或完成訪視。
 */
export async function recoverOrphanChunks() {
  const live = await db.visits.where("status").anyOf("recording", "paused").toArray();
  const chunkParts = new Set((await db.chunks.toArray()).map((c) => c.partId));
  for (const v of live) {
    if (recorder.getSnapshot().visitId === v.id) continue;
    await updateVisit(v.id, { status: "interrupted" });
  }
  if (chunkParts.size === 0 || live.length === 0) return;
  const target = live[0];
  for (const partId of chunkParts) {
    const part = await assemblePart(partId, target.id, "audio/webm", 0, new Date().toISOString(), null);
    if (part) await updateVisit(target.id, (v) => ({ parts: [...v.parts, part] }));
  }
}

export async function audioDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const a = new Audio();
    a.preload = "metadata";
    a.src = url;
    const done = (ms: number) => {
      URL.revokeObjectURL(url);
      resolve(ms);
    };
    a.onloadedmetadata = () => done(Number.isFinite(a.duration) ? a.duration * 1000 : 0);
    a.onerror = () => done(0);
    setTimeout(() => done(0), 4000);
  });
}
