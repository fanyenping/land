import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronRight, FileUp, Info, Mic, MoreHorizontal, Plus, Search, Trash2 } from "lucide-react";
import { useFlows } from "../app/Flows";
import { ActionSheet } from "../components/ActionSheet";
import { Critter } from "../components/Critter";
import { Name, RevealButton } from "../components/Name";
import { useToast } from "../components/Toast";
import { Button, Pill, RoundButton, cx } from "../components/ui";
import { consentValid, deleteVisit, scheduleVisit } from "../lib/actions";
import { ageOf, daysUntil, greeting, longDate, shortDate, todayStr } from "../lib/format";
import { useAllVisits, useEngine, useNow, useOnline, usePatients, useSettings } from "../lib/hooks";
import type { Patient, Visit } from "../lib/model";
import { nextDue } from "../lib/pipeline";
import { pendingCount, visitStatus } from "../lib/status";
import { isDemoEngine } from "../lib/api";
import { seedDemo } from "../lib/seed";

export function Today() {
  const now = useNow();
  const today = todayStr(now);
  const settings = useSettings();
  const patients = usePatients();
  const visits = useAllVisits();
  const flows = useFlows();
  const toast = useToast();
  const online = useOnline();
  const engine = useEngine();

  const byId = useMemo(() => new Map((patients ?? []).map((p) => [p.id, p])), [patients]);
  const todays = useMemo(
    () =>
      (visits ?? [])
        .filter((v) => v.date === today)
        .sort((a, b) => (a.time ?? "99").localeCompare(b.time ?? "99") || a.createdAt.localeCompare(b.createdAt)),
    [visits, today],
  );
  const done = todays.filter((v) => v.status === "done");
  const waitingReview = todays.filter((v) => v.status === "review" || v.status === "failed" || v.status === "interrupted");
  const active = todays.filter((v) => v.status !== "done");
  const firstNames = todays.slice(0, 3).map((v) => byId.get(v.patientId)).filter(Boolean) as Patient[];

  if (!patients || !visits) return null;

  const addToToday = () =>
    flows.findPatient("加入今日", async (p) => {
      await scheduleVisit(p.id, today, null);
      toast("已加入今日");
    });

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 lg:pt-8">
      <header className="mb-4 flex items-center gap-3">
        <div className="flex items-center gap-2 lg:hidden">
          <Critter kind="brand" size={34} />
          <span className="font-round text-[1.15rem] font-extrabold">
            TaiOne <span className="text-coral">care</span>
          </span>
        </div>
        <h1 className="hidden font-round text-[2.6rem] font-extrabold leading-none lg:block">今天</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[0.95rem] font-bold text-ink-soft">{longDate(today)}</span>
          <RevealButton />
          <Link to="/settings" aria-label="設定" className="rounded-full outline-ink">
            <Critter kind="nurse" size={44} />
          </Link>
        </div>
      </header>

      {/* 深色主卡（參考 Today 卡） */}
      <section className="relative mb-4 animate-rise overflow-hidden rounded-[32px] bg-night p-6 text-night-ink md:p-8">
        <p className="mb-2 text-[1.05rem] font-bold opacity-80">
          {greeting(now)}，{settings.nurseName || "護理師"}
        </p>
        <p className="font-round text-[1.75rem] font-extrabold leading-[1.45] md:text-[2.2rem]">
          {todays.length === 0 ? (
            <>今天還沒有排訪視。</>
          ) : (
            <>
              今天要訪視
              {firstNames.map((p) => (
                <span key={p.id} className="mx-1 inline-flex translate-y-1.5 items-center rounded-full bg-white/10 py-0.5 pl-0.5 pr-3 align-baseline">
                  <Critter avatarId={p.id} size={34} />
                  <span className="ml-1.5 text-[1.1rem]">
                    <Name name={p.name} />
                  </span>
                </span>
              ))}
              {todays.length > 3 ? ` 等 ${todays.length} 位` : ` 共 ${todays.length} 位`}
              {waitingReview.length > 0 ? (
                <>
                  ，還有
                  <span className="mx-1 inline-flex translate-y-1 items-center">
                    <Critter kind="pending" size={34} />
                  </span>
                  {waitingReview.length} 份等你收尾。
                </>
              ) : done.length === todays.length ? (
                <>，全部完成了。</>
              ) : (
                <>。</>
              )}
            </>
          )}
        </p>
        <div className="mt-5 flex flex-wrap items-center gap-2 text-[0.92rem] font-bold">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-3 py-1.5">
            <span className={cx("h-2.5 w-2.5 rounded-full", online ? "bg-[#00b36b]" : "bg-[#8a8790]")} />
            {online ? "已連線" : "離線中・錄音、查看、複製都照常"}
          </span>
          {isDemoEngine(engine) && engine && <span className="inline-flex items-center rounded-full bg-pending px-3 py-1.5 text-[#141414]">示範模式</span>}
        </div>
        <Critter kind="brand" size={120} className="pointer-events-none absolute -bottom-8 -right-6 opacity-90 md:-right-2" style={{ transform: "rotate(-12deg)" }} />
      </section>

      {/* 三格大數字 */}
      <section className="mb-6 grid grid-cols-3 gap-3" aria-label="今日統計">
        <StatTile n={todays.length} label="今日訪視" className="bg-pending" />
        <StatTile n={done.length} label="已完成" className="bg-plan" />
        <StatTile n={waitingReview.length} label="待收尾" className="bg-record" to={waitingReview.length ? "/queue" : undefined} />
      </section>

      <div className="mb-3 flex items-center gap-2">
        <h2 className="font-round text-[1.5rem] font-extrabold">今日個案</h2>
        <Pill tone="ink">{todays.length} 位</Pill>
        <RoundButton label="加入今日" className="ml-auto" onClick={addToToday}>
          <Plus size={22} strokeWidth={2.8} />
        </RoundButton>
      </div>

      {todays.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-[30px] bg-card px-6 py-10 text-center outline-ink">
          <Critter kind="empty" size={84} />
          <p className="text-[1.15rem] font-bold">今天還沒有排訪視</p>
          <div className="flex w-full max-w-sm flex-col gap-2.5">
            <Button variant="primary" size="lg" block onClick={addToToday}>
              找個案加入今日
            </Button>
            {patients.length === 0 && (
              <Button
                size="lg"
                block
                onClick={async () => {
                  await seedDemo();
                  toast("已載入示範個案");
                }}
              >
                載入示範個案
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {active.map((v, i) => {
            const p = byId.get(v.patientId);
            return p ? <VisitCard key={v.id} visit={v} patient={p} index={i} /> : null;
          })}
          {done.map((v) => {
            const p = byId.get(v.patientId);
            return p ? <DoneRow key={v.id} visit={v} patient={p} /> : null;
          })}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button type="button" onClick={flows.recordForSomeone} className="flex min-h-[60px] items-center gap-2 rounded-[22px] bg-card px-4 font-bold outline-ink">
          <Mic size={20} strokeWidth={2.5} />
          <span className="flex-1 text-left">錄音給其他個案</span>
          <ChevronRight size={18} className="text-ink-faint" />
        </button>
        <Link to="/patients" className="flex min-h-[60px] items-center gap-2 rounded-[22px] bg-card px-4 font-bold outline-ink">
          <Search size={20} strokeWidth={2.5} />
          <span className="flex-1">找個案</span>
          <ChevronRight size={18} className="text-ink-faint" />
        </Link>
      </div>
    </div>
  );
}

function StatTile({ n, label, className, to }: { n: number; label: string; className: string; to?: string }) {
  const body = (
    <>
      <span className="num block text-[2.6rem] font-extrabold leading-none md:text-[3.2rem]">{n}</span>
      <span className="mt-1 block text-[0.95rem] font-bold">{label}</span>
    </>
  );
  const cls = cx("rounded-[24px] p-4 text-[#141414] outline-ink", className);
  return to ? (
    <Link to={to} className={cx(cls, "sticker block")}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

function VisitCard({ visit, patient, index }: { visit: Visit; patient: Patient; index: number }) {
  const navigate = useNavigate();
  const flows = useFlows();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const st = visitStatus(visit);
  const age = ageOf(patient.birthYear);
  const due = patient.tubes
    .map((t) => ({ t, due: nextDue(t.changedAt, t.intervalDays) }))
    .filter((x) => x.due && daysUntil(x.due) <= 7)
    .sort((a, b) => a.due!.localeCompare(b.due!))[0];
  const refused = !!patient.consentRefusedAt && !consentValid(patient);

  const open = () => navigate(`/v/${visit.id}`);

  let primary: { label: string; icon?: React.ReactNode; run: () => void } | null = null;
  switch (visit.status) {
    case "scheduled":
      primary = refused
        ? { label: "口述（離開後）", icon: <Mic size={22} strokeWidth={2.6} />, run: () => flows.record(patient, "dictate") }
        : { label: "開始錄音", icon: <Mic size={22} strokeWidth={2.6} />, run: () => flows.record(patient) };
      break;
    case "recording":
    case "paused":
      primary = { label: "回到錄音", icon: <Mic size={22} strokeWidth={2.6} />, run: () => navigate(`/v/${visit.id}/rec`) };
      break;
    case "interrupted":
      primary = { label: "繼續錄音", icon: <Mic size={22} strokeWidth={2.6} />, run: () => navigate(`/v/${visit.id}/rec`) };
      break;
    case "review":
      primary = { label: "查看並複製", run: open };
      break;
    case "failed":
      primary = { label: "看原因", run: open };
      break;
  }

  const canRemove = visit.status === "scheduled" && visit.parts.length === 0 && visit.documents.length === 0;

  return (
    <article className="animate-rise rounded-[28px] bg-card p-4 outline-ink md:p-5" style={{ animationDelay: `${index * 60}ms` }}>
      <div className="flex items-start gap-3">
        <button type="button" onClick={open} className="flex min-w-0 flex-1 items-center gap-3 text-left" aria-label="打開這筆訪視">
          <Critter avatarId={patient.id} size={54} />
          <span className="min-w-0">
            <span className="flex flex-wrap items-baseline gap-x-2">
              {visit.time && <span className="num text-[1.05rem] font-extrabold text-ink-soft">{visit.time}</span>}
              <span className="text-[1.3rem] font-extrabold">
                <Name name={patient.name} />
              </span>
              <span className="text-[0.95rem] font-bold text-ink-soft">{[age ? `${age} 歲` : null, patient.gender].filter(Boolean).join(" ")}</span>
            </span>
            {visit.status !== "scheduled" && (
              <span className="mt-1 block">
                <Pill tone={st.tone} icon={<Critter kind={st.critter} size={18} animate={visit.status === "processing"} />}>
                  {st.label}
                </Pill>
              </span>
            )}
          </span>
        </button>
        <RoundButton label="更多" size={44} tone="clear" onClick={() => setMenu(true)}>
          <MoreHorizontal size={22} />
        </RoundButton>
      </div>

      {visit.status === "scheduled" && patient.last && (
        <p className="mt-3 line-clamp-2 text-[1rem] text-ink-soft">
          <span className="font-bold text-ink">上次（{shortDate(patient.last.date)}）：</span>
          {patient.last.summary}
        </p>
      )}
      {visit.status === "waiting" && <p className="mt-3 text-[1rem] text-ink-soft">錄音已安全存在這台裝置，連上網路後自動處理。</p>}
      {visit.status === "processing" && <p className="mt-3 text-[1rem] text-ink-soft">整理中，可以先忙別的，好了會出現在這裡。</p>}
      {visit.status === "failed" && visit.error && <p className="mt-3 text-[1rem] font-bold text-danger">{visit.error.message}</p>}
      {visit.status === "review" && pendingCount(visit) === 0 && <p className="mt-3 text-[1rem] text-ink-soft">三份都寫好了，確認後就能複製。</p>}

      {visit.status === "scheduled" && (
        <div className="mt-3 flex flex-wrap gap-2">
          {due && (
            <Pill tone="audio">
              {due.t.name} {shortDate(due.due!)} 到期
            </Pill>
          )}
          {patient.plan && <Pill tone="plan">計畫第 {patient.plan.version} 版</Pill>}
          {consentValid(patient) ? <Pill tone="ok">已同意錄音</Pill> : refused ? <Pill tone="danger">不同意錄音</Pill> : <Pill tone="muted">尚未取得錄音同意</Pill>}
        </div>
      )}

      {primary && (
        <Button variant="primary" size="lg" block className="mt-4" icon={primary.icon} onClick={primary.run}>
          {primary.label}
        </Button>
      )}

      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={<Name name={patient.name} />}
        items={[
          { label: "匯入文件或錄音檔", icon: <FileUp size={22} />, onSelect: () => flows.openNew(patient) },
          ...(refused || visit.status !== "scheduled" ? [] : [{ label: "口述（不錄現場）", icon: <Mic size={22} />, onSelect: () => flows.record(patient, "dictate") }]),
          { label: "個案資訊", icon: <Info size={22} />, onSelect: () => navigate(`/patients/${patient.id}`) },
          ...(canRemove
            ? [
                {
                  label: "移出今日",
                  icon: <Trash2 size={22} />,
                  danger: true,
                  onSelect: async () => {
                    const undo = await deleteVisit(visit.id);
                    toast("已移出今日", undo ? { action: { label: "復原", run: () => void undo() } } : undefined);
                  },
                },
              ]
            : []),
        ]}
      />
    </article>
  );
}

function DoneRow({ visit, patient }: { visit: Visit; patient: Patient }) {
  return (
    <Link to={`/v/${visit.id}`} className="flex min-h-[64px] items-center gap-3 rounded-[22px] bg-card/70 px-4 py-2 opacity-90 outline-ink">
      <Critter kind="done" size={34} />
      {visit.time && <span className="num font-extrabold text-ink-soft">{visit.time}</span>}
      <span className="min-w-0 flex-1 truncate text-[1.1rem] font-extrabold">
        <Name name={patient.name} />
      </span>
      <Pill tone="ok">已完成</Pill>
      <ChevronRight size={18} className="text-ink-faint" />
    </Link>
  );
}
