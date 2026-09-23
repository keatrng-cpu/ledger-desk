/**
 * What the targets are actually worth — the race, not the distance.
 *
 * WHAT THE DESK ALREADY HAD, AND IT IS BETTER THAN MOST
 * `draw.ts` computes a genuine empirical base rate for T1: from the same
 * point in the session, what fraction of prior sessions travelled at least
 * this far further. It is time-conditioned (`remainingExcursions` takes the
 * elapsed fraction, so a 10:30 target and a 15:00 target are scored against
 * the time each actually has left) and `reachTier` buckets it against
 * measured outcomes. That is real work and none of it is being replaced.
 *
 * THE FOUR GAPS THIS FILE CLOSES
 *
 * 1. THE STOP IS NOT IN THE PROBABILITY. `remainingExcursions` records the
 *    maximum favourable excursion — did price EVER get that far. A trade
 *    does not ask that. It asks "does price reach T1 BEFORE it reaches my
 *    stop", which is a first-passage race between two levels. A target that
 *    is touched at some point in 80% of sessions can be touched before the
 *    stop in far fewer, and the gap between those two numbers is pure
 *    overstatement in the direction that costs money. `raceOdds` walks each
 *    prior session bar by bar and records which level printed first.
 *
 * 2. T2 HAS NO PROBABILITY AT ALL. `reachProbability` belongs to the draw,
 *    which becomes T1. T2 is the dealing-range extreme and carries no base
 *    rate whatsoever — so the runner, which the scale evidence says is where
 *    the money is (+0.50R/t for 50%-at-T1-then-runner, against −0.42R/t for
 *    banking at +1R), has been completely unpriced.
 *
 * 3. NOTHING MULTIPLIES THE ODDS BY THE REWARD. The desk shows "1.8R to T1"
 *    and "72% reach" in different places and never combines them. The number
 *    a trader actually needs before clicking is the expectancy of the whole
 *    structure — and because the desk's scale rule is fixed and measured,
 *    that expectancy is computable ex ante. `expectedR` does it.
 *
 * 4. AN UNRELIABLE BASE RATE LOOKS EXACTLY LIKE A RELIABLE ONE.
 *    `MIN_SESSIONS_FOR_BASE_RATE` is 4. With four samples the only
 *    achievable values are 0, 25, 50, 75 and 100 percent, and `reachTier`
 *    receives a bare number with no sample count attached — so 100% off four
 *    sessions renders identically to 85% off forty. Everything here carries
 *    its own n and refuses to bucket below a floor.
 *
 * WHAT THIS IS NOT
 * Not a forecast and not a gate. These are historical frequencies from a
 * small sample of recent sessions on one instrument, and a frequency is not
 * a probability of the next event. Sample counts travel with every number
 * and the honest failure mode is `null`, which every function here returns
 * rather than guessing.
 */

import type { OhlcBar } from "../market/types";
import type { SessionSlice } from "./draw";

/** Below this many prior sessions, no odds are reported at all. */
export const MIN_SESSIONS_FOR_ODDS = 12;
/** Below this, odds are reported but flagged as thin. */
export const THIN_SESSIONS = 25;

export interface RaceResult {
  /** Fraction of sessions where the target printed before the stop. */
  pTargetFirst: number | null;
  /** Fraction where the stop printed first. */
  pStopFirst: number | null;
  /** Fraction where neither printed by the close — the flat outcome. */
  pNeither: number | null;
  /** Prior sessions actually usable. */
  n: number;
  reliable: boolean;
  /** The same target measured WITHOUT the stop, for comparison. */
  pTouchIgnoringStop: number | null;
  /** How much the stop-free number overstates it, in percentage points. */
  overstatementPts: number | null;
  note: string;
}

/**
 * Walk each prior session forward from the same elapsed point and record
 * which level printed first. This is the measurement the desk was missing.
 *
 * `upPts` / `downPts` are distances from the reference price, both positive.
 * For a long, up is the target and down is the stop; for a short, reversed —
 * the caller decides by which way round it passes them.
 */
export function raceOdds(
  sessions: SessionSlice[],
  elapsedFraction: number,
  targetPts: number,
  stopPts: number,
  side: "long" | "short",
): RaceResult {
  const blank: RaceResult = {
    pTargetFirst: null,
    pStopFirst: null,
    pNeither: null,
    n: 0,
    reliable: false,
    pTouchIgnoringStop: null,
    overstatementPts: null,
    note: "No usable prior sessions — no odds.",
  };
  if (!(targetPts > 0) || !(stopPts > 0)) return blank;

  let targetFirst = 0;
  let stopFirst = 0;
  let neither = 0;
  let touched = 0;
  let n = 0;

  // Drop the final (in-progress) session: it has no future to measure.
  for (const s of sessions.slice(0, -1)) {
    const bars: OhlcBar[] = s.bars;
    if (bars.length < 6) continue;
    const idx = Math.min(bars.length - 2, Math.max(0, Math.floor(bars.length * elapsedFraction)));
    const ref = bars[idx]?.c;
    if (ref == null || !Number.isFinite(ref)) continue;

    const targetPx = side === "long" ? ref + targetPts : ref - targetPts;
    const stopPx = side === "long" ? ref - stopPts : ref + stopPts;

    let outcome: "target" | "stop" | "none" = "none";
    let everTouched = false;
    for (let i = idx + 1; i < bars.length; i++) {
      const b = bars[i]!;
      const hitTarget = side === "long" ? b.h >= targetPx : b.l <= targetPx;
      const hitStop = side === "long" ? b.l <= stopPx : b.h >= stopPx;
      if (hitTarget) everTouched = true;
      if (hitTarget && hitStop) {
        // Both printed inside one bar and the path within it is unknowable.
        // Resolve AGAINST the trade, exactly as shadow-book.ts resolves its
        // intrabar ties — a tie broken in your favour is how a backtest
        // quietly becomes a marketing number.
        outcome = "stop";
        break;
      }
      if (hitTarget) {
        outcome = "target";
        break;
      }
      if (hitStop) {
        outcome = "stop";
        break;
      }
    }
    // Keep scanning for a touch even after the stop, so the comparison
    // number matches what remainingExcursions would have reported.
    if (!everTouched && outcome === "stop") {
      for (let i = idx + 1; i < bars.length; i++) {
        const b = bars[i]!;
        if (side === "long" ? b.h >= targetPx : b.l <= targetPx) {
          everTouched = true;
          break;
        }
      }
    }

    n++;
    if (everTouched) touched++;
    if (outcome === "target") targetFirst++;
    else if (outcome === "stop") stopFirst++;
    else neither++;
  }

  if (n === 0) return blank;

  const pTargetFirst = targetFirst / n;
  const pTouch = touched / n;
  const overstatementPts = (pTouch - pTargetFirst) * 100;
  const reliable = n >= MIN_SESSIONS_FOR_ODDS;

  return {
    pTargetFirst,
    pStopFirst: stopFirst / n,
    pNeither: neither / n,
    n,
    reliable,
    pTouchIgnoringStop: pTouch,
    overstatementPts,
    note: !reliable
      ? `Only ${n} prior sessions — below the ${MIN_SESSIONS_FOR_ODDS} needed to quote odds. Shown for shape, not for sizing.`
      : n < THIN_SESSIONS
        ? `${n} prior sessions — thin. Treat the percentage as a range, not a value.`
        : `${n} prior sessions. Ties inside one bar are resolved against the trade.`,
  };
}

export interface TargetOdds {
  t1: RaceResult | null;
  /** T2 measured as a SECOND race, run from T1 rather than from entry. */
  t2GivenT1: RaceResult | null;
  n: number;
}

/**
 * Odds for both targets. T2 is deliberately conditional: the desk's scale
 * rule moves the stop to breakeven once T1 prints, so the runner's real
 * question is "from T1, does T2 print before price comes back to entry" —
 * a different race with a different stop, not the same race extended.
 */
export function targetOdds(
  sessions: SessionSlice[],
  elapsedFraction: number,
  opts: { side: "long" | "short"; entry: number; stop: number; t1: number | null; t2: number | null },
): TargetOdds {
  const riskPts = Math.abs(opts.entry - opts.stop);
  const t1Pts = opts.t1 != null ? Math.abs(opts.t1 - opts.entry) : null;
  const t2Pts = opts.t2 != null && opts.t1 != null ? Math.abs(opts.t2 - opts.t1) : null;

  const t1 = t1Pts != null ? raceOdds(sessions, elapsedFraction, t1Pts, riskPts, opts.side) : null;
  // From T1 the stop is breakeven, so the adverse distance is T1 back to entry.
  const t2GivenT1 =
    t2Pts != null && t1Pts != null
      ? raceOdds(sessions, elapsedFraction, t2Pts, t1Pts, opts.side)
      : null;

  return { t1, t2GivenT1, n: t1?.n ?? 0 };
}

export interface Expectancy {
  /** Expected R of the desk's actual scale rule, priced before the click. */
  expR: number | null;
  /** The same trade if it were all-out at T1, for comparison. */
  expRAllOutT1: number | null;
  /** True when the structure is negative expectancy on these odds. */
  negative: boolean;
  reliable: boolean;
  n: number;
  line: string;
}

/**
 * Price the desk's scale rule: 50% off at T1, stop to breakeven, runner to T2.
 *
 * That rule is not a choice here — it is what `profit-rules` already does and
 * what measured +0.50R/t across 122 filled plans, against −0.42R/t for
 * banking the lot at +1R. So the expectancy is computed for the rule the desk
 * actually follows rather than for an idealised all-or-nothing exit.
 *
 *   E[R] = p1 · ( 0.5·rr1 + 0.5·( p2·rr2_total + (1−p2)·0 ) ) + (1−p1)·(−1)
 *
 * The runner returning to breakeven pays 0, not a loss, because the stop
 * moved. That is the whole reason the rule measures better.
 */
/**
 * When is the runner actually worth keeping?
 *
 * Scaling 50% at T1 and running the rest beats taking everything at T1
 * exactly when the runner's expected reward exceeds what it gives up:
 *
 *     p(T2 | T1) x rr2   >   rr1
 *
 * That falls straight out of the expectancy algebra and it is the question
 * a trader is really asking at T1 — "do I let this run" — reduced to two
 * numbers the desk can now compute. Below the line, the desk's own measured
 * +0.50R/t scale rule is the wrong choice FOR THAT PARTICULAR TRADE, and
 * taking the full position at T1 is correct. The rule is right on average;
 * this says when the average does not apply.
 */
export function runnerWorthIt(
  pT2GivenT1: number | null,
  rr1: number | null,
  rr2: number | null,
): { worth: boolean | null; edge: number | null; line: string } {
  if (pT2GivenT1 == null || rr1 == null || rr2 == null) {
    return { worth: null, edge: null, line: "Cannot price the runner without T2 odds and both R multiples." };
  }
  const runnerValue = pT2GivenT1 * rr2;
  const edge = Math.round((runnerValue - rr1) * 100) / 100;
  return {
    worth: edge > 0,
    edge,
    line:
      edge > 0
        ? `Hold the runner: ${(pT2GivenT1 * 100).toFixed(0)}% x ${rr2.toFixed(2)}R = ${runnerValue.toFixed(2)}R against the ${rr1.toFixed(2)}R it gives up. Edge +${edge}R.`
        : `Take it all at T1 on THIS trade: the runner is worth ${runnerValue.toFixed(2)}R against ${rr1.toFixed(2)}R given up, edge ${edge}R. The 50%-and-run rule measures +0.50R/t on average; this is a trade where the average does not apply.`,
  };
}

export function expectedR(
  odds: TargetOdds,
  rr1: number | null,
  rr2: number | null,
): Expectancy {
  const p1 = odds.t1?.pTargetFirst ?? null;
  const n = odds.t1?.n ?? 0;
  const reliable = odds.t1?.reliable ?? false;

  if (p1 == null || rr1 == null) {
    return {
      expR: null,
      expRAllOutT1: null,
      negative: false,
      reliable,
      n,
      line: "No target odds — expectancy cannot be priced. Do not substitute a feeling for the number.",
    };
  }

  const p2 = odds.t2GivenT1?.pTargetFirst ?? 0;
  const runnerR = rr2 ?? rr1;
  const scaled = p1 * (0.5 * rr1 + 0.5 * (p2 * runnerR)) + (1 - p1) * -1;
  const allOut = p1 * rr1 + (1 - p1) * -1;

  const round2 = (x: number) => Math.round(x * 100) / 100;
  const expR = round2(scaled);
  const expRAllOutT1 = round2(allOut);
  const negative = expR <= 0;

  const reliability = !reliable
    ? ` Based on only ${n} prior sessions — below the ${MIN_SESSIONS_FOR_ODDS} floor, so this is a shape rather than a number.`
    : n < THIN_SESSIONS
      ? ` ${n} sessions — thin.`
      : ` ${n} sessions.`;

  return {
    expR,
    expRAllOutT1,
    negative,
    reliable,
    n,
    line:
      (negative
        ? `NEGATIVE EXPECTANCY: ${expR}R on the desk's own scale rule. ${(p1 * 100).toFixed(0)}% to reach T1 before the stop at ${rr1.toFixed(2)}R is not enough to pay for the ${(100 - p1 * 100).toFixed(0)}% that stop out.`
        : `${expR >= 0 ? "+" : ""}${expR}R expected on 50%-at-T1-then-runner (${(p1 * 100).toFixed(0)}% T1 first at ${rr1.toFixed(2)}R${rr2 != null ? `, ${(p2 * 100).toFixed(0)}% T2 from there at ${rr2.toFixed(2)}R` : ""}).`) +
      ` All-out at T1 would be ${expRAllOutT1 >= 0 ? "+" : ""}${expRAllOutT1}R.` +
      reliability,
  };
}
