import { Link } from "react-router";
import { Critter } from "../components/Critter";

export function NotFound() {
  return (
    <div className="grid min-h-[70dvh] place-items-center p-6 text-center">
      <div className="flex flex-col items-center gap-4">
        <Critter kind="empty" size={96} />
        <p className="font-round text-[1.6rem] font-extrabold">找不到這一頁</p>
        <Link to="/" className="sticker inline-flex min-h-[56px] items-center rounded-full bg-ink px-6 font-bold text-paper">
          回到今天
        </Link>
      </div>
    </div>
  );
}
