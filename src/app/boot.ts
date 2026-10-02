import { probeEngine } from "../lib/api";
import { applyRetention, db, getSettings } from "../lib/db";
import { startAutoResume } from "../lib/pipeline";
import { recorder, recoverOrphanChunks } from "../lib/recorder";

/** 啟動：套用外觀、救回中斷的錄音、清除逾期資料、接續未完成的處理。 */
export async function boot() {
  const s = await getSettings();
  applyAppearance(s.theme, s.size);
  db.settings.hook("updating", (mods, _key, obj) => {
    const next = { ...obj, ...(mods as object) } as typeof obj;
    applyAppearance(next.theme, next.size);
  });
  db.settings.hook("creating", (_key, obj) => {
    applyAppearance(obj.theme, obj.size);
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

export function applyAppearance(theme: "system" | "light" | "dark", size: "standard" | "large") {
  const root = document.documentElement;
  if (theme === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", theme);
  root.setAttribute("data-size", size);
}
