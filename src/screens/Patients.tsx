import { useMemo, useState } from "react";
import { Link } from "react-router";
import { Plus, Search } from "lucide-react";
import { useFlows } from "../app/Flows";
import { Critter, avatarSpec } from "../components/Critter";
import { Name, RevealButton } from "../components/Name";
import { Chip, Pill, RoundButton, cx, inputClass } from "../components/ui";
import { ageOf, daysUntil, maskName, todayStr } from "../lib/format";
import { useAllVisits, usePatients } from "../lib/hooks";
import type { Patient } from "../lib/model";
import { nextDue } from "../lib/pipeline";

type Filter = "all" | "today" | "due" | "open";

/** 個案：彩色資料夾（參考 Saved 畫面）。 */
export function Patients() {
  const patients = usePatients();
  const visits = useAllVisits();
  const flows = useFlows();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const today = todayStr();

  const stats = useMemo(() => {
    const m = new Map<string, { count: number; today: boolean; open: boolean }>();
    for (const v of visits ?? []) {
      const s = m.get(v.patientId) ?? { count: 0, today: false, open: false };
      if (v.status === "done") s.count++;
      if (v.date === today) s.today = true;
      if (["review", "failed", "interrupted", "processing", "waiting"].includes(v.status)) s.open = true;
      m.set(v.patientId, s);
    }
    return m;
  }, [visits, today]);

  const dueSoon = (p: Patient) => p.tubes.some((t) => {
    const d = nextDue(t.changedAt, t.intervalDays);
    return d !== null && daysUntil(d) <= 7;
  });

  const list = useMemo(() => {
    const term = q.trim();
    return (patients ?? [])
      .filter((p) => !term || p.name.includes(term) || maskName(p.name).includes(term) || (p.familyCallsAs ?? "").includes(term) || p.diagnoses.some((d) => d.includes(term)))
      .filter((p) => {
        if (filter === "today") return stats.get(p.id)?.today;
        if (filter === "due") return dueSoon(p);
        if (filter === "open") return stats.get(p.id)?.open;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  }, [patients, q, filter, stats]);

  if (!patients) return null;

  return (
    <div className="mx-auto w-full max-w-[1100px] px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 lg:pt-8">
      <header className="mb-4 flex items-end gap-3">
        <h1 className="font-round text-[2.6rem] font-extrabold leading-none">個案</h1>
        <Pill tone="ink" className="mb-1">
          {patients.length} 位
        </Pill>
        <div className="ml-auto flex gap-2">
          <RevealButton size={48} />
          <RoundButton label="新增個案" size={48} onClick={() => flows.editPatient(null)}>
            <Plus size={24} strokeWidth={2.8} />
          </RoundButton>
        </div>
      </header>

      <label className="relative mb-3 block">
        <span className="sr-only">搜尋個案</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" size={20} />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="姓名、稱呼或診斷" className={cx(inputClass, "pl-11")} />
      </label>
      <div className="scrollbar-none -mx-4 mb-5 flex gap-2 overflow-x-auto px-4">
        {(
          [
            ["all", "全部"],
            ["today", "今日訪視"],
            ["open", "未收尾"],
            ["due", "管路 7 天內到期"],
          ] as [Filter, string][]
        ).map(([f, label]) => (
          <Chip key={f} active={filter === f} onClick={() => setFilter(f)} className="shrink-0">
            {label}
          </Chip>
        ))}
      </div>

      {list.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-[30px] bg-card px-6 py-10 text-center outline-ink">
          <Critter kind="empty" size={80} />
          <p className="font-bold">{q ? `找不到「${q}」` : patients.length ? "這個分類沒有個案" : "還沒有個案"}</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-x-4 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((p, i) => (
            <Folder key={p.id} p={p} visits={stats.get(p.id)?.count ?? 0} due={dueSoon(p)} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}

function Folder({ p, visits, due, index }: { p: Patient; visits: number; due: boolean; index: number }) {
  const color = avatarSpec(p.id).color;
  const age = ageOf(p.birthYear);
  return (
    <Link to={`/patients/${p.id}`} className="group relative block animate-rise pt-5" style={{ animationDelay: `${Math.min(index, 12) * 40}ms` }}>
      <span className="absolute left-0 top-1.5 h-8 w-[46%] rounded-t-[18px] outline-ink" style={{ background: color }} />
      <span className="absolute left-[14%] right-[10%] top-0 h-24 rotate-[-4deg] rounded-[16px] bg-card outline-ink transition-transform group-hover:-translate-y-1" />
      <span className="absolute right-[16%] top-2 z-[1] transition-transform group-hover:-translate-y-1.5 group-hover:rotate-6">
        <Critter avatarId={p.id} size={52} />
      </span>
      <span className="relative z-[2] mt-9 flex min-h-[128px] flex-col justify-end rounded-[22px] p-3.5 text-[#141414] outline-ink" style={{ background: color }}>
        <span className="truncate text-[1.2rem] font-extrabold">
          <Name name={p.name} />
        </span>
        <span className="truncate text-[0.88rem] font-bold opacity-80">
          {[age ? `${age} 歲` : null, p.gender, p.familyCallsAs].filter(Boolean).join(" · ")}
        </span>
        <span className="mt-1.5 flex flex-wrap gap-1">
          <span className="rounded-full bg-white/70 px-2 py-0.5 text-[0.78rem] font-bold">{visits} 次訪視</span>
          {due && <span className="rounded-full bg-[#141414] px-2 py-0.5 text-[0.78rem] font-bold text-white">管路將到期</span>}
        </span>
      </span>
    </Link>
  );
}
