import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { Check, ChevronLeft, ChevronRight, ClipboardList } from "lucide-react";
import { Critter } from "../components/Critter";
import { Name } from "../components/Name";
import { useToast } from "../components/Toast";
import { Button, Chip, RoundButton, cx, inputClass } from "../components/ui";
import { daysUntil, shortDate } from "../lib/format";
import { usePatient } from "../lib/hooks";
import type { Patient } from "../lib/model";
import { completeAssessment, saveAssessmentForm } from "./actions";
import {
  ASSESSMENT_FORMS,
  FORMS,
  FORM_BY_ID,
  completedCount,
  nextAssessmentDue,
  scoreOf,
  type Field,
  type FieldValue,
  type FormDef,
  type FormId,
  type FormValues,
  type Level,
} from "./forms";

const TONE: Record<Level["tone"], string> = {
  ok: "bg-ok-tint text-ok",
  warn: "bg-pending text-[#141414]",
  risk: "bg-danger text-[#141414]",
};

function ScorePill({ form, patient }: { form: FormDef; patient: Patient }) {
  const s = scoreOf(form, patient.assessment?.forms[form.id]);
  if (!s) return null;
  return (
    <span className={cx("num inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.82rem] font-extrabold", TONE[s.level.tone])}>
      {s.score}
      {form.score!.unit} {s.level.label}
    </span>
  );
}

/** 個案頁的全人評估卡：進度、到期、重點分數。 */
export function AssessmentCard({ patient, highlight }: { patient: Patient; highlight?: boolean }) {
  const a = patient.assessment;
  const done = completedCount(a);
  const due = nextAssessmentDue(a);
  const left = due ? daysUntil(due) : null;
  const scored = ASSESSMENT_FORMS.filter((f) => f.score && scoreOf(f, a?.forms[f.id]));
  return (
    <section className={cx("rounded-[28px] p-4 outline-ink md:p-5", highlight && done < 13 ? "bg-pending-tint" : "bg-card")}>
      <div className="mb-2 flex items-center gap-2">
        <Critter kind="plan" size={36} />
        <h2 className="font-round text-[1.25rem] font-extrabold">全人評估</h2>
        <span className="num ml-auto rounded-full bg-ink px-3 py-1 text-[0.9rem] font-extrabold text-paper">{done}/13</span>
      </div>
      {done === 0 ? (
        <p className="font-bold">初訪先完成 13 張評估，計畫依評估擬定。</p>
      ) : (
        <>
          <div className="mb-2 h-2.5 overflow-hidden rounded-full bg-ink/10">
            <div className="h-full rounded-full bg-plan" style={{ width: `${(done / 13) * 100}%` }} />
          </div>
          {due && (
            <p className={cx("mb-2 text-[0.95rem] font-bold", left !== null && left < 0 ? "text-danger" : left !== null && left <= 14 ? "text-ink" : "text-ink-soft")}>
              {left !== null && left < 0 ? `已超過半年，請重新評估（應於 ${shortDate(due)}）` : `下次評估 ${shortDate(due)}${left !== null && left <= 14 ? `（${left} 天後）` : ""}`}
            </p>
          )}
          {scored.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {scored.map((f) => (
                <span key={f.id} className="inline-flex items-center gap-1 text-[0.85rem] font-bold">
                  {f.short}
                  <ScorePill form={f} patient={patient} />
                </span>
              ))}
            </div>
          )}
        </>
      )}
      <Link
        to={`/patients/${patient.id}/assessment`}
        className="sticker mt-3 inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-ink px-5 font-bold text-paper"
      >
        <ClipboardList size={20} />
        {done === 0 ? "填寫全人評估" : done < 13 ? "繼續填寫" : "查看・修改"}
      </Link>
    </section>
  );
}

/** 全人評估總覽：基本資料＋13 張表。 */
export function AssessmentHome() {
  const { id } = useParams();
  const patient = usePatient(id);
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();
  if (!patient) return null;
  const a = patient.assessment;
  const done = completedCount(a);
  const due = nextAssessmentDue(a);
  const overdue = due ? daysUntil(due) < 0 : false;

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 lg:pt-8">
      <header className="mb-4 flex items-center gap-2">
        <RoundButton label="返回" onClick={() => (location.key !== "default" ? navigate(-1) : navigate(`/patients/${patient.id}`))}>
          <ChevronLeft size={24} strokeWidth={2.6} />
        </RoundButton>
        <div className="min-w-0">
          <h1 className="font-round text-[1.7rem] font-extrabold leading-tight">全人評估</h1>
          <p className="truncate font-bold text-ink-soft">
            <Name name={patient.name} />・{done}/13
            {a?.updatedAt ? `・${a.updatedBy} ${shortDate(a.updatedAt.slice(0, 10))} 更新` : ""}
          </p>
        </div>
      </header>

      {done === 13 && (
        <div className={cx("mb-4 flex flex-wrap items-center gap-3 rounded-[24px] p-4 font-bold outline-ink", overdue ? "bg-danger-tint" : "bg-ok-tint")}>
          <span className="min-w-0 flex-1">{overdue ? `已超過半年（應於 ${shortDate(due!)} 重新評估）` : `13 張已完成・下次評估 ${due ? shortDate(due) : "—"}`}</span>
          <Button
            size="sm"
            variant={overdue ? "primary" : "secondary"}
            onClick={async () => {
              await completeAssessment(patient.id);
              toast("已完成本次評估，半年後提醒");
            }}
          >
            完成本次重新評估
          </Button>
        </div>
      )}

      <div className="grid gap-2.5 sm:grid-cols-2">
        {FORMS.map((f, i) => {
          const rec = a?.forms[f.id];
          return (
            <Link
              key={f.id}
              to={`/patients/${patient.id}/assessment/${f.id}`}
              className={cx("flex min-h-[64px] min-w-0 items-center gap-3 rounded-[22px] px-4 py-3 outline-ink", rec ? "bg-card" : "bg-sunken")}
            >
              <span className={cx("num grid h-9 w-9 shrink-0 place-items-center rounded-full text-[0.9rem] font-extrabold", rec ? "bg-ink text-paper" : "bg-ink/10 text-ink-soft")}>
                {rec ? <Check size={18} strokeWidth={3} /> : i}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-extrabold">{f.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[0.85rem] font-bold text-ink-soft">
                  {rec ? <ScorePill form={f} patient={patient} /> : null}
                  {rec ? `${shortDate(rec.savedAt.slice(0, 10))} ${rec.savedBy}` : "未填寫"}
                </span>
              </span>
              <ChevronRight size={20} className="shrink-0 text-ink-soft" />
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/** 單張評估表：選項用大按鈕，分數即時計算；儲存後回總覽或下一張。 */
export function AssessmentForm() {
  const { id, form: formId } = useParams();
  const patient = usePatient(id);
  const form = FORM_BY_ID[formId as FormId];
  if (!patient || !form) return null;
  return <FormBody key={`${patient.id}-${form.id}`} patient={patient} form={form} />;
}

function FormBody({ patient, form }: { patient: Patient; form: FormDef }) {
  const navigate = useNavigate();
  const toast = useToast();
  const saved = patient.assessment?.forms[form.id];
  const [values, setValues] = useState<FormValues>(() => ({ ...(saved?.values ?? prefill(form, patient)) }));
  const [busy, setBusy] = useState(false);
  const dirty = JSON.stringify(values) !== JSON.stringify(saved?.values ?? {});
  const idx = FORMS.findIndex((f) => f.id === form.id);
  const next = FORMS[idx + 1];
  const live = useMemo(() => (form.score ? scoreOf(form, { values, savedAt: "", savedBy: "" }) : null), [form, values]);

  useEffect(() => window.scrollTo({ top: 0 }), [form.id]);

  const set = (fid: string, v: FieldValue | undefined) => setValues((cur) => ({ ...cur, [fid]: v }));
  const save = async (goNext: boolean) => {
    setBusy(true);
    await saveAssessmentForm(patient.id, form.id, values);
    setBusy(false);
    toast(`已儲存${form.short}`);
    navigate(goNext && next ? `/patients/${patient.id}/assessment/${next.id}` : `/patients/${patient.id}/assessment`, { replace: true });
  };

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 lg:pt-8">
      <header className="mb-3 flex items-center gap-2">
        <RoundButton label="回到全人評估" onClick={() => navigate(`/patients/${patient.id}/assessment`, { replace: true })}>
          <ChevronLeft size={24} strokeWidth={2.6} />
        </RoundButton>
        <div className="min-w-0">
          <p className="truncate text-[0.9rem] font-bold text-ink-soft">
            <Name name={patient.name} />・{idx === 0 ? "基本資料" : `第 ${idx}/13 張`}
          </p>
          <h1 className="font-round text-[1.4rem] font-extrabold leading-tight">{form.title}</h1>
        </div>
      </header>

      {form.score && (
        <div className="sticky top-[env(safe-area-inset-top)] z-20 mb-3 flex items-center gap-3 rounded-[22px] bg-night px-4 py-3 text-night-ink">
          <span className="num text-[1.8rem] font-extrabold leading-none">{live ? live.score : "—"}</span>
          <span className="text-[0.95rem] font-bold opacity-80">/ {form.score.max} {form.score.unit}</span>
          {live ? <span className={cx("ml-auto rounded-full px-3 py-1 text-[0.9rem] font-extrabold", TONE[live.level.tone])}>{live.level.label}</span> : <span className="ml-auto text-[0.9rem] font-bold opacity-70">全部作答後計分</span>}
        </div>
      )}
      {form.hint && <p className="mb-3 text-[0.92rem] font-bold text-ink-soft">{form.hint}</p>}

      <div className="flex flex-col gap-3 pb-4">
        {form.fields.map((f, i) => (
          <FieldInput key={f.id} field={f} n={form.score && f.kind === "choice" ? i + 1 : null} value={values[f.id]} onChange={(v) => set(f.id, v)} />
        ))}
      </div>

      <div className="sticky bottom-[calc(env(safe-area-inset-bottom)+78px)] z-20 -mx-4 flex gap-2.5 bg-paper/90 px-4 pb-2 pt-2 backdrop-blur-md md:-mx-8 md:px-8 lg:bottom-0">
        <Button size="lg" className="flex-1" disabled={busy || (!dirty && !!saved)} onClick={() => save(false)}>
          {dirty || !saved ? "儲存" : "已儲存"}
        </Button>
        {next && (
          <Button variant="primary" size="lg" className="flex-[1.6]" disabled={busy} icon={<ChevronRight size={20} />} onClick={() => save(true)}>
            儲存，下一張
          </Button>
        )}
      </div>
    </div>
  );
}

/** 新填時先帶入 App 已有的資料（身高、體重、生命徵象、病史）。 */
function prefill(form: FormDef, patient: Patient): FormValues {
  if (form.id === "history") {
    const known = (FORM_BY_ID.history.fields[0] as Extract<Field, { kind: "multi" }>).options.map((o) => o.value);
    const hits = known.filter((k) => patient.diagnoses.some((d) => d.includes(k.replace("／COPD", "")) || (k === "氣喘／COPD" && /阻塞性肺|氣喘|COPD/i.test(d))));
    return hits.length ? { diseases: hits } : {};
  }
  if (form.id === "physical") {
    const v = patient.last?.vitals ?? [];
    const get = (k: string) => v.find((x) => x.key === k)?.value;
    const bp = get("bp")?.split("/");
    return { height: patient.heightCm ?? undefined, bt: get("temp"), hr: get("pulse"), rr: get("resp"), sbp: bp?.[0], dbp: bp?.[1] };
  }
  return {};
}

function FieldInput({ field, n, value, onChange }: { field: Field; n: number | null; value: FieldValue | undefined; onChange: (v: FieldValue | undefined) => void }) {
  const label = (
    <span className="mb-2 block text-[1.02rem] font-extrabold">
      {n ? <span className="num mr-1.5 text-ink-soft">{n}.</span> : null}
      {field.label}
    </span>
  );
  switch (field.kind) {
    case "choice":
      return (
        <div role="group" aria-label={field.label} className="rounded-[22px] bg-card p-3.5 outline-ink">
          {label}
          <div className="flex flex-wrap gap-2">
            {field.options.map((o) => (
              <Chip key={o.value} active={value === o.value} onClick={() => onChange(value === o.value ? undefined : o.value)}>
                {o.label}
                {o.score !== undefined ? <span className="num opacity-60">{o.score}</span> : null}
              </Chip>
            ))}
          </div>
        </div>
      );
    case "multi": {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div role="group" aria-label={field.label} className="rounded-[22px] bg-card p-3.5 outline-ink">
          {label}
          <div className="flex flex-wrap gap-2">
            {field.options.map((o) => (
              <Chip key={o.value} active={arr.includes(o.value)} onClick={() => onChange(arr.includes(o.value) ? arr.filter((x) => x !== o.value) : [...arr, o.value])}>
                {o.label}
              </Chip>
            ))}
          </div>
        </div>
      );
    }
    case "check":
      return (
        <button
          type="button"
          aria-pressed={value === true}
          onClick={() => onChange(value === true ? false : true)}
          className={cx("flex min-h-[56px] items-center gap-3 rounded-[22px] px-4 text-left font-extrabold outline-ink", value === true ? "bg-plan-tint" : "bg-card")}
        >
          <span className={cx("grid h-7 w-7 shrink-0 place-items-center rounded-lg", value === true ? "bg-ink text-paper" : "bg-ink/10")}>{value === true && <Check size={18} strokeWidth={3} />}</span>
          {field.label}
        </button>
      );
    case "scale":
      return (
        <div role="group" aria-label={field.label} className="rounded-[22px] bg-card p-3.5 outline-ink">
          {label}
          <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-11">
            {Array.from({ length: field.max - field.min + 1 }, (_, i) => String(field.min + i)).map((s) => (
              <button
                key={s}
                type="button"
                aria-pressed={value === s}
                onClick={() => onChange(value === s ? undefined : s)}
                className={cx("num min-h-[48px] rounded-2xl text-[1.15rem] font-extrabold", value === s ? "bg-ink text-paper" : "bg-sunken")}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[0.85rem] font-bold text-ink-soft">
            <span>{field.low}</span>
            <span>{field.high}</span>
          </div>
        </div>
      );
    case "number":
      return (
        <label className="flex items-center gap-3 rounded-[22px] bg-card p-3.5 outline-ink">
          <span className="min-w-0 flex-1 text-[1.02rem] font-extrabold">{field.label}</span>
          <input
            inputMode="decimal"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value.replace(/[^\d./]/g, "").slice(0, 6) || undefined)}
            placeholder="—"
            className="num min-h-[48px] w-28 rounded-2xl bg-sunken px-3 text-center text-[1.2rem] font-extrabold outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]"
          />
          <span className="w-14 shrink-0 text-[0.9rem] font-bold text-ink-soft">{field.unit}</span>
        </label>
      );
    case "text":
      return (
        <label className="block rounded-[22px] bg-card p-3.5 outline-ink">
          {label}
          {field.long ? (
            <textarea
              value={typeof value === "string" ? value : ""}
              placeholder={field.placeholder}
              onChange={(e) => onChange(e.target.value || undefined)}
              rows={3}
              className="w-full resize-y rounded-2xl bg-sunken p-3 text-[1.05rem] outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]"
            />
          ) : (
            <input
              type={field.type ?? "text"}
              value={typeof value === "string" ? value : ""}
              placeholder={field.placeholder}
              onChange={(e) => onChange(e.target.value || undefined)}
              className={inputClass}
            />
          )}
        </label>
      );
  }
}
