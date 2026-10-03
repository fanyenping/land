import { probeEngine, setAccessCode } from "../lib/api";
import { applyRetention, db, getSettings } from "../lib/db";
import { startAutoResume } from "../lib/pipeline";
import { TRIAL } from "../lib/env";
import { recorder, recoverOrphanChunks } from "../lib/recorder";

/** 啟動：套用外觀、救回中斷的錄音、清除逾期資料、接續未完成的處理。 */
export async function boot() {
  if (TRIAL) {
    document.documentElement.lang = "zh-Hant-TW";
    document.documentElement.setAttribute("translate", "no");
  }
  const s = await getSettings();
  applyAppearance(s.theme, s.size);
  setAccessCode(s.accessCode ?? "");
  db.settings.hook("updating", (mods, _key, obj) => {
    const next = { ...obj, ...(mods as object) } as typeof obj;
    applyAppearance(next.theme, next.size);
    setAccessCode(next.accessCode ?? "");
  });
  db.settings.hook("creating", (_key, obj) => {
    applyAppearance(obj.theme, obj.size);
    setAccessCode(obj.accessCode ?? "");
  });

  try {
    await navigator.storage?.persist?.();
  } catch {
    // 不支援時略過。
  }

  await recoverOrphanChunks();
  await applyRetention(s.retentionDays);
  void probeEngine();
  startAutoResume();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void recorder.relock();
  });
}

let themeSetByApp = false;

export function applyAppearance(theme: "system" | "light" | "dark", size: "standard" | "large") {
  const root = document.documentElement;
  if (theme === "system") {
    // 試用版放在分享網頁裡：「跟系統」時保留檢視器自己設定的 data-theme，只移除 App 設過的。
    if (!TRIAL || themeSetByApp) root.removeAttribute("data-theme");
    themeSetByApp = false;
  } else {
    root.setAttribute("data-theme", theme);
    themeSetByApp = true;
  }
  root.setAttribute("data-size", size);
}
