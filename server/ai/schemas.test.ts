import { describe, expect, it } from "vitest";
import { ASSESSMENT_MAX_CHARS } from "../../shared/assessment";
import { demoAnalysis } from "../../shared/demo";
import { DEMO_ASSESSMENT } from "../../shared/demoAssessment";
import type { GenerateRequest } from "../../shared/types";
import { GenerateRequestSchema } from "./schemas";

const patient = { displayName: "陳○蘭", gender: "女" as const, age: 84, familyCallsAs: "阿嬤", diagnoses: [], tubes: [] };

const base: GenerateRequest = {
  kind: "plan",
  visitDate: "2026-10-02",
  patient,
  analysis: demoAnalysis({ visitDate: "2026-10-02", patient, transcript: null, documents: [], typedVitals: {}, notes: "初訪", previous: null, currentPlan: null }),
  confirmedVitals: [],
  currentPlan: null,
  adoptedSuggestions: [],
  options: { recordStyle: "four", instructions: [], custom: null, nurseName: null, clinicPhone: null },
  intakeOnly: false,
};

describe("GenerateRequestSchema：初次／再次訪視與全人評估", () => {
  it("兩個欄位都是選填（舊版前端不送）", () => {
    const r = GenerateRequestSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.data?.visitKind).toBeUndefined();
    expect(r.data?.assessment).toBeUndefined();
  });

  it("接受 first／follow 與評估摘要（含 null）", () => {
    for (const visitKind of ["first", "follow"] as const) {
      const r = GenerateRequestSchema.safeParse({ ...base, visitKind, assessment: DEMO_ASSESSMENT });
      expect(r.success, visitKind).toBe(true);
      expect(r.data).toMatchObject({ visitKind, assessment: DEMO_ASSESSMENT });
    }
    expect(GenerateRequestSchema.safeParse({ ...base, visitKind: "first", assessment: null }).success).toBe(true);
    expect(GenerateRequestSchema.safeParse({ ...base, assessment: "x".repeat(ASSESSMENT_MAX_CHARS) }).success).toBe(true);
  });

  it("拒絕不認識的訪視類型、過長或非字串的評估", () => {
    const bad: [string, unknown][] = [
      ["visitKind", { ...base, visitKind: "initial" }],
      ["visitKind", { ...base, visitKind: null }],
      ["assessment", { ...base, assessment: "x".repeat(ASSESSMENT_MAX_CHARS + 1) }],
      ["assessment", { ...base, assessment: 12 }],
      ["assessment", { ...base, assessment: ["Braden 12分"] }],
    ];
    for (const [field, body] of bad) {
      const r = GenerateRequestSchema.safeParse(body);
      expect(r.success, field).toBe(false);
      expect(r.error?.issues[0].path[0]).toBe(field);
    }
  });
});
