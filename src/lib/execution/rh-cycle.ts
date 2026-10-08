/**
 * One Robinhood cycle: look, place, manage, trim, close.
 *
 * The desk's own quote poll calls this. There is no second timer. It does not
 * call Robinhood and it does not ask. It returns the order the sender puts
 * through review_option_order and then place_option_order on Agentic
 * 995386158, or the reason it is still looking.
 *
 * A position this desk did not open is left alone and blocks a new open.
 * The resting entry stays the proposal's. Nothing here changes a gate.
 *
 * What ends a position, in the order it is read:
 *   1. a forced close (flatten, kill, the drawdown breaker)
 *   2. 15:30 ET — every contract, 0 DTE and 1 DTE alike (see RH_FLATTEN_MIN)
 *   3. the book is the wrong side of the armed bias
 *   4. a 15m CLOSE beyond the raid wick — the invalidation
 *   5. the hard stop, on the futures mark
 *   6. a 15m close that failed the hold (half the entry→stop distance)
 *   7. breakeven on the runner, but only after the partial has sold
 *   8. the premium backstop, and only where structure cannot be read
 * and before "manage": the partial at the first internal draw.
 */
import { RH_PREFERRED_ACCOUNT_NUMBER } from "./manager-account";
import type { RhAutofireProposal } from "./rh-autofire";
import { etWallParts } from "../trading/sessions";

/**
 * The premium backstop. NOT the plan: an option can print −25% on a wick the
 * futures never closed through, and that wick is not the invalidation. This
 * fires only where structure cannot be read at all — no futures mark, or no
 * level on the card (see `premiumBackstop`).
 */
export const RH_DISASTER_PCT = 0.25;
/**
 * Half off at the first draw. 50% at T1 → stop to BE → runner to T2 is the
 * desk's measured scale (+0.50R/t on 122 filled plans, CLAUDE.md Scale row).
 * One contract cannot be halved, so one contract does not trim and does not
 * get the breakeven stop — the rest-stop moves only after a partial has sold.
 */
export const RH_TRIM_FRAC = 0.5;
export const RH_DAY_FLAT_MIN = 11 * 60;
export const RH_FLATTEN_MIN = 15 * 60 + 30;
/**
 * NOT WIRED, and deliberately so. The room's own mandate trims at 11:00; this
 * desk's standing rule is full size through 11:00 and no flatten at 11:00, so
 * nothing in `decideRhCycle` reads either of these two constants. They are
 * kept because `RH_DAY_FLAT_MIN` is the clock the handoff and the verifier
 * quote. Do not re-wire one without the trader's number.
 */
export const RH_PAST_ELEVEN_MIN_PCT = 0.5;
const CLOSE_SLIP = 0.05;

export type RhPhase = "look" | "place" | "manage" | "close";

export interface RhHeld {
  optionId: string;
  underlier: "QQQ" | "SPY";
  optionType: "call" | "put";
  quantity: number;
  /** Premium paid, per share. */
  avgDebit: number;
  /** Live bid, per share. Missing → a limit close cannot be priced. */
  bid: number | null;
  /** Futures mark. Missing → the level stop cannot fire. */
  mark: number | null;
  entry: number | null;
  stop: number | null;
  side: "long" | "short";
  /** A 15m close beyond entry by half the entry-to-stop distance. Unknown is false. */
  failedHold: boolean;
  /** This desk opened it. */
  deskOwned: boolean;
  decisionKey: string;
  /**
   * The first internal draw — T1 on the futures plan. Missing → nothing can be
   * scaled out, so the whole position rides the level.
   */
  t1?: number | null;
  /**
   * The last CLOSED 15m futures close. Missing → the close-through-the-wick
   * exit cannot fire, and the premium backstop is the only read left.
   */
  close15?: number | null;
  /**
   * What this desk opened. Missing → the live quantity, i.e. nothing has come
   * off yet. This is how the cycle knows the partial already sold.
   */
  openedQuantity?: number | null;
  /** Set when the caller knows a partial sold. Otherwise read off openedQuantity. */
  trimmed?: boolean;
}

export interface RhOrder {
  account_number: typeof RH_PREFERRED_ACCOUNT_NUMBER;
  legs: {
    option_id: string;
    side: "buy" | "sell";
    position_effect: "open" | "close";
    ratio_quantity: 1;
  }[];
  type: "limit" | "market";
  quantity: string;
  price?: string;
  time_in_force: "gfd";
  market_hours: "regular_hours";
  chain_symbol: "QQQ" | "SPY";
  underlying_type: "equity";
  /** The sender mints one UUID per refKey and resends that UUID on a retry. */
  refKey: string;
}

export interface RhCycle {
  phase: RhPhase;
  reason: string;
  order: RhOrder | null;
  /** True when the order sells PART of the position. The rest stays on. */
  partial?: boolean;
}

export function etMinOf(nowMs: number): number {
  const w = etWallParts(nowMs);
  return w.hour * 60 + w.minute;
}

/** True when a 15m close has gone through entry by half the stop distance. A wick is not a close. */
export function failedHoldClose(args: {
  side: "long" | "short";
  entry: number | null;
  stop: number | null;
  close: number | null;
}): boolean {
  const { side, entry, stop, close } = args;
  if (entry == null || stop == null || close == null) return false;
  if (![entry, stop, close].every((n) => Number.isFinite(n))) return false;
  const dist = Math.abs(entry - stop);
  if (!(dist > 0)) return false;
  const past = dist / 2;
  return side === "long" ? close < entry - past : close > entry + past;
}

/**
 * The invalidation: a CLOSED 15m bar strictly beyond the raid wick. A mark
 * inside the wick is not this — that is what the hard stop is for, and a wick
 * that never closed through the raid never invalidated anything.
 */
export function closedThroughStop(args: {
  side: "long" | "short";
  stop: number | null;
  close: number | null;
}): boolean {
  const { side, stop, close } = args;
  if (stop == null || close == null) return false;
  if (!Number.isFinite(stop) || !Number.isFinite(close)) return false;
  return side === "long" ? close < stop : close > stop;
}

/** The first internal draw, reached on the futures mark. */
export function drawReached(args: {
  side: "long" | "short";
  t1: number | null | undefined;
  mark: number | null;
}): boolean {
  const { side, mark } = args;
  const t1 = args.t1;
  if (t1 == null || mark == null) return false;
  if (!Number.isFinite(t1) || !Number.isFinite(mark)) return false;
  return side === "long" ? mark >= t1 : mark <= t1;
}

/** Half, rounded down. 0 means the position cannot be halved. */
export function trimQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 0;
  const q = Math.floor(quantity);
  if (q < 2) return 0;
  return Math.max(1, Math.min(q - 1, Math.floor(q * RH_TRIM_FRAC)));
}

/** True once part of what this desk opened has come off. */
export function partialDone(held: RhHeld): boolean {
  if (held.trimmed === true) return true;
  const opened = held.openedQuantity;
  if (opened == null || !Number.isFinite(opened)) return false;
  return Math.floor(held.quantity) < Math.floor(opened);
}

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function closeOrder(
  held: RhHeld,
  type: "limit" | "market",
  price: string | undefined,
  quantity: number,
  refKey: string,
): RhOrder {
  const order: RhOrder = {
    account_number: RH_PREFERRED_ACCOUNT_NUMBER,
    legs: [{ option_id: held.optionId, side: "sell", position_effect: "close", ratio_quantity: 1 }],
    type,
    quantity: String(Math.max(1, Math.floor(quantity))),
    time_in_force: "gfd",
    market_hours: "regular_hours",
    chain_symbol: held.underlier,
    underlying_type: "equity",
    refKey,
  };
  if (type === "limit" && price) order.price = price;
  return order;
}

/** Sell `quantity` contracts. The refKey differs per leg so the sender mints its own UUID. */
function sellOf(held: RhHeld, why: string, quantity: number, partial: boolean): RhCycle {
  const refKey = `${partial ? "trim" : "close"}:${held.decisionKey}`;
  const bid = held.bid;
  if (bid != null && Number.isFinite(bid) && bid > 0) {
    const price = money(Math.max(0.01, bid - CLOSE_SLIP));
    return { phase: "close", reason: why, order: closeOrder(held, "limit", price, quantity, refKey), partial };
  }
  return {
    phase: "close",
    reason: `${why} No bid, so the close is a market.`,
    order: closeOrder(held, "market", undefined, quantity, refKey),
    partial,
  };
}

function closeOf(held: RhHeld, why: string): RhCycle {
  return sellOf(held, why, held.quantity, false);
}

function premiumPct(held: RhHeld): number | null {
  if (!(held.avgDebit > 0) || held.bid == null || !Number.isFinite(held.bid)) return null;
  return (held.bid - held.avgDebit) / held.avgDebit;
}

function levelHit(held: RhHeld): boolean {
  if (held.mark == null || held.stop == null) return false;
  if (!Number.isFinite(held.mark) || !Number.isFinite(held.stop)) return false;
  return held.side === "long" ? held.mark <= held.stop : held.mark >= held.stop;
}

/** The runner's stop, and only after the partial sold. A touch of entry is enough — it is a risk stop, not structure. */
function breakevenHit(held: RhHeld): boolean {
  if (held.mark == null || held.entry == null) return false;
  if (!Number.isFinite(held.mark) || !Number.isFinite(held.entry)) return false;
  return held.side === "long" ? held.mark <= held.entry : held.mark >= held.entry;
}

/**
 * Where the premium percent is allowed to decide. Structure beats it: with a
 * futures mark and a level on the card, the invalidation is the close through
 * the raid wick (and the hard stop below it), not a −25% print on a wick.
 */
function premiumBackstop(held: RhHeld): string | null {
  const pnl = premiumPct(held);
  if (pnl == null || pnl > -RH_DISASTER_PCT) return null;
  const pct = `${(pnl * 100).toFixed(0)}%`;
  if (held.mark == null || !Number.isFinite(held.mark)) {
    return `Premium is ${pct} and there is no futures mark to read. The ${Math.round(RH_DISASTER_PCT * 100)}% backstop.`;
  }
  if (held.stop == null || !Number.isFinite(held.stop)) {
    return `Premium is ${pct} and the card carries no level. The ${Math.round(RH_DISASTER_PCT * 100)}% backstop.`;
  }
  return null;
}

/** The side the desk would open right now. The proposal only carries it while it is armed. */
export function armedSideOf(
  proposal: RhAutofireProposal | null,
  explicit?: { underlier: "QQQ" | "SPY"; optionType: "call" | "put" } | null,
): { underlier: "QQQ" | "SPY"; optionType: "call" | "put" } | null {
  if (explicit && explicit.underlier && explicit.optionType) return explicit;
  const shape = proposal?.placeShape;
  if (shape && shape.underlier && shape.optionType) return { underlier: shape.underlier, optionType: shape.optionType };
  const ticket = proposal?.ticket;
  if (ticket && ticket.underlier && ticket.side) return { underlier: ticket.underlier, optionType: ticket.side };
  return null;
}

/**
 * The cycle. `proposal` is the existing live-when-armed path. A school
 * refusal is optional and only consulted when the caller passes one — the
 * school gate stays off until it is measured.
 */
export function decideRhCycle(args: {
  proposal: RhAutofireProposal | null;
  held: RhHeld | null;
  nowMs: number;
  school?: { ok: boolean; reason: string | null } | null;
  /** A desk-owned position must come off even if no other exit has printed. */
  forceClose?: string | null;
  /**
   * The direction the desk is armed for now. Omitted → read off the proposal,
   * which only carries it while the ticket is armed. A desk-owned position on
   * the other side of this is the wrong book and comes off.
   */
  armed?: { underlier: "QQQ" | "SPY"; optionType: "call" | "put" } | null;
}): RhCycle {
  const held = args.held;
  if (held && held.quantity > 0 && !held.deskOwned) {
    return { phase: "look", reason: "A position this desk did not open is already on. No new ticket, and it is not closed.", order: null };
  }
  if (held && held.quantity > 0 && held.deskOwned) {
    if (args.forceClose) return closeOf(held, args.forceClose);
    const et = etMinOf(args.nowMs);
    const trimmed = partialDone(held);
    // 15:30 takes every contract. A 1 DTE runner would be a 0 DTE overnight
    // with no stop (16:15→09:30 unmanageable) on a night 1 DTE ATM loses a
    // third of the debit — overnight-swing.ts refuses it at MIN_DTE_TOMORROW
    // = 2 and MIN_OVERNIGHT_DTE = 14. There is no DTE read here on purpose.
    if (et >= RH_FLATTEN_MIN) return closeOf(held, "15:30 ET. The day position comes off.");
    // A bias flip is a DIRECTION change. A same-direction ticket on the other
    // index is the one-book rule's business, not a reason to sell a runner, so
    // the underlier alone does not close anything here.
    const armed = armedSideOf(args.proposal, args.armed);
    if (armed && armed.optionType !== held.optionType) {
      return closeOf(
        held,
        `The desk is armed ${armed.underlier} ${armed.optionType} and this is ${held.underlier} ${held.optionType}. The bias flipped, so the old book comes off before anything new.`,
      );
    }
    if (closedThroughStop({ side: held.side, stop: held.stop, close: held.close15 ?? null })) {
      return closeOf(held, "A 15-minute candle closed beyond the raid wick. That close is the invalidation.");
    }
    if (levelHit(held)) return closeOf(held, "Price is through the futures invalidation.");
    if (held.failedHold) return closeOf(held, "A 15-minute close failed the hold.");
    if (trimmed && breakevenHit(held)) {
      return closeOf(held, "The partial is off and price came back to entry. The runner's stop is breakeven.");
    }
    const backstop = premiumBackstop(held);
    if (backstop) return closeOf(held, backstop);
    const trim = trimmed ? 0 : trimQuantity(held.quantity);
    if (trim > 0 && drawReached({ side: held.side, t1: held.t1, mark: held.mark })) {
      return sellOf(
        held,
        `Price is at the first draw. ${trim} of ${Math.floor(held.quantity)} comes off and the rest runs with its stop at entry.`,
        trim,
        true,
      );
    }
    const pnl = premiumPct(held);
    const pnlTxt = pnl == null ? "premium unread" : `${pnl >= 0 ? "+" : ""}${(pnl * 100).toFixed(0)}%`;
    const rest = trimmed
      ? "The partial is off. Entry is the stop on the rest, and a close beyond the wick takes it."
      : "The raid wick and the 15-minute close still govern. Half comes off at the first draw.";
    return { phase: "manage", reason: `Open. ${pnlTxt}. ${rest}`, order: null };
  }

  const p = args.proposal;
  if (!p) return { phase: "look", reason: "No proposal yet.", order: null };
  if (args.school && args.school.ok === false) {
    return { phase: "look", reason: args.school.reason ?? "The card's school is not satisfied.", order: null };
  }
  if (p.mode !== "live_when_armed" || !p.placeShape) {
    const reason = p.gated.ok ? p.gated.why : p.gated.reason;
    return { phase: "look", reason, order: null };
  }
  const shape = p.placeShape;
  if (!shape.optionId || shape.priceSource !== "live_quote") {
    return { phase: "look", reason: "The live option id is not on the ticket.", order: null };
  }
  return {
    phase: "place",
    reason: shape.reason,
    order: {
      account_number: RH_PREFERRED_ACCOUNT_NUMBER,
      legs: [{ option_id: shape.optionId, side: "buy", position_effect: "open", ratio_quantity: 1 }],
      type: "limit",
      quantity: String(shape.quantity),
      price: money(shape.priceHint),
      time_in_force: "gfd",
      market_hours: "regular_hours",
      chain_symbol: shape.underlier,
      underlying_type: "equity",
      refKey: `open:${shape.decisionKey}`,
    },
  };
}
