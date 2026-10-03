import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router";
import { Camera, ChevronLeft, Check, MoreHorizontal, Pause, Play, Shuffle, Trash2, Upload } from "lucide-react";
import { ActionSheet } from "../components/ActionSheet";
import { Critter } from "../components/Critter";
import { Name } from "../components/Name";
import { useToast } from "../components/Toast";
import { VitalsSheet } from "../components/VitalsSheet";
import { Button, RoundButton, cx } from "../components/ui";
import { useFlows } from "../app/Flows";
import { consentValid, deleteVisit, finishVisit, startRecording, storageErrorMessage, storeFiles, storeSummary } from "../lib/actions";
import { duration, shortDate } from "../lib/format";
import { usePatient, useRecorder, useVisit } from "../lib/hooks";
import { TRIAL } from "../lib/env";
import { TRIAL_NO_MIC, recorder } from "../lib/recorder";

export function Recording() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const dictate = params.get("mode") === "dictate";
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  const flows = useFlows();
  const visit = useVisit(id);
  const patient = usePatient(visit?.patientId);
  const rec = useRecorder();
  const [menu, setMenu] = useState(false);
  const [vitals, setVitals] = useState(false);
  const [dim, setDim] = useState(false);
  const [busy, setBusy] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const audioPick = useRef<HTMLInputElement>(null);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const mine = rec.visitId === id;
  const live = mine && (rec.state === "recording" || rec.state === "paused");
  const previousMs = visit?.parts.reduce((s, p) => s + p.durationMs, 0) ?? 0;
  const segment = (visit?.parts.length ?? 0) + (live ? 1 : 0);
  const startFailed = (location.state as { startFailed?: boolean } | null)?.startFailed;

  // 省電黑幕：20 秒沒有操作就變暗，點一下只會叫出按鈕。
  useEffect(() => {
    if (!live || rec.state !== "recording") return;
    const reset = () => {
      clearTimeout(idle.current);
      idle.current = setTimeout(() => setDim(true), 20_000);
    };
    reset();
    window.addEventListener("pointerdown", reset);
    return () => {
      clearTimeout(idle.current);
      window.removeEventListener("pointerdown", reset);
    };
  }, [live, rec.state]);

  if (visit === null || patient === null) {
    return (
      <div className="grid min-h-[100dvh] place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Critter kind="empty" size={80} />
          <p className="text-[1.2rem] font-bold">找不到這筆訪視</p>
          <Button variant="primary" onClick={() => navigate("/")}>
            回到今天
          </Button>
        </div>
      </div>
    );
  }
  if (!visit || !patient) return null;

  const begin = async () => {
    setBusy(true);
    await startRecording(visit.id);
    setBusy(false);
  };

  const done = async () => {
    setBusy(true);
    const res = await finishVisit(visit.id);
    setBusy(false);
    if (res === "empty") {
      toast("這次沒有錄到內容");
      navigate("/");
      return;
    }
    navigate(`/v/${visit.id}`, { replace: true });
  };

  const back = () => {
    if (rec.state === "recording") recorder.pause();
    if (location.key !== "default") navigate(-1);
    else navigate(`/v/${visit.id}`, { replace: true });
  };

  const ended = visit.status === "interrupted";
  const showStart = !live && rec.state !== "starting";
  const consentText = dictate ? "口述" : patient.consent && consentValid(patient) ? `已同意（${shortDate(patient.consent.at.slice(0, 10))}）` : "未記錄同意";

  return (
    <div className="relative flex min-h-[100dvh] flex-col bg-audio text-[#141414]">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          backgroundImage: "linear-gradient(rgba(20,20,20,.07) 1px, transparent 1px), linear-gradient(90deg, rgba(20,20,20,.07) 1px, transparent 1px)",
          backgroundSize: "28px 28px",
        }}
      />
      <header className="relative z-10 flex items-center gap-2 px-4 pb-2 pt-[max(env(safe-area-inset-top),14px)]">
        <RoundButton label="返回" onClick={back} tone="card">
          <ChevronLeft size={24} strokeWidth={2.6} />
        </RoundButton>
        <div className="flex min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-[#141414] px-4 py-2.5 text-white">
          <span className={cx("h-3 w-3 shrink-0 rounded-full", rec.state === "recording" && mine ? "animate-pulse bg-[#ff4a1c]" : "bg-white/50")} />
          <span className="truncate text-[1rem] font-bold">
            {live ? (rec.state === "paused" ? "已暫停" : dictate ? "口述中" : "錄音中") : "準備錄音"}・<Name name={patient.name} />・{consentText}
          </span>
        </div>
        <RoundButton label="更多" onClick={() => setMenu(true)} tone="card">
          <MoreHorizontal size={22} />
        </RoundButton>
      </header>

      <main className="relative z-10 mx-auto flex w-full max-w-[560px] flex-1 flex-col items-center justify-center gap-4 px-5 pb-[calc(env(safe-area-inset-bottom)+24px)]">
        {ended && !live && (
          <div className="w-full rounded-[24px] bg-pending p-4 font-bold outline-ink">
            錄音中斷了，前面 {duration(previousMs)} 已安全保存。可以繼續錄第 {visit.parts.length + 1} 段，或直接完成訪視。
          </div>
        )}
        {TRIAL ? (
          <div className="flex w-full items-center gap-3 rounded-[24px] bg-card p-4 font-bold text-ink outline-ink">
            <Critter kind="pending" size={44} />
            <span>{TRIAL_NO_MIC}</span>
          </div>
        ) : !live && ((rec.state === "error" && mine) || startFailed) ? (
          <div className="w-full rounded-[24px] bg-card p-4 font-bold text-ink outline-ink">
            <div className="mb-3 flex items-center gap-3">
              <Critter kind="error" size={44} />
              <span>{rec.error ?? "麥克風無法啟動。"}</span>
            </div>
            <Button block icon={<Upload size={20} />} onClick={() => audioPick.current?.click()}>
              選錄音檔
            </Button>
          </div>
        ) : null}

        <div className="relative my-2 grid place-items-center">
          {live && rec.state === "recording" && (
            <>
              <span className="absolute h-[230px] w-[230px] animate-pulse-ring rounded-full bg-white/40" />
              <span className="absolute rounded-full bg-white/35 transition-[width,height] duration-100" style={{ width: 170 + rec.level * 120, height: 170 + rec.level * 120 }} />
            </>
          )}
          <span className="relative grid h-[190px] w-[190px] place-items-center rounded-full bg-[#141414]">
            <Critter kind="audio" size={118} animate={live && rec.state === "recording"} />
          </span>
        </div>

        <div className="num text-[4.2rem] font-extrabold leading-none tracking-tight" aria-live="off">
          {duration(previousMs + (mine ? rec.elapsedMs : 0))}
        </div>
        <p className="text-[1.02rem] font-bold">
          {live
            ? `第 ${segment} 段・即時存在這台裝置`
            : visit.parts.length
              ? `已加入 ${visit.parts.length} 段錄音`
              : TRIAL
                ? "選一個錄音檔，或拍文件、記數值"
                : dictate
                  ? "對著手機說今天的訪視重點"
                  : "手機放在床邊就好，照護時不用碰"}
        </p>
        {live && rec.state === "recording" && rec.elapsedMs > 3000 && rec.level < 0.04 && <p className="rounded-full bg-white/60 px-3 py-1 text-[0.92rem] font-bold">聲音偏小，手機放近一點</p>}

        <div className="mt-2 grid w-full grid-cols-2 gap-3">
          <Button size="lg" onClick={() => setVitals(true)}>
            數值速記
          </Button>
          <Button
            size="lg"
            icon={<Camera size={20} />}
            onClick={() => {
              if (rec.state === "recording") recorder.pause();
              camera.current?.click();
            }}
          >
            拍文件
          </Button>
        </div>

        {TRIAL ? (
          <div className="flex w-full flex-col gap-3">
            {(visit.parts.length > 0 || visit.documents.length > 0 || Object.keys(visit.typedVitals).length > 0) && (
              <Button variant="primary" size="xl" block icon={<Check size={24} strokeWidth={3} />} onClick={done} disabled={busy}>
                完成訪視
              </Button>
            )}
            <Button variant={visit.parts.length ? "secondary" : "primary"} size={visit.parts.length ? "lg" : "xl"} block icon={<Upload size={22} />} onClick={() => audioPick.current?.click()}>
              {visit.parts.length ? "再選一個錄音檔" : "選錄音檔"}
            </Button>
          </div>
        ) : showStart ? (
          <div className="flex w-full flex-col gap-3">
            <Button variant="primary" size="xl" block onClick={begin} disabled={busy}>
              {visit.parts.length ? `繼續錄音（第 ${visit.parts.length + 1} 段）` : dictate ? "開始口述" : "開始錄音"}
            </Button>
            {(visit.parts.length > 0 || visit.documents.length > 0 || Object.keys(visit.typedVitals).length > 0) && (
              <Button size="lg" block icon={<Check size={22} strokeWidth={3} />} onClick={done} disabled={busy}>
                完成訪視
              </Button>
            )}
          </div>
        ) : (
          <div className="flex w-full items-center gap-3">
            <button
              type="button"
              aria-label={rec.state === "paused" ? "繼續錄音" : "暫停"}
              onClick={() => (rec.state === "paused" ? recorder.resume() : recorder.pause())}
              className="sticker grid h-[76px] w-[76px] shrink-0 place-items-center rounded-full bg-card"
              disabled={rec.state === "starting"}
            >
              {rec.state === "paused" ? <Play size={30} fill="currentColor" /> : <Pause size={30} fill="currentColor" />}
            </button>
            <Button variant="primary" size="xl" className="flex-1" icon={<Check size={24} strokeWidth={3} />} onClick={done} disabled={busy || rec.state === "starting"}>
              完成訪視
            </Button>
          </div>
        )}
      </main>

      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          try {
            const res = await storeFiles(visit.id, files);
            toast(res.skipped.length ? storeSummary(res) : `已加入 ${res.docs} 張文件照片`, { error: res.docs === 0 });
          } catch (err) {
            toast(storageErrorMessage(err), { error: true });
          }
        }}
      />
      <input
        ref={audioPick}
        type="file"
        accept="audio/*,.m4a,.mp3,.wav,.aac,.webm"
        multiple
        hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          try {
            const res = await storeFiles(visit.id, files);
            toast(res.skipped.length ? storeSummary(res) : `已加入 ${res.audio} 個錄音檔`, { error: res.audio === 0 });
          } catch (err) {
            toast(storageErrorMessage(err), { error: true });
          }
        }}
      />

      <VitalsSheet visit={visit} open={vitals} onClose={() => setVitals(false)} />

      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title="錄音選項"
        items={[
          { label: "選錄音檔加入", icon: <Upload size={22} />, onSelect: () => audioPick.current?.click() },
          {
            label: "錄錯人了：改到其他個案",
            icon: <Shuffle size={22} />,
            onSelect: () => flows.moveTo(visit.id, patient.id),
          },
          {
            label: "放棄這次錄音",
            icon: <Trash2 size={22} />,
            danger: true,
            hint: "錄音與數值都會刪除，5 秒內可復原",
            onSelect: async () => {
              const undo = await deleteVisit(visit.id);
              navigate("/", { replace: true });
              toast("已刪除這次錄音", undo ? { action: { label: "復原", run: () => void undo() } } : undefined);
            },
          },
        ]}
      />

      {dim && (
        <button
          type="button"
          aria-label="顯示按鈕"
          onClick={() => setDim(false)}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-black text-white/60"
        >
          <span className="h-3 w-3 animate-pulse rounded-full bg-[#ff4a1c]" />
          <span className="num text-[3rem] font-bold">{duration(previousMs + (mine ? rec.elapsedMs : 0))}</span>
          <span className="text-[1rem] font-bold">點一下顯示按鈕</span>
        </button>
      )}
    </div>
  );
}
