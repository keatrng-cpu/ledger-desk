/**
 * The hesitation ledger — every moment the desk said "now", and what you did.
 *
 * WHY THIS EXISTS
 * The trader's diagnosis is that the desk reads direction and targets well
 * and the leak is COMPLETING ENTRIES. No journal can see that leak, because a
 * journal only holds trades that were taken. The missing quadrant — "the desk
 * said TAKE and nothing happened" — is exactly where it lives, and it is the
 * one quadrant this desk can record without asking anybody: it knows the
 * instant it printed the word.
 *
 * WHAT A MOMENT IS
 * One of two things, both already computed by the desk:
 *   TAKE  — smc-master's word is TAKE on a PATH band (A+/A/A−) with a plan.
 *   TOUCH — every must-layer but the retrace passes (entry-trigger.ts
 *           isWatchable) and price is inside the plan's entry array: the
 *           CE-touch alarm's condition.
 * Each is keyed per day, book, side and plan entry, so one plan is one row
 * however many polls it spans.
 *
 * WHAT IS RECORDED — at the moment, before the outcome, by construction
 *   the plan (entry / stop / T1 / T2), the band, the time;
 *   the trader's ACTION if one follows (a resting limit, a logged real fill)
 *   and the latency to it;
 *   the OUTCOME of the plan, resolved later on the desk's own bars under the
 *   rule as coded (limit at CE, ties against, 50% at T1 → BE → runner).
 *
 * It never nudges. There is no streak, no score and no alert here — the
 * research on gamification is clear that nudging clicks raises volume, not
 * results, and the desk's own evidence says a card alone is not an edge.
 * The ledger's question is narrower: when the desk's rule said go, did you,
 * and what did not going cost or save?
 *
 * Browser-local (localStorage), like the paper book. Nothing here is a fill.
 */

import type { OhlcBar } from "@/lib/market/types";
import type { SmcMasterBook } from "./smc-master";
import { isWatchable, readEntry } from "./entry-trigger";
import { etWallParts } from "./sessions";

export type MomentKind = "TAKE" | "TOUCH";
export type MomentAction = "rested" | "logged_live" | "paper_filled";

export interface TakeMoment {
  key: string;
  kind: MomentKind;
  at: number;
  day: string;
  symbol: string;
  side: "long" | "short";
  band: string;
  entry: number;
  stop: number;
  t1: number | null;
  t2: number | null;
  /** What the trader did about it, and how long after. */
  action?: MomentAction;
  actionAt?: number;
  latencySec?: number;
  /** The plan's own result under the rule as coded. */
  outcome?: "unfilled" | "stop" | "be" | "t1" | "t2" | "time" | "open";
  r?: number;
  resolvedAt?: number;
}

const KEY = "ledger.take-moments.v1";
const EVENT = "ledger-take-moments";
const MAX_ROWS = 300;
/** A limit that has not filled in 3h is an unfilled plan (pending-order.ts). */
const FILL_WINDOW_MS = 3 * 3600_000;
/** Past this the plan is judged at its last close — the evidence pack's hold. */
const HOLD_MS = 8 * 3600_000;
/** An action this long after the moment belongs to a different decision. */
const ACTION_WINDOW_MS = 3 * 3600_000;

function dayKey(t: number): string {
  const w = etWallParts(t);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
}

export function loadMoments(): TakeMoment[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const rows = raw ? (JSON.parse(raw) as TakeMoment[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function save(rows: TakeMoment[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, MAX_ROWS)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    /* quota — the ledger is a convenience, never a gate */
  }
}

export function subscribeMoments(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

const PATH = new Set(["A+", "A", "A-", "A−"]);

/** Which moment, if any, this book is in right now. Pure. */
export function momentFor(book: SmcMasterBook, price: number | null): MomentKind | null {
  if (!book.plan || !book.side) return null;
  if (!PATH.has(String(book.pathBand ?? ""))) return null;
  if (book.word === "TAKE") return "TAKE";
  if (price != null && isWatchable(book) && readEntry(book.plan, price, null)?.inZone) return "TOUCH";
  return null;
}

/**
 * Record any new moment on either book. Called on the quote poll; cheap when
 * nothing is happening (two object reads and a set lookup).
 */
export function observeTakeMoments(
  books: SmcMasterBook[],
  prices: Record<string, number | null | undefined>,
  now = Date.now(),
): TakeMoment[] {
  const rows = loadMoments();
  const seen = new Set(rows.map((r) => r.key));
  const day = dayKey(now);
  const added: TakeMoment[] = [];
  for (const book of books) {
    const kind = momentFor(book, prices[book.symbol] ?? null);
    if (!kind || !book.plan || !book.side) continue;
    const key = `${day}|${book.symbol}|${book.side}|${book.plan.entry.toFixed(2)}`;
    if (seen.has(key)) {
      // A TOUCH that later becomes a TAKE keeps its first timestamp — the
      // latency clock starts when the desk FIRST said now.
      continue;
    }
    seen.add(key);
    added.push({
      key,
      kind,
      at: now,
      day,
      symbol: book.symbol,
      side: book.side,
      band: String(book.pathBand ?? "—"),
      entry: book.plan.entry,
      stop: book.plan.stop,
      t1: book.plan.t1,
      t2: book.plan.t2,
    });
  }
  if (added.length) save([...added, ...rows]);
  return added;
}

/**
 * Link a trader action to the most recent open moment on the same book and
 * side, today, within the action window. Returns the moment it attached to.
 */
export function markTakeAction(
  symbol: string,
  side: "long" | "short",
  action: MomentAction,
  now = Date.now(),
): TakeMoment | null {
  const rows = loadMoments();
  const root = (s: string) => s.replace(/^M/, "");
  const m = rows.find(
    (r) =>
      root(r.symbol) === root(symbol) &&
      r.side === side &&
      r.action == null &&
      now - r.at >= 0 &&
      now - r.at <= ACTION_WINDOW_MS,
  );
  if (!m) return null;
  m.action = action;
  m.actionAt = now;
  m.latencySec = Math.round((now - m.at) / 1000);
  save(rows);
  return m;
}

/**
 * Resolve a moment's plan on bars AFTER it, under the rule as coded. Pure.
 * Ties go against the trade; the fill bar can stop out but never score T1.
 */
export function resolveMoment(m: TakeMoment, bars: OhlcBar[], now = Date.now()): Pick<TakeMoment, "outcome" | "r"> | null {
  const long = m.side === "long";
  const risk = Math.abs(m.entry - m.stop);
  if (!(risk > 0)) return { outcome: "unfilled", r: 0 };
  const after = bars.filter((b) => b.t > m.at);
  const rOf = (px: number) => (long ? px - m.entry : m.entry - px) / risk;
  let fillIdx = -1;
  for (let i = 0; i < after.length; i++) {
    const b = after[i]!;
    if (b.t - m.at > FILL_WINDOW_MS) break;
    if (long ? b.l <= m.entry : b.h >= m.entry) {
      fillIdx = i;
      break;
    }
  }
  if (fillIdx < 0) {
    return now - m.at > FILL_WINDOW_MS ? { outcome: "unfilled", r: 0 } : null;
  }
  let stop = m.stop;
  let banked = 0;
  let rem = 1;
  let t1Done = false;
  for (let i = fillIdx; i < after.length; i++) {
    const b = after[i]!;
    if (b.t - after[fillIdx]!.t > HOLD_MS) {
      return { outcome: "time", r: Math.round((banked + rem * rOf(b.o)) * 100) / 100 };
    }
    const stopped = long ? b.l <= stop : b.h >= stop;
    if (stopped) {
      banked += rem * rOf(stop);
      return { outcome: t1Done ? "be" : "stop", r: Math.round(banked * 100) / 100 };
    }
    if (i === fillIdx) continue;
    if (!t1Done && m.t1 != null && (long ? b.h >= m.t1 : b.l <= m.t1)) {
      t1Done = true;
      if (m.t2 == null) return { outcome: "t1", r: Math.round(rOf(m.t1) * 100) / 100 };
      banked += 0.5 * rOf(m.t1);
      rem = 0.5;
      stop = m.entry;
      continue;
    }
    if (t1Done && m.t2 != null && (long ? b.h >= m.t2 : b.l <= m.t2)) {
      banked += rem * rOf(m.t2);
      return { outcome: "t2", r: Math.round(banked * 100) / 100 };
    }
  }
  return null; // still in progress
}

/** Resolve whatever can be resolved on the bars the desk has now. */
export function tickMomentOutcomes(barsBySymbol: Record<string, OhlcBar[] | undefined>, now = Date.now()): number {
  const rows = loadMoments();
  let changed = 0;
  for (const m of rows) {
    if (m.outcome && m.outcome !== "open") continue;
    const bars = barsBySymbol[m.symbol];
    if (!bars?.length) continue;
    const res = resolveMoment(m, bars, now);
    if (!res) continue;
    if (res.outcome !== m.outcome || res.r !== m.r) {
      m.outcome = res.outcome;
      m.r = res.r;
      m.resolvedAt = now;
      changed++;
    }
  }
  if (changed) save(rows);
  return changed;
}

export interface LedgerSummary {
  moments: number;
  acted: number;
  medianLatencySec: number | null;
  /** Resolved moments you did NOT act on, and what the plan did anyway. */
  skipped: { n: number; filled: number; sumR: number };
  /** Resolved moments you acted on. */
  taken: { n: number; sumR: number };
  line: string;
}

export function summarizeMoments(rows: TakeMoment[]): LedgerSummary {
  const acted = rows.filter((r) => r.action);
  const lat = acted
    .map((r) => r.latencySec)
    .filter((x): x is number => x != null)
    .sort((a, b) => a - b);
  const median = lat.length ? lat[Math.floor(lat.length / 2)]! : null;
  const resolved = rows.filter((r) => r.outcome && r.outcome !== "open");
  const skippedRows = resolved.filter((r) => !r.action);
  const takenRows = resolved.filter((r) => r.action);
  const sum = (a: TakeMoment[]) => Math.round(a.reduce((s, r) => s + (r.r ?? 0), 0) * 100) / 100;
  const skipped = {
    n: skippedRows.length,
    filled: skippedRows.filter((r) => r.outcome !== "unfilled").length,
    sumR: sum(skippedRows),
  };
  const taken = { n: takenRows.length, sumR: sum(takenRows) };
  const line = !rows.length
    ? "No desk TAKE or CE-touch moments recorded yet. Each one is logged the instant it prints — before anyone knows how it ends."
    : `${rows.length} moment${rows.length === 1 ? "" : "s"} the desk said now; you acted on ${acted.length}` +
      (median != null ? ` (median ${median < 90 ? `${median}s` : `${Math.round(median / 60)}m`} to act)` : "") +
      `. The ones you let go: ${skipped.n} resolved, ${skipped.filled} would have filled, ${skipped.sumR >= 0 ? "+" : ""}${skipped.sumR}R between them` +
      (skipped.n < 12 ? " — too few to say whether hesitating costs or saves." : ".");
  return { moments: rows.length, acted: acted.length, medianLatencySec: median, skipped, taken, line };
}
