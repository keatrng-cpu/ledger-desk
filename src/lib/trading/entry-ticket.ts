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
import { riskAtrBucket } from "./evidence";

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
  /**
   * Rule 5: has the book earned full A+ size (n>=20 closed A+ at WR>=65%)?
   * Defaults to FALSE — an unknown history is not an unlock, the same
   * default paper-manager.ts `paperAPlusCounters` takes off the browser.
   */
  aPlusUnlocked?: boolean;
}): EntryTicket {
  const { plan } = input;
  const equity = input.equity ?? APLUS_RULES.paperEquity;
  const cardGrade = riskGradeFromScore(input.confluence);
  // RULE 5 — an A+ card sizes at the A probe until the book earns full size.
  // This ticket used to size straight off the score, i.e. A+ at 3%, which is
  // the unlocked size; the paper book and the backtest both route the probe.
  const grade = cardGrade === "A+" && !input.aPlusUnlocked ? "A" : cardGrade;
  const sized = sizeContracts({
    symbol: plan.symbol,
    riskPts: plan.riskPts,
    equity,
    gradeOrScore: grade,
  });

  // TWO separate refusals, and the second one is not obvious.
  //
  // 1. A stop the plan itself flagged as too tight — inside 0.5xATR, which
  //    loses in both halves of the four-year tape (evidence-pack.json).
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
  // 3. Outside the measured band. Under 0.5xATR and over 1.5xATR both lose
  //    in both halves of the four-year tape; inside the band is roughly
  //    breakeven (+0.03R, not distinguishable from zero) — the band's value
  //    is the losses it refuses, not a proven edge inside it. Re-measured
  //    2026-09-25 under the rule as coded (50% at T1); the +0.059/+0.058
  //    first quoted for it came from a 75%-at-T1 sim that also credited T1
  //    on the fill bar.
  const unsizeable =
    plan.riskTooTight === true ||
    plan.riskTooWide === true ||
    unaffordable ||
    sized.contracts < 1;
  const contracts = unsizeable ? 0 : sized.contracts;

  const dir = plan.side === "long" ? "LONG" : "SHORT";
  const frac = Math.round(APLUS_RULES.scaleOut.tp1Fraction * 100);

  const entryLine = `${plan.symbol} ${dir} — rest a LIMIT at ${px(plan.entry)} (CE). Do not pay the print.`;

  // The measured cost is read from the evidence pack (evidence.ts), so a
  // re-measure moves this message instead of leaving a frozen number here.
  const ratio = plan.riskAtr && plan.riskAtr > 0 ? plan.riskPts / plan.riskAtr : null;
  const bucket = ratio != null ? riskAtrBucket(ratio) : null;
  const cost =
    bucket?.exp != null
      ? ` - measured ${bucket.exp >= 0 ? "+" : "-"}${Math.abs(bucket.exp).toFixed(2)}R/card over ${bucket.n}${bucket.verdict === "negative" ? ", both halves" : ""}`
      : "";
  const riskLine = unsizeable
    ? `DO NOT SIZE — ${
        plan.riskTooTight
          ? `stop is ${ratio != null ? ratio.toFixed(2) : "<0.5"}xATR, inside the 0.5xATR floor${cost}`
          : plan.riskTooWide
            ? `stop is ${ratio != null ? ratio.toFixed(2) : ">1.5"}xATR, beyond the 1.5xATR band${cost}`
          : `one contract risks $${Math.round(onePerContractUsd)} against a $${Math.round(sized.riskDollars)} budget`
      }. No ticket.`
    : `${contracts} contract${contracts === 1 ? "" : "s"} · stop ${px(plan.stop)} (${plan.riskPts.toFixed(2)}pt) · risk $${Math.round(sized.riskDollars)} · grade ${grade}${grade !== cardGrade ? ` (${cardGrade} card, probe size)` : ""}`;

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
