import { useState } from "react";
import { VITAL_LABEL, VITAL_UNIT, type VitalKey } from "../../shared/types";
import { setVital } from "../lib/actions";
import type { Visit } from "../lib/model";
import { VITAL_ORDER, plausible } from "../lib/vitals";
import { useSettings } from "../lib/hooks";
import { Sheet } from "./Sheet";
import { Button, Chip, cx } from "./ui";

const CONSCIOUS_CHIPS = ["清醒", "可喚醒", "嗜睡", "混亂", "昏迷"];
const SPO2_CHIPS = ["室內空氣", "氧氣 2L", "氧氣 3L", "拍痰後"];
const GLU_CHIPS = ["飯前", "飯後", "隨機"];

interface Draft {
  value: string;
  qualifier: string;
}

function initial(visit: Visit, key: VitalKey): Draft {
  const v = visit.vitals[key];
  return {
    value: v?.value ?? visit.typedVitals[key] ?? "",
    qualifier: v?.qualifier ?? visit.typedQualifiers[key] ?? "",
  };
}

/** 數值速記：只填量到的幾項，其餘交給語音。手動值永遠勝過語音。 */
export function VitalsSheet({ visit, open, onClose, focus }: { visit: Visit; open: boolean; onClose: () => void; focus?: VitalKey | null }) {
  return (
    <Sheet open={open} onClose={onClose} title="數值速記">
      {open && <VitalsForm visit={visit} onDone={onClose} focus={focus ?? null} />}
    </Sheet>
  );
}

function VitalsForm({ visit, onDone, focus }: { visit: Visit; onDone: () => void; focus: VitalKey | null }) {
  const settings = useSettings();
  const order = VITAL_ORDER[settings.vitalsOrder];
  const [draft, setDraft] = useState<Record<VitalKey, Draft>>(() => Object.fromEntries(order.map((k) => [k, initial(visit, k)])) as Record<VitalKey, Draft>);
  const [bp, setBp] = useState(() => {
    const [s, d] = (draft.bp.value || "").split("/");
    return { s: s ?? "", d: d ?? "" };
  });

  const set = (k: VitalKey, patch: Partial<Draft>) => setDraft((d) => ({ ...d, [k]: { ...d[k], ...patch } }));

  const save = async () => {
    const values = { ...draft, bp: { ...draft.bp, value: bp.s && bp.d ? `${bp.s}/${bp.d}` : "" } };
    for (const k of order) {
      const before = initial(visit, k);
      const now = values[k];
      if (now.value.trim() === before.value && now.qualifier === before.qualifier) continue;
      if (!now.value.trim() && !before.value) continue;
      await setVital(visit.id, k, now.value.trim() || null, now.qualifier || null);
    }
    onDone();
  };

  return (
    <div className="flex flex-col gap-3 pb-2">
      {order.map((k) => {
        const d = draft[k];
        const bad = k !== "bp" && d.value && !plausible(k, d.value);
        return (
          <div key={k} className={cx("rounded-[22px] bg-card p-3.5 outline-ink", focus === k && "shadow-[inset_0_0_0_3px_var(--pending)]")}>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[1.05rem] font-extrabold">{VITAL_LABEL[k]}</span>
              <span className="text-[0.9rem] font-bold text-ink-soft">{VITAL_UNIT[k]}</span>
            </div>
            {k === "bp" ? (
              <div className="flex items-center gap-2">
                <NumInput label="收縮壓" value={bp.s} onChange={(s) => setBp((b) => ({ ...b, s }))} autoFocus={focus === "bp"} />
                <span className="num text-[2rem] font-bold text-ink-soft">/</span>
                <NumInput label="舒張壓" value={bp.d} onChange={(dd) => setBp((b) => ({ ...b, d: dd }))} />
              </div>
            ) : k === "consciousness" ? (
              <div className="flex flex-col gap-2">
                <input
                  value={d.value}
                  onChange={(e) => set(k, { value: e.target.value })}
                  placeholder="例如：可喚醒，點頭回應"
                  autoFocus={focus === k}
                  className="min-h-[56px] w-full rounded-2xl bg-sunken px-4 text-[1.15rem] font-bold outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]"
                />
                <div className="flex flex-wrap gap-2">
                  {CONSCIOUS_CHIPS.map((c) => (
                    <Chip key={c} active={d.value === c} onClick={() => set(k, { value: c })}>
                      {c}
                    </Chip>
                  ))}
                </div>
              </div>
            ) : (
              <NumInput label={VITAL_LABEL[k]} value={d.value} onChange={(value) => set(k, { value })} autoFocus={focus === k} decimal={k === "temp"} />
            )}
            {bad && <p className="mt-2 text-[0.92rem] font-bold text-danger">這個數值不在一般範圍內，請再確認一次。</p>}
            {(k === "spo2" || k === "glucose") && (
              <div className="mt-2 flex flex-wrap gap-2">
                {(k === "spo2" ? SPO2_CHIPS : GLU_CHIPS).map((c) => (
                  <Chip key={c} active={d.qualifier === c} onClick={() => set(k, { qualifier: d.qualifier === c ? "" : c })}>
                    {c}
                  </Chip>
                ))}
              </div>
            )}
          </div>
        );
      })}
      <Button variant="primary" size="xl" block onClick={save} className="mt-1">
        好
      </Button>
    </div>
  );
}

function NumInput({ label, value, onChange, autoFocus, decimal }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; decimal?: boolean }) {
  return (
    <input
      aria-label={label}
      inputMode={decimal ? "decimal" : "numeric"}
      value={value}
      autoFocus={autoFocus}
      placeholder="—"
      onChange={(e) => onChange(e.target.value.replace(decimal ? /[^\d.]/g : /\D/g, "").slice(0, decimal ? 4 : 3))}
      className="num min-h-[68px] w-full min-w-0 rounded-2xl bg-sunken px-4 text-center text-[2.2rem] font-extrabold outline-none placeholder:text-ink-faint focus:shadow-[inset_0_0_0_3px_var(--ink)]"
    />
  );
}
