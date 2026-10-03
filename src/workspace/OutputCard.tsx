import { useState } from "react";
import { AlertTriangle, Ban, Check, ClipboardList, Copy, History, Languages, Mic, MoreHorizontal, Pencil, PenLine, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { LANG_LABEL, type DocKind, type TranslateLang } from "../../shared/types";
import { ActionSheet } from "../components/ActionSheet";
import { Critter, type CritterKind } from "../components/Critter";
import { useToast } from "../components/Toast";
import { Button, Pill, RoundButton, Segmented, Spinner, cx } from "../components/ui";
import { ackWarnings, blockersFor, confirmAndCopy, confirmOnly, decideSuggestion, deferPlan, hasOpenWarnings, markEduCopied, markEduShared, resolveCandidate, type Blocker } from "../lib/actions";
import { charCount, docBody, docHeader, docTitle, eduShareText, shareToLine, writeClipboard } from "../lib/compose";
import { TRIAL } from "../lib/env";
import { clock } from "../lib/format";
import { useSettings } from "../lib/hooks";
import type { Patient, Visit } from "../lib/model";
import { draftPlanFrom, translateEdu } from "../lib/pipeline";
import { hasUnverified, planAutoWritable, planSlot } from "../lib/planSlot";
import { EditSheet, RegenerateSheet, VersionsSheet } from "./DocSheets";
import { DictationSheet, PlanDictationSource, PlanPanel, PlanSourcePill, editPlanDictation, planStatusLabel } from "./PlanPanel";

const STYLE: Record<DocKind, { bg: string; tint: string; critter: CritterKind }> = {
  record: { bg: "bg-record", tint: "bg-record-tint", critter: "record" },
  plan: { bg: "bg-plan", tint: "bg-plan-tint", critter: "plan" },
  edu: { bg: "bg-edu", tint: "bg-edu-tint", critter: "edu" },
};

export function OutputCard({
  kind,
  visit,
  patient,
  onBlocked,
  demo,
}: {
  kind: DocKind;
  visit: Visit;
  patient: Patient;
  onBlocked: (kind: DocKind, blockers: Blocker[]) => void;
  demo: boolean;
}) {
  const settings = useSettings();
  const toast = useToast();
  const out = visit.outputs[kind];
  const st = STYLE[kind];
  const title = docTitle(kind, settings);
  const [menu, setMenu] = useState(false);
  const [edit, setEdit] = useState(false);
  const [regen, setRegen] = useState(false);
  const [versions, setVersions] = useState<"list" | "compare" | null>(null);
  const [justCopied, setJustCopied] = useState(false);
  const [picked, setLang] = useState<TranslateLang | null>(null);
  const lang = picked ?? settings.translateLang;
  const [showTr, setShowTr] = useState(false);
  const [dictate, setDictate] = useState(false);
  const [srcOpen, setSrcOpen] = useState(false);

  const has = out.versions.length > 0;
  const isPlan = kind === "plan";
  // 計畫只有依全人評估／沿用時才會自動撰寫（待口述、口述、本次不擬不寫）。
  const planAuto = isPlan && planAutoWritable(visit, patient);
  const writing = out.status === "writing" || (out.status === "idle" && visit.status === "processing" && (!isPlan || planAuto));
  const warnings = out.versions[out.current]?.warnings ?? [];
  const warningsOpen = hasOpenWarnings(out);
  const body = has ? docBody(kind, visit, settings) : "";
  const chars = charCount(body);
  const confirmed = out.status === "confirmed";
  const pendingSuggestions = planAuto ? (visit.analysis?.planSuggestions ?? []).filter((s) => !visit.suggestions[s.id]) : [];
  // 口述的計畫只用護理師的口述，不受評估異動影響。
  const changesOpen = isPlan && visit.planSource !== "dictation" && (visit.analysis?.changes ?? []).some((c) => !visit.dismissedChanges.includes(c.id)) && !visit.changesConfirmed;
  const slot = isPlan ? planSlot(visit, patient) : null;
  const planSrc = visit.planSource ?? slot?.mode;
  const dictSrc = isPlan && visit.planSource === "dictation";

  const docLabel = writing
    ? "撰寫中"
    : out.status === "failed"
      ? "沒有產生成功"
      : confirmed
        ? `已確認・${out.confirmedBy ?? ""} ${clock(out.confirmedAt)}`
        : out.status === "edited"
          ? "已修改"
          : "AI 草稿";
  const statusLabel = (isPlan ? planStatusLabel(visit, patient) : null) ?? docLabel;

  const flash = () => {
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
    navigator.vibrate?.(30);
  };

  const copy = async () => {
    const res = await confirmAndCopy(visit, kind, patient, settings);
    if (res.blockers.length) return onBlocked(kind, res.blockers);
    if (!res.ok) return toast("無法寫入剪貼簿，請長按文字自行複製", { error: true });
    flash();
    toast(`已確認並複製${title}（${res.chars} 字）`);
  };

  const shareEdu = async (withLang?: TranslateLang) => {
    // 已確認也要再檢查：補資料或改個案後正在重新整理時不能分享。
    const blockers = blockersFor(visit, "edu");
    if (blockers.length) return onBlocked("edu", blockers);
    const text = eduShareText(visit, patient, settings, withLang);
    // 先寫剪貼簿（點擊後第一個非同步動作），再確認與分享。
    const copied = await writeClipboard(text);
    // 試用版只靠複製：沒複製成功就不要標成已確認。
    if (TRIAL && !copied) return toast("無法寫入剪貼簿，請長按文字自行複製", { error: true });
    if (!confirmed) await confirmOnly(visit, "edu");
    const how = await shareToLine(text);
    if (how === "cancelled") return;
    if (how === "copied") await markEduCopied(visit.id);
    else await markEduShared(visit.id);
    toast(how === "line" ? "已複製，正在開啟 LINE" : how === "copied" ? "已複製，請到 LINE 貼上給家屬" : "已分享");
  };

  const tr = visit.translations[lang];

  return (
    <article id={`sec-${kind}`} aria-label={title} className="scroll-mt-32 overflow-hidden rounded-[30px] bg-card outline-ink">
      <header className={cx("contours flex items-center gap-3 px-4 py-3.5 text-[#141414] md:px-5", st.bg)}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-card outline-ink">
          <Critter kind={st.critter} size={36} animate={writing} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-round text-[1.35rem] font-extrabold leading-tight">
            {title}
            {kind === "record" && !visit.intakeOnly && <span className="ml-1.5 text-[0.95rem]">本次病摘</span>}
          </h2>
          <p className="text-[0.92rem] font-bold leading-snug">
            {statusLabel}
            {has && !writing ? `・${chars} 字` : ""}
            {out.copiedAt && !writing ? `・已複製 ${clock(out.copiedAt)}` : ""}
            {kind === "edu" && out.sharedAt ? `・已分享 ${clock(out.sharedAt)}` : ""}
          </p>
        </div>
        {has && (
          <RoundButton label={`${title}更多選項`} size={44} onClick={() => setMenu(true)}>
            <MoreHorizontal size={22} />
          </RoundButton>
        )}
      </header>

      <div className="p-4 md:p-5">
        {out.candidate !== null && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl bg-pending-tint p-3 font-bold">
            <span className="flex-1">有新版本可比較</span>
            <Button size="sm" onClick={() => setVersions("compare")}>
              比較
            </Button>
          </div>
        )}

        {changesOpen && has && (
          <div className="mb-3 rounded-2xl bg-pending-tint p-3 font-bold">
            先確認評估異動
            <button
              type="button"
              onClick={() => document.getElementById("sec-check")?.scrollIntoView({ behavior: "smooth", block: "start" })}
              className="ml-2 min-h-[40px] font-extrabold underline underline-offset-4"
            >
              前往
            </button>
          </div>
        )}

        {isPlan && <PlanPanel visit={visit} patient={patient} />}

        {pendingSuggestions.map((s) => (
          <div key={s.id} className="mb-3 rounded-2xl bg-pending-tint p-3">
            <p className="font-extrabold">建議新增：{s.problem}</p>
            <p className="mt-0.5 text-[0.95rem] text-ink-soft">依據：{s.basis}</p>
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" onClick={() => decideSuggestion(visit.id, s.id, "adopted")}>
                採用
              </Button>
              <Button size="sm" onClick={() => decideSuggestion(visit.id, s.id, "skipped")}>
                略過
              </Button>
            </div>
          </div>
        ))}

        {writing && !has && (
          <div className="flex flex-col gap-3 py-2" aria-busy="true">
            <p className="flex items-center gap-2 font-bold text-ink-soft">
              <Spinner size={18} /> 完成後可複製
            </p>
            {[92, 80, 86, 60].map((w, i) => (
              <span key={i} className={cx("block h-4 animate-pulse rounded-full", st.tint)} style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {out.status === "failed" && !has && (!isPlan || planAuto) && (
          <div className="flex flex-col gap-3 py-2">
            <p className="flex items-center gap-2 font-bold text-danger">
              <Critter kind="error" size={30} />
              {out.error?.message ?? `${title}沒有產生成功`}
            </p>
            <Button onClick={() => setRegen(true)} icon={<RefreshCw size={18} />}>
              重試這份
            </Button>
            {isPlan && (
              <Button onClick={() => setDictate(true)} icon={<Mic size={18} />}>
                改用口述
              </Button>
            )}
          </div>
        )}

        {has && (
          <>
            {(out.status === "writing" || out.busy) && (
              <p className="mb-2 flex items-center gap-2 text-[0.95rem] font-bold text-ink-soft" aria-live="polite">
                <Spinner size={16} /> {out.status === "writing" ? "正在產生新版本…" : "產生新版本中…"}
              </p>
            )}
            {warnings.length > 0 && warningsOpen && (
              <div className="mb-3 rounded-2xl bg-pending-tint p-3">
                <p className="flex items-center gap-2 font-extrabold">
                  <AlertTriangle size={18} strokeWidth={2.6} /> 複製前請先看過
                </p>
                <ul className="mt-1.5 flex list-disc flex-col gap-1 pl-6 text-[0.98rem]">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button size="sm" variant="primary" onClick={() => ackWarnings(visit.id, kind)}>
                    看過了
                  </Button>
                  <Button size="sm" onClick={() => setEdit(true)}>
                    修改
                  </Button>
                </div>
              </div>
            )}
            {isPlan && hasUnverified(out) && (
              <p className="mb-3 rounded-2xl bg-pending-tint p-3 font-bold leading-snug">有〔待核對〕：口述沒有說過的數字或用詞，請按「修改」刪除或改正後再確認</p>
            )}
            {out.error && (
              <p className="mb-2 text-[0.95rem] font-bold text-danger">
                新版本沒有產生成功：{out.error.message}
              </p>
            )}
            <p className="mb-2 flex flex-wrap items-center gap-2 text-[0.9rem] font-bold text-ink-soft">
              {demo && <Pill tone="pending">示範資料</Pill>}
              {docHeader(kind, visit, patient, settings)}
              {isPlan && <PlanSourcePill visit={visit} patient={patient} />}
            </p>
            <div className="whitespace-pre-line text-[1.08rem] leading-[1.75]">
              {body.split("\n\n").map((block, i) => {
                const [first, ...rest] = block.split("\n");
                const isHeading = rest.length > 0 && first.length <= 22 && !/[。，]$/.test(first);
                return (
                  <p key={i} className="mb-3">
                    {isHeading ? (
                      <>
                        <strong className="font-extrabold">{first}</strong>
                        {"\n"}
                        {rest.join("\n")}
                      </>
                    ) : (
                      block
                    )}
                  </p>
                );
              })}
            </div>
            {isPlan && <PlanDictationSource visit={visit} open={srcOpen} onToggle={setSrcOpen} />}

            <div className="mt-2 flex flex-col gap-2.5">
              {kind === "edu" ? (
                <>
                  <Button variant="primary" size="lg" block icon={<Send size={20} />} onClick={() => shareEdu()} disabled={out.status === "writing"}>
                    {TRIAL ? (confirmed ? "再複製（貼到 LINE）" : "確認並複製（貼到 LINE）") : confirmed ? "再分享到 LINE" : "確認並分享到 LINE"}
                  </Button>
                  <div className="grid grid-cols-2 gap-2.5 [:root[data-size=large]_&]:grid-cols-1">
                    <Button block icon={justCopied ? <Check size={20} strokeWidth={3} /> : <Copy size={19} />} onClick={copy} disabled={out.status === "writing"}>
                      {justCopied ? "已複製" : "只複製"}
                    </Button>
                    <Button block icon={<Languages size={19} />} onClick={() => setShowTr((v) => !v)} aria-expanded={showTr}>
                      翻譯給看護
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  variant="primary"
                  size="lg"
                  block
                  icon={justCopied ? <Check size={22} strokeWidth={3} /> : <Copy size={20} />}
                  onClick={copy}
                  disabled={out.status === "writing"}
                  className={justCopied ? "animate-pop" : ""}
                >
                  {justCopied ? "已複製 ✓" : confirmed ? `再複製一次${title}` : `確認並複製${title}`}
                </Button>
              )}
              {kind === "plan" && !confirmed && <p className="text-center text-[0.9rem] font-bold text-ink-soft">確認後設為第 {(patient.plan?.version ?? 0) + 1} 版</p>}
              <Button variant="soft" block icon={<Pencil size={18} />} onClick={() => setEdit(true)} disabled={out.status === "writing"}>
                修改
              </Button>
            </div>

            {kind === "edu" && showTr && (
              <div className="mt-4 rounded-[22px] bg-edu-tint p-4">
                <Segmented
                  label="翻譯語言"
                  value={lang}
                  onChange={setLang}
                  options={(Object.keys(LANG_LABEL) as TranslateLang[]).map((l) => ({ value: l, label: LANG_LABEL[l] }))}
                />
                {!confirmed ? (
                  <div className="mt-3 flex flex-col gap-2">
                    <Button
                      variant="primary"
                      icon={<ShieldCheck size={19} />}
                      onClick={async () => {
                        const b = await confirmOnly(visit, "edu");
                        if (b.length) onBlocked("edu", b);
                      }}
                    >
                      確認中文版後翻譯
                    </Button>
                  </div>
                ) : tr?.status === "writing" ? (
                  <p className="mt-3 flex items-center gap-2 font-bold">
                    <Spinner size={18} /> 翻譯中…
                  </p>
                ) : tr?.status === "done" ? (
                  <div className="mt-3">
                    <p className="whitespace-pre-line rounded-2xl bg-card p-3 text-[1.02rem] leading-relaxed">{tr.text}</p>
                    <div className={cx("mt-2 grid gap-2", TRIAL ? "grid-cols-1" : "grid-cols-2")}>
                      {!TRIAL && (
                        <Button icon={<Send size={18} />} onClick={() => shareEdu(lang)}>
                          分享譯文
                        </Button>
                      )}
                      <Button
                        icon={<Copy size={18} />}
                        onClick={async () => {
                          if (await writeClipboard(tr.text)) toast(`已複製${LANG_LABEL[lang]}`);
                          else toast("無法寫入剪貼簿，請長按文字自行複製", { error: true });
                        }}
                      >
                        複製譯文
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-col gap-2">
                    {tr?.status === "failed" && <p className="font-bold text-danger">翻譯沒有成功：{tr.error}</p>}
                    <Button variant="primary" onClick={() => translateEdu(visit.id, lang, eduShareText(visit, patient, settings))}>
                      翻成{LANG_LABEL[lang]}
                    </Button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <ActionSheet
        open={menu}
        onClose={() => setMenu(false)}
        title={title}
        items={[
          dictSrc
            ? { label: "重新整理口述", icon: <RefreshCw size={21} />, hint: "只調整格式與語氣", onSelect: () => setRegen(true) }
            : { label: "重新產生", icon: <RefreshCw size={21} />, hint: "更精簡、更詳細、改條列…", onSelect: () => setRegen(true) },
          ...(dictSrc
            ? [
                { label: "修改口述原文", icon: <PenLine size={21} />, onSelect: () => void editPlanDictation(visit, () => setSrcOpen(true)) },
                { label: "重新口述", icon: <Mic size={21} />, onSelect: () => setDictate(true) },
              ]
            : isPlan
              ? [{ label: "改用口述", icon: <Mic size={21} />, hint: "AI 只整理語句，不新增內容", onSelect: () => setDictate(true) }]
              : []),
          ...(isPlan && slot && slot.done >= slot.total && planSrc !== "assessment" && visit.analysis
            ? [
                {
                  label: "依全人評估擬定",
                  icon: <ClipboardList size={21} />,
                  onSelect: () => {
                    toast("正在依全人評估擬定");
                    void draftPlanFrom(visit.id, "assessment");
                  },
                },
              ]
            : []),
          { label: `版本紀錄（${out.versions.length}）`, icon: <History size={21} />, onSelect: () => setVersions("list") },
          ...(!confirmed && out.status !== "writing"
            ? [
                {
                  label: "只確認，不複製",
                  icon: <ShieldCheck size={21} />,
                  onSelect: async () => {
                    const b = await confirmOnly(visit, kind);
                    if (b.length) onBlocked(kind, b);
                    else toast(`已確認${title}`);
                  },
                },
              ]
            : []),
          ...(isPlan && !confirmed && !visit.planDeferred
            ? [
                {
                  label: "本次不擬計畫",
                  icon: <Ban size={21} />,
                  hint: "紀錄照常完成，計畫維持現行版本",
                  onSelect: async () => {
                    await deferPlan(visit.id);
                    toast("本次不擬計畫，紀錄照常完成");
                  },
                },
              ]
            : []),
        ]}
      />
      <EditSheet open={edit} onClose={() => setEdit(false)} visit={visit} kind={kind} title={title} />
      <RegenerateSheet open={regen} onClose={() => setRegen(false)} visit={visit} kind={kind} title={title} />
      {isPlan && <DictationSheet open={dictate} onClose={() => setDictate(false)} visit={visit} patient={patient} />}
      <VersionsSheet
        mode={versions}
        onClose={() => setVersions(null)}
        visit={visit}
        kind={kind}
        title={title}
        onResolve={async (accept) => {
          await resolveCandidate(visit.id, kind, accept);
          setVersions(null);
          toast(accept ? "已改用新版" : "保留目前版本");
        }}
      />
    </article>
  );
}
