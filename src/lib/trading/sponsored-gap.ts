/**
 * Sponsored gaps as PB Trading teaches them: a tiered map and an if-then, read from what the desk already detects.
 *
 * A sponsored gap is an institutional fair value gap: a one-sided leap (displacement) that leaves a clean vacuum. The desk tags one when the
 * middle candle's body is at least 1.5x ATR (smc-board.ts `arraysFromFvg`, `middleBodyAtrRatio >= 1.5`); the plain three-candle gap underneath
 * it was checked against an independent implementation (brainlab/smc_ref.py: 151 of 151 MNQ and 140 of 140 ES gaps agree to the bound).
 *
 * PB's tiers: the 1-hour and 4-hour gaps are the NARRATIVE (the map); the 1 to 5 minute are the TRANSACTION (the trigger). The rule is an if-then:
 *   IF price trades down into a higher-timeframe BULLISH sponsored gap, THEN drop to the 5 minute and wait for it to respect the boundary;
 *   the entry is the INVERSE of a lower-timeframe counter-trend gap (a bearish 5 minute gap closed through by displacement), which says the
 *   sponsorship is turning bullish; the stop sits under the structure the gap defends. A short is the mirror.
 *
 * This reads the map and the state of the if-then. The 1 to 5 minute inverse itself is ltf-lead.ts (`inverseAt`); this takes its result.
 * Narration and readiness: it picks nothing to trade and gates nothing. The order's own stop stays the plan's (beyond the raid).
 */

import type { SmcArray } from "./smc-board";

export type SponsoredState = "none" | "far" | "near" | "in_gap";

export interface SponsoredGapRef {
  tf: SmcArray["tf"];
  side: "bull" | "bear";
  top: number;
  bottom: number;
  state: SmcArray["state"];
}

export interface SponsoredRead {
  state: SponsoredState;
  /** The higher-timeframe gap the read is about (the nearest live one on the card's side), or null. */
  gap: SponsoredGapRef | null;
  /** Distance from price to the gap in ATR (0 inside it), or null when there is no gap or no ATR. */
  distanceAtr: number | null;
  /** A 1 to 5 minute inverse in the card's direction printed. */
  inverse: boolean;
  /** PB's trigger: the inverse printed while price is in or at the higher-timeframe gap. */
  trigger: boolean;
  /** The structure the gap defends: below a bullish gap, above a bearish one. Information; the plan's stop is the order's stop. */
  invalidation: number | null;
  /** The if-then in plain words. */
  line: string;
}

/** Within this many ATR of the gap counts as "at" it. A pullback into a gap is rarely a to-the-tick touch. */
export const SPONSORED_NEAR_ATR = 0.5;
const HTF = new Set<SmcArray["tf"]>(["1h", "4h"]);
/** A gap that was filled through, inverted, or turned into a breaker no longer holds the sponsorship it had. */
const LIVE = new Set<SmcArray["state"]>(["fresh", "partial"]);

const px = (n: number): string => (Number.isInteger(n) ? n.toLocaleString("en-US") : n.toFixed(2));

export function sponsoredRead(input: {
  arrays: readonly Pick<SmcArray, "kind" | "tf" | "side" | "top" | "bottom" | "state">[] | null | undefined;
  side: "long" | "short";
  price: number | null | undefined;
  atr: number | null | undefined;
  /** ltf-lead.ts: did a 1 to 5 minute inverse print in this card's direction? */
  inverse: boolean;
  /** Which rung inverted (1 to 5), for the sentence. */
  rung?: number | null;
}): SponsoredRead {
  const want: "bull" | "bear" = input.side === "long" ? "bull" : "bear";
  const price = input.price;
  const atr = input.atr != null && input.atr > 0 ? input.atr : null;
  const gaps = (input.arrays ?? []).filter((a) => a.kind === "sponsored" && HTF.has(a.tf) && a.side === want && LIVE.has(a.state));
  const none = (line: string): SponsoredRead => ({ state: "none", gap: null, distanceAtr: null, inverse: input.inverse, trigger: false, invalidation: null, line });
  if (!gaps.length) return none(`No 1 hour or 4 hour sponsored gap on the ${want === "bull" ? "bullish" : "bearish"} side. PB has no map for this ${input.side}.`);
  if (price == null || !Number.isFinite(price)) return none("No live price, so the sponsored gap cannot be placed.");

  const dist = (g: { top: number; bottom: number }): number => (price > g.top ? price - g.top : price < g.bottom ? g.bottom - price : 0);
  const nearest = [...gaps].sort((a, b) => dist(a) - dist(b) || (a.tf === "4h" ? -1 : 1))[0]!;
  const d = dist(nearest);
  const dAtr = atr != null ? d / atr : null;
  const state: SponsoredState = d === 0 ? "in_gap" : dAtr != null && dAtr <= SPONSORED_NEAR_ATR ? "near" : "far";
  const ref: SponsoredGapRef = { tf: nearest.tf, side: nearest.side, top: nearest.top, bottom: nearest.bottom, state: nearest.state };
  const invalidation = want === "bull" ? nearest.bottom : nearest.top;
  const tfName = nearest.tf === "4h" ? "4 hour" : "1 hour";
  const kind = want === "bull" ? "bullish" : "bearish";
  const range = `${px(nearest.bottom)} to ${px(nearest.top)}`;
  const trigger = state !== "far" && input.inverse;
  let line: string;
  if (trigger) {
    line = `The ${input.rung ? `${input.rung} minute` : "1 to 5 minute"} inverse printed ${state === "in_gap" ? "inside" : "at"} the ${tfName} ${kind} sponsored gap ${range}. That is PB's trigger. The structure it defends is ${want === "bull" ? "below" : "above"} ${px(invalidation)}.`;
  } else if (state === "far") {
    line = `The nearest ${tfName} ${kind} sponsored gap ${range} is ${dAtr != null ? `${dAtr.toFixed(1)} ATR` : "not near"} away. Wait for price to trade into it.`;
  } else {
    line = `Price is ${state === "in_gap" ? "in" : "at"} the ${tfName} ${kind} sponsored gap ${range}. Wait: the 5 minute must respect the boundary, then a ${want === "bull" ? "bearish" : "bullish"} 5 minute gap must invert.`;
  }
  return { state, gap: ref, distanceAtr: dAtr != null ? Math.round(dAtr * 100) / 100 : null, inverse: input.inverse, trigger, invalidation, line };
}
