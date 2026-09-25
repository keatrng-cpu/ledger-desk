/**
 * The resting limit — deciding once, at the price you already computed.
 *
 * WHY
 * The desk already computes the price; what was missing was a way to commit
 * to it and walk away. A trader watching for a touch takes the print instead,
 * and the print is not the plan.
 *
 * This file does NOT rest on a measured entry edge. The "+0.35R resting vs
 * +0.007R chasing" figure that first motivated it is pooled across killzones,
 * and splitting it on 1m bars showed the whole of it sits in London: in NY AM
 * the refused cards lose either way (−0.181R/card resting, −0.040R chasing,
 * n=53). The argument for a resting order is simpler and does not need a
 * statistic — it is the price the plan named, decided while calm, executed
 * without a second decision.
 *
 * So: one click at 10:05 rests an order at CE. The poll loop checks it
 * against every live print. If price arrives, the paper book opens at the
 * limit — the honest fill, because that is where the order was. If it does
 * not arrive within the fill window it expires and says so.
 *
 * TWO THINGS THIS FILE LEARNED THE HARD WAY
 *
 * 1. A PRINT WITHOUT AN AGE IS NOT A TOUCH. Until 2026-09-23 `tickPending`
 *    took a bare map of prices with no `lagSec`, and the desk shell fed it
 *    `desk.quotes.*.price` — which on a Yahoo-only feed is ~600 seconds old.
 *    A ten-minute-old print "reaching" the limit says the tape was there ten
 *    minutes ago, not that the order can fill now, so the module written to
 *    stop late entries was itself booking the latest entry on the desk. Every
 *    other fill path here is lag-gated (`paper-manager.ts` on entry and on
 *    exit, against QUOTE_EXECUTION_MAX_LAG_SEC); this one now is too, and an
 *    absent age is refused rather than assumed fresh — unknown is not a fact.
 *
 * 2. THE TICKET IS NOT SPENT UNTIL THE TRADE EXISTS. The same version marked
 *    an order `filled` inside the tick and only then handed it to
 *    `openPaperTradeInstant`, which has its own gates — lag, Judas, news,
 *    one-book, grade. When one of those refused, the order had already been
 *    consumed with no way back: a fill written to localStorage that no paper
 *    trade corresponds to. So a touch now moves the order to `touched`, an
 *    intermediate state, and only `confirmPendingFill` — called after the
 *    paper open actually returned ok — makes it `filled`. Anything else
 *    (`releasePending`, or a caller that dies before either) puts it back to
 *    resting, because an order that was never traded is still an order.
 *
 * WHAT IT WILL NOT DO
 * It never fills at a price that did not print. It never fills from a print
 * it cannot date. It never re-enters after an expiry. It never survives the
 * session, a side change, or a new plan at a different price — those are
 * different trades and they get a new decision. And it books into the PAPER
 * book only; nothing here reaches a broker.
 *
 * Fill mechanics mirror the shadow book exactly (shadow-book.ts), so the
 * live fills and the measured evidence stay the same kind of number:
 * FILL_WINDOW_BARS on 15m, fill on touch, no fill invented.
 */

import type { TradePlan } from "./trade-plan";
import { FILL_WINDOW_BARS } from "./shadow-book";
import { etWallParts } from "./sessions";
import { QUOTE_EXECUTION_MAX_LAG_SEC } from "@/lib/market/types";

const KEY = "ledger.pending-order.v1";
const EVENT = "ledger-pending-order";
/** 15m bars × the shadow book's window — three hours, then it is stale. */
export const PENDING_TTL_MS = FILL_WINDOW_BARS * 15 * 60_000;
/** Flat at the cash close whatever the clock says. */
const FLAT_ET_MIN = 16 * 60;
/**
 * How long a touch may sit unanswered before the ticket goes back to resting.
 * The caller confirms or releases synchronously on the same poll, so this
 * window only ever fires when the tab died between the two — and the honest
 * reading of that is that no trade was opened.
 */
const TOUCH_CONFIRM_MS = 60_000;
/**
 * After a released touch, ignore the same limit for a minute. Price often
 * sits through the level for many polls, and without this the desk would
 * re-offer, re-refuse and re-toast the same rejected fill every two seconds.
 * It delays a retry; it does not forgive anything.
 */
const RELEASE_COOLDOWN_MS = 60_000;

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
  /** When the tape reached the limit on a print fresh enough to act on. */
  touchedAt?: number;
  /** The print that reached it, and that print's age — the fill's audit trail. */
  touchPrice?: number;
  touchLagSec?: number;
  /** Discretion size factor at the moment of the decision, applied at the fill. */
  discretionMult?: number;
  /** Set by `confirmPendingFill` once the paper open exists, never before. */
  filledAt?: number;
  fillPrice?: number;
  /** Touches are not evaluated before this instant. See RELEASE_COOLDOWN_MS. */
  coolUntil?: number;
  status: "resting" | "touched" | "filled" | "expired" | "cancelled";
  /** Why it ended, for the journal line. */
  note?: string;
}

/**
 * A print with its age. Both halves are required to act: the price says
 * where the tape is, `lagSec` says whether that is still true.
 */
export interface PendingPrint {
  price: number;
  /** Seconds since the print. Null/absent/NaN = unknown, which is refused. */
  lagSec: number | null;
}

/**
 * A limit the tape reached on a print too old — or too anonymous — to fill
 * against. The order is untouched and still resting; this exists so the
 * caller can say WHY nothing happened instead of showing silence.
 */
export interface StaleTouch {
  order: PendingOrder;
  price: number;
  /** Null when the caller passed no age at all. */
  lagSec: number | null;
  reason: string;
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

/**
 * A ticket that is still the trader's — resting, or touched and awaiting the
 * caller's answer. A touched order has not been traded yet, so the desk keeps
 * showing it and a new plan still replaces it.
 */
function isLive(o: PendingOrder): boolean {
  return o.status === "resting" || o.status === "touched";
}

/** The live resting order for a symbol, if any. One at a time, per book. */
export function restingFor(symbol: string): PendingOrder | null {
  return loadPending().find((o) => o.symbol === symbol && isLive(o)) ?? null;
}

/**
 * Rest a limit at the plan's CE. Replaces any live order on the same
 * book — a new plan at a new price is a new decision, not a second ticket.
 */
export function restLimit(
  plan: Pick<TradePlan, "symbol" | "side" | "entry" | "stop" | "t1" | "t2" | "riskPts" | "entryZone">,
  opts: { grade: string; strategy: string; now: number; discretionMult?: number },
): PendingOrder {
  const rows = loadPending().filter((o) => !(o.symbol === plan.symbol && isLive(o)));
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
    discretionMult: opts.discretionMult,
  };
  save([order, ...rows]);
  return order;
}

export function cancelPending(id: string, note = "cancelled by hand"): void {
  save(loadPending().map((o) => (o.id === id ? { ...o, status: "cancelled", note } : o)));
}

/**
 * The paper open returned ok — the ticket is spent, at the LIMIT price.
 *
 * Nothing else in this file writes `filled`. Returns null when the order is
 * gone or was never touched, and the caller should read that as what it is:
 * a paper trade that exists with no ticket behind it, not a reason to retry.
 */
export function confirmPendingFill(id: string, now: number): PendingOrder | null {
  const rows = loadPending();
  const found = rows.find((o) => o.id === id && o.status === "touched");
  if (!found) return null;
  const hit: PendingOrder = {
    ...found,
    status: "filled",
    filledAt: now,
    fillPrice: found.limit,
  };
  save(rows.map((o) => (o.id === id ? hit : o)));
  return hit;
}

/**
 * The paper open did not happen — a gate refused it, the card was gone, the
 * click never landed. The ticket goes back to resting with the reason on it,
 * because the decision the trader made is still valid; only this attempt
 * failed. A cooldown keeps the same rejection from firing every poll.
 */
export function releasePending(id: string, note: string, now: number): PendingOrder | null {
  const rows = loadPending();
  const found = rows.find((o) => o.id === id && o.status === "touched");
  if (!found) return null;
  const back: PendingOrder = {
    ...found,
    status: "resting",
    touchedAt: undefined,
    touchPrice: undefined,
    touchLagSec: undefined,
    coolUntil: now + RELEASE_COOLDOWN_MS,
    note,
  };
  save(rows.map((o) => (o.id === id ? back : o)));
  return back;
}

export interface PendingTick {
  /**
   * Limits the tape just reached on a print fresh enough to act on. These are
   * NOT filled — the caller books the paper open and then calls
   * `confirmPendingFill` or `releasePending`.
   */
  touched: PendingOrder[];
  /** Orders that just expired. */
  expired: PendingOrder[];
  /** Limits reached on a print too old, or with no age, to fill against. */
  stale: StaleTouch[];
  /**
   * Always empty. An order becomes `filled` only through
   * `confirmPendingFill`, which is the whole point of the intermediate state.
   * The field exists so the desk shell keeps type-checking until it is moved
   * onto `touched`; delete it once it is.
   */
  filled: PendingOrder[];
}

/**
 * Read one symbol's entry from the price map.
 *
 * A bare number is accepted only so the un-updated call site still type-
 * checks, and it carries no age — so it can never fill. That is the
 * conservative failure: a dormant resting order, not an invented one.
 */
function readPrint(
  v: PendingPrint | number | undefined | null,
): { price: number; lagSec: number | null } | null {
  if (v == null) return null;
  if (typeof v === "number") {
    return Number.isFinite(v) && v > 0 ? { price: v, lagSec: null } : null;
  }
  const price = v.price;
  if (!Number.isFinite(price) || price <= 0) return null;
  const lagSec = v.lagSec != null && Number.isFinite(v.lagSec) ? v.lagSec : null;
  return { price, lagSec };
}

/**
 * Check every live order against a print. Pure except for the store.
 *
 * A long's limit sits BELOW price and fills when the print reaches down to
 * it; a short's sits above. The fill price is the limit, never the print —
 * an order resting at 24180.25 does not fill at 24179.00 just because the
 * tape traded there, and it certainly does not fill at a worse price.
 *
 * The touch itself is only believed on a print younger than
 * QUOTE_EXECUTION_MAX_LAG_SEC. An older one is reported on `stale` and the
 * order keeps resting: a ten-minute-old quote at the limit is a statement
 * about ten minutes ago, and filling on it is exactly the late entry this
 * module exists to refuse. A print dated slightly in the future (clock skew
 * between the feed's stamp and the browser) is fresh and passes; only age
 * past the budget, or no age at all, is refused.
 */
export function tickPending(
  prices: Record<string, PendingPrint | number>,
  now: number,
): PendingTick {
  const rows = loadPending();
  if (!rows.length) return { touched: [], expired: [], stale: [], filled: [] };
  const p = etWallParts(now);
  const pastClose = p.hour * 60 + p.minute >= FLAT_ET_MIN;
  const touched: PendingOrder[] = [];
  const expired: PendingOrder[] = [];
  const stale: StaleTouch[] = [];
  let changed = false;

  const next = rows.map((o) => {
    // A touch nobody answered means the caller died between the paper open
    // and the confirm. The book is the record of what was traded; this
    // ledger only ever holds a ticket, so the ticket goes back on the desk.
    if (o.status === "touched") {
      if (o.touchedAt != null && now - o.touchedAt > TOUCH_CONFIRM_MS) {
        changed = true;
        const back: PendingOrder = {
          ...o,
          status: "resting",
          touchedAt: undefined,
          touchPrice: undefined,
          touchLagSec: undefined,
          coolUntil: now + RELEASE_COOLDOWN_MS,
          note: "touch went unanswered — no paper open was confirmed, still resting",
        };
        return back;
      }
      return o;
    }
    if (o.status !== "resting") return o;

    const print = readPrint(prices[o.symbol]);
    const cooling = o.coolUntil != null && now < o.coolUntil;
    if (print && !cooling) {
      const reached = o.side === "long" ? print.price <= o.limit : print.price >= o.limit;
      if (reached && print.lagSec == null) {
        stale.push({
          order: o,
          price: print.price,
          lagSec: null,
          reason: `${o.symbol} reached ${o.limit.toFixed(2)} on a print with no age — unknown is not fresh, so nothing filled.`,
        });
      } else if (reached && print.lagSec != null && print.lagSec > QUOTE_EXECUTION_MAX_LAG_SEC) {
        stale.push({
          order: o,
          price: print.price,
          lagSec: print.lagSec,
          reason: `${o.symbol} reached ${o.limit.toFixed(2)} on a print ${Math.round(print.lagSec)}s old (> ${QUOTE_EXECUTION_MAX_LAG_SEC}s) — that is where the tape was, not where it is. Still resting.`,
        });
      } else if (reached) {
        changed = true;
        const hit: PendingOrder = {
          ...o,
          status: "touched",
          touchedAt: now,
          touchPrice: print.price,
          touchLagSec: print.lagSec ?? undefined,
        };
        touched.push(hit);
        return hit;
      }
    }

    if (now >= o.expiresAt || pastClose) {
      changed = true;
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

  if (changed) save(next);
  return { touched, expired, stale, filled: [] };
}

/** How long a resting order has left, for the countdown on the card. */
export function pendingLeftMin(o: PendingOrder, now: number): number {
  return Math.max(0, Math.round((o.expiresAt - now) / 60_000));
}
