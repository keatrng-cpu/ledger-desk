/**
 * PM analyzer paper book — PaperTicket[] (paper-scorer.ts shape) on this device.
 *
 * Tickets come ONLY from `paperTicketFromSignal(signal)` — the snapshot of a
 * live MarketSignal (ask, fee, forecast, settle time). PAPER ONLY: nothing
 * here can place, review or cancel an order; there is no broker import.
 *
 * Outcomes: a ticket stays open (`outcome: null`) until a settled-market read
 * resolves it via `resolvePaper`. No resolver is wired yet (getPredictionSignals
 * only returns open markets) — the record reads "too few to read" until one is.
 */

import type { PaperTicket } from "./paper-scorer";

export const PM_PAPER_KEY = "ledger.pm-analyzer.paper.v1";
const EVT = "ledger:pm-paper";
/** Cap so a long session cannot grow localStorage without bound. */
export const PM_PAPER_MAX = 2_000;

function store(): Storage | null {
  try {
    return typeof window !== "undefined" && window.localStorage ? window.localStorage : null;
  } catch {
    return null;
  }
}

const isTicket = (t: unknown): t is PaperTicket => {
  const x = t as PaperTicket;
  return (
    !!x &&
    typeof x.id === "string" &&
    typeof x.marketId === "string" &&
    (x.side === "yes" || x.side === "no") &&
    Number.isFinite(x.forecast) &&
    Number.isFinite(x.entryPrice) &&
    typeof x.snapshotAt === "string"
  );
};

/** Parse a stored book; invalid rows are dropped, never repaired (exported for tests). */
export function parsePaperBook(raw: string | null): PaperTicket[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter(isTicket) : [];
  } catch {
    return [];
  }
}

export function loadPaper(): PaperTicket[] {
  return parsePaperBook(store()?.getItem(PM_PAPER_KEY) ?? null);
}

function save(rows: PaperTicket[]): boolean {
  const s = store();
  if (!s) return false;
  try {
    s.setItem(PM_PAPER_KEY, JSON.stringify(rows.slice(-PM_PAPER_MAX)));
    window.dispatchEvent(new Event(EVT));
    return true;
  } catch {
    return false;
  }
}

/** Add one ticket (pure merge; same id = same snapshot → not added twice). */
export function withTicket(book: PaperTicket[], t: PaperTicket): { book: PaperTicket[]; added: boolean } {
  if (book.some((x) => x.id === t.id)) return { book, added: false };
  return { book: [...book, t], added: true };
}

export function addPaper(t: PaperTicket): { ok: boolean; why: string } {
  const { book, added } = withTicket(loadPaper(), t);
  if (!added) return { ok: false, why: "Already on paper for this snapshot — wait for the next read." };
  return save(book) ? { ok: true, why: "" } : { ok: false, why: "This browser blocked local storage — ticket not saved." };
}

/** Settle tickets from a REAL settled-market read (outcome 1 = YES). Not wired yet — see header. */
export function resolvePaper(marketId: string, outcome: 0 | 1, resolvedAt: string): number {
  let n = 0;
  const book = loadPaper().map((t) => {
    if (t.marketId !== marketId || t.outcome === 0 || t.outcome === 1) return t;
    n++;
    return { ...t, outcome, resolvedAt };
  });
  if (n) save(book);
  return n;
}

export function removePaper(id: string): void {
  save(loadPaper().filter((t) => t.id !== id));
}

export function subscribePaper(fn: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key === PM_PAPER_KEY) fn();
  };
  window.addEventListener(EVT, fn);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(EVT, fn);
    window.removeEventListener("storage", onStorage);
  };
}
