import { DOC_LABEL, type DocKind, type DocSection, type TranslateLang } from "../../shared/types";
import { TRIAL } from "./env";
import { fullDate } from "./format";
import type { OutputState, Patient, Settings, Visit } from "./model";
import { VITAL_ORDER, vitalsLine } from "./vitals";

export function docTitle(kind: DocKind, settings: Settings): string {
  return kind === "record" ? settings.recordTitle : DOC_LABEL[kind];
}

export function currentSections(out: OutputState): DocSection[] {
  return out.versions[out.current]?.sections ?? [];
}

/** 文件內文（不含【標題】列）：護理紀錄最前面放由確認值組成的生命徵象行；段落之間空一行。 */
export function docBody(kind: DocKind, visit: Visit, settings: Settings, sections = currentSections(visit.outputs[kind])): string {
  const blocks: string[] = [];
  if (kind === "record" && !visit.intakeOnly) {
    const vl = vitalsLine(visit, VITAL_ORDER[settings.vitalsOrder]);
    if (vl) blocks.push(vl);
  }
  for (const s of sections) {
    const body = s.body.trim();
    if (s.heading && body) blocks.push(`${s.heading}\n${body}`);
    else if (s.heading) blocks.push(s.heading);
    else if (body) blocks.push(body);
  }
  if (kind === "edu") {
    const sign = [settings.clinicName, settings.nurseName, settings.clinicPhone ? `電話：${settings.clinicPhone}` : ""].filter(Boolean).join("　");
    if (sign && !blocks.at(-1)?.includes(sign)) blocks.push(sign);
  }
  return blocks.join("\n\n");
}

export function docHeader(kind: DocKind, visit: Visit, patient: Patient | undefined, settings: Settings): string {
  const date = fullDate(visit.date);
  if (kind === "plan") {
    const n = planVersionFor(visit, patient);
    return n > 1 ? `【護理計畫】第 ${n} 版　${visit.date.replaceAll("-", "/")} 更新（沿用第 ${n - 1} 版）` : `【護理計畫】第 1 版　${visit.date.replaceAll("-", "/")} 擬定`;
  }
  if (kind === "edu") return `【給家屬的照顧小叮嚀】${visit.date.replaceAll("-", "/")}`;
  if (visit.intakeOnly) return `【收案紀錄（依文件整理）】${visit.date.replaceAll("-", "/")}`;
  const span = visit.recordingStartedAt && visit.recordingEndedAt ? ` ${timeOf(visit.recordingStartedAt)}-${timeOf(visit.recordingEndedAt)}` : "";
  return `【${docTitle(kind, settings)}】${date}${span} 居家護理訪視`;
}

/** 單份複製的完整文字：預設含【標題】列；設定「只複製內文」時不含。 */
export function docCopyText(kind: DocKind, visit: Visit, patient: Patient | undefined, settings: Settings): string {
  const body = docBody(kind, visit, settings);
  return settings.copyBodyOnly ? body : `${docHeader(kind, visit, patient, settings)}\n${body}`;
}

/** 這次訪視的計畫版號：已確認者為當時設定的版號，否則為「確認後的下一版」。 */
export function planVersionFor(visit: Visit, patient: Patient | undefined): number {
  if (visit.outputs.plan.planVersion) return visit.outputs.plan.planVersion;
  return (patient?.plan?.version ?? 0) + 1;
}

function timeOf(iso: string) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function charCount(text: string): number {
  return Array.from(text.replace(/\s/g, "")).length;
}

const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);

/** 貼到中衛或院方系統（多為 Windows）時使用 CRLF 換行。 */
export function forClipboard(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  return isWindows ? normalized.replace(/\n/g, "\r\n") : normalized;
}

export async function writeClipboard(text: string): Promise<boolean> {
  const value = forClipboard(text);
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    // 備援：選取隱藏文字框再複製。iPhone 需要 setSelectionRange，字級 16px 以上才不會放大畫面。
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    Object.assign(ta.style, { position: "fixed", top: "0", left: "0", opacity: "0", fontSize: "16px", pointerEvents: "none" });
    document.body.appendChild(ta);
    ta.focus({ preventScroll: true });
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.blur();
    ta.remove();
    return ok;
  }
}

/** 全部複製：三份之間以分隔線與標題分開。 */
export function allDocsText(visit: Visit, patient: Patient | undefined, settings: Settings, kinds: DocKind[]): string {
  return kinds
    .map((k) => `${docHeader(k, visit, patient, settings)}\n${docBody(k, visit, settings)}`)
    .join("\n\n＝＝＝＝＝＝＝＝＝＝\n\n");
}

export function eduShareText(visit: Visit, patient: Patient | undefined, settings: Settings, lang?: TranslateLang): string {
  if (lang) {
    const t = visit.translations[lang];
    if (t?.text) return t.text;
  }
  return `${docHeader("edu", visit, patient, settings)}\n${docBody("edu", visit, settings)}`;
}

/** 開啟 LINE 分享；支援系統分享面板時優先使用。試用版的框架不允許分享與開新視窗：只複製。 */
export async function shareToLine(text: string): Promise<"shared" | "line" | "cancelled" | "copied"> {
  if (TRIAL) return "copied";
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return "shared";
    } catch (err) {
      if ((err as DOMException).name === "AbortError") return "cancelled";
    }
  }
  window.open(`https://line.me/R/share?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  return "line";
}
