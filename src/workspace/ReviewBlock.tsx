import { useState } from "react";
import { Play } from "lucide-react";
import { VITAL_LABEL, VITAL_UNIT, type VitalReading } from "../../shared/types";
import { Critter } from "../components/Critter";
import { Name } from "../components/Name";
import { Button, Pill, cx } from "../components/ui";
import { useFlows } from "../app/Flows";
import { useToast } from "../components/Toast";
import { confirmChanges, confirmDocs, confirmIdentity, dismissChange, moveVisit, openChanges, setVital } from "../lib/actions";
import { canPlaySource, playAt } from "../lib/audio";
import { clock, duration } from "../lib/format";
import type { Patient, Visit } from "../lib/model";
import { pendingVitals } from "../lib/vitals";

const CHANGE_LABEL = { new: "新", worse: "加重", better: "改善", resolved: "緩解" } as const;

/** 先看這裡：全 App 唯一的關卡（身分、待確認數值、文件重點、評估異動）。 */
export function ReviewBlock({ visit, patient, onEditVital }: { visit: Visit; patient: Patient; onEditVital: (key: VitalReading["key"]) => void }) {
  const flows = useFlows();
  const toast = useToast();
  const a = visit.analysis;
  if (!a) return null;

  const vitals = pendingVitals(visit);
  const unclear = a.docFacts.filter((f) => f.unclear);
  const changes = openChanges(visit);
  const identity = a.identityConcern && !visit.identityConfirmed;
  const needDocs = unclear.length > 0 && !visit.docsChecked;
  const needChanges = changes.length > 0 && !visit.changesConfirmed;
  const count = (identity ? 1 : 0) + vitals.length + (needDocs ? 1 : 0) + (needChanges ? 1 : 0);

  if (count === 0) {
    const who = visit.changesConfirmed?.by ?? visit.reviewedBy;
    const when = visit.changesConfirmed?.at ?? visit.reviewedAt;
    return (
      <div id="sec-check" className="flex items-center gap-3 rounded-[24px] bg-ok-tint px-4 py-3 font-bold text-ok">
        <Critter kind="done" size={34} />
        <span>{who ? `已核對・${who} ${clock(when)}` : "沒有需要確認的項目"}</span>
      </div>
    );
  }

  return (
    <section id="sec-check" aria-label="先看這裡" className="scroll-mt-32 rounded-[28px] bg-pending-tint p-4 outline-ink md:p-5">
      <h2 className="mb-3 flex items-center gap-2 font-round text-[1.35rem] font-extrabold">
        <Critter kind="pending" size={38} />
        先看這裡
        <Pill tone="pending" className="outline-ink">
          {count} 件要處理
        </Pill>
      </h2>
      <div className="flex flex-col gap-3">
        {identity && (
          <Item>
            <p className="font-bold">{a.identityConcern}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button variant="primary" onClick={() => confirmIdentity(visit.id)}>
                是 <Name name={patient.name} />
              </Button>
              <Button
                onClick={() =>
                  flows.findPatient(
                    "改到哪一位？",
                    async (p) => {
                      const undo = await moveVisit(visit.id, p.id);
                      await confirmIdentity(visit.id);
                      toast("已改到其他個案", undo ? { action: { label: "復原", run: () => void undo() } } : undefined);
                    },
                    patient.id,
                  )
                }
              >
                改到其他個案
              </Button>
            </div>
          </Item>
        )}

        {vitals.map((r) => (
          <VitalItem key={r.key} visit={visit} r={r} onEdit={() => onEditVital(r.key)} />
        ))}

        {needDocs && (
          <Item>
            <p className="font-bold">文件中有 {unclear.length} 項字跡不清或不確定，不會寫入輸出：</p>
            <ul className="mt-2 flex flex-col gap-1.5">
              {unclear.map((f) => (
                <li key={f.id} className="text-[1rem]">
                  <span className="mark-pending font-bold">{f.category}</span> {f.text}
                  {f.page ? <span className="text-ink-soft">（第 {f.page} 頁）</span> : null}
                </li>
              ))}
            </ul>
            <Button variant="primary" className="mt-3" onClick={() => confirmDocs(visit.id)}>
              文件重點已對照
            </Button>
          </Item>
        )}

        {needChanges && (
          <Item>
            <p className="font-bold">評估異動 {changes.length} 項{visit.analysis && patientLastDate(patient) ? `（與 ${patientLastDate(patient)} 相比）` : ""}</p>
            <ul className="mt-2 flex flex-col gap-2">
              {changes.map((c) => (
                <li key={c.id} className="flex items-start gap-2">
                  <Pill tone={c.kind === "better" || c.kind === "resolved" ? "plan" : "record"} className="mt-0.5 shrink-0">
                    {CHANGE_LABEL[c.kind]}
                  </Pill>
                  <span className="min-w-0 flex-1 text-[1rem]">
                    {c.text}
                    {c.evidence && <span className="block text-[0.9rem] text-ink-soft">「{c.evidence}」</span>}
                  </span>
                  <button type="button" onClick={() => dismissChange(visit.id, c.id)} className="min-h-[40px] shrink-0 rounded-full px-3 text-[0.9rem] font-bold text-ink-soft hover:bg-ink/5">
                    不是異動
                  </button>
                </li>
              ))}
            </ul>
            <Button variant="primary" className="mt-3" onClick={() => confirmChanges(visit.id)}>
              異動已確認
            </Button>
          </Item>
        )}
      </div>
    </section>
  );
}

function patientLastDate(p: Patient) {
  return p.last ? p.last.date.slice(5).replace("-", "/") : null;
}

function Item({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[22px] bg-card p-4 outline-ink">{children}</div>;
}

function VitalItem({ visit, r, onEdit }: { visit: Visit; r: VitalReading; onEdit: () => void }) {
  const [playing, setPlaying] = useState(false);
  const unit = VITAL_UNIT[r.key];
  const playable = canPlaySource(visit) && r.sourceMs !== null;
  return (
    <Item>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[1.1rem] font-extrabold">
        <span>{VITAL_LABEL[r.key]}</span>
        <span className="num mark-pending text-[1.6rem]">
          {r.value}
          {unit === "%" || unit === "℃" ? unit : ""}
        </span>
        <span className="text-[1rem] font-bold text-ink-soft">{r.status === "implausible" ? "可能聽錯" : r.status === "conflict" ? "前後不一致" : "不太確定"}</span>
      </p>
      {r.reason && <p className="mt-0.5 text-[0.95rem] text-ink-soft">{r.reason}</p>}
      {r.sourceQuote && (
        <p className="mt-2 flex items-center gap-2 rounded-2xl bg-sunken px-3 py-2 text-[1rem]">
          <span className="min-w-0 flex-1">「{r.sourceQuote}」</span>
          {r.sourceMs !== null && <span className="num shrink-0 text-[0.85rem] text-ink-soft">{duration(r.sourceMs)}</span>}
          {playable && (
            <button
              type="button"
              aria-label="播放原音"
              onClick={async () => {
                setPlaying(true);
                await playAt(visit, r.sourceMs!);
                setTimeout(() => setPlaying(false), 6000);
              }}
              className={cx("grid h-10 w-10 shrink-0 place-items-center rounded-full bg-ink text-paper", playing && "animate-pulse")}
            >
              <Play size={16} fill="currentColor" />
            </button>
          )}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {r.suggestion && (
          <Button variant="primary" onClick={() => setVital(visit.id, r.key, r.suggestion, r.qualifier)}>
            改成 {r.suggestion}
          </Button>
        )}
        {!r.suggestion && r.status !== "implausible" && (
          <Button variant="primary" onClick={() => setVital(visit.id, r.key, r.value, r.qualifier)}>
            {r.value} 沒錯
          </Button>
        )}
        <Button onClick={onEdit}>自己輸入</Button>
        <Button variant="soft" onClick={() => setVital(visit.id, r.key, null, null)}>
          本次未測
        </Button>
      </div>
    </Item>
  );
}
