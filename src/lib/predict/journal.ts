/**
 * The event-contract journal — the trader's own record, priced after fees.
 *
 * The published evidence (favorite–longshot bias; takers paying the spread)
 * says what happens on AVERAGE. Whether buying underdogs and selling into a
 * rise works for THIS trader is a question only their own fills can answer,
 * so every entry and exit is recorded here with both sides' fees, and the
 * record is cut by entry price — the one variable the longshot literature
 * says matters most. Same discipline as the futures journal: record first,
 * believe after n.
 *
 * Browser storage (per device), like the RH options journal.
 */

import { sideFee, type FeeModel, DEFAULT_FEES } from "./math";

const KEY = "ledger.predict.journal.v1";
const EVENT = "ledger-predict";

export interface PredictTrade {
  id: string;
  league: string;
  game: string;
  ticker: string;
  team: string;
  contracts: number;
  /** Price paid per contract, 0–1. */
  entry: number;
  entryAt: string;
  /** The reference probability at entry (book no-vig or ESPN live), if shown. */
  referenceAtEntry: number | null;
  referenceName: string | null;
  /** Sold before settlement at this price… */
  exit?: number;
  exitAt?: string;
  /** …or held to settlement: 1 = won ($1), 0 = lost. */
  settled?: 0 | 1;
  note?: string;
}

export function subscribePredict(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

export function loadTrades(): PredictTrade[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const rows = raw ? (JSON.parse(raw) as PredictTrade[]) : [];
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function save(rows: PredictTrade[]): boolean {
  if (typeof window === "undefined") return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 2000)));
  } catch {
    return false;
  }
  window.dispatchEvent(new Event(EVENT));
  return true;
}

export function logEntry(t: Omit<PredictTrade, "id" | "entryAt"> & { entryAt?: string }): { ok: boolean; why: string } {
  if (!(t.contracts > 0) || !(t.entry > 0 && t.entry < 1)) return { ok: false, why: "Contracts > 0 and a price between 1¢ and 99¢." };
  const row: PredictTrade = { ...t, id: `pm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, entryAt: t.entryAt ?? new Date().toISOString() };
  return save([row, ...loadTrades()]) ? { ok: true, why: "logged" } : { ok: false, why: "Browser storage refused the write." };
}

export function closeTrade(id: string, how: { exit: number } | { settled: 0 | 1 }): { ok: boolean; why: string } {
  const rows = loadTrades();
  const i = rows.findIndex((r) => r.id === id);
  if (i < 0) return { ok: false, why: "No such trade." };
  if (rows[i].exit != null || rows[i].settled != null) return { ok: false, why: "Already closed — a closed trade is not edited." };
  if ("exit" in how) {
    if (!(how.exit >= 0 && how.exit <= 1)) return { ok: false, why: "Exit price between 0¢ and 100¢." };
    rows[i] = { ...rows[i], exit: how.exit, exitAt: new Date().toISOString() };
  } else {
    rows[i] = { ...rows[i], settled: how.settled, exitAt: new Date().toISOString() };
  }
  return save(rows) ? { ok: true, why: "closed" } : { ok: false, why: "Browser storage refused the write." };
}

export function deleteTrade(id: string): void {
  save(loadTrades().filter((r) => r.id !== id));
}

/** Net P/L of a closed trade after both sides' fees (settlement itself carries no trading fee). */
export function tradePnl(t: PredictTrade, fees: FeeModel = DEFAULT_FEES): number | null {
  const cost = t.entry * t.contracts + sideFee(t.entry, t.contracts, fees);
  if (t.exit != null) return Math.round((t.exit * t.contracts - sideFee(t.exit, t.contracts, fees) - cost) * 100) / 100;
  if (t.settled != null) return Math.round((t.settled * t.contracts - cost) * 100) / 100;
  return null;
}

export interface Bucket {
  label: string;
  n: number;
  wins: number;
  net: number;
  staked: number;
}

export const BUCKETS: { label: string; lo: number; hi: number }[] = [
  { label: "under 20¢ (longshot)", lo: 0, hi: 0.2 },
  { label: "20–40¢ (underdog)", lo: 0.2, hi: 0.4 },
  { label: "40–60¢ (coin flip)", lo: 0.4, hi: 0.6 },
  { label: "60–80¢ (favorite)", lo: 0.6, hi: 0.8 },
  { label: "80¢+ (heavy favorite)", lo: 0.8, hi: 1.01 },
];

export interface JournalRead {
  open: PredictTrade[];
  closed: number;
  net: number;
  staked: number;
  wins: number;
  buckets: Bucket[];
  line: string;
}

export function readJournal(rows: PredictTrade[] = loadTrades(), fees: FeeModel = DEFAULT_FEES): JournalRead {
  const open = rows.filter((r) => r.exit == null && r.settled == null);
  const closed = rows.filter((r) => r.exit != null || r.settled != null);
  const buckets: Bucket[] = BUCKETS.map((b) => ({ label: b.label, n: 0, wins: 0, net: 0, staked: 0 }));
  let net = 0;
  let staked = 0;
  let wins = 0;
  for (const t of closed) {
    const p = tradePnl(t, fees) ?? 0;
    const cost = t.entry * t.contracts;
    net += p;
    staked += cost;
    if (p > 0) wins++;
    const k = BUCKETS.findIndex((b) => t.entry >= b.lo && t.entry < b.hi);
    if (k >= 0) {
      buckets[k].n++;
      buckets[k].net += p;
      buckets[k].staked += cost;
      if (p > 0) buckets[k].wins++;
    }
  }
  const r2 = (x: number) => Math.round(x * 100) / 100;
  return {
    open,
    closed: closed.length,
    net: r2(net),
    staked: r2(staked),
    wins,
    buckets: buckets.map((b) => ({ ...b, net: r2(b.net), staked: r2(b.staked) })),
    line:
      closed.length === 0
        ? "No closed trades yet. The record starts with the first one — and it is the only evidence about YOUR edge that exists."
        : `${closed.length} closed · ${wins} winners · net ${net >= 0 ? "+" : "-"}$${Math.abs(r2(net)).toFixed(2)} after fees on $${r2(staked).toFixed(2)} staked (${staked > 0 ? ((net / staked) * 100).toFixed(1) : "0"}%).${closed.length < 30 ? " Under 30 trades this is noise, not a result." : ""}`,
  };
}
