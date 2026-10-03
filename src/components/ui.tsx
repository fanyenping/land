import type { ButtonHTMLAttributes, ReactNode } from "react";

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

type Variant = "primary" | "secondary" | "ghost" | "soft" | "danger";
type Size = "xl" | "lg" | "md" | "sm";

const SIZE: Record<Size, string> = {
  xl: "min-h-[68px] px-7 text-[1.2rem] gap-3",
  lg: "min-h-[60px] px-6 text-[1.08rem] gap-2.5",
  md: "min-h-[50px] px-5 text-[1rem] gap-2",
  sm: "min-h-[42px] px-4 text-[0.92rem] gap-1.5",
};

const VARIANT: Record<Variant, string> = {
  primary: "bg-ink text-paper sticker",
  secondary: "bg-card text-ink sticker",
  ghost: "bg-transparent text-ink hover:bg-ink/5",
  soft: "bg-ink/[0.06] text-ink hover:bg-ink/10",
  danger: "bg-danger text-[#141414] sticker",
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: ReactNode;
}

export function Button({ variant = "secondary", size = "md", block, icon, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        "inline-flex select-none items-center justify-center rounded-full font-bold leading-tight transition-[transform,background-color,opacity] disabled:cursor-not-allowed disabled:opacity-45",
        SIZE[size],
        VARIANT[variant],
        block && "w-full",
        className,
      )}
      {...rest}
    >
      {icon}
      {children && <span className="min-w-0 truncate">{children}</span>}
    </button>
  );
}

interface RoundProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: number;
  tone?: "card" | "ink" | "clear";
}

/** 圓形 icon 按鈕（參考圖的細墨線圓鈕）。 */
export function RoundButton({ label, size = 48, tone = "card", className, children, type = "button", ...rest }: RoundProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        "inline-grid shrink-0 place-items-center rounded-full transition-transform active:scale-95 disabled:opacity-40",
        tone === "card" && "bg-card text-ink outline-ink",
        tone === "ink" && "bg-ink text-paper",
        tone === "clear" && "text-ink hover:bg-ink/5",
        className,
      )}
      style={{ width: size, height: size }}
      {...rest}
    >
      {children}
    </button>
  );
}

export type Tone = "pending" | "ok" | "danger" | "muted" | "audio" | "record" | "plan" | "edu" | "pdf" | "ink";

const TONE: Record<Tone, string> = {
  pending: "bg-pending text-[#141414]",
  ok: "bg-ok-tint text-ok",
  danger: "bg-danger-tint text-danger",
  muted: "bg-ink/[0.07] text-ink-soft",
  audio: "bg-audio-tint text-ink",
  record: "bg-record-tint text-ink",
  plan: "bg-plan-tint text-ink",
  edu: "bg-edu-tint text-ink",
  pdf: "bg-pdf-tint text-ink",
  ink: "bg-ink text-paper",
};

export function Pill({ tone = "muted", icon, children, className }: { tone?: Tone; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[0.86rem] font-bold leading-none", TONE[tone], className)}>
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}

export function Chip({ active, onClick, children, className }: { active?: boolean; onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cx(
        "inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-4 text-[0.95rem] font-bold transition-colors",
        active ? "bg-ink text-paper" : "bg-card text-ink outline-ink",
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex w-full rounded-full bg-ink/[0.07] p-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            "min-h-[44px] flex-1 rounded-full px-3 text-[0.95rem] font-bold transition-colors",
            value === o.value ? "bg-ink text-paper" : "text-ink-soft hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[0.95rem] font-bold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[0.85rem] text-ink-soft">{hint}</span>}
    </label>
  );
}

// 聚焦時改成 3px 粗墨框：.outline-ink 是未分層的 CSS，要用 ! 才蓋得過。
export const inputClass =
  "w-full min-h-[52px] rounded-2xl bg-card px-4 text-[1.05rem] text-ink outline-ink placeholder:text-ink-faint focus:outline-none focus:shadow-[inset_0_0_0_3px_var(--ink)]!";

export function Spinner({ size = 20 }: { size?: number }) {
  return (
    <span
      aria-hidden
      className="inline-block animate-spin rounded-full border-[3px] border-current border-t-transparent"
      style={{ width: size, height: size }}
    />
  );
}
