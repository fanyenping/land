const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function todayStr(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return todayStr(d);
}

/** 10月2日（四） */
export function longDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${d.getMonth() + 1}月${d.getDate()}日（${WEEK[d.getDay()]}）`;
}

/** 10/02 */
export function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${m}/${d}`;
}

/** 2026/10/02（四） */
export function fullDate(date: string): string {
  const d = new Date(`${date}T00:00:00`);
  return `${date.replaceAll("-", "/")}（${WEEK[d.getDay()]}）`;
}

export function clock(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function greeting(d = new Date()): string {
  const h = d.getHours();
  if (h < 5) return "夜深了";
  if (h < 11) return "早安";
  if (h < 14) return "午安";
  if (h < 18) return "下午好";
  return "晚安";
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function minutes(ms: number): string {
  return `${Math.max(1, Math.round(ms / 60000))} 分`;
}

/** 姓名遮罩：陳○蘭、王○、歐○○明（研究 Q20）。 */
export function maskName(name: string): string {
  const chars = Array.from(name.trim());
  if (chars.length <= 1) return name;
  if (chars.length === 2) return `${chars[0]}○`;
  return chars[0] + "○".repeat(chars.length - 2) + chars[chars.length - 1];
}

export function ageOf(birthYear: number | null, now = new Date()): number | null {
  return birthYear ? now.getFullYear() - birthYear : null;
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function daysUntil(date: string, from = todayStr()): number {
  return Math.round((Date.parse(`${date}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000);
}
