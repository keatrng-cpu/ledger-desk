/**
 * Auto paper — Trade Now fills PATH A+/A/A− itself in NY AM.
 * Same openPaperTradeInstant path as the Log paper button, so stats,
 * equity, debrief, and the brain all see the fill.
 *
 * Does not fire live Apex (that is 0.85 + env switches). This is paper only.
 */

import { isHighProbPath } from "@/lib/alerts/path-alarm";
import type { DeskPayload } from "./build-desk";
import { loadDeskMemory } from "./desk-memory";
import { countersFromMemory, pathTakeGate } from "./profit-rules";
import { bookTakenToday, listOpenPaperTrades } from "./paper-manager";
import { isJudasWindow } from "./sessions";
import { weekDayFor, etDateKey } from "./week-ahead";
import type { SetupCandidate } from "./scanner";

export const AUTO_PAPER_STORAGE = "ledger-auto-paper";
export const AUTO_PAPER_EVENT = "ledger-auto-paper";

export interface AutoPaperState {
  on: boolean;
  lastKey: string | null;
  lastAt: number | null;
  lastTitle: string | null;
  lastSkip: string | null;
}

type Listener = (s: AutoPaperState) => void;
const listeners = new Set<Listener>();

function load(): AutoPaperState {
  if (typeof window === "undefined") {
    return { on: true, lastKey: null, lastAt: null, lastTitle: null, lastSkip: null };
  }
  try {
    const raw = localStorage.getItem(AUTO_PAPER_STORAGE);
    if (!raw) {
      return { on: true, lastKey: null, lastAt: null, lastTitle: null, lastSkip: null };
    }
    const p = JSON.parse(raw) as Partial<AutoPaperState>;
    return {
      on: p.on !== false,
      lastKey: typeof p.lastKey === "string" ? p.lastKey : null,
      lastAt: typeof p.lastAt === "number" ? p.lastAt : null,
      lastTitle: typeof p.lastTitle === "string" ? p.lastTitle : null,
      lastSkip: typeof p.lastSkip === "string" ? p.lastSkip : null,
    };
  } catch {
    return { on: true, lastKey: null, lastAt: null, lastTitle: null, lastSkip: null };
  }
}

function save(s: AutoPaperState): AutoPaperState {
  if (typeof window !== "undefined") {
    localStorage.setItem(AUTO_PAPER_STORAGE, JSON.stringify(s));
    window.dispatchEvent(new Event(AUTO_PAPER_EVENT));
  }
  for (const fn of listeners) fn(s);
  return s;
}

export function getAutoPaperState(): AutoPaperState {
  return load();
}

export function setAutoPaper(on: boolean): AutoPaperState {
  return save({ ...load(), on });
}

export function subscribeAutoPaper(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function autoPaperKey(c: SetupCandidate, now = Date.now()): string {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(now));
  return `${day}:${c.id}:${c.side}:${c.pathBand || c.grade}`;
}

export function rememberAutoPaperKey(c: SetupCandidate, title: string): void {
  save({
    ...load(),
    lastKey: autoPaperKey(c),
    lastAt: Date.now(),
    lastTitle: title,
    lastSkip: null,
  });
}

export function noteAutoPaperSkip(reason: string): void {
  const s = load();
  if (s.lastSkip === reason) return;
  save({ ...s, lastSkip: reason });
}

export function releaseAutoPaperKey(): void {
  save({ ...load(), lastKey: null, lastTitle: null });
}

export type AutoPaperPick =
  | { take: SetupCandidate; why: string }
  | { take: null; skip: string };

/**
 * Pure pick. Caller opens via openPaperTradeInstant so stats stay one path.
 * NY AM only, not Judas (unless A+), not news blackout, one book, PATH A+/A/A−.
 */
export function autoPaperShouldTake(desk: DeskPayload): AutoPaperPick {
  const s = load();
  if (!s.on) return { take: null, skip: "Auto paper off" };

  const clock = desk.clock;
  if (!clock.isWeekday) return { take: null, skip: "Weekend" };
  if (clock.killzone !== "ny_am") {
    return { take: null, skip: `Not NY AM (${clock.killzoneLabel})` };
  }
  if (desk.news?.verdict === "blackout") {
    return { take: null, skip: desk.news.reason || "News blackout" };
  }

  const date = etDateKey();
  const weekDay = weekDayFor(date);
  if (weekDay?.kind === "holiday") {
    return { take: null, skip: "Cash holiday" };
  }
  if (
    (weekDay?.kind === "nfp" || weekDay?.kind === "event") &&
    (clock.etHour < 10 || (clock.etHour === 10 && clock.etMinute < 15))
  ) {
    return { take: null, skip: "Event window — second impulse after 10:15 ET" };
  }

  if (listOpenPaperTrades().length > 0) {
    return { take: null, skip: "Paper already open" };
  }
  const taken = bookTakenToday();
  if (taken) {
    return { take: null, skip: `One book today: ${taken.symbol}` };
  }

  const candidate = desk.scan.candidates.find((c) => isHighProbPath(c));
  if (!candidate) return { take: null, skip: "No A+/A/A− PATH" };

  const band = String(candidate.pathBand || candidate.grade);
  if (isJudasWindow(clock.etHour, clock.etMinute) && band !== "A+") {
    return { take: null, skip: "Judas 9:30–9:45 — A+ only" };
  }

  const counters = countersFromMemory(loadDeskMemory());
  const gate = pathTakeGate(candidate, counters, {
    alreadyTookSymbolToday: null,
  });
  if (!gate.take && gate.reason !== "blake_long_demoted") {
    return { take: null, skip: gate.detail };
  }
  if (gate.reason === "blake_long_demoted") {
    return { take: null, skip: "blake_mech long — manual paper only" };
  }

  const key = autoPaperKey(candidate);
  if (s.lastKey === key) return { take: null, skip: "Already auto-logged this card" };

  return {
    take: candidate,
    why: `NY AM PATH ${band} Q ${candidate.confluence.toFixed(2)}`,
  };
}
