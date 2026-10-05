/**
 * The trading floor's own paper book — QQQ/SPY 0–1 DTE contracts.
 *
 * SEPARATE from the $100k futures paper book and from the trader's real RH
 * fills (rh-income.ts): the room's executions must not move the desk's stats,
 * the shadow book, or the A+ unlock. It lives in this browser only
 * (localStorage), like the RH sleeve settings.
 *
 * FILL MODEL — the same prices the floor quoted, never better
 *   BUY_OPEN    at the model ASK (mid + the desk's crossing cost)
 *   SELL_CLOSE  at the model BID (mid − the same)
 *   marks       on the BID, because the stop fires on what can be sold
 *   expiry      a contract still held past its 16:00 ET bell (the tab was
 *               shut) settles at intrinsic on the first print after it, and
 *               the close says so.
 *
 * WHY $10,000 OF STARTING CASH
 * The mandate caps a ticket at 10% of cash and the desk caps one at a $1,000
 * debit. At $10,000 the two caps are the same number, so neither silently
 * overrides the other on day one. The trader can reset to any amount.
 */

import { etMonthKey, etWeekKey } from "@/lib/trading/rh-income";
import { asLab, labWatchList, stepLab, type RoomLab } from "./lab";
import { expiryMs, etDateOf, ivFor, quoteOption, type OptionType, type StrikeOffset, type Underlier } from "./option-math";
import { planKey, type RoomCycle, type RoomDeskRead, type RoomInput, type RoomLedger, type UnderlierTape } from "./orchestrator";
import { attribute, type Attribution } from "./quant";
import type { ExitWatch } from "./desk-read";

export const ROOM_BOOK_STORAGE = "ledger-room-book-v1";
export const ROOM_DRILL_STORAGE = "ledger-room-drill-v1";
export const ROOM_DEFAULT_CASH = 10_000;
const KEEP_CLOSED = 200;
const KEEP_EVENTS = 60;

export interface RoomFut {
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  t1: number | null;
  t2: number | null;
}

export interface RoomBookPosition {
  id: string;
  ticker: Underlier;
  type: OptionType;
  strike: number;
  exp: string;
  offset: StrikeOffset;
  contracts: number;
  /** Per share, the ask paid. */
  entryPx: number;
  openedAt: number;
  card: string;
  band: string | null;
  fut: RoomFut | null;
  trimmed: boolean;
  /** Dollars already banked by a trim. */
  realizedUsd: number;
  mark: { bid: number; mid: number; delta: number; at: number } | null;
  /** On the bid, vs the ask paid. */
  pnlPct: number;
  /** What the desk priced the plan at on the fill — the theta stop and the ghost room read it. */
  quant?: { pT1: number; atr: number | null; t1Atr: number | null; evUsd: number | null; pWindow: number | null } | null;
  /** The ETF print and IV at the fill — the P&L attribution's starting point. */
  spot0?: number;
  iv0?: number;
}

export interface RoomClosedTrade {
  id: string;
  ticker: Underlier;
  type: OptionType;
  strike: number;
  exp: string;
  contracts: number;
  entryPx: number;
  exitPx: number;
  pnlUsd: number;
  reason: string;
  openedAt: number;
  closedAt: number;
  /** Where the money came from: spot move, IV, the clock, the crossings (quant.ts attribute). */
  attrib?: Attribution | null;
}

export interface RoomEvent {
  at: number;
  kind: "fill" | "exit" | "trim" | "settle" | "reset";
  text: string;
}

export interface RoomBook {
  version: 1;
  startCash: number;
  cash: number;
  seq: number;
  positions: RoomBookPosition[];
  closed: RoomClosedTrade[];
  events: RoomEvent[];
  counters: {
    dayKey: string;
    dayStartEquity: number;
    realizedToday: number;
    weekKey: string;
    weekStartEquity: number;
    realizedWeek: number;
    monthKey: string;
    monthEntries: number;
    kzKey: string;
    kzEntries: number;
    underlierDay: { day: string; underlier: Underlier } | null;
    consecLosses: number;
    /** planKey of every plan bought today — one plan, one fill. */
    filledPlans: string[];
  };
  /** The ghost room and the plan ledger (lab.ts). Absent on books saved before it existed. */
  lab?: RoomLab;
}

export function emptyBook(cash = ROOM_DEFAULT_CASH, nowMs = Date.now()): RoomBook {
  return {
    version: 1,
    startCash: cash,
    cash,
    seq: 0,
    positions: [],
    closed: [],
    events: [{ at: nowMs, kind: "reset", text: `Book opened with $${cash.toLocaleString()} paper cash.` }],
    counters: {
      dayKey: "",
      dayStartEquity: cash,
      realizedToday: 0,
      weekKey: "",
      weekStartEquity: cash,
      realizedWeek: 0,
      monthKey: "",
      monthEntries: 0,
      kzKey: "",
      kzEntries: 0,
      underlierDay: null,
      consecLosses: 0,
      filledPlans: [],
    },
  };
}

export function loadRoomBook(key = ROOM_BOOK_STORAGE): RoomBook {
  try {
    if (typeof window === "undefined") return emptyBook();
    const raw = window.localStorage.getItem(key);
    if (!raw) return emptyBook();
    const b = JSON.parse(raw) as RoomBook;
    return b?.version === 1 && Array.isArray(b.positions) ? b : emptyBook();
  } catch {
    return emptyBook();
  }
}

export function saveRoomBook(book: RoomBook, key = ROOM_BOOK_STORAGE): void {
  try {
    if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(book));
  } catch {
    // Private window / storage full: the book still runs for this tab.
  }
}

const money = (n: number) => Math.round(n * 100) / 100;

export function equityOf(book: RoomBook): number {
  return money(book.cash + book.positions.reduce((s, p) => s + (p.mark?.bid ?? p.entryPx) * 100 * p.contracts, 0));
}

/** Day, week, month and killzone counters roll on their own keys. */
export function rollCounters(book: RoomBook, nowMs: number, killzone: string): RoomBook {
  const c = { ...book.counters };
  const day = etDateOf(nowMs);
  const week = etWeekKey(new Date(nowMs));
  const month = etMonthKey(new Date(nowMs));
  const eq = equityOf(book);
  if (c.dayKey !== day) Object.assign(c, { dayKey: day, dayStartEquity: eq, realizedToday: 0, filledPlans: [] });
  if (!Array.isArray(c.filledPlans)) c.filledPlans = [];
  if (c.weekKey !== week) Object.assign(c, { weekKey: week, weekStartEquity: eq, realizedWeek: 0 });
  if (c.monthKey !== month) Object.assign(c, { monthKey: month, monthEntries: 0 });
  const kz = `${day}:${killzone}`;
  if (c.kzKey !== kz) Object.assign(c, { kzKey: kz, kzEntries: 0 });
  if (c.underlierDay && c.underlierDay.day !== day) c.underlierDay = null;
  return { ...book, counters: c };
}

function pushEvent(book: RoomBook, e: RoomEvent): RoomEvent[] {
  return [e, ...book.events].slice(0, KEEP_EVENTS);
}

function bookRealized(book: RoomBook, usd: number, fullClose: boolean, positionTotal: number): RoomBook["counters"] {
  const c = { ...book.counters };
  c.realizedToday = money(c.realizedToday + usd);
  c.realizedWeek = money(c.realizedWeek + usd);
  if (fullClose) c.consecLosses = positionTotal < 0 ? c.consecLosses + 1 : 0;
  return c;
}

/** Reprice every position on the tape; settle anything past its bell. */
export function markBook(book: RoomBook, market: Record<Underlier, UnderlierTape>, nowMs: number): RoomBook {
  let next = { ...book, positions: [...book.positions] };
  const keep: RoomBookPosition[] = [];
  for (const p of next.positions) {
    const tape = market[p.ticker];
    if (nowMs >= expiryMs(p.exp)) {
      const intrinsic = p.type === "CALL" ? Math.max(0, tape.price - p.strike) : Math.max(0, p.strike - tape.price);
      const proceeds = money(intrinsic * 100 * p.contracts);
      const pnl = money(proceeds - p.entryPx * 100 * p.contracts);
      next = {
        ...next,
        cash: money(next.cash + proceeds),
        counters: bookRealized(next, pnl, true, pnl + p.realizedUsd),
        closed: [
          {
            id: p.id,
            ticker: p.ticker,
            type: p.type,
            strike: p.strike,
            exp: p.exp,
            contracts: p.contracts,
            entryPx: p.entryPx,
            exitPx: intrinsic,
            pnlUsd: pnl,
            reason: "expired — settled at intrinsic on the first print after the bell",
            openedAt: p.openedAt,
            closedAt: nowMs,
          },
          ...next.closed,
        ].slice(0, KEEP_CLOSED),
        events: pushEvent(next, {
          at: nowMs,
          kind: "settle",
          text: `${p.id} expired held — settled at $${intrinsic.toFixed(2)} intrinsic (${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)}). The room was not watching at the bell.`,
        }),
      };
      continue;
    }
    const q = quoteOption(tape.price, p.strike, p.exp, p.type, ivFor(p.ticker, tape.vix), nowMs);
    keep.push({
      ...p,
      mark: { bid: q.bid, mid: q.mid, delta: q.delta, at: nowMs },
      pnlPct: Math.round(((q.bid - p.entryPx) / p.entryPx) * 1000) / 10,
    });
  }
  return { ...next, positions: keep };
}

/** The trader's input schema, from the book and the tape. */
export function toRoomInput(book: RoomBook, market: Record<Underlier, UnderlierTape>): RoomInput {
  return {
    portfolio: {
      cash: book.cash,
      open_positions: book.positions.map((p) => ({
        id: p.id,
        ticker: p.ticker,
        type: p.type,
        strike: p.strike,
        exp: p.exp,
        pnl_percent: p.pnlPct,
        contracts: p.contracts,
        trimmed: p.trimmed,
        strike_offset: p.offset,
        entry_px: p.entryPx,
        opened_at: p.openedAt,
        spot0: p.spot0,
        iv0: p.iv0,
      })),
    },
    market_data: market,
  };
}

export function ledgerOf(book: RoomBook): RoomLedger {
  const c = book.counters;
  return {
    dayStartEquity: c.dayStartEquity,
    realizedTodayUsd: c.realizedToday,
    weekStartEquity: c.weekStartEquity,
    realizedWeekUsd: c.realizedWeek,
    entriesThisKillzone: c.kzEntries,
    underlierToday: c.underlierDay?.underlier ?? null,
    monthEntries: c.monthEntries,
    consecLosses: c.consecLosses,
    filledPlans: c.filledPlans ?? [],
  };
}

/** Everything the desk should price level exits for: the room's positions and its open ghosts. */
export function exitWatchOf(book: RoomBook): ExitWatch[] {
  const own: ExitWatch[] = book.positions.map((p) => ({
    id: p.id,
    trimmed: p.trimmed,
    openedAt: p.openedAt,
    fut: p.fut,
    quant: p.quant ? { pT1: p.quant.pT1, atr: p.quant.atr } : null,
  }));
  return [...own, ...labWatchList(asLab(book.lab))];
}

/**
 * Book the cycle's ticket. The fill is the quote the floor printed this
 * cycle — Vince's limit — so the paper book can never fill better than the
 * room said it would.
 */
export function applyCycle(book: RoomBook, cycle: RoomCycle, nowMs: number): RoomBook {
  const b = cycle.output.broker_action;
  if (!b.execute_trade) return book;

  if (b.action_type === "BUY_OPEN" && cycle.trace.entry) {
    const e = cycle.trace.entry;
    const seq = book.seq + 1;
    const id = `${e.entry.underlier}-${e.quote.strike}${e.entry.type === "CALL" ? "C" : "P"}-${seq}`;
    const debit = money(e.qty * e.quote.ask * 100);
    const plan = e.entry.plan;
    const pos: RoomBookPosition = {
      id,
      ticker: e.entry.underlier,
      type: e.entry.type,
      strike: e.quote.strike,
      exp: e.exp,
      offset: e.offset,
      contracts: e.qty,
      entryPx: e.quote.ask,
      openedAt: nowMs,
      card: e.entry.card,
      band: e.entry.band,
      fut: plan
        ? { symbol: e.entry.futSymbol, side: e.entry.futSide, entry: plan.entry, stop: plan.stop, t1: plan.t1, t2: plan.t2 }
        : null,
      trimmed: false,
      realizedUsd: 0,
      mark: { bid: e.quote.bid, mid: e.quote.mid, delta: e.quote.delta, at: nowMs },
      pnlPct: Math.round(((e.quote.bid - e.quote.ask) / e.quote.ask) * 1000) / 10,
      quant:
        e.entry.pT1 != null
          ? { pT1: e.entry.pT1, atr: e.entry.atr ?? null, t1Atr: e.t1Atr, evUsd: e.ev?.evUsd ?? null, pWindow: e.ev?.window.pT1 ?? null }
          : null,
      spot0: e.spot,
      iv0: e.quote.iv,
    };
    const c = { ...book.counters };
    c.kzEntries += 1;
    c.monthEntries += 1;
    c.filledPlans = [...(c.filledPlans ?? []), planKey(e.entry)];
    if (!c.underlierDay) c.underlierDay = { day: c.dayKey || etDateOf(nowMs), underlier: e.entry.underlier };
    return {
      ...book,
      seq,
      cash: money(book.cash - debit),
      positions: [...book.positions, pos],
      counters: c,
      events: pushEvent(book, {
        at: nowMs,
        kind: "fill",
        text: `BOUGHT ${e.qty}× ${id} @ $${e.quote.ask.toFixed(2)} — $${debit.toFixed(0)} debit (${e.entry.name}, PATH ${e.entry.band ?? "—"}).`,
      }),
    };
  }

  if (b.action_type === "SELL_CLOSE" && cycle.trace.exit) {
    const x = cycle.trace.exit;
    const p = book.positions.find((q) => q.id === b.target_position_id);
    if (!p) return book;
    const px = x.quote?.bid ?? p.mark?.bid ?? 0;
    const qty = b.contracts_quantity > 0 ? Math.min(b.contracts_quantity, p.contracts) : p.contracts;
    const proceeds = money(qty * px * 100);
    const pnl = money(proceeds - qty * p.entryPx * 100);
    const full = qty >= p.contracts;
    const closedRow: RoomClosedTrade = {
      id: p.id,
      ticker: p.ticker,
      type: p.type,
      strike: p.strike,
      exp: p.exp,
      contracts: qty,
      entryPx: p.entryPx,
      exitPx: px,
      pnlUsd: pnl,
      reason: `${x.reason.replace("_", " ")} — ${x.why}`,
      openedAt: p.openedAt,
      closedAt: nowMs,
      attrib:
        p.spot0 != null && p.iv0 != null && x.spot != null && x.quote
          ? attribute({
              type: p.type,
              strike: p.strike,
              exp: p.exp,
              contracts: qty,
              spot0: p.spot0,
              iv0: p.iv0,
              t0Ms: p.openedAt,
              spot1: x.spot,
              iv1: x.quote.iv,
              t1Ms: nowMs,
              entryPx: p.entryPx,
              exitPx: px,
            })
          : null,
    };
    const positions = full
      ? book.positions.filter((q) => q.id !== p.id)
      : book.positions.map((q) =>
          q.id === p.id ? { ...q, contracts: q.contracts - qty, trimmed: true, realizedUsd: money(q.realizedUsd + pnl) } : q,
        );
    return {
      ...book,
      cash: money(book.cash + proceeds),
      positions,
      counters: bookRealized(book, pnl, full, pnl + p.realizedUsd),
      closed: [closedRow, ...book.closed].slice(0, KEEP_CLOSED),
      events: pushEvent(book, {
        at: nowMs,
        kind: full ? "exit" : "trim",
        text: `${full ? "SOLD" : "TRIMMED"} ${qty}× ${p.id} @ $${px.toFixed(2)} — ${pnl >= 0 ? "+" : "−"}$${Math.abs(pnl).toFixed(0)} (${x.reason.replace("_", " ")}).${full ? "" : " Runner's stop → breakeven."}`,
      }),
    };
  }
  return book;
}

/**
 * The ghost room's step, after the room's own ticket is booked: ghosts mark
 * and exit on the same prints, new ones open, the plan ledger follows its
 * plans. Never moves the room's cash or counters.
 */
export function applyLab(
  book: RoomBook,
  cycle: RoomCycle,
  market: Record<Underlier, UnderlierTape>,
  desk: RoomDeskRead | null,
  nowMs: number,
): RoomBook {
  const opened =
    cycle.output.broker_action.action_type === "BUY_OPEN" ? (book.positions.filter((p) => p.openedAt === nowMs).at(-1)?.id ?? null) : null;
  return { ...book, lab: stepLab(asLab(book.lab), { cycle, market, desk, nowMs, roomFillId: opened }) };
}
