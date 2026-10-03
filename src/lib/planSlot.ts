import { ASSESSMENT_FORMS, completedCount, nextAssessmentDue } from "../assessment/forms";
import { UNVERIFIED_MARK } from "../../shared/planPolish";
import type { DocKind } from "../../shared/types";
import type { OutputState, Patient, Visit } from "./model";

/**
 * 護理計畫欄位的規則（純函式）：計畫從哪裡來、能不能自動擬、能不能一起複製、算不算完成。
 * 護理紀錄（本次病摘）永遠不等計畫。
 */

export type PlanMode = "assessment" | "carried" | "dictation" | "awaiting" | "deferred";

/** 13 張全人評估都填過（過了半年仍算完成，只提醒要重新評估）。 */
export function assessmentComplete(p: Patient): boolean {
  return completedCount(p.assessment) >= ASSESSMENT_FORMS.length;
}

/** 這次訪視前生效的計畫：有快照用快照，舊資料用個案目前的計畫。 */
export function planBaseFor(v: Visit, p: Patient): Patient["plan"] {
  return v.planBase !== undefined ? v.planBase : (p.plan ?? null);
}

function modeOf(v: Visit, p: Patient, complete: boolean): PlanMode {
  if (v.planDeferred) return "deferred";
  if (v.planSource) return v.planSource;
  const base = planBaseFor(v, p);
  // 舊資料：已經有計畫但沒記來源。
  if (v.outputs.plan.versions.length) return base ? "carried" : "assessment";
  if (complete) return !base || (v.kind ?? "follow") === "first" ? "assessment" : "carried";
  return base ? "carried" : "awaiting";
}

/** 計畫欄位現在的模式與全人評估進度；reassessDue：13/13 但已超過半年該重新評估。 */
export function planSlot(v: Visit, p: Patient): { mode: PlanMode; done: number; total: number; reassessDue: boolean } {
  const done = completedCount(p.assessment);
  const total = ASSESSMENT_FORMS.length;
  const complete = done >= total;
  const due = complete ? nextAssessmentDue(p.assessment) : null;
  return { mode: modeOf(v, p, complete), done, total, reassessDue: !!due && due <= v.date };
}

/** 系統可以自動擬計畫（依全人評估或沿用現行計畫）；待口述、口述、本次不擬都不自動寫。 */
export function planAutoWritable(v: Visit, p: Patient): boolean {
  const mode = planSlot(v, p).mode;
  return mode === "assessment" || mode === "carried";
}

/** 評估異動還沒看完也沒確認（只擋依分析寫的計畫）。 */
export function changesOpen(v: Visit): boolean {
  return (v.analysis?.changes ?? []).some((c) => !v.dismissedChanges.includes(c.id)) && !v.changesConfirmed;
}

/** 目前版本的檢核提醒還沒看過。 */
export function openWarnings(out: OutputState): boolean {
  return !!out.versions[out.current]?.warnings?.length && !out.warningsAck;
}

/** 目前版本還有〔待核對〕（口述沒說過的數字、英文、量表用語）。 */
export function hasUnverified(out: OutputState): boolean {
  return (out.versions[out.current]?.sections ?? []).some((s) => s.heading.includes(UNVERIFIED_MARK) || s.body.includes(UNVERIFIED_MARK));
}

/** 計畫可以一起確認、複製、導出。 */
export function planCopyable(v: Visit): boolean {
  const out = v.outputs.plan;
  return out.versions.length > 0 && out.status !== "writing" && !openWarnings(out) && !hasUnverified(out) && !v.planDeferred && (v.planSource === "dictation" || !changesOpen(v));
}

/** 「全部確認並複製」與導出包含的文件（依紀錄、計畫、衛教的順序）。 */
export function includedKinds(v: Visit): DocKind[] {
  const kinds: DocKind[] = [];
  if (v.outputs.record.versions.length) kinds.push("record");
  if (planCopyable(v)) kinds.push("plan");
  if (v.outputs.edu.versions.length) kinds.push("edu");
  return kinds;
}

/** 這次訪視完成：紀錄已確認；衛教沒有或已確認；計畫沒有、已確認或本次不擬。 */
export function visitComplete(v: Visit): boolean {
  const { record, plan, edu } = v.outputs;
  return record.status === "confirmed" && (edu.versions.length === 0 || edu.status === "confirmed") && (plan.versions.length === 0 || plan.status === "confirmed" || !!v.planDeferred);
}

/** 計畫這次不含在全部複製／導出的原因；包含時為 null。 */
export function planExcludedReason(v: Visit, p: Patient): string | null {
  if (planCopyable(v)) return null;
  if (v.planDeferred) return "本次不擬計畫";
  const out = v.outputs.plan;
  if (!out.versions.length) {
    const d = v.planDictation;
    if (d?.status === "failed") return "口述沒有整理成功";
    if (d?.status === "review") return "口述待整理";
    if (d?.status === "transcribing" || d?.status === "polishing") return "護理計畫整理中";
    if (out.status === "writing") return "護理計畫撰寫中";
    if (out.status === "failed") return "護理計畫沒有產生成功";
    if (planSlot(v, p).mode === "awaiting") return "護理計畫待口述";
    return "護理計畫尚未擬定";
  }
  if (out.status === "writing") return "護理計畫撰寫中";
  if (hasUnverified(out)) return "護理計畫有〔待核對〕";
  if (openWarnings(out)) return "護理計畫的提醒還沒看";
  if (changesOpen(v)) return "評估異動還沒確認";
  return null;
}

/** 已完成的訪視沒有確認計畫時的標示。 */
export function planBadge(v: Visit): "未擬計畫" | "本次不擬計畫" | null {
  if (v.status !== "done") return null;
  if (v.planDeferred) return "本次不擬計畫";
  if (v.outputs.plan.status !== "confirmed") return "未擬計畫";
  return null;
}
