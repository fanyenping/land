import { useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { Critter } from "../components/Critter";
import { Button, Field, inputClass } from "../components/ui";
import { db, saveSettings } from "../lib/db";
import { TRIAL } from "../lib/env";
import { CONSENT_VERSION } from "../lib/model";
import { seedDemo } from "../lib/seed";

/** 首次啟用：姓名＋AI 資料處理同意，一個畫面完成。 */
export function Welcome() {
  const navigate = useNavigate();
  const settings = useLiveQuery(() => db.settings.get("me"), [], "loading" as const);
  const [name, setName] = useState("");
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);

  if (settings === "loading") return null;
  if (settings?.onboarded) return <Navigate to="/" replace />;

  const start = async (demo: boolean) => {
    setBusy(true);
    try {
      await saveSettings({
        onboarded: true,
        nurseName: name.trim() || settings?.nurseName || "",
        consentVersion: CONSENT_VERSION,
        consentAt: new Date().toISOString(),
      });
      if (demo) await seedDemo();
      navigate("/", { replace: true });
    } catch {
      setBusy(false);
    }
  };

  const demoButton = (
    <Button variant={TRIAL ? "primary" : "secondary"} size={TRIAL ? "xl" : "lg"} block disabled={!agree || busy} onClick={() => start(true)}>
      用示範個案開始
    </Button>
  );
  const blankButton = (
    <Button variant={TRIAL ? "secondary" : "primary"} size={TRIAL ? "lg" : "xl"} block disabled={!agree || busy} onClick={() => start(false)}>
      {TRIAL ? "從空白開始" : "同意並開始使用"}
    </Button>
  );

  return (
    <div className="grid min-h-[100dvh] place-items-center px-4 py-8">
      <div className="w-full max-w-[480px] animate-rise">
        <div className="relative mb-5 overflow-hidden rounded-[34px] bg-night p-7 text-night-ink">
          <div className="flex items-center gap-3">
            <Critter kind="brand" size={64} />
            <div>
              <p className="font-round text-[2rem] font-extrabold leading-none">
                TaiOne <span className="text-coral">care</span>
              </p>
              <p className="mt-1 text-[1.1rem] font-bold opacity-80">We care you</p>
            </div>
          </div>
          <div className="mt-6 flex gap-2">
            <Critter kind="record" size={40} />
            <Critter kind="plan" size={40} />
            <Critter kind="edu" size={40} />
            <Critter kind="audio" size={40} />
            <Critter kind="pdf" size={40} />
          </div>
          <p className="mt-4 text-[0.95rem] font-bold tracking-wide opacity-70">本一科技TaiOne Care Q</p>
        </div>

        <div className="flex flex-col gap-4 rounded-[30px] bg-card p-5 outline-ink">
          <Field label="你的姓名">
            <input data-autofocus value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 林護理師" className={inputClass} autoComplete="name" />
          </Field>
          <label className="flex cursor-pointer items-start gap-3 rounded-2xl bg-pending-tint p-4">
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 h-6 w-6 shrink-0 accent-[#141414]" />
            <span className="text-[0.98rem] leading-relaxed">
              {TRIAL ? (
                <>
                  <strong className="block text-[1.05rem]">這是試用版</strong>
                  不會上傳，也不會送給 AI：三份內容由內建示範產生，標示「示範資料」。資料只存在這台裝置。正式版的 AI 產出同樣是草稿，須經護理師審閱確認。
                </>
              ) : (
                <>
                  <strong className="block text-[1.05rem]">AI 資料處理同意</strong>
                  錄音與文件會送到轉文字服務與 Claude（Anthropic）整理成草稿，不用於訓練、伺服器不保存；資料留在這台裝置。草稿須經你確認。
                  <span className="text-ink-soft">（第 {CONSENT_VERSION} 版）</span>
                </>
              )}
            </span>
          </label>
          {TRIAL ? (
            <>
              {demoButton}
              {blankButton}
            </>
          ) : (
            <>
              {blankButton}
              {demoButton}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
