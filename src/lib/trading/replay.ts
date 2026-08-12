/**
 * Replay calibration harness — walks a bar series with NO LOOKAHEAD, feeds
 * each truncated prefix to the existing analyzeStructure + the shared
 * `scoreCandidates` (imported read-only), and simulates every emitted
 * candidate forward to answer the floor question ("what does 0.50 vs 0.65
 * admit?") with data.
 *
 * Phase A1: this harness now hands the scorer the SAME inputs the live desk
 * gets — bar slices and a swing-divergence read — so the detector stack, the
 * conditions gate and the draw engine all run. Every calibration number
 * produced before that change described a desk with those switched off and is
 * void; see INTEGRATION-A.md.
 *
 * HONESTY CAVEATS (repeated in the UI):
 * - 15m Yahoo bars — intrabar order of touches is unknown, so when a stop
 *   AND a target land inside one bar we count the STOP (conservative).
 * - Target hits on the fill bar itself are never counted (can't know order).
 * - No slippage, no commission, entry at the zone's proximal edge.
 * - Directional evidence only — NOT a backtest.
 */

import type { OhlcBar } from "@/lib/market/types";
import { getSessionClock } from "./sessions";
import {
  analyzeStructure,
  etSessionKey,
  smtDivergence,
  type HtfBiasRead,
} from "./structure";
import { scoreCandidates } from "./scanner";

/* ------------------------------------------------------------------ */
/* Options + result shapes                                              */
/* ------------------------------------------------------------------ */

export interface ReplayOptions {
  symbol: string;
  peerSymbol: string;
  /** Forward simulation horizon per candidate (bars). 96 × 15m = 24h. */
  maxBars?: number;
  /**
   * Bars of history before the walk starts. 80 matches structure.ts's
   * dealing-range lookback so the first scans see full context.
   */
  warmupBars?: number;
  /**
   * Bars between two simulations of the SAME symbol+side. The scanner emits
   * near-identical candidates on consecutive bars; without a cooldown the
   * sample double-counts one opportunity dozens of times. 12 × 15m = 3h.
   */
  cooldownBars?: number;
}

export type ROutcome = "win" | "loss" | "timeout";

export interface ReplayOutcome {
  /** Timestamp (ms) of the signal bar. */
  t: number;
  symbol: string;
  side: "long" | "short";
  /** Scanner confluence pre-score at signal time. */
  prescore: number;
  grade: string;
  entryFilled: boolean;
  /** First-touch outcome racing stop (−1R) vs +1R target. */
  rAt1R: ROutcome;
  /** Same race vs the +2R target (stop still −1R). */
  rAt2R: ROutcome;
  /** Bars from fill to 1R resolution (maxBars on timeout, 0 if unfilled). */
  barsHeld: number;
}

/* ------------------------------------------------------------------ */
/* Numeric zone/stop derivation (no display-string parsing)             */
/* ------------------------------------------------------------------ */

interface NumericPlan {
  side: "long" | "short";
  /** Entry zone bounds, zoneLow < zoneHigh. */
  zoneLow: number;
  zoneHigh: number;
  /** Entry = proximal edge of the zone (EQ), clamped to first-touch bar. */
  entryEdge: number;
  /** Hard invalidation (PDH/PDL when known, else recent extreme). */
  stop: number;
}

/** Lowest low / highest high of the last `n` bars of a slice. */
function recentExtreme(slice: OhlcBar[], n: number, kind: "low" | "high") {
  const from = Math.max(0, slice.length - n);
  let v = kind === "low" ? Infinity : -Infinity;
  for (let i = from; i < slice.length; i++) {
    const b = slice[i]!;
    v = kind === "low" ? Math.min(v, b.l) : Math.max(v, b.h);
  }
  return v;
}

/**
 * Recompute the candidate's zone numerically from the HtfBiasRead — same
 * dealing-range math the scanner used to print its display strings, but kept
 * as numbers. Long: zone = [range low, EQ], stop = PDL (fallback: lowest low
 * of last 40 bars). Short mirrored. Returns null when no dealing range or a
 * degenerate stop (stop on the wrong side of the entry).
 */
function numericPlan(
  read: HtfBiasRead,
  slice: OhlcBar[],
  side: "long" | "short",
): NumericPlan | null {
  if (!read.dealing) return null;
  const { low, high, eq } = read.dealing;
  if (side === "long") {
    const stop = read.pdl ?? recentExtreme(slice, 40, "low");
    if (!Number.isFinite(stop) || stop >= eq) return null;
    return { side, zoneLow: low, zoneHigh: eq, entryEdge: eq, stop };
  }
  const stop = read.pdh ?? recentExtreme(slice, 40, "high");
  if (!Number.isFinite(stop) || stop <= eq) return null;
  return { side, zoneLow: eq, zoneHigh: high, entryEdge: eq, stop };
}

/* ------------------------------------------------------------------ */
/* Forward simulation                                                   */
/* ------------------------------------------------------------------ */

function simulate(
  bars: OhlcBar[],
  fromIndex: number,
  plan: NumericPlan,
  maxBars: number,
): { entryFilled: boolean; rAt1R: ROutcome; rAt2R: ROutcome; barsHeld: number } {
  const end = Math.min(bars.length, fromIndex + maxBars);
  let fillBar = -1;
  let entry = NaN;

  // Entry: first bar whose range overlaps the zone. Entry price = bar open
  // clamped into the zone (a gap through the zone fills at the open).
  for (let j = fromIndex; j < end; j++) {
    const b = bars[j]!;
    if (b.h >= plan.zoneLow && b.l <= plan.zoneHigh) {
      fillBar = j;
      entry = Math.min(Math.max(b.o, plan.zoneLow), plan.zoneHigh);
      break;
    }
  }
  if (fillBar < 0) {
    return { entryFilled: false, rAt1R: "timeout", rAt2R: "timeout", barsHeld: 0 };
  }

  const risk = Math.abs(entry - plan.stop);
  if (!(risk > 0)) {
    return { entryFilled: false, rAt1R: "timeout", rAt2R: "timeout", barsHeld: 0 };
  }
  const t1 = plan.side === "long" ? entry + risk : entry - risk;
  const t2 = plan.side === "long" ? entry + 2 * risk : entry - 2 * risk;

  let rAt1R: ROutcome = "timeout";
  let rAt2R: ROutcome = "timeout";
  let barsHeld = maxBars;

  for (let j = fillBar; j < end; j++) {
    const b = bars[j]!;
    const stopHit = plan.side === "long" ? b.l <= plan.stop : b.h >= plan.stop;
    // Conservative: stop checked FIRST — same-bar stop+target counts as stop.
    if (stopHit) {
      if (rAt1R === "timeout") {
        rAt1R = "loss";
        barsHeld = j - fillBar;
      }
      if (rAt2R === "timeout") rAt2R = "loss";
      break;
    }
    // Never count a target on the fill bar itself (intrabar order unknown).
    if (j === fillBar) continue;
    const hit1 = plan.side === "long" ? b.h >= t1 : b.l <= t1;
    const hit2 = plan.side === "long" ? b.h >= t2 : b.l <= t2;
    if (hit1 && rAt1R === "timeout") {
      rAt1R = "win";
      barsHeld = j - fillBar;
    }
    if (hit2 && rAt2R === "timeout") {
      rAt2R = "win";
    }
    if (rAt1R !== "timeout" && rAt2R !== "timeout") break;
  }

  return { entryFilled: true, rAt1R, rAt2R, barsHeld };
}

/* ------------------------------------------------------------------ */
/* Bar-by-bar walk (no lookahead)                                       */
/* ------------------------------------------------------------------ */

/**
 * Percent change of the slice's last close vs its CME session's first open
 * (18:00 ET roll, via `etSessionKey` — same session boundary `structure.ts`
 * uses everywhere else). Previously grouped by plain UTC calendar date: for
 * roughly the first ~5 hours of every session (18:00–23:00 ET, still "today"
 * in UTC during EST) that misattributed the new session's early bars to the
 * PRIOR session's range, understating/overstating changePct — the only
 * signal driving the changePct-spread fallback in smtRead. Since A1 the
 * scorer also receives a real `smtDivergence(slice, peerSlice)` read, which
 * takes priority — but changePct still colours the note and still decides SMT
 * when no swing divergence is active.
 */
function dayChangePct(slice: OhlcBar[]): number {
  const last = slice[slice.length - 1]!;
  const dayKey = etSessionKey(last.t);
  for (const b of slice) {
    if (etSessionKey(b.t) === dayKey) {
      return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
    }
  }
  return 0;
}

/**
 * Walk `bars` one bar at a time. At step i only bars[0..i] (and peer bars
 * with t <= bars[i].t) are visible to structure + scanner — strict
 * no-lookahead. Every non-skip candidate for `symbol` is simulated forward
 * from bar i+1.
 */
export function replayScan(
  bars: OhlcBar[],
  peerBars: OhlcBar[],
  opts: ReplayOptions,
): ReplayOutcome[] {
  const maxBars = opts.maxBars ?? 96;
  const warmup = opts.warmupBars ?? 80;
  const cooldown = opts.cooldownBars ?? 12;
  const outcomes: ReplayOutcome[] = [];
  const lastEmit = new Map<string, number>();

  let peerIdx = 0; // peerBars sorted ascending by t (Yahoo parser guarantees)

  for (let i = warmup; i < bars.length - 1; i++) {
    const now = bars[i]!;
    const slice = bars.slice(0, i + 1);
    while (peerIdx < peerBars.length && peerBars[peerIdx]!.t <= now.t) {
      peerIdx++;
    }
    const peerSlice = peerBars.slice(0, peerIdx);
    if (peerSlice.length < 30) continue;

    // Historical clock: getSessionClock takes a Date — pass the bar's time.
    const clock = getSessionClock(new Date(now.t));

    const read = analyzeStructure(opts.symbol, slice, dayChangePct(slice));
    const peerRead = analyzeStructure(
      opts.peerSymbol,
      peerSlice,
      dayChangePct(peerSlice),
    );
    // Phase A1. `slice` is bars[0..i] and `peerSlice` is every peer bar with
    // t <= bars[i].t — both are strict PREFIXES, so handing them to the
    // scorer adds no lookahead whatsoever; it only stops hiding the detector
    // stack from the calibration harness. Until this call passed them the
    // scanner ran with barsL = [], which meant summarizeDetectors returned
    // nothing, assessConditions gated on nothing, and the draw engine was
    // skipped — so replay scored a desk that does not exist.
    const scan = scoreCandidates(read, peerRead, clock, {
      divergence: smtDivergence(slice, peerSlice),
      leftBars: slice,
      rightBars: peerSlice,
    });

    for (const cand of scan.candidates) {
      if (cand.symbol !== opts.symbol) continue; // peer only feeds SMT
      if (cand.grade === "skip") continue;

      const key = `${cand.symbol}-${cand.side}`;
      const last = lastEmit.get(key);
      if (last != null && i - last < cooldown) continue;

      const plan = numericPlan(read, slice, cand.side);
      if (!plan) continue;

      const sim = simulate(bars, i + 1, plan, maxBars);
      lastEmit.set(key, i);
      outcomes.push({
        t: now.t,
        symbol: cand.symbol,
        side: cand.side,
        prescore: cand.confluence,
        grade: cand.grade,
        entryFilled: sim.entryFilled,
        rAt1R: sim.rAt1R,
        rAt2R: sim.rAt2R,
        barsHeld: sim.barsHeld,
      });
    }
  }

  return outcomes;
}

/* ------------------------------------------------------------------ */
/* Calibration report                                                   */
/* ------------------------------------------------------------------ */

export interface CalibrationBucket {
  label: string;
  min: number;
  /** Exclusive upper bound (Infinity for the top bucket). */
  max: number;
  n: number;
  filled: number;
  fillRate: number;
  /** 1R stats among FILLED candidates that resolved (win or loss). */
  resolved1R: number;
  wins1R: number;
  winRate1R: number;
  /** Expectancy in R at 1R:1 among resolved: (w − l) / resolved. */
  expectancy1R: number;
  resolved2R: number;
  wins2R: number;
  winRate2R: number;
  /** Expectancy in R at 2R:1 among resolved: (2w − l) / resolved. */
  expectancy2R: number;
  timeouts: number;
}

export interface FloorRow {
  floor: number;
  admitted: number;
  admittedPct: number;
  fillRate: number;
  /**
   * Trades that actually resolved win/loss (not unfilled, not timeout) at
   * each R target — the true denominator behind winRate/expectancy. A UI
   * MUST gate on these, not on `admitted`: a floor can admit candidates that
   * all fill and all time out, which is n=0 resolved but was previously
   * rendered as a confident "0% win, 0.00R" — indistinguishable from "3
   * trades, all losers."
   */
  resolved1R: number;
  winRate1R: number;
  expectancy1R: number;
  resolved2R: number;
  winRate2R: number;
  expectancy2R: number;
}

export interface CalibrationReport {
  total: number;
  buckets: CalibrationBucket[];
  /** Cumulative "what does this floor admit" rows — the floor question. */
  floors: FloorRow[];
}

// Lower edge is 0, not 0.4: the scanner's own skip cutoff is
// `floor - 0.12` (scanner.ts grade()), which is 0.38 at the current 0.50
// floor — a "B" candidate at 0.38–0.40 is a real, non-skip outcome that used
// to land in `outcomes` but match no bucket here, so bucket totals silently
// undercounted `report.total`. 0 as the floor keeps this correct regardless
// of where APLUS_RULES.confluenceFloor moves.
const BUCKET_EDGES: { label: string; min: number; max: number }[] = [
  { label: "<0.5", min: 0, max: 0.5 },
  { label: "0.5–0.6", min: 0.5, max: 0.6 },
  { label: "0.6–0.7", min: 0.6, max: 0.7 },
  { label: "0.7+", min: 0.7, max: Infinity },
];

/** Floors we care about: TEST 0.50, mid, calibration 0.67, 0.70, A+ 0.75. */
const FLOOR_CANDIDATES = [0.5, 0.6, 0.65, 0.7, 0.75];

function stats(rows: ReplayOutcome[]) {
  const filled = rows.filter((r) => r.entryFilled);
  const res1 = filled.filter((r) => r.rAt1R !== "timeout");
  const w1 = res1.filter((r) => r.rAt1R === "win").length;
  const res2 = filled.filter((r) => r.rAt2R !== "timeout");
  const w2 = res2.filter((r) => r.rAt2R === "win").length;
  return {
    n: rows.length,
    filled: filled.length,
    fillRate: rows.length ? filled.length / rows.length : 0,
    resolved1R: res1.length,
    wins1R: w1,
    winRate1R: res1.length ? w1 / res1.length : 0,
    expectancy1R: res1.length ? (w1 - (res1.length - w1)) / res1.length : 0,
    resolved2R: res2.length,
    wins2R: w2,
    winRate2R: res2.length ? w2 / res2.length : 0,
    expectancy2R: res2.length ? (2 * w2 - (res2.length - w2)) / res2.length : 0,
    timeouts: filled.length - res1.length,
  };
}

export function calibrationReport(outcomes: ReplayOutcome[]): CalibrationReport {
  const buckets: CalibrationBucket[] = BUCKET_EDGES.map((e) => {
    const rows = outcomes.filter(
      (o) => o.prescore >= e.min && o.prescore < e.max,
    );
    const s = stats(rows);
    return { label: e.label, min: e.min, max: e.max, ...s };
  });

  const floors: FloorRow[] = FLOOR_CANDIDATES.map((floor) => {
    const rows = outcomes.filter((o) => o.prescore >= floor);
    const s = stats(rows);
    return {
      floor,
      admitted: s.n,
      admittedPct: outcomes.length ? s.n / outcomes.length : 0,
      fillRate: s.fillRate,
      resolved1R: s.resolved1R,
      winRate1R: s.winRate1R,
      expectancy1R: s.expectancy1R,
      resolved2R: s.resolved2R,
      winRate2R: s.winRate2R,
      expectancy2R: s.expectancy2R,
    };
  });

  return { total: outcomes.length, buckets, floors };
}
