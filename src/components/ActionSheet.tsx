import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { Sheet } from "./Sheet";
import { cx } from "./ui";

export interface ActionItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  hint?: string;
}

/** 「⋯」選單：每一項都是真的動作。 */
export function ActionSheet({ open, onClose, title, items }: { open: boolean; onClose: () => void; title: ReactNode; items: ActionItem[] }) {
  return (
    <Sheet open={open} onClose={onClose} title={title}>
      <div className="flex flex-col gap-2 pb-2">
        {items.map((it) => (
          <button
            key={it.label}
            type="button"
            onClick={() => {
              onClose();
              it.onSelect();
            }}
            className={cx(
              "flex min-h-[60px] items-center gap-3 rounded-[20px] bg-card px-4 text-left font-bold outline-ink active:scale-[0.99]",
              it.danger && "text-danger",
            )}
          >
            {it.icon && <span className="grid h-9 w-9 shrink-0 place-items-center">{it.icon}</span>}
            <span className="min-w-0 flex-1">
              <span className="block text-[1.05rem]">{it.label}</span>
              {it.hint && <span className="block text-[0.86rem] font-medium text-ink-soft">{it.hint}</span>}
            </span>
            <ChevronRight size={20} className="shrink-0 text-ink-faint" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}
