import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { RoundButton, cx } from "./ui";

interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** 全螢幕（手機修改器等）。 */
  full?: boolean;
  wide?: boolean;
  tone?: string;
}

/** 手機為底部面板、電腦為置中對話框。Esc 或點背景關閉。 */
export function Sheet({ open, onClose, title, children, footer, full, wide, tone }: SheetProps) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  // onClose 每次 render 都可能是新函式；用 ref 讓開關時的聚焦邏輯只在 open 改變時執行一次。
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      const root = panel.current;
      if (!root || root.contains(document.activeElement)) return;
      const target =
        root.querySelector<HTMLElement>("[data-autofocus]") ??
        root.querySelector<HTMLElement>("input, textarea, select, button:not([aria-label='關閉'])");
      target?.focus({ preventScroll: true });
    }, 60);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      document.body.style.overflow = "";
      prev?.focus?.({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center" role="presentation">
      <div className="absolute inset-0 animate-fade bg-[#141414]/45 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={id}
        className={cx(
          "relative flex w-full animate-sheet flex-col bg-paper shadow-soft md:animate-rise",
          full ? "h-[100dvh] md:h-[90dvh] md:max-w-3xl md:rounded-[30px]" : "max-h-[92dvh] rounded-t-[30px] md:rounded-[30px]",
          wide ? "md:max-w-2xl" : "md:max-w-lg",
        )}
        style={tone ? { background: tone } : undefined}
      >
        <div className="flex items-center gap-3 px-5 pb-2 pt-4 md:px-7 md:pt-6">
          <div className="mx-auto mb-1 h-1.5 w-12 rounded-full bg-ink/20 md:hidden" style={{ position: "absolute", left: 0, right: 0, top: 8 }} />
          <h2 id={id} className="min-w-0 flex-1 pt-2 text-[1.35rem] font-extrabold leading-snug">
            {title}
          </h2>
          <RoundButton label="關閉" size={44} onClick={onClose}>
            <X size={22} strokeWidth={2.6} />
          </RoundButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-5 md:px-7">{children}</div>
        {footer && <div className="border-t border-hairline px-5 pb-[max(env(safe-area-inset-bottom),16px)] pt-3 md:px-7 md:pb-6">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
