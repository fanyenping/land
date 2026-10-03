import { useState } from "react";
import { Copy } from "lucide-react";
import type { DocKind, DocSection } from "../../shared/types";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Button, Chip, Pill, inputClass } from "../components/ui";
import { restoreVersion, saveEdit } from "../lib/actions";
import { writeClipboard } from "../lib/compose";
import { clock } from "../lib/format";
import type { OutputVersion, Visit } from "../lib/model";
import { regenerate } from "../lib/pipeline";

/** H7 修改：段落標題鎖定，內文可改；每段可「複製此段」（中衛分欄位貼上）。 */
export function EditSheet({ open, onClose, visit, kind, title }: { open: boolean; onClose: () => void; visit: Visit; kind: DocKind; title: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={`修改${title}`} full>
      {open && <EditBody visit={visit} kind={kind} onDone={onClose} />}
    </Sheet>
  );
}

function EditBody({ visit, kind, onDone }: { visit: Visit; kind: DocKind; onDone: () => void }) {
  const toast = useToast();
  const out = visit.outputs[kind];
  const [sections, setSections] = useState<DocSection[]>(() => out.versions[out.current]?.sections.map((s) => ({ ...s })) ?? []);
  const original = JSON.stringify(out.versions[out.current]?.sections ?? []);
  const dirty = JSON.stringify(sections) !== original;

  return (
    <div className="flex flex-col gap-4 pb-4">
      {kind === "record" && <p className="rounded-2xl bg-pending-tint p-3 text-[0.95rem] font-bold">生命徵象由「數值」區塊帶入，請在那裡修改，三份會一起更新。</p>}
      {sections.map((s, i) => (
        <div key={i} className="rounded-[22px] bg-card p-3.5 outline-ink">
          <div className="mb-2 flex items-center gap-2">
            <span className="min-w-0 flex-1 truncate text-[1.05rem] font-extrabold">{s.heading || (i === 0 ? "開場" : "結語")}</span>
            <button
              type="button"
              onClick={async () => {
                if (await writeClipboard(s.body)) toast("已複製此段");
                else toast("無法寫入剪貼簿，請長按文字自行複製", { error: true });
              }}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.92rem] font-bold hover:bg-ink/5"
            >
              <Copy size={16} />
              複製此段
            </button>
          </div>
          <textarea
            value={s.body}
            onChange={(e) => setSections((list) => list.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
            rows={Math.min(14, Math.max(3, Math.ceil(s.body.length / 26) + s.body.split("\n").length))}
            className="w-full resize-y rounded-2xl bg-sunken p-3 text-[1.15rem] leading-[1.7] outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]"
          />
        </div>
      ))}
      <div className="sticky bottom-0 -mx-1 flex gap-2 bg-paper/95 px-1 pb-1 pt-2 backdrop-blur">
        <Button size="lg" className="flex-1" onClick={onDone}>
          取消
        </Button>
        <Button
          variant="primary"
          size="lg"
          className="flex-[2]"
          disabled={!dirty}
          onClick={async () => {
            await saveEdit(visit.id, kind, sections);
            toast("已存成新版本");
            onDone();
          }}
        >
          完成
        </Button>
      </div>
    </div>
  );
}

const QUICK = ["更精簡", "更詳細", "家屬更好懂", "改成條列", "加強管路照護"];

/** H8 重新產生：快速指示可複選；已修改或已確認的不會被覆寫，新版本放旁邊比較。 */
export function RegenerateSheet({ open, onClose, visit, kind, title }: { open: boolean; onClose: () => void; visit: Visit; kind: DocKind; title: string }) {
  const toast = useToast();
  const [picked, setPicked] = useState<string[]>([]);
  const [custom, setCustom] = useState("");
  const out = visit.outputs[kind];
  const keeps = out.status === "edited" || out.status === "confirmed";
  return (
    <Sheet open={open} onClose={onClose} title={`重新產生${title}`}>
      <div className="flex flex-col gap-4 pb-2">
        <div className="flex flex-wrap gap-2">
          {QUICK.filter((q) => kind === "edu" || q !== "家屬更好懂").map((q) => (
            <Chip key={q} active={picked.includes(q)} onClick={() => setPicked((p) => (p.includes(q) ? p.filter((x) => x !== q) : [...p, q]))}>
              {q}
            </Chip>
          ))}
        </div>
        <input value={custom} onChange={(e) => setCustom(e.target.value)} placeholder="其他要求（選填）" maxLength={500} className={inputClass} />
        {keeps && <p className="rounded-2xl bg-pending-tint p-3 font-bold">你目前的版本會保留，新版本會放在旁邊讓你比較。</p>}
        <Button
          variant="primary"
          size="lg"
          block
          onClick={() => {
            onClose();
            toast(`正在重新產生${title}`);
            void regenerate(visit.id, kind, picked, custom.trim() || null);
            setPicked([]);
            setCustom("");
          }}
        >
          產生新版本
        </Button>
      </div>
    </Sheet>
  );
}

function originLabel(v: OutputVersion) {
  return v.origin === "nurse" ? "你修改" : v.origin === "regen" ? "AI 重新產生" : "AI 草稿";
}

/** H9 版本：只增不刪；「用這版」會建立新版本。 */
export function VersionsSheet({
  mode,
  onClose,
  visit,
  kind,
  title,
  onResolve,
}: {
  mode: "list" | "compare" | null;
  onClose: () => void;
  visit: Visit;
  kind: DocKind;
  title: string;
  onResolve: (accept: boolean) => void;
}) {
  const toast = useToast();
  const out = visit.outputs[kind];
  const [view, setView] = useState<"current" | "candidate">("candidate");
  const text = (v?: OutputVersion) => v?.sections.map((s) => [s.heading, s.body].filter(Boolean).join("\n")).join("\n\n") ?? "";

  if (mode === "compare" && out.candidate !== null) {
    const cand = out.versions[out.candidate];
    const cur = out.versions[out.current];
    return (
      <Sheet
        open
        onClose={onClose}
        title={`${title}：比較新版本`}
        wide
        footer={
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={() => onResolve(false)}>
              保留目前
            </Button>
            <Button variant="primary" size="lg" className="flex-1" onClick={() => onResolve(true)}>
              改用新版
            </Button>
          </div>
        }
      >
        <div className="mb-3 flex gap-2 md:hidden">
          <Chip active={view === "current"} onClick={() => setView("current")}>
            目前
          </Chip>
          <Chip active={view === "candidate"} onClick={() => setView("candidate")}>
            新版本
          </Chip>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div className={view === "current" ? "" : "hidden md:block"}>
            <p className="mb-1 font-extrabold">目前・{originLabel(cur)}</p>
            <p className="whitespace-pre-line rounded-2xl bg-card p-3 leading-relaxed outline-ink">{text(cur)}</p>
          </div>
          <div className={view === "candidate" ? "" : "hidden md:block"}>
            <p className="mb-1 font-extrabold">新版本・{cand.note ?? originLabel(cand)}</p>
            <p className="whitespace-pre-line rounded-2xl bg-pending-tint p-3 leading-relaxed outline-ink">{text(cand)}</p>
          </div>
        </div>
      </Sheet>
    );
  }

  return (
    <Sheet open={mode === "list"} onClose={onClose} title={`${title}・版本紀錄`}>
      <div className="flex flex-col gap-2.5 pb-2">
        {out.versions
          .map((v, i) => ({ v, i }))
          .reverse()
          .map(({ v, i }) => (
            <div key={v.id} className="flex items-center gap-3 rounded-[20px] bg-card p-3.5 outline-ink">
              <span className="num grid h-11 w-11 shrink-0 place-items-center rounded-full bg-ink/[0.07] font-extrabold">v{i + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">
                  {originLabel(v)}・{clock(v.createdAt)}
                </span>
                <span className="block truncate text-[0.88rem] text-ink-soft">{v.note ?? (v.meta?.mode === "demo" ? "示範引擎" : (v.meta?.model ?? ""))}</span>
              </span>
              {i === out.current ? (
                <Pill tone="ink">目前</Pill>
              ) : (
                <Button
                  size="sm"
                  onClick={async () => {
                    await restoreVersion(visit.id, kind, i);
                    toast(`已改用 v${i + 1}（存成新版本）`);
                    onClose();
                  }}
                >
                  用這版
                </Button>
              )}
            </div>
          ))}
      </div>
    </Sheet>
  );
}
