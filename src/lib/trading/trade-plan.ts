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
 */

import type { SmcArray } from "./smc-board";
import type { LiquidityTarget } from "./draw";
import { MAX_RISK_PTS, DEFAULT_MAX_RISK_PTS } from "./simulate-path-trade";

export type PlanSide = "long" | "short";

/** One horizontal level worth drawing. */
export interface PlanLevel {
  kind: "entry" | "stop" | "t1" | "t2" | "sweep" | "eq" | "price";
  price: number;
  label: string;
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
}

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
}

/** Risk cap for a symbol, matching the simulator's table. */
function maxRiskFor(symbol: string): number {
  const root = symbol.replace(/^M/, "");
  return MAX_RISK_PTS[symbol] ?? MAX_RISK_PTS[root] ?? DEFAULT_MAX_RISK_PTS;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
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
    riskOverCap: riskPts > maxRiskFor(symbol),
    t1,
    t2,
    rr1: rr(t1),
    rr2: rr(t2),
    sweep: sweepExtreme != null ? { price: round2(sweepExtreme), t: sweepT } : null,
    range: range
      ? { high: round2(range.high), low: round2(range.low), eq: round2(range.eq) }
      : null,
    draw: dol
      ? { price: round2(dol.price), name: dol.name, reachProbability: dol.reachProbability }
      : null,
    arrays: input.arrays ?? [],
    levels,
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
