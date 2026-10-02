/**
 * API 防護：機構通行碼（ACCESS_CODE）、跨站請求阻擋、JSON 內容類型、每個 IP 的簡易限流。
 * 錯誤一律是 {error:{code,message,retryable}} 與給護理師看的中文。
 */
import { getConnInfo } from "@hono/node-server/conninfo";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";

export const ACCESS_HEADER = "X-Access-Code";

const fail = (c: Context, status: 401 | 403 | 415 | 429, code: string, message: string, retryable = false) =>
  c.json({ error: { code, message, retryable } }, status);

/* ------------------------------ 通行碼 ------------------------------ */

const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();

/** 固定時間比較（先雜湊成等長，長度不同也不會提早結束）。 */
export function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

/** 讀取並檢查 ACCESS_CODE：空白視為未設定；HTTP 標頭只能可靠傳送可見 ASCII，其他字元在啟動時就報錯。 */
export function readAccessCode(env: NodeJS.ProcessEnv): string | null {
  const code = env.ACCESS_CODE?.trim();
  if (!code) return null;
  if (!/^[\x21-\x7e]+$/.test(code)) {
    throw new Error("ACCESS_CODE 只能使用英數字與半形符號（不可含空白或中文），請修改後再啟動。");
  }
  return code;
}

/** 設定 ACCESS_CODE 時，除了 GET /api/health 以外的 /api/* 都要帶正確的 X-Access-Code。 */
export function requireAccessCode(code: string | null, limiter?: RateLimiter, ip?: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    if (!code) return next();
    if ((c.req.method === "GET" || c.req.method === "HEAD") && c.req.path === "/api/health") return next();
    if (safeEqual(c.req.header(ACCESS_HEADER) ?? "", code)) return next();
    // 猜通行碼也要限流
    if (limiter && ip) {
      const wait = limiter.hit(`auth:${ip(c)}`);
      if (wait !== null) return tooMany(c, wait);
    }
    return fail(c, 401, "unauthorized", "機構通行碼不正確，請到設定重新輸入。");
  };
}

/* ------------------------------ 跨站與內容類型 ------------------------------ */

/**
 * 瀏覽器會在每個請求附上 Sec-Fetch-Site；來自其他網站的請求（包含不需預檢的表單、multipart 上傳）一律拒絕。
 * 不是瀏覽器的用戶端（curl、伺服器）不帶這個標頭，不受影響。
 */
export const rejectCrossSite: MiddlewareHandler = async (c, next) => {
  if (c.req.header("sec-fetch-site") === "cross-site") {
    return fail(c, 403, "cross_site", "不接受來自其他網站的請求。");
  }
  return next();
};

/**
 * JSON 路由只接受 Content-Type: application/json。這種內容類型（以及自訂的 X-Access-Code）
 * 會讓跨站請求必須先預檢；伺服器不回 CORS 標頭，所以預檢失敗、請求不會送出。
 */
export const requireJson: MiddlewareHandler = async (c, next) => {
  const type = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (type !== "application/json") {
    return fail(c, 415, "bad_content_type", "請求格式必須是 JSON（Content-Type: application/json）。");
  }
  return next();
};

/* ------------------------------ 限流 ------------------------------ */

/** 滑動視窗：每個 key 最多保留 limit 筆時間戳，記憶體有上限；定期清掉過期的 key。 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();
  private lastSweep: number;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {
    this.lastSweep = now();
  }

  /** 記一次；超過上限時不記，回傳還要等幾毫秒，否則回傳 null。 */
  hit(key: string): number | null {
    const t = this.now();
    if (t - this.lastSweep > this.windowMs) this.sweep(t);
    const recent = (this.hits.get(key) ?? []).filter((x) => t - x < this.windowMs);
    if (recent.length >= this.limit) {
      this.hits.set(key, recent);
      return Math.max(1, recent[0] + this.windowMs - t);
    }
    recent.push(t);
    this.hits.set(key, recent);
    return null;
  }

  private sweep(t: number) {
    for (const [key, list] of this.hits) if (!list.length || t - list[list.length - 1] >= this.windowMs) this.hits.delete(key);
    this.lastSweep = t;
  }
}

function tooMany(c: Context, waitMs: number) {
  const sec = Math.ceil(waitMs / 1000);
  c.header("Retry-After", String(sec));
  return fail(c, 429, "rate_limited", `送出的請求太頻繁，請等約 ${sec} 秒後再試。`, true);
}

export function rateLimit(limiter: RateLimiter, bucket: string, ip: (c: Context) => string): MiddlewareHandler {
  return async (c, next) => {
    const wait = limiter.hit(`${bucket}:${ip(c)}`);
    if (wait !== null) return tooMany(c, wait);
    return next();
  };
}

/**
 * 用戶端 IP。TRUST_PROXY=n（前面有 n 層反向代理）時取 X-Forwarded-For 由右數第 n 個（由我們的代理加上、無法偽造的那個）；
 * 預設直接用連線來源，避免任何人用自填的標頭繞過限流。
 */
export function clientIp(trustProxyHops: number): (c: Context) => string {
  return (c) => {
    if (trustProxyHops > 0) {
      const chain = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      const ip = chain[chain.length - trustProxyHops];
      if (ip) return ip;
    }
    try {
      return getConnInfo(c).remote.address ?? "unknown";
    } catch {
      return "unknown";
    }
  };
}

export function readTrustProxy(env: NodeJS.ProcessEnv): number {
  const v = env.TRUST_PROXY?.trim().toLowerCase();
  if (!v || v === "0" || v === "false") return 0;
  if (v === "true") return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new Error("TRUST_PROXY 必須是反向代理的層數（0、1、2…）。");
  return n;
}

export function readPositiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const v = env[name]?.trim();
  if (!v) return fallback;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw new Error(`${name} 必須是正整數。`);
  return n;
}
