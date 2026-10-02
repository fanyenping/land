import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState, useSyncExternalStore } from "react";
import { currentEngine, onEngine, probeEngine, type Engine } from "./api";
import { db } from "./db";
import { DEFAULT_SETTINGS, type Patient, type Settings, type Visit } from "./model";
import { recorder } from "./recorder";

export function useSettings(): Settings {
  return useLiveQuery(() => db.settings.get("me"), [], undefined) ?? DEFAULT_SETTINGS;
}

export function usePatients(): Patient[] | undefined {
  return useLiveQuery(() => db.patients.orderBy("updatedAt").reverse().toArray(), []);
}

export function usePatient(id: string | undefined): Patient | undefined | null {
  return useLiveQuery(async () => (id ? ((await db.patients.get(id)) ?? null) : null), [id]);
}

export function useVisit(id: string | undefined): Visit | undefined | null {
  return useLiveQuery(async () => (id ? ((await db.visits.get(id)) ?? null) : null), [id]);
}

export function useVisitsOn(date: string): Visit[] | undefined {
  return useLiveQuery(() => db.visits.where("date").equals(date).toArray(), [date]);
}

export function useAllVisits(): Visit[] | undefined {
  return useLiveQuery(() => db.visits.toArray(), []);
}

export function usePatientVisits(patientId: string | undefined): Visit[] | undefined {
  return useLiveQuery(async () => (patientId ? db.visits.where("patientId").equals(patientId).toArray() : []), [patientId]);
}

export function useRecorder() {
  return useSyncExternalStore(recorder.subscribe, recorder.getSnapshot, recorder.getSnapshot);
}

export function useEngine(): Engine | null {
  const [e, setE] = useState<Engine | null>(currentEngine());
  useEffect(() => {
    const off = onEngine(setE);
    void probeEngine().then(setE);
    return () => {
      off();
    };
  }, []);
  return e;
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useMedia(query: string) {
  const [match, setMatch] = useState(() => typeof window !== "undefined" && window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const fn = () => setMatch(m.matches);
    fn();
    m.addEventListener("change", fn);
    return () => m.removeEventListener("change", fn);
  }, [query]);
  return match;
}

export function useNow(intervalMs = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/* 姓名暫時顯示（小眼睛）：全 App 共用，10 秒後自動遮回。 */
let revealUntil = 0;
const revealListeners = new Set<() => void>();
let revealTimer: ReturnType<typeof setTimeout> | undefined;

export function revealNames() {
  revealUntil = Date.now() + 10_000;
  revealListeners.forEach((l) => l());
  clearTimeout(revealTimer);
  revealTimer = setTimeout(() => revealListeners.forEach((l) => l()), 10_050);
}

export function hideNames() {
  revealUntil = 0;
  clearTimeout(revealTimer);
  revealListeners.forEach((l) => l());
}

export function useNamesRevealed() {
  return useSyncExternalStore(
    (fn) => {
      revealListeners.add(fn);
      return () => revealListeners.delete(fn);
    },
    () => Date.now() < revealUntil,
  );
}
