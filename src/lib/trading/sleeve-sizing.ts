/**
 * Size the option from the stop, and stop on the LEVEL rather than the premium.
 *
 * THE DECISION THIS ENCODES (trader's call, 2026-09-23)
 * The sleeve risks up to a $1,000 DEBIT per trade, and the loss is capped at
 * 15% OF THE DEBIT — so a $300 ticket stops at −$45 and a $1,000 ticket at
 * −$150. That replaces the previous model, where $1,000 was the account and
 * $150 was the maximum debit. The two differ about 6.7x on position size
 * while capping the dollar loss at a similar place, because one risks by
 * premium and the other risks by stop.
 *
 * TWO THINGS ABOUT THAT CHOICE THAT MUST NOT BE SILENT
 *
 * 1. A 15% PREMIUM STOP IS TOO TIGHT FOR 0–2 DTE. stop-coherence.ts measured
 *    it: on a 1 DTE contract held four hours, theta alone removes about 67%
 *    of a 25% stop — and the whole of a 15% one. The stop stops being a level
 *    and becomes a clock, and the position is closed having never gone
 *    against you. `minDteFor` answers the only useful question that raises:
 *    with a 15% stop you need at least 2 DTE for a four-hour hold. That
 *    conflicts with the desk's "0DTE A+ after 9:45" line, and the conflict is
 *    real rather than cosmetic.
 *
 * 2. A PERCENTAGE STOP IS NOT THE THESIS. The futures plan already names the
 *    price at which the idea is wrong. A premium percentage is a proxy for
 *    that, and it decouples from it the moment volatility or time moves — you
 *    can be stopped out at −15% with the underlying sitting exactly where you
 *    bought it. Worse, it is psychologically arbitrary, which is a large part
 *    of why a premium stop gets ignored in the moment and a level stop does
 *    not. You can set an alert on "MNQ above 31022". You cannot set one on
 *    "my premium fell 15%".
 *
 * So the structure here is:
 *    PRIMARY   exit when the UNDERLYING reaches the futures plan's
 *              invalidation. Same trigger as the futures book, same thesis.
 *    BRAKE     the 15% premium stop as a disaster backstop only, and the
 *              clock warning when decay would reach it first.
 *    SIZE      solve the contract count so that the underlying travelling to
 *              invalidation costs the risk budget — not a fixed debit.
 *
 * WHY SIZING FROM THE STOP IS THE PROFITABILITY CHANGE
 * A fixed debit pays the same dollars to be wrong on a 0.55R idea and a 3R
 * idea. Sizing from the stop distance means a tight invalidation buys more
 * contracts and a wide one buys fewer, so risk is constant while exposure
 * tracks conviction. This is exactly what the futures book already does
 * (risk % / stop distance = contracts); the sleeve has never done it.
 *
 * It does NOT raise the win rate and nothing here claims it does. It stops
 * the sleeve from paying full price for bad geometry.
 */

import { dailyDecayFrac } from "./stop-coherence";
import type { TradePlan } from "./trade-plan";
import { UNDERLIER_DIVISOR } from "./stop-coherence";

/** Per-trade debit ceiling. The trader's stated cap. */
export const MAX_DEBIT_USD = 1_000;
/** Loss cap as a fraction of the debit actually paid. */
export const STOP_FRAC_OF_DEBIT = 0.15;
/** Below this the premium brake is unreachable before decay gets there. */
export const CLOCK_WARN = 0.5;

export interface SizeInput {
  /** The futures plan this option is expressing. */
  plan: Pick<TradePlan, "symbol" | "side" | "entry" | "stop" | "riskPts"> & {
    /** Set by buildTradePlan when the stop is inside the noise (< 0.25 ATR). */
    riskTooTight?: boolean;
    riskAtr?: number | null;
  };
  /** Mid delta of the contract being considered, 0–1. */
  delta: number;
  /** Premium per contract in dollars (e.g. 150 for a $1.50 option). */
  premiumUsd: number;
  /** Days to expiry. */
  dte: number;
  /** Expected hold in hours. */
  holdHours?: number;
  /** Dollars willing to lose. Defaults to 15% of the max debit. */
  riskBudgetUsd?: number;
}

export interface SleeveSize {
  /** Contracts that put the risk budget at the plan's invalidation. */
  contracts: number;
  /** What that costs. */
  debitUsd: number;
  /** Dollar loss if the underlying reaches the plan's stop. */
  lossAtInvalidationUsd: number;
  /** The premium brake, in dollars, at that debit. */
  brakeUsd: number;
  /** True when the debit ceiling, not the stop, decided the size. */
  cappedByDebit: boolean;
  /** True when one contract already exceeds the budget — too big to trade. */
  unaffordable: boolean;
  /** Fraction of the premium brake that decay alone eats over the hold. */
  decayToBrake: number;
  /** Decay reaches the brake before price can. The brake is a clock. */
  clock: boolean;
  /** Minimum DTE that makes the brake about price rather than the calendar. */
  minDte: number | null;
  lines: string[];
}

/**
 * The DTE at which the premium brake stops being a clock for a given hold.
 */
export function minDteFor(holdHours: number, stopFrac = STOP_FRAC_OF_DEBIT, maxDte = 45): number | null {
  for (let dte = 1; dte <= maxDte; dte++) {
    if ((dailyDecayFrac(dte) * holdHours) / 24 / stopFrac < CLOCK_WARN) return dte;
  }
  return null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Size the ticket from the plan's invalidation distance.
 *
 * Pure arithmetic with a first-order delta translation — no gamma, no vega.
 * Same deliberate crudeness as stop-coherence.ts and for the same reason: a
 * precise model would need a live chain the desk does not have, and would
 * look authoritative while resting on invented inputs.
 */
export function sizeFromStop(input: SizeInput): SleeveSize {
  const holdHours = input.holdHours ?? 4;
  const riskBudget = input.riskBudgetUsd ?? MAX_DEBIT_USD * STOP_FRAC_OF_DEBIT;
  const div = UNDERLIER_DIVISOR[input.plan.symbol.toUpperCase()] ?? null;
  const lines: string[] = [];

  const blank: SleeveSize = {
    contracts: 0,
    debitUsd: 0,
    lossAtInvalidationUsd: 0,
    brakeUsd: 0,
    cappedByDebit: false,
    unaffordable: true,
    decayToBrake: 0,
    clock: false,
    minDte: minDteFor(holdHours),
    lines: ["Not enough of the plan or the ticket is known to size anything."],
  };

  if (!div || !(input.delta > 0) || !(input.premiumUsd > 0) || !(input.plan.riskPts > 0)) return blank;

  /**
   * A stop inside the noise cannot be sized off.
   *
   * This is the money path for the defect found on 2026-09-24: a 1.31pt stop
   * on ES (5 ticks) priced a 28R target and told this function that $150 of
   * risk sat $6.56 a contract away — so it solved for 22 contracts and
   * believed the loss at invalidation was the budget. It is not: a five-tick
   * stop is taken out by the spread and one bar's noise, not by the idea
   * being wrong.
   *
   * Sizing is REFUSED rather than shrunk, because there is no size at which
   * a stop that will not survive the session is the right stop.
   */
  if (input.plan.riskTooTight) {
    const atr = input.plan.riskAtr;
    return {
      ...blank,
      contracts: 0,
      unaffordable: true,
      lines: [
        `STOP TOO TIGHT TO SIZE. ${input.plan.riskPts.toFixed(2)}pt of risk` +
          (atr ? ` against an ATR of ${atr.toFixed(2)} — under a quarter of one bar's range.` : ".") +
          ` Measured on 387 shadow trades, plans this tight won 0 of 31. The levels may be right; the STOP is not, and a size solved from it would price risk that is not really there. Re-price the stop beyond the sweep, or stand.`,
      ],
    };
  }

  // Underlying points between entry and invalidation.
  const underlierMove = input.plan.riskPts / div;
  // Dollars of premium lost per contract when the underlying travels that far.
  const lossPerContract = underlierMove * input.delta * 100;
  if (!(lossPerContract > 0)) return blank;

  let contracts = Math.floor(riskBudget / lossPerContract);
  let cappedByDebit = false;

  if (contracts < 1) {
    return {
      ...blank,
      contracts: 0,
      unaffordable: true,
      lines: [
        `ONE CONTRACT IS TOO BIG. A single contract loses about $${lossPerContract.toFixed(0)} if the underlying reaches the plan's invalidation, against a $${riskBudget.toFixed(0)} budget. Take a lower delta, a nearer expiry, or a plan with a tighter stop — do not take this one small and hope.`,
      ],
    };
  }

  // The debit ceiling can bind before the stop does.
  const maxByDebit = Math.floor(MAX_DEBIT_USD / input.premiumUsd);
  if (maxByDebit < contracts) {
    contracts = Math.max(1, maxByDebit);
    cappedByDebit = true;
  }

  const debitUsd = round2(contracts * input.premiumUsd);
  const lossAtInvalidationUsd = round2(contracts * lossPerContract);
  const brakeUsd = round2(debitUsd * STOP_FRAC_OF_DEBIT);

  const decayToBrake = (dailyDecayFrac(input.dte) * holdHours) / 24 / STOP_FRAC_OF_DEBIT;
  const clock = decayToBrake >= 1;
  const minDte = minDteFor(holdHours);

  lines.push(
    `${contracts} contract${contracts === 1 ? "" : "s"} at $${input.premiumUsd.toFixed(0)} = $${debitUsd.toFixed(0)} debit. The underlying reaching ${input.plan.stop.toFixed(2)} costs about $${lossAtInvalidationUsd.toFixed(0)} — that is the real risk, and it is what the size was solved for.`,
  );

  if (cappedByDebit) {
    lines.push(
      `Size was capped by the $${MAX_DEBIT_USD} debit ceiling rather than by the stop, so this ticket risks LESS than the budget. That is fine; it just means the ceiling is binding, not the geometry.`,
    );
  }

  if (clock) {
    lines.push(
      `CLOCK — at ${input.dte} DTE, theta alone removes the whole ${Math.round(STOP_FRAC_OF_DEBIT * 100)}% premium brake inside a ${holdHours}h hold. The brake will fire on time, not on price. Use ${minDte ?? "more"} DTE or more, or accept that this ticket's risk is the calendar.`,
    );
  } else if (decayToBrake >= CLOCK_WARN) {
    lines.push(
      `Decay eats ${Math.round(decayToBrake * 100)}% of the premium brake over ${holdHours}h before price moves at all. The brake is nearly a clock; ${minDte ?? "more"} DTE would fix it.`,
    );
  }

  lines.push(
    `EXIT ON THE LEVEL, NOT THE PERCENTAGE. Sell when the underlying reaches ${input.plan.stop.toFixed(2)} — that is where the idea is wrong and it is the same trigger the futures book uses. The $${brakeUsd.toFixed(0)} premium brake is a disaster backstop, not the plan.`,
  );

  return {
    contracts,
    debitUsd,
    lossAtInvalidationUsd,
    brakeUsd,
    cappedByDebit,
    unaffordable: false,
    decayToBrake,
    clock,
    minDte,
    lines,
  };
}

/**
 * Was a ticket actually taken within the rules? Feeds setup-memory's
 * `violations[]`, so a trade that broke sizing is kept out of the setup
 * statistics rather than teaching the shape something it did not earn.
 */
export function sleeveViolations(actual: {
  debitUsd: number;
  realisedLossUsd: number | null;
  exitedOnLevel: boolean | null;
}): string[] {
  const out: string[] = [];
  if (actual.debitUsd > MAX_DEBIT_USD) {
    out.push(`debit $${actual.debitUsd.toFixed(0)} over the $${MAX_DEBIT_USD} per-trade cap`);
  }
  const cap = actual.debitUsd * STOP_FRAC_OF_DEBIT;
  if (actual.realisedLossUsd != null && actual.realisedLossUsd > cap) {
    out.push(
      `loss $${actual.realisedLossUsd.toFixed(0)} over the ${Math.round(STOP_FRAC_OF_DEBIT * 100)}% brake ($${cap.toFixed(0)})`,
    );
  }
  if (actual.exitedOnLevel === false) out.push("exit was discretionary, not on the plan's invalidation");
  return out;
}
