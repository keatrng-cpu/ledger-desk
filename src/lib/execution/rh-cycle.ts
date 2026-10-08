/**
 * One Robinhood cycle: look, place, manage, close.
 *
 * The desk's own quote poll calls this. There is no second timer. It does not
 * call Robinhood and it does not ask. It returns the order the sender puts
 * through review_option_order and then place_option_order on Agentic
 * 995386158, or the reason it is still looking.
 *
 * A position this desk did not open is left alone and blocks a new open.
 * The resting entry stays the proposal's. Nothing here changes a gate.
 */
import { RH_PREFERRED_ACCOUNT_NUMBER } from "./manager-account";
import type { RhAutofireProposal } from "./rh-autofire";
import { etWallParts } from "../trading/sessions";

export const RH_DISASTER_PCT = 0.25;
export const RH_DAY_FLAT_MIN = 11 * 60;
export const RH_FLATTEN_MIN = 15 * 60 + 30;
/** Room mandate: at 11:00 a position under +50% comes off. */
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

function money(n: number): string {
  return (Math.round(n * 100) / 100).toFixed(2);
}

function closeOrder(held: RhHeld, type: "limit" | "market", price?: string): RhOrder {
  const order: RhOrder = {
    account_number: RH_PREFERRED_ACCOUNT_NUMBER,
    legs: [{ option_id: held.optionId, side: "sell", position_effect: "close", ratio_quantity: 1 }],
    type,
    quantity: String(Math.max(1, Math.floor(held.quantity))),
    time_in_force: "gfd",
    market_hours: "regular_hours",
    chain_symbol: held.underlier,
    underlying_type: "equity",
    refKey: `close:${held.decisionKey}`,
  };
  if (type === "limit" && price) order.price = price;
  return order;
}

function closeOf(held: RhHeld, why: string): RhCycle {
  const bid = held.bid;
  if (bid != null && Number.isFinite(bid) && bid > 0) {
    return { phase: "close", reason: why, order: closeOrder(held, "limit", money(Math.max(0.01, bid - CLOSE_SLIP))) };
  }
  return { phase: "close", reason: `${why} No bid, so the close is a market.`, order: closeOrder(held, "market") };
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
}): RhCycle {
  const held = args.held;
  if (held && held.quantity > 0 && !held.deskOwned) {
    return { phase: "look", reason: "A position this desk did not open is already on. No new ticket, and it is not closed.", order: null };
  }
  if (held && held.quantity > 0 && held.deskOwned) {
    if (args.forceClose) return closeOf(held, args.forceClose);
    const et = etMinOf(args.nowMs);
    const pnl = premiumPct(held);
    if (et >= RH_FLATTEN_MIN) return closeOf(held, "15:30 ET. The day position comes off.");
    if (pnl != null && pnl <= -RH_DISASTER_PCT) return closeOf(held, `Premium is ${(pnl * 100).toFixed(0)}%. The 25% backstop.`);
    if (levelHit(held)) return closeOf(held, "Price is through the futures invalidation.");
    if (held.failedHold) return closeOf(held, "A 15-minute close failed the hold.");
    const pnlTxt = pnl == null ? "premium unread" : `${pnl >= 0 ? "+" : ""}${(pnl * 100).toFixed(0)}%`;
    return { phase: "manage", reason: `Open. ${pnlTxt}. Stop and the 15-minute close still govern.`, order: null };
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
