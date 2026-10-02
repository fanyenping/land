import { Pencil } from "lucide-react";
import { VITAL_LABEL, VITAL_UNIT, type VitalKey } from "../../shared/types";
import { cx } from "../components/ui";
import type { Visit } from "../lib/model";
import { VITAL_ORDER, clinicalFlag, readingOf } from "../lib/vitals";
import { useSettings } from "../lib/hooks";

/** 數值格：參考圖的巨型數字方塊。點一下就能改（手動值永遠勝過語音）。 */
export function VitalsGrid({ visit, onEdit }: { visit: Visit; onEdit: (key: VitalKey | null) => void }) {
  const settings = useSettings();
  const order = VITAL_ORDER[settings.vitalsOrder];
  const keys = order.filter((k) => visit.vitals[k] || readingOf(visit, k));
  const missing = visit.analysis?.missingDomains ?? [];

  return (
    <section id="sec-vitals" aria-label="生命徵象" className="scroll-mt-32">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-round text-[1.25rem] font-extrabold">生命徵象</h2>
        <button type="button" onClick={() => onEdit(null)} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 font-bold hover:bg-ink/5">
          <Pencil size={17} />
          數值速記
        </button>
      </div>
      {keys.length === 0 ? (
        <button type="button" onClick={() => onEdit(null)} className="w-full rounded-[22px] bg-card p-4 text-left font-bold text-ink-soft outline-ink">
          {visit.intakeOnly ? "這筆只有文件，沒有今日量測值" : "這次沒有提到生命徵象・點這裡補上"}
        </button>
      ) : (
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          {keys.map((k) => {
            const v = visit.vitals[k];
            const r = readingOf(visit, k);
            const pending = !v || (!v.confirmed && v.by === "ai");
            const value = v ? v.value : r?.value;
            const flag = value ? clinicalFlag(k, value, v?.qualifier ?? r?.qualifier ?? null) : null;
            const unit = VITAL_UNIT[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => onEdit(k)}
                className={cx(
                  "relative flex min-h-[104px] flex-col items-start justify-between rounded-[22px] p-3.5 text-left outline-ink transition-transform active:scale-[0.98]",
                  pending ? "bg-pending-tint" : "bg-card",
                  k === "consciousness" && "col-span-2 sm:col-span-3 min-h-[84px]",
                )}
              >
                <span className="flex w-full min-w-0 items-center gap-1.5 text-[0.95rem] font-bold">
                  <span className="shrink-0">{VITAL_LABEL[k]}</span>
                  {(v?.qualifier ?? r?.qualifier) && <span className="min-w-0 truncate font-medium text-ink-soft">{v?.qualifier ?? r?.qualifier}</span>}
                  {flag && value !== null && <span className="rounded-full bg-danger-tint px-2 py-0.5 text-[0.78rem] font-extrabold text-danger">{flag === "high" ? "偏高" : "偏低"}</span>}
                  <span className="ml-auto shrink-0 text-[0.8rem] font-bold text-ink-soft">{pending ? "待確認" : v?.by === "nurse" ? "手動" : "有原句"}</span>
                </span>
                {value === null ? (
                  <span className="text-[1.1rem] font-bold text-ink-soft">本次未測</span>
                ) : k === "consciousness" ? (
                  <span className="text-[1.1rem] font-bold leading-snug">{value}</span>
                ) : (
                  <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
                    <span className={cx("num font-extrabold leading-none", (value ?? "").length > 5 ? "text-[1.7rem]" : "text-[2.1rem]", pending && "mark-pending")}>{value}</span>
                    <span className="text-[0.85rem] font-bold text-ink-soft">{unit}</span>
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {missing.length > 0 && <p className="mt-2 text-[0.95rem] text-ink-soft">本次未提及：{missing.join("、")}</p>}
    </section>
  );
}
