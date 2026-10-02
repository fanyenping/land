import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { DEMO_DURATION_MS, DEMO_SEGMENTS } from "../../shared/demoTranscript";
import { EDU_CLOSING, TRANSLATION_PREFIX } from "../../shared/templates";
import type { AnalyzeRequest, AnalyzeResponse, GenerateResponse, TranslateResponse } from "../../shared/types";
import { analyzeRoute } from "./analyze";
import { generateRoute } from "./generate";
import { translateRoute } from "./translate";

// 沒有金鑰時走示範模式（測試環境不應有金鑰）
delete process.env.ANTHROPIC_API_KEY;
delete process.env.ANTHROPIC_AUTH_TOKEN;

const app = new Hono();
app.post("/api/analyze", analyzeRoute);
app.post("/api/generate", generateRoute);
app.post("/api/translate", translateRoute);

const post = (path: string, body: unknown) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

const base: AnalyzeRequest = {
  visitDate: "2026-10-02",
  patient: { displayName: "陳○蘭", gender: "女", age: 84, familyCallsAs: "阿嬤", diagnoses: [], tubes: [] },
  transcript: { text: "", segments: DEMO_SEGMENTS.map((s) => ({ ...s })), durationMs: DEMO_DURATION_MS, provider: "demo" },
  documents: [],
  typedVitals: {},
  notes: null,
  previous: null,
  currentPlan: null,
};

describe("AI 路由（示範模式）", () => {
  it("分析 → 撰寫 → 翻譯", async () => {
    const res = await post("/api/analyze", base);
    expect(res.status).toBe(200);
    const { analysis, meta } = (await res.json()) as AnalyzeResponse;
    expect(meta).toEqual({ mode: "demo", model: null, promptVersion: "2026.10-1" });
    expect(analysis.vitals.find((v) => v.key === "temp")).toMatchObject({ value: "16.8", status: "implausible", suggestion: "36.8" });

    const gen = await post("/api/generate", {
      kind: "edu",
      visitDate: base.visitDate,
      patient: base.patient,
      analysis,
      confirmedVitals: [],
      currentPlan: null,
      adoptedSuggestions: [],
      options: { recordStyle: "four", instructions: [], custom: null, nurseName: null, clinicPhone: null },
      intakeOnly: false,
    });
    expect(gen.status).toBe(200);
    const { doc } = (await gen.json()) as GenerateResponse;
    expect(doc.sections.at(-1)).toEqual({ heading: "", body: EDU_CLOSING });

    const tr = await post("/api/translate", { text: doc.sections.map((s) => s.body).join("\n"), lang: "vi" });
    expect(tr.status).toBe(200);
    expect(((await tr.json()) as TranslateResponse).text.startsWith(TRANSLATION_PREFIX.vi)).toBe(true);
  });

  it("錯誤一律是 {error:{code,message,retryable}} 與中文說明", async () => {
    const cases: [unknown, number, string][] = [
      [{ ...base, transcript: null }, 400, "empty_input"],
      [{ ...base, documents: [{ name: "a.docx", mimeType: "application/msword", data: "AAAA" }] }, 415, "bad_type"],
      [{ ...base, documents: [{ name: "a.pdf", mimeType: "application/pdf", data: "%%%" }] }, 400, "bad_document"],
      [{ visitDate: "2026-10-02" }, 400, "bad_request"],
    ];
    for (const [body, status, code] of cases) {
      const res = await post("/api/analyze", body);
      expect(res.status, code).toBe(status);
      const { error } = (await res.json()) as { error: { code: string; message: string; retryable: boolean } };
      expect(error.code).toBe(code);
      expect(error.retryable).toBe(false);
      expect(error.message).toMatch(/[一-鿿]/);
    }
    const bad = await app.request("/api/translate", { method: "POST", headers: { "content-type": "application/json" }, body: "{" });
    expect(bad.status).toBe(400);
  });
});
