/**
 * Auto paper — PATH A+/A/A− on the $100k book.
 * NY AM during the options window. After 11:00 ET the same book papers
 * futures until 16:00 so the session keeps a sample. A loss raises the
 * next band. Fills ingest into the same rates a backtest uses.
 * Does not fire live Apex.
 */

import { isHighProbPath } from "@/lib/alerts/path-alarm";
import type { DeskPayload } from "./build-desk";
import { loadDeskMemory, remember } from "./desk-memory";
import { countersFromMemory, pathTakeGate } from "./profit-rules";
import { bookTakenToday, bookRoot, listOpenPaperTrades, paperTradeHistory } from "./paper-manager";
import { tradingDayStart } from "@/lib/journal/risk";
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


/** A+ = 3, A = 2, A- = 1. Anything else is not a futures-paper band. */
export function bandRank(band: string): number {
  const b = band.replaceAll("\u2212", "-");
  if (b.startsWith("A+")) return 3;
  if (b.startsWith("A-")) return 1;
  if (b === "A" || b.startsWith("A ")) return 2;
  return 0;
}

/**
 * A losing futures-paper fill raises the band for the rest of the session.
 * An A+ loss stands the session down. A win keeps the floor where it was.
 */
export function nextBandAfter(
  lastBand: string,
  lost: boolean,
): { min: number } | { skip: string } {
  if (!lost) return { min: 1 };
  const need = bandRank(lastBand) + 1;
  if (need > 3) return { skip: "A+ lost \u2014 futures paper stands down for the session" };
  return { min: need };
}

/** n\u22653 and win rate under 45% \u2014 the same cold tape the brain already names. */
export function strategyCold(n: number, wins: number): boolean {
  return n >= 3 && wins / n < 0.45;
}

/**
 * After the options window (11:00 ET) through the cash close, paper the
 * futures book on the $100k account. Same PATH floor, same one-book rule,
 * same ingest into the rates a backtest fills. A loss raises the next band.
 */
export function futuresPaperShouldTake(desk: DeskPayload): AutoPaperPick {
  const s = load();
  if (!s.on) return { take: null, skip: "Auto paper off" };

  const clock = desk.clock;
  if (!clock.isWeekday) return { take: null, skip: "Weekend" };
  const etMin = clock.etHour * 60 + clock.etMinute;
  if (etMin < 11 * 60) return { take: null, skip: "Options window \u2014 futures paper starts at 11:00 ET" };
  if (etMin >= 16 * 60) return { take: null, skip: "Cash closed \u2014 journal the session" };

  const date = etDateKey();
  const weekDay = weekDayFor(date);
  if (weekDay?.kind === "holiday") return { take: null, skip: "Cash holiday" };
  if (desk.news?.verdict === "blackout") {
    return { take: null, skip: desk.news.reason || "News blackout" };
  }
  if (listOpenPaperTrades().length > 0) return { take: null, skip: "Paper already open" };

  const worstLag = Math.max(desk.quotes.left.lagSec ?? 0, desk.quotes.right.lagSec ?? 0);
  if (worstLag > 120) {
    return { take: null, skip: `Quote ${Math.round(worstLag)}s old \u2014 no fill on a stale print` };
  }

  const lunch = clock.killzone === "ny_lunch";
  const dayStart = tradingDayStart(new Date()).getTime();
  const closedToday = paperTradeHistory(40)
    .filter((t) => t.status === "closed" && (t.closedAt ?? 0) >= dayStart)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  const last = closedToday[0];
  const lost = !!last && (last.pnlUsd ?? 0) <= 0;
  const raised = nextBandAfter(last?.pathBand || last?.grade || "A-", lost);
  if ("skip" in raised) return { take: null, skip: raised.skip };
  const minRank = Math.max(raised.min, lunch ? 3 : 1);

  const taken = bookTakenToday();
  const pool = desk.scan.candidates
    .filter((c) => isHighProbPath(c))
    .filter((c) => bandRank(String(c.pathBand || c.grade)) >= minRank)
    .filter((c) => !taken || bookRoot(c.symbol) === taken.book)
    .sort((a, b) => b.confluence - a.confluence);
  const candidate = pool[0];
  if (!candidate) {
    if (taken) return { take: null, skip: `One book today: ${taken.symbol} \u2014 no higher PATH on that book` };
    return {
      take: null,
      skip: lunch
        ? "Lunch \u2014 futures paper is A+ only"
        : minRank > 1
          ? "Last paper lost \u2014 waiting on a higher band"
          : "No A+/A/A\u2212 PATH",
    };
  }

  const rates = loadDeskMemory().rates.byStrategy[candidate.strategyPrimary];
  if (
    rates &&
    strategyCold(rates.n, rates.wins) &&
    bandRank(String(candidate.pathBand || candidate.grade)) < 3
  ) {
    return { take: null, skip: `${candidate.strategyPrimary} is cold \u2014 futures paper wants A+` };
  }

  const seq =
    candidate.symbol === desk.smcMaster.left.symbol
      ? desk.smcMaster.left
      : desk.smcMaster.right;
  if (seq.word !== "TAKE") {
    return { take: null, skip: `SMC sequence ${seq.word}: ${seq.missing}` };
  }

  const key = autoPaperKey(candidate);
  if (s.lastKey === key) return { take: null, skip: "Already auto-logged this card" };

  const band = String(candidate.pathBand || candidate.grade);
  return {
    take: candidate,
    why: `Futures paper ${clock.killzoneLabel} ${band} Q ${candidate.confluence.toFixed(2)} \u00b7 $100k \u00b7 same rates as a backtest`,
  };
}

/** One line per closed futures-paper fill, so the brain can see if the session improved. */
export function noteFuturesSession(
  closed: { id: string; symbol: string; side: string; rMultiple?: number | null; strategy?: string }[],
  etMin: number,
): void {
  if (etMin < 11 * 60 || etMin >= 16 * 60) return;
  const prev = loadDeskMemory().book.lastPaperR ?? null;
  for (const t of closed) {
    const r = t.rMultiple;
    if (r == null || !Number.isFinite(r)) continue;
    const mem = loadDeskMemory();
    const seen = mem.items.some(
      (i) => i.kind === "session" && (i.payload as { tradeId?: string } | undefined)?.tradeId === t.id,
    );
    if (seen) continue;
    const line =
      prev == null
        ? `Futures paper ${t.symbol} ${t.side} ${r >= 0 ? "+" : ""}${r.toFixed(2)}R \u2014 first of the session. It feeds the same rates as a backtest fill.`
        : r > prev
          ? `Futures paper ${t.symbol} ${t.side} ${r >= 0 ? "+" : ""}${r.toFixed(2)}R beat the last ${prev >= 0 ? "+" : ""}${prev.toFixed(2)}R.`
          : `Futures paper ${t.symbol} ${t.side} ${r >= 0 ? "+" : ""}${r.toFixed(2)}R did not beat the last ${prev >= 0 ? "+" : ""}${prev.toFixed(2)}R. Next one needs a higher band.`;
    remember("session", "Futures paper", line, ["paper", "futures", "session", t.symbol], {
      tradeId: t.id,
      r,
      prev,
      strategy: t.strategy ?? null,
    });
  }
}
