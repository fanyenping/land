import { describe, expect, it } from "vitest";
import type { Analysis, DocKind, DocSection, VitalReading } from "../../shared/types";
import { blockersFor, classifyFiles } from "./actions";
import type { OutputVersion, Visit } from "./model";
import { newVisit } from "./pipeline";
import { initialVitals } from "./vitals";

const analysis = (over: Partial<Analysis> = {}): Analysis => ({
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
  ...over,
});

const pendingTemp: VitalReading = { key: "temp", value: "16.8", qualifier: null, sourceQuote: null, sourceMs: null, confidence: 0.6, status: "implausible", suggestion: "36.8", reason: "不在合理範圍", flag: null };

const version = (sections: DocSection[], extra: Partial<OutputVersion> = {}): OutputVersion => ({ id: "v", sections, origin: "ai", note: null, createdAt: "x", meta: null, ...extra });

function withDoc(v: Visit, kind: DocKind, status: Visit["outputs"]["record"]["status"], extra: Partial<OutputVersion> = {}, body = "內容"): Visit {
  return { ...v, outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], versions: [version([{ heading: "", body }], extra)], current: 0, status } } };
}

/** 三份都寫好、計畫有評估異動、提醒與〔待核對〕的訪視。 */
function busyPlanVisit(): Visit {
  let v: Visit = { ...newVisit("p1", "2026-10-03", "10:00"), status: "review", analysis: analysis({ changes: [{ id: "c1", kind: "worse", text: "傷口變大", evidence: null }] }) };
  v = withDoc(v, "record", "draft");
  v = withDoc(v, "edu", "draft");
  v = withDoc(v, "plan", "draft", { warnings: ["數字沒有來源"] }, "措施：每 2〔待核對〕 小時翻身。");
  return v;
}

const kinds = (v: Visit, k: DocKind | "all") => blockersFor(v, k).map((b) => b.kind);

describe("blockersFor: the record never waits on the plan", () => {
  it("'all' never contains changes, plan writing, plan warnings or 〔待核對〕", () => {
    const v = busyPlanVisit();
    expect(kinds(v, "all")).toEqual([]);
    const writing = withDoc(v, "plan", "writing");
    expect(blockersFor(writing, "all").some((b) => b.doc === "plan")).toBe(false);
  });

  it("'plan' lists them", () => {
    const k = kinds(busyPlanVisit(), "plan");
    expect(k).toContain("changes");
    expect(k).toContain("unverified");
    expect(k).toContain("warning");
    expect(blockersFor(busyPlanVisit(), "plan").find((b) => b.kind === "unverified")).toEqual({ kind: "unverified", label: "刪除或改正〔待核對〕", doc: "plan" });
    expect(kinds(withDoc(busyPlanVisit(), "plan", "writing"), "plan")).toContain("writing");
  });

  it("'all' still includes record warnings and writing", () => {
    const v = withDoc(busyPlanVisit(), "record", "writing", { warnings: ["w"] });
    expect(kinds(v, "all")).toEqual(["writing", "warning"]);
  });
});

describe("blockersFor: dictated plan", () => {
  it("skips processing and vital blockers but keeps identity, 〔待核對〕 and warnings", () => {
    let v: Visit = { ...newVisit("p1", "2026-10-03", "10:00"), status: "processing", stage: "analyze", planSource: "dictation" };
    v = withDoc(v, "plan", "draft", { source: "dictation", warnings: ["w"] }, "目標：2〔待核對〕 週內不擴大。");
    expect(kinds(v, "plan")).toEqual(["unverified", "warning"]);
    expect(kinds(v, "record")).toEqual(["processing"]);

    const a = analysis({ identityConcern: "稱謂不符", vitals: [pendingTemp], changes: [{ id: "c1", kind: "new", text: "x", evidence: null }] });
    const analysed: Visit = { ...v, status: "review", stage: null, analysis: a, identityConfirmed: false, vitals: initialVitals(a, {}, {}) };
    expect(kinds(analysed, "plan")).toEqual(["identity", "unverified", "warning"]);
  });

  it("identity and vital blockers still appear in 'all'", () => {
    const a = analysis({ identityConcern: "稱謂不符", vitals: [pendingTemp] });
    let v: Visit = { ...newVisit("p1", "2026-10-03", "10:00"), status: "review", analysis: a, identityConfirmed: false, vitals: initialVitals(a, {}, {}), planSource: "dictation" };
    v = withDoc(v, "record", "draft");
    const k = kinds(v, "all");
    expect(k).toContain("identity");
    expect(k).toContain("vital");
  });
});

describe("classifyFiles: iPhone cases", () => {
  const f = (name: string, type: string, size = 1024) => new File([new Uint8Array(size)], name, { type });

  it("treats Voice Memos exports as audio whatever type iOS reports", () => {
    const files = ["", "audio/x-m4a", "video/mp4", "application/octet-stream"].map((t) => f("新錄音 3.m4a", t));
    const res = classifyFiles(files);
    expect(res.audio).toHaveLength(4);
    expect(res.rejected).toHaveLength(0);
  });

  it("rejects video and the editable .qta format, keeps documents", () => {
    const res = classifyFiles([f("clip.mp4", "video/mp4"), f("新錄音 3.qta", "video/quicktime"), f("病摘.pdf", "application/pdf"), f("IMG_0001.HEIC", "")]);
    expect(res.audio).toHaveLength(0);
    expect(res.rejected.map((x) => x.name)).toEqual(["clip.mp4", "新錄音 3.qta"]);
    expect(res.docs.map((x) => x.name)).toEqual(["病摘.pdf", "IMG_0001.HEIC"]);
  });
});
