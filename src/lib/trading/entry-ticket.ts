/**
 * The whole trade, in one message you can act on from a phone — Stage 3.
 *
 * WHY THIS EXISTS
 * Apex prohibits fully automated, hands-off trading on a funded Performance
 * Account; semi-automated management with the trader actively involved is
 * permitted. So on a funded account the desk cannot be the hands — but it can
 * be the whole of the decision, delivered completely enough that the hands
 * have nothing left to invent.
 *
 * That is a stricter requirement than it sounds. The old touch alarm said
 * "TOUCH · MNQ LONG at CE 30734.38 · stop 30370.75 · T1 30827.50". Everything
 * there is true and it is still not a trade: it does not say how many
 * contracts, it does not say what to do when T1 prints, it does not say where
 * the stop goes afterwards, and it does not say when the idea is dead. Each
 * of those gaps is a decision made at the screen, under time pressure, by the
 * part of the process the trader has already identified as the weak one.
 *
 * WHAT THIS IS NOT
 * It is not a new gate and not a new opinion. Every number here is read from
 * the plan the sequence already priced and the rules already in
 * `APLUS_RULES` — this module computes nothing about the market. If it ever
 * disagrees with the card, the card is right and this is broken.
 *
 * THE MANAGEMENT LINE IS THE POINT
 * `50% at T1, stop to BE, runner to T2` is the rule as coded and as measured:
 * +0.50R/trade on 122 filled plans, against -0.42R for banking at +1R, -0.07
 * for BE at +1R MFE and -0.30 for trailing. Re-measured 2026-09-24 across
 * three populations: violating "do not protect early" costs -0.18R to -0.41R
 * per trade and pushes drawdown from 24% to 45%. It is the most strongly
 * replicated finding on this desk, and it is the one a trader in a live
 * position is most tempted to abandon. So it travels WITH the entry, in the
 * same message, rather than living in a document nobody reads at 09:52.
 */

import { APLUS_RULES, sizeContracts, riskGradeFromScore } from "../aplus/config";
import type { TradePlan } from "./trade-plan";

export interface EntryTicket {
  symbol: string;
  side: "long" | "short";
  /** Where the limit rests. Always CE — never the print. */
  entry: number;
  stop: number;
  riskPts: number;
  t1: number | null;
  t2: number | null;
  rr1: number | null;
  rr2: number | null;
  /** Contracts at the grade's risk on this equity. 0 when unsizeable. */
  contracts: number;
  riskUsd: number;
  grade: string;
  /** One line each. Every one is safe to print on a lock screen. */
  lines: {
    entry: string;
    risk: string;
    target: string;
    manage: string;
    invalid: string;
  };
  /** The whole thing, newline-joined — the notification body. */
  text: string;
}

const px = (n: number | null | undefined): string =>
  n != null && Number.isFinite(n) ? n.toFixed(2) : "—";

/**
 * Build the ticket from a plan the sequence already priced.
 *
 * `confluence` picks the risk band through the SAME `riskGradeFromScore` the
 * rest of the desk uses, so a ticket can never size a grade differently from
 * the card that produced it.
 */
export function buildEntryTicket(input: {
  plan: TradePlan;
  confluence: number;
  equity?: number;
  /** Measured reach of T1, when the plan carries it. Printed, never acted on. */
  reachPct?: number | null;
}): EntryTicket {
  const { plan } = input;
  const equity = input.equity ?? APLUS_RULES.paperEquity;
  const grade = riskGradeFromScore(input.confluence);
  const sized = sizeContracts({
    symbol: plan.symbol,
    riskPts: plan.riskPts,
    equity,
    gradeOrScore: input.confluence,
  });

  // TWO separate refusals, and the second one is not obvious.
  //
  // 1. A stop the plan itself flagged as too tight. The 0.25xATR floor was
  //    measured: the 31 plans below it won 0 of 31.
  //
  // 2. A stop too WIDE to afford. `sizeContracts` ends with
  //    `if (pct > 0 && contracts < 1) contracts = 1` — a deliberate floor in
  //    config.ts, and one this ticket must not inherit. Rounding a position
  //    the budget cannot pay for UP to one contract does not make it
  //    affordable; it silently risks more than the grade allows and reports
  //    a clean number while doing it. `sleeve-sizing.ts` refuses the same
  //    case for the options book, and this is the futures twin.
  //
  //    Checked against ONE contract's own risk rather than against the
  //    returned count, because the floor has already hidden the count.
  const onePerContractUsd = plan.riskPts * sized.pv;
  const unaffordable = onePerContractUsd > sized.riskDollars;
  // 3. Outside the measured band. 0.5-1.5x ATR is where expectancy was
  //    positive in BOTH halves of the four-year tape (+0.059 IS / +0.058 OOS);
  //    under 0.5 loses -0.35R and over 1.5 loses -0.086R, both replicated.
  const unsizeable =
    plan.riskTooTight === true ||
    plan.riskTooWide === true ||
    unaffordable ||
    sized.contracts < 1;
  const contracts = unsizeable ? 0 : sized.contracts;

  const dir = plan.side === "long" ? "LONG" : "SHORT";
  const frac = Math.round(APLUS_RULES.scaleOut.tp1Fraction * 100);

  const entryLine = `${plan.symbol} ${dir} — rest a LIMIT at ${px(plan.entry)} (CE). Do not pay the print.`;

  const riskLine = unsizeable
    ? `DO NOT SIZE — ${
        plan.riskTooTight
          ? "stop is inside the 0.5xATR floor - measured -0.35R, both halves"
          : plan.riskTooWide
            ? "stop is beyond 1.5xATR - measured -0.086R, both halves"
          : `one contract risks $${Math.round(onePerContractUsd)} against a $${Math.round(sized.riskDollars)} budget`
      }. No ticket.`
    : `${contracts} contract${contracts === 1 ? "" : "s"} · stop ${px(plan.stop)} (${plan.riskPts.toFixed(2)}pt) · risk $${Math.round(sized.riskDollars)} · grade ${grade}`;

  const targetLine = [
    plan.t1 != null ? `T1 ${px(plan.t1)}${plan.rr1 != null ? ` (${plan.rr1.toFixed(1)}R)` : ""}` : "T1 —",
    plan.t2 != null ? `T2 ${px(plan.t2)}${plan.rr2 != null ? ` (${plan.rr2.toFixed(1)}R)` : ""}` : null,
    input.reachPct != null ? `reach ${Math.round(input.reachPct * 100)}%` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  // The rule, stated as instructions rather than as policy, because it is
  // being read mid-trade.
  const manageLine = APLUS_RULES.scaleOut.enabled
    ? `AT T1: take ${frac}% off, move stop to ${APLUS_RULES.scaleOut.moveStopToBeAfterTp1 ? "BREAKEVEN" : "plan"}, let the runner go to T2. Do NOT protect earlier — measured -0.18R to -0.41R and drawdown 24%->45%.`
    : `Single exit at T1. No runner.`;

  const invalidLine = `DEAD IF: price closes beyond ${px(plan.stop)}, or the limit is untouched by the session close. An unfilled plan does not carry to tomorrow.`;

  const lines = {
    entry: entryLine,
    risk: riskLine,
    target: targetLine,
    manage: manageLine,
    invalid: invalidLine,
  };

  return {
    symbol: plan.symbol,
    side: plan.side,
    entry: plan.entry,
    stop: plan.stop,
    riskPts: plan.riskPts,
    t1: plan.t1 ?? null,
    t2: plan.t2 ?? null,
    rr1: plan.rr1 ?? null,
    rr2: plan.rr2 ?? null,
    contracts,
    riskUsd: unsizeable ? 0 : Math.round(sized.riskDollars),
    grade,
    lines,
    text: [entryLine, riskLine, targetLine, manageLine, invalidLine].join("\n"),
  };
}

/**
 * The one-line version, for a notification title or a HUD row.
 *
 * Deliberately carries the entry price and the stop and nothing else — those
 * are the two numbers that decide whether to act at all, and a title that
 * needs scrolling is a title nobody reads.
 */
export function ticketHeadline(t: EntryTicket): string {
  return `${t.symbol} ${t.side.toUpperCase()} @ ${px(t.entry)} · stop ${px(t.stop)}${t.contracts > 0 ? ` · ${t.contracts}x` : " · NO SIZE"}`;
}
