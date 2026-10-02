import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { ChevronLeft, Copy, FileUp, Info, Mic, MoreHorizontal, Pencil, Shuffle, Trash2 } from "lucide-react";
import { VITAL_LABEL, type DocKind, type VitalKey } from "../../shared/types";
import { useFlows } from "../app/Flows";
import { ActionSheet } from "../components/ActionSheet";
import { Critter } from "../components/Critter";
import { Name, RevealButton } from "../components/Name";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { VitalsSheet } from "../components/VitalsSheet";
import { Button, Pill, RoundButton, cx } from "../components/ui";
import { ackWarnings, addMaterial, blockersFor, confirmAll, confirmAndCopy, deleteVisit, storeSummary, type Blocker } from "../lib/actions";
import { isDemoEngine } from "../lib/api";
import { docTitle } from "../lib/compose";
import { ageOf, clock, longDate, shortDate } from "../lib/format";
import { useEngine, useMedia, usePatient, useSettings, useVisit } from "../lib/hooks";
import type { Patient, Visit } from "../lib/model";
import { nextDue } from "../lib/pipeline";
import { visitStatus } from "../lib/status";
import { OutputCard } from "../workspace/OutputCard";
import { Progress } from "../workspace/Progress";
import { ReviewBlock } from "../workspace/ReviewBlock";
import { Sources } from "../workspace/Sources";
import { VitalsGrid } from "../workspace/VitalsGrid";

const KINDS: DocKind[] = ["record", "plan", "edu"];

export function WorkspaceRoute() {
  const { id } = useParams();
  return <Workspace visitId={id!} />;
}

export function Workspace({ visitId, embedded }: { visitId: string; embedded?: boolean }) {
  const navigate = useNavigate();
  const visit = useVisit(visitId);
  const patient = usePatient(visit?.patientId);

  if (visit === null || patient === null) {
    return (
      <div className="grid min-h-[60dvh] place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Critter kind="empty" size={80} />
          <p className="text-[1.2rem] font-bold">這筆紀錄已不存在</p>
          {!embedded && (
            <Button variant="primary" onClick={() => navigate("/")}>
              回到今天
            </Button>
          )}
        </div>
      </div>
    );
  }
  if (!visit || !patient) return null;
  return <WorkspaceBody visit={visit} patient={patient} embedded={embedded} />;
}

function WorkspaceBody({ visit, patient, embedded }: { visit: Visit; patient: Patient; embedded?: boolean }) {
  const navigate = useNavigate();
  const flows = useFlows();
  const toast = useToast();
  const settings = useSettings();
  const engine = useEngine();
  const wide = useMedia("(min-width: 1024px)");
  const veryWide = useMedia("(min-width: 1680px)");
  // 收尾頁內嵌時旁邊還有清單，空間夠寬才用左右兩欄。
  const desktop = embedded ? veryWide : wide;
  const [menu, setMenu] = useState(false);
  const [vitalsOpen, setVitalsOpen] = useState<{ focus: VitalKey | null } | null>(null);
  const [blocked, setBlocked] = useState<{ kind: DocKind | "all"; blockers: Blocker[] } | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const st = visitStatus(visit);
  const reviewing = !!visit.analysis && (visit.status === "review" || visit.status === "done" || visit.status === "processing");
  const processing = (visit.status === "processing" || visit.status === "waiting" || visit.status === "failed") && !reviewing;
  const demo = visit.analysisMeta?.mode === "demo" || (isDemoEngine(engine) && !visit.analysisMeta);
  const age = ageOf(patient.birthYear);
  const available = KINDS.filter((k) => visit.outputs[k].versions.length > 0);
  const allConfirmed = available.length > 0 && available.every((k) => visit.outputs[k].status === "confirmed");

  const onBlocked = useCallback((kind: DocKind | "all", blockers: Blocker[]) => setBlocked({ kind, blockers }), []);

  const copyAll = useCallback(async () => {
    const res = await confirmAll(visit, patient);
    if (res.blockers.length) return onBlocked("all", res.blockers);
    if (!res.ok) return toast("無法寫入剪貼簿");
    navigator.vibrate?.(40);
    toast(`已確認並複製 ${res.kinds.length} 份`, { big: true });
  }, [visit, patient, onBlocked, toast]);

  /** 電腦版依序複製（C）：每次都寫出個案名，避免貼錯人。 */
  const copyNext = useCallback(async () => {
    const next = available.find((k) => !visit.outputs[k].copiedAt && !(k === "edu" && visit.outputs.edu.sharedAt));
    if (!next) return toast("這位三份都複製過了");
    const res = await confirmAndCopy(visit, next, patient);
    if (res.blockers.length) return onBlocked(next, res.blockers);
    if (!res.ok) return toast("無法寫入剪貼簿");
    const after = available.slice(available.indexOf(next) + 1).find((k) => !visit.outputs[k].copiedAt);
    toast(`已複製：${patient.familyCallsAs ?? ""}${docTitle(next, settings)}（${res.chars} 字）${after ? ` → 下一個：${docTitle(after, settings)}` : ""}`, { big: true, ms: 3200 });
  }, [available, visit, patient, onBlocked, toast, settings]);

  useEffect(() => {
    if (!desktop || !reviewing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.metaKey || e.ctrlKey || e.altKey) return;
      // 面板開著時（焦點可能還在背景按鈕上）不觸發複製。
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      if (e.key === "c" || e.key === "C") {
        e.preventDefault();
        if (e.shiftKey) void copyAll();
        else void copyNext();
      } else if (e.key === "1" || e.key === "2" || e.key === "3") {
        document.getElementById(`sec-${KINDS[Number(e.key) - 1]}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [desktop, reviewing, copyAll, copyNext]);

  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

  const header = (
    <header className={cx("z-30 bg-paper/90 backdrop-blur-md", embedded ? "sticky top-0" : "sticky top-0 pt-[max(env(safe-area-inset-top),10px)]")}>
      <div className="flex items-center gap-2 px-4 py-2 md:px-6">
        {!embedded && (
          <RoundButton label="返回" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}>
            <ChevronLeft size={24} strokeWidth={2.6} />
          </RoundButton>
        )}
        <button type="button" onClick={() => navigate(`/patients/${patient.id}`)} className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
          <Critter avatarId={patient.id} size={42} />
          <span className="min-w-0">
            <span className="block truncate text-[1.2rem] font-extrabold leading-tight">
              <Name name={patient.name} />
              <span className="ml-2 text-[0.92rem] font-bold text-ink-soft">{[age ? `${age}` : null, patient.gender].filter(Boolean).join(" ")}</span>
            </span>
            <span className="block truncate text-[0.88rem] font-bold text-ink-soft">
              {shortDate(visit.date)}
              {visit.recordingStartedAt && ` ${clock(visit.recordingStartedAt)}${visit.recordingEndedAt ? `-${clock(visit.recordingEndedAt)}` : ""}`}
              {visit.parts.length ? `・錄音 ${visit.parts.length} 段` : ""}
              {visit.documents.length ? `・文件 ${visit.documents.length} 份` : ""}
            </span>
          </span>
        </button>
        <RevealButton />
        <RoundButton label="更多" onClick={() => setMenu(true)}>
          <MoreHorizontal size={22} />
        </RoundButton>
      </div>
      {reviewing && !desktop && (
        <nav aria-label="跳到" className="scrollbar-none flex gap-2 overflow-x-auto px-4 pb-2.5">
          {[
            { id: "sec-check", label: "核對" },
            { id: "sec-vitals", label: "數值" },
            ...KINDS.map((k) => ({ id: `sec-${k}`, label: docTitle(k, settings).replace("家屬", "") })),
          ].map((j) => (
            <button key={j.id} type="button" onClick={() => jump(j.id)} className="min-h-[40px] shrink-0 rounded-full bg-card px-4 text-[0.95rem] font-bold outline-ink">
              {j.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );

  const outputs = (
    <div className="flex flex-col gap-4">
      {KINDS.map((k) => (
        <OutputCard key={k} kind={k} visit={visit} patient={patient} onBlocked={onBlocked} demo={demo} />
      ))}
    </div>
  );

  const copyAllBar = reviewing && available.length > 0 && (
    <div
      className={cx(
        "z-30",
        desktop ? "sticky bottom-4 mt-4" : embedded ? "sticky bottom-0 -mx-4 bg-paper/90 px-4 pb-3 pt-2 backdrop-blur-md md:-mx-6 md:px-6" : "safe-bottom fixed inset-x-0 bottom-0 bg-paper/90 px-4 pb-3 pt-2 backdrop-blur-md",
      )}
    >
      <Button variant="primary" size="xl" block icon={<Copy size={22} />} onClick={copyAll}>
        {allConfirmed
          ? "已全部確認・再全部複製"
          : available.length < 3
            ? `全部確認並複製（${available.length} 份・${KINDS.filter((k) => !available.includes(k)).map((k) => docTitle(k, settings).slice(-2)).join("、")}未完成）`
            : "全部確認並複製（3 份）"}
      </Button>
    </div>
  );

  let content: React.ReactNode;
  if (visit.status === "scheduled") {
    content = <Brief visit={visit} patient={patient} onImport={() => fileInput.current?.click()} />;
  } else if (["recording", "paused", "interrupted"].includes(visit.status)) {
    content = (
      <section className="flex flex-col items-center gap-4 rounded-[30px] bg-audio p-6 text-center text-[#141414] outline-ink">
        <Critter kind="audio" size={84} animate={visit.status === "recording"} />
        <p className="font-round text-[1.4rem] font-extrabold">{visit.status === "interrupted" ? "錄音中斷了，已錄的內容都保存了" : st.label}</p>
        <Button variant="primary" size="xl" block icon={<Mic size={22} />} onClick={() => navigate(`/v/${visit.id}/rec`)}>
          {visit.status === "interrupted" ? "繼續錄音或完成訪視" : "回到錄音"}
        </Button>
      </section>
    );
  } else if (processing) {
    content = (
      <div className="flex flex-col gap-4">
        <Progress visit={visit} />
        {visit.status !== "failed" && outputs}
      </div>
    );
  } else if (desktop) {
    content = (
      <div className="grid grid-cols-[minmax(340px,420px)_minmax(0,1fr)] items-start gap-5">
        <div className="sticky top-[84px] flex max-h-[calc(100dvh-100px)] flex-col gap-4 overflow-y-auto pb-6 pr-1">
          <ReviewBlock visit={visit} patient={patient} onEditVital={(k) => setVitalsOpen({ focus: k })} />
          <VitalsGrid visit={visit} onEdit={(k) => setVitalsOpen({ focus: k })} />
          <section className="rounded-[26px] bg-card p-4 outline-ink">
            <h2 className="mb-3 font-round text-[1.2rem] font-extrabold">來源</h2>
            <Sources visit={visit} />
          </section>
        </div>
        <div className="min-w-0 pb-6">
          {visit.status === "processing" && (
            <p className="mb-3 flex items-center gap-2 font-bold text-ink-soft">
              <Critter kind="processing" size={28} animate /> 撰寫中…
            </p>
          )}
          {outputs}
          {copyAllBar}
          <p className="mt-3 text-center text-[0.85rem] font-bold text-ink-faint">C 依序複製 · Shift+C 全部複製 · 1/2/3 跳到各份</p>
        </div>
      </div>
    );
  } else {
    content = (
      <div className={cx("flex flex-col gap-4", !embedded && "pb-28")}>
        <ReviewBlock visit={visit} patient={patient} onEditVital={(k) => setVitalsOpen({ focus: k })} />
        <VitalsGrid visit={visit} onEdit={(k) => setVitalsOpen({ focus: k })} />
        {outputs}
        {(visit.transcript || visit.parts.length > 0 || visit.documents.length > 0) && (
          <Button block size="lg" onClick={() => setSourcesOpen(true)}>
            來源：{[visit.transcript ? "逐字稿" : null, visit.parts.length ? `錄音 ${visit.parts.length} 段` : null, visit.documents.length ? `文件 ${visit.documents.length} 份` : null].filter(Boolean).join("・")}
          </Button>
        )}
        {copyAllBar}
      </div>
    );
  }

  return (
    <div className={cx("mx-auto w-full", embedded ? "" : "max-w-[1280px]")}>
      {header}
      <div className="px-4 pb-6 pt-2 md:px-6">
        {visit.status === "done" && (
          <div className="mb-4 flex items-center gap-3 rounded-[24px] bg-ok-tint px-4 py-3 font-bold text-ok">
            <Critter kind="done" size={34} />
            已完成・{visit.reviewedBy ?? ""} {clock(visit.completedAt)}
          </div>
        )}
        {content}
      </div>

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        accept="application/pdf,image/*,audio/*,.m4a,.mp3,.wav"
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          const res = await addMaterial(visit.id, files);
          if (res) toast(storeSummary(res, visit.status === "scheduled" ? "，開始整理" : "，重新整理中"), { ms: res.skipped.length ? 5000 : undefined });
        }}
      />

      <VitalsSheet visit={visit} open={!!vitalsOpen} focus={vitalsOpen?.focus} onClose={() => setVitalsOpen(null)} />

      <Sheet open={sourcesOpen} onClose={() => setSourcesOpen(false)} title="來源" full>
        <Sources visit={visit} />
      </Sheet>

      <Sheet
        open={!!blocked}
        onClose={() => setBlocked(null)}
        title="複製前還有幾件要先看"
        footer={
          <Button
            variant="primary"
            size="lg"
            block
            disabled={blocked ? blockersFor(visit, blocked.kind).length > 0 : true}
            onClick={async () => {
              const k = blocked?.kind;
              setBlocked(null);
              if (k === "all") await copyAll();
              else if (k) {
                const res = await confirmAndCopy(visit, k, patient);
                if (res.blockers.length) onBlocked(k, res.blockers);
                else if (res.ok) toast(`已確認並複製${docTitle(k, settings)}（${res.chars} 字）`);
                else toast("無法寫入剪貼簿，請長按文字自行複製");
              }
            }}
          >
            {blocked && blockersFor(visit, blocked.kind).length > 0
              ? `還有 ${blockersFor(visit, blocked.kind).length} 件：${blockersFor(visit, blocked.kind)
                  .map((b) => (b.key ? VITAL_LABEL[b.key] : b.label))
                  .join("、")}`
              : blocked?.kind === "all"
                ? "全部確認並複製"
                : `確認並複製${blocked ? docTitle(blocked.kind as DocKind, settings) : ""}`}
          </Button>
        }
      >
        {blocked && <OtherBlockers visit={visit} kind={blocked.kind} />}
        <ReviewBlock visit={visit} patient={patient} onEditVital={(k) => setVitalsOpen({ focus: k })} />
      </Sheet>

      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={<Name name={patient.name} />}
        items={[
          { label: "補資料（PDF、照片、錄音檔）", icon: <FileUp size={21} />, onSelect: () => fileInput.current?.click() },
          ...(visit.status !== "scheduled" ? [{ label: "數值速記", icon: <Pencil size={21} />, onSelect: () => setVitalsOpen({ focus: null }) }] : []),
          {
            label: "改到其他個案",
            icon: <Shuffle size={21} />,
            onSelect: () => flows.moveTo(visit.id, patient.id),
          },
          { label: "個案資訊", icon: <Info size={21} />, onSelect: () => navigate(`/patients/${patient.id}`) },
          {
            label: "刪除這筆紀錄",
            icon: <Trash2 size={21} />,
            danger: true,
            hint: "錄音、文件與三份內容都會刪除，5 秒內可復原",
            onSelect: async () => {
              const undo = await deleteVisit(visit.id);
              if (!embedded) navigate("/", { replace: true });
              toast("已刪除這筆紀錄", undo ? { action: { label: "復原", run: () => void undo() } } : undefined);
            },
          },
        ]}
      />
    </div>
  );
}

/** 「先看這裡」以外的關卡：整理中、撰寫中、輸出檢核提醒。 */
function OtherBlockers({ visit, kind }: { visit: Visit; kind: DocKind | "all" }) {
  const settings = useSettings();
  const list = blockersFor(visit, kind).filter((b) => b.kind === "processing" || b.kind === "writing" || b.kind === "warning");
  if (list.length === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-3">
      {list.map((b) =>
        b.kind === "warning" && b.doc ? (
          <div key={`w-${b.doc}`} className="rounded-[22px] bg-pending-tint p-4 outline-ink">
            <p className="font-extrabold">{docTitle(b.doc, settings)}的提醒</p>
            <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-6 text-[0.98rem]">
              {(visit.outputs[b.doc].versions[visit.outputs[b.doc].current]?.warnings ?? []).map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
            <Button variant="primary" className="mt-3" onClick={() => ackWarnings(visit.id, b.doc!)}>
              看過了
            </Button>
          </div>
        ) : (
          <p key={`${b.kind}-${b.doc ?? ""}`} className="flex items-center gap-2 rounded-[22px] bg-card p-4 font-bold outline-ink">
            <Critter kind="processing" size={30} animate />
            {b.kind === "writing" && b.doc ? `等${docTitle(b.doc, settings)}寫完` : b.label}
          </p>
        ),
      )}
    </div>
  );
}

/** 訪前提要：上次重點、管路到期、現行計畫、同意狀態；主要動作是開始錄音。 */
function Brief({ visit, patient, onImport }: { visit: Visit; patient: Patient; onImport: () => void }) {
  const flows = useFlows();
  const tubes = patient.tubes.map((t) => ({ ...t, due: nextDue(t.changedAt, t.intervalDays) }));
  const problems = patient.plan?.text.split("\n").filter((l) => /^(護理)?問題\s*\d/.test(l.trim())) ?? [];
  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-[30px] bg-night p-5 text-night-ink">
        <p className="mb-1 font-bold opacity-75">{longDate(visit.date)}{visit.time ? ` ${visit.time}` : ""}・訪前提要</p>
        <p className="font-round text-[1.5rem] font-extrabold leading-snug">{patient.last ? `上次（${shortDate(patient.last.date)}）：${patient.last.summary}` : "第一次訪視"}</p>
        {patient.diagnoses.length > 0 && <p className="mt-2 font-bold opacity-80">{patient.diagnoses.join("、")}</p>}
      </section>
      <div className="grid gap-3 sm:grid-cols-2">
        <section className="rounded-[26px] bg-card p-4 outline-ink">
          <h2 className="mb-2 font-round text-[1.15rem] font-extrabold">管路</h2>
          {tubes.length === 0 ? (
            <p className="text-ink-soft">沒有記錄管路</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {tubes.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-2 font-bold">
                  <span>{t.name}</span>
                  {t.due && <Pill tone="audio">{shortDate(t.due)} 到期</Pill>}
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="rounded-[26px] bg-card p-4 outline-ink">
          <h2 className="mb-2 font-round text-[1.15rem] font-extrabold">{patient.plan ? `現行計畫第 ${patient.plan.version} 版` : "護理計畫"}</h2>
          {problems.length ? (
            <ul className="flex flex-col gap-1 text-[0.98rem]">
              {problems.map((p) => (
                <li key={p}>{p.replace(/^護理/, "")}</li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-soft">{patient.plan ? "已有計畫" : "這次訪視後會擬定第 1 版"}</p>
          )}
        </section>
      </div>
      <Button variant="primary" size="xl" block icon={<Mic size={24} />} onClick={() => flows.record(patient)}>
        開始錄音
      </Button>
      <div className="grid grid-cols-2 gap-3">
        <Button size="lg" icon={<FileUp size={20} />} onClick={onImport}>
          匯入文件
        </Button>
        <Button size="lg" onClick={() => flows.record(patient, "dictate")}>
          口述
        </Button>
      </div>
    </div>
  );
}
