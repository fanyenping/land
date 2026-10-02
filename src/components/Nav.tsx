import { NavLink } from "react-router";
import { Plus } from "lucide-react";
import { useAllVisits, useEngine } from "../lib/hooks";
import { isDemoEngine } from "../lib/api";
import { Critter, type Face, type Shape } from "./Critter";
import { cx } from "./ui";

type Item = { to: string; label: string; spec: { shape: Shape; face: Face; color: string }; end?: boolean };

const ITEMS: Item[] = [
  { to: "/", label: "今天", end: true, spec: { shape: "heart", face: "calm", color: "var(--coral)" } },
  { to: "/patients", label: "個案", spec: { shape: "crown", face: "content", color: "var(--grape)" } },
  { to: "/queue", label: "收尾", spec: { shape: "quarter", face: "side", color: "var(--pending)" } },
  { to: "/settings", label: "設定", spec: { shape: "hexagon", face: "lookUp", color: "var(--edu)" } },
];

function useQueueCount() {
  const visits = useAllVisits();
  return visits?.filter((v) => v.status === "review" || v.status === "failed" || v.status === "interrupted").length ?? 0;
}

function NavItem({ item, badge, vertical }: { item: Item; badge?: number; vertical?: boolean }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) =>
        cx(
          "group relative flex items-center rounded-full font-bold transition-colors",
          vertical ? "min-h-[56px] gap-3 px-3 text-[1.02rem]" : "min-w-[60px] flex-col justify-center gap-0.5 py-1.5 text-[0.78rem]",
          isActive ? "text-ink" : "text-ink-soft hover:text-ink",
          vertical && isActive && "bg-ink/[0.07]",
        )
      }
    >
      {({ isActive }) => (
        <>
          <span
            className={cx(
              "relative grid place-items-center rounded-full transition-all",
              vertical ? "h-11 w-11" : "h-10 w-10",
              isActive ? "bg-ink" : "bg-transparent",
            )}
          >
            <Critter spec={item.spec} size={isActive ? 26 : 28} style={isActive ? undefined : { filter: "saturate(.55)", opacity: 0.85 }} />
            {!!badge && (
              <span className="num absolute -right-1 -top-1 grid h-[22px] min-w-[22px] place-items-center rounded-full bg-danger px-1 text-[0.75rem] font-extrabold text-[#141414] outline-ink">
                {badge}
              </span>
            )}
          </span>
          <span>{item.label}</span>
        </>
      )}
    </NavLink>
  );
}

/** 手機：懸浮白色膠囊導覽＋中央墨黑「＋」。 */
export function BottomNav({ onPlus }: { onPlus: () => void }) {
  const count = useQueueCount();
  return (
    <nav aria-label="主要導覽" className="safe-bottom pointer-events-none fixed inset-x-0 bottom-0 z-40 px-3 pb-3 lg:hidden">
      <div className="pointer-events-auto mx-auto flex max-w-[520px] items-center justify-between rounded-full bg-card px-2 py-1.5 shadow-soft outline-ink">
        <NavItem item={ITEMS[0]} />
        <NavItem item={ITEMS[1]} />
        <button
          type="button"
          onClick={onPlus}
          aria-label="新紀錄：錄音或匯入"
          className="sticker -my-5 grid h-[66px] w-[66px] shrink-0 place-items-center rounded-full bg-ink text-paper"
        >
          <Plus size={32} strokeWidth={3} />
        </button>
        <NavItem item={ITEMS[2]} badge={count} />
        <NavItem item={ITEMS[3]} />
      </div>
    </nav>
  );
}

/** 電腦與平板：左側欄。 */
export function SideNav({ onPlus }: { onPlus: () => void }) {
  const count = useQueueCount();
  const engine = useEngine();
  const demo = isDemoEngine(engine);
  return (
    <aside className="sticky top-0 hidden h-[100dvh] w-[244px] shrink-0 flex-col gap-2 p-4 lg:flex">
      <div className="flex h-full flex-col rounded-[30px] bg-card p-4 outline-ink">
        <div className="flex items-center gap-2.5 px-1 pb-5 pt-1">
          <Critter kind="brand" size={40} />
          <div className="leading-tight">
            <div className="font-round text-[1.2rem] font-extrabold">
              TaiOne <span className="text-coral">care</span>
            </div>
            <div className="text-[0.8rem] font-bold text-ink-soft">We care</div>
          </div>
        </div>
        <button
          type="button"
          onClick={onPlus}
          className="sticker mb-4 inline-flex min-h-[54px] items-center justify-center gap-2 rounded-full bg-ink px-4 font-bold text-paper"
        >
          <Plus size={22} strokeWidth={3} />
          新紀錄
        </button>
        <nav aria-label="主要導覽" className="flex flex-col gap-1">
          {ITEMS.map((it) => (
            <NavItem key={it.to} item={it} vertical badge={it.to === "/queue" ? count : undefined} />
          ))}
        </nav>
        <div className="mt-auto rounded-2xl bg-ink/[0.05] px-3 py-2.5 text-[0.82rem] font-bold text-ink-soft">
          <span className={cx("mr-1.5 inline-block h-2.5 w-2.5 rounded-full", demo ? "bg-pending" : "bg-ok")} />
          {engine == null ? "連線檢查中" : demo ? "示範模式" : "AI 已連線"}
        </div>
      </div>
    </aside>
  );
}
