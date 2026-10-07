/**
 * On the Wire as a chat — the viewer's own marks on it. Reactions and pins
 * are this browser's display state only (localStorage); nothing here is read
 * by the room engine, the gates or the book.
 */
import { useCallback, useEffect, useState } from "react";

export const REACTIONS = ["👍", "👀", "🔥", "❓"] as const;
export type Reaction = (typeof REACTIONS)[number];

const REACT_KEY = "ledger.floor.wire.reactions";
const PIN_KEY = "ledger.floor.wire.pins";
const EVT = "ledger-wire-marks";
const MAX_PINS = 3;
const MAX_REACTED = 200;

export interface WirePin {
  id: string;
  at: number;
  who: string;
  text: string;
}

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, v: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage unavailable — marks last for this visit */
  }
  window.dispatchEvent(new Event(EVT));
}

function useStored<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [v, setV] = useState<T>(() => read(key, fallback));
  useEffect(() => {
    const on = () => setV(read(key, fallback));
    window.addEventListener(EVT, on);
    window.addEventListener("storage", on);
    return () => {
      window.removeEventListener(EVT, on);
      window.removeEventListener("storage", on);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fallback is a literal; key is constant per call site
  }, [key]);
  const set = useCallback(
    (next: T) => {
      setV(next);
      write(key, next);
    },
    [key],
  );
  return [v, set];
}

/** id → the reactions this viewer has put on it. */
export function useWireReactions() {
  const [map, setMap] = useStored<Record<string, Reaction[]>>(REACT_KEY, {});
  const toggle = useCallback(
    (id: string, r: Reaction) => {
      const cur = map[id] ?? [];
      const next = { ...map, [id]: cur.includes(r) ? cur.filter((x) => x !== r) : [...cur, r] };
      if (!next[id]!.length) delete next[id];
      const ids = Object.keys(next);
      if (ids.length > MAX_REACTED) for (const old of ids.slice(0, ids.length - MAX_REACTED)) delete next[old];
      setMap(next);
    },
    [map, setMap],
  );
  return { reactions: map, toggle };
}

/** Lines pinned to THE PLAN board, newest first, at most three. */
export function useWirePins() {
  const [pins, setPins] = useStored<WirePin[]>(PIN_KEY, []);
  const isPinned = useCallback((id: string) => pins.some((p) => p.id === id), [pins]);
  const toggle = useCallback(
    (pin: WirePin) => {
      setPins(pins.some((p) => p.id === pin.id) ? pins.filter((p) => p.id !== pin.id) : [pin, ...pins].slice(0, MAX_PINS));
    },
    [pins, setPins],
  );
  const unpin = useCallback((id: string) => setPins(pins.filter((p) => p.id !== id)), [pins, setPins]);
  return { pins, isPinned, toggle, unpin };
}
