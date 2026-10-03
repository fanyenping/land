import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Mic } from "lucide-react";
import { Critter, type CritterKind } from "../components/Critter";
import { Name } from "../components/Name";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Button, cx } from "../components/ui";
import {
  classifyFiles,
  consentValid,
  ensureTodayVisit,
  importToPatient,
  moveVisit,
  recordConsent,
  refuseConsent,
  startRecording,
  storageErrorMessage,
  storeSummary,
} from "../lib/actions";
import { TRIAL } from "../lib/env";
import { bytes } from "../lib/format";
import type { Patient } from "../lib/model";
import { FindPatientSheet, PatientFormSheet, PatientRow } from "./PatientSheets";
import { usePatients } from "../lib/hooks";

interface Flows {
  /** 開新紀錄面板（底部導覽 ＋）。 */
  openNew: (patient?: Patient) => void;
  /** 為某位個案開始錄音（先檢查錄音同意）。 */
  record: (patient: Patient, mode?: "visit" | "dictate") => void;
  /** 選個案後開始錄音。 */
  recordForSomeone: () => void;
  /** 匯入檔案：指定個案則直接處理，否則先選個案。 */
  importFiles: (files: File[], patient?: Patient) => void;
  /** 開找個案面板。 */
  findPatient: (title: string, onPick: (p: Patient) => void, excludeId?: string) => void;
  /** 新增或編輯個案。 */
  editPatient: (initial?: Patient | null, onSaved?: (p: Patient) => void) => void;
  /** 把這筆紀錄改到其他個案（可復原）。 */
  moveTo: (visitId: string, fromPatientId: string) => void;
}

const Ctx = createContext<Flows | null>(null);

export function useFlows() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFlows outside provider");
  return v;
}

type FileKind = "photo" | "pdf" | "audio";

const PICKERS: { kind: FileKind; label: string; critter: CritterKind; accept: string; capture?: boolean }[] = [
  { kind: "photo", label: "拍文件", critter: "photo", accept: "image/*", capture: true },
  { kind: "pdf", label: "選 PDF 檔", critter: "pdf", accept: "application/pdf,.pdf" },
  { kind: "audio", label: "選錄音檔", critter: "audio", accept: "audio/*,.m4a,.mp3,.wav,.aac,.webm,.ogg" },
];

export function FlowsProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const toast = useToast();

  const [newOpen, setNewOpen] = useState(false);
  const [newPatient, setNewPatient] = useState<Patient | null>(null);
  const [find, setFind] = useState<{ title: string; onPick: (p: Patient) => void; excludeId?: string } | null>(null);
  const [form, setForm] = useState<{ initial: Patient | null; onSaved?: (p: Patient) => void } | null>(null);
  const [assign, setAssign] = useState<File[] | null>(null);
  const [consent, setConsent] = useState<{ patient: Patient; mode: "visit" | "dictate" } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<Patient | null>(null);

  const go = useCallback(
    async (patient: Patient, mode: "visit" | "dictate") => {
      const v = await ensureTodayVisit(patient.id);
      // 試用版沒有麥克風：直接到錄音畫面，改用「選錄音檔」。
      const started = TRIAL ? true : await startRecording(v.id);
      navigate(`/v/${v.id}/rec${mode === "dictate" ? "?mode=dictate" : ""}`, { state: { startFailed: !started } });
    },
    [navigate],
  );

  const record = useCallback(
    (patient: Patient, mode: "visit" | "dictate" = "visit") => {
      // 試用版不會真的錄音，不必（也不該記下）錄音同意。
      if (TRIAL || mode === "dictate" || consentValid(patient)) void go(patient, mode);
      else setConsent({ patient, mode });
    },
    [go],
  );

  const findPatient = useCallback((title: string, onPick: (p: Patient) => void, excludeId?: string) => setFind({ title, onPick, excludeId }), []);

  const editPatient = useCallback((initial?: Patient | null, onSaved?: (p: Patient) => void) => setForm({ initial: initial ?? null, onSaved }), []);

  const recordForSomeone = useCallback(() => {
    findPatient("要錄哪一位？", (p) => {
      setFind(null);
      record(p);
    });
  }, [findPatient, record]);

  const runImport = useCallback(
    async (files: File[], patient: Patient) => {
      const { audio, docs } = classifyFiles(files);
      if (audio.length + docs.length === 0) {
        toast("沒有可用的檔案（支援 PDF、照片、錄音檔）");
        return;
      }
      try {
        const { visitId, result } = await importToPatient(patient.id, files);
        toast(storeSummary(result, "，開始整理"), { ms: result.skipped.length ? 5000 : undefined, error: !visitId });
        if (visitId) navigate(`/v/${visitId}`);
      } catch (err) {
        toast(storageErrorMessage(err), { error: true });
      }
    },
    [navigate, toast],
  );

  const importFiles = useCallback(
    (files: File[], patient?: Patient) => {
      if (files.length === 0) return;
      if (patient) void runImport(files, patient);
      else setAssign(files);
    },
    [runImport],
  );

  const openNew = useCallback((patient?: Patient) => {
    setNewPatient(patient ?? null);
    setNewOpen(true);
  }, []);

  const pickFiles = (accept: string, capture?: boolean) => {
    const input = fileInput.current;
    if (!input) return;
    input.accept = accept;
    if (capture) input.setAttribute("capture", "environment");
    else input.removeAttribute("capture");
    pickTarget.current = newPatient;
    input.value = "";
    input.click();
  };

  const moveTo = useCallback(
    (visitId: string, fromPatientId: string) =>
      findPatient(
        "改到哪一位？",
        async (p) => {
          const res = await moveVisit(visitId, p.id);
          if (!res) return;
          toast(res.copied ? "已改到其他個案，請重新確認後再複製" : "已改到其他個案", {
            action: { label: "復原", run: () => void res.undo() },
            ms: res.copied ? 6000 : undefined,
          });
        },
        fromPatientId,
      ),
    [findPatient, toast],
  );

  const value: Flows = { openNew, record, recordForSomeone, importFiles, findPatient, editPatient, moveTo };

  return (
    <Ctx.Provider value={value}>
      {children}

      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          setNewOpen(false);
          importFiles(files, pickTarget.current ?? undefined);
        }}
      />

      <Sheet open={newOpen} onClose={() => setNewOpen(false)} title={newPatient ? <>新紀錄・<Name name={newPatient.name} /></> : "新紀錄"}>
        <div className="grid grid-cols-2 gap-3 pb-2">
          <button
            type="button"
            onClick={() => {
              setNewOpen(false);
              if (newPatient) record(newPatient);
              else recordForSomeone();
            }}
            className="sticker col-span-2 flex min-h-[96px] items-center gap-4 rounded-[26px] bg-audio px-5 text-left text-[#141414]"
          >
            {/* 小怪物和方格同色：放在黑色圓底上（同錄音畫面）。 */}
            <span className="grid h-[60px] w-[60px] shrink-0 place-items-center rounded-full bg-[#141414]">
              <Critter kind="audio" size={40} />
            </span>
            <span className="flex-1 text-[1.35rem] font-extrabold">開始錄音</span>
            <span className="grid h-12 w-12 place-items-center rounded-full bg-[#141414] text-white">
              <Mic size={24} strokeWidth={2.6} />
            </span>
          </button>
          {PICKERS.map((p) => (
            <button
              key={p.kind}
              type="button"
              onClick={() => pickFiles(p.accept, p.capture)}
              className={cx(
                "sticker flex min-h-[120px] flex-col items-start justify-between gap-2 rounded-[26px] p-4 text-left text-[#141414]",
                p.kind === "photo" && "bg-edu",
                p.kind === "pdf" && "bg-pdf",
                p.kind === "audio" && "bg-pending",
                // 從個案頁打開時沒有「新增個案」方格：「選錄音檔」佔滿一排，不要單獨吊在左下。
                p.kind === "audio" && newPatient && "col-span-2 min-h-[96px]",
              )}
            >
              {p.kind === "pdf" ? (
                <span className="grid h-[46px] w-[46px] place-items-center rounded-full bg-[#141414]">
                  <Critter kind={p.critter} size={32} />
                </span>
              ) : (
                <Critter kind={p.critter} size={46} />
              )}
              <span className="text-[1.12rem] font-extrabold">{p.label}</span>
            </button>
          ))}
          {!newPatient && (
            <button
              type="button"
              onClick={() => {
                setNewOpen(false);
                editPatient(null, (p) => navigate(`/patients/${p.id}`));
              }}
              className="sticker flex min-h-[120px] flex-col items-start justify-between gap-2 rounded-[26px] bg-card p-4 text-left"
            >
              <Critter kind="nurse" size={46} />
              <span className="text-[1.12rem] font-extrabold">新增個案</span>
            </button>
          )}
        </div>
      </Sheet>

      <FindPatientSheet
        open={!!find}
        onClose={() => setFind(null)}
        title={find?.title ?? ""}
        excludeId={find?.excludeId}
        onPick={(p) => {
          const cb = find?.onPick;
          setFind(null);
          cb?.(p);
        }}
        onCreate={() => {
          const cb = find?.onPick;
          setFind(null);
          setForm({ initial: null, onSaved: cb });
        }}
      />

      <PatientFormSheet
        open={!!form}
        initial={form?.initial}
        onClose={() => setForm(null)}
        onSaved={(p) => {
          const cb = form?.onSaved;
          setForm(null);
          toast(form?.initial ? "已儲存" : "已建立個案");
          cb?.(p);
        }}
      />

      <AssignSheet
        files={assign}
        onClose={() => setAssign(null)}
        onPick={(p) => {
          const files = assign ?? [];
          setAssign(null);
          void runImport(files, p);
        }}
        onCreate={() => {
          const files = assign ?? [];
          setAssign(null);
          setForm({ initial: null, onSaved: (p) => void runImport(files, p) });
        }}
      />

      <ConsentSheet
        state={consent}
        onClose={() => setConsent(null)}
        onAgree={async (by) => {
          if (!consent) return;
          await recordConsent(consent.patient.id, by);
          const { patient, mode } = consent;
          setConsent(null);
          void go(patient, mode);
        }}
        onRefuse={async () => {
          if (!consent) return;
          await refuseConsent(consent.patient.id);
          const p = consent.patient;
          setConsent(null);
          toast("已記下不同意錄音", { action: { label: "改用口述", run: () => record(p, "dictate") } });
        }}
      />
    </Ctx.Provider>
  );
}

function AssignSheet({ files, onClose, onPick, onCreate }: { files: File[] | null; onClose: () => void; onPick: (p: Patient) => void; onCreate: () => void }) {
  const patients = usePatients();
  const summary = files ? classifyFiles(files) : null;
  return (
    <Sheet
      open={!!files}
      onClose={onClose}
      title="加入哪位個案？"
      footer={
        <Button block size="lg" variant="secondary" onClick={onCreate}>
          建立新個案
        </Button>
      }
    >
      {files && summary && (
        <div className="mb-4 flex flex-col gap-2">
          {files.slice(0, 6).map((f) => {
            const kind = summary.audio.includes(f) ? "audio" : summary.docs.includes(f) ? (f.type.startsWith("image/") ? "photo" : "pdf") : "error";
            return (
              <div key={f.name + f.size} className="flex items-center gap-3 rounded-2xl bg-ink/[0.05] px-3 py-2">
                <Critter kind={kind as CritterKind} size={30} />
                <span className="min-w-0 flex-1 truncate font-bold">{f.name}</span>
                <span className="num shrink-0 text-[0.85rem] text-ink-soft">{kind === "error" ? "不支援" : bytes(f.size)}</span>
              </div>
            );
          })}
          {files.length > 6 && <div className="px-1 text-[0.9rem] font-bold text-ink-soft">還有 {files.length - 6} 個檔案</div>}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {(patients ?? []).map((p) => (
          <PatientRow key={p.id} p={p} onPick={() => onPick(p)} />
        ))}
      </div>
    </Sheet>
  );
}

const CONSENT_SCRIPT = "為了正確記錄今天的照護，我會錄音。錄音只用來整理護理記錄，完成後就刪除，不會給其他人。";

function ConsentSheet({
  state,
  onClose,
  onAgree,
  onRefuse,
}: {
  state: { patient: Patient } | null;
  onClose: () => void;
  onAgree: (by: "個案本人" | "家屬") => void;
  onRefuse: () => void;
}) {
  return (
    <Sheet open={!!state} onClose={onClose} title="錄音前請先告知">
      <blockquote className="mb-5 rounded-[26px] bg-audio-tint p-5 text-[1.3rem] font-bold leading-relaxed">「{CONSENT_SCRIPT}」</blockquote>
      <div className="flex flex-col gap-3 pb-2">
        <Button variant="primary" size="xl" block onClick={() => onAgree("個案本人")}>
          本人同意，開始錄音
        </Button>
        <Button variant="primary" size="xl" block onClick={() => onAgree("家屬")}>
          家屬同意，開始錄音
        </Button>
        <Button variant="secondary" size="lg" block onClick={onRefuse}>
          不同意錄音
        </Button>
      </div>
    </Sheet>
  );
}
