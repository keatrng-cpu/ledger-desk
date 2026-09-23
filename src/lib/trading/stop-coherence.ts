/**
 * Do the two books agree about where the trade is wrong?
 *
 * THE PROBLEM NOBODY HAS PRICED YET
 * The desk builds ONE directional read and then expresses it twice: as a
 * futures plan with a stop beyond the sweep, and as a Robinhood debit with a
 * working stop at −25% of premium. Those two stops are written in different
 * units and nobody has ever checked whether they mean the same thing. If the
 * option's 25% stop corresponds to a smaller underlying move than the futures
 * stop, the sleeve is exiting trades the plan is still in — and being stopped
 * out of winners by its own risk rule rather than by the market.
 *
 * This file converts the option stop into underlying points and puts the two
 * numbers side by side. It is arithmetic, not a signal, and it gates nothing.
 *
 * THE SECOND PROBLEM, WHICH IS WORSE
 * On a 0–2 DTE contract — which is the sleeve's stated day trade — theta is
 * large enough that premium can fall 25% WITH NO ADVERSE MOVE AT ALL. At that
 * point the working stop is not a level, it is a clock. The trader believes
 * they are risking 25% of debit against price; they are partly paying it to
 * time. `decayToStop` reports how much of the 25% the clock alone eats over a
 * holding period, and `verdict` says plainly when the stop is unreachable by
 * price because decay gets there first.
 *
 * WHY THE MODEL IS DELIBERATELY CRUDE
 * A first-order delta translation plus a linear theta estimate, no gamma, no
 * vega, no smile. A more precise model would need a live options chain the
 * desk does not have, and would produce a confident number resting on
 * invented inputs. The point here is a magnitude comparison — "your option
 * stop is a third of your futures stop" — and a first-order estimate answers
 * that honestly while a fancier one would only look like it did.
 *
 * Every output is labelled ESTIMATE and carries the assumptions used.
 */

import type { TradePlan } from "./trade-plan";

/** ES ≈ SPY/10, NQ ≈ QQQ/40 — the desk's existing estimation ratios. */
export const UNDERLIER_DIVISOR: Record<string, number> = { ES: 10, MES: 10, NQ: 40, MNQ: 40 };

export interface OptionStopInput {
  /** Futures symbol the plan is on. */
  symbol: string;
  /** Points of risk in the futures plan. */
  riskPts: number;
  /** Debit paid per contract, dollars (e.g. 150 for a $1.50 option). */
  debitUsd: number;
  /** Mid delta of the ticket, 0–1. */
  delta: number;
  /** Working stop as a fraction of debit. The desk's rule is 0.25. */
  stopFrac?: number;
  /** Days to expiry. Drives how much of the stop the clock eats. */
  dte: number;
  /** Hours the position is expected to be held. */
  holdHours?: number;
}

export type CoherenceVerdict =
  /** The option stop sits roughly where the futures stop does. */
  | "aligned"
  /** The option stop fires well before the futures stop — early exits. */
  | "option-tighter"
  /** The option stop is far beyond the futures stop — the plan exits first. */
  | "option-looser"
  /** Decay reaches the stop before price can. The stop is a clock. */
  | "clock";

export interface Coherence {
  verdict: CoherenceVerdict;
  /** Underlying move, in FUTURES POINTS, that costs 25% of the debit. */
  optionStopPts: number | null;
  /** The futures plan's own stop distance, for comparison. */
  futuresStopPts: number;
  /** optionStopPts / futuresStopPts. 1.0 means they agree. */
  ratio: number | null;
  /** Fraction of the debit theta alone removes over the hold. */
  decayToStop: number | null;
  /** Assumptions, always printed with the number. */
  assumptions: string[];
  line: string;
}

/**
 * Rough daily theta as a fraction of premium. A short-dated option loses
 * value at an accelerating rate; the square-root-of-time approximation is
 * the standard crude form and is good enough for a magnitude check.
 * At 1 DTE this returns a large fraction, which is the honest answer.
 */
export function dailyDecayFrac(dte: number): number {
  if (!Number.isFinite(dte) || dte <= 0) return 1;
  // d(sqrt(t))/dt relative to sqrt(t): one day's share of remaining time value.
  return Math.min(1, 1 - Math.sqrt(Math.max(0, dte - 1) / dte));
}

/**
 * Compare the two stops. Pure; no market data, no clock.
 */
export function coherence(input: OptionStopInput): Coherence {
  const stopFrac = input.stopFrac ?? 0.25;
  const div = UNDERLIER_DIVISOR[input.symbol.toUpperCase()] ?? null;
  const assumptions = [
    `first-order delta only — no gamma, vega or smile`,
    `underlier ≈ ${input.symbol}/${div ?? "?"} (the desk's existing estimation ratio)`,
    `working stop ${Math.round(stopFrac * 100)}% of debit`,
    `theta approximated by remaining-time decay at ${input.dte} DTE`,
  ];

  if (!div || !(input.delta > 0) || !(input.debitUsd > 0) || !(input.riskPts > 0)) {
    return {
      verdict: "aligned",
      optionStopPts: null,
      futuresStopPts: input.riskPts,
      ratio: null,
      decayToStop: null,
      assumptions,
      line: "Not enough of the ticket is known to compare the two stops. Log the actual DTE, delta and debit.",
    };
  }

  // Dollars of premium lost per 1.00 move in the UNDERLIER, per contract.
  const dollarsPerUnderlierPoint = input.delta * 100;
  const stopDollars = input.debitUsd * stopFrac;
  const underlierMove = stopDollars / dollarsPerUnderlierPoint;
  // Underlier points -> futures points.
  const optionStopPts = underlierMove * div;

  const holdHours = input.holdHours ?? 4;
  const decayToStop = (dailyDecayFrac(input.dte) * holdHours) / 24 / stopFrac;

  const ratio = optionStopPts / input.riskPts;

  let verdict: CoherenceVerdict;
  if (decayToStop >= 1) verdict = "clock";
  else if (ratio < 0.7) verdict = "option-tighter";
  else if (ratio > 1.4) verdict = "option-looser";
  else verdict = "aligned";

  const pctOfStop = Math.round(Math.min(1, decayToStop) * 100);
  const line =
    verdict === "clock"
      ? `ESTIMATE — at ${input.dte} DTE, time decay alone removes the whole ${Math.round(stopFrac * 100)}% stop within a ${holdHours}h hold. The working stop is a CLOCK, not a level: the position can be stopped out having never gone against you. Either shorten the hold, take more DTE, or accept that this ticket's risk is time and not price.`
      : verdict === "option-tighter"
        ? `ESTIMATE — the ${Math.round(stopFrac * 100)}% stop fires after about ${optionStopPts.toFixed(0)} ${input.symbol} points against you, but the futures plan's stop is ${input.riskPts.toFixed(0)}. The sleeve exits at ${Math.round(ratio * 100)}% of the plan's invalidation, so it will be stopped out of trades the plan is still in. Decay eats ${pctOfStop}% of the stop over ${holdHours}h before price moves at all.`
        : verdict === "option-looser"
          ? `ESTIMATE — the ${Math.round(stopFrac * 100)}% stop only fires after about ${optionStopPts.toFixed(0)} ${input.symbol} points, against a plan stop of ${input.riskPts.toFixed(0)}. The futures invalidation triggers first, which is correct — sell on invalidation, do not wait for the premium stop.`
          : `ESTIMATE — the ${Math.round(stopFrac * 100)}% stop lands near the plan's stop (${optionStopPts.toFixed(0)} vs ${input.riskPts.toFixed(0)} ${input.symbol} points, ratio ${ratio.toFixed(2)}). The two books agree about where this trade is wrong. Decay still eats ${pctOfStop}% of the stop over ${holdHours}h.`;

  return { verdict, optionStopPts, futuresStopPts: input.riskPts, ratio, decayToStop, assumptions, line };
}

/**
 * The same comparison straight off a live plan, for the options panel.
 */
export function coherenceForPlan(
  plan: TradePlan,
  ticket: { debitUsd: number; delta: number; dte: number },
  holdHours = 4,
): Coherence {
  return coherence({
    symbol: plan.symbol,
    riskPts: plan.riskPts,
    debitUsd: ticket.debitUsd,
    delta: ticket.delta,
    dte: ticket.dte,
    holdHours,
  });
}

/**
 * The DTE at which the clock stops dominating for a given hold. Answers the
 * only actionable question the above raises: how much time do I need to buy
 * so that my stop is about price rather than about the calendar?
 */
export function minDteForHold(holdHours: number, stopFrac = 0.25, maxDte = 45): number | null {
  for (let dte = 1; dte <= maxDte; dte++) {
    if ((dailyDecayFrac(dte) * holdHours) / 24 / stopFrac < 0.5) return dte;
  }
  return null;
}
