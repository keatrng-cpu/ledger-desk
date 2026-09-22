/**
 * Local state for the share book — positions and the sweep log.
 *
 * Deliberately localStorage rather than the Neon journal. The trading
 * journal is hash-chained and append-only because it is building an
 * attestable track record; this book is a personal ledger of what the
 * trader actually bought and needs no such ceremony. If it ever does, it
 * moves to the database as its own table rather than contaminating the
 * trade journal with non-trade rows.
 *
 * The sweep log is append-only in spirit: `logSweep` never overwrites a
 * month, because the point of the log is to be able to ask "did I actually
 * do this every month" a year from now and get a truthful answer.
 */

import type { Position } from "./book";
import type { SweepPlan } from "./policy";

const POS_KEY = "ledger.invest.positions.v1";
const SWEEP_KEY = "ledger.invest.sweeps.v1";
const EVENT = "ledger-invest";

export interface SweepRecord {
  /** YYYY-MM — one record per month, ever. */
  month: string;
  verdict: SweepPlan["verdict"];
  realizedUsd: number;
  rentUsd: number;
  restoreUsd: number;
  sweptUsd: number;
  rate: number;
  loggedAt: string;
  note: string;
}

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function subscribeInvest(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
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

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota */
  }
  emit();
}

export function loadPositions(): Position[] {
  const rows = read<Position[]>(POS_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

/**
 * Add to a position or open one. Buys ACCUMULATE — a second purchase of
 * the same ticker adds shares and dollars to the existing lot rather than
 * replacing it, and keeps the ORIGINAL openedAt so the long-term capital
 * gains clock is not silently reset by a $5 top-up.
 */
export function addShares(next: Position): Position[] {
  const rows = loadPositions();
  const i = rows.findIndex((p) => p.ticker === next.ticker);
  if (i >= 0) {
    const prev = rows[i];
    rows[i] = {
      ...prev,
      shares: prev.shares + next.shares,
      costUsd: prev.costUsd + next.costUsd,
      openedAt: prev.openedAt < next.openedAt ? prev.openedAt : next.openedAt,
    };
  } else {
    rows.push(next);
  }
  write(POS_KEY, rows);
  return rows;
}

export function removePosition(ticker: string): Position[] {
  const rows = loadPositions().filter((p) => p.ticker !== ticker);
  write(POS_KEY, rows);
  return rows;
}

export function loadSweeps(): SweepRecord[] {
  const rows = read<SweepRecord[]>(SWEEP_KEY, []);
  return Array.isArray(rows) ? rows : [];
}

/** Record a month. Refuses to overwrite one already logged. */
export function logSweep(rec: SweepRecord): { logged: boolean; why: string } {
  const rows = loadSweeps();
  if (rows.some((r) => r.month === rec.month)) {
    return { logged: false, why: `${rec.month} is already logged. A month is priced once.` };
  }
  write(SWEEP_KEY, [rec, ...rows].slice(0, 240));
  return { logged: true, why: "logged" };
}

/** Months swept, for the rate ladder in policy.ts. */
export function closedMonths(): number {
  return loadSweeps().length;
}

/** Total ever swept — the only "performance" number worth showing early. */
export function totalSwept(): number {
  return Math.round(loadSweeps().reduce((s, r) => s + r.sweptUsd, 0) * 100) / 100;
}
