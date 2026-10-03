import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link } from "react-router";
import { FileAudio, Keyboard, Mic, RefreshCw, Sparkles, Square } from "lucide-react";
import { DEMO_PLAN_DICTATION_TEXT } from "../../shared/demoTranscript";
import { PLAN_DICTATION_MAX_CHARS } from "../../shared/planPolish";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { VoiceMemoGuideContent, VoiceMemoGuideSheet } from "../components/VoiceMemoGuide";
import { Button, Pill, Spinner, cx } from "../components/ui";
import { addMaterial, cancelPlanDictation, deferPlan, finishPlanDictation, resumePlan, startPlanDictation, storageErrorMessage, storeSummary } from "../lib/actions";
import { AUDIO_ACCEPT, PLAN_AUDIO_MAX_BYTES, isAudioFile, voiceMemoProblem } from "../lib/audioFiles";
import { getBlob } from "../lib/db";
import { dictation } from "../lib/dictation";
import { TRIAL } from "../lib/env";
import { clock } from "../lib/format";
import { useDictation, useSettings } from "../lib/hooks";
import type { OutputVersion, Patient, Visit } from "../lib/model";
import { dictationHasContent, discardPlanDictation, draftPlanFrom, polishPlanDictation, regenerate, savePlanDictationAudio, setPlanDictationText, transcribePlanDictation } from "../lib/pipeline";
import { planBaseFor, planSlot } from "../lib/planSlot";
import { audioDuration } from "../lib/recorder";

/**
 * 護理計畫欄位：依全人評估、沿用現行計畫，或護理師口述（AI 只整理語句）。
 * 全人評估沒填完又沒有現行計畫時，這裡直接口述；護理紀錄不等計畫。
 */

/** 超過 10 分鐘的錄音比較像整段訪視錄音：先問要不要改當訪視錄音。 */
const LONG_FILE_MS = 10 * 60_000;
const TOO_BIG = "這段錄音太大（口述上限 50 MB），整段訪視錄音請用「選錄音檔」加入護理紀錄";

const linkClass = "inline-flex min-h-[44px] items-center font-bold underline underline-offset-4";
/** 計畫欄位的次要按鈕（size="sm"）也要 44 px 高，手指點得到。 */
const tap = "min-h-[44px]!";
/** 轉文字或整理等這麼久還沒好：給「改用打字／捨棄」的出口（App 被關掉的工作會自動接續，這是網路卡住時用）。 */
const STALE_MS = 2 * 60_000;
/** 窄螢幕＋大字時按鈕文字換行，不截成「口述護理…」。 */
const wrap = "[&>span]:whitespace-normal";
const textareaClass =
  "w-full resize-y rounded-2xl bg-card p-3 text-[1.08rem] leading-[1.7] text-ink outline-ink placeholder:text-ink-faint focus:outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]!";

function dictatingHere(visitId: string) {
  const s = dictation.getSnapshot();
  return s.visitId === visitId && (s.state === "recording" || s.state === "starting");
}

/** 只在「這筆正在口述」改變時重畫（不跟著音量每格更新）。 */
function useDictatingHere(visitId: string) {
  return useSyncExternalStore(dictation.subscribe, () => dictatingHere(visitId), () => false);
}

const mounted = new Map<string, number>();

/** 離開這筆的計畫卡（換頁、關工作台）時把口述收好並整理，絕不丟掉；版面切換立刻重新掛上就不算離開。 */
function useFinishOnLeave(visitId: string) {
  useEffect(() => {
    mounted.set(visitId, (mounted.get(visitId) ?? 0) + 1);
    return () => {
      const n = (mounted.get(visitId) ?? 1) - 1;
      if (n > 0) mounted.set(visitId, n);
      else mounted.delete(visitId);
      setTimeout(() => {
        if (!mounted.get(visitId) && dictatingHere(visitId)) void finishPlanDictation(visitId);
      }, 400);
    };
  }, [visitId]);
}

/** 某個時間點已經過了 ms（時間到自動重畫）。 */
function useOlderThan(iso: string | null | undefined, ms: number) {
  const [, tick] = useState(0);
  const age = iso ? Date.now() - Date.parse(iso) : 0;
  const old = !!iso && age >= ms;
  useEffect(() => {
    if (!iso || old) return;
    const t = setTimeout(() => tick((n) => n + 1), ms - age + 50);
    return () => clearTimeout(t);
  }, [iso, old, ms, age]);
  return old;
}

/** 口述交出去之後（整理、完成口述）：焦點移到計畫卡標題，讀螢幕軟體不會跳回頁首（狀態由 aria-live 唸）。 */
function focusPlanCard() {
  setTimeout(() => document.querySelector<HTMLElement>("#sec-plan h2")?.focus({ preventScroll: true }), 80);
}

function mss(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** 標題列的狀態文字（計畫專用）；null 時用一般的狀態。 */
export function planStatusLabel(visit: Visit, patient: Patient): string | null {
  const out = visit.outputs.plan;
  const has = out.versions.length > 0;
  const { mode } = planSlot(visit, patient);
  const d = visit.planDictation;
  if (mode === "awaiting" && !d) return "待口述";
  if (mode === "deferred") return "本次不擬";
  if (d?.status === "transcribing") return "轉文字中";
  if (d?.status === "review") return "口述待整理";
  if (!has && d?.status === "polishing") return "整理中";
  if (!has && d?.status === "failed") return "口述沒有整理成功";
  if (!has && out.status === "idle" && visit.status !== "processing" && (mode === "assessment" || mode === "carried")) return "可擬定";
  if (has && out.versions[out.current]?.source === "dictation" && out.status === "draft") return "口述整理稿";
  return null;
}

/** 文件標頭旁的來源標示。 */
export function PlanSourcePill({ visit, patient }: { visit: Visit; patient: Patient }) {
  const out = visit.outputs.plan;
  const cur = out.versions[out.current];
  if (!cur) return null;
  const slot = planSlot(visit, patient);
  const base = planBaseFor(visit, patient);
  const source = cur.source ?? visit.planSource ?? (base ? "carried" : "assessment");
  if (source === "dictation") {
    const d = visit.planDictation;
    return (
      <>
        <Pill tone="plan">護理師口述・AI 只整理語句</Pill>
        {d?.provider === "demo" && d.id === cur.dictationId && <Pill tone="pending">示範口述</Pill>}
      </>
    );
  }
  if (source === "assessment") return <Pill tone="plan">{`全人評估 ${slot.done}/${slot.total}${slot.reassessDue ? "・已逾 6 個月" : ""}`}</Pill>;
  if (!base) return null;
  return (
    <>
      <Pill tone="plan">{`沿用第 ${base.version} 版`}</Pill>
      {slot.reassessDue && <Pill>全人評估已逾 6 個月</Pill>}
    </>
  );
}

function Banner({ children, actions, hint, tone = "bg-pdf-tint" }: { children: ReactNode; actions?: ReactNode; hint?: string; tone?: string }) {
  return (
    <div className={cx("mb-3 rounded-2xl p-3", tone)}>
      <p className="font-bold leading-snug">{children}</p>
      {hint && <p className="mt-0.5 text-[0.88rem] font-bold text-ink-soft">{hint}</p>}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

const linkButton = "sticker inline-flex min-h-[44px] items-center rounded-full bg-card px-4 text-[0.92rem] font-bold text-ink";

/** 計畫卡內的計畫來源區：待口述、口述進行中、可擬定、評估有更新、沿用中、本次不擬。 */
export function PlanPanel({ visit, patient }: { visit: Visit; patient: Patient }) {
  const toast = useToast();
  const here = useDictatingHere(visit.id);
  const [sheet, setSheet] = useState(false);
  useFinishOnLeave(visit.id);

  const slot = planSlot(visit, patient);
  const out = visit.outputs.plan;
  const cur = out.versions[out.current];
  const base = planBaseFor(visit, patient);
  const complete = slot.done >= slot.total;
  const d = visit.planDictation;
  const progress = here || (!!d && d.status !== "done");
  const updated = patient.assessment?.updatedAt ?? "";
  // 依全人評估／沿用要用這次整理好的重點：還在整理時先不能按。
  const canDraft = !!visit.analysis && visit.status !== "processing";
  const assessmentHref = `/patients/${patient.id}/assessment`;
  const draft = (source: "assessment" | "carried") => {
    toast(source === "assessment" ? "正在依全人評估擬定" : "正在沿用現行計畫並評值");
    void draftPlanFrom(visit.id, source);
  };

  let body: ReactNode = null;
  if (slot.mode === "deferred") {
    body = (
      <Banner tone="bg-ink/[0.06]" actions={<Button size="sm" className={tap} onClick={() => resumePlan(visit.id)}>恢復</Button>}>
        本次不擬計畫・{visit.planDeferred?.by ?? ""} {clock(visit.planDeferred?.at)}
      </Banner>
    );
  } else if (slot.mode === "awaiting") {
    body = <Awaiting visit={visit} patient={patient} done={slot.done} total={slot.total} progress={progress} onRedo={() => setSheet(true)} />;
  } else if (progress) {
    body = (
      <div className="mb-3 rounded-[22px] bg-plan-tint p-4">
        <Capture visit={visit} patient={patient} onRedo={() => setSheet(true)} />
      </div>
    );
  } else if (!cur) {
    // 還沒有計畫、也不在撰寫：護理師選依評估、沿用或口述。
    if (out.status === "idle" && visit.status !== "processing") {
      body =
        slot.mode === "assessment" ? (
          <Banner
            actions={
              <>
                <Button size="sm" className={tap} variant="primary" disabled={!canDraft} onClick={() => draft("assessment")}>
                  依全人評估擬定
                </Button>
                <Button size="sm" className={tap} icon={<Mic size={16} />} onClick={() => setSheet(true)}>
                  改用口述
                </Button>
              </>
            }
          >
            {`全人評估已完成 ${slot.done}/${slot.total}${slot.reassessDue ? "・已逾 6 個月" : ""}`}
          </Banner>
        ) : base ? (
          <Banner
            actions={
              <>
                <Button size="sm" className={tap} variant="primary" disabled={!canDraft} onClick={() => draft("carried")}>
                  沿用並評值
                </Button>
                <Button size="sm" className={tap} icon={<Mic size={16} />} onClick={() => setSheet(true)}>
                  改用口述
                </Button>
              </>
            }
          >
            {`可沿用現行計畫第 ${base.version} 版`}
          </Banner>
        ) : null;
    }
  } else if (slot.mode === "assessment") {
    if (updated > cur.createdAt) {
      body = (
        <Banner
          actions={
            <Button
              size="sm"
              className={tap}
              variant="primary"
              disabled={!canDraft}
              onClick={() => {
                toast("正在依全人評估重新擬定");
                void regenerate(visit.id, "plan", [], null, "依全人評估重新擬定");
              }}
            >
              依評估重新擬定
            </Button>
          }
        >
          全人評估有更新
        </Banner>
      );
    }
  } else if (slot.mode === "carried" && !complete) {
    if (base) {
      body = (
        <Banner
          actions={
            <>
              <Button size="sm" className={tap} variant="primary" icon={<Mic size={16} />} onClick={() => setSheet(true)}>
                口述護理計畫
              </Button>
              <Link to={assessmentHref} className={linkButton}>
                去填寫
              </Link>
            </>
          }
        >
          {`沿用現行第 ${base.version} 版・全人評估 ${slot.done}/${slot.total}`}
        </Banner>
      );
    }
  } else if (complete && updated > cur.createdAt) {
    // 口述或沿用的計畫做好之後全人評估才填完：可改依評估擬定，目前版本留在版本紀錄。
    body = (
      <Banner
        hint={slot.mode === "dictation" ? "口述版本會留在版本紀錄" : "目前版本會留在版本紀錄"}
        actions={
          <Button size="sm" className={tap} variant="primary" disabled={!canDraft} onClick={() => draft("assessment")}>
            依全人評估擬定
          </Button>
        }
      >
        {`全人評估已完成 ${slot.done}/${slot.total}`}
      </Banner>
    );
  }

  return (
    <>
      {body}
      <p className="sr-only" aria-live="polite">
        {liveText(visit, here)}
      </p>
      <DictationSheet open={sheet} onClose={() => setSheet(false)} visit={visit} patient={patient} />
    </>
  );
}

/** 讀螢幕軟體用的狀態（只在改變時唸）。 */
function liveText(visit: Visit, here: boolean) {
  const d = visit.planDictation;
  if (here) return "口述中";
  if (d?.status === "transcribing") return "轉文字中";
  if (d?.status === "polishing") return "AI 整理中";
  if (d?.status === "failed") return d.error?.code === "empty" ? "沒有聽到內容" : d.text ? "整理沒有成功" : "轉文字沒有成功";
  if (d?.status === "review") return "口述待整理";
  if (d?.status === "done") return "口述已整理成計畫";
  return "";
}

/** 全人評估沒填完、也沒有現行計畫：直接口述這次的計畫。 */
function Awaiting({ visit, patient, done, total, progress, onRedo }: { visit: Visit; patient: Patient; done: number; total: number; progress: boolean; onRedo: () => void }) {
  const toast = useToast();
  const suggestions = visit.analysis?.planSuggestions ?? [];
  return (
    <section aria-label="口述護理計畫" className="mb-3 flex flex-col gap-3 rounded-[22px] bg-plan-tint p-4">
      <div>
        <h3 className="font-round text-[1.2rem] font-extrabold leading-snug">{`全人評估 ${done}/${total} 未完成`}</h3>
        {!progress && <p className="mt-1 text-[0.98rem] font-bold leading-snug text-ink-soft">可直接口述這次的護理計畫，AI 只整理語句，不會新增內容。</p>}
      </div>
      <Capture visit={visit} patient={patient} onRedo={onRedo} assessmentHref={`/patients/${patient.id}/assessment`} />
      {!progress && (
        <>
          <button
            type="button"
            className="min-h-[44px] self-start font-bold text-ink-soft underline underline-offset-4"
            onClick={async () => {
              await deferPlan(visit.id);
              toast("本次不擬計畫，紀錄照常完成");
            }}
          >
            本次不擬計畫
          </button>
          <p className="rounded-2xl bg-ok-tint px-3 py-2 text-[0.95rem] font-bold text-ok">不影響護理紀錄：紀錄可以先確認、複製、導出。</p>
        </>
      )}
      {suggestions.length > 0 && (
        <div>
          <p className="font-extrabold">口述時可考慮：</p>
          <ul className="mt-1 flex list-disc flex-col gap-0.5 pl-6 text-[0.98rem]">
            {suggestions.map((s) => (
              <li key={s.id}>
                {s.problem}（{s.basis}）
              </li>
            ))}
          </ul>
        </div>
      )}
      {TRIAL && !progress && <p className="text-[0.9rem] font-bold text-ink-soft">試用版不錄音，會用示範口述；也可以打字。</p>}
    </section>
  );
}

/**
 * 口述的錄音、選檔、打字與之後的轉文字／整理狀態（計畫卡與「口述護理計畫」面板共用）。
 * fresh：面板裡重新開始，不顯示已存的口述狀態（那些在計畫卡上）。
 */
function Capture({
  visit,
  patient,
  fresh,
  onDone,
  onRedo,
  assessmentHref,
}: {
  visit: Visit;
  patient: Patient;
  fresh?: boolean;
  onDone?: () => void;
  onRedo?: () => void;
  assessmentHref?: string;
}) {
  const toast = useToast();
  const here = useDictatingHere(visit.id);
  const [typing, setTyping] = useState(false);
  const [longFile, setLongFile] = useState<{ file: File; ms: number } | null>(null);
  const [wait, setWait] = useState<string | null>(null);
  const [guide, setGuide] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const base = planBaseFor(visit, patient);
  const d = fresh ? null : visit.planDictation;
  const stale = useOlderThan(d?.status === "transcribing" || d?.status === "polishing" ? d.updatedAt : null, STALE_MS);

  const done = () => {
    setTyping(false);
    onDone?.();
  };

  const startMic = async () => {
    setTyping(false);
    const res = await startPlanDictation(visit.id, {
      onLimit: (reason) => {
        toast(reason === "limit" ? "已滿 8 分鐘，先整理這段" : "錄音被中斷，先整理已錄的這段");
        onDone?.();
      },
    });
    if (!res.ok) toast(res.message, { error: true, ms: 5000 });
  };

  const finish = async () => {
    setWait("收好錄音…");
    try {
      await finishPlanDictation(visit.id);
    } finally {
      setWait(null);
    }
    onDone?.();
    focusPlanCard();
  };

  const saveAudio = async (file: File, ms: number) => {
    const res = await savePlanDictationAudio(visit.id, file, { input: "file", fileName: file.name, durationMs: ms });
    if (!res.ok) return toast(res.message, { error: true, ms: 5000 });
    done();
    focusPlanCard();
  };

  const pickFile = async (file: File) => {
    const problem = voiceMemoProblem(file);
    if (problem) return toast(problem, { error: true, ms: 5000 });
    if (!isAudioFile(file)) return toast("請選錄音檔（例如 m4a、mp3、wav）", { error: true });
    if (file.size > PLAN_AUDIO_MAX_BYTES) return toast(TOO_BIG, { error: true, ms: 6000 });
    setWait("讀取錄音檔…");
    const ms = await audioDuration(file);
    setWait(null);
    // 試用版不轉錄檔案內容（一律用示範口述），不用問。
    if (!TRIAL && ms > LONG_FILE_MS) return setLongFile({ file, ms });
    await saveAudio(file, ms);
  };

  const asVisitAudio = async (file: File) => {
    setLongFile(null);
    try {
      const res = await addMaterial(visit.id, [file]);
      if (res) toast(storeSummary(res, "，重新整理中"), { ms: res.skipped.length ? 5000 : undefined, error: res.audio + res.docs === 0 });
      onDone?.();
    } catch (err) {
      toast(storageErrorMessage(err), { error: true });
    }
  };

  const input = (
    <input
      ref={fileRef}
      type="file"
      hidden
      accept={AUDIO_ACCEPT}
      onChange={(e) => {
        const file = e.target.files?.[0];
        e.target.value = "";
        if (file) void pickFile(file);
      }}
    />
  );

  let content: ReactNode;
  if (here) {
    content = <RecordingStrip replaces={!!base} onFinish={finish} />;
  } else if (wait) {
    content = (
      <p className="flex items-center gap-2 font-bold">
        <Spinner size={18} /> {wait}
      </p>
    );
  } else if (longFile) {
    content = (
      <div className="flex flex-col gap-2.5">
        <p className="font-bold leading-snug">{`這段錄音 ${Math.round(longFile.ms / 60_000)} 分鐘，比較像整段訪視錄音。`}</p>
        <Button variant="primary" block onClick={() => asVisitAudio(longFile.file)}>
          改當本次訪視錄音
        </Button>
        <Button
          block
          onClick={() => {
            const { file, ms } = longFile;
            setLongFile(null);
            void saveAudio(file, ms);
          }}
        >
          仍當口述計畫
        </Button>
      </div>
    );
  } else if (typing) {
    const redo = () => {
      setTyping(false);
      if (!fresh) onRedo?.();
    };
    content = <DictationText visit={visit} patient={patient} editing={false} fresh={fresh} onDone={done} onRedo={redo} onCancel={() => setTyping(false)} />;
  } else if (d?.status === "transcribing" || d?.status === "polishing") {
    content = (
      <div className="flex flex-col gap-2.5">
        <p className="flex items-center gap-2 font-bold">
          <Spinner size={18} /> {d.status === "transcribing" ? "轉文字中…" : "AI 整理中…"}
        </p>
        {stale && (
          <>
            <p className="text-[0.92rem] font-bold leading-snug text-ink-soft">等比較久了：可以先改用打字，或捨棄這次口述。</p>
            <div className="flex flex-wrap gap-2">
              {d.status === "polishing" && d.text ? (
                <Button size="sm" className={tap} onClick={() => setPlanDictationText(visit.id, d.text ?? "")}>
                  修改口述原文
                </Button>
              ) : (
                <Button size="sm" className={tap} icon={<Keyboard size={16} />} onClick={() => setTyping(true)}>
                  改用打字
                </Button>
              )}
              <Button size="sm" className={tap} variant="ghost" onClick={() => discardPlanDictation(visit.id)}>
                捨棄
              </Button>
            </div>
          </>
        )}
      </div>
    );
  } else if (d?.status === "failed" && !d.text) {
    const empty = d.error?.code === "empty";
    content = (
      <div className="flex flex-col gap-2.5">
        <p className="font-bold leading-snug text-danger">{empty ? d.error?.message : `轉文字沒有成功：${d.error?.message ?? ""}`}</p>
        <div className="flex flex-wrap gap-2">
          {d.audio && !empty ? (
            <Button size="sm" className={tap} variant="primary" icon={<RefreshCw size={16} />} onClick={() => transcribePlanDictation(visit.id)}>
              重試轉文字
            </Button>
          ) : (
            onRedo && (
              <Button size="sm" className={tap} variant="primary" icon={<Mic size={16} />} onClick={onRedo}>
                重新口述
              </Button>
            )
          )}
          <Button size="sm" className={tap} icon={<Keyboard size={16} />} onClick={() => setTyping(true)}>
            改用打字
          </Button>
          <Button size="sm" className={tap} variant="ghost" onClick={() => discardPlanDictation(visit.id)}>
            捨棄
          </Button>
        </div>
      </div>
    );
  } else if (d?.status === "failed") {
    // 太長或只聽到贅詞：文字留著讓護理師改，不重試整理。
    const empty = d.error?.code === "empty";
    const tooLong = d.error?.code === "too_long" || empty;
    content = (
      <div className="flex flex-col gap-2.5">
        <p className="font-bold leading-snug text-danger">{tooLong ? d.error?.message : `整理沒有成功：${d.error?.message ?? ""}`}</p>
        <div className="flex flex-wrap gap-2">
          {empty && onRedo && (
            <Button size="sm" className={tap} icon={<Mic size={16} />} onClick={onRedo}>
              重新口述
            </Button>
          )}
          {!tooLong && (
            <Button size="sm" className={tap} variant="primary" icon={<RefreshCw size={16} />} onClick={() => polishPlanDictation(visit.id)}>
              再整理一次
            </Button>
          )}
          <Button size="sm" className={tap} variant={tooLong ? "primary" : "secondary"} onClick={() => setPlanDictationText(visit.id, d.text ?? "")}>
            修改口述原文
          </Button>
          <Button size="sm" className={tap} variant="ghost" onClick={() => discardPlanDictation(visit.id)}>
            捨棄
          </Button>
        </div>
      </div>
    );
  } else if (d?.status === "review") {
    content = <DictationText key={d.id} visit={visit} patient={patient} editing onDone={done} onRedo={onRedo ?? (() => undefined)} onCancel={() => setTyping(false)} />;
  } else {
    content = (
      <div className="flex flex-col gap-2.5">
        {TRIAL ? (
          <Button variant="primary" size="xl" block className={wrap} icon={<FileAudio size={22} />} onClick={() => fileRef.current?.click()}>
            選錄音檔（示範）
          </Button>
        ) : (
          <Button variant="primary" size="xl" block className={wrap} icon={<Mic size={24} />} onClick={startMic}>
            {fresh ? "開始口述" : "口述護理計畫"}
          </Button>
        )}
        <div className={cx("grid gap-2.5", TRIAL ? "grid-cols-1" : "grid-cols-2 max-[374px]:grid-cols-1 [:root[data-size=large]_&]:grid-cols-1")}>
          {!TRIAL && (
            <Button icon={<FileAudio size={18} />} onClick={() => fileRef.current?.click()}>
              選錄音檔
            </Button>
          )}
          <Button icon={<Keyboard size={18} />} onClick={() => setTyping(true)}>
            打字輸入
          </Button>
        </div>
        <div className="flex flex-wrap gap-x-5 text-[0.95rem]">
          {/* 面板裡不再疊一層面板（Esc 會一次關兩層）：直接展開說明。 */}
          <button type="button" className={linkClass} aria-expanded={fresh ? guide : undefined} onClick={() => setGuide(fresh ? !guide : true)}>
            iPhone 語音備忘錄怎麼選？
          </button>
          {assessmentHref && (
            <Link to={assessmentHref} className={linkClass}>
              去填全人評估
            </Link>
          )}
        </div>
        {fresh && guide && (
          <div className="rounded-[22px] bg-card p-3.5 outline-ink">
            <VoiceMemoGuideContent purpose="plan" />
            <Button variant="primary" size="lg" block className="mt-3" icon={<FileAudio size={20} />} onClick={() => fileRef.current?.click()}>
              從檔案選錄音
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <>
      {content}
      {input}
      {/* onPick 在點擊當下同步開啟選檔（iOS 的使用者手勢規則）。 */}
      {!fresh && <VoiceMemoGuideSheet open={guide} onClose={() => setGuide(false)} onPick={() => fileRef.current?.click()} purpose="plan" />}
    </>
  );
}

/** 口述中：計時、音量、完成或取消；剩 1 分鐘時提醒。 */
function RecordingStrip({ replaces, onFinish }: { replaces: boolean; onFinish: () => void }) {
  const snap = useDictation();
  const level = Math.min(1, snap.level * 2.2);
  const root = useRef<HTMLDivElement>(null);
  const recording = snap.state === "recording";
  // 按下的「口述護理計畫／開始口述」已經換成這裡：焦點留在這一區（面板裡也不會跑出對話框），開始錄音後移到「完成口述」。
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const finishButton = el.querySelector<HTMLElement>("button[data-dictation-finish]");
    if (recording && finishButton) finishButton.focus({ preventScroll: true });
    else if (!el.contains(document.activeElement)) el.focus({ preventScroll: true });
  }, [recording]);
  return (
    <div ref={root} tabIndex={-1} aria-label="口述中" className="flex flex-col gap-3 outline-none">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-danger text-[#141414]">
          <Mic size={22} strokeWidth={2.6} />
        </span>
        <p className="font-round text-[1.35rem] font-extrabold leading-tight">
          {snap.state === "starting" ? (
            "準備麥克風…"
          ) : (
            <>
              口述中{" "}
              <span className="num" aria-live="off">
                {mss(snap.elapsedMs)}
              </span>
            </>
          )}
        </p>
      </div>
      <div aria-hidden className="h-2.5 overflow-hidden rounded-full bg-ink/10">
        <span className="block h-full rounded-full bg-ink transition-[width] duration-100" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <p className="font-bold leading-snug">依序說：問題、目標、措施、評值，家屬要做什麼</p>
      {replaces && <p className="text-[0.92rem] font-bold text-ink-soft">口述會取代沿用的計畫內容</p>}
      <div aria-live="polite">{snap.nearLimit && <p className="rounded-2xl bg-pending-tint px-3 py-2 font-bold">還有 1 分鐘（上限 8 分鐘）</p>}</div>
      <div className="grid grid-cols-[2fr_1fr] gap-2.5">
        <Button variant="primary" size="lg" data-dictation-finish="" icon={<Square size={18} fill="currentColor" />} disabled={snap.state !== "recording"} onClick={onFinish}>
          完成口述
        </Button>
        <Button size="lg" onClick={cancelPlanDictation}>
          取消
        </Button>
      </div>
    </div>
  );
}

/**
 * 口述文字：打字／貼上，或修正轉好的文字；按「AI 整理成計畫」才整理。
 * 計畫卡上離開欄位時先存著；「口述護理計畫」面板（fresh）裡不先存，關掉面板就是取消。
 */
function DictationText({
  visit,
  patient,
  editing,
  fresh,
  onDone,
  onRedo,
  onCancel,
}: {
  visit: Visit;
  patient: Patient;
  editing: boolean;
  fresh?: boolean;
  onDone: () => void;
  onRedo: () => void;
  onCancel: () => void;
}) {
  const settings = useSettings();
  const id = useId();
  const cur = editing ? visit.planDictation : null;
  const [text, setText] = useState(cur?.text ?? "");
  const [busy, setBusy] = useState(false);
  const demoSpoken = cur?.provider === "demo" && cur.input !== "typed";
  const label = demoSpoken
    ? TRIAL
      ? "示範口述（試用版不轉錄你的錄音）"
      : "口述原文（示範口述）"
    : cur && cur.input !== "typed"
      ? "口述原文（可修正錯字）"
      : cur?.provider === "demo"
        ? "口述內容（示範口述）"
        : "口述內容";
  const canDemo = TRIAL || patient.isDemo || settings.demoMode;
  const trimmed = text.trim();
  // 計畫卡上（不是面板）口述會取代沿用的現行計畫：提醒一次（不擋）。
  const replaces = !fresh && !!planBaseFor(visit, patient);
  // 新打的字存成「打字」的口述（取代之前的錄音）；修正既有的口述則保留原本的錄音。按「填入示範口述」沒改過的標成示範口述。
  const persist = (t: string) => {
    const typed = !cur || cur.input === "typed";
    return setPlanDictationText(visit.id, t, cur ? undefined : "typed", typed ? (t === DEMO_PLAN_DICTATION_TEXT.trim() ? "demo" : "typed") : undefined);
  };

  const submit = async () => {
    if (!dictationHasContent(trimmed) || busy) return;
    setBusy(true);
    try {
      await persist(trimmed);
      onDone();
      focusPlanCard();
      await polishPlanDictation(visit.id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <label htmlFor={id} className="font-extrabold leading-snug">
        {label}
      </label>
      {!cur && <p className="-mt-1.5 text-[0.9rem] font-bold text-ink-soft">可貼上語音備忘錄的「拷貝逐字稿」</p>}
      {replaces && <p className="-mt-1 text-[0.92rem] font-bold text-ink-soft">口述會取代沿用的計畫內容</p>}
      <textarea
        id={id}
        data-plan-dictation=""
        value={text}
        maxLength={PLAN_DICTATION_MAX_CHARS}
        rows={6}
        // 按「打字輸入」打開的：直接可以打字（iPhone 不用再點一次）。
        autoFocus={!editing}
        placeholder="例如：問題一 皮膚完整性受損，目標兩週內傷口不擴大，措施每次訪視換藥……"
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (!fresh && trimmed && trimmed !== (visit.planDictation?.text ?? "").trim() && !busy) void persist(trimmed);
        }}
        aria-describedby={`${id}-n`}
        className={textareaClass}
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span id={`${id}-n`} className="num text-[0.9rem] font-bold text-ink-soft">
          {`${text.length}/${PLAN_DICTATION_MAX_CHARS} 字`}
        </span>
        {canDemo && (
          <Button size="sm" className={tap} variant="soft" onClick={() => setText(DEMO_PLAN_DICTATION_TEXT)}>
            填入示範口述
          </Button>
        )}
      </div>
      <Button variant="primary" size="lg" block icon={busy ? <Spinner size={18} /> : <Sparkles size={20} />} disabled={!dictationHasContent(trimmed) || busy} onClick={submit}>
        AI 整理成計畫
      </Button>
      <div className="grid grid-cols-2 gap-2.5 max-[374px]:grid-cols-1 [:root[data-size=large]_&]:grid-cols-1">
        <Button icon={<Mic size={18} />} onClick={onRedo}>
          重新口述
        </Button>
        <Button
          variant="ghost"
          onClick={async () => {
            // 面板裡的捨棄只取消這次打字，不動計畫卡上待整理的口述。
            if (!fresh && visit.planDictation?.status === "review") await discardPlanDictation(visit.id);
            onCancel();
          }}
        >
          捨棄
        </Button>
      </div>
      <p className="text-[0.88rem] font-bold leading-snug text-ink-soft">AI 只調整語序、刪口語贅字、套進計畫格式；不新增問題、措施或數字。</p>
    </div>
  );
}

/** 「口述護理計畫」面板（改用口述／重新口述）：口述的內容成為新的完整計畫。錄音中不能關。 */
export function DictationSheet({ open, onClose, visit, patient }: { open: boolean; onClose: () => void; visit: Visit; patient: Patient }) {
  const base = planBaseFor(visit, patient);
  const has = visit.outputs.plan.versions.length > 0;
  return (
    <Sheet
      open={open}
      onClose={() => {
        if (!dictatingHere(visit.id)) onClose();
      }}
      title="口述護理計畫"
    >
      <div className="flex flex-col gap-3 pb-2">
        {base ? (
          <p className="rounded-2xl bg-pending-tint p-3 font-bold leading-snug">{`口述的內容會成為新的完整計畫；現行第 ${base.version} 版沒說到的問題不會帶入。`}</p>
        ) : has ? (
          <p className="rounded-2xl bg-pending-tint p-3 font-bold leading-snug">口述的內容會成為新的完整計畫；目前計畫沒說到的問題不會帶入。</p>
        ) : null}
        <p className="font-bold leading-snug text-ink-soft">AI 只整理語句，不會新增內容。</p>
        <Capture visit={visit} patient={patient} fresh onDone={onClose} />
        {TRIAL && <p className="text-[0.9rem] font-bold text-ink-soft">試用版不錄音，會用示範口述；也可以打字。</p>}
      </div>
    </Sheet>
  );
}

/** 口述整理的計畫：在草稿下方對照口述原文（可修正後重新整理）與錄音。 */
export function PlanDictationSource({ visit, open, onToggle }: { visit: Visit; open: boolean; onToggle: (open: boolean) => void }) {
  const out = visit.outputs.plan;
  const cur = out.versions[out.current];
  if (cur?.source !== "dictation" || !cur.sourceText) return null;
  return (
    <div className="mb-3 rounded-2xl bg-plan-tint p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-[10rem] flex-1 font-bold leading-snug">依護理師口述整理・AI 只整理語句</span>
        <Button size="sm" className={tap} variant="soft" aria-expanded={open} aria-controls="plan-source" onClick={() => onToggle(!open)}>
          {open ? "收起原文" : "對照口述原文"}
        </Button>
      </div>
      {open && <SourceText key={cur.id} visit={visit} version={cur} />}
    </div>
  );
}

function SourceText({ visit, version }: { visit: Visit; version: OutputVersion }) {
  const toast = useToast();
  const id = useId();
  const original = version.sourceText ?? "";
  const [text, setText] = useState(original);
  const d = visit.planDictation;
  const audio = d?.audio && d.id === version.dictationId ? d.audio : null;
  const [url, setUrl] = useState<string | null>(null);
  const busy = visit.outputs.plan.busy || d?.status === "polishing" || d?.status === "transcribing";
  const trimmed = text.trim();

  useEffect(() => {
    if (!audio) return;
    let live = true;
    let made: string | null = null;
    void getBlob(audio.blobKey).then((b) => {
      if (!b || !live) return;
      made = URL.createObjectURL(b);
      setUrl(made);
    });
    return () => {
      live = false;
      if (made) URL.revokeObjectURL(made);
      setUrl(null);
    };
  }, [audio?.blobKey]);

  return (
    <div id="plan-source" className="mt-3 flex flex-col gap-2.5">
      <label htmlFor={id} className="font-extrabold">
        {d?.provider === "demo" && d.id === version.dictationId ? (TRIAL && d.input !== "typed" ? "示範口述（試用版不轉錄你的錄音）" : "口述原文（示範口述）") : "口述原文"}
      </label>
      <textarea id={id} data-plan-source="" value={text} maxLength={PLAN_DICTATION_MAX_CHARS} rows={6} onChange={(e) => setText(e.target.value)} className={textareaClass} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="num text-[0.9rem] font-bold text-ink-soft">{`${text.length}/${PLAN_DICTATION_MAX_CHARS} 字`}</span>
        <Button
          size="sm"
          className={tap}
          variant="primary"
          icon={busy ? <Spinner size={16} /> : <Sparkles size={16} />}
          disabled={busy || !dictationHasContent(trimmed) || trimmed === original.trim()}
          onClick={async () => {
            await setPlanDictationText(visit.id, trimmed);
            toast("正在依修正後的口述重新整理");
            await polishPlanDictation(visit.id, { note: "依修正後的口述整理" });
          }}
        >
          改好重新整理
        </Button>
      </div>
      {url && (
        <audio controls preload="metadata" src={url} className="w-full">
          口述錄音
        </audio>
      )}
    </div>
  );
}

/** 「修改口述原文」：待整理或整理失敗時到計畫卡上的口述欄位，否則打開草稿下方的口述原文。 */
export async function editPlanDictation(visit: Visit, openSource: () => void) {
  const d = visit.planDictation;
  const focus = (selector: string) =>
    setTimeout(() => {
      const el = document.querySelector<HTMLTextAreaElement>(selector);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    }, 250);
  if (d?.status === "review" || (d?.status === "failed" && d.text)) {
    if (d.status === "failed") await setPlanDictationText(visit.id, d.text ?? "");
    focus("#sec-plan textarea[data-plan-dictation]");
    return;
  }
  openSource();
  focus("#sec-plan textarea[data-plan-source]");
}
