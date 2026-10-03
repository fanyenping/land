import { demoAnalysis, demoGenerate, demoTranslate } from "../../shared/demo";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  ApiError,
  GenerateRequest,
  GenerateResponse,
  HealthResponse,
  Transcript,
  TranslateRequest,
  TranslateResponse,
} from "../../shared/types";
import { TRIAL } from "./env";

export class PipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type Engine =
  | { kind: "server"; health: HealthResponse }
  | { kind: "local"; reason: string };

let engine: Engine | null = null;
let probedAt = 0;
let probing: Promise<Engine> | null = null;
let accessCode = "";

/** 伺服器要求機構通行碼時，所有 API 請求都帶上。 */
export function setAccessCode(code: string) {
  accessCode = code;
}

function authHeaders(): Record<string, string> {
  return accessCode ? { "X-Access-Code": accessCode } : {};
}
const listeners = new Set<(e: Engine) => void>();

/**
 * 偵測伺服器。連不到時只記為「暫時連不上」並在 15 秒後重新偵測；
 * 真實個案的紀錄不會因此改用示範內容（由 pipeline 決定是否等網路）。
 */
export function probeEngine(force = false): Promise<Engine> {
  const stale = engine?.kind === "local" && Date.now() - probedAt > 15_000;
  if (engine && !force && !stale) return Promise.resolve(engine);
  if (probing && !force) return probing;
  probing = (async () => {
    if (TRIAL) {
      engine = { kind: "local", reason: "試用版・使用內建示範內容" };
      probedAt = Date.now();
      listeners.forEach((l) => l(engine!));
      probing = null;
      return engine;
    }
    try {
      const res = await fetch("/api/health", { signal: AbortSignal.timeout(4000) });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("json")) throw new Error(String(res.status));
      engine = { kind: "server", health: (await res.json()) as HealthResponse };
    } catch {
      engine = { kind: "local", reason: navigator.onLine ? "找不到 AI 伺服器" : "目前離線" };
    }
    probedAt = Date.now();
    listeners.forEach((l) => l(engine!));
    probing = null;
    return engine;
  })();
  return probing;
}

export function currentEngine(): Engine | null {
  return engine;
}

export function onEngine(fn: (e: Engine) => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** 側欄與首頁顯示的 AI 狀態。 */
export function engineLabel(e: Engine | null, demoMode: boolean): { text: string; tone: "ok" | "demo" | "off" | "checking" } {
  if (TRIAL) return { text: "試用版", tone: "demo" };
  if (demoMode) return { text: "示範模式", tone: "demo" };
  if (!e) return { text: "連線檢查中", tone: "checking" };
  if (e.kind === "local") return { text: "AI 未連線", tone: "off" };
  return isDemoEngine(e) ? { text: "示範模式", tone: "demo" } : { text: "AI 已連線", tone: "ok" };
}

export function isDemoEngine(e: Engine | null): boolean {
  return !e || e.kind === "local" || e.health.llm.mode === "demo" || e.health.stt === "demo";
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    throw new PipelineError("network", "連不上伺服器，連上網路後會自動繼續。", true);
  }
  return readResponse<T>(res);
}

async function readResponse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new PipelineError(`http_${res.status}`, `伺服器回應異常（${res.status}）。`, res.status >= 500);
  }
  if (!res.ok) {
    const e = (data as ApiError).error;
    throw new PipelineError(e?.code ?? `http_${res.status}`, e?.message ?? `伺服器回應 ${res.status}`, e?.retryable ?? res.status >= 500);
  }
  return data as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function localTranscript(): Transcript {
  return {
    text: DEMO_SEGMENTS.map((s) => s.text).join(""),
    segments: DEMO_SEGMENTS.map((s) => ({ ...s })),
    durationMs: DEMO_DURATION_MS,
    provider: "demo",
  };
}

/** local=true：使用 App 內建示範引擎（示範個案或使用者開啟示範模式時）。 */
/** 檢查通行碼：送一個空的翻譯請求，通行碼錯會回 401，其他錯誤代表通行碼已通過。 */
export async function verifyAccessCode(): Promise<"ok" | "wrong" | "offline"> {
  try {
    await postJson("/api/translate", {});
    return "ok";
  } catch (err) {
    if (err instanceof PipelineError && err.code === "unauthorized") return "wrong";
    if (err instanceof PipelineError && err.code === "network") return "offline";
    return "ok";
  }
}

export async function transcribe(files: { blob: Blob; name: string }[], local: boolean, signal?: AbortSignal): Promise<Transcript> {
  if (local) {
    await sleep(900);
    return localTranscript();
  }
  const form = new FormData();
  for (const f of files) form.append("audio", f.blob, f.name);
  let res: Response;
  try {
    res = await fetch("/api/transcribe", { method: "POST", body: form, signal, headers: authHeaders() });
  } catch {
    throw new PipelineError("network", "連不上伺服器，錄音已安全存在這台裝置，連上網路後會自動繼續。", true);
  }
  return (await readResponse<{ transcript: Transcript }>(res)).transcript;
}

export async function analyze(req: AnalyzeRequest, local: boolean, signal?: AbortSignal): Promise<AnalyzeResponse> {
  if (local) {
    await sleep(1400);
    return { analysis: demoAnalysis(req), meta: { mode: "demo", model: null, promptVersion: "demo" } };
  }
  return postJson<AnalyzeResponse>("/api/analyze", req, signal);
}

export async function generate(req: GenerateRequest, local: boolean, signal?: AbortSignal): Promise<GenerateResponse> {
  if (local) {
    await sleep(900 + Math.random() * 900);
    return { doc: demoGenerate(req), meta: { mode: "demo", model: null, promptVersion: "demo" } };
  }
  return postJson<GenerateResponse>("/api/generate", req, signal);
}

export async function translate(req: TranslateRequest, local: boolean, signal?: AbortSignal): Promise<TranslateResponse> {
  if (local) {
    await sleep(800);
    return { text: demoTranslate(req), meta: { mode: "demo", model: null, promptVersion: "demo" } };
  }
  return postJson<TranslateResponse>("/api/translate", req, signal);
}
