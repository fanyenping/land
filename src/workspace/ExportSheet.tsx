import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, FileText, Plus, Send, Trash2 } from "lucide-react";
import { Critter } from "../components/Critter";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Button, Chip, Field, Segmented, Spinner, cx, inputClass } from "../components/ui";
import { confirmForExport, logExport, type Blocker } from "../lib/actions";
import { db, saveSettings, updatePatient, updateVisit } from "../lib/db";
import { TRIAL } from "../lib/env";
import { writeClipboard } from "../lib/compose";
import { bytes, maskName } from "../lib/format";
import { useSettings } from "../lib/hooks";
import { newId, type CareEvent, type Patient, type Visit } from "../lib/model";
import {
  EVENT_WINDOW_DAYS,
  RESIDENCE_OPTIONS,
  RESOURCE_OPTIONS,
  SERVICE_OPTIONS,
  SOURCE_OPTIONS,
  bmiOf,
  careRecordData,
  careRecordFilename,
  careRecordText,
  eventsInWindow,
  missingFields,
  serviceItemsFor,
} from "../export/careRecord";
import type { CareRecordData } from "../export/types";

// 版面模組另外開發中：用 glob 載入，檔案出現前開發伺服器也能運作。
const pdfModules = import.meta.glob<{ renderCareRecordPdf: (d: CareRecordData, url: (f: string) => string) => Promise<Blob> }>("../export/careRecordPdf.ts");
async function renderCareRecordPdf(data: CareRecordData, url: (f: string) => string): Promise<Blob> {
  const load = pdfModules["../export/careRecordPdf.ts"];
  if (!load) throw new Error("PDF 版面模組尚未完成。");
  return (await load()).renderCareRecordPdf(data, url);
}
import { canShareFile, saveFile, shareFile, shareText } from "../export/share";

/** 字型與 App 放在同一處：正式版在網站根目錄的 /fonts，試用版是分享網頁旁的 fonts/。 */
const fontUrl = (file: string) => (TRIAL ? `fonts/${file}` : `${import.meta.env.BASE_URL}fonts/${file}`);

/**
 * 照護紀錄導出：補齊 HIS 照護紀錄的欄位 → 確認並產生 PDF（含護理紀錄、生命徵象、護理計畫、家屬衛教）
 * → 分享到 LINE 等 App、下載，或用 LINE 傳衛教文字。
 */
export function ExportSheet({
  open,
  onClose,
  visit,
  patient,
  onBlocked,
}: {
  open: boolean;
  onClose: () => void;
  visit: Visit;
  patient: Patient;
  onBlocked: (blockers: Blocker[]) => void;
}) {
  // 關閉時卸載：下次打開回到填欄位的畫面。
  if (!open) return null;
  return <ExportBody visit={visit} patient={patient} onBlocked={onBlocked} onClose={onClose} />;
}

interface Ready {
  data: CareRecordData;
  filename: string;
}

function ExportBody({ visit, patient, onBlocked, onClose }: { visit: Visit; patient: Patient; onBlocked: (blockers: Blocker[]) => void; onClose: () => void }) {
  const settings = useSettings();
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState<Ready | null>(null);

  const data = useMemo(() => careRecordData(visit, patient, settings), [visit, patient, settings]);
  // 機構名稱沒填時下面就有欄位，不再列在「未填」裡。
  const missing = missingFields(visit, patient, settings).filter((m) => m !== "機構名稱");
  const services = serviceItemsFor(visit, patient);
  const vitalsCount = data.vitals ? Object.entries(data.vitals).filter(([k, v]) => k !== "measuredAt" && v !== "—").length : 0;

  const confirm = async () => {
    const blockers = await confirmForExport(visit);
    if (blockers.length) return onBlocked(blockers);
    setBusy(true);
    // 確認後重新讀一次（確認人員、計畫版號寫進去了）。
    const v = (await db.visits.get(visit.id)) ?? visit;
    const p = (await db.patients.get(patient.id)) ?? patient;
    await logExport(visit.id);
    setReady({ data: careRecordData(v, p, settings), filename: careRecordFilename(v, p) });
    setBusy(false);
  };

  const form = (
    <div className="flex flex-col gap-5 pb-4">
      <section className="rounded-[24px] bg-pdf-tint p-4 outline-ink">
        <p className="mb-2 flex items-center gap-2 font-round text-[1.15rem] font-extrabold">
          <Critter kind="pdf" size={34} />
          照護紀錄包含
        </p>
        <ul className="grid gap-1.5 text-[0.98rem] font-bold sm:grid-cols-2">
          <Included ok={!!data.main.record}>{settings.recordTitle}</Included>
          <Included ok={vitalsCount > 0}>生命徵象 {vitalsCount ? `${vitalsCount} 項` : "（未量測）"}</Included>
          <Included ok={!!data.plan}>護理計畫 {data.plan?.version.replace(/（.*）/, "") ?? ""}</Included>
          <Included ok={!!data.edu}>家屬衛教</Included>
          <Included ok>住院 {data.admissions.length}・急診 {data.erVisits.length}</Included>
        </ul>
        {missing.length > 0 && <p className="mt-2 text-[0.92rem] font-bold text-ink-soft">未填：{missing.join("、")}</p>}
      </section>

      {!settings.clinicName && (
        <TextField label="機構名稱" value="" placeholder="例如 安心居家護理所" onSave={(v) => saveSettings({ clinicName: v })} />
      )}

      <Group title="這次訪視">
        <ChipGroup label="紀錄來源">
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((s) => (
              <Chip key={s} active={(visit.source ?? "家訪") === s} onClick={() => updateVisit(visit.id, { source: s })}>
                {s}
              </Chip>
            ))}
          </div>
        </ChipGroup>
        <ChipGroup label="服務項目（可複選）">
          <div className="flex flex-wrap gap-2">
            {[...new Set([...SERVICE_OPTIONS, ...services])].map((s) => (
              <Chip
                key={s}
                active={services.includes(s)}
                onClick={() => {
                  const next = services.includes(s) ? services.filter((x) => x !== s) : [...services, s];
                  void updateVisit(visit.id, { serviceItems: next.length ? next : [s] });
                }}
              >
                {s}
              </Chip>
            ))}
          </div>
        </ChipGroup>
      </Group>

      <Group title="身體測量">
        <div className="grid grid-cols-2 gap-3">
          <NumField label="身高 cm" value={patient.heightCm ?? ""} onSave={(v) => updatePatient(patient.id, { heightCm: v || null })} />
          <NumField label="體重 kg" value={visit.body?.weightKg ?? ""} onSave={(v) => updateVisit(visit.id, (cur) => ({ body: { ...cur.body, weightKg: v || undefined } }))} />
          <NumField label="臂中圍 cm" value={visit.body?.macCm ?? ""} onSave={(v) => updateVisit(visit.id, (cur) => ({ body: { ...cur.body, macCm: v || undefined } }))} />
          <NumField label="小腿圍 cm" value={visit.body?.calfCm ?? ""} onSave={(v) => updateVisit(visit.id, (cur) => ({ body: { ...cur.body, calfCm: v || undefined } }))} />
        </div>
        <p className="font-bold">
          BMI：<span className="num">{bmiOf(patient.heightCm, visit.body?.weightKg) || "填身高、體重後自動計算"}</span>
        </p>
      </Group>

      <Group title="個案資料">
        <TextField label="收案日期" type="date" value={patient.intakeDate ?? patient.createdAt.slice(0, 10)} onSave={(v) => updatePatient(patient.id, { intakeDate: v || null })} />
        <ChipGroup label="居住所">
          <div className="flex flex-wrap gap-2">
            {RESIDENCE_OPTIONS.map((r) => (
              <Chip key={r} active={patient.residence === r} onClick={() => updatePatient(patient.id, { residence: patient.residence === r ? null : r })}>
                {r}
              </Chip>
            ))}
          </div>
        </ChipGroup>
        <TextField label="居住區域" value={patient.area ?? ""} placeholder="例如 臺北市文山區" onSave={(v) => updatePatient(patient.id, { area: v || null })} />
        <ChipGroup label="使用資源">
          <div className="flex flex-wrap gap-2">
            {RESOURCE_OPTIONS.map((r) => (
              <Chip key={r} active={patient.resource === r} onClick={() => updatePatient(patient.id, { resource: patient.resource === r ? null : r })}>
                {r}
              </Chip>
            ))}
          </div>
        </ChipGroup>
      </Group>

      <Events visit={visit} patient={patient} />
    </div>
  );

  return (
    <Sheet
      open
      onClose={onClose}
      title="照護紀錄導出"
      full
      footer={
        ready ? undefined : (
          <Button variant="primary" size="xl" block icon={busy ? <Spinner size={20} /> : <FileText size={22} />} disabled={busy} onClick={confirm}>
            確認並導出
          </Button>
        )
      }
    >
      {ready ? <ReadyView ready={ready} title={`${maskName(patient.name)} 照護紀錄 ${visit.date}`} onEdit={() => setReady(null)} /> : form}
    </Sheet>
  );
}

/** 導出：複製（貼到 LINE 等 App）或下載 PDF。PDF 在背景先產生，按下載時就能立刻存。 */
function ReadyView({ ready, title, onEdit }: { ready: Ready; title: string; onEdit: () => void }) {
  const toast = useToast();
  const text = useMemo(() => careRecordText(ready.data), [ready]);
  const [pdf, setPdf] = useState<File | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const job = useRef<Promise<File | null> | null>(null);

  const makePdf = useCallback(() => {
    if (!job.current) {
      setPdfError(null);
      job.current = renderCareRecordPdf(ready.data, fontUrl)
        .then((blob) => {
          const f = new File([blob], ready.filename, { type: "application/pdf" });
          setPdf(f);
          return f;
        })
        .catch((err: unknown) => {
          job.current = null;
          setPdfError(err instanceof Error ? err.message : "PDF 沒有產生成功，請再試一次。");
          return null;
        });
    }
    return job.current;
  }, [ready]);

  useEffect(() => {
    void makePdf();
  }, [makePdf]);

  const copy = async () => {
    if (await writeClipboard(text)) toast("已複製照護紀錄，到 LINE 或其他 App 貼上");
    else toast("無法寫入剪貼簿，請再試一次", { error: true });
  };

  const download = async () => {
    const file = pdf ?? (await makePdf());
    if (!file) return;
    const r = await saveFile(file, file.name);
    if (r === "saved") toast(TRIAL ? "已交給下載" : "已下載 PDF");
    else if (r === "failed") toast("無法下載，請再試一次", { error: true });
  };

  const canShareText = !TRIAL && typeof navigator !== "undefined" && !!navigator.share;

  return (
    <div className="flex flex-col gap-4 pb-4">
      <p className="flex items-center gap-2 font-bold text-ok">
        <Critter kind="done" size={32} />
        已確認，可複製或下載
      </p>

      <section className="flex flex-col gap-2.5 rounded-[26px] bg-card p-4 outline-ink">
        <Button variant="primary" size="xl" block icon={<Copy size={22} />} onClick={copy}>
          複製
        </Button>
        <p className="text-center text-[0.95rem] font-bold text-ink-soft">貼到 LINE 或其他 App 轉發</p>
        {canShareText && (
          <Button
            variant="soft"
            block
            icon={<Send size={18} />}
            onClick={async () => {
              const r = await shareText(text, title);
              if (r === "failed") toast("無法開啟分享，請改用「複製」", { error: true });
            }}
          >
            用分享選單傳送
          </Button>
        )}
      </section>

      <section className="flex flex-col gap-2.5 rounded-[26px] bg-card p-4 outline-ink">
        <Button variant="primary" size="xl" block icon={pdf ? <Download size={22} /> : <Spinner size={20} />} onClick={download} disabled={!pdf && !pdfError}>
          {pdf ? "下載 PDF" : pdfError ? "重新產生 PDF" : "PDF 產生中…"}
        </Button>
        <p className="text-center text-[0.95rem] font-bold text-ink-soft">{pdf ? `${pdf.name}・${bytes(pdf.size)}` : pdfError ?? "A4 照護紀錄"}</p>
        {pdf && canShareFile(pdf) && (
          <Button
            variant="soft"
            block
            icon={<Send size={18} />}
            onClick={async () => {
              const r = await shareFile(pdf, title);
              if (r === "failed") toast("無法開啟分享，請改用「下載 PDF」", { error: true });
            }}
          >
            用分享選單傳送 PDF
          </Button>
        )}
      </section>

      <p className="text-center text-[0.9rem] font-bold text-ink-soft">含個案全名與病情，傳送前請確認對象。</p>
      <Button variant="soft" block onClick={onEdit}>
        修改欄位
      </Button>
    </div>
  );
}

function Included({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className={cx("flex items-center gap-2", !ok && "text-ink-soft")}>
      <span className={cx("grid h-5 w-5 shrink-0 place-items-center rounded-full text-[0.7rem]", ok ? "bg-ink text-paper" : "bg-ink/10")}>{ok ? "✓" : ""}</span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

/** 一組選項按鈕（不要用 <label> 包：點標題會觸發第一個按鈕）。 */
function ChipGroup({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label}>
      <span className="mb-1.5 block text-[0.95rem] font-bold">{label}</span>
      {children}
    </div>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-[24px] bg-card p-4 outline-ink">
      <h3 className="font-round text-[1.15rem] font-extrabold">{title}</h3>
      {children}
    </section>
  );
}

function TextField({ label, value, onSave, placeholder, type = "text" }: { label: string; value: string; onSave: (v: string) => unknown; placeholder?: string; type?: "text" | "date" }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Field label={label}>
      <input
        type={type}
        value={v}
        placeholder={placeholder}
        onChange={(e) => {
          setV(e.target.value);
          if (type === "date") void onSave(e.target.value);
        }}
        onBlur={() => v.trim() !== value && void onSave(v.trim())}
        className={inputClass}
      />
    </Field>
  );
}

function NumField({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => unknown }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <Field label={label}>
      <input
        inputMode="decimal"
        value={v}
        placeholder="—"
        onChange={(e) => setV(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))}
        onBlur={() => v !== value && void onSave(v)}
        className={cx(inputClass, "num text-center text-[1.3rem] font-extrabold")}
      />
    </Field>
  );
}

const SHIFTS: NonNullable<CareEvent["shift"]>[] = ["白班", "小夜", "大夜"];

/** 近 30 天的非計畫性住院與急診（記在個案上，下次訪視也看得到）。 */
function Events({ visit, patient }: { visit: Visit; patient: Patient }) {
  const [kind, setKind] = useState<CareEvent["kind"]>("admission");
  const [date, setDate] = useState(visit.date);
  const [shift, setShift] = useState<CareEvent["shift"]>(null);
  const [reason, setReason] = useState("");
  const inWindow = eventsInWindow(patient, visit);

  const add = async () => {
    if (!reason.trim() || !date) return;
    const e: CareEvent = { id: newId(), kind, date, shift, reason: reason.trim() };
    await updatePatient(patient.id, { events: [...(patient.events ?? []), e] });
    setReason("");
    setShift(null);
  };

  return (
    <Group title={`近 ${EVENT_WINDOW_DAYS} 天非計畫性住院／急診`}>
      {inWindow.length === 0 ? (
        <p className="text-ink-soft">無</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {inWindow.map((e) => (
            <li key={e.id} className="flex items-start gap-2 rounded-2xl bg-sunken p-3">
              <span className="min-w-0 flex-1">
                <span className="block font-extrabold">
                  {e.kind === "admission" ? "住院" : "急診"}・{e.date}
                  {e.shift ? `・${e.shift}` : ""}
                </span>
                <span className="block text-[0.98rem]">{e.reason}</span>
              </span>
              <button
                type="button"
                aria-label="刪除這筆"
                onClick={() => updatePatient(patient.id, { events: (patient.events ?? []).filter((x) => x.id !== e.id) })}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-ink-soft hover:bg-ink/5"
              >
                <Trash2 size={18} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-col gap-2.5 rounded-2xl bg-sunken p-3">
        <Segmented
          label="類別"
          value={kind}
          onChange={setKind}
          options={[
            { value: "admission", label: "非計畫性住院" },
            { value: "er", label: "急診" },
          ]}
        />
        <input type="date" value={date} max={visit.date} onChange={(e) => setDate(e.target.value)} className={inputClass} aria-label="發生日期" />
        <div className="flex flex-wrap gap-2">
          {SHIFTS.map((s) => (
            <Chip key={s} active={shift === s} onClick={() => setShift(shift === s ? null : s)}>
              {s}
            </Chip>
          ))}
        </div>
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="發生原因" maxLength={200} className={inputClass} aria-label="發生原因" />
        <Button icon={<Plus size={18} />} disabled={!reason.trim()} onClick={add}>
          加入
        </Button>
      </div>
    </Group>
  );
}
