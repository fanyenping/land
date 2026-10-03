import type { CritterKind } from "../components/Critter";
import type { Tone } from "../components/ui";
import { blockersFor } from "./actions";
import { STAGE_LABEL, type Visit } from "./model";

export interface StatusInfo {
  label: string;
  tone: Tone;
  critter: CritterKind;
}

export function visitStatus(v: Visit): StatusInfo {
  switch (v.status) {
    case "scheduled":
      return { label: "排定", tone: "muted", critter: "empty" };
    case "recording":
      return { label: "錄音中", tone: "audio", critter: "audio" };
    case "paused":
      return { label: "已暫停", tone: "audio", critter: "audio" };
    case "interrupted":
      return { label: "錄音中斷・已保存", tone: "pending", critter: "pending" };
    case "waiting":
      return { label: "等網路", tone: "muted", critter: "offline" };
    case "processing":
      return { label: v.stage ? `${STAGE_LABEL[v.stage]}中` : "處理中", tone: "edu", critter: "processing" };
    case "review": {
      const n = pendingCount(v);
      if (n > 0) return { label: `待確認 ${n}`, tone: "pending", critter: "pending" };
      // 紀錄（與衛教）都確認了，只剩計畫草稿還沒確認。
      const { record, plan, edu } = v.outputs;
      if (record.status === "confirmed" && (!edu.versions.length || edu.status === "confirmed") && plan.versions.length > 0 && plan.status !== "confirmed" && !v.planDeferred) {
        return { label: "計畫待確認", tone: "pending", critter: "pending" };
      }
      return { label: "可複製", tone: "plan", critter: "done" };
    }
    case "done":
      return { label: "已完成", tone: "ok", critter: "done" };
    case "failed":
      return { label: "需處理", tone: "danger", critter: "error" };
  }
}

/** 先看這裡還有幾件（數值、身分、文件、評估異動）。 */
export function pendingCount(v: Visit): number {
  return blockersFor(v, "all").length;
}

export function isOpen(v: Visit) {
  return v.status !== "done";
}
