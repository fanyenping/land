/**
 * 錄音檔的辨識（含 iPhone 語音備忘錄）：iOS 的檔案選擇器有時給空白、octet-stream 或 video/mp4 的類型，
 * 所以除了 audio/* 之外也看副檔名。選檔欄位一律用 AUDIO_ACCEPT，且不要加 capture。
 */

/** 明列 .m4a 與 m4a 的各種 MIME，iPhone「檔案」裡的語音備忘錄才不會是灰色不能選。不含 .mp4 與 video/*。 */
export const AUDIO_ACCEPT = "audio/*,.m4a,audio/mp4,audio/x-m4a,audio/m4a,.mp3,audio/mpeg,.wav,audio/wav,audio/x-wav,.aac,audio/aac,.webm,.ogg,.opus,.amr,.3gp";

export const AUDIO_EXT = /\.(m4a|mp3|wav|aac|webm|ogg|opus|amr|3gp)$/i;

/** 這些類型不可靠：要靠副檔名判斷是不是錄音。 */
const LOOSE_TYPES = new Set(["", "application/octet-stream", "video/mp4", "video/quicktime"]);

/** 口述護理計畫的錄音檔上限（整段訪視錄音請加進護理紀錄）。 */
export const PLAN_AUDIO_MAX_BYTES = 50 * 1024 * 1024;

type FileLike = { name: string; type: string };

export function isAudioFile(f: FileLike): boolean {
  const type = (f.type || "").toLowerCase();
  return type.startsWith("audio/") || (LOOSE_TYPES.has(type) && AUDIO_EXT.test(f.name));
}

/** 選到的檔案有語音備忘錄常見的問題時，回傳給護理師看的說明。 */
export function voiceMemoProblem(f: FileLike & { size: number }): string | null {
  if (f.size === 0) return "檔案是空的，請改存到「我的 iPhone」再選";
  const type = (f.type || "").toLowerCase();
  if (/\.(qta|mov)$/i.test(f.name) || (type === "video/quicktime" && !AUDIO_EXT.test(f.name))) return "語音備忘錄請用預設 m4a 分享（不要選「可編輯」）";
  return null;
}

const EXT_MIME: Record<string, string> = {
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  wav: "audio/wav",
  aac: "audio/aac",
  webm: "audio/webm",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  amr: "audio/amr",
  "3gp": "audio/3gpp",
};

/** 存檔與上傳用的 MIME：audio/* 照用；類型怪的（空白、video/mp4…）依副檔名，m4a 一律 audio/mp4。 */
export function audioMimeOf(f: FileLike): string {
  const type = (f.type || "").toLowerCase();
  if (type.startsWith("audio/")) return f.type;
  const ext = f.name.match(AUDIO_EXT)?.[1]?.toLowerCase();
  return (ext && EXT_MIME[ext]) || "audio/mp4";
}

/** 類型不對時換成正確的 MIME（同一份內容，不複製資料），伺服器才收得下。 */
export function withAudioMime<T extends Blob>(blob: T, name: string): T | File {
  const mime = audioMimeOf({ name, type: blob.type });
  if (blob.type === mime) return blob;
  return new File([blob], name, { type: mime, lastModified: (blob as Partial<File>).lastModified ?? Date.now() });
}
