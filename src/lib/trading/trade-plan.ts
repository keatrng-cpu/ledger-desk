/**
 * The numeric trade plan — the layer that was missing.
 *
 * WHY THIS EXISTS
 * The desk computes real prices and then immediately stringifies them:
 * `SmcMasterBook.entry` is `"IFVG 24180.25–24195.50"`, `t1` is
 * `"PDH 24030.00"`, `invalidation` is `"Beyond the sweep extreme"`. Once a
 * level is prose it can be printed and nothing else — it cannot be drawn on a
 * chart, measured for R, or checked against the live price. That is the
 * mechanical reason the desk reads as a wall of words: the numbers were thrown
 * away at the last step, so words were the only thing left to render.
 *
 * `parseZoneMid()` in simulate-path-trade.ts already exists to claw a number
 * back out of one of those strings, which is the tell. This module removes the
 * need: the plan carries the numbers, and the prose becomes a VIEW of the plan
 * rather than the plan itself. Chart and text then render from one object and
 * can never disagree.
 *
 * DERIVE, NEVER INVENT
 * Every field here comes from something the tape actually printed — a sweep
 * wick, an array boundary, a liquidity level, the dealing range. Where a level
 * cannot be derived it is `null`, and the chart draws nothing rather than
 * drawing a guess. A plausible-looking line at a price that was never computed
 * is worse than a gap, because a gap is visibly a gap.
 *
 * AND WHAT THE PLAN IS WORTH
 * Prices alone still leave the trader multiplying in their head. The plan now
 * also carries the two first-passage races behind it — T1 against the stop,
 * T2 against breakeven once the stop has moved there — and the expectancy
 * that falls out of them, so "1.8R to T1" and "72% reach" stop being two
 * numbers on different parts of the board that nothing ever combined. See
 * `PlanWorth`, and target-odds.ts for why the 72% was never the number the
 * trade was asking about.
 */

import type { OhlcBar } from "../market/types";
import type { SmcArray } from "./smc-board";
import { atrOf, groupSessions, type LiquidityTarget, type SessionSlice } from "./draw";
import { MAX_RISK_PTS, DEFAULT_MAX_RISK_PTS, maxRiskPtsFor } from "./simulate-path-trade";
import {
  expectedR,
  runnerWorthIt,
  targetOdds,
  MIN_SESSIONS_FOR_ODDS,
  type TargetOdds,
} from "./target-odds";

export type PlanSide = "long" | "short";

/** One horizontal level worth drawing. */
export interface PlanLevel {
  kind: "entry" | "stop" | "t1" | "t2" | "sweep" | "eq" | "price";
  price: number;
  label: string;
}

/**
 * What the trade is worth, priced before the click.
 *
 * TWO DIFFERENT QUESTIONS, AND THE BOARD WAS ONLY ANSWERING THE EASY ONE
 * `draw.ts` measures maximum favourable excursion: "in what fraction of prior
 * sessions did price EVER travel this far from here". That is a real,
 * carefully time-conditioned measurement and it is the right answer to the
 * question "is this level in reach at all" — it is what `pT1Touch` carries
 * and what `plan.draw.reachProbability` has always been.
 *
 * It is not the question a trade asks. A trade asks "does T1 print BEFORE my
 * stop does", a first-passage race between two levels, and the stop does not
 * appear in the excursion number at all. The gap is never in the trader's
 * favour: measured on the committed 15m history
 * (scripts/measure-target-odds.mjs), ES 15% into the session on a 2R target
 * reads 61% by touch and 36% by the race — +0.83R of claimed expectancy
 * against +0.08R of real one, concentrated in the NY AM window this desk
 * actually trades. `pT1First` is the race. Both are kept, and each is
 * labelled with the question it answers, because deleting the touch number
 * would throw away a good measurement of a different thing.
 *
 * NULL IS THE HONEST ANSWER BELOW THE FLOOR
 * Every numeric field here is `null` unless the race cleared
 * `MIN_SESSIONS_FOR_ODDS` prior sessions. A percentage from four sessions can
 * only be 0, 25, 50, 75 or 100 and renders identically to one from forty;
 * a headline number has no room for that caveat, so below the floor there is
 * no headline number. `n` and `reliable` travel with every field and `line`
 * still describes the shape.
 */
export interface PlanWorth {
  /** p(T1 before the stop) — the race. Null below the odds floor. */
  pT1First: number | null;
  /** p(T1 ever touched), ignoring the stop — the excursion question. */
  pT1Touch: number | null;
  /** How many percentage points the touch number overstates the race by. */
  overstatementPts: number | null;
  /** p(T2 before breakeven | T1 printed) — the runner's own race. */
  pT2GivenT1: number | null;
  /** Expected R of the desk's own scale rule: 50% at T1, stop to BE, runner. */
  expR: number | null;
  /** The same trade taken all-out at T1, for comparison. */
  expRAllOutT1: number | null;
  /** True when the structure is negative expectancy on these odds. */
  negative: boolean | null;
  /** p(T2|T1)·rr2 > rr1 — whether the runner earns what it gives up. */
  runnerWorthIt: boolean | null;
  /** The runner's edge in R. Positive means hold it. */
  runnerEdgeR: number | null;
  /** Prior sessions behind the T1 race. */
  n: number;
  reliable: boolean;
  /** One compact clause a board line can append. Always safe to print. */
  headline: string;
  /** The full expectancy sentence. */
  line: string;
  /** The full runner sentence. */
  runnerLine: string;
}

export interface TradePlan {
  symbol: string;
  side: PlanSide;
  /** Live price at the time the plan was built. */
  price: number;

  /** Midpoint of the entry array — where a limit would rest. */
  entry: number;
  /** The array itself, so the chart can shade the zone rather than a hairline. */
  entryZone: { top: number; bottom: number } | null;

  /** Beyond the sweep extreme, or the array's far edge when there was no raid. */
  stop: number;
  /** Points of risk per unit. */
  riskPts: number;
  /**
   * The stop is inside the noise it is meant to survive.
   *
   * Measured, not asserted: on 387 resolved shadow trades, plans whose risk
   * was under 0.25 x ATR(14) won 0 of 31 (z = -4.49 against the rest), and
   * excluding them lifts expectancy on what remains from +0.062R to +0.132R.
   * 0.25 is the last multiple where the rejected set wins literally nothing —
   * at 0.30 it starts taking winners with it.
   *
   * WHY IT IS A FLAG AND NOT A REFUSAL. The levels are real; what is wrong is
   * the CONFIDENCE they imply. A 1.31pt stop on ES prices a 28R target and
   * tells sleeve-sizing that $150 of risk sits five ticks away. So the plan is
   * still drawn — the trader can see the array and the draw — and everything
   * that SIZES or SCORES off the risk refuses instead.
   */
  /** Stop inside MIN_RISK_ATR x ATR — measured -0.48R/card, both halves. */
  riskTooTight: boolean;
  /**
   * Stop beyond MAX_RISK_ATR_TRADABLE x ATR — measured -0.12R/card, both halves.
   * Separate from `riskOverCap`, which is the far wider "this invalidation is
   * a structural landmark" refusal. A plan can be inside the cap and still
   * outside the band where expectancy was positive.
   */
  riskTooWide: boolean;
  /** ATR(14) the risk was judged against, for the message. Null without bars. */
  riskAtr: number | null;
  /** True when risk exceeds this symbol's cap — the plan is real but too wide. */
  riskOverCap: boolean;

  /** Nearest draw (IRL). Null when nothing viable sits in the direction. */
  t1: number | null;
  /** Range extreme in the direction (ERL). Null when the range is unknown. */
  t2: number | null;
  rr1: number | null;
  rr2: number | null;

  /** The raid this setup is built on. */
  sweep: { price: number; t: number | null } | null;
  /** Dealing range, for premium / equilibrium / discount shading. */
  range: { high: number; low: number; eq: number } | null;
  /** Named draw on liquidity, with its measured reach rate. */
  draw: { price: number; name: string; reachProbability: number } | null;

  /** PD arrays worth shading. Already filtered to the ones that matter. */
  arrays: SmcArray[];

  /** Flat list for axis labelling — derived, never a second source of truth. */
  levels: PlanLevel[];

  /**
   * The two first-passage races behind this plan, each carrying its own n.
   *
   * Optional rather than `| null` for one reason: `learn/cases.ts` builds a
   * TradePlan literal by hand for the chase counterfactual, and that plan has
   * no session history behind it. So `undefined` means "nobody priced this",
   * `null` means "priced, and there was no usable history" — both render as
   * no odds, and neither may be read as a zero.
   */
  odds?: TargetOdds | null;

  /**
   * The plan's expectancy, with the runner decision attached. This is the
   * number a trader needs before the click and the desk has never shown it:
   * `rr1` and the draw's reach percentage lived in different places and
   * nothing ever multiplied them.
   */
  worth?: PlanWorth | null;
}

/**
 * The floor, as a multiple of ATR(14) on the graded series.
 *
 * History, kept because the number moved twice: 0.25 was first set on 387
 * shadow refusals (0 of 31 won below it). The four-year capture then showed
 * every band under 0.5 losing in BOTH halves, so the floor moved to 0.5 and
 * gained a ceiling (below).
 */
export const MIN_RISK_ATR = 0.5;

/**
 * And the CEILING, which the original sweep never looked for.
 *
 * Re-measured 2026-09-25 by scripts/build-evidence-pack.mjs on 3,501 filled
 * plans from the four-year capture, under the rule AS CODED (limit at CE, 50%
 * at T1, stop to BE, runner to T2, ties against, the fill bar cannot also
 * score T1). Mean R per card, day-clustered 95% interval:
 *
 *   risk/ATR     ALL                    2022-24   2025-26   verdict
 *   <0.5       -0.484 [-0.71, -0.26]    -0.476    -0.498    NEGATIVE
 *   0.5-0.75   +0.088 [-0.39, +0.57]    -0.145    +0.418    mixed
 *   0.75-1     +0.077 [-0.24, +0.40]    +0.118    +0.006    mixed
 *   1-1.5      -0.029 [-0.29, +0.23]    +0.030    -0.137    mixed
 *   1.5+       -0.120 [-0.23, -0.01]    -0.119    -0.123    NEGATIVE
 *
 *   inside 0.5-1.5   n=1327  +0.033R  (IS +0.014, OOS +0.066)  mixed
 *   outside          n=2174  -0.244R  (IS -0.242, OOS -0.248)  NEGATIVE
 *
 * CORRECTION to what shipped with this constant (commit 68799e1): the band
 * was first quoted at +0.059 IS / +0.058 OOS. That came from a simulator that
 * banked 75% at T1 (the coded rule is 50%) and let the fill bar also score
 * T1. Under the rule as coded the inside of the band is roughly breakeven and
 * NOT distinguishable from zero. What survives, in both halves and with an
 * interval clear of zero, is the OUTSIDE: under 0.5 and over 1.5 lose. The
 * band's value is the losses it refuses, not an edge inside it.
 *
 * WHAT THIS IS NOT. It is not a direction filter and cannot become one: it
 * reads only |entry - stop| against ATR and never looks at side, bias or
 * score. It decides which geometries are worth sizing, not which way to face.
 */
export const MAX_RISK_ATR_TRADABLE = 1.5;

export interface BuildPlanInput {
  symbol: string;
  side: PlanSide | null;
  price: number;
  /** The fresh same-side array the retrace layer selected. */
  entryArray: SmcArray | null;
  /** Wick extreme of the last real raid (market-narrative lastSweepExtreme). */
  sweepExtreme: number | null;
  sweepT: number | null;
  dol: LiquidityTarget | null;
  range: { high: number; low: number; eq: number } | null;
  arrays?: SmcArray[];
  /**
   * The bar history the book was graded from — the SAME series, so the odds
   * describe this instrument on this timeframe and nothing else.
   *
   * Optional. Without it the plan still prices entry, stop and R exactly as
   * before and simply carries no odds; there is no substitute history and a
   * borrowed one would be a fabricated measurement. Callers that have bars
   * (smc-master passes `desk.left.bars` / `desk.right.bars` straight through)
   * should pass them.
   */
  bars?: OhlcBar[];
}

/**
 * Risk cap for a symbol, matching the simulator.
 *
 * ATR-relative when the plan was built from bars (`maxRiskPtsFor`), the legacy
 * fixed number otherwise. The fixed table is a FLOOR inside that helper, so
 * this can only widen the cap relative to the old behaviour — a plan the desk
 * accepts today can never start failing here.
 */
function maxRiskFor(symbol: string, atr?: number | null): number {
  const root = symbol.replace(/^M/, "");
  const known = MAX_RISK_PTS[symbol] != null ? symbol : root;
  return maxRiskPtsFor(known, atr);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function medianOf(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * How far into a typical session the current one has run, 0–0.95.
 *
 * The races have to start from the same point in the session that the live
 * trade does — a target with four hours left is a different bet from the same
 * target with twenty minutes left, and scoring both against a whole-session
 * sample is how a late target ends up quoted at a morning's odds.
 *
 * DUPLICATED ON PURPOSE, AND IT SHOULD NOT STAY THAT WAY. `drawOnLiquidity`
 * computes this identically and then keeps it as a local, so `DrawRead` has
 * no field to read it from. This mirrors that derivation rather than
 * inventing a second one; if draw.ts ever changes its clock these two drift
 * apart silently. The fix is one exported field on `DrawRead` — see the
 * report accompanying this change. This file does not own draw.ts.
 */
function elapsedFractionOf(sessions: SessionSlice[]): number {
  const current = sessions[sessions.length - 1];
  if (!current?.bars.length) return 0.5;
  const prior = sessions.slice(0, -1);
  const typical = medianOf(prior.map((s) => s.bars.length));
  return Math.min(
    0.95,
    current.bars.length / Math.max(current.bars.length, typical || current.bars.length),
  );
}

/**
 * Turn the two races into the one thing a trader reads before clicking.
 *
 * Nothing here is a gate. The desk's hard target rule is `minRr` and it is
 * enforced in smc-master; a negative expectancy on a thin sample of recent
 * sessions is evidence, not an invalidation, and turning it into a refusal
 * would be a gate change rather than a measurement. It is labelled instead,
 * exactly as the draw's reach tier is.
 */
function priceWorth(odds: TargetOdds, rr1: number | null, rr2: number | null): PlanWorth {
  const race = odds.t1;
  const exp = expectedR(odds, rr1, rr2);
  const runner = runnerWorthIt(odds.t2GivenT1?.pTargetFirst ?? null, rr1, rr2);
  const n = race?.n ?? 0;
  const reliable = race?.reliable ?? false;
  // Below the floor every number becomes null. `line` survives because it
  // says out loud that it is a shape; a bare percentage cannot.
  const only = <T>(v: T | null | undefined): T | null => (reliable ? (v ?? null) : null);
  const pct = (p: number | null) => (p == null ? "?" : `${(p * 100).toFixed(0)}%`);

  const expR = only(exp.expR);
  const headline = reliable
    ? `worth ${expR == null ? "?" : `${expR >= 0 ? "+" : ""}${expR}R`} · T1 ${pct(race?.pTargetFirst ?? null)} before the stop (touch alone says ${pct(race?.pTouchIgnoringStop ?? null)}) · n=${n} sessions`
    : `worth unpriced — ${n} prior session${n === 1 ? "" : "s"}, below the ${MIN_SESSIONS_FOR_ODDS} a race needs`;

  return {
    pT1First: only(race?.pTargetFirst),
    pT1Touch: only(race?.pTouchIgnoringStop),
    overstatementPts: only(race?.overstatementPts),
    pT2GivenT1: reliable && odds.t2GivenT1?.reliable ? (odds.t2GivenT1.pTargetFirst ?? null) : null,
    expR,
    expRAllOutT1: only(exp.expRAllOutT1),
    // `expectedR` reports `negative: false` when it could not price anything
    // at all, which reads as "positive expectancy" to anyone checking the
    // flag. An unpriced trade is neither — it is unknown.
    negative: expR == null ? null : exp.negative,
    runnerWorthIt: reliable && odds.t2GivenT1?.reliable ? runner.worth : null,
    runnerEdgeR: reliable && odds.t2GivenT1?.reliable ? runner.edge : null,
    n,
    reliable,
    headline,
    line: exp.line,
    runnerLine: runner.line,
  };
}

/**
 * Build the numeric plan, or null when the tape has not produced enough to
 * price one.
 *
 * Returning null is a real answer and the common one before a sequence
 * completes. A plan that needs an entry array and a stop cannot be invented
 * from a direction alone.
 */
export function buildTradePlan(input: BuildPlanInput): TradePlan | null {
  const { symbol, side, price, entryArray, sweepExtreme, sweepT, dol, range } = input;
  if (!side) return null;
  if (!Number.isFinite(price) || price <= 0) return null;
  if (!entryArray) return null;
  // A zone with no height is not a zone. The retrace layer's "price is inside
  // the array" test is meaningless for it, and pricing a stop off its edge
  // produces a risk of one pad-floor (0.25pt on MNQ) — arithmetically valid,
  // and a position size roughly two orders of magnitude too large. This is a
  // malformed-input check, not a trading rule: a real FVG/OB always has width.
  if (
    !Number.isFinite(entryArray.top) ||
    !Number.isFinite(entryArray.bottom) ||
    entryArray.top <= entryArray.bottom
  ) {
    return null;
  }

  const long = side === "long";

  // Entry: consequent encroachment (array midpoint) — where the desk's own
  // retrace layer already says a limit belongs.
  const entry = entryArray.mid;

  // The pad the retrace layer uses for "price is inside the array". Reused
  // here so the stop sits just outside the same boundary the gate tests.
  const pad = Math.max((entryArray.top - entryArray.bottom) * 0.25, 0.25);

  // Stop: beyond the raid wick if there was one — that extreme is the level
  // the market already proved it would reject. Without a raid, beyond the far
  // edge of the array, which is the structural invalidation of the array.
  const stopRaw =
    sweepExtreme != null && Number.isFinite(sweepExtreme)
      ? long
        ? Math.min(sweepExtreme, entryArray.bottom) - pad
        : Math.max(sweepExtreme, entryArray.top) + pad
      : long
        ? entryArray.bottom - pad
        : entryArray.top + pad;

  const stop = round2(stopRaw);
  const riskPts = round2(Math.abs(entry - stop));

  /**
   * ATR on the SAME series the book was graded from, so the floor is in the
   * instrument's own units and adapts to the session's volatility. Without
   * bars there is no floor — a fabricated one would be worse than none.
   */
  const atr = input.bars && input.bars.length > 20 ? atrOf(input.bars, 14) : null;
  const riskTooTight = atr != null && atr > 0 && riskPts < atr * MIN_RISK_ATR;
  const riskTooWide =
    atr != null && atr > 0 && riskPts > atr * MAX_RISK_ATR_TRADABLE;
  // A zero-width stop cannot be sized or scored; treat it as no plan rather
  // than emitting an R of Infinity downstream.
  if (!(riskPts > 0)) return null;

  // T1: the named draw, but only when it actually sits in front of the trade.
  // A draw behind the entry is not a target, it is where price came from.
  const dolAhead =
    dol != null &&
    Number.isFinite(dol.price) &&
    (long ? dol.price > entry : dol.price < entry);
  const t1 = dolAhead ? round2(dol!.price) : null;

  // T2: the external liquidity the range itself offers, when it is beyond T1.
  const rangeTarget = range ? (long ? range.high : range.low) : null;
  const t2 =
    rangeTarget != null &&
    (long ? rangeTarget > (t1 ?? entry) : rangeTarget < (t1 ?? entry))
      ? round2(rangeTarget)
      : null;

  const rr = (target: number | null): number | null =>
    target == null ? null : round2(Math.abs(target - entry) / riskPts);
  const rr1 = rr(t1);
  const rr2 = rr(t2);

  // WHAT THE TARGETS ARE ACTUALLY WORTH.
  // Two first-passage races on this instrument's own recent sessions: T1
  // against the stop, then T2 against breakeven — a second race, because the
  // desk's scale rule moves the stop there the moment T1 prints, so the
  // runner is not the first race extended. Both start from the same point in
  // the session the live trade does.
  //
  // KNOWN BIAS, STATED RATHER THAN HIDDEN: the T2 race also starts from the
  // current elapsed point, so it gives the runner the whole rest of the
  // session instead of whatever is left after T1 prints. That is optimistic
  // for T2, by an amount nothing here has measured. Correcting it needs a
  // measured time-to-T1, which target-odds.ts does not compute and this file
  // will not invent.
  const sessions = input.bars?.length ? groupSessions(input.bars) : [];
  // One session is the in-progress one, which raceOdds drops — with fewer
  // than two there is nothing to race against at all.
  const odds =
    sessions.length >= 2
      ? targetOdds(sessions, elapsedFractionOf(sessions), {
          side,
          entry,
          stop,
          t1,
          t2,
        })
      : null;
  const worth = odds ? priceWorth(odds, rr1, rr2) : null;

  const levels: PlanLevel[] = [
    { kind: "price", price: round2(price), label: "live" },
    { kind: "entry", price: round2(entry), label: `entry ${entryArray.kind.toUpperCase()}` },
    { kind: "stop", price: stop, label: "stop" },
  ];
  if (sweepExtreme != null) {
    levels.push({ kind: "sweep", price: round2(sweepExtreme), label: "raid" });
  }
  if (t1 != null) levels.push({ kind: "t1", price: t1, label: dol?.name ?? "T1" });
  if (t2 != null) levels.push({ kind: "t2", price: t2, label: "T2 ERL" });
  if (range) levels.push({ kind: "eq", price: round2(range.eq), label: "EQ" });

  return {
    symbol,
    side,
    price: round2(price),
    entry: round2(entry),
    entryZone: { top: round2(entryArray.top), bottom: round2(entryArray.bottom) },
    stop,
    riskPts,
    riskTooTight,
    riskTooWide,
    riskAtr: atr,
    riskOverCap: riskPts > maxRiskFor(symbol, atr),
    t1,
    t2,
    rr1,
    rr2,
    sweep: sweepExtreme != null ? { price: round2(sweepExtreme), t: sweepT } : null,
    range: range
      ? { high: round2(range.high), low: round2(range.low), eq: round2(range.eq) }
      : null,
    draw: dol
      ? { price: round2(dol.price), name: dol.name, reachProbability: dol.reachProbability }
      : null,
    arrays: input.arrays ?? [],
    levels,
    odds,
    worth,
  };
}

/**
 * The plan rendered as the desk's existing prose.
 *
 * Kept here, next to the numbers, so the sentence and the drawing are two
 * views of ONE object. Previously the sentence WAS the object, which is how
 * they could drift apart without anything noticing.
 */
export function planEntryText(plan: TradePlan): string {
  if (!plan.entryZone) return plan.entry.toFixed(2);
  return `${plan.entryZone.bottom.toFixed(2)}–${plan.entryZone.top.toFixed(2)} · CE ${plan.entry.toFixed(2)}`;
}

export function planRiskText(plan: TradePlan): string {
  const rr = plan.rr1 != null ? ` · ${plan.rr1.toFixed(2)}R to T1` : "";
  const cap = plan.riskOverCap ? " · OVER CAP" : "";
  return `${plan.riskPts.toFixed(2)}pt risk${rr}${cap}`;
}
