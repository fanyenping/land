import { getBlob } from "./db";
import type { Visit } from "./model";

let current: HTMLAudioElement | null = null;
let currentUrl: string | null = null;
let stopTimer: ReturnType<typeof setTimeout> | undefined;

export function stopPlayback() {
  clearTimeout(stopTimer);
  current?.pause();
  if (currentUrl) URL.revokeObjectURL(currentUrl);
  current = null;
  currentUrl = null;
}

/** 原音可對照：逐字稿來自這次的真實錄音（非示範稿）且錄音還在。 */
export function canPlaySource(visit: Visit) {
  return visit.parts.length > 0 && !!visit.transcript && visit.transcript.provider !== "demo";
}

/** 播放原句前後各 2.5 秒（依多段錄音的接續時間軸定位到對應的段落）。 */
export async function playAt(visit: Visit, ms: number, spanMs = 6000) {
  stopPlayback();
  let offset = Math.max(0, ms - 2500);
  for (const part of visit.parts) {
    if (offset < part.durationMs || part === visit.parts.at(-1)) {
      const blob = await getBlob(part.blobKey);
      if (!blob) return false;
      currentUrl = URL.createObjectURL(blob);
      current = new Audio(currentUrl);
      await new Promise<void>((resolve) => {
        current!.addEventListener("loadedmetadata", () => resolve(), { once: true });
        current!.addEventListener("error", () => resolve(), { once: true });
      });
      current.currentTime = offset / 1000;
      await current.play().catch(() => undefined);
      stopTimer = setTimeout(stopPlayback, spanMs);
      return true;
    }
    offset -= part.durationMs;
  }
  return false;
}
