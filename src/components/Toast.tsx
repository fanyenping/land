import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router";
import { AlertTriangle, Check } from "lucide-react";

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  big?: boolean;
  /** 失敗提示：不用綠色勾勾，改用警示圖示。 */
  error?: boolean;
}

type ToastOptions = { action?: ToastItem["action"]; big?: boolean; ms?: number; error?: boolean };

const Ctx = createContext<(text: string, opts?: ToastOptions) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const path = useLocation().pathname;
  // 錄音畫面的主要按鈕在底部：提示改到上方，不要蓋住「完成訪視」。工作台與評估表在導覽上方還有固定按鈕列：提示再往上一列。
  const top = /^\/v\/[^/]+\/rec$/.test(path);
  const aboveBar = /^\/v\/[^/]+$/.test(path) || /^\/patients\/[^/]+\/assessment\/[^/]+$/.test(path);
  const seq = useRef(0);

  const show = useCallback((text: string, opts?: ToastOptions) => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-2), { id, text, action: opts?.action, big: opts?.big, error: opts?.error }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), opts?.ms ?? (opts?.action || opts?.error ? 5000 : 2600));
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div
        aria-live="polite"
        className={
          "pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4 " +
          (top
            ? "top-[calc(env(safe-area-inset-top)+76px)]"
            : aboveBar
              ? "bottom-[calc(var(--nav-h)+5.75rem)] lg:bottom-8"
              : "bottom-[calc(var(--nav-h)+0.75rem)] lg:bottom-8")
        }
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={
              // 沒有「復原」等按鈕的提示不攔截點擊，底下的按鈕照樣按得到。
              (t.action ? "pointer-events-auto " : "pointer-events-none ") +
              "flex max-w-[min(92vw,560px)] animate-pop items-center gap-3 rounded-full bg-ink py-2.5 pl-4 pr-2.5 text-paper shadow-soft " +
              (t.big ? "text-[1.15rem]" : "text-[1rem]")
            }
          >
            <span className={"grid h-7 w-7 shrink-0 place-items-center rounded-full text-[#141414] " + (t.error ? "bg-pending" : "bg-plan")}>
              {t.error ? <AlertTriangle size={16} strokeWidth={2.8} /> : <Check size={17} strokeWidth={3} />}
            </span>
            <span className="min-w-0 py-0.5 font-bold leading-snug">{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="min-h-[40px] shrink-0 rounded-full bg-paper px-4 font-bold text-ink"
                onClick={() => {
                  t.action!.run();
                  setItems((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}
