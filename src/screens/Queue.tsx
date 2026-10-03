import { useEffect, useMemo } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ChevronRight } from "lucide-react";
import { Critter } from "../components/Critter";
import { Name } from "../components/Name";
import { Pill, cx } from "../components/ui";
import { shortDate, todayStr } from "../lib/format";
import { useAllVisits, useMedia, usePatients } from "../lib/hooks";
import type { Patient, Visit } from "../lib/model";
import { visitStatus } from "../lib/status";
import { Workspace } from "./Workspace";

const GROUPS: { key: string; title: string; match: (v: Visit) => boolean }[] = [
  { key: "failed", title: "需處理", match: (v) => v.status === "failed" || v.status === "interrupted" },
  { key: "review", title: "待確認", match: (v) => v.status === "review" },
  { key: "processing", title: "處理中", match: (v) => v.status === "processing" || v.status === "recording" || v.status === "paused" },
  { key: "waiting", title: "等網路", match: (v) => v.status === "waiting" },
];

/** 記錄：所有還沒完成的紀錄。電腦版左清單右工作台，J／K 換人。 */
export function Queue() {
  const { id } = useParams();
  const navigate = useNavigate();
  const desktop = useMedia("(min-width: 1024px)");
  const visits = useAllVisits();
  const patients = usePatients();
  const byId = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p])), [patients]);

  const open = useMemo(
    () => (visits ?? []).filter((v) => GROUPS.some((g) => g.match(v))).sort((a, b) => (a.date + (a.time ?? "")).localeCompare(b.date + (b.time ?? ""))),
    [visits],
  );
  const recent = useMemo(
    () =>
      (visits ?? [])
        .filter((v) => v.status === "done")
        .sort((a, b) => (b.completedAt ?? "").localeCompare(a.completedAt ?? ""))
        .slice(0, 12),
    [visits],
  );
  const ordered = useMemo(() => GROUPS.flatMap((g) => open.filter(g.match)), [open]);
  const selected = id ?? (desktop ? ordered[0]?.id : undefined);

  useEffect(() => {
    if (!desktop) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key !== "j" && e.key !== "k" && e.key !== "J" && e.key !== "K") return;
      const list = [...ordered, ...recent];
      const i = list.findIndex((v) => v.id === selected);
      const next = list[e.key.toLowerCase() === "j" ? i + 1 : i - 1];
      if (next) navigate(`/queue/${next.id}`, { replace: true });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, ordered, recent, selected, navigate]);

  if (!visits || !patients) return null;

  const list = (
    <div className="flex flex-col gap-5">
      {ordered.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-[30px] bg-card px-6 py-10 text-center outline-ink">
          <Critter kind="done" size={84} />
          <p className="font-round text-[1.4rem] font-extrabold">都記錄完了</p>
        </div>
      )}
      {GROUPS.map((g) => {
        const items = open.filter(g.match);
        if (!items.length) return null;
        return (
          <section key={g.key}>
            <h2 className="mb-2 flex items-center gap-2 font-round text-[1.2rem] font-extrabold">
              {g.title}
              <Pill tone="ink">{items.length}</Pill>
            </h2>
            <div className="flex flex-col gap-2">
              {items.map((v) => (
                <Row key={v.id} visit={v} patient={byId.get(v.patientId)} active={v.id === selected && desktop} />
              ))}
            </div>
          </section>
        );
      })}
      {recent.length > 0 && (
        <section>
          <h2 className="mb-2 font-round text-[1.2rem] font-extrabold text-ink-soft">最近完成</h2>
          <div className="flex flex-col gap-2">
            {recent.map((v) => (
              <Row key={v.id} visit={v} patient={byId.get(v.patientId)} active={v.id === selected && desktop} />
            ))}
          </div>
        </section>
      )}
    </div>
  );

  return (
    <div className={cx("mx-auto w-full px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 lg:pt-8", desktop ? "max-w-none" : "max-w-[760px]")}>
      <header className="mb-5 flex items-end gap-3">
        <h1 className="font-round text-[2.6rem] font-extrabold leading-none">記錄</h1>
        <Pill tone="pending" className="mb-1 outline-ink">
          {ordered.length} 筆未完成
        </Pill>
      </header>
      {desktop ? (
        <div className="grid grid-cols-[320px_minmax(0,1fr)] items-start gap-5">
          <div className="sticky top-6 max-h-[calc(100dvh-120px)] overflow-y-auto pb-4 pr-1">{list}</div>
          <div className="min-w-0 rounded-[30px] bg-paper/60 outline-ink">
            {selected ? (
              <Workspace key={selected} visitId={selected} embedded />
            ) : (
              <div className="grid min-h-[50dvh] place-items-center p-8 text-center">
                <div className="flex flex-col items-center gap-3">
                  <Critter kind="empty" size={80} />
                  <p className="font-bold text-ink-soft">從左邊選一筆紀錄</p>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
        list
      )}
    </div>
  );
}

function Row({ visit, patient, active }: { visit: Visit; patient?: Patient; active: boolean }) {
  const desktop = useMedia("(min-width: 1024px)");
  const st = visitStatus(visit);
  if (!patient) return null;
  return (
    <Link
      to={desktop ? `/queue/${visit.id}` : `/v/${visit.id}`}
      replace={desktop}
      className={cx("flex min-h-[72px] items-center gap-3 rounded-[22px] px-3 py-2 outline-ink transition-colors", active ? "bg-ink text-paper" : "bg-card")}
    >
      <Critter avatarId={patient.id} size={42} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[1.1rem] font-extrabold">
          <Name name={patient.name} />
        </span>
        <span className={cx("block text-[0.88rem] font-bold", active ? "opacity-75" : "text-ink-soft")}>
          {visit.date === todayStr() ? "今天" : shortDate(visit.date)} {visit.time ?? ""}
        </span>
      </span>
      <Pill tone={st.tone} icon={st.tone === "pending" ? undefined : <Critter kind={st.critter} size={16} animate={visit.status === "processing"} />}>
        {st.label}
      </Pill>
      {!desktop && <ChevronRight size={18} className="text-ink-faint" />}
    </Link>
  );
}
