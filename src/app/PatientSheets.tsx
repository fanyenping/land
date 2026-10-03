import { useMemo, useState, type FormEvent } from "react";
import { Search, UserPlus } from "lucide-react";
import { Critter } from "../components/Critter";
import { Name } from "../components/Name";
import { Sheet } from "../components/Sheet";
import { Button, Chip, Field, Segmented, cx, inputClass } from "../components/ui";
import { createPatient, type PatientForm } from "../lib/actions";
import { RESIDENCE_OPTIONS, RESOURCE_OPTIONS } from "../export/careRecord";
import { ageOf, maskName, todayStr } from "../lib/format";
import { usePatients } from "../lib/hooks";
import type { Patient } from "../lib/model";
import { updatePatient } from "../lib/db";

export function PatientRow({ p, onPick, right }: { p: Patient; onPick: () => void; right?: React.ReactNode }) {
  const age = ageOf(p.birthYear);
  return (
    <div className="flex items-center gap-3 rounded-[22px] bg-card p-2.5 pr-3 outline-ink">
      <button type="button" onClick={onPick} className="flex min-h-[56px] min-w-0 flex-1 items-center gap-3 text-left">
        <Critter avatarId={p.id} size={46} />
        <span className="min-w-0">
          <span className="block truncate text-[1.1rem] font-extrabold">
            <Name name={p.name} />
            {p.familyCallsAs && <span className="ml-2 text-[0.92rem] font-bold text-ink-soft">{p.familyCallsAs}</span>}
          </span>
          <span className="block truncate text-[0.88rem] text-ink-soft">
            {[age ? `${age} 歲` : null, p.gender, p.diagnoses.slice(0, 2).join("、") || null].filter(Boolean).join(" · ")}
          </span>
        </span>
      </button>
      {right}
    </div>
  );
}

/** H3 找個案：搜尋（姓名、稱呼、診斷）＋最近個案＋新增個案。 */
export function FindPatientSheet({
  open,
  onClose,
  title,
  onPick,
  excludeId,
  onCreate,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onPick: (p: Patient) => void;
  excludeId?: string;
  onCreate: () => void;
}) {
  const patients = usePatients();
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const term = q.trim();
    return (patients ?? [])
      .filter((p) => p.id !== excludeId)
      .filter((p) => !term || p.name.includes(term) || maskName(p.name).includes(term) || (p.familyCallsAs ?? "").includes(term) || p.diagnoses.some((d) => d.includes(term)));
  }, [patients, q, excludeId]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <Button block size="lg" variant="secondary" icon={<UserPlus size={22} strokeWidth={2.5} />} onClick={onCreate}>
          新增個案
        </Button>
      }
    >
      <label className="relative mb-3 block">
        <span className="sr-only">搜尋個案</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ink-soft" size={20} />
        <input data-autofocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="姓名、稱呼或診斷" className={cx(inputClass, "pl-11")} />
      </label>
      <div className="flex flex-col gap-2.5">
        {list.map((p) => (
          <PatientRow key={p.id} p={p} onPick={() => onPick(p)} />
        ))}
        {patients && list.length === 0 && (
          <div className="flex flex-col items-center gap-2 py-8 text-center text-ink-soft">
            <Critter kind="empty" size={64} />
            <p className="font-bold">{q ? `找不到「${q}」` : "還沒有個案"}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}

const thisYear = new Date().getFullYear();

/** 新增或編輯個案：只要稱呼即可，其他由文件或之後補上。 */
export function PatientFormSheet({
  open,
  onClose,
  onSaved,
  initial,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (p: Patient) => void;
  initial?: Patient | null;
}) {
  return (
    <Sheet open={open} onClose={onClose} title={initial ? "編輯個案" : "新增個案"}>
      {open && <PatientFormBody key={initial?.id ?? "new"} initial={initial ?? null} onSaved={onSaved} />}
    </Sheet>
  );
}

function PatientFormBody({ initial, onSaved }: { initial: Patient | null; onSaved: (p: Patient) => void }) {
  const [name, setName] = useState(initial?.name ?? "");
  const [gender, setGender] = useState<"女" | "男" | "">(initial?.gender ?? "");
  const [age, setAge] = useState(initial?.birthYear ? String(thisYear - initial.birthYear) : "");
  const [calls, setCalls] = useState(initial?.familyCallsAs ?? "");
  const [dx, setDx] = useState(initial?.diagnoses.join("、") ?? "");
  const [intake, setIntake] = useState(initial?.intakeDate ?? initial?.createdAt.slice(0, 10) ?? todayStr());
  const [height, setHeight] = useState(initial?.heightCm ?? "");
  const [residence, setResidence] = useState(initial?.residence ?? "");
  const [area, setArea] = useState(initial?.area ?? "");
  const [resource, setResource] = useState(initial?.resource ?? "");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    const form: PatientForm = {
      name: name.trim(),
      gender: gender || null,
      birthYear: age ? thisYear - Number(age) : null,
      familyCallsAs: calls.trim() || null,
      diagnoses: dx
        .split(/[、,，;；\n]/)
        .map((s) => s.trim())
        .filter(Boolean),
      intakeDate: intake || null,
      heightCm: height || null,
      residence: residence || null,
      area: area.trim() || null,
      resource: resource || null,
    };
    if (initial) {
      await updatePatient(initial.id, form);
      onSaved({ ...initial, ...form });
    } else {
      onSaved(await createPatient(form));
    }
    setBusy(false);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4 pb-2">
      <Field label="姓名">
        <input data-autofocus required value={name} onChange={(e) => setName(e.target.value)} className={inputClass} autoComplete="off" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="年齡">
          <input inputMode="numeric" pattern="[0-9]*" value={age} onChange={(e) => setAge(e.target.value.replace(/\D/g, "").slice(0, 3))} className={inputClass} placeholder="例如 84" />
        </Field>
        <Field label="家屬怎麼稱呼">
          <input value={calls} onChange={(e) => setCalls(e.target.value)} className={inputClass} placeholder="例如 阿嬤" />
        </Field>
      </div>
      <div>
        <span className="mb-1.5 block text-[0.95rem] font-bold">性別</span>
        <Segmented
          label="性別"
          value={gender || ("" as "女" | "男" | "")}
          onChange={(v) => setGender(v)}
          options={[
            { value: "女", label: "女" },
            { value: "男", label: "男" },
            { value: "", label: "未填" },
          ]}
        />
      </div>
      <Field label="主要診斷" hint="用頓號分開，例如：腦中風後遺症、高血壓">
        <input value={dx} onChange={(e) => setDx(e.target.value)} className={inputClass} />
      </Field>
      <details className="rounded-[22px] bg-card p-4 outline-ink" open={!!initial && !!(initial.residence || initial.area || initial.resource || initial.heightCm)}>
        <summary className="cursor-pointer font-bold">照護紀錄資料（選填，導出 PDF 用）</summary>
        <div className="mt-3 flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="收案日期">
              <input type="date" value={intake} onChange={(e) => setIntake(e.target.value)} className={inputClass} />
            </Field>
            <Field label="身高 cm">
              <input inputMode="decimal" value={height} onChange={(e) => setHeight(e.target.value.replace(/[^\d.]/g, "").slice(0, 5))} className={inputClass} placeholder="例如 152" />
            </Field>
          </div>
          <Field label="居住區域">
            <input value={area} onChange={(e) => setArea(e.target.value)} className={inputClass} placeholder="例如 臺北市文山區" />
          </Field>
          <div>
            <span className="mb-1.5 block text-[0.95rem] font-bold">居住所</span>
            <div className="flex flex-wrap gap-2">
              {RESIDENCE_OPTIONS.map((r) => (
                <Chip key={r} active={residence === r} onClick={() => setResidence(residence === r ? "" : r)}>
                  {r}
                </Chip>
              ))}
            </div>
          </div>
          <div>
            <span className="mb-1.5 block text-[0.95rem] font-bold">使用資源</span>
            <div className="flex flex-wrap gap-2">
              {RESOURCE_OPTIONS.map((r) => (
                <Chip key={r} active={resource === r} onClick={() => setResource(resource === r ? "" : r)}>
                  {r}
                </Chip>
              ))}
            </div>
          </div>
        </div>
      </details>
      <Button type="submit" variant="primary" size="lg" block disabled={!name.trim() || busy}>
        {initial ? "儲存" : "建立個案"}
      </Button>
    </form>
  );
}
