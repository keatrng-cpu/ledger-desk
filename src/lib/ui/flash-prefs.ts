/** Screen flash on/off (header toggle). localStorage, default ON. */
const KEY = "ledger-screen-flash-v1";
const subs = new Set<() => void>();

export function getFlashOn(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    return true;
  }
}

export function setFlashOn(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* private mode: the toggle still works for this page */
  }
  for (const fn of subs) fn();
}

export function subscribeFlash(fn: () => void): () => void {
  subs.add(fn);
  const onStorage = (e: StorageEvent) => e.key === KEY && fn();
  window.addEventListener("storage", onStorage);
  return () => {
    subs.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}
