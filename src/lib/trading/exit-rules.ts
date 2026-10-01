/**
 * The failed-hold exit — the one rule from the trader's 2026-10-01 entry/exit
 * research ("a 5m close through the entry array after you are filled" exits;
 * "a wick is not that close") that measured as an improvement.
 *
 * THE RULE, EXACTLY AS MEASURED
 * Before T1, if a 15m candle CLOSES beyond the entry by half the entry→stop
 * distance (long: below entry − ½·risk; short: above entry + ½·risk), exit at
 * market. The hard stop beyond the raid stays where it is; this exits earlier
 * on a close, never on a wick. After T1 it no longer applies (the stop is at
 * breakeven by then).
 *
 * Why half-way: the capture stores no array bounds. The entry is the array's
 * midpoint (CE / mean threshold) and the stop sits beyond its far edge, so a
 * close half-way to the stop is a close through the array. 15m rather than
 * the trader's 5m because the four-year tape is 15m — the 5m version is
 * untested.
 *
 * EVIDENCE (scripts/measure-exit-plan.mjs, paired on the same fills)
 *   Cards the desk lets through (stop inside 0.5–1.5 ATR, n=1327):
 *     +0.033R → +0.066R per card, Δ +0.033R, z = 2.60, 2022–24 +0.027,
 *     2025–26 +0.043; cards reaching the full stop 82% → 65%.
 *   All cards (n=3501): Δ +0.017R, z = 1.13 — the pre-registered test, which
 *     it does NOT clear on its own. The in-band cut is the desk's existing
 *     hard rule, not chosen after the fact, but eight variants were run on it
 *     and z = 2.6 sits just under a strict multiple-comparison bar (~2.7).
 *   It lowers the win rate (some trades that would have recovered now close
 *   as small losses) while raising expectancy — the trade the trader's own
 *   research argues for. Note the desk's A+ unlock is a WIN-RATE threshold.
 *
 * Switch it off with FAILED_HOLD_ENABLED; the paper book and the card both
 * read it from here, so they cannot disagree.
 */

import type { OhlcBar } from "@/lib/market/types";

export const FAILED_HOLD_ENABLED = true;
/** How far past the entry, as a share of entry→stop, the close must reach. */
export const FAILED_HOLD_FRACTION = 0.5;
/** The candle whose CLOSE counts. */
export const FAILED_HOLD_TF_MS = 15 * 60_000;

export function failedHoldLevel(side: "long" | "short", entry: number, stop: number): number {
  const risk = Math.abs(entry - stop);
  return side === "long" ? entry - FAILED_HOLD_FRACTION * risk : entry + FAILED_HOLD_FRACTION * risk;
}

export interface FailedHoldRead {
  triggered: boolean;
  level: number;
  /** The closed 15m candle that triggered it. */
  bar: OhlcBar | null;
}

/**
 * Has a CLOSED 15m candle, from the one the fill happened in onward, closed
 * through the failed-hold level? A candle still forming never counts.
 */
export function failedHold(input: {
  side: "long" | "short";
  entry: number;
  stop: number;
  openedAt: number;
  nowMs: number;
  bars15: OhlcBar[];
}): FailedHoldRead {
  const level = failedHoldLevel(input.side, input.entry, input.stop);
  const fillBucket = Math.floor(input.openedAt / FAILED_HOLD_TF_MS) * FAILED_HOLD_TF_MS;
  for (const b of input.bars15) {
    if (b.t < fillBucket) continue;
    if (b.t + FAILED_HOLD_TF_MS > input.nowMs) continue;
    if (input.side === "long" ? b.c < level : b.c > level) return { triggered: true, level, bar: b };
  }
  return { triggered: false, level, bar: null };
}
