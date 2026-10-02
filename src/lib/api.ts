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
let probing: Promise<Engine> | null = null;
const listeners = new Set<(e: Engine) => void>();

/** 偵測伺服器；連不到時改用 App 內建的示範引擎（輸出會標示「示範資料」）。 */
export function probeEngine(force = false): Promise<Engine> {
  if (engine && !force) return Promise.resolve(engine);
  if (probing && !force) return probing;
  probing = (async () => {
    try {
      const res = await fetch("/api/health", { signal: AbortSignal.timeout(4000) });
      const ct = res.headers.get("content-type") ?? "";
      if (!res.ok || !ct.includes("json")) throw new Error(String(res.status));
      engine = { kind: "server", health: (await res.json()) as HealthResponse };
    } catch {
      engine = { kind: "local", reason: navigator.onLine ? "找不到 AI 伺服器" : "目前離線" };
    }
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

export function isDemoEngine(e: Engine | null): boolean {
  return !e || e.kind === "local" || e.health.llm.mode === "demo";
}

async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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

export async function transcribe(files: { blob: Blob; name: string }[], signal?: AbortSignal): Promise<Transcript> {
  const e = await probeEngine();
  if (e.kind === "local") {
    await sleep(900);
    return localTranscript();
  }
  const form = new FormData();
  for (const f of files) form.append("audio", f.blob, f.name);
  let res: Response;
  try {
    res = await fetch("/api/transcribe", { method: "POST", body: form, signal });
  } catch {
    throw new PipelineError("network", "連不上伺服器，錄音已安全存在這台裝置，連上網路後會自動繼續。", true);
  }
  return (await readResponse<{ transcript: Transcript }>(res)).transcript;
}

export async function analyze(req: AnalyzeRequest, signal?: AbortSignal): Promise<AnalyzeResponse> {
  const e = await probeEngine();
  if (e.kind === "local") {
    await sleep(1400);
    return { analysis: demoAnalysis(req), meta: { mode: "demo", model: null, promptVersion: "demo" } };
  }
  return postJson<AnalyzeResponse>("/api/analyze", req, signal);
}

export async function generate(req: GenerateRequest, signal?: AbortSignal): Promise<GenerateResponse> {
  const e = await probeEngine();
  if (e.kind === "local") {
    await sleep(900 + Math.random() * 900);
    return { doc: demoGenerate(req), meta: { mode: "demo", model: null, promptVersion: "demo" } };
  }
  return postJson<GenerateResponse>("/api/generate", req, signal);
}

export async function translate(req: TranslateRequest, signal?: AbortSignal): Promise<TranslateResponse> {
  const e = await probeEngine();
  if (e.kind === "local") {
    await sleep(800);
    return { text: demoTranslate(req), meta: { mode: "demo", model: null, promptVersion: "demo" } };
  }
  return postJson<TranslateResponse>("/api/translate", req, signal);
}
