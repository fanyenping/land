import { HTTPException } from "hono/http-exception";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../shared/demoTranscript";
import type { AnalyzeRequest, HealthResponse } from "../shared/types";
import { createApp } from "./app";
import { MAX_DOCUMENT_BASE64_CHARS } from "./ai/schemas";
import { checkDocument, MAX_IMAGE_BYTES } from "./routes/analyze";
import { safeEqual } from "./security";
import { createSttProvider, transcribeSegments, type SttProvider, type Transcript } from "./stt";

// 示範模式（測試環境不應有金鑰）；請求日誌不輸出
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;
beforeAll(() => void vi.spyOn(console, "log").mockImplementation(() => {}));
afterAll(() => vi.restoreAllMocks());

type ErrorJson = { error: { code: string; message: string; retryable: boolean } };

const CODE = "Taione-2026!";
const translateBody = JSON.stringify({ text: "1. 每 2 小時翻身。", lang: "vi" });

const json = (headers: Record<string, string> = {}, body = translateBody): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json", ...headers },
  body,
});

async function expectError(res: Response, status: number, code: string, retryable = false) {
  expect(res.status, code).toBe(status);
  const { error } = (await res.json()) as ErrorJson;
  expect(error.code).toBe(code);
  expect(error.retryable).toBe(retryable);
  expect(error.message).toMatch(/[一-鿿]/);
}

const analyzeBase: AnalyzeRequest = {
  visitDate: "2026-10-02",
  patient: { displayName: "陳○蘭", gender: "女", age: 84, familyCallsAs: "阿嬤", diagnoses: [], tubes: [] },
  transcript: { text: "", segments: DEMO_SEGMENTS.map((s) => ({ ...s })), durationMs: DEMO_DURATION_MS, provider: "demo" },
  documents: [],
  typedVitals: {},
  notes: null,
  previous: null,
  currentPlan: null,
};

const b64 = (bytes: number[] | Buffer) => Buffer.from(bytes as number[]).toString("base64");
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0];
const JPEG = [0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46];
const PDF = Buffer.from("%PDF-1.4\n%%EOF");
const WEBP = Buffer.concat([Buffer.from("RIFF"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBPVP8 ")]);
const GIF = Buffer.from("GIF89a");

/* ------------------------------ 通行碼 ------------------------------ */

describe("機構通行碼（ACCESS_CODE）", () => {
  it("未設定：health 回報 auth:false，API 不需要通行碼", async () => {
    const { app } = createApp({ env: {} });
    const health = (await (await app.request("/api/health")).json()) as HealthResponse;
    expect(health).toMatchObject({ ok: true, auth: false, stt: "demo", llm: { mode: "demo" } });
    expect((await app.request("/api/translate", json())).status).toBe(200);
  });

  it("設定後：health 不需要，其他 /api/* 都要正確的 X-Access-Code", async () => {
    const { app } = createApp({ env: { ACCESS_CODE: CODE } });
    const health = await app.request("/api/health");
    expect(health.status).toBe(200);
    expect(((await health.json()) as HealthResponse).auth).toBe(true);

    await expectError(await app.request("/api/translate", json()), 401, "unauthorized");
    await expectError(await app.request("/api/translate", json({ "X-Access-Code": "wrong" })), 401, "unauthorized");
    await expectError(await app.request("/api/translate", json({ "X-Access-Code": CODE.toLowerCase() })), 401, "unauthorized");
    await expectError(await app.request("/api/transcribe", { method: "POST" }), 401, "unauthorized");
    // 未知路徑、health 的其他方法也要通行碼，不能藉此探測
    await expectError(await app.request("/api/nope"), 401, "unauthorized");
    await expectError(await app.request("/api/health", { method: "POST" }), 401, "unauthorized");

    expect((await app.request("/api/translate", json({ "X-Access-Code": CODE }))).status).toBe(200);
    await expectError(await app.request("/api/nope", { headers: { "X-Access-Code": CODE } }), 404, "not_found");
  });

  it("猜錯太多次會被限流", async () => {
    const { app } = createApp({ env: { ACCESS_CODE: CODE } });
    for (let i = 0; i < 10; i++) expect((await app.request("/api/translate", json({ "X-Access-Code": `x${i}` }))).status).toBe(401);
    await expectError(await app.request("/api/translate", json({ "X-Access-Code": "x" })), 429, "rate_limited", true);
    // 正確的通行碼不受影響
    expect((await app.request("/api/translate", json({ "X-Access-Code": CODE }))).status).toBe(200);
  });

  it("通行碼只能是可見 ASCII；比較不受長度影響", () => {
    expect(() => createApp({ env: { ACCESS_CODE: "機構密碼" } })).toThrow(/ACCESS_CODE/);
    expect(createApp({ env: { ACCESS_CODE: "   " } }).auth).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "abc")).toBe(false);
  });
});

/* ------------------------------ 跨站與內容類型 ------------------------------ */

describe("跨站請求與 JSON 內容類型", () => {
  const { app } = createApp({ env: {} });

  it("JSON 路由不接受 text/plain、表單或沒有 Content-Type 的請求", async () => {
    for (const path of ["/api/analyze", "/api/generate", "/api/translate"]) {
      for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", ""]) {
        const res = await app.request(path, { method: "POST", headers: type ? { "content-type": type } : {}, body: translateBody });
        await expectError(res, 415, "bad_content_type");
      }
    }
    expect((await app.request("/api/translate", json({ "content-type": "Application/JSON; charset=utf-8" }))).status).toBe(200);
  });

  it("瀏覽器標示為跨站的請求一律拒絕", async () => {
    await expectError(await app.request("/api/translate", json({ "Sec-Fetch-Site": "cross-site" })), 403, "cross_site");
    await expectError(
      await app.request("/api/transcribe", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" }, body: new FormData() }),
      403,
      "cross_site",
    );
    expect((await app.request("/api/translate", json({ "Sec-Fetch-Site": "same-origin" }))).status).toBe(200);
  });
});

/* ------------------------------ 限流 ------------------------------ */

describe("每個 IP 的限流", () => {
  it("AI 路由合計、轉文字分開計；時間過了就恢復", async () => {
    let t = 1_000_000;
    const { app } = createApp({ env: { RATE_LIMIT_AI_PER_MIN: "2", RATE_LIMIT_TRANSCRIBE_PER_MIN: "1" }, now: () => t });
    expect((await app.request("/api/translate", json())).status).toBe(200);
    expect((await app.request("/api/analyze", json({}, "{}"))).status).toBe(400);
    const limited = await app.request("/api/generate", json({}, "{}"));
    expect(limited.headers.get("Retry-After")).toBe("60");
    await expectError(limited, 429, "rate_limited", true);

    // 轉文字是另一個額度
    expect((await app.request("/api/transcribe", { method: "POST", body: new FormData() })).status).toBe(400);
    await expectError(await app.request("/api/transcribe", { method: "POST", body: new FormData() }), 429, "rate_limited", true);

    t += 60_001;
    expect((await app.request("/api/translate", json())).status).toBe(200);
  });

  it("TRUST_PROXY 時以代理加上的 X-Forwarded-For 分別計數", async () => {
    const { app } = createApp({ env: { RATE_LIMIT_AI_PER_MIN: "1", TRUST_PROXY: "1" } });
    const from = (ip: string) => json({ "X-Forwarded-For": `6.6.6.6, ${ip}` });
    expect((await app.request("/api/translate", from("10.0.0.1"))).status).toBe(200);
    expect((await app.request("/api/translate", from("10.0.0.1"))).status).toBe(429);
    expect((await app.request("/api/translate", from("10.0.0.2"))).status).toBe(200);
  });
});

/* ------------------------------ 文件檢查（ReDoS、檔頭、大小） ------------------------------ */

describe("/api/analyze 文件檢查", () => {
  const { app } = createApp({ env: {} });
  const analyze = (documents: AnalyzeRequest["documents"]) => app.request("/api/analyze", json({}, JSON.stringify({ ...analyzeBase, documents })));

  it("惡意的 base64 不會讓伺服器卡住（線性時間）", async () => {
    const evil = " ".repeat(200_000) + "!";
    const started = performance.now();
    await expectError(await analyze([{ name: "evil.pdf", mimeType: "application/pdf", data: evil }]), 400, "bad_document");
    expect(performance.now() - started).toBeLessThan(1000);
    const evil2 = "A".repeat(100_000) + "\n".repeat(100_000) + "=!";
    expect(checkDocument({ name: "x.pdf", mimeType: "application/pdf", data: evil2 })?.code).toBe("bad_document");
  });

  it("超長的 data 在 zod 就被擋下", async () => {
    const res = await analyze([{ name: "big.pdf", mimeType: "application/pdf", data: "A".repeat(MAX_DOCUMENT_BASE64_CHARS + 4) }]);
    await expectError(res, 400, "bad_request");
  });

  it("只接受 PDF 與 4 種影像，檔頭要符合宣告的格式，並指出是哪一份", async () => {
    await expectError(await analyze([{ name: "note.txt", mimeType: "text/plain", data: b64(Buffer.from("hi")) }]), 415, "bad_type");
    const res = await analyze([
      { name: "ok.pdf", mimeType: "application/pdf", data: b64(PDF) },
      { name: "假的.pdf", mimeType: "application/pdf", data: b64(PNG) },
    ]);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as ErrorJson;
    expect(error.code).toBe("bad_document");
    expect(error.message).toContain("「假的.pdf」");
    expect(error.message).toContain("PDF");

    const cases: [string, string, number[] | Buffer][] = [
      ["a.png", "image/png", JPEG],
      ["a.jpg", "image/jpeg", PNG],
      ["a.webp", "image/webp", Buffer.from("RIFF0000WAVE")],
      ["a.gif", "image/gif", PNG],
    ];
    for (const [name, mimeType, bytes] of cases) {
      expect(checkDocument({ name, mimeType, data: b64(bytes) }), name).toMatchObject({ code: "bad_document" });
    }
    const valid: [string, number[] | Buffer][] = [
      ["application/pdf", PDF],
      ["image/png", PNG],
      ["image/jpeg", JPEG],
      ["image/webp", WEBP],
      ["image/gif", GIF],
    ];
    for (const [mimeType, bytes] of valid) expect(checkDocument({ name: "x", mimeType, data: b64(bytes) }), mimeType).toBeNull();
    // base64 內含換行（部分編碼器會分行）仍可接受
    expect(checkDocument({ name: "x", mimeType: "image/png", data: b64(PNG).replace(/(.{4})/g, "$1\n") })).toBeNull();
  });

  it("單張影像超過 5 MB（解碼後）回 bad_document；PDF 不受此限", async () => {
    const big = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    Buffer.from(PNG).copy(big);
    const res = await analyze([{ name: "大照片.png", mimeType: "image/png", data: big.toString("base64") }]);
    expect(res.status).toBe(400);
    const { error } = (await res.json()) as ErrorJson;
    expect(error).toMatchObject({ code: "bad_document", retryable: false });
    expect(error.message).toContain("「大照片.png」");
    expect(error.message).toContain("5 MB");

    const exact = Buffer.alloc(MAX_IMAGE_BYTES);
    Buffer.from(PNG).copy(exact);
    expect(checkDocument({ name: "x", mimeType: "image/png", data: exact.toString("base64") })).toBeNull();
    const pdf = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    PDF.copy(pdf);
    expect(checkDocument({ name: "x", mimeType: "application/pdf", data: pdf.toString("base64") })).toBeNull();
  });

  it("合格的文件可以完成分析（示範模式）", async () => {
    const res = await analyze([{ name: "病摘.pdf", mimeType: "application/pdf", data: b64(PDF) }]);
    expect(res.status).toBe(200);
  });
});

/* ------------------------------ 轉文字 ------------------------------ */

describe("/api/transcribe", () => {
  it("太大回 413 too_large（不可重試），不是 500", async () => {
    const { app } = createApp({ env: {} });
    const res = await app.request("/api/transcribe", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=x", "content-length": String(301 * 1024 * 1024) },
      body: "--x--",
    });
    await expectError(res, 413, "too_large");
  });

  it("壞掉的 multipart 回 400 bad_form", async () => {
    const { app } = createApp({ env: {} });
    const res = await app.request("/api/transcribe", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: "garbage" });
    await expectError(res, 400, "bad_form");
    await expectError(await app.request("/api/transcribe", { method: "POST", body: new FormData() }), 400, "no_audio");
  });

  it("Claude 已連線但沒有設定 STT：503 stt_not_configured，health 顯示 none", async () => {
    const stt = createSttProvider({ ANTHROPIC_API_KEY: "sk-test" });
    const { app } = createApp({ env: {}, stt });
    expect(((await (await app.request("/api/health")).json()) as HealthResponse).stt).toBe("none");
    const form = new FormData();
    form.append("audio", new Blob([new Uint8Array(4)], { type: "audio/webm" }), "a.webm");
    await expectError(await app.request("/api/transcribe", { method: "POST", body: form }), 503, "stt_not_configured");
    await expect(stt.transcribe({ data: new Uint8Array(1), mimeType: "audio/webm", filename: "a" })).rejects.toMatchObject({
      code: "stt_not_configured",
      retryable: false,
    });
  });
});

describe("STT 選擇", () => {
  it("指定了供應者卻缺金鑰：啟動失敗", () => {
    expect(() => createSttProvider({ STT_PROVIDER: "azure", AZURE_SPEECH_ENDPOINT: "https://x" })).toThrow(/AZURE_SPEECH_KEY/);
    expect(() => createSttProvider({ STT_PROVIDER: "azure", AZURE_SPEECH_KEY: "k" })).toThrow(/AZURE_SPEECH_ENDPOINT/);
    expect(() => createSttProvider({ STT_PROVIDER: "whisper" })).toThrow(/WHISPER_BASE_URL/);
    expect(() => createSttProvider({ STT_PROVIDER: "google" })).toThrow(/STT_PROVIDER/);
    expect(() => createSttProvider({ AZURE_SPEECH_KEY: "k", ANTHROPIC_API_KEY: "sk" })).toThrow(/不完整/);
    expect(() => createApp({ env: { STT_PROVIDER: "azure" } })).toThrow();
  });

  it("示範逐字稿只在 LLM 也是示範模式時使用", () => {
    expect(createSttProvider({}).name).toBe("demo");
    expect(createSttProvider({ ANTHROPIC_API_KEY: "sk" }).name).toBe("none");
    expect(createSttProvider({ ANTHROPIC_AUTH_TOKEN: "t" }).name).toBe("none");
    expect(createSttProvider({ AZURE_SPEECH_ENDPOINT: "https://x", AZURE_SPEECH_KEY: "k", ANTHROPIC_API_KEY: "sk" }).name).toBe("azure-speech");
    expect(createSttProvider({ STT_PROVIDER: "Whisper", WHISPER_BASE_URL: "http://w" }).name).toBe("whisper");
  });

  it("多段錄音的講者代號依段次分開（P2-S1），時間軸接續", async () => {
    const fake: SttProvider = {
      name: "fake",
      async transcribe(): Promise<Transcript> {
        return {
          text: "甲乙",
          segments: [
            { startMs: 0, endMs: 1000, text: "甲", speaker: "S1" },
            { startMs: 1000, endMs: 2000, text: "乙", speaker: "S2" },
            { startMs: 2000, endMs: 3000, text: "丙" },
          ],
          durationMs: 3000,
          provider: "fake",
        };
      },
    };
    const part = { data: new Uint8Array(1), mimeType: "audio/webm", filename: "a.webm" };
    const two = await transcribeSegments(fake, [part, part]);
    expect(two.segments.map((s) => s.speaker)).toEqual(["P1-S1", "P1-S2", undefined, "P2-S1", "P2-S2", undefined]);
    expect(two.segments[3].startMs).toBe(3000);
    expect(two.durationMs).toBe(6000);
    const one = await transcribeSegments(fake, [part]);
    expect(one.segments.map((s) => s.speaker)).toEqual(["S1", "S2", undefined]);
    // 示範供應者只取一次，代號維持與示範分析一致
    const demo = await transcribeSegments(createSttProvider({}), [part, part]);
    expect(demo.segments[0].speaker).toBe("S1");
  });
});

/* ------------------------------ 其他 ------------------------------ */

describe("錯誤處理", () => {
  it("未知的 /api 路徑回 JSON 404", async () => {
    const { app } = createApp({ env: {} });
    for (const path of ["/api/nope", "/api", "/api/health/x"]) await expectError(await app.request(path), 404, "not_found");
  });

  it("HTTPException 依狀態回有代碼的 JSON，不是 500 可重試", async () => {
    const { app } = createApp({ env: {} });
    app.get("/boom/413", () => {
      throw new HTTPException(413);
    });
    app.get("/boom/500", () => {
      throw new Error("x");
    });
    vi.spyOn(console, "error").mockImplementationOnce(() => {});
    await expectError(await app.request("/boom/413"), 413, "too_large");
    await expectError(await app.request("/boom/500"), 500, "server_error", true);
  });
});
