/**
 * 按住說話（push-to-talk）：數值速記的麥克風。
 * 引擎依序：瀏覽器語音辨識（Web Speech，zh-TW）→ 正式版改用錄音送伺服器轉文字 → 試用版用示範口述。
 * 狀態：idle → listening → finishing → done | error；每條路在放開後都會收尾，不會卡住。
 * 卸載時停止辨識、錄音並關掉麥克風。
 */
import { useEffect, useRef, useState } from "react";
import { PipelineError, currentEngine, probeEngine, transcribe, type Engine } from "./api";
import { getSettings } from "./db";
import { TRIAL } from "./env";
import { recorder } from "./recorder";

/* ---------- Web Speech 型別（DOM lib 沒有 SpeechRecognition／webkit 前綴版本） ---------- */

interface PttAlternative {
  readonly transcript: string;
}
interface PttResult {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [i: number]: PttAlternative;
}
interface PttResultEvent extends Event {
  readonly results: { readonly length: number; readonly [i: number]: PttResult };
}
interface PttErrorEvent extends Event {
  readonly error: string;
}
interface PttRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((e: Event) => void) | null;
  onaudiostart: ((e: Event) => void) | null;
  onresult: ((e: PttResultEvent) => void) | null;
  onerror: ((e: PttErrorEvent) => void) | null;
  onend: ((e: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type PttRecognitionCtor = new () => PttRecognition;

/* ------------------------------------ 公開型別 ------------------------------------ */

export type PttPhase = "idle" | "listening" | "finishing" | "done" | "error";
/** speech：瀏覽器即時辨識；record：錄音後送伺服器；demo：試用版示範口述。 */
export type PttEngine = "speech" | "record" | "demo";
/** pointer：按住放開；toggle：按一次開始、再按一次結束（鍵盤、讀屏）。 */
export type PttVia = "pointer" | "toggle";

export interface PttOutcome {
  text: string;
  source: "speech" | "server" | "demo";
}

export interface PttView {
  phase: PttPhase;
  engine: PttEngine | null;
  via: PttVia | null;
  /** 辨識中的即時文字（只有 Web Speech 有）。 */
  interim: string;
  /** error 階段的說明。 */
  error: string | null;
}

export const PTT_MSG = {
  recordingLive: "錄音進行中，請直接輸入數值",
  noStt: "目前無法轉文字，請直接輸入數值",
  unsupported: "這個瀏覽器不支援語音輸入，請直接輸入數值",
  denied: "沒有麥克風或語音辨識權限：請到設定允許後再試，或直接輸入數值",
  dictationOff: "語音辨識沒有開啟（iPhone 請到「設定」開啟「聽寫」），請直接輸入數值",
  noMic: "找不到可用的麥克風，請直接輸入數值",
  micBusy: "麥克風無法啟動，請關閉其他正在錄音的 App 後再試，或直接輸入數值",
  switched: "這台裝置的語音辨識無法使用，已改用錄音轉文字，請再按住說一次",
  speechDown: "語音辨識無法使用，請直接輸入數值",
  speechNet: "語音辨識連線不穩，請再按住說一次，或直接輸入數值",
  noNet: "沒有網路，語音辨識無法使用，請直接輸入數值",
  noStart: "語音辨識沒有啟動，請再按住說一次，或直接輸入數值",
  holdToTalk: "請按住麥克風說話，放開即填入",
  tooLong: "聽取超過 30 秒已自動停止，沒有填入，請再說一次",
  notReady: "麥克風還沒準備好，請再按住說一次",
  offline: "連不上伺服器，請直接輸入數值",
  timeout: "轉文字逾時，請直接輸入數值",
} as const;

/** 放開後等 Web Speech 最終結果的時間。 */
const SPEECH_FINAL_MS = 1500;
/** 按下不到這個時間就放開：只是點一下，聽不到話，直接結束並提示要按住。 */
const TAP_MS = 350;
/** 最長聽 30 秒（鍵盤模式忘了按第二次）：時間到就取消、不填入，免得把旁人的對話填進去。 */
const MAX_MS = 30_000;
const STT_TIMEOUT_MS = 15_000;

const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/aac"];

function speechCtor(): PttRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: PttRecognitionCtor; webkitSpeechRecognition?: PttRecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

const canRecord = () => typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia && typeof MediaRecorder !== "undefined";

/** 訪視錄音進行中（含暫停，麥克風仍被佔用）：數值速記不另外開麥克風錄音。 */
export function visitRecordingLive(): boolean {
  const st = recorder.getSnapshot().state;
  return st === "recording" || st === "paused" || st === "starting";
}

const sttReady = (e: Engine) => e.kind === "server" && e.health.stt !== "demo" && e.health.stt !== "none";

/** Web Speech 失敗時錄音轉文字能不能接手：true 能、false 不能、null 還不知道（伺服器還在檢查）。 */
function recordFallback(): boolean | null {
  if (visitRecordingLive() || !canRecord() || !navigator.onLine) return false;
  const e = currentEngine();
  return e ? sttReady(e) : null;
}

/** 接起分段的辨識結果：前後都是阿拉伯數字才補空白（「血壓142」「86」不會變成 14286）；中文數字照原樣接，「一百」「四十二」不會被拆開。 */
const joinText = (a: string, b: string) => (/\d\s*$/.test(a) && /^\s*\d/.test(b) ? `${a.trimEnd()} ${b.trimStart()}` : a + b);

/** 伺服器有真正的語音轉文字（不是示範、也沒關掉）；示範模式或離線時不送。 */
async function sttAvailable(): Promise<boolean> {
  if (TRIAL || !navigator.onLine) return false;
  try {
    if ((await getSettings()).demoMode) return false;
    return sttReady(await probeEngine(currentEngine()?.kind === "local"));
  } catch {
    return false;
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Web Speech 在這台裝置不能用（聽寫沒開、不支援中文）而且錄音轉文字確定能接手：之後直接錄音，不再每次先失敗一次。
// 連線、啟動失敗只算那一次；回到 App（從「設定」回來）或恢復連線時重新試 Web Speech。
let speechBroken = false;

interface Session {
  via: PttVia;
  engine: PttEngine | null;
  pressedAt: number;
  released: boolean;
  closed: boolean;
  timers: ReturnType<typeof setTimeout>[];
  // Web Speech
  rec: PttRecognition | null;
  started: boolean;
  ended: boolean;
  restarts: number;
  /** 重新啟動前已聽到的文字。 */
  base: string;
  final: string;
  interim: string;
  // 錄音
  stream: MediaStream | null;
  media: MediaRecorder | null;
  chunks: Blob[];
  mime: string;
  sttOk: Promise<boolean> | null;
  abort: AbortController | null;
}

interface Host {
  set(patch: Partial<PttView>): void;
  result(o: PttOutcome): void;
  demoText(): string;
}

/** 一次按住就是一個 session；非同步回呼一律先確認還是同一個、還沒結束。 */
class PttController {
  private s: Session | null = null;

  constructor(private host: Host) {}

  private live(s: Session) {
    return this.s === s && !s.closed;
  }

  press(via: PttVia) {
    if (this.s && !this.s.closed) return;
    const s: Session = {
      via,
      engine: null,
      pressedAt: performance.now(),
      released: false,
      closed: false,
      timers: [],
      rec: null,
      started: false,
      ended: false,
      restarts: 0,
      base: "",
      final: "",
      interim: "",
      stream: null,
      media: null,
      chunks: [],
      mime: "",
      sttOk: null,
      abort: null,
    };
    this.s = s;
    this.host.set({ phase: "listening", via, engine: null, interim: "", error: null });
    s.timers.push(
      setTimeout(() => {
        if (this.live(s) && !s.released) this.fail(s, PTT_MSG.tooLong);
      }, MAX_MS),
    );

    const Ctor = speechBroken ? null : speechCtor();
    if (Ctor) return this.startSpeech(s, Ctor);
    if (TRIAL) return this.useDemo(s);
    this.startRecordChecked(s);
  }

  release() {
    const s = this.s;
    if (!s || s.closed || s.released) return;
    s.released = true;
    if (s.via === "pointer" && performance.now() - s.pressedAt < TAP_MS) {
      // 只點一下沒按住：這麼短聽不到話，馬上關掉麥克風並提示要按住。
      // 試用版沒有麥克風可聽（辨識沒啟動）：直接填入示範口述。
      if (s.engine === "demo" || (TRIAL && s.engine === "speech" && !s.started)) return this.finish(s, { text: this.host.demoText(), source: "demo" });
      return this.fail(s, PTT_MSG.holdToTalk);
    }
    this.host.set({ phase: "finishing" });
    if (s.engine === "demo") return this.finish(s, { text: this.host.demoText(), source: "demo" });
    if (s.engine === "speech") {
      // 試用版：辨識一直沒啟動（分享網頁擋麥克風）就不必再等。
      if (s.ended || (TRIAL && !s.started)) return this.completeSpeech(s);
      try {
        s.rec?.stop();
      } catch {
        // 已停止
      }
      s.timers.push(setTimeout(() => this.completeSpeech(s), SPEECH_FINAL_MS));
      return;
    }
    if (s.engine === "record") return void this.finishRecord(s);
  }

  /** 鍵盤、讀屏：按一次開始，再按一次結束。 */
  toggle() {
    const s = this.s;
    if (s && !s.closed) {
      s.via = "toggle";
      if (!s.released) this.release();
      return;
    }
    this.press("toggle");
  }

  /** 中止（關閉面板、App 進背景）：不填任何值。 */
  cancel() {
    const s = this.s;
    if (!s || s.closed) return;
    this.close(s);
    this.host.set({ phase: "idle", engine: null, via: null, interim: "" });
  }

  /* ------------------------------ Web Speech ------------------------------ */

  private startSpeech(s: Session, Ctor: PttRecognitionCtor) {
    s.engine = "speech";
    this.host.set({ engine: "speech" });
    let rec: PttRecognition;
    try {
      rec = new Ctor();
    } catch {
      return this.speechError(s, "start-failed");
    }
    s.rec = rec;
    rec.lang = "zh-TW";
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = rec.onaudiostart = () => {
      if (this.live(s)) s.started = true;
    };
    rec.onresult = (e) => {
      if (!this.live(s) || s.engine !== "speech") return;
      let fin = "";
      let int = "";
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        const t = r?.[0]?.transcript ?? "";
        if (r?.isFinal) fin = joinText(fin, t);
        else int = joinText(int, t);
      }
      s.started = true;
      s.final = fin;
      s.interim = int;
      this.host.set({ interim: joinText(joinText(s.base, fin), int) });
    };
    rec.onerror = (e) => this.speechError(s, e.error);
    rec.onend = () => this.speechEnded(s);
    try {
      rec.start();
    } catch {
      this.speechError(s, "start-failed");
    }
  }

  private dropSpeech(s: Session) {
    const rec = s.rec;
    s.rec = null;
    if (!rec) return;
    rec.onstart = rec.onaudiostart = rec.onresult = rec.onerror = rec.onend = null;
    try {
      rec.abort();
    } catch {
      // 已停止
    }
  }

  private speechError(s: Session, code: string) {
    if (!this.live(s) || s.engine !== "speech") return;
    // aborted 多半是我們自己停的；no-speech 只是沒聽到，onend 會收尾。
    if (code === "aborted" || code === "no-speech") return;
    this.dropSpeech(s);
    if (TRIAL) {
      // 試用版的分享網頁不給麥克風：改用示範口述；權限類的錯誤之後直接用示範。
      if (code === "not-allowed" || code === "service-not-allowed" || code === "audio-capture") speechBroken = true;
      return this.useDemo(s);
    }
    const live = visitRecordingLive();
    if (code === "service-not-allowed" || code === "network" || code === "language-not-supported" || code === "start-failed") {
      const fallback = recordFallback();
      if (fallback !== false) {
        // 確定能錄音轉文字、而且是裝置設定的問題，才記住之後直接錄音；連線、啟動失敗下次仍先試 Web Speech。
        if (fallback && (code === "service-not-allowed" || code === "language-not-supported")) speechBroken = true;
        // 還按著就直接接著錄；已經放開只能請他再說一次。
        if (!s.released) return this.startRecordChecked(s);
        return this.fail(s, speechBroken ? PTT_MSG.switched : code === "network" ? PTT_MSG.speechNet : PTT_MSG.noStart);
      }
      if (live) return this.fail(s, PTT_MSG.recordingLive);
      if (code === "service-not-allowed") return this.fail(s, PTT_MSG.dictationOff);
      if (code === "network") return this.fail(s, navigator.onLine ? PTT_MSG.speechNet : PTT_MSG.noNet);
      return this.fail(s, code === "start-failed" ? PTT_MSG.noStart : PTT_MSG.speechDown);
    }
    if (code === "not-allowed") return this.fail(s, PTT_MSG.denied);
    if (code === "audio-capture") return this.fail(s, live ? PTT_MSG.recordingLive : PTT_MSG.noMic);
    this.fail(s, PTT_MSG.speechDown);
  }

  private speechEnded(s: Session) {
    if (!this.live(s) || s.engine !== "speech") return;
    if (!s.released) {
      // 還按著卻停了（瀏覽器的靜音逾時）：保留已聽到的，重新開始聽。
      s.base = joinText(joinText(s.base, s.final), s.interim);
      s.final = s.interim = "";
      if (s.rec && s.restarts++ < 3) {
        try {
          s.rec.start();
          return;
        } catch {
          // 無法重新開始：等放開時收尾
        }
      }
      s.ended = true;
      return;
    }
    s.ended = true;
    this.completeSpeech(s);
  }

  private completeSpeech(s: Session) {
    if (!this.live(s) || s.engine !== "speech") return;
    const text = joinText(joinText(s.base, s.final), s.interim).trim();
    if (!text && !s.started) {
      // 辨識根本沒啟動（權限視窗、分享網頁擋麥克風）。
      if (TRIAL) return this.finish(s, { text: this.host.demoText(), source: "demo" });
      return this.fail(s, PTT_MSG.noStart);
    }
    this.finish(s, { text, source: "speech" });
  }

  /* ------------------------------ 示範口述（試用版） ------------------------------ */

  private useDemo(s: Session) {
    s.engine = "demo";
    this.host.set({ engine: "demo", interim: "" });
    if (s.released) this.finish(s, { text: this.host.demoText(), source: "demo" });
  }

  /* ------------------------------ 錄音 → 伺服器轉文字 ------------------------------ */

  private startRecordChecked(s: Session) {
    if (visitRecordingLive()) return this.fail(s, PTT_MSG.recordingLive);
    if (!canRecord()) return this.fail(s, PTT_MSG.unsupported);
    const e = currentEngine();
    if (!navigator.onLine || (e?.kind === "server" && !sttReady(e))) return this.fail(s, PTT_MSG.noStt);
    this.startRecord(s);
  }

  private startRecord(s: Session) {
    s.engine = "record";
    this.host.set({ engine: "record", interim: "" });
    s.sttOk = sttAvailable();
    navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } }).then(
      (stream) => {
        if (!this.live(s)) return stream.getTracks().forEach((t) => t.stop());
        s.stream = stream;
        // 放開時麥克風還沒好（多半在按「允許」）：這次不算。
        if (s.released) return this.fail(s, PTT_MSG.notReady);
        const mime = typeof MediaRecorder.isTypeSupported === "function" ? (MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m)) ?? "") : "";
        try {
          s.media = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
        } catch {
          return this.fail(s, PTT_MSG.micBusy);
        }
        s.mime = s.media.mimeType || mime || "audio/webm";
        s.media.ondataavailable = (ev) => {
          if (ev.data.size > 0) s.chunks.push(ev.data);
        };
        s.media.start();
      },
      (err: unknown) => {
        if (!this.live(s)) return;
        const name = (err as { name?: string } | null)?.name;
        this.fail(s, name === "NotAllowedError" || name === "SecurityError" ? PTT_MSG.denied : name === "NotFoundError" ? PTT_MSG.noMic : PTT_MSG.micBusy);
      },
    );
  }

  private async finishRecord(s: Session) {
    const media = s.media;
    if (!media) return this.fail(s, PTT_MSG.notReady);
    const stopped = new Promise<void>((resolve) => media.addEventListener("stop", () => resolve(), { once: true }));
    try {
      if (media.state !== "inactive") media.stop();
    } catch {
      // 已停止
    }
    await Promise.race([stopped, sleep(1500)]);
    if (!this.live(s)) return;
    s.stream?.getTracks().forEach((t) => t.stop());
    const blob = new Blob(s.chunks, { type: s.mime });
    if (blob.size === 0) return this.finish(s, { text: "", source: "server" });
    const ok = await Promise.race([s.sttOk ?? Promise.resolve(false), sleep(2500).then(() => false)]);
    if (!this.live(s)) return;
    if (!ok) return this.fail(s, PTT_MSG.noStt);
    const ac = new AbortController();
    s.abort = ac;
    const timer = setTimeout(() => ac.abort(), STT_TIMEOUT_MS);
    try {
      const ext = /mp4|aac/.test(s.mime) ? "m4a" : "webm";
      const t = await transcribe([{ blob, name: `vitals.${ext}` }], false, ac.signal);
      if (!this.live(s)) return;
      // 伺服器若回示範逐字稿，絕不拿來填真實個案的數值。
      if (t.provider === "demo") return this.fail(s, PTT_MSG.noStt);
      this.finish(s, { text: t.text, source: "server" });
    } catch (err) {
      if (!this.live(s)) return;
      this.fail(s, ac.signal.aborted ? PTT_MSG.timeout : err instanceof PipelineError && err.code === "network" ? PTT_MSG.offline : PTT_MSG.noStt);
    } finally {
      clearTimeout(timer);
    }
  }

  /* ------------------------------ 收尾 ------------------------------ */

  private close(s: Session) {
    s.closed = true;
    s.timers.forEach(clearTimeout);
    s.timers = [];
    this.dropSpeech(s);
    const media = s.media;
    s.media = null;
    if (media) {
      media.ondataavailable = null;
      try {
        if (media.state !== "inactive") media.stop();
      } catch {
        // 已停止
      }
    }
    s.stream?.getTracks().forEach((t) => t.stop());
    s.stream = null;
    s.abort?.abort();
  }

  private finish(s: Session, o: PttOutcome) {
    this.close(s);
    this.host.set({ phase: "done", engine: null, interim: "" });
    this.host.result(o);
  }

  private fail(s: Session, message: string) {
    this.close(s);
    this.host.set({ phase: "error", engine: null, interim: "", error: message });
  }
}

const IDLE: PttView = { phase: "idle", engine: null, via: null, interim: "", error: null };

export interface PushToTalk extends PttView {
  press(via: PttVia): void;
  release(): void;
  toggle(): void;
  cancel(): void;
}

/**
 * 數值速記的按住說話。onResult 拿到文字後由畫面解析並填入草稿（不直接存檔）。
 * demoText：試用版（不能用麥克風）放開時使用的示範口述。
 */
export function usePushToTalk({ onResult, demoText }: { onResult: (o: PttOutcome) => void; demoText: string }): PushToTalk {
  const [view, setView] = useState<PttView>(IDLE);
  const resultRef = useRef(onResult);
  const demoRef = useRef(demoText);
  useEffect(() => {
    resultRef.current = onResult;
    demoRef.current = demoText;
  });
  const [c] = useState(
    () =>
      new PttController({
        set: (patch) => setView((v) => ({ ...v, ...patch })),
        result: (o) => resultRef.current(o),
        demoText: () => demoRef.current,
      }),
  );

  useEffect(() => {
    // App 進背景（接電話、切 App）：中止這次，不填值。回到 App（例：從「設定」開了聽寫回來）重新試 Web Speech。
    const onVisibility = () => {
      if (document.visibilityState === "hidden") c.cancel();
      else speechBroken = false;
    };
    const onOnline = () => {
      speechBroken = false;
    };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("online", onOnline);
      c.cancel();
    };
  }, [c]);

  const [api] = useState(() => ({
    press: (via: PttVia) => c.press(via),
    release: () => c.release(),
    toggle: () => c.toggle(),
    cancel: () => c.cancel(),
  }));
  return { ...view, ...api };
}
