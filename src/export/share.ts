import { TRIAL } from "../lib/env";

/** 分享網頁（試用版）提供的下載能力；正式版沒有 window.claude。 */
interface ClaudeDownloads {
  save(request: { filename: string; data: Blob | ArrayBuffer | string }): Promise<{ status: "saved" | "delivered" }>;
}
declare global {
  interface Window {
    claude?: { use(name: "downloads"): Promise<ClaudeDownloads | null> };
  }
}

export type ShareOutcome = "shared" | "cancelled" | "failed";
export type SaveOutcome = "saved" | "declined" | "failed";

/**
 * 能不能把 PDF 檔交給系統分享面板（手機上可選 LINE、郵件、訊息、雲端硬碟…）。
 * iPhone Safari、Android Chrome、Windows／macOS 的 Chrome 與 Safari 支援；試用版的分享網頁不允許。
 */
export function canShareFile(file: File): boolean {
  if (TRIAL || typeof navigator === "undefined" || !navigator.share || !navigator.canShare) return false;
  try {
    return navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** 開系統分享面板。必須在點擊當下呼叫（PDF 要先產生好），否則瀏覽器會拒絕。 */
export async function shareFile(file: File, title: string): Promise<ShareOutcome> {
  try {
    await navigator.share({ files: [file], title });
    return "shared";
  } catch (err) {
    return (err as DOMException).name === "AbortError" ? "cancelled" : "failed";
  }
}

/** 存成檔案：正式版用瀏覽器下載；試用版交給分享網頁的下載（Claude App 會開系統分享面板）。 */
export async function saveFile(blob: Blob, filename: string): Promise<SaveOutcome> {
  if (TRIAL) {
    const downloads = await window.claude?.use("downloads").catch(() => null);
    if (!downloads) return "failed";
    try {
      await downloads.save({ filename, data: blob });
      return "saved";
    } catch (err) {
      return (err as { code?: string }).code === "declined" ? "declined" : "failed";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return "saved";
}

/** LINE 的文字分享網址（手機會開 LINE 選聊天室）。只能帶文字，不能帶檔案。 */
export function lineShareUrl(text: string): string {
  return `https://line.me/R/share?text=${encodeURIComponent(text)}`;
}
