import { useEffect, useState } from "react";
import { ExternalLink, Play, Trash2 } from "lucide-react";
import { Critter } from "../components/Critter";
import { useToast } from "../components/Toast";
import { Segmented } from "../components/ui";
import { removeDocument } from "../lib/actions";
import { canPlaySource, playAt } from "../lib/audio";
import { getBlob } from "../lib/db";
import { bytes, duration } from "../lib/format";
import type { AudioPart, Visit, VisitDocument } from "../lib/model";

type Tab = "transcript" | "audio" | "docs";

/** 來源：逐字稿（依時間與講者）、錄音段、文件。 */
export function Sources({ visit }: { visit: Visit }) {
  const toast = useToast();
  const tabs: { value: Tab; label: string }[] = [];
  if (visit.transcript) tabs.push({ value: "transcript", label: "逐字稿" });
  if (visit.parts.length) tabs.push({ value: "audio", label: `錄音 ${visit.parts.length}` });
  if (visit.documents.length) tabs.push({ value: "docs", label: `文件 ${visit.documents.length}` });
  const [tab, setTab] = useState<Tab>(tabs[0]?.value ?? "transcript");
  const active = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value;

  if (tabs.length === 0) return <p className="text-ink-soft">這筆紀錄沒有錄音或文件。</p>;

  return (
    <div className="flex flex-col gap-3">
      {tabs.length > 1 && <Segmented label="來源" value={active!} onChange={setTab} options={tabs} />}
      {active === "transcript" && <TranscriptView visit={visit} />}
      {active === "audio" && (
        <div className="flex flex-col gap-2.5">
          {visit.parts.map((p, i) => (
            <AudioRow key={p.id} part={p} index={i} />
          ))}
        </div>
      )}
      {active === "docs" && (
        <div className="flex flex-col gap-2.5">
          {visit.documents.map((d) => (
            <DocRow
              key={d.id}
              doc={d}
              // 只剩這一份資料時不給移除（要整筆刪除請用「更多」）。
              onRemove={
                visit.parts.length + visit.documents.length > 1 && !["recording", "paused"].includes(visit.status)
                  ? async () => {
                      const undo = await removeDocument(visit.id, d.id);
                      toast(visit.analysis ? "已移除，重新整理中" : "已移除", undo ? { action: { label: "復原", run: () => void undo() } } : undefined);
                    }
                  : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

function TranscriptView({ visit }: { visit: Visit }) {
  const t = visit.transcript!;
  const speakers = visit.analysis?.speakers ?? {};
  const playable = canPlaySource(visit);
  const quotes = new Set((visit.analysis?.vitals ?? []).filter((v) => v.status !== "ok").map((v) => v.sourceMs));
  return (
    <div className="flex flex-col gap-2">
      {t.provider === "demo" && <p className="rounded-2xl bg-pending-tint px-3 py-2 text-[0.92rem] font-bold">示範逐字稿</p>}
      {(t.segments.length ? t.segments : [{ startMs: 0, endMs: 0, text: t.text }]).map((s, i) => (
        <div key={i} className={quotes.has(s.startMs) ? "rounded-2xl bg-pending-tint p-2.5" : "rounded-2xl p-2.5"}>
          <div className="mb-0.5 flex items-center gap-2 text-[0.85rem] font-bold text-ink-soft">
            <span className="num">{duration(s.startMs)}</span>
            {s.speaker && <span>{speakers[s.speaker] ?? s.speaker}</span>}
            {playable && (
              <button type="button" aria-label="播放這段" onClick={() => playAt(visit, s.startMs + 2500)} className="ml-auto grid h-9 w-9 place-items-center rounded-full hover:bg-ink/5">
                <Play size={14} fill="currentColor" />
              </button>
            )}
          </div>
          <p className="text-[1.02rem] leading-relaxed">{s.text}</p>
        </div>
      ))}
    </div>
  );
}

function useBlobUrl(key: string) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    void getBlob(key).then((b) => {
      if (b) {
        u = URL.createObjectURL(b);
        setUrl(u);
      }
    });
    return () => {
      if (u) URL.revokeObjectURL(u);
    };
  }, [key]);
  return url;
}

function AudioRow({ part, index }: { part: AudioPart; index: number }) {
  const url = useBlobUrl(part.blobKey);
  return (
    <div className="rounded-[20px] bg-card p-3 outline-ink">
      <div className="mb-2 flex items-center gap-2 font-bold">
        <Critter kind="audio" size={28} />
        <span className="flex-1 truncate">{part.fileName ?? `第 ${index + 1} 段`}</span>
        <span className="num text-[0.9rem] text-ink-soft">{duration(part.durationMs)}</span>
      </div>
      {url ? <audio controls preload="metadata" src={url} className="w-full" /> : <p className="text-ink-soft">錄音已依保存期限清除</p>}
    </div>
  );
}

function DocRow({ doc, onRemove }: { doc: VisitDocument; onRemove?: () => void }) {
  const url = useBlobUrl(doc.blobKey);
  const image = doc.mimeType.startsWith("image/");
  return (
    <div className="flex items-center gap-3 rounded-[20px] bg-card p-3 outline-ink">
      {image && url ? <img src={url} alt="" className="h-14 w-14 shrink-0 rounded-xl object-cover" /> : <Critter kind={image ? "photo" : "pdf"} size={40} />}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-bold">{doc.name}</span>
        <span className="num block text-[0.88rem] text-ink-soft">{bytes(doc.size)}</span>
      </span>
      {url && (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-3 font-bold outline-ink">
          <ExternalLink size={16} />
          開啟
        </a>
      )}
      {onRemove && (
        <button type="button" aria-label={`移除 ${doc.name}`} title="移除" onClick={onRemove} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-ink/5">
          <Trash2 size={18} />
        </button>
      )}
    </div>
  );
}
