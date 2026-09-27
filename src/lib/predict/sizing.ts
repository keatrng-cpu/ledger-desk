/**
 * Turning a fair value into a number to type: the limit price to set, how
 * many contracts, and when to sell.
 *
 * All three follow from one idea — a contract is worth its probability, and
 * every dollar of cost comes off that. None of them predict anything: give
 * them a reference probability you trust (book, model, or your own) and they
 * do the arithmetic. With no edge they say so and size to zero.
 */

import { sideFee, DEFAULT_FEES, type FeeModel } from "./math";

/**
 * The highest price (in whole cents) at which buying still clears the fees
 * plus a safety margin against `fair`. This is the number to rest as a limit
 * order — above it, the trade has no room even if the reference is right.
 */
export function limitPriceFor(fair: number, contracts = 100, marginCents = 1, fees: FeeModel = DEFAULT_FEES): number | null {
  if (!(fair > 0 && fair < 1)) return null;
  for (let c = 99; c >= 1; c--) {
    const p = c / 100;
    const fee = sideFee(p, contracts, fees) / contracts;
    if (fair - p - fee >= marginCents / 100) return p;
  }
  return null;
}

export interface KellyRead {
  /** Full-Kelly fraction of bankroll (0 when there is no edge). */
  full: number;
  /** The fraction actually suggested (fractional Kelly, capped). */
  used: number;
  contracts: number;
  stake: number;
  line: string;
}

/**
 * Kelly for a binary contract bought at `price` (fee included) that pays $1
 * with probability `p`: f* = (p − cost) / (1 − cost). Full Kelly maximizes
 * long-run growth only if `p` is exactly right; it is never exactly right,
 * so the tab uses a fraction (default ¼) and a per-game dollar cap. Zero edge
 * → zero size, said plainly.
 */
export function kellySize(
  p: number,
  price: number,
  bankroll: number,
  opts: { fraction?: number; maxStake?: number; fees?: FeeModel } = {},
): KellyRead {
  const fraction = opts.fraction ?? 0.25;
  const fees = opts.fees ?? DEFAULT_FEES;
  const cost = price + sideFee(price, 100, fees) / 100;
  if (!(p > 0 && p < 1) || !(cost > 0 && cost < 1) || !(bankroll > 0)) {
    return { full: 0, used: 0, contracts: 0, stake: 0, line: "Enter a bankroll and a price." };
  }
  const full = Math.max(0, (p - cost) / (1 - cost));
  if (full === 0) {
    return { full: 0, used: 0, contracts: 0, stake: 0, line: `No edge at ${Math.round(price * 100)}¢ after fees against ${(p * 100).toFixed(1)}% — Kelly says zero.` };
  }
  let stake = bankroll * full * fraction;
  if (opts.maxStake != null && opts.maxStake > 0) stake = Math.min(stake, opts.maxStake);
  const contracts = Math.floor(stake / cost);
  return {
    full,
    used: stake / bankroll,
    contracts,
    stake: Math.round(contracts * cost * 100) / 100,
    line: `Full Kelly ${(full * 100).toFixed(1)}% of bankroll; at ${Math.round(fraction * 100)}% Kelly${
      opts.maxStake ? `, capped at $${opts.maxStake}` : ""
    }: ${contracts} contracts ($${(contracts * cost).toFixed(2)}). Only as good as the ${(p * 100).toFixed(1)}% you gave it.`,
  };
}

export interface ExitGuide {
  /** Dollars per contract from selling into the bid now, after the exit fee. */
  sellNow: number;
  /** What holding is worth per contract if the reference is right (settlement has no fee). */
  hold: number;
  /** hold − sellNow: positive = the reference says hold. */
  diff: number;
  line: string;
}

/**
 * The exit rule that follows from a fair value — the opposite of "sell when
 * it's up". Selling captures the bid minus the fee; holding is worth the
 * reference probability. Sell when the market pays MORE than fair, hold when
 * it pays less. If the reference is wrong, so is the guide; it says whose
 * number it is using.
 */
export function exitGuide(bid: number, reference: number, contracts: number, refName: string, fees: FeeModel = DEFAULT_FEES): ExitGuide | null {
  if (!(bid > 0 && bid < 1) || !(reference >= 0 && reference <= 1) || !(contracts > 0)) return null;
  const sellNow = bid - sideFee(bid, contracts, fees) / contracts;
  const diff = reference - sellNow;
  const c = (x: number) => `${(x * 100).toFixed(1)}¢`;
  return {
    sellNow,
    hold: reference,
    diff,
    line:
      diff < 0
        ? `The bid pays ${c(sellNow)} after fees — ${c(-diff)} MORE than ${refName} says the contract is worth. Selling captures it.`
        : `Holding is worth ${c(diff)} a contract more than selling into the ${c(bid)} bid, if ${refName} is right.`,
  };
}

/**
 * A parlay's fair price is the product of its legs (for independent games).
 * Kalshi's cross-game parlays traded above that by a median 3.7% at 7 legs
 * and 22% at 10 legs (Moshrefi 2026 preprint).
 */
export function parlayCheck(legs: number[], offered: number): { fair: number; overpricing: number } | null {
  if (!legs.length || legs.some((x) => !(x > 0 && x < 1)) || !(offered > 0 && offered < 1)) return null;
  const fair = legs.reduce((a, b) => a * b, 1);
  return { fair, overpricing: offered / fair - 1 };
}
