import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router";
import { Download, RefreshCw, Trash2 } from "lucide-react";
import { LANG_LABEL, type TranslateLang } from "../../shared/types";
import { Critter } from "../components/Critter";
import { Sheet } from "../components/Sheet";
import { useToast } from "../components/Toast";
import { Button, Segmented, Spinner, cx, inputClass } from "../components/ui";
import { isDemoEngine, probeEngine, setAccessCode, verifyAccessCode } from "../lib/api";
import { applyRetention, exportAll, saveSettings, wipeAll } from "../lib/db";
import { clock, shortDate } from "../lib/format";
import { useEngine, useSettings } from "../lib/hooks";
import { CONSENT_VERSION, type Settings } from "../lib/model";
import { seedDemo } from "../lib/seed";

const STT_LABEL: Record<string, string> = { demo: "示範", none: "尚未設定（只能匯入文件）", azure: "Azure 語音", whisper: "Whisper" };

export function SettingsScreen() {
  const s = useSettings();
  const toast = useToast();
  const navigate = useNavigate();
  const engine = useEngine();
  const [testing, setTesting] = useState(false);
  const [wipe, setWipe] = useState(false);

  const set = (patch: Partial<Settings>) => void saveSettings(patch);

  return (
    <div className="mx-auto w-full max-w-[760px] px-4 pt-[max(env(safe-area-inset-top),16px)] md:px-8 lg:pt-8">
      <header className="mb-5 flex items-center gap-3">
        <h1 className="font-round text-[2.6rem] font-extrabold leading-none">設定</h1>
        <Critter kind="nurse" size={52} className="ml-auto" />
      </header>

      <Group title="我的資料" tone="bg-record">
        <TextSetting label="姓名（確認紀錄時記下）" value={s.nurseName} onSave={(v) => set({ nurseName: v })} placeholder="例如 林護理師" />
        <TextSetting label="機構名稱（衛教署名）" value={s.clinicName} onSave={(v) => set({ clinicName: v })} placeholder="例如 安心居家護理所" />
        <TextSetting label="機構電話（衛教署名）" value={s.clinicPhone} onSave={(v) => set({ clinicPhone: v })} placeholder="例如 03-000-0000" inputMode="tel" />
      </Group>

      <Group title="顯示" tone="bg-edu">
        <Row label="字級">
          <Segmented label="字級" value={s.size} onChange={(v) => set({ size: v })} options={[{ value: "standard", label: "標準" }, { value: "large", label: "大字" }]} />
        </Row>
        <Row label="深淺色">
          <Segmented
            label="深淺色"
            value={s.theme}
            onChange={(v) => set({ theme: v })}
            options={[
              { value: "system", label: "跟系統" },
              { value: "light", label: "淺色" },
              { value: "dark", label: "深色" },
            ]}
          />
        </Row>
      </Group>

      <Group title="輸出格式" tone="bg-plan">
        <Row label="紀錄名稱">
          <Segmented label="紀錄名稱" value={s.recordTitle} onChange={(v) => set({ recordTitle: v })} options={[{ value: "護理紀錄", label: "護理紀錄" }, { value: "訪視紀錄", label: "訪視紀錄" }]} />
        </Row>
        <Row label="紀錄寫法" hint="之後產生的紀錄套用">
          <Segmented label="紀錄寫法" value={s.recordStyle} onChange={(v) => set({ recordStyle: v })} options={[{ value: "four", label: "四段式" }, { value: "narrative", label: "敘事式" }]} />
        </Row>
        <Row label="生命徵象順序" hint={s.vitalsOrder === "standard" ? "體溫、脈搏、呼吸、血壓、血氧、血糖、意識" : "體溫、血壓、脈搏、血氧、呼吸、意識、血糖"}>
          <Segmented label="生命徵象順序" value={s.vitalsOrder} onChange={(v) => set({ vitalsOrder: v })} options={[{ value: "standard", label: "TPR 慣例" }, { value: "line", label: "LINE 表單" }]} />
        </Row>
        <Row label="複製內容">
          <Segmented
            label="複製內容"
            value={s.copyBodyOnly ? "body" : "full"}
            onChange={(v) => set({ copyBodyOnly: v === "body" })}
            options={[
              { value: "full", label: "含標題列" },
              { value: "body", label: "只複製內文" },
            ]}
          />
        </Row>
        <Row label="衛教翻譯預設">
          <Segmented
            label="衛教翻譯預設"
            value={s.translateLang}
            onChange={(v) => set({ translateLang: v })}
            options={(Object.keys(LANG_LABEL) as TranslateLang[]).map((l) => ({ value: l, label: LANG_LABEL[l] }))}
          />
        </Row>
      </Group>

      <Group title="AI 服務" tone="bg-pending">
        <div className="flex items-center gap-3 rounded-2xl bg-card p-3.5 outline-ink">
          <Critter kind={engine ? (isDemoEngine(engine) ? "pending" : "done") : "processing"} size={44} animate={!engine} />
          <div className="min-w-0 flex-1">
            <p className="font-extrabold">
              {!engine ? "檢查中" : engine.kind === "local" ? "連不上 AI 伺服器" : engine.health.llm.mode === "demo" ? "伺服器示範模式" : `Claude 已連線`}
              {s.demoMode && <span className="ml-2 inline-flex rounded-full bg-pending px-2.5 py-0.5 text-[0.85rem] text-[#141414]">示範模式開啟中</span>}
            </p>
            <p className="text-[0.9rem] text-ink-soft">
              {engine?.kind === "server"
                ? `轉文字：${STT_LABEL[engine.health.stt] ?? engine.health.stt}・模型：${engine.health.llm.model ?? "示範"}`
                : engine?.kind === "local"
                  ? `${engine.reason}・紀錄會先存在這台裝置，連上後自動接續`
                  : ""}
            </p>
          </div>
          <Button
            size="sm"
            icon={testing ? <Spinner size={16} /> : <RefreshCw size={16} />}
            onClick={async () => {
              setTesting(true);
              const e = await probeEngine(true);
              setTesting(false);
              toast(e.kind === "server" ? "伺服器連線正常" : "仍連不上伺服器");
            }}
          >
            測試
          </Button>
        </div>
        {(s.accessCode || (engine?.kind === "server" && engine.health.auth)) && (
          <TextSetting
            label="機構通行碼"
            value={s.accessCode}
            placeholder="向機構管理者索取"
            secret
            onSave={async (v) => {
              await saveSettings({ accessCode: v });
              setAccessCode(v);
              if (!v) return "已清除";
              const r = await verifyAccessCode();
              return r === "ok" ? "通行碼正確" : r === "wrong" ? "通行碼不正確，請再確認" : "已儲存，連上網路後生效";
            }}
          />
        )}
        <Row label="示範模式" hint="開啟後新紀錄一律用內建示範內容，不呼叫 AI，輸出會標示「示範資料」。給教學或試用。">
          <Segmented
            label="示範模式"
            value={s.demoMode ? "on" : "off"}
            onChange={(v) => {
              set({ demoMode: v === "on" });
              toast(v === "on" ? "示範模式已開啟" : "示範模式已關閉");
            }}
            options={[
              { value: "off", label: "關閉" },
              { value: "on", label: "開啟" },
            ]}
          />
        </Row>
      </Group>

      <Group title="資料與隱私" tone="bg-pdf">
        <Row label="錄音與文件保存" hint="已完成的訪視超過天數後，刪除這台裝置上的錄音與文件（紀錄文字保留）">
          <Segmented
            label="保存天數"
            value={String(s.retentionDays)}
            onChange={async (v) => {
              await saveSettings({ retentionDays: Number(v) });
              const n = await applyRetention(Number(v));
              toast(n ? `已清除 ${n} 筆逾期錄音` : `保存 ${v} 天`);
            }}
            options={["7", "14", "30", "90"].map((d) => ({ value: d, label: `${d} 天` }))}
          />
        </Row>
        <Row label="AI 資料處理同意">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-bold">{s.consentAt ? `第 ${s.consentVersion} 版・${shortDate(s.consentAt.slice(0, 10))} ${clock(s.consentAt)} 同意` : "尚未同意"}</span>
            <Button
              size="sm"
              onClick={async () => {
                await saveSettings({ onboarded: false, consentAt: null, consentVersion: null });
                navigate("/welcome");
              }}
            >
              撤回同意
            </Button>
          </div>
        </Row>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Button
            size="lg"
            icon={<Download size={19} />}
            onClick={async () => {
              const data = await exportAll();
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `taione-care-${new Date().toISOString().slice(0, 10)}.json`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 2000);
              toast("已匯出（不含錄音檔）");
            }}
          >
            匯出紀錄
          </Button>
          <Button
            size="lg"
            onClick={async () => {
              await seedDemo();
              toast("已載入示範個案");
              navigate("/");
            }}
          >
            載入示範個案
          </Button>
          <Button size="lg" className="text-danger sm:col-span-2" icon={<Trash2 size={19} />} onClick={() => setWipe(true)}>
            清除這台裝置的所有資料
          </Button>
        </div>
      </Group>

      <p className="mb-6 mt-2 text-center text-[0.85rem] font-bold text-ink-faint">
        TaiOne care · We care　App 1.0.0　同意書 {CONSENT_VERSION}
      </p>

      <Sheet
        open={wipe}
        onClose={() => setWipe(false)}
        title="清除所有資料？"
        footer={
          <div className="flex gap-2">
            <Button size="lg" className="flex-1" onClick={() => setWipe(false)}>
              取消
            </Button>
            <Button
              variant="danger"
              size="lg"
              className="flex-1"
              onClick={async () => {
                await wipeAll();
                window.location.assign("/welcome");
              }}
            >
              清除
            </Button>
          </div>
        }
      >
        <p className="text-[1.05rem] font-bold">個案、錄音、文件與所有紀錄都會從這台裝置刪除，無法復原。</p>
      </Sheet>
    </div>
  );
}

function Group({ title, tone, children }: { title: string; tone: string; children: ReactNode }) {
  return (
    <section className="mb-5 overflow-hidden rounded-[28px] bg-card outline-ink">
      <h2 className={cx("contours px-5 py-3 font-round text-[1.2rem] font-extrabold text-[#141414]", tone)}>{title}</h2>
      <div className="flex flex-col gap-4 p-4 md:p-5">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 font-bold">{label}</p>
      {children}
      {hint && <p className="mt-1.5 text-[0.86rem] text-ink-soft">{hint}</p>}
    </div>
  );
}

function TextSetting({
  label,
  value,
  onSave,
  placeholder,
  inputMode,
  secret,
}: {
  label: string;
  value: string;
  onSave: (v: string) => void | Promise<string | void>;
  placeholder?: string;
  inputMode?: "tel" | "text";
  secret?: boolean;
}) {
  const [v, setV] = useState(value);
  const toast = useToast();
  useEffect(() => setV(value), [value]);
  return (
    <label className="block">
      <span className="mb-1.5 block font-bold">{label}</span>
      <input
        value={v}
        inputMode={inputMode}
        type={secret ? "password" : "text"}
        autoComplete={secret ? "off" : undefined}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={async () => {
          if (v.trim() !== value) {
            const msg = await onSave(v.trim());
            toast(msg || "已儲存");
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={inputClass}
      />
    </label>
  );
}
