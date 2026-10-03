import { useState } from "react";
import { useNavigate } from "react-router";
import { Check, KeyRound, RefreshCw } from "lucide-react";
import { Critter } from "../components/Critter";
import { Button, Spinner, cx } from "../components/ui";
import { probeEngine } from "../lib/api";
import { TRIAL } from "../lib/env";
import { useNow } from "../lib/hooks";
import { STAGE_LABEL, type Stage, type Visit } from "../lib/model";
import { processVisit } from "../lib/pipeline";

const STAGES: Stage[] = ["upload", "transcribe", "analyze", "write"];
// 試用版不上傳、也不真的轉文字。
const LABEL: Record<Stage, string> = TRIAL ? { ...STAGE_LABEL, upload: "讀取檔案", transcribe: "示範逐字稿" } : STAGE_LABEL;

/** 處理中：四步驟文字進度，永遠看得到在做什麼（不只轉圈圈）。 */
export function Progress({ visit }: { visit: Visit }) {
  const now = useNow(1000);
  const navigate = useNavigate();
  const [retrying, setRetrying] = useState(false);
  const retryNow = async () => {
    setRetrying(true);
    await probeEngine(true);
    await processVisit(visit.id);
    setRetrying(false);
  };
  const stages = visit.parts.length ? STAGES : STAGES.filter((s) => s === "analyze" || s === "write");
  const currentIndex = visit.stage ? stages.indexOf(visit.stage) : visit.status === "waiting" ? 0 : -1;
  const slow = visit.stageStartedAt && now.getTime() - Date.parse(visit.stageStartedAt) > 60_000;

  if (visit.status === "failed") {
    return (
      <section className="rounded-[28px] bg-danger-tint p-5 outline-ink">
        <div className="mb-3 flex items-center gap-3">
          <Critter kind="error" size={52} />
          <div>
            <h2 className="font-round text-[1.3rem] font-extrabold">{visit.error?.stage && visit.error.stage in LABEL ? `${LABEL[visit.error.stage as Stage]}沒有成功` : "沒有完成"}</h2>
            <p className="font-bold">{visit.error?.message ?? "請再試一次。"}</p>
          </div>
        </div>
        <p className="mb-3 text-[0.95rem] text-ink-soft">資料仍在本機・代碼：{visit.error?.code ?? "unknown"}</p>
        {visit.error?.code === "unauthorized" ? (
          <div className="grid gap-2.5 sm:grid-cols-2">
            <Button variant="primary" size="lg" block icon={<KeyRound size={20} />} onClick={() => navigate("/settings")}>
              到設定輸入通行碼
            </Button>
            <Button size="lg" block icon={<RefreshCw size={20} />} onClick={() => void processVisit(visit.id)}>
              重試
            </Button>
          </div>
        ) : (
          <Button variant="primary" size="lg" block icon={<RefreshCw size={20} />} onClick={() => void processVisit(visit.id)}>
            重試
          </Button>
        )}
      </section>
    );
  }

  return (
    <section aria-live="polite" className="rounded-[28px] bg-night p-5 text-night-ink md:p-6">
      <div className="mb-4 flex items-center gap-3">
        <Critter kind={visit.status === "waiting" ? "offline" : "processing"} size={56} animate={visit.status === "processing"} />
        <div>
          <h2 className="font-round text-[1.4rem] font-extrabold">
            {visit.status === "waiting" ? (navigator.onLine ? "連不上伺服器" : "等網路，連上後自動繼續") : "整理中"}
          </h2>
          <p className="font-bold opacity-75">
            {visit.status === "waiting" ? (navigator.onLine ? "恢復後自動繼續，資料已存在本機" : "資料已存在本機") : slow ? "比平常慢，可先離開，好了會出現在今日清單" : "可以先收東西，好了會出現在這裡。"}
          </p>
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
              {LABEL[s]}
            </li>
          );
        })}
      </ol>
      {visit.status === "waiting" && (
        <Button className="mt-4" icon={retrying ? <Spinner size={16} /> : <RefreshCw size={18} />} disabled={retrying} onClick={() => void retryNow()}>
          立即重試
        </Button>
      )}
    </section>
  );
}
