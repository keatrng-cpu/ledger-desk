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
 * NY AM only. Judas 9:30–9:45 A+ only (clock is not a hard veto). News blackout. One book. PATH A+/A/A−.
 */
export function autoPaperShouldTake(desk: DeskPayload): AutoPaperPick {
  const s = load();
  if (!s.on) return { take: null, skip: "Auto paper off" };

  const clock = desk.clock;
  if (!clock.isWeekday) return { take: null, skip: "Weekend" };
  // NY AM, or a measured session event anywhere else (session-event.ts).
  //
  // The bare `killzone !== "ny_am"` was the right scope for an auto-filler —
  // it stops the paper book collecting a trade an hour all day — and the wrong
  // veto for the case it was silently covering: an 08:32 release or a 14:10
  // headline produced no paper row at all, so the desk's own statistics could
  // never contain one and the shadow book could never learn from one. This is
  // the PAPER book; being wrong here costs a row in a ledger, not money.
  const live = clock.killzone === "ny_am" || clock.sessionSource === "event";
  if (!live) {
    return { take: null, skip: `Not NY AM and no session event (${clock.killzoneLabel})` };
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

  const candidate = desk.scan.candidates.find((c) => isHighProbPath(c));
  if (!candidate) return { take: null, skip: "No A+/A/A− PATH" };

  // One book per day, and the rule is about BIAS — same as paper-manager.ts
  // and journal/server.ts. This used to refuse ANY second book, which
  // contradicted CLAUDE.md and refused the SMT divergence pair the desk
  // grades for. Checked AFTER the candidate is picked, because the side is
  // what the rule turns on.
  if (taken && taken.side != null && taken.side === candidate.side) {
    return { take: null, skip: `One book today: ${taken.symbol} ${taken.side} (same bias)` };
  }

  const seq =
    candidate.symbol === desk.smcMaster.left.symbol
      ? desk.smcMaster.left
      : desk.smcMaster.right;
  if (seq.word !== "TAKE") {
    return { take: null, skip: `SMC sequence ${seq.word}: ${seq.missing}` };
  }
  // An ARMED take (gate-tuning.ts armedIsTake) is a TAKE whose entry is a
  // limit resting at consequent encroachment — price is NOT in the array
  // yet. openPaperTradeInstant books the fill at the zone mid the moment it
  // is called, which for an armed card would be a fill at a price that has
  // not traded: an invented fill. The alarm may fire on the word; the paper
  // book waits for the touch, i.e. for the retrace layer to pass on the
  // live print.
  const retrace = seq.layers.find((l) => l.id === "retrace");
  if (retrace && retrace.state !== "pass") {
    return { take: null, skip: `Armed — limit at CE, waiting for the touch: ${retrace.detail}` };
  }

  // Never book a fill on a stale print. The desk rebuild already drops
  // `actionable` on a stale quote, but the 1-2s quote poll patches lagSec in
  // between builds, and a tab returning from the background can carry a
  // pre-hidden price. 120s is the same execution gate the HUD shows.
  const worstLag = Math.max(desk.quotes.left.lagSec ?? 0, desk.quotes.right.lagSec ?? 0);
  if (worstLag > 120) {
    return { take: null, skip: `Quote ${Math.round(worstLag)}s old — no fill on a stale print` };
  }

  const band = String(candidate.pathBand || candidate.grade);
  if (isJudasWindow(clock.etHour, clock.etMinute) && band !== "A+" && band !== "A＋") {
    return { take: null, skip: "Judas 9:30–9:45 — A+ only; clock does not veto a complete A+ sequence" };
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
    why: `NY AM PATH ${band} Q ${candidate.confluence.toFixed(2)} · SMC TAKE ${seq.mustPass}/${seq.mustNeed}`,
  };
}
