import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileText, MessageCircle, Plus, Send, Trash2 } from "lucide-react";
import { Critter } from "../components/Critter";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Button, Chip, Field, Segmented, Spinner, cx, inputClass } from "../components/ui";
import { confirmForExport, logExport, type Blocker } from "../lib/actions";
import { db, saveSettings, updatePatient, updateVisit } from "../lib/db";
import { TRIAL } from "../lib/env";
import { bytes, clock, maskName } from "../lib/format";
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
  eventsInWindow,
  missingFields,
  serviceItemsFor,
} from "../export/careRecord";
import { renderCareRecordPdf } from "../export/careRecordPdf";
import { canShareFile, lineShareUrl, saveFile, shareFile } from "../export/share";

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
  return (
    <Sheet open={open} onClose={onClose} title="照護紀錄導出" full>
      {open && <ExportBody visit={visit} patient={patient} onBlocked={onBlocked} />}
    </Sheet>
  );
}

interface Made {
  file: File;
  url: string;
}

function ExportBody({ visit, patient, onBlocked }: { visit: Visit; patient: Patient; onBlocked: (blockers: Blocker[]) => void }) {
  const settings = useSettings();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<Made | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 換新檔或關閉面板時釋放上一個預覽網址。
  useEffect(() => {
    if (!made) return;
    return () => URL.revokeObjectURL(made.url);
  }, [made]);

  const data = useMemo(() => careRecordData(visit, patient, settings), [visit, patient, settings]);
  const missing = missingFields(visit, patient, settings);
  const services = serviceItemsFor(visit, patient);
  const vitalsCount = data.vitals ? Object.entries(data.vitals).filter(([k, v]) => k !== "measuredAt" && v !== "—").length : 0;

  const generate = async () => {
    setError(null);
    const blockers = await confirmForExport(visit);
    if (blockers.length) return onBlocked(blockers);
    setBusy(true);
    try {
      // 確認後重新讀一次（確認人員、計畫版號寫進去了）。
      const v = (await db.visits.get(visit.id)) ?? visit;
      const p = (await db.patients.get(patient.id)) ?? patient;
      const blob = await renderCareRecordPdf(careRecordData(v, p, settings), fontUrl);
      const file = new File([blob], careRecordFilename(v, p), { type: "application/pdf" });
      setMade({ file, url: URL.createObjectURL(file) });
      await logExport(visit.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 沒有產生成功，請再試一次。");
    } finally {
      setBusy(false);
    }
  };

  if (made) return <Ready made={made} visit={visit} patient={patient} onRedo={() => setMade(null)} toast={toast} eduText={data.edu?.text ?? null} />;

  return (
    <div className="flex flex-col gap-5 pb-4">
      <section className="rounded-[24px] bg-pdf-tint p-4 outline-ink">
        <p className="mb-2 flex items-center gap-2 font-round text-[1.15rem] font-extrabold">
          <Critter kind="pdf" size={34} />
          這份 PDF 會包含
        </p>
        <ul className="grid gap-1.5 text-[0.98rem] font-bold sm:grid-cols-2">
          <Included ok={!!data.main.record}>照護紀錄（{settings.recordTitle}）</Included>
          <Included ok={vitalsCount > 0}>生命徵象 {vitalsCount ? `${vitalsCount} 項` : "（本次未量測）"}</Included>
          <Included ok={!!data.plan}>護理計畫 {data.plan?.version ?? ""}</Included>
          <Included ok={!!data.edu}>家屬衛教</Included>
          <Included ok>非計畫性住院 {data.admissions.length} 筆・急診 {data.erVisits.length} 筆</Included>
          <Included ok>封面（個案姓名、收案日期、機構）</Included>
        </ul>
        {missing.length > 0 && <p className="mt-2 text-[0.92rem] font-bold text-ink-soft">還沒填：{missing.join("、")}（可留空，PDF 會印「—」）</p>}
      </section>

      {!settings.clinicName && (
        <TextField label="機構名稱（印在封面與每頁抬頭）" value="" placeholder="例如 安心居家護理所" onSave={(v) => saveSettings({ clinicName: v })} />
      )}

      <Group title="這次訪視">
        <Field label="紀錄來源">
          <div className="flex flex-wrap gap-2">
            {SOURCE_OPTIONS.map((s) => (
              <Chip key={s} active={(visit.source ?? "家訪") === s} onClick={() => updateVisit(visit.id, { source: s })}>
                {s}
              </Chip>
            ))}
          </div>
        </Field>
        <Field label="服務項目（可複選）">
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
        </Field>
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
        <Field label="居住所">
          <div className="flex flex-wrap gap-2">
            {RESIDENCE_OPTIONS.map((r) => (
              <Chip key={r} active={patient.residence === r} onClick={() => updatePatient(patient.id, { residence: patient.residence === r ? null : r })}>
                {r}
              </Chip>
            ))}
          </div>
        </Field>
        <TextField label="居住區域" value={patient.area ?? ""} placeholder="例如 臺北市文山區" onSave={(v) => updatePatient(patient.id, { area: v || null })} />
        <Field label="使用資源">
          <div className="flex flex-wrap gap-2">
            {RESOURCE_OPTIONS.map((r) => (
              <Chip key={r} active={patient.resource === r} onClick={() => updatePatient(patient.id, { resource: patient.resource === r ? null : r })}>
                {r}
              </Chip>
            ))}
          </div>
        </Field>
      </Group>

      <Events visit={visit} patient={patient} />

      {error && <p className="rounded-2xl bg-danger-tint p-3 font-bold text-danger">{error}</p>}

      <div className="sticky bottom-0 -mx-1 bg-paper/95 px-1 pb-1 pt-2 backdrop-blur">
        <Button variant="primary" size="xl" block icon={busy ? <Spinner size={20} /> : <FileText size={22} />} disabled={busy} onClick={generate}>
          {busy ? "產生中…" : "確認並產生 PDF"}
        </Button>
      </div>
    </div>
  );
}

function Ready({
  made,
  visit,
  patient,
  onRedo,
  toast,
  eduText,
}: {
  made: Made;
  visit: Visit;
  patient: Patient;
  onRedo: () => void;
  toast: ReturnType<typeof useToast>;
  eduText: string | null;
}) {
  const shareable = canShareFile(made.file);
  const last = visit.exports?.at(-1);
  return (
    <div className="flex flex-col gap-4 pb-4">
      <section className="flex items-center gap-3 rounded-[24px] bg-ok-tint p-4 font-bold text-ok">
        <Critter kind="done" size={44} />
        <div className="min-w-0">
          <p className="truncate text-[1.1rem] text-ink">{made.file.name}</p>
          <p className="text-[0.92rem]">
            PDF 已產生・{bytes(made.file.size)}
            {last ? `・${clock(last.at)}` : ""}
          </p>
        </div>
      </section>

      {shareable && (
        <Button
          variant="primary"
          size="xl"
          block
          icon={<Send size={22} />}
          onClick={async () => {
            const r = await shareFile(made.file, `${maskName(patient.name)} 照護紀錄 ${visit.date}`);
            if (r === "shared") toast("已交給分享的 App");
            else if (r === "failed") toast("無法開啟分享，請改用「下載 PDF」", { error: true });
          }}
        >
          分享 PDF（LINE、郵件…）
        </Button>
      )}

      <Button
        variant={shareable ? "secondary" : "primary"}
        size={shareable ? "lg" : "xl"}
        block
        icon={<Download size={20} />}
        onClick={async () => {
          const r = await saveFile(made.file, made.file.name);
          if (r === "saved") toast(TRIAL ? "已交給下載（在 Claude App 可直接分享到 LINE）" : "已下載 PDF");
          else if (r === "failed") toast("無法下載，請再試一次", { error: true });
        }}
      >
        下載 PDF
      </Button>

      {!TRIAL && (
        <a href={made.url} target="_blank" rel="noreferrer" className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-card px-5 font-bold outline-ink">
          <ExternalLink size={19} />
          開啟預覽
        </a>
      )}

      {eduText && (
        <a
          href={lineShareUrl(eduText)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-full bg-[#06c755] px-5 font-bold text-white"
        >
          <MessageCircle size={20} />
          用 LINE 傳衛教文字給家屬
        </a>
      )}

      <p className="rounded-2xl bg-pending-tint p-3 text-[0.95rem] font-bold">
        PDF 含個案全名與病情。分享前請確認對象；給家屬建議只傳衛教文字。
        {!shareable && !TRIAL ? "這個瀏覽器不支援直接分享檔案：請先下載，再從 LINE 傳送檔案。" : ""}
      </p>

      <Button variant="soft" block onClick={onRedo}>
        修改欄位後重新產生
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
        <p className="text-ink-soft">沒有紀錄（PDF 會印「無」）</p>
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
        <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="發生原因，例如 發燒急診，診斷肺炎收住院" maxLength={200} className={inputClass} aria-label="發生原因" />
        <Button icon={<Plus size={18} />} disabled={!reason.trim()} onClick={add}>
          加入
        </Button>
      </div>
    </Group>
  );
}
