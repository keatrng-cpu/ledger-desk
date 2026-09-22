/**
 * The resting limit — deciding once, at the price you already computed.
 *
 * WHY
 * The desk's measured edge is not a signal, it is a price. Over 387 refusals
 * on the same tape, a limit resting at consequent encroachment returned
 * +0.35R per card while paying the print returned +0.007R. The plan already
 * carries that price on every poll; what was missing was a way to commit to
 * it and walk away. A trader watching for the touch will take the print —
 * that is what the chase leg measures, and it is worth fifty times less.
 *
 * So: one click at 10:05 rests an order at CE. The poll loop checks it
 * against every live print. If price arrives, the paper book opens at the
 * limit — the honest fill, because that is where the order was. If it does
 * not arrive within the fill window it expires and says so.
 *
 * WHAT IT WILL NOT DO
 * It never fills at a price that did not print. It never re-enters after an
 * expiry. It never survives the session, a side change, or a new plan at a
 * different price — those are different trades and they get a new decision.
 * And it books into the PAPER book only; nothing here reaches a broker.
 *
 * Fill mechanics mirror the shadow book exactly (shadow-book.ts), so the
 * live fills and the measured evidence stay the same kind of number:
 * FILL_WINDOW_BARS on 15m, fill on touch, no fill invented.
 */

import type { TradePlan } from "./trade-plan";
import { FILL_WINDOW_BARS } from "./shadow-book";
import { etWallParts } from "./sessions";

const KEY = "ledger.pending-order.v1";
const EVENT = "ledger-pending-order";
/** 15m bars × the shadow book's window — three hours, then it is stale. */
export const PENDING_TTL_MS = FILL_WINDOW_BARS * 15 * 60_000;
/** Flat at the cash close whatever the clock says. */
const FLAT_ET_MIN = 16 * 60;

export interface PendingOrder {
  id: string;
  symbol: string;
  side: "long" | "short";
  /** The limit price — consequent encroachment of the entry array. */
  limit: number;
  stop: number;
  t1: number | null;
  t2: number | null;
  riskPts: number;
  grade: string;
  strategy: string;
  /** The array the limit sits in, for the display and the expiry copy. */
  zone: { top: number; bottom: number } | null;
  restedAt: number;
  expiresAt: number;
  /** Set when the touch happens; the paper open is booked by the caller. */
  filledAt?: number;
  fillPrice?: number;
  status: "resting" | "filled" | "expired" | "cancelled";
  /** Why it ended, for the journal line. */
  note?: string;
}

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(EVENT));
}

export function loadPending(): PendingOrder[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const rows = JSON.parse(raw) as PendingOrder[];
    return Array.isArray(rows) ? rows.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function save(rows: PendingOrder[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(rows.slice(0, 20)));
  } catch {
    /* quota */
  }
  emit();
}

export function subscribePending(fn: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener(EVENT, fn);
  return () => window.removeEventListener(EVENT, fn);
}

/** The live resting order for a symbol, if any. One at a time, per book. */
export function restingFor(symbol: string): PendingOrder | null {
  return loadPending().find((o) => o.symbol === symbol && o.status === "resting") ?? null;
}

/**
 * Rest a limit at the plan's CE. Replaces any resting order on the same
 * book — a new plan at a new price is a new decision, not a second ticket.
 */
export function restLimit(
  plan: TradePlan,
  opts: { grade: string; strategy: string; now: number },
): PendingOrder {
  const rows = loadPending().filter((o) => !(o.symbol === plan.symbol && o.status === "resting"));
  const order: PendingOrder = {
    id: `pending-${plan.symbol}-${plan.side}-${plan.entry.toFixed(2)}-${opts.now}`,
    symbol: plan.symbol,
    side: plan.side,
    limit: plan.entry,
    stop: plan.stop,
    t1: plan.t1,
    t2: plan.t2,
    riskPts: plan.riskPts,
    grade: opts.grade,
    strategy: opts.strategy,
    zone: plan.entryZone,
    restedAt: opts.now,
    expiresAt: opts.now + PENDING_TTL_MS,
    status: "resting",
  };
  save([order, ...rows]);
  return order;
}

export function cancelPending(id: string, note = "cancelled by hand"): void {
  save(loadPending().map((o) => (o.id === id ? { ...o, status: "cancelled", note } : o)));
}

export interface PendingTick {
  /** Orders that just filled on this print — the caller books the paper open. */
  filled: PendingOrder[];
  /** Orders that just expired. */
  expired: PendingOrder[];
}

/**
 * Check every resting order against a live print. Pure except for the store.
 *
 * A long's limit sits BELOW price and fills when the print reaches down to
 * it; a short's sits above. The fill price is the limit, never the print —
 * an order resting at 24180.25 does not fill at 24179.00 just because the
 * tape traded there, and it certainly does not fill at a worse price.
 */
export function tickPending(prices: Record<string, number>, now: number): PendingTick {
  const rows = loadPending();
  if (!rows.length) return { filled: [], expired: [] };
  const p = etWallParts(now);
  const pastClose = p.hour * 60 + p.minute >= FLAT_ET_MIN;
  const filled: PendingOrder[] = [];
  const expired: PendingOrder[] = [];

  const next = rows.map((o) => {
    if (o.status !== "resting") return o;
    const price = prices[o.symbol];
    if (price != null && Number.isFinite(price) && price > 0) {
      const touched = o.side === "long" ? price <= o.limit : price >= o.limit;
      if (touched) {
        const hit: PendingOrder = { ...o, status: "filled", filledAt: now, fillPrice: o.limit };
        filled.push(hit);
        return hit;
      }
    }
    if (now >= o.expiresAt || pastClose) {
      const dead: PendingOrder = {
        ...o,
        status: "expired",
        note: pastClose
          ? "session closed — never filled"
          : `price never came back to ${o.limit.toFixed(2)} inside ${FILL_WINDOW_BARS} bars`,
      };
      expired.push(dead);
      return dead;
    }
    return o;
  });

  if (filled.length || expired.length) save(next);
  return { filled, expired };
}

/** How long a resting order has left, for the countdown on the card. */
export function pendingLeftMin(o: PendingOrder, now: number): number {
  return Math.max(0, Math.round((o.expiresAt - now) / 60_000));
}
