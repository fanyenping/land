import { useEffect, useRef, useState } from "react";
import { Navigate, Outlet, useLocation } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { Critter } from "../components/Critter";
import { BottomNav, SideNav } from "../components/Nav";
import { db } from "../lib/db";
import { useFlows } from "./Flows";

export function AppShell() {
  const settings = useLiveQuery(() => db.settings.get("me"), [], "loading" as const);
  const loc = useLocation();
  if (settings === "loading") return null;
  if (!settings?.onboarded) return <Navigate to="/welcome" replace state={{ from: loc.pathname }} />;
  return <Frame />;
}

function Frame() {
  const flows = useFlows();
  const loc = useLocation();
  const hideNav = /^\/v\/[^/]+$/.test(loc.pathname);
  return (
    <div className="flex min-h-[100dvh]">
      <SideNav onPlus={() => flows.openNew()} />
      <main className={hideNav ? "min-w-0 flex-1" : "min-w-0 flex-1 pb-[calc(env(safe-area-inset-bottom)+110px)] lg:pb-10"}>
        <Outlet />
      </main>
      {!hideNav && <BottomNav onPlus={() => flows.openNew()} />}
      <DropZone />
    </div>
  );
}

/** 電腦版：整個視窗都可拖放 PDF、照片、錄音檔。 */
function DropZone() {
  const flows = useFlows();
  const [over, setOver] = useState(false);
  const depth = useRef(0);

  useEffect(() => {
    const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    };
    const overFn = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const drop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      depth.current = 0;
      setOver(false);
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length) flows.importFiles(files);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragleave", leave);
    window.addEventListener("dragover", overFn);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("dragover", overFn);
      window.removeEventListener("drop", drop);
    };
  }, [flows]);

  if (!over) return null;
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] grid place-items-center bg-[#141414]/40 p-6 backdrop-blur-sm">
      <div className="flex animate-pop flex-col items-center gap-3 rounded-[36px] border-[3px] border-dashed border-[#141414] bg-pending px-12 py-10 text-[#141414]">
        <Critter kind="pdf" size={80} />
        <p className="font-round text-[1.6rem] font-extrabold">放開以匯入</p>
      </div>
    </div>
  );
}
