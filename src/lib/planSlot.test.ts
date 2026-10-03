import { describe, expect, it } from "vitest";
import { ASSESSMENT_FORMS, type HolisticAssessment } from "../assessment/forms";
import type { Analysis, DocKind, DocSection } from "../../shared/types";
import type { OutputVersion, Patient, Visit } from "./model";
import { newVisit } from "./pipeline";
import {
  assessmentComplete,
  autoPlanStale,
  changesOpen,
  hasUnverified,
  includedKinds,
  openWarnings,
  planAutoWritable,
  planBadge,
  planBaseFor,
  planCopyable,
  planExcludedReason,
  planSlot,
  recoverOutput,
  undeferPatch,
  visitComplete,
} from "./planSlot";

const DATE = "2026-10-03";

function assessment(n: number, completedOn: string | null = "2026-09-20"): HolisticAssessment {
  const forms = Object.fromEntries(ASSESSMENT_FORMS.slice(0, n).map((f) => [f.id, { values: {}, savedAt: "2026-09-20T02:00:00Z", savedBy: "林護理師" }]));
  return { forms, completedOn: n >= ASSESSMENT_FORMS.length ? completedOn : null, updatedAt: "2026-09-20T02:00:00Z", updatedBy: "林護理師" };
}

const PLAN_V2 = { version: 2, text: "問題 1：跌倒高危險群（沿用）", confirmedAt: "2026-09-19T03:00:00Z", by: "林護理師" };

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

function visit(kind: "first" | "follow" | undefined, patch: Partial<Visit> = {}): Visit {
  const v = newVisit("p1", DATE, "10:00");
  return { ...v, ...(kind ? { kind } : {}), ...patch };
}

const sections = (body = "問題 1：皮膚完整性受損"): DocSection[] => [{ heading: "三、護理問題與計畫", body }];

function version(extra: Partial<OutputVersion> = {}): OutputVersion {
  return { id: "x", sections: sections(), origin: "ai", note: null, createdAt: "2026-10-03T03:00:00Z", meta: null, ...extra };
}

/** 給某份文件一個版本與狀態。 */
function withDoc(v: Visit, kind: DocKind, status: Visit["outputs"]["record"]["status"], extra: Partial<OutputVersion> = {}, out: Partial<Visit["outputs"]["record"]> = {}): Visit {
  return { ...v, outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], versions: [version(extra)], current: 0, status, ...out } } };
}

const analysisWithChange = { changes: [{ id: "c1", kind: "worse", text: "傷口變大", evidence: null }] } as unknown as Analysis;

describe("planSlot: decision table", () => {
  it("row 1: 13/13, first visit, no plan → assessment", () => {
    expect(planSlot(visit("first"), patient(13))).toMatchObject({ mode: "assessment", done: 13, total: 13 });
  });

  it("row 2: 13/13, first visit, current plan → assessment", () => {
    expect(planSlot(visit("first"), patient(13, PLAN_V2)).mode).toBe("assessment");
  });

  it("row 3: 13/13, follow visit, no plan → assessment", () => {
    expect(planSlot(visit("follow"), patient(13)).mode).toBe("assessment");
  });

  it("row 4: 13/13, follow visit, current plan → carried", () => {
    expect(planSlot(visit("follow"), patient(13, PLAN_V2)).mode).toBe("carried");
    // 舊資料沒有 kind：視為再次訪視。
    expect(planSlot(visit(undefined), patient(13, PLAN_V2)).mode).toBe("carried");
  });

  it("rows 5–6: <13 with a current plan → carried (first or follow)", () => {
    expect(planSlot(visit("first"), patient(8, PLAN_V2))).toMatchObject({ mode: "carried", done: 8, total: 13 });
    expect(planSlot(visit("follow"), patient(8, PLAN_V2)).mode).toBe("carried");
  });

  it("row 7: <13 and no plan → awaiting (first or follow)", () => {
    expect(planSlot(visit("first"), patient(8)).mode).toBe("awaiting");
    expect(planSlot(visit("follow"), patient(0)).mode).toBe("awaiting");
  });

  it("row D: a dictation source wins over the forms and the plan", () => {
    expect(planSlot(visit("first", { planSource: "dictation" }), patient(13)).mode).toBe("dictation");
  });

  it("R0 / row X: deferred wins over everything", () => {
    expect(planSlot(visit("first", { planDeferred: { by: "林", at: "2026-10-03T03:00:00Z" }, planSource: "dictation" }), patient(13)).mode).toBe("deferred");
  });

  it("R1: a saved source is used as is", () => {
    expect(planSlot(visit("follow", { planSource: "assessment" }), patient(8, PLAN_V2)).mode).toBe("assessment");
    expect(planSlot(visit("first", { planSource: "carried" }), patient(13)).mode).toBe("carried");
  });

  it("R2 (legacy): a plan with versions but no source → carried with a base, else assessment", () => {
    expect(planSlot(withDoc(visit("first"), "plan", "draft"), patient(3, PLAN_V2)).mode).toBe("carried");
    expect(planSlot(withDoc(visit("follow"), "plan", "draft"), patient(3)).mode).toBe("assessment");
  });

  it("flags a 13/13 assessment older than half a year as due, but still complete", () => {
    const p = patient(13);
    p.assessment = assessment(13, "2026-03-01");
    expect(assessmentComplete(p)).toBe(true);
    expect(planSlot(visit("follow"), p)).toMatchObject({ mode: "assessment", reassessDue: true });
    expect(planSlot(visit("follow"), patient(13)).reassessDue).toBe(false);
  });
});

describe("planBaseFor", () => {
  it("uses the snapshot, including an explicit null", () => {
    expect(planBaseFor(visit("follow", { planBase: PLAN_V2 }), patient(8))).toEqual(PLAN_V2);
    expect(planBaseFor(visit("follow", { planBase: null }), patient(8, PLAN_V2))).toBeNull();
  });

  it("falls back to the patient's plan for legacy visits", () => {
    expect(planBaseFor(visit("follow"), patient(8, PLAN_V2))).toEqual(PLAN_V2);
    expect(planBaseFor(visit("follow"), patient(8))).toBeNull();
  });

  it("a saved source and snapshot survive a patient.plan change and forms completing later", () => {
    const v = visit("follow", { planBase: null, planSource: "dictation" });
    // 這次確認了口述的計畫（個案計畫變成第 1 版），之後 13 張也填完了。
    const later = patient(13, { ...PLAN_V2, version: 1 });
    expect(planBaseFor(v, later)).toBeNull();
    expect(planSlot(v, later).mode).toBe("dictation");
    const carried = visit("follow", { planBase: PLAN_V2, planSource: "carried" });
    expect(planSlot(carried, patient(13, { ...PLAN_V2, version: 3 })).mode).toBe("carried");
  });
});

describe("planAutoWritable", () => {
  it("is true only for assessment and carried", () => {
    expect(planAutoWritable(visit("first"), patient(13))).toBe(true);
    expect(planAutoWritable(visit("follow"), patient(8, PLAN_V2))).toBe(true);
    expect(planAutoWritable(visit("follow"), patient(8))).toBe(false);
    expect(planAutoWritable(visit("follow", { planSource: "dictation" }), patient(13))).toBe(false);
    expect(planAutoWritable(visit("follow", { planDeferred: { by: "林", at: "x" } }), patient(13))).toBe(false);
  });
});

describe("planCopyable", () => {
  const draft = withDoc(visit("follow"), "plan", "draft");

  it("needs a version that is not being written", () => {
    expect(planCopyable(visit("follow"))).toBe(false);
    expect(planCopyable(draft)).toBe(true);
    expect(planCopyable(withDoc(visit("follow"), "plan", "writing"))).toBe(false);
  });

  it("is blocked by unseen warnings until acknowledged", () => {
    const warned = withDoc(visit("follow"), "plan", "draft", { warnings: ["數字沒有來源"] });
    expect(openWarnings(warned.outputs.plan)).toBe(true);
    expect(planCopyable(warned)).toBe(false);
    expect(planCopyable({ ...warned, outputs: { ...warned.outputs, plan: { ...warned.outputs.plan, warningsAck: true } } })).toBe(true);
  });

  it("is blocked by 〔待核對〕 marks", () => {
    const marked = withDoc(visit("follow"), "plan", "draft", { sections: sections("措施：每 2〔待核對〕 小時翻身。") });
    expect(hasUnverified(marked.outputs.plan)).toBe(true);
    expect(planCopyable(marked)).toBe(false);
  });

  it("is blocked by open assessment changes, except for a dictated plan", () => {
    const changed = { ...draft, analysis: analysisWithChange };
    expect(changesOpen(changed)).toBe(true);
    expect(planCopyable(changed)).toBe(false);
    expect(planCopyable({ ...changed, changesConfirmed: { by: "林", at: "x" } })).toBe(true);
    expect(planCopyable({ ...changed, dismissedChanges: ["c1"] })).toBe(true);
    expect(planCopyable({ ...changed, planSource: "dictation" })).toBe(true);
  });

  it("is never copyable when deferred", () => {
    expect(planCopyable({ ...draft, planDeferred: { by: "林", at: "x" } })).toBe(false);
  });
});

describe("includedKinds and visitComplete", () => {
  const all = withDoc(withDoc(withDoc(visit("follow"), "record", "draft"), "plan", "draft"), "edu", "draft");

  it("lists record, plan, edu in order, leaving out a plan that is not ready", () => {
    expect(includedKinds(all)).toEqual(["record", "plan", "edu"]);
    expect(includedKinds(withDoc(all, "plan", "writing"))).toEqual(["record", "edu"]);
    expect(includedKinds({ ...all, outputs: { ...all.outputs, plan: visit("follow").outputs.plan } })).toEqual(["record", "edu"]);
    expect(includedKinds(withDoc(visit("follow"), "record", "draft"))).toEqual(["record"]);
  });

  const confirmedRecord = withDoc(visit("follow"), "record", "confirmed");

  it("plan none → complete; plan draft → not; deferred → complete", () => {
    expect(visitComplete(confirmedRecord)).toBe(true);
    expect(visitComplete(withDoc(confirmedRecord, "plan", "draft"))).toBe(false);
    expect(visitComplete({ ...withDoc(confirmedRecord, "plan", "draft"), planDeferred: { by: "林", at: "x" } })).toBe(true);
    expect(visitComplete(withDoc(confirmedRecord, "plan", "confirmed"))).toBe(true);
  });

  it("edu none → fine; edu draft → not complete; record draft → not complete", () => {
    expect(visitComplete(withDoc(confirmedRecord, "edu", "draft"))).toBe(false);
    expect(visitComplete(withDoc(confirmedRecord, "edu", "confirmed"))).toBe(true);
    expect(visitComplete(withDoc(visit("follow"), "record", "draft"))).toBe(false);
    expect(visitComplete(visit("follow"))).toBe(false);
  });

  it("a plan or edu whose first version is still being written is not「none」", () => {
    const writing = (v: Visit, kind: DocKind): Visit => ({ ...v, outputs: { ...v.outputs, [kind]: { ...v.outputs[kind], status: "writing", busy: true } } });
    expect(visitComplete(writing(confirmedRecord, "plan"))).toBe(false);
    expect(visitComplete(writing(confirmedRecord, "edu"))).toBe(false);
    // 本次不擬：計畫還在寫也算完成（寫好的那份不採用）
    expect(visitComplete({ ...writing(confirmedRecord, "plan"), planDeferred: { by: "林", at: "x" } })).toBe(true);
  });
});

describe("undeferPatch, autoPlanStale, recoverOutput", () => {
  const deferred = { by: "林", at: "2026-10-03T03:00:00Z" };
  const doneRecord = { ...withDoc(visit("follow"), "record", "confirmed"), status: "done" as const, completedAt: "2026-10-03T04:00:00Z", planDeferred: deferred };

  it("clearing a deferral reopens a done visit only when it is no longer complete", () => {
    expect(undeferPatch(withDoc(doneRecord, "plan", "draft"))).toEqual({ planDeferred: null, status: "review", completedAt: null });
    expect(undeferPatch(doneRecord)).toEqual({ planDeferred: null });
    expect(undeferPatch(withDoc(doneRecord, "plan", "confirmed"))).toEqual({ planDeferred: null });
    expect(undeferPatch(visit("follow"))).toEqual({});
  });

  it("an automatic plan result is stale once the nurse dictated, switched source or deferred", () => {
    expect(autoPlanStale(visit("follow"), "carried")).toBe(false);
    expect(autoPlanStale(visit("follow", { planSource: "carried" }), "carried")).toBe(false);
    expect(autoPlanStale(visit("follow", { planSource: "dictation" }), "carried")).toBe(true);
    expect(autoPlanStale(visit("follow", { planSource: "assessment" }), "carried")).toBe(true);
    expect(autoPlanStale(visit("follow", { planDeferred: deferred }), "assessment")).toBe(true);
  });

  it("an interrupted write goes back to something the nurse can act on", () => {
    const empty = visit("follow").outputs.plan;
    const at = "2026-10-03T05:00:00Z";
    expect(recoverOutput({ ...empty, status: "writing", busy: true }, "plan", at)).toMatchObject({ status: "idle", busy: false, error: null });
    expect(recoverOutput({ ...empty, status: "writing", busy: true }, "record", at)).toMatchObject({ status: "failed", busy: false, error: { code: "interrupted", retryable: true } });
    const drafted = withDoc(visit("follow"), "plan", "writing", {}, { busy: true }).outputs.plan;
    expect(recoverOutput(drafted, "plan", at)).toMatchObject({ status: "draft", busy: false });
    const confirmedBusy = withDoc(visit("follow"), "record", "confirmed", {}, { busy: true }).outputs.record;
    expect(recoverOutput(confirmedBusy, "record", at)).toMatchObject({ status: "confirmed", busy: false });
  });
});

describe("planExcludedReason", () => {
  const p = patient(8);
  const dict = (status: NonNullable<Visit["planDictation"]>["status"]) =>
    visit("follow", { planDictation: { id: "d1", input: "typed", audio: null, text: "口述", provider: "typed", status, error: null, updatedAt: "x", by: "林" } });

  it("is null when the plan is included", () => {
    expect(planExcludedReason(withDoc(visit("follow"), "plan", "draft"), p)).toBeNull();
  });

  it("explains a plan without versions", () => {
    expect(planExcludedReason(visit("follow", { planDeferred: { by: "林", at: "x" } }), p)).toBe("本次不擬計畫");
    expect(planExcludedReason(dict("failed"), p)).toBe("口述沒有整理成功");
    expect(planExcludedReason(dict("review"), p)).toBe("口述待整理");
    expect(planExcludedReason(dict("transcribing"), p)).toBe("護理計畫整理中");
    expect(planExcludedReason(dict("polishing"), p)).toBe("護理計畫整理中");
    const writing = visit("follow");
    writing.outputs.plan = { ...writing.outputs.plan, status: "writing" };
    expect(planExcludedReason(writing, patient(13))).toBe("護理計畫撰寫中");
    const failed = visit("follow");
    failed.outputs.plan = { ...failed.outputs.plan, status: "failed" };
    expect(planExcludedReason(failed, patient(13))).toBe("護理計畫沒有產生成功");
    expect(planExcludedReason(visit("follow"), p)).toBe("護理計畫待口述");
    expect(planExcludedReason(visit("follow"), patient(13))).toBe("護理計畫尚未擬定");
  });

  it("explains a plan with versions in order", () => {
    expect(planExcludedReason(withDoc(visit("follow"), "plan", "writing"), p)).toBe("護理計畫撰寫中");
    expect(planExcludedReason(withDoc(visit("follow"), "plan", "draft", { sections: sections("2〔待核對〕"), warnings: ["w"] }), p)).toBe("護理計畫有〔待核對〕");
    expect(planExcludedReason(withDoc(visit("follow"), "plan", "draft", { warnings: ["w"] }), p)).toBe("護理計畫的提醒還沒看");
    expect(planExcludedReason({ ...withDoc(visit("follow"), "plan", "draft"), analysis: analysisWithChange }, p)).toBe("評估異動還沒確認");
  });
});

describe("planBadge", () => {
  const done = (v: Visit): Visit => ({ ...v, status: "done" });

  it("marks done visits without a confirmed plan", () => {
    expect(planBadge(done(withDoc(visit("follow"), "record", "confirmed")))).toBe("未擬計畫");
    expect(planBadge(done({ ...withDoc(visit("follow"), "plan", "draft"), planDeferred: { by: "林", at: "x" } }))).toBe("本次不擬計畫");
    expect(planBadge(done(withDoc(visit("follow"), "plan", "confirmed")))).toBeNull();
    expect(planBadge(withDoc(visit("follow"), "record", "confirmed"))).toBeNull();
  });
});
