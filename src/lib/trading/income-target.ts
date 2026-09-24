/**
 * "$10,000 a month" — turned into the three numbers that actually produce it.
 *
 * WHY THIS IS A MODULE AND NOT A CALCULATION IN A CHAT
 * A monthly income target is the only goal on this desk that cannot be hit by
 * being right. It is hit by an identity:
 *
 *     monthly return  =  trades/month  x  expectancy(R)  x  risk fraction
 *
 * Three terms, all measured, none of them opinions. Every plan to "make more"
 * is a claim about one of them, and stating which one makes the plan checkable
 * instead of motivational. This module holds the identity, the desk's measured
 * values, and the honest answer to "what would have to change".
 *
 * WHAT THE FOUR-YEAR BACKTEST SAYS THE TERMS ARE
 * Measured over 93,669 bar-scans by `capture-signals.mjs` and compounded by
 * `backtest-account.mjs`, with the exit rule pinned to the desk's own scale
 * rule (plan stop, 75% off at T1, stop to breakeven):
 *
 *   policy            trades/yr   E[R]     out-of-sample   maxDD
 *   shipped                 3    +0.022        -1.011       9.2%
 *   armed (retrace)        15    +0.659        -0.227      20.5%
 *   stack_pd_event         42    +0.220        +0.091      25.6%
 *   stack_two             104    -0.021        -0.039      64.4%
 *
 * That last row is the important one. Frequency is not free: admitting setups
 * with TWO missing must-layers gets the trade count to 104/yr and takes
 * expectancy NEGATIVE with a 64% drawdown. There is a ceiling on how much
 * frequency this signal set can produce before it stops being signal, and the
 * ceiling sits below the frequency a large monthly target needs.
 *
 * SO THE HONEST ANSWER IS USUALLY "CAPITAL", NOT "TECHNIQUE"
 * At the desk's measured terms the monthly return is roughly 1.5-2.3%. A
 * $10,000 month is then a statement about the size of the account, not about
 * finding a better exit — and the module says so rather than implying a knob
 * exists that does not.
 *
 * NOTHING HERE SIZES A TRADE OR GATES ONE. It is arithmetic the trader can
 * check, and it is deliberately incapable of authorising anything.
 */

import { APLUS_RULES } from "../aplus/config";

/**
 * The desk's measured terms.
 *
 * Every number here came out of `scripts/backtest-account.mjs` against the
 * four-year tape, and each carries the sample it was measured on so a reader
 * can weigh it. `expR` figures are POOLED across 2022-2026; the out-of-sample
 * column above is what they shrink to on years the selection never saw, and
 * `oosExpR` carries that so the optimistic number never travels alone.
 */
export interface MeasuredPolicy {
  id: string;
  label: string;
  tradesPerYear: number;
  expR: number;
  /** The same expectancy on held-out years. The number to plan with. */
  oosExpR: number;
  maxDrawdown: number;
  n: number;
  note: string;
}

export const MEASURED: MeasuredPolicy[] = [
  {
    id: "shipped",
    label: "What ships today",
    tradesPerYear: 3,
    expR: 0.022,
    oosExpR: -1.011,
    maxDrawdown: 0.092,
    n: 13,
    note: "13 trades in four years. Too few to compound and too few to measure.",
  },
  {
    id: "armed",
    label: "Rest the limit at CE (retrace armed)",
    tradesPerYear: 15,
    expR: 0.659,
    oosExpR: -0.227,
    maxDrawdown: 0.205,
    n: 60,
    note: "The single biggest frequency gain available. Pooled expectancy is strong; the held-out years are not, so treat the pooled figure as untested.",
  },
  {
    id: "stack_pd_event",
    label: "Armed + sweep + dealing-range half + session events",
    tradesPerYear: 42,
    expR: 0.22,
    oosExpR: 0.091,
    maxDrawdown: 0.256,
    n: 169,
    note: "The most frequency this signal set delivers while expectancy stays positive out-of-sample.",
  },
  {
    id: "stack_two",
    label: "Two must-layers missing",
    tradesPerYear: 104,
    expR: -0.021,
    oosExpR: -0.039,
    maxDrawdown: 0.644,
    n: 416,
    note: "THE CLIFF. Enough trades for any target, and no edge left to compound. Recorded so the ceiling is a measurement rather than a belief.",
  },
];

export interface IncomePlan {
  /** Dollars a month the trader is asking for. */
  target: number;
  equity: number;
  /** target / equity — what the identity has to produce each month. */
  requiredMonthlyReturn: number;
  policy: MeasuredPolicy;
  riskPct: number;
  /** trades/month x E[R] x risk — what the desk actually produces. */
  projectedMonthlyReturn: number;
  projectedMonthlyDollars: number;
  /** How many times short (or over) the target the projection is. */
  shortfallMultiple: number;
  reachable: boolean;
  /** Equity at which this policy WOULD produce the target. */
  equityNeeded: number | null;
  /** Trades/month that would produce it at this equity. Null when impossible. */
  tradesNeeded: number | null;
  /** True when `tradesNeeded` is past the measured frequency cliff. */
  tradesPastCliff: boolean;
  lines: string[];
}

/** The frequency at which this signal set's expectancy went negative. */
export const FREQUENCY_CLIFF_PER_YEAR = 104;

/**
 * Price a monthly income target against measured terms.
 *
 * `oos` selects which expectancy to plan with. It defaults to the held-out
 * figure, because planning income off a pooled in-sample number is how a
 * target becomes a disappointment on a schedule.
 */
export function planIncome(input: {
  target: number;
  equity?: number;
  policyId?: string;
  riskPct?: number;
  /** Use pooled expectancy instead of held-out. Off by default, and labelled. */
  pooled?: boolean;
}): IncomePlan {
  const equity = input.equity ?? APLUS_RULES.paperEquity;
  const policy =
    MEASURED.find((p) => p.id === (input.policyId ?? "stack_pd_event")) ?? MEASURED[2]!;
  const riskPct = Math.min(
    input.riskPct ?? APLUS_RULES.riskPct,
    APLUS_RULES.riskPctCeiling,
  );
  const e = input.pooled ? policy.expR : policy.oosExpR;

  const perMonth = policy.tradesPerYear / 12;
  const projectedMonthlyReturn = perMonth * e * riskPct;
  const projectedMonthlyDollars = projectedMonthlyReturn * equity;
  const requiredMonthlyReturn = equity > 0 ? input.target / equity : Infinity;

  const equityNeeded =
    projectedMonthlyReturn > 0 ? input.target / projectedMonthlyReturn : null;
  const tradesNeeded =
    e > 0 && riskPct > 0 ? requiredMonthlyReturn / (e * riskPct) : null;
  const tradesPastCliff =
    tradesNeeded != null && tradesNeeded * 12 > FREQUENCY_CLIFF_PER_YEAR;

  const pct = (v: number) => `${(v * 100).toFixed(2)}%`;
  const usd = (v: number) =>
    `$${Math.round(v).toLocaleString("en-US")}`;

  const lines: string[] = [
    `Target ${usd(input.target)}/month on ${usd(equity)} is ${pct(requiredMonthlyReturn)} a month.`,
    `Identity: trades/month x E[R] x risk = ${(perMonth).toFixed(1)} x ${e >= 0 ? "+" : ""}${e.toFixed(3)}R x ${pct(riskPct)} = ${pct(projectedMonthlyReturn)} (${usd(projectedMonthlyDollars)}/month).`,
    `Policy: ${policy.label} — ${policy.tradesPerYear} trades/yr, ${input.pooled ? "POOLED" : "held-out"} E[R] ${e >= 0 ? "+" : ""}${e.toFixed(3)}, max drawdown ${pct(policy.maxDrawdown)} (n=${policy.n}).`,
  ];

  if (projectedMonthlyReturn <= 0) {
    lines.push(
      `This policy does not compound: expectancy is ${e.toFixed(3)}R on the years it was not chosen from. No account size and no risk setting turns a negative edge into income.`,
    );
  } else if (projectedMonthlyDollars >= input.target) {
    lines.push(`Reachable as configured — projected ${usd(projectedMonthlyDollars)} against a ${usd(input.target)} target.`);
  } else {
    lines.push(
      `Short by ${(input.target / Math.max(projectedMonthlyDollars, 1)).toFixed(1)}x. Two ways to close it, and only two:`,
    );
    if (equityNeeded != null) {
      lines.push(
        `  CAPITAL — the same edge on ${usd(equityNeeded)} produces ${usd(input.target)}/month. This is the honest lever; it needs no new claim about the market.`,
      );
    }
    if (tradesNeeded != null) {
      lines.push(
        `  FREQUENCY — ${tradesNeeded.toFixed(0)} trades/month (${(tradesNeeded * 12).toFixed(0)}/yr) at this expectancy and risk.` +
          (tradesPastCliff
            ? ` REFUSED: that is past the measured cliff of ${FREQUENCY_CLIFF_PER_YEAR}/yr, where expectancy went NEGATIVE (-0.039R) and drawdown reached 64%. Buying frequency past that point buys losses.`
            : ` That is inside the measured frequency ceiling, so it is a real option.`),
      );
    }
    lines.push(
      `  Raising risk beyond ${pct(APLUS_RULES.riskPctCeiling)} is not a third way — it is capped in config.ts and scales drawdown with return, not instead of it.`,
    );
  }

  return {
    target: input.target,
    equity,
    requiredMonthlyReturn,
    policy,
    riskPct,
    projectedMonthlyReturn,
    projectedMonthlyDollars,
    shortfallMultiple: input.target / Math.max(projectedMonthlyDollars, 1e-9),
    reachable: projectedMonthlyDollars >= input.target,
    equityNeeded,
    tradesNeeded,
    tradesPastCliff,
    lines,
  };
}

/**
 * Every policy priced against one target, best projected income first.
 *
 * The point of the table is that it makes the trade-off visible in one place:
 * the policies that produce the most trades are not the ones that produce the
 * most money, and the one that produces the most trades produces none.
 */
export function incomeLadder(target: number, equity = APLUS_RULES.paperEquity, riskPct?: number) {
  return MEASURED.map((p) => planIncome({ target, equity, policyId: p.id, riskPct })).sort(
    (a, b) => b.projectedMonthlyDollars - a.projectedMonthlyDollars,
  );
}
