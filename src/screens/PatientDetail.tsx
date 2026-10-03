import { useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { CalendarPlus, ChevronLeft, ChevronRight, Copy, FileUp, Mic, Pencil, Plus, Trash2, X } from "lucide-react";
import { useFlows } from "../app/Flows";
import { Critter } from "../components/Critter";
import { Name, RevealButton } from "../components/Name";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Button, Chip, Field, Pill, RoundButton, inputClass } from "../components/ui";
import { consentValid, deletePatient, recordConsent, scheduleVisit } from "../lib/actions";
import { writeClipboard } from "../lib/compose";
import { updatePatient } from "../lib/db";
import { addDays, ageOf, daysUntil, shortDate, todayStr } from "../lib/format";
import { usePatient, usePatientVisits } from "../lib/hooks";
import { newId, type Patient, type Tube } from "../lib/model";
import { PLAN_SOURCE_LABEL } from "../../shared/types";
import { nextDue } from "../lib/pipeline";
import { visitStatus } from "../lib/status";
import { planBadge } from "../lib/planSlot";
import { AssessmentCard } from "../assessment/AssessmentScreens";
import { completedCount } from "../assessment/forms";

export function PatientDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const patient = usePatient(id);
  const visits = usePatientVisits(id);
  const flows = useFlows();
  const toast = useToast();
  const [tube, setTube] = useState<Tube | "new" | null>(null);
  const [showPlan, setShowPlan] = useState(false);

  if (patient === null) {
    return (
      <div className="grid min-h-[60dvh] place-items-center p-6 text-center">
        <div className="flex flex-col items-center gap-4">
          <Critter kind="empty" size={80} />
          <p className="text-[1.2rem] font-bold">找不到這位個案</p>
          <Button variant="primary" onClick={() => navigate("/patients")}>
            回到個案
          </Button>
        </div>
      </div>
    );
  }
  if (!patient || !visits) return null;

  const age = ageOf(patient.birthYear);
  const sorted = [...visits].sort((a, b) => (b.date + (b.time ?? "")).localeCompare(a.date + (a.time ?? "")));
  const valid = consentValid(patient);
  const assessed = completedCount(patient.assessment) === 13;
  // 真正的初訪（沒有評估、計畫、訪視）才把全人評估放最上面。
  const firstVisit = !assessed && !patient.plan && !patient.last;
  // 已在今日清單上就不再顯示「加入今日」。
  const onToday = sorted.some((v) => v.date === todayStr());

  return (
    <div className="mx-auto w-full max-w-[880px] px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 lg:pt-8">
      <header className="mb-4 flex items-center gap-2">
        <RoundButton label="返回" onClick={() => (location.key !== "default" ? navigate(-1) : navigate("/patients"))}>
          <ChevronLeft size={24} strokeWidth={2.6} />
        </RoundButton>
        <div className="ml-auto flex gap-2">
          <RevealButton size={48} />
          <RoundButton label="編輯個案" size={48} onClick={() => flows.editPatient(patient)}>
            <Pencil size={20} />
          </RoundButton>
        </div>
      </header>

      <section className="contours relative mb-4 overflow-hidden rounded-[32px] bg-night p-6 text-night-ink">
        <div className="flex items-center gap-4">
          <span className="rounded-full bg-white/10 p-2">
            <Critter avatarId={patient.id} size={76} />
          </span>
          <div className="min-w-0">
            <h1 className="truncate font-round text-[2rem] font-extrabold leading-tight">
              <Name name={patient.name} />
            </h1>
            <p className="font-bold opacity-80">{[age ? `${age} 歲` : null, patient.gender, patient.familyCallsAs ? `「${patient.familyCallsAs}」` : null].filter(Boolean).join(" · ")}</p>
          </div>
        </div>
        {patient.diagnoses.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {patient.diagnoses.map((d) => (
              <span key={d} className="rounded-full bg-white/12 px-3 py-1 text-[0.92rem] font-bold">
                {d}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* 新個案的初次訪視要先做 13 張評估：放在最前面，「開始錄音」改成次要按鈕，畫面上只有一顆黑色主按鈕。 */}
      {firstVisit && (
        <div className="mb-4">
          <AssessmentCard patient={patient} highlight />
        </div>
      )}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Button variant={firstVisit ? "secondary" : "primary"} size="lg" className="col-span-2" icon={<Mic size={22} />} onClick={() => flows.record(patient)}>
          開始錄音
        </Button>
        {!onToday && (
          <Button
            size="lg"
            icon={<CalendarPlus size={20} />}
            onClick={async () => {
              await scheduleVisit(patient.id, todayStr(), null);
              toast("已加入今日");
            }}
          >
            加入今日
          </Button>
        )}
        <Button size="lg" className={onToday ? "col-span-2" : undefined} icon={<FileUp size={20} />} onClick={() => flows.openNew(patient)}>
          匯入
        </Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {!firstVisit && (
          <div className="md:col-span-2">
            <AssessmentCard patient={patient} />
          </div>
        )}
        <Card title="錄音同意">
          {valid ? (
            <>
              <p className="font-bold">
                {patient.consent!.by}同意・至 {shortDate(patient.consent!.expiresAt)}
              </p>
              <Button
                className="mt-3"
                size="sm"
                onClick={async () => {
                  await updatePatient(patient.id, { consent: null });
                  toast("已撤回錄音同意");
                }}
              >
                撤回同意
              </Button>
            </>
          ) : (
            <>
              <p className="font-bold text-ink-soft">{patient.consentRefusedAt ? `${shortDate(patient.consentRefusedAt.slice(0, 10))} 表示不同意錄音` : "尚未取得"}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => recordConsent(patient.id, "個案本人")}>
                  個案本人同意
                </Button>
                <Button size="sm" onClick={() => recordConsent(patient.id, "家屬")}>
                  家屬同意
                </Button>
              </div>
            </>
          )}
        </Card>

        <Card title={patient.plan ? `現行計畫第 ${patient.plan.version} 版` : "護理計畫"}>
          {patient.plan ? (
            <>
              <p className="text-[0.95rem] text-ink-soft">
                {shortDate(patient.plan.confirmedAt.slice(0, 10))} {patient.plan.by}確認
                {patient.plan.source && `・${PLAN_SOURCE_LABEL[patient.plan.source]}`}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setShowPlan(true)}>
                  查看
                </Button>
                <Button
                  size="sm"
                  icon={<Copy size={16} />}
                  onClick={async () => {
                    if (await writeClipboard(patient.plan!.text)) toast("已複製現行計畫");
                    else toast("無法寫入剪貼簿，請長按文字自行複製", { error: true });
                  }}
                >
                  複製
                </Button>
              </div>
            </>
          ) : (
            <p className="text-ink-soft">尚無計畫</p>
          )}
        </Card>

        <Card
          title="管路"
          action={
            <RoundButton label="新增管路" size={40} onClick={() => setTube("new")}>
              <Plus size={20} strokeWidth={2.8} />
            </RoundButton>
          }
        >
          {patient.tubes.length === 0 ? (
            <p className="text-ink-soft">無管路</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {patient.tubes.map((t) => {
                const due = nextDue(t.changedAt, t.intervalDays);
                const d = due ? daysUntil(due) : null;
                return (
                  <li key={t.id}>
                    <button type="button" onClick={() => setTube(t)} className="flex min-h-[52px] w-full items-center gap-2 rounded-2xl bg-sunken px-3 text-left font-bold">
                      <span className="flex-1">{t.name}</span>
                      {due && <Pill tone={d !== null && d <= 7 ? "audio" : "muted"}>{d !== null && d < 0 ? `已過期 ${-d} 天` : `${shortDate(due)} 到期`}</Pill>}
                      <Pencil size={16} className="text-ink-soft" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        {patient.last && (
          <Card title="上次重點">
            <p className="font-bold">
              {shortDate(patient.last.date)}：{patient.last.summary}
            </p>
            {patient.last.findings.length > 0 && (
              <ul className="mt-2 list-disc pl-5 text-[0.98rem] text-ink-soft">
                {patient.last.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            )}
          </Card>
        )}
      </div>

      <h2 className="mb-3 mt-6 font-round text-[1.4rem] font-extrabold">歷次訪視</h2>
      {sorted.length === 0 ? (
        <p className="rounded-[22px] bg-card p-4 text-ink-soft outline-ink">尚無訪視</p>
      ) : (
        <div className="flex flex-col gap-2">
          {sorted.map((v) => {
            const st = visitStatus(v);
            const badge = planBadge(v);
            return (
              <Link key={v.id} to={`/v/${v.id}`} className="flex min-h-[64px] items-center gap-3 rounded-[22px] bg-card px-4 outline-ink">
                <Critter kind={st.critter} size={34} animate={v.status === "processing"} />
                <span className="min-w-0 flex-1 py-2">
                  <span className="num block font-extrabold">
                    {shortDate(v.date)} {v.time ?? ""}
                  </span>
                  {badge && <Pill tone="muted" className="mt-1">{badge}</Pill>}
                </span>
                <Pill tone={st.tone}>{st.label}</Pill>
                <ChevronRight size={18} className="text-ink-faint" />
              </Link>
            );
          })}
        </div>
      )}

      <Button
        variant="ghost"
        className="mb-4 mt-8 text-danger"
        icon={<Trash2 size={18} />}
        onClick={async () => {
          const undo = await deletePatient(patient.id);
          navigate("/patients", { replace: true });
          toast("已刪除個案", undo ? { action: { label: "復原", run: () => void undo() } } : undefined);
        }}
      >
        刪除個案及記錄
      </Button>

      <TubeSheet patient={patient} tube={tube} onClose={() => setTube(null)} />
      <Sheet open={showPlan} onClose={() => setShowPlan(false)} title={`現行計畫第 ${patient.plan?.version ?? ""} 版`} full>
        <p className="whitespace-pre-line pb-4 text-[1.08rem] leading-[1.75]">{patient.plan?.text}</p>
      </Sheet>
    </div>
  );
}

function Card({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="rounded-[26px] bg-card p-4 outline-ink">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-round text-[1.2rem] font-extrabold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

const TUBE_PRESETS: [string, number][] = [
  ["鼻胃管", 30],
  ["導尿管", 30],
  ["氣切管", 30],
  ["胃造口", 90],
  ["恥骨上膀胱造口", 28],
];

function TubeSheet({ patient, tube, onClose }: { patient: Patient; tube: Tube | "new" | null; onClose: () => void }) {
  return (
    <Sheet open={!!tube} onClose={onClose} title={tube === "new" ? "新增管路" : "編輯管路"}>
      {tube && <TubeForm key={tube === "new" ? "new" : tube.id} patient={patient} tube={tube === "new" ? null : tube} onDone={onClose} />}
    </Sheet>
  );
}

function TubeForm({ patient, tube, onDone }: { patient: Patient; tube: Tube | null; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(tube?.name ?? "");
  const [changedAt, setChangedAt] = useState(tube?.changedAt ?? todayStr());
  const [intervalDays, setIntervalDays] = useState(String(tube?.intervalDays ?? 30));

  const save = async () => {
    const next: Tube = { id: tube?.id ?? newId(), name: name.trim(), changedAt: changedAt || null, intervalDays: Number(intervalDays) || null };
    const tubes = tube ? patient.tubes.map((t) => (t.id === tube.id ? next : t)) : [...patient.tubes, next];
    await updatePatient(patient.id, { tubes });
    toast("已儲存管路");
    onDone();
  };

  return (
    <div className="flex flex-col gap-4 pb-2">
      {!tube && (
        <div className="flex flex-wrap gap-2">
          {TUBE_PRESETS.map(([n, d]) => (
            <Chip
              key={n}
              active={name === n}
              onClick={() => {
                setName(n);
                setIntervalDays(String(d));
              }}
            >
              {n}
            </Chip>
          ))}
        </div>
      )}
      <Field label="名稱">
        <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} placeholder="例如 鼻胃管" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="上次更換">
          <input type="date" value={changedAt} max={todayStr()} min={addDays(todayStr(), -365)} onChange={(e) => setChangedAt(e.target.value)} className={inputClass} />
        </Field>
        <Field label="更換間隔（天）">
          <input inputMode="numeric" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value.replace(/\D/g, "").slice(0, 3))} className={inputClass} />
        </Field>
      </div>
      <Button variant="primary" size="lg" block disabled={!name.trim()} onClick={save}>
        儲存
      </Button>
      {tube && (
        <Button
          variant="ghost"
          className="text-danger"
          icon={<X size={18} />}
          onClick={async () => {
            await updatePatient(patient.id, { tubes: patient.tubes.filter((t) => t.id !== tube.id) });
            toast("已移除管路");
            onDone();
          }}
        >
          移除管路
        </Button>
      )}
    </div>
  );
}
