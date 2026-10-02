import { Check, RefreshCw } from "lucide-react";
import { Critter } from "../components/Critter";
import { Button, cx } from "../components/ui";
import { useNow } from "../lib/hooks";
import { STAGE_LABEL, type Stage, type Visit } from "../lib/model";
import { processVisit } from "../lib/pipeline";

const STAGES: Stage[] = ["upload", "transcribe", "analyze", "write"];

/** 處理中：四步驟文字進度，永遠看得到在做什麼（不只轉圈圈）。 */
export function Progress({ visit }: { visit: Visit }) {
  const now = useNow(1000);
  const stages = visit.parts.length ? STAGES : STAGES.filter((s) => s === "analyze" || s === "write");
  const currentIndex = visit.stage ? stages.indexOf(visit.stage) : visit.status === "waiting" ? 0 : -1;
  const slow = visit.stageStartedAt && now.getTime() - Date.parse(visit.stageStartedAt) > 60_000;

  if (visit.status === "failed") {
    return (
      <section className="rounded-[28px] bg-danger-tint p-5 outline-ink">
        <div className="mb-3 flex items-center gap-3">
          <Critter kind="error" size={52} />
          <div>
            <h2 className="font-round text-[1.3rem] font-extrabold">{visit.error?.stage && visit.error.stage in STAGE_LABEL ? `${STAGE_LABEL[visit.error.stage as Stage]}沒有成功` : "沒有完成"}</h2>
            <p className="font-bold">{visit.error?.message ?? "請再試一次。"}</p>
          </div>
        </div>
        <p className="mb-3 text-[0.95rem] text-ink-soft">錄音與文件都還在這台裝置。代碼：{visit.error?.code ?? "unknown"}</p>
        <Button variant="primary" size="lg" block icon={<RefreshCw size={20} />} onClick={() => void processVisit(visit.id)}>
          重試
        </Button>
      </section>
    );
  }

  return (
    <section aria-live="polite" className="rounded-[28px] bg-night p-5 text-night-ink md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <Critter kind={visit.status === "waiting" ? "offline" : "processing"} size={56} animate={visit.status === "processing"} />
        <div>
          <h2 className="font-round text-[1.4rem] font-extrabold">{visit.status === "waiting" ? "等網路，連上後自動繼續" : "整理中"}</h2>
          <p className="font-bold opacity-75">{visit.status === "waiting" ? "錄音已安全存在這台裝置。" : slow ? "比平常慢，仍在處理中。可以先離開，好了會出現在今日清單。" : "可以先收東西，好了會出現在這裡。"}</p>
        </div>
      </div>
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {stages.map((s, i) => {
          const done = currentIndex > i;
          const active = currentIndex === i && visit.status === "processing";
          return (
            <li
              key={s}
              className={cx(
                "flex min-h-[52px] items-center gap-2 rounded-full px-3 font-bold",
                done ? "bg-[#00b36b] text-[#141414]" : active ? "bg-pending text-[#141414]" : "bg-white/10",
              )}
            >
              <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-full", done ? "bg-[#141414] text-white" : "bg-black/15")}>
                {done ? <Check size={16} strokeWidth={3} /> : <span className="num text-[0.85rem]">{i + 1}</span>}
              </span>
              {STAGE_LABEL[s]}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
