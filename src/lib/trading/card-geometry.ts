/**
 * Does the card's OWN printed geometry describe a trade you could take?
 *
 * WHY THIS HAD TO EXIST
 * On 2026-09-25 the board showed four cards. Read off the numbers each one
 * printed:
 *
 *   MNQ LONG   A+ 0.78   risk 403.21   reward 126.04   0.31R   8.4x over cap
 *   ES  LONG   A+ 0.80   risk  76.81   reward   8.69   0.11R   4.3x over cap
 *   MNQ SHORT  B  0.82   stop BELOW the entry on a short — inverted
 *   ES  SHORT  B+ 0.73   risk  10.32   reward  12.05   1.17R   fine
 *
 * The only card whose geometry was takeable was the lowest-graded one. Grade
 * and tradability were ANTI-CORRELATED on that screen, and nothing on any card
 * said so.
 *
 * THE CAUSE, AND WHY THE SCORE CANNOT CATCH IT
 * `scanner.ts` builds `invalidation` as a structural landmark, not as a stop
 * for this entry:
 *
 *     direction === "bull" ? `Below PDL ${pdl}` : `Above PDH ${pdh}`
 *
 * PDL/PDH is wherever yesterday put it. It is not measured from the entry, so
 * the distance between them is arbitrary — 403 points on one card — and on a
 * short taken above PDH it lands on the WRONG SIDE of the entry entirely.
 *
 * The confluence score is a statement about how much structure is present. It
 * is not, and was never, a statement about whether the levels form a trade.
 * CLAUDE.md's "R:R >= 1:1" is enforced by `smc-master`'s Target-priced
 * must-layer — but that gates the WORD, not the CARD, and the card is what has
 * the buttons on it.
 *
 * WHAT THIS MODULE DOES
 * It reads the three numbers the card is ALREADY SHOWING and says whether they
 * form a trade. Deliberately the printed strings rather than the numeric plan:
 * the failure being guarded against is a trader acting on what they can see,
 * so the check has to be against exactly that. Where the plan disagrees with
 * the prose, that disagreement is itself the finding.
 *
 * It changes no score and blocks no gate. It puts a refusal where the entry is.
 */

import { MAX_RISK_PTS, DEFAULT_MAX_RISK_PTS, maxRiskPtsFor } from "./simulate-path-trade";

/** First price-shaped number in a prose level. Mirrors paper-manager. */
export function firstLevel(text: string | null | undefined): number | null {
  if (!text) return null;
  const m = text.match(/(\d{3,6}(?:\.\d+)?)/);
  const n = m ? Number(m[1]) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Midpoint of a zone like "30746.88 – 30801.67 (OTE, opt 30773.96)". */
export function zoneMid(text: string | null | undefined): number | null {
  if (!text) return null;
  // Prefer an explicit "opt" price — it is the one the card tells you to use.
  const opt = text.match(/opt\s+(\d{3,6}(?:\.\d+)?)/i);
  if (opt && Number.isFinite(Number(opt[1]))) return Number(opt[1]);
  const nums = [...text.matchAll(/(\d{3,6}(?:\.\d+)?)/g)].map((m) => Number(m[1]));
  if (nums.length >= 2) return (nums[0]! + nums[1]!) / 2;
  return nums.length === 1 ? nums[0]! : null;
}

export type GeometryVerdict = "ok" | "thin" | "sub-1r" | "over-cap" | "inverted" | "unreadable";

export interface CardGeometry {
  entry: number | null;
  stop: number | null;
  target: number | null;
  /** Points from entry to stop. Negative means the stop is on the wrong side. */
  riskPts: number | null;
  rewardPts: number | null;
  rr: number | null;
  /** The instrument's cap at this ATR (maxRiskPtsFor). */
  capPts: number;
  overCapBy: number | null;
  verdict: GeometryVerdict;
  /** True when the card should NOT be acted on as printed. */
  refuse: boolean;
  line: string;
}

/**
 * Below this the trade is not refused, but the card says the R:R is thin.
 * 1.0 is the house floor (`APLUS_RULES.minRr`); between 1.0 and this the
 * geometry clears the rule and still leaves nothing for slippage.
 */
export const THIN_RR = 1.25;

export function readCardGeometry(input: {
  symbol: string;
  side: "long" | "short";
  entryZone?: string | null;
  invalidation?: string | null;
  target?: string | null;
  /** ATR for the cap. Without it the legacy fixed cap is used. */
  atr?: number | null;
}): CardGeometry {
  const entry = zoneMid(input.entryZone);
  const stop = firstLevel(input.invalidation);
  const target = firstLevel(input.target);
  const root = input.symbol.replace(/^M/, "");
  const known = MAX_RISK_PTS[input.symbol] != null ? input.symbol : root;
  const capPts = maxRiskPtsFor(known, input.atr) || DEFAULT_MAX_RISK_PTS;

  const blank: CardGeometry = {
    entry,
    stop,
    target,
    riskPts: null,
    rewardPts: null,
    rr: null,
    capPts,
    overCapBy: null,
    verdict: "unreadable",
    refuse: false,
    line: "",
  };

  if (entry == null || stop == null) {
    return {
      ...blank,
      line: "Entry or invalidation has no readable price — nothing to size from.",
    };
  }

  const long = input.side === "long";
  const riskPts = long ? entry - stop : stop - entry;
  const rewardPts = target == null ? null : long ? target - entry : entry - target;

  // A stop on the wrong side is not a wide stop, it is not a stop. This is
  // what a structural landmark does when price has already traded through it.
  if (riskPts <= 0) {
    return {
      ...blank,
      riskPts,
      rewardPts,
      verdict: "inverted",
      refuse: true,
      line:
        `INVALIDATION IS ON THE WRONG SIDE — ${input.side} entry ${entry.toFixed(2)} with a stop at ` +
        `${stop.toFixed(2)}. Price has already traded through this level, so it protects nothing. ` +
        `Do not size from this card; re-run the sequence for a stop measured from the entry.`,
    };
  }

  const rr = rewardPts == null ? null : rewardPts / riskPts;
  const overCapBy = riskPts > capPts ? riskPts / capPts : null;

  if (overCapBy != null) {
    return {
      ...blank,
      riskPts,
      rewardPts,
      rr,
      overCapBy,
      verdict: "over-cap",
      refuse: true,
      line:
        `STOP ${riskPts.toFixed(2)}pt — ${overCapBy.toFixed(1)}x the ${capPts.toFixed(0)}pt cap for ${input.symbol}. ` +
        `This invalidation is a structural landmark, not a stop for this entry` +
        (rr != null ? `, and the geometry is ${rr.toFixed(2)}R` : "") +
        `. The plan's own stop is the one to size from.`,
    };
  }

  if (rr == null) {
    return {
      ...blank,
      riskPts,
      rewardPts,
      rr,
      verdict: "unreadable",
      line: `Risk ${riskPts.toFixed(2)}pt · no readable target, so no R:R.`,
    };
  }

  if (rr < 1) {
    return {
      ...blank,
      riskPts,
      rewardPts,
      rr,
      verdict: "sub-1r",
      refuse: true,
      line:
        `${rr.toFixed(2)}R AS PRINTED — risking ${riskPts.toFixed(2)}pt to make ${rewardPts!.toFixed(2)}pt. ` +
        `Under the 1:1 floor, so this is not takeable at these levels whatever the score says.`,
    };
  }

  if (rr < THIN_RR) {
    return {
      ...blank,
      riskPts,
      rewardPts,
      rr,
      verdict: "thin",
      refuse: false,
      line: `${rr.toFixed(2)}R — clears 1:1 but leaves little for slippage. Risk ${riskPts.toFixed(2)}pt for ${rewardPts!.toFixed(2)}pt.`,
    };
  }

  return {
    ...blank,
    riskPts,
    rewardPts,
    rr,
    verdict: "ok",
    refuse: false,
    line: `${rr.toFixed(2)}R · risk ${riskPts.toFixed(2)}pt for ${rewardPts!.toFixed(2)}pt.`,
  };
}
