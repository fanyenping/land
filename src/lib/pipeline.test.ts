import { describe, expect, it } from "vitest";
import { ASSESSMENT_FORMS, type HolisticAssessment } from "../assessment/forms";
import type { Analysis } from "../../shared/types";
import { DEFAULT_SETTINGS, type Patient, type Visit } from "./model";
import { buildGenerateRequest, buildPolishRequest, newVisit } from "./pipeline";

const SENTINEL = "口述計畫哨兵";
const BASE = { version: 2, text: "問題 1：跌倒高危險群（沿用）", confirmedAt: "2026-09-19T03:00:00Z", by: "林護理師" };

const analysis: Analysis = {
  summary: "傷口較上次大",
  speakers: {},
  vitals: [],
  findings: [],
  tubes: [],
  wounds: [],
  interventions: [],
  changes: [],
  planSuggestions: [],
  educationTopics: [],
  redFlags: [],
  docFacts: [],
  documents: [],
  identityConcern: null,
  missingDomains: [],
  languageNotes: [],
  conflicts: [],
};

function assessment(n: number): HolisticAssessment {
  const forms = Object.fromEntries(ASSESSMENT_FORMS.slice(0, n).map((f) => [f.id, { values: {}, savedAt: "2026-09-20T02:00:00Z", savedBy: "林護理師" }]));
  return { forms, completedOn: n >= ASSESSMENT_FORMS.length ? "2026-09-20" : null, updatedAt: "2026-09-20T02:00:00Z", updatedBy: "林護理師" };
}

function patient(forms: number, plan: Patient["plan"] = null): Patient {
  return {
    id: "p1",
    name: "高美珍",
    gender: "女",
    birthYear: 1948,
    familyCallsAs: "阿嬤",
    diagnoses: ["第二型糖尿病"],
    tubes: [],
    consent: null,
    consentRefusedAt: null,
    plan,
    last: null,
    isDemo: false,
    isTemporary: false,
    createdAt: "2026-09-01T00:00:00Z",
    updatedAt: "2026-09-01T00:00:00Z",
    assessment: assessment(forms),
  };
}

function visit(kind: "first" | "follow", patch: Partial<Visit> = {}): Visit {
  return {
    ...newVisit("p1", "2026-10-03", "16:00"),
    kind,
    status: "processing",
    analysis,
    planDictation: { id: "d1", input: "typed", audio: null, text: SENTINEL, provider: "typed", status: "review", error: null, updatedAt: "x", by: "林" },
    ...patch,
  };
}

const gen = (v: Visit, p: Patient, kind: "record" | "plan" | "edu") => buildGenerateRequest(v, p, DEFAULT_SETTINGS, kind);

describe("buildGenerateRequest", () => {
  it("record and edu never carry the dictation or the assessment", () => {
    for (const p of [patient(8), patient(13, BASE)]) {
      for (const kind of ["record", "edu"] as const) {
        const req = gen(visit("first"), p, kind);
        expect(req).not.toBeNull();
        expect(JSON.stringify(req)).not.toContain(SENTINEL);
        expect(req!.assessment).toBeNull();
        expect(req!.visitKind).toBe("first");
      }
    }
    expect(gen(visit("follow"), patient(13, BASE), "record")!.currentPlan).toBe(BASE.text);
  });

  it("a plan at 8/13 never sends the partial assessment", () => {
    const req = gen(visit("first"), patient(8, BASE), "plan");
    expect(req).toMatchObject({ kind: "plan", visitKind: "follow", assessment: null, currentPlan: BASE.text });
    expect(JSON.stringify(req)).not.toContain(SENTINEL);
  });

  it("a plan at 13/13 sends the summary", () => {
    const req = gen(visit("first"), patient(13), "plan");
    expect(req!.assessment).toEqual(expect.any(String));
    expect(req).toMatchObject({ visitKind: "first", currentPlan: null });
  });

  it("follow visit with 13/13 and no base → first-version rules", () => {
    expect(gen(visit("follow"), patient(13), "plan")).toMatchObject({ visitKind: "first", currentPlan: null });
  });

  it("carried → follow rules with the base plan", () => {
    expect(gen(visit("follow"), patient(13, BASE), "plan")).toMatchObject({ visitKind: "follow", currentPlan: BASE.text });
  });

  it("an awaiting, dictated or deferred plan has no generate request", () => {
    expect(gen(visit("follow"), patient(8), "plan")).toBeNull();
    expect(gen(visit("follow", { planSource: "dictation" }), patient(13), "plan")).toBeNull();
    expect(gen(visit("follow", { planDeferred: { by: "林", at: "x" } }), patient(13, BASE), "plan")).toBeNull();
  });

  it("an explicit source overrides the slot", () => {
    expect(buildGenerateRequest(visit("follow", { planSource: "dictation" }), patient(13), DEFAULT_SETTINGS, "plan", { source: "assessment" })).toMatchObject({ visitKind: "first" });
  });

  it("currentPlan comes from the snapshot, not from this visit's own confirmed plan", () => {
    const own = { version: 3, text: "這次確認的計畫", confirmedAt: "2026-10-03T05:00:00Z", by: "林護理師" };
    const req = gen(visit("follow", { planBase: BASE }), patient(13, own), "plan");
    expect(req).toMatchObject({ visitKind: "follow", currentPlan: BASE.text });
    const none = gen(visit("follow", { planBase: null }), patient(13, own), "plan");
    expect(none).toMatchObject({ visitKind: "first", currentPlan: null });
  });

  it("needs an analysis", () => {
    expect(gen(visit("follow", { analysis: null }), patient(13), "record")).toBeNull();
  });
});

describe("buildPolishRequest", () => {
  it("carries only the dictation and formatting options", () => {
    const req = buildPolishRequest(visit("follow"), patient(13, BASE), { instructions: ["更精簡"], custom: "  " });
    expect(Object.keys(req!).sort()).toEqual(["dictation", "familyCallsAs", "hasCurrentPlan", "options", "visitDate"]);
    expect(req).toEqual({ visitDate: "2026-10-03", dictation: SENTINEL, familyCallsAs: "阿嬤", hasCurrentPlan: true, options: { instructions: ["更精簡"], custom: null } });
    expect(JSON.stringify(req)).not.toContain(BASE.text);
    expect(JSON.stringify(req)).not.toContain(analysis.summary);
  });

  it("uses the snapshot for hasCurrentPlan", () => {
    expect(buildPolishRequest(visit("follow", { planBase: null }), patient(13, BASE))!.hasCurrentPlan).toBe(false);
  });

  it("is null without text and falls back to the version's source text", () => {
    expect(buildPolishRequest(visit("follow", { planDictation: null }), patient(8))).toBeNull();
    const typed = visit("follow", { planDictation: { id: "d1", input: "typed", audio: null, text: "   ", provider: "typed", status: "review", error: null, updatedAt: "x", by: "林" } });
    expect(buildPolishRequest(typed, patient(8))).toBeNull();
    const v = visit("follow", { planDictation: null });
    v.outputs.plan = { ...v.outputs.plan, versions: [{ id: "a", sections: [], origin: "ai", note: null, createdAt: "x", meta: null, source: "dictation", sourceText: "原文" }], current: 0, status: "draft" };
    expect(buildPolishRequest(v, patient(8))!.dictation).toBe("原文");
  });

  it("clamps to the server limits", () => {
    const long = visit("follow", { planDictation: { id: "d1", input: "typed", audio: null, text: "字".repeat(7000), provider: "typed", status: "review", error: null, updatedAt: "x", by: "林" } });
    const req = buildPolishRequest(long, { ...patient(8), familyCallsAs: "很長的稱謂".repeat(5) }, { instructions: ["a", "b", "c", "d", "e", "f"], custom: "x".repeat(600) })!;
    expect(req.dictation).toHaveLength(6000);
    expect(req.familyCallsAs).toBeNull();
    expect(req.options.instructions).toHaveLength(5);
    expect(req.options.custom).toHaveLength(500);
  });
});
