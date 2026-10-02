import { useState } from "react";
import { Check, Copy, History, Languages, MoreHorizontal, Pencil, RefreshCw, Send, ShieldCheck } from "lucide-react";
import { LANG_LABEL, type DocKind, type TranslateLang } from "../../shared/types";
import { ActionSheet } from "../components/ActionSheet";
import { Critter, type CritterKind } from "../components/Critter";
import { useToast } from "../components/Toast";
import { Button, Pill, RoundButton, Segmented, Spinner, cx } from "../components/ui";
import { confirmAndCopy, confirmOnly, decideSuggestion, markEduShared, resolveCandidate, type Blocker } from "../lib/actions";
import { charCount, docBody, docHeader, docTitle, eduShareText, shareToLine, writeClipboard } from "../lib/compose";
import { clock } from "../lib/format";
import { useSettings } from "../lib/hooks";
import type { Patient, Visit } from "../lib/model";
import { translateEdu } from "../lib/pipeline";
import { EditSheet, RegenerateSheet, VersionsSheet } from "./DocSheets";

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
  const [lang, setLang] = useState<TranslateLang>(settings.translateLang);
  const [showTr, setShowTr] = useState(false);

  const has = out.versions.length > 0;
  const writing = out.status === "writing" || (out.status === "idle" && visit.status === "processing");
  const body = has ? docBody(kind, visit, settings) : "";
  const chars = charCount(body);
  const confirmed = out.status === "confirmed";
  const pendingSuggestions = kind === "plan" ? (visit.analysis?.planSuggestions ?? []).filter((s) => !visit.suggestions[s.id]) : [];
  const changesOpen = kind === "plan" && (visit.analysis?.changes ?? []).some((c) => !visit.dismissedChanges.includes(c.id)) && !visit.changesConfirmed;

  const statusLabel = writing
    ? "撰寫中"
    : out.status === "failed"
      ? "沒有產生成功"
      : confirmed
        ? `已確認・${out.confirmedBy ?? ""} ${clock(out.confirmedAt)}`
        : out.status === "edited"
          ? "已修改・尚未確認"
          : "AI 草稿・請確認";

  const flash = () => {
    setJustCopied(true);
    setTimeout(() => setJustCopied(false), 2000);
    navigator.vibrate?.(30);
  };

  const copy = async () => {
    const res = await confirmAndCopy(visit, kind, patient);
    if (res.blockers.length) return onBlocked(kind, res.blockers);
    if (!res.ok) return toast("無法寫入剪貼簿，請長按文字自行複製");
    flash();
    toast(`已確認並複製${title}（${res.chars} 字）`);
  };

  const shareEdu = async (withLang?: TranslateLang) => {
    if (!confirmed) {
      const blockers = await confirmOnly(visit, "edu");
      if (blockers.length) return onBlocked("edu", blockers);
    }
    const text = eduShareText(visit, patient, settings, withLang);
    await writeClipboard(text);
    const how = await shareToLine(text);
    if (how === "cancelled") return;
    await markEduShared(visit.id);
    toast(how === "line" ? "已複製，正在開啟 LINE" : "已分享");
  };

  const tr = visit.translations[lang];

  return (
    <article id={`sec-${kind}`} aria-label={title} className="scroll-mt-32 overflow-hidden rounded-[30px] bg-card outline-ink">
      <header className={cx("contours flex items-center gap-3 px-4 py-3.5 text-[#141414] md:px-5", st.bg)}>
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-card outline-ink">
          <Critter kind={st.critter} size={36} animate={writing} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-round text-[1.35rem] font-extrabold leading-tight">{title}</h2>
          <p className="truncate text-[0.92rem] font-bold">
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
        {demo && has && (
          <p className="mb-3">
            <Pill tone="pending">示範資料</Pill>
          </p>
        )}

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
            評估異動尚未確認，確認後才能確認計畫。
            <a href="#sec-check" className="ml-2 underline underline-offset-4">
              前往確認
            </a>
          </div>
        )}

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
              <Spinner size={18} /> 撰寫中，完成後可複製
            </p>
            {[92, 80, 86, 60].map((w, i) => (
              <span key={i} className={cx("block h-4 animate-pulse rounded-full", st.tint)} style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {out.status === "failed" && !has && (
          <div className="flex flex-col gap-3 py-2">
            <p className="flex items-center gap-2 font-bold text-danger">
              <Critter kind="error" size={30} />
              {out.error?.message ?? `${title}沒有產生成功`}
            </p>
            <Button onClick={() => setRegen(true)} icon={<RefreshCw size={18} />}>
              重試這份
            </Button>
          </div>
        )}

        {has && (
          <>
            {out.status === "writing" && (
              <p className="mb-2 flex items-center gap-2 text-[0.95rem] font-bold text-ink-soft">
                <Spinner size={16} /> 正在產生新版本…
              </p>
            )}
            {out.error && (
              <p className="mb-2 text-[0.95rem] font-bold text-danger">
                新版本沒有產生成功：{out.error.message}
              </p>
            )}
            <p className="mb-2 text-[0.9rem] font-bold text-ink-soft">{docHeader(kind, visit, patient, settings)}</p>
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

            <div className="mt-2 flex flex-col gap-2.5">
              {kind === "edu" ? (
                <>
                  <Button variant="primary" size="lg" block icon={<Send size={20} />} onClick={() => shareEdu()}>
                    {confirmed ? "再分享到 LINE" : "確認並分享到 LINE"}
                  </Button>
                  <div className="grid grid-cols-2 gap-2.5">
                    <Button block icon={justCopied ? <Check size={20} strokeWidth={3} /> : <Copy size={19} />} onClick={copy}>
                      {justCopied ? "已複製" : "只複製"}
                    </Button>
                    <Button block icon={<Languages size={19} />} onClick={() => setShowTr((v) => !v)} aria-expanded={showTr}>
                      翻譯給看護
                    </Button>
                  </div>
                </>
              ) : (
                <Button variant="primary" size="lg" block icon={justCopied ? <Check size={22} strokeWidth={3} /> : <Copy size={20} />} onClick={copy} className={justCopied ? "animate-pop" : ""}>
                  {justCopied ? "已複製 ✓" : confirmed ? `再複製一次${title}` : `確認並複製${title}`}
                </Button>
              )}
              {kind === "plan" && !confirmed && <p className="text-center text-[0.9rem] font-bold text-ink-soft">確認後設為第 {(patient.plan?.version ?? 0) + 1} 版</p>}
              <Button variant="soft" block icon={<Pencil size={18} />} onClick={() => setEdit(true)}>
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
                    <p className="font-bold">中文版確認後才能翻譯。</p>
                    <Button
                      variant="primary"
                      icon={<ShieldCheck size={19} />}
                      onClick={async () => {
                        const b = await confirmOnly(visit, "edu");
                        if (b.length) onBlocked("edu", b);
                      }}
                    >
                      確認中文版
                    </Button>
                  </div>
                ) : tr?.status === "writing" ? (
                  <p className="mt-3 flex items-center gap-2 font-bold">
                    <Spinner size={18} /> 翻譯中…
                  </p>
                ) : tr?.status === "done" ? (
                  <div className="mt-3">
                    <p className="whitespace-pre-line rounded-2xl bg-card p-3 text-[1.02rem] leading-relaxed">{tr.text}</p>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <Button icon={<Send size={18} />} onClick={() => shareEdu(lang)}>
                        分享譯文
                      </Button>
                      <Button
                        icon={<Copy size={18} />}
                        onClick={async () => {
                          await writeClipboard(tr.text);
                          toast(`已複製${LANG_LABEL[lang]}`);
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
          { label: "重新產生", icon: <RefreshCw size={21} />, hint: "可選更精簡、更詳細、家屬更好懂…", onSelect: () => setRegen(true) },
          { label: `版本紀錄（${out.versions.length}）`, icon: <History size={21} />, onSelect: () => setVersions("list") },
          ...(!confirmed
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
        ]}
      />
      <EditSheet open={edit} onClose={() => setEdit(false)} visit={visit} kind={kind} title={title} />
      <RegenerateSheet open={regen} onClose={() => setRegen(false)} visit={visit} kind={kind} title={title} />
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
