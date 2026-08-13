/**
 * Discretion factor — the measured-edge overlay that actually reaches sizing.
 *
 * WHY THIS EXISTS
 * The "veteran brain" (trading/veteran-brain.ts) computes a rich verdict and
 * a sizeMult every render, but every input feeding it (desk-memory.ts) is
 * localStorage — per-browser, never durable, never shared with the server
 * gate. Three independent audits confirmed the result: the scanner's grade,
 * `sizeContracts()`, and the paper/live open paths are bit-for-bit identical
 * whether the brain has seen 0 trades or 10,000. This module is the fix —
 * a pure, deterministic, auditable function of REAL trade history that a
 * caller can actually multiply into position size.
 *
 * WHAT FEEDS IT (per the user's explicit ask — history, paper, backtests,
 * live, and nothing invented)
 *   - LIVE closed trades — full weight (1.0). Real capital, real fills.
 *   - PAPER closed trades — partial weight (PAPER_WEIGHT). Simulated fills
 *     are real evidence of the MODEL, just lower-fidelity than live, so they
 *     count for something rather than nothing (this is the one place paper
 *     evidence is allowed to influence a number outside its own report —
 *     see the weighting rationale below).
 *   - BACKTEST prior (public/data/bt-*.json, per-strategy `byStrat`) — a
 *     small, FADING weight used only to keep sizing sane during the cold
 *     start before live+paper accumulate real n. It never overrides real
 *     evidence: `btFade` decays linearly to 0 as real effective n approaches
 *     MIN_STRATEGY_N (analytics.ts), so a strategy with 30 real trades gets a
 *     factor computed from those 30 trades alone, regardless of what the
 *     backtest said.
 *
 * WHY PAPER COUNTS HERE BUT NOT IN pathTakeGate
 * profit-rules.ts's live gate (month cap, cool-down, blake_mech demotion)
 * stays LIVE-ONLY on purpose — journal/server.ts documents why: paper is
 * deliberately exempt from pacing rules so the sample can accumulate at
 * n>=30 speed. That principle is untouched here. This module is a different
 * kind of number — a SIZING multiplier and an advisory verdict, not a hard
 * trade-permission gate — and for that purpose paper evidence about which
 * MODEL works is legitimate, at a discount, exactly as the user asked.
 *
 * WHAT IT DOES NOT DO
 * It never gates a trade outright. The caller decides what "demote" means
 * (index.tsx requires an extra confirmation click with the real numbers
 * shown; nothing here disables a button). Rules + structure still decide;
 * this is the rule that used to not exist.
 *
 * Pure, deterministic, no I/O — same discipline as analytics.ts.
 */

import { MIN_STRATEGY_N } from "./analytics";
import type { AnalyticsTrade } from "./analytics";

/** Each paper trade counts as this fraction of a live trade toward sample size. */
export const PAPER_WEIGHT = 0.4;

/** Each backtest-seed trade counts as this fraction, faded by `btFadeFactor`. */
export const BACKTEST_WEIGHT = 0.25;

/** Below this effective n, the factor stays neutral (1.0) — noise, not signal. */
export const MIN_EFFECTIVE_N = 8;

/** Effective n required before "demote" can fire — mirrors analytics.ts MIN_VERDICT_N. */
export const DEMOTE_EFFECTIVE_N = 20;

/** Trailing expectancy below this, at DEMOTE_EFFECTIVE_N+, reads as "demote". */
export const DEMOTE_EXPECTANCY_R = -0.15;

/** Trailing expectancy above this reads as "favor". */
export const FAVOR_EXPECTANCY_R = 0.15;

/** Size multiplier never drops below this (never zeroes a position via discretion alone). */
export const FACTOR_FLOOR = 0.6;

/** Size multiplier never exceeds this — discretion can shrink size, not meaningfully lever it. */
export const FACTOR_CEILING = 1.15;

/** $R -> multiplier slope. +1R trailing expectancy would ask for 1.5x before clamping. */
export const FACTOR_SLOPE = 0.5;

export interface BacktestPrior {
  n: number;
  wins: number;
  /** Sum of R across all `n` trades (not per-trade). */
  sumR: number;
}

export type DiscretionVerdict =
  | "insufficient-data"
  | "caution"
  | "neutral"
  | "favor"
  | "demote";

export interface DiscretionResult {
  strategy: string;
  /** Position-size multiplier, clamped [FACTOR_FLOOR, FACTOR_CEILING]. 1.0 = neutral. */
  factor: number;
  verdict: DiscretionVerdict;
  /** Weighted sample size actually behind `factor` (live + paper*weight + backtest*weight*fade). */
  effectiveN: number;
  liveN: number;
  paperN: number;
  backtestN: number;
  /** Weighted trailing expectancy, null when no source carried a defined R. */
  expectancyR: number | null;
  /** Unweighted win rate across live+paper closes (informational only — factor uses R, not this). */
  winRate: number | null;
  reason: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function sumDefinedR(trades: AnalyticsTrade[]): { r: number; n: number } {
  let r = 0;
  let n = 0;
  for (const t of trades) {
    if (Number.isFinite(t.r)) {
      r += t.r;
      n += 1;
    }
  }
  return { r, n };
}

/**
 * Blend live + paper + a fading backtest prior into one sizing multiplier
 * and advisory verdict for a single strategy.
 *
 * Total and pure: any length/order of `live`/`paper`, any or no `backtest`.
 */
export function computeDiscretion(
  strategy: string,
  live: AnalyticsTrade[],
  paper: AnalyticsTrade[],
  backtest?: BacktestPrior | null,
): DiscretionResult {
  const liveSum = sumDefinedR(live);
  const paperSum = sumDefinedR(paper);
  const btN = backtest?.n ?? 0;

  // Real (unweighted-by-backtest) effective n decides how much the backtest
  // prior still gets to speak. Fades to 0 once real evidence clears
  // MIN_STRATEGY_N — a strategy with a full real sample is judged on that
  // sample alone, never dragged by what the backtest once said.
  const realEffectiveN = liveSum.n + paperSum.n * PAPER_WEIGHT;
  const btFade = backtest ? clamp(1 - realEffectiveN / MIN_STRATEGY_N, 0, 1) : 0;
  const btWeightedN = btN * BACKTEST_WEIGHT * btFade;
  const btAvgR = backtest && btN > 0 ? backtest.sumR / btN : 0;
  const btWeightedR = btAvgR * btWeightedN;

  const effectiveN = liveSum.n + paperSum.n * PAPER_WEIGHT + btWeightedN;
  const weightedRSum = liveSum.r + paperSum.r * PAPER_WEIGHT + btWeightedR;

  const liveN = live.length;
  const paperN = paper.length;
  const winsAll =
    live.filter((t) => t.pnl > 0).length + paper.filter((t) => t.pnl > 0).length;
  const nAll = liveN + paperN;
  const winRate = nAll ? winsAll / nAll : null;

  const base = {
    strategy,
    effectiveN: round2(effectiveN),
    liveN,
    paperN,
    backtestN: btN,
    winRate,
  };

  if (effectiveN < MIN_EFFECTIVE_N) {
    return {
      ...base,
      factor: 1.0,
      verdict: "insufficient-data",
      expectancyR: null,
      reason: `${strategy}: effective n=${effectiveN.toFixed(1)} (live ${liveN}, paper ${paperN}${btN ? `, backtest ${btN}` : ""}) — below ${MIN_EFFECTIVE_N}, sizing stays neutral (×1.00).`,
    };
  }

  const expectancyR = round4(weightedRSum / effectiveN);
  const rawFactor = 1 + clamp(expectancyR, -1, 1) * FACTOR_SLOPE;
  const factor = round2(clamp(rawFactor, FACTOR_FLOOR, FACTOR_CEILING));

  let verdict: DiscretionVerdict = "neutral";
  if (effectiveN >= DEMOTE_EFFECTIVE_N && expectancyR < DEMOTE_EXPECTANCY_R) {
    verdict = "demote";
  } else if (expectancyR < 0) {
    verdict = "caution";
  } else if (expectancyR > FAVOR_EXPECTANCY_R) {
    verdict = "favor";
  }

  const sign = expectancyR >= 0 ? "+" : "";
  const stats = `effective n=${effectiveN.toFixed(1)} (live ${liveN}, paper ${paperN}${btN ? `, bt ${btN}` : ""}) · expectancy ${sign}${expectancyR.toFixed(2)}R · size ×${factor.toFixed(2)}`;

  const reason =
    verdict === "demote"
      ? `${strategy}: ${stats} — negative at n>=${DEMOTE_EFFECTIVE_N}. Demoted.`
      : `${strategy}: ${stats}.`;

  return { ...base, factor, verdict, expectancyR, reason };
}

/** Neutral placeholder for a strategy with no discretion data at all. */
export function neutralDiscretion(strategy: string): DiscretionResult {
  return {
    strategy,
    factor: 1.0,
    verdict: "insufficient-data",
    effectiveN: 0,
    liveN: 0,
    paperN: 0,
    backtestN: 0,
    expectancyR: null,
    winRate: null,
    reason: `${strategy}: no history yet — sizing stays neutral (×1.00).`,
  };
}
