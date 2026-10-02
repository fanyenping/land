import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

interface ToastItem {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  big?: boolean;
}

const Ctx = createContext<(text: string, opts?: { action?: ToastItem["action"]; big?: boolean; ms?: number }) => void>(() => undefined);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const show = useCallback((text: string, opts?: { action?: ToastItem["action"]; big?: boolean; ms?: number }) => {
    const id = ++seq.current;
    setItems((list) => [...list.slice(-2), { id, text, action: opts?.action, big: opts?.big }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), opts?.ms ?? (opts?.action ? 5000 : 2600));
  }, []);

  return (
    <Ctx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+104px)] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-8">
        {items.map((t) => (
          <div
            key={t.id}
            className={
              "pointer-events-auto flex max-w-[min(92vw,560px)] animate-pop items-center gap-3 rounded-full bg-ink py-2.5 pl-4 pr-2.5 text-paper shadow-soft " +
              (t.big ? "text-[1.15rem]" : "text-[1rem]")
            }
          >
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-plan text-[#141414]">
              <Check size={17} strokeWidth={3} />
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
