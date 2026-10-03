import { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";
import { VITAL_LABEL, VITAL_UNIT, type VitalKey } from "../../shared/types";
import { DEMO_VITALS_UTTERANCE, parseSpokenVitals } from "../../shared/vitalsSpeech";
import { setVital } from "../lib/actions";
import type { Visit } from "../lib/model";
import { VITAL_ORDER, plausible } from "../lib/vitals";
import { useSettings } from "../lib/hooks";
import { usePushToTalk, type PttOutcome, type PushToTalk } from "../lib/pushToTalk";
import { Sheet } from "./Sheet";
import { Button, Chip, cx } from "./ui";

const CONSCIOUS_CHIPS = ["清醒", "可喚醒", "嗜睡", "混亂", "昏迷"];
const SPO2_CHIPS = ["室內空氣", "氧氣 2L", "氧氣 3L", "拍痰後"];
const GLU_CHIPS = ["飯前", "飯後", "隨機"];

const SAY_AGAIN = "沒聽到數值，請再說一次（例：體溫三十六點八、血壓一百四十二之八十六）";
const TRIAL_FILLED = "試用版不能用麥克風，已用示範口述填入";

/** 口述的結果：一行說明＋聽到的原句。 */
interface VoiceNote {
  text: string;
  heard: string | null;
  ok: boolean;
}

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
  // 關閉時卸載，下次打開重新帶入目前的值。
  if (!open) return null;
  return <VitalsForm visit={visit} onDone={onClose} focus={focus ?? null} />;
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

  // 按住麥克風口述：放開後解析並填入草稿（跟手動輸入一樣，按「儲存」才存）；只改說到的項目。
  const [voice, setVoice] = useState<VoiceNote | null>(null);
  const [flash, setFlash] = useState<VitalKey[]>([]);
  useEffect(() => {
    if (flash.length === 0) return;
    const t = setTimeout(() => setFlash([]), 1500);
    return () => clearTimeout(t);
  }, [flash]);

  const onVoice = (o: PttOutcome) => {
    const { values } = parseSpokenVitals(o.text);
    const keys = order.filter((k) => values[k]);
    const heard = o.text.trim() || null;
    if (keys.length === 0) {
      setVoice({ text: SAY_AGAIN, heard, ok: false });
      return;
    }
    setDraft((d) => {
      const next = { ...d };
      for (const k of keys) {
        const v = values[k]!;
        if (k !== "bp") next[k] = { value: v.value, qualifier: v.qualifier ?? d[k].qualifier };
      }
      return next;
    });
    const [s, dd] = values.bp?.value.split("/") ?? [];
    if (s && dd) setBp({ s, d: dd });
    setFlash(keys);
    setVoice({ text: o.source === "demo" ? TRIAL_FILLED : `已填入：${keys.map((k) => VITAL_LABEL[k]).join("、")}`, heard, ok: true });
  };
  const ptt = usePushToTalk({ onResult: onVoice, demoText: DEMO_VITALS_UTTERANCE });

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
    <Sheet
      open
      onClose={onDone}
      title="數值速記"
      action={<MicButton ptt={ptt} />}
      footer={
        <Button variant="primary" size="xl" block onClick={save}>
          儲存
        </Button>
      }
    >
      <VoiceStatus ptt={ptt} note={ptt.phase === "done" ? voice : null} />
      <div className="flex flex-col gap-3 pb-2">
        {order.map((k) => {
          const d = draft[k];
          const bad = k !== "bp" && d.value && !plausible(k, d.value);
          // 單一數字的項目：名稱與輸入框同一排，一個畫面放得下大部分項目。
          const single = k !== "bp" && k !== "consciousness";
          const head = (
            <>
              <span className="text-[1.05rem] font-extrabold">{VITAL_LABEL[k]}</span>
              <span className="text-[0.9rem] font-bold text-ink-soft">{VITAL_UNIT[k]}</span>
            </>
          );
          return (
            // 從工作台點某一格打開時，那一格用黃框標出（取代墨線框）；口述剛填入的格子綠框閃一下。
            <div
              key={k}
              className={cx(
                "rounded-[22px] p-3.5 transition-[background-color,box-shadow] duration-300",
                flash.includes(k) ? "bg-ok-tint shadow-[inset_0_0_0_3px_var(--ok)]" : focus === k ? "bg-card shadow-[inset_0_0_0_3px_var(--pending)]" : "bg-card outline-ink",
              )}
            >
              {single ? (
                <div className="grid grid-cols-[1fr_8.5rem] items-center gap-3">
                  <span className="flex min-w-0 flex-col">{head}</span>
                  <NumInput label={VITAL_LABEL[k]} value={d.value} onChange={(value) => set(k, { value })} autoFocus={focus === k} decimal={k === "temp"} compact />
                </div>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">{head}</div>
                  {k === "bp" ? (
                    <div className="flex items-center gap-2">
                      <NumInput label="收縮壓" value={bp.s} onChange={(s) => setBp((b) => ({ ...b, s }))} autoFocus={focus === "bp"} />
                      <span className="num text-[2rem] font-bold text-ink-soft">/</span>
                      <NumInput label="舒張壓" value={bp.d} onChange={(dd) => setBp((b) => ({ ...b, d: dd }))} />
                    </div>
                  ) : (
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
                  )}
                </>
              )}
              {bad && <p className="mt-2 text-[0.92rem] font-bold text-danger">超出常見範圍，請確認</p>}
              {(k === "spo2" || k === "glucose") && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {qualifierChips(k === "spo2" ? SPO2_CHIPS : GLU_CHIPS, d.qualifier).map((c) => (
                    <Chip key={c} active={d.qualifier === c} onClick={() => set(k, { qualifier: d.qualifier === c ? "" : c })}>
                      {c}
                    </Chip>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Sheet>
  );
}

function NumInput({ label, value, onChange, autoFocus, decimal, compact }: { label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; decimal?: boolean; compact?: boolean }) {
  return (
    <input
      aria-label={label}
      inputMode={decimal ? "decimal" : "numeric"}
      value={value}
      autoFocus={autoFocus}
      placeholder="—"
      onChange={(e) => onChange(e.target.value.replace(decimal ? /[^\d.]/g : /\D/g, "").slice(0, decimal ? 4 : 3))}
      className={cx(
        "num w-full min-w-0 rounded-2xl bg-sunken px-4 text-center font-extrabold outline-none placeholder:text-ink-faint focus:shadow-[inset_0_0_0_3px_var(--ink)]",
        compact ? "min-h-[56px] text-[1.8rem]" : "min-h-[68px] text-[2.2rem]",
      )}
    />
  );
}

/** 附註不在選項裡（例：口述「氧氣 4L」）時多顯示一顆，才看得到、也能點掉。 */
function qualifierChips(chips: string[], current: string): string[] {
  return current && !chips.includes(current) ? [...chips, current] : chips;
}

/** 標題列的麥克風：按住說、放開填入（只點一下會提示要按住）；鍵盤 Space／Enter、讀屏按一次開始、再按一次結束。 */
function MicButton({ ptt }: { ptt: PushToTalk }) {
  const gesture = useRef({ down: false, lastUp: -Infinity, lastKey: -Infinity });
  const listening = ptt.phase === "listening";
  const busy = ptt.phase === "finishing";
  const up = () => {
    const g = gesture.current;
    if (!g.down) return;
    g.down = false;
    g.lastUp = performance.now();
    ptt.release();
  };
  return (
    <button
      type="button"
      aria-label="按住說出數值"
      title="按住說出數值"
      aria-pressed={listening}
      aria-busy={busy || undefined}
      className={cx(
        "relative inline-grid h-11 w-11 shrink-0 place-items-center rounded-full transition-[transform,background-color] active:scale-95",
        listening ? "bg-audio text-[#141414] shadow-[0_0_0_4px_var(--audio-tint)]" : "bg-card text-ink outline-ink",
        busy && "opacity-60",
      )}
      // 長按不要跳出 iOS 選單、選取文字或捲動頁面。
      style={{ touchAction: "none", WebkitTouchCallout: "none", WebkitUserSelect: "none", userSelect: "none" }}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        // 鍵盤開始的那次：按一下就結束。
        if (listening && ptt.via === "toggle") {
          gesture.current.lastUp = performance.now();
          ptt.release();
          return;
        }
        // 手指稍微滑出按鈕也不中斷。
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // 合成事件沒有 pointer
        }
        gesture.current.down = true;
        ptt.press("pointer");
      }}
      onPointerUp={up}
      onPointerCancel={up}
      onLostPointerCapture={up}
      onKeyDown={(e) => {
        if (e.key !== " " && e.key !== "Enter") return;
        e.preventDefault();
        if (e.repeat) return;
        gesture.current.lastKey = performance.now();
        ptt.toggle();
      }}
      onClick={() => {
        // 讀屏（VoiceOver 點兩下）等沒有按下／放開的點擊：當成切換。
        const g = gesture.current;
        const now = performance.now();
        if (g.down || now - g.lastUp < 800 || now - g.lastKey < 800) return;
        ptt.toggle();
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {listening && <span aria-hidden className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full bg-audio motion-reduce:hidden" />}
      <Mic size={22} strokeWidth={2.6} className="relative" />
    </button>
  );
}

/** 標題下方的口述狀態：聽取中／辨識中／結果，加上「聽到：…」。 */
function VoiceStatus({ ptt, note }: { ptt: PushToTalk; note: VoiceNote | null }) {
  const key = ptt.via === "toggle";
  let line: string | null = null;
  let heard: string | null = null;
  let tone = "bg-ink/[0.06]";
  if (ptt.phase === "listening") {
    tone = "bg-audio-tint";
    if (ptt.engine === "demo") line = key ? "試用版不能用麥克風，再按一次即填入示範口述" : "試用版不能用麥克風，放開即填入示範口述";
    else line = key ? "聽取中…再按一次即填入" : "聽取中…放開即填入";
    if (ptt.engine === "speech") heard = ptt.interim || "…";
  } else if (ptt.phase === "finishing") {
    line = ptt.engine === "record" ? "轉文字中…" : "辨識中…";
    heard = ptt.interim || null;
  } else if (ptt.phase === "error") {
    line = ptt.error;
    tone = "bg-pending-tint";
  } else if (note) {
    line = note.text;
    heard = note.heard;
    tone = note.ok ? "bg-ok-tint" : "bg-pending-tint";
  }
  return (
    // 黏在捲動區頂端：往下捲也看得到。
    <div className="sticky top-0 z-10 -mx-5 bg-paper px-5 md:-mx-7 md:px-7">
      <div className={cx(line && "mb-3 rounded-2xl px-4 py-2.5", line && tone)}>
        <p role="status" aria-live="polite" className="text-[0.98rem] font-bold leading-snug">
          {line}
        </p>
        {line && heard && <p className="mt-0.5 break-words text-[0.92rem] leading-snug text-ink-soft">聽到：{heard}</p>}
      </div>
    </div>
  );
}
