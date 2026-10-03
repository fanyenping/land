import { TRIAL } from "./env";
import { pickMime, recorder } from "./recorder";

/**
 * 口述護理計畫的錄音器：錄音只留在記憶體，不寫 db.chunks，也不碰訪視的錄音段、逐字稿與整理資料。
 * 與訪視錄音（recorder）不會同時進行。模組載入時不碰 navigator／window（Node 測試可匯入）。
 */

export type DictState = "idle" | "starting" | "recording" | "error";

export interface DictSnapshot {
  state: DictState;
  visitId: string | null;
  elapsedMs: number;
  /** 0–1 音量。 */
  level: number;
  error: string | null;
  /** 剩 1 分鐘內。 */
  nearLimit: boolean;
}

export interface DictResult {
  blob: Blob;
  mimeType: string;
  durationMs: number;
}

/** App 內口述上限 8 分鐘；更長的請用 iPhone 語音備忘錄錄好再選檔。 */
export const DICTATION_MAX_MS = 8 * 60_000;

export const DICTATION_TRIAL = "試用版不錄音，可以打字或選錄音檔（以示範口述代替）";
export const DICTATION_UNSUPPORTED = "這個瀏覽器不支援錄音，請改用「選錄音檔」或「打字輸入」。";
export const DICTATION_VISIT_LIVE = "訪視錄音進行中，完成訪視後再口述計畫";

const IDLE: DictSnapshot = { state: "idle", visitId: null, elapsedMs: 0, level: 0, error: null, nearLimit: false };

class Dictation {
  private snap: DictSnapshot = IDLE;
  private listeners = new Set<() => void>();
  private media: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private meter: ReturnType<typeof setInterval> | undefined;
  private chunks: Blob[] = [];
  private mimeType = "";
  private runStart = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private onVisible: (() => void) | null = null;
  private starting: Promise<boolean> | null = null;
  private stopping: Promise<DictResult | null> | null = null;
  private resolveStop: ((r: DictResult | null) => void) | null = null;
  private discard = false;
  private onLimit: (() => void) | undefined;
  private limitHit = false;
  /** 到上限但沒有人接手時，先停下來的結果（下一次 stop() 拿走）。 */
  private pending: DictResult | null = null;

  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  private set(patch: Partial<DictSnapshot>) {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  get supported() {
    return typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";
  }

  /** 開始口述；連點兩次只會啟動一次。失敗時 state 為 error、回傳 false。 */
  start(visitId: string, opts?: { onLimit?: () => void }): Promise<boolean> {
    if (this.starting) return this.starting;
    this.starting = this.doStart(visitId, opts).finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private fail(visitId: string, error: string) {
    this.set({ ...IDLE, state: "error", visitId, error });
    return false;
  }

  private async doStart(visitId: string, opts?: { onLimit?: () => void }): Promise<boolean> {
    if (this.snap.state === "recording") {
      if (this.snap.visitId === visitId) return true;
      return this.fail(visitId, "另一筆口述還在錄音，請先完成那一筆。");
    }
    this.pending = null;
    // 試用版的分享網頁不給麥克風：不要去要，直接說明。
    if (TRIAL) return this.fail(visitId, DICTATION_TRIAL);
    const rec = recorder.getSnapshot().state;
    if (rec === "recording" || rec === "paused" || rec === "starting") return this.fail(visitId, DICTATION_VISIT_LIVE);
    if (!this.supported) return this.fail(visitId, DICTATION_UNSUPPORTED);

    this.set({ ...IDLE, state: "starting", visitId });
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
      return this.fail(visitId, msg);
    }
    // 等麥克風權限的期間被取消了。
    if (this.snap.state !== "starting" || this.snap.visitId !== visitId) {
      this.teardown();
      return false;
    }

    const mimeType = pickMime();
    try {
      this.media = new MediaRecorder(this.stream, mimeType ? { mimeType, audioBitsPerSecond: 32000 } : { audioBitsPerSecond: 32000 });
    } catch {
      this.teardown();
      return this.fail(visitId, "麥克風無法啟動，請關閉其他正在錄音的 App 後再試。");
    }
    this.mimeType = this.media.mimeType || mimeType || "audio/webm";
    this.chunks = [];
    this.discard = false;
    this.limitHit = false;
    this.onLimit = opts?.onLimit;
    this.media.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    this.media.onstop = () => this.finalize();
    // 被系統中斷（來電、其他 App 搶麥克風）：保留已錄的內容，交給上限同樣的流程整理。
    this.stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      if (this.snap.state === "recording" && !this.stopping) this.reachLimit();
    });
    this.media.start(1000);
    this.runStart = performance.now();
    this.setupMeter();
    await this.lockScreen();
    this.set({ state: "recording" });
    return true;
  }

  /** 結束口述，回傳整段錄音；沒有在錄時回傳 null。 */
  async stop(): Promise<DictResult | null> {
    if (this.starting) await this.starting.catch(() => false);
    if (this.pending) {
      const r = this.pending;
      this.pending = null;
      return r;
    }
    if (this.stopping) return this.stopping;
    if (!this.media || this.media.state === "inactive") {
      if (this.snap.state !== "error") this.set(IDLE);
      return null;
    }
    this.stopping = new Promise((resolve) => {
      this.resolveStop = resolve;
    });
    this.media.stop();
    return this.stopping;
  }

  /** 取消並丟掉這段口述。 */
  cancel() {
    this.pending = null;
    if (this.media && this.media.state !== "inactive") {
      this.discard = true;
      if (!this.stopping) {
        this.stopping = new Promise((resolve) => {
          this.resolveStop = resolve;
        });
        this.media.stop();
      }
      return;
    }
    this.teardown();
    this.set(IDLE);
  }

  private finalize() {
    const durationMs = Math.round(performance.now() - this.runStart);
    const result: DictResult | null = !this.discard && this.chunks.length ? { blob: new Blob(this.chunks, { type: this.mimeType }), mimeType: this.mimeType, durationMs } : null;
    this.chunks = [];
    this.teardown();
    this.set(IDLE);
    const resolve = this.resolveStop;
    this.resolveStop = null;
    this.stopping = null;
    this.discard = false;
    if (resolve) resolve(result);
    else this.pending = result;
  }

  private reachLimit() {
    if (this.limitHit) return;
    this.limitHit = true;
    if (this.onLimit) this.onLimit();
    // 沒有人接手：先停下來，結果留給下一次 stop()。
    else void this.stop().then((r) => {
      this.pending = r;
    });
  }

  private setupMeter() {
    try {
      if (this.stream && typeof AudioContext !== "undefined") {
        this.ctx = new AudioContext();
        // 等麥克風權限時點擊的使用者手勢可能已過期：音量表要手動喚醒。
        void this.ctx.resume?.().catch(() => undefined);
        const src = this.ctx.createMediaStreamSource(this.stream);
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        src.connect(this.analyser);
      }
    } catch {
      // 沒有音量表不影響錄音。
      this.analyser = null;
    }
    const data = new Uint8Array(512);
    // 計時用 setInterval（螢幕變暗時 requestAnimationFrame 會停，上限仍要準時）。
    this.meter = setInterval(() => {
      if (this.snap.state !== "recording") return;
      let level = 0;
      if (this.analyser) {
        this.analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (const v of data) sum += ((v - 128) / 128) ** 2;
        level = Math.min(1, Math.sqrt(sum / data.length) * 4);
      }
      const elapsedMs = performance.now() - this.runStart;
      this.set({ level, elapsedMs, nearLimit: elapsedMs >= DICTATION_MAX_MS - 60_000 });
      if (elapsedMs >= DICTATION_MAX_MS) this.reachLimit();
    }, 100);
  }

  private async lockScreen() {
    try {
      this.wakeLock = (await navigator.wakeLock?.request("screen")) ?? null;
    } catch {
      this.wakeLock = null;
    }
    if (!this.onVisible && typeof document !== "undefined") {
      // 從背景回到前景時重新取得螢幕常亮。
      this.onVisible = () => {
        if (document.visibilityState === "visible" && this.snap.state === "recording" && (!this.wakeLock || this.wakeLock.released)) void this.lockScreen();
      };
      document.addEventListener("visibilitychange", this.onVisible);
    }
  }

  private teardown() {
    clearInterval(this.meter);
    this.meter = undefined;
    this.analyser = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.media = null;
    void this.wakeLock?.release().catch(() => undefined);
    this.wakeLock = null;
    if (this.onVisible && typeof document !== "undefined") document.removeEventListener("visibilitychange", this.onVisible);
    this.onVisible = null;
    this.onLimit = undefined;
  }
}

export const dictation = new Dictation();
