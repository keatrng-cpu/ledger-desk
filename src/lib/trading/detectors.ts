/**
 * Deterministic OHLC detectors — TS port of the Trading-Automation engine's
 * highest-signal components (FVG/iFVG, displacement, order blocks, mechanical
 * model). Pure math on `OhlcBar[]` — no LLM, no network, no lookahead beyond
 * the array handed in. Every threshold is a named constant with a comment.
 *
 * NOT wired into scanner.ts here — the integrator wires it (see
 * INTEGRATION-P2.md at repo root for the exact extension points + suggested
 * weights from src/lib/aplus/confluence.ts).
 */

import { GATE } from "./gate-tuning";
import type { OhlcBar } from "@/lib/market/types";

/* ------------------------------------------------------------------ */
/* Thresholds — every knob documented                                   */
/* ------------------------------------------------------------------ */

/** ATR lookback (bars). Engine uses 14-bar rolling range mean. */
export const ATR_PERIOD = 14;

/**
 * Displacement: candle body |c-o| must be >= K × rolling ATR(14) of bar
 * ranges. Engine default K = 1.5 — a body 1.5× the average range is an
 * institutional push, not noise.
 */
/**
 * Original displacement multiple. The LIVE value is GATE.displacementK
 * (gate-tuning.ts); this constant stays exported for the curriculum and the
 * calibration harness that quote the original rule.
 */
export const DISPLACEMENT_K = 1.5;

/**
 * FVG qualification: the middle candle (bar[i-1]) of the 3-bar window must
 * have a body >= 1.0 × ATR(14). A gap left by a sub-average candle is noise;
 * requiring a displacement-grade middle body keeps FVGs meaningful without
 * demanding the full 1.5× displacement threshold.
 */
export const FVG_MIDDLE_BODY_ATR = 0;

/**
 * Order block: how many consecutive same-direction candles we walk back
 * through from the displacement candle to find the last opposing candle.
 * 3 = the opposing candle must sit immediately before the (≤3-candle) move.
 */
export const OB_SCAN_BACK = 3;

/**
 * Mechanical model: displacement must occur within N bars after the sweep.
 * Engine uses N = 6 — a reversal that takes longer is not "mechanical".
 *
 * N is a BAR count, and that is the bug: the desk grades on a 15m series, so
 * 6 bars is NINETY MINUTES. The trader's model is "the next 1m-5m close after
 * the raid, within a handful of those candles" — a displacement an hour and a
 * half later is a different story, not the answer to that raid. The live
 * window is now `mechanicalWindowBars(bars)`, which reads the series' own bar
 * spacing. This constant stays exported as the original rule (the curriculum,
 * the sweep harness and raid-pair.ts quote it) and as the CEILING.
 */
export const MM_DISPLACE_WITHIN = 6;

/**
 * The mechanical confirmation window in MINUTES — the unit the model is
 * actually stated in. 30 minutes: on the 5m rung that is 6 candles (exactly
 * the original handful), on 1m it is capped back to 6 by MM_DISPLACE_WITHIN,
 * and on the desk's 15m structure series it is 2 candles instead of 6.
 *
 * NOT a measured number — it is the trader's own description of the model
 * converted to a unit that survives a change of timeframe. What it buys is
 * one-directional: `mechanicalWindowBars` takes the MINIMUM of this and the
 * original bar count, so no series anywhere gets a LOOSER window than it has
 * today. The 15m tightening (6 -> 2) is the fix ITEM 6 asks for.
 */
export const MM_DISPLACE_WITHIN_MINUTES = 30;

/**
 * Which unit the mechanical window is measured in. "minutes" is live;
 * "bars" restores the pre-2026-10-08 behaviour exactly (a flat 6 bars on
 * every series). Mutable for the same reason GATE is: scripts/sweep-gates.mjs
 * flips a knob between runs so every variant goes through the live code path.
 * At runtime nothing writes to it.
 */
export const MM_WINDOW: { mode: "minutes" | "bars" } = { mode: "minutes" };

/** Swing fractal width for sweep reference points (left/right bars). */
export const MM_SWING_WIDTH = 3;

/**
 * Mechanical model lifecycle: an ARMED sequence (`displaced` / `inverted` /
 * `retest_ready`) is abandoned this many bars after its most recent leg when
 * the retest never arrives. 24 bars × 15m = 6h — one full RTH session. A zone
 * price has not returned to within a session has been repriced past; the
 * engine treats it as consumed.
 *
 * Before this existed the state machine had NO expiry whatsoever, and because
 * the selection rule ranked purely by state a `retest_ready` from 300+ bars
 * ago outranked every fresh sequence forever.
 */
export const MM_MAX_ARMED_AGE = 24;

/**
 * A COMPLETE sequence stops being a live signal this many bars after its
 * retest. 8 bars × 15m = 2h. Deliberately shorter than MM_MAX_ARMED_AGE: an
 * un-triggered zone can still be revisited, but an entry that has already
 * been offered and not taken cannot be re-taken.
 */
export const MM_MAX_COMPLETE_AGE = 8;

/** Minimum bars before any detector output (ATR + fractals need history). */
export const MIN_BARS = ATR_PERIOD + 2 * MM_SWING_WIDTH + 3;

/* ------------------------------------------------------------------ */
/* Shared helpers                                                       */
/* ------------------------------------------------------------------ */

/**
 * Rolling ATR of plain bar ranges (h-l), simple mean over the previous
 * `period` bars EXCLUDING bar i itself (so a huge candle never inflates the
 * baseline it is measured against). Returns NaN until enough history.
 */
export function rollingAtr(bars: OhlcBar[], period = ATR_PERIOD): number[] {
  const out: number[] = new Array<number>(bars.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    if (i >= period) {
      out[i] = sum / period;
      sum -= bars[i - period]!.h - bars[i - period]!.l;
    }
    sum += bars[i]!.h - bars[i]!.l;
  }
  return out;
}

function body(b: OhlcBar): number {
  return Math.abs(b.c - b.o);
}

/** Consecutive-bar deltas sampled for `barSpanMs`. 60 is long enough that the
 *  overnight/weekend gaps in a session series stay a minority of the sample,
 *  so the MEDIAN is the true spacing. */
export const BAR_SPAN_SAMPLE = 60;

/**
 * The series' own bar spacing in ms, as the median of the last
 * BAR_SPAN_SAMPLE positive timestamp deltas. Median, not mean: a session gap
 * (17:00 -> 18:00 ET) or a feed hole would drag a mean to nonsense, and the
 * desk's 15m series carries both. NaN with fewer than two bars.
 *
 * This is the one place a detector is allowed to ask "what timeframe am I
 * on?" — every window expressed in minutes derives from it.
 */
export function barSpanMs(bars: OhlcBar[]): number {
  if (bars.length < 2) return NaN;
  const from = Math.max(1, bars.length - BAR_SPAN_SAMPLE);
  const deltas: number[] = [];
  for (let i = from; i < bars.length; i++) {
    const d = bars[i]!.t - bars[i - 1]!.t;
    if (d > 0) deltas.push(d);
  }
  if (!deltas.length) return NaN;
  deltas.sort((a, b) => a - b);
  return deltas[Math.floor(deltas.length / 2)]!;
}

/**
 * The mechanical confirmation window for THIS series, in bars: the tighter of
 * MM_DISPLACE_WITHIN_MINUTES of clock time and the original MM_DISPLACE_WITHIN
 * bar count, floored at 1 (a window of zero bars could never confirm
 * anything, which would be a silent kill switch rather than a tightening).
 *
 * Falls back to MM_DISPLACE_WITHIN whenever the spacing cannot be read — a
 * series with one bar, or every timestamp identical. Fails to TODAY'S
 * behaviour, never to "no window".
 */
export function mechanicalWindowBars(bars: OhlcBar[]): number {
  if (MM_WINDOW.mode === "bars") return MM_DISPLACE_WITHIN;
  const span = barSpanMs(bars);
  if (!Number.isFinite(span) || span <= 0) return MM_DISPLACE_WITHIN;
  const byMinutes = Math.floor((MM_DISPLACE_WITHIN_MINUTES * 60_000) / span);
  return Math.max(1, Math.min(MM_DISPLACE_WITHIN, byMinutes));
}

export interface SwingPoint {
  index: number;
  t: number;
  price: number;
  kind: "high" | "low";
}

/**
 * Fractal swing points (local extreme vs `width` bars each side). Confirmed
 * only `width` bars after the extreme — callers must not treat a swing as
 * known before bar `index + width`.
 */
export function fractalSwings(
  bars: OhlcBar[],
  width = MM_SWING_WIDTH,
): SwingPoint[] {
  const out: SwingPoint[] = [];
  for (let i = width; i < bars.length - width; i++) {
    const b = bars[i]!;
    let isH = true;
    let isL = true;
    for (let j = i - width; j <= i + width; j++) {
      if (j === i) continue;
      if (bars[j]!.h >= b.h) isH = false;
      if (bars[j]!.l <= b.l) isL = false;
    }
    if (isH) out.push({ index: i, t: b.t, price: b.h, kind: "high" });
    if (isL) out.push({ index: i, t: b.t, price: b.l, kind: "low" });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* FVG / iFVG                                                           */
/* ------------------------------------------------------------------ */

export type FvgFill = "none" | "partial" | "full";

export interface FvgResult {
  /** Direction of the ORIGINAL gap. */
  kind: "bull" | "bear";
  /** Index/time of bar[i] — the third candle that completes the gap. */
  createdIndex: number;
  createdT: number;
  /** Gap bounds: bull gap = [bar[i-2].h, bar[i].l]; bear = [bar[i].h, bar[i-2].l]. */
  top: number;
  bottom: number;
  /** Middle-candle body vs ATR at creation (>= FVG_MIDDLE_BODY_ATR by construction). */
  middleBodyAtrRatio: number;
  /** Fill status: partial = traded into the gap, full = traded through it. */
  fill: FvgFill;
  fillIndex: number | null;
  fillT: number | null;
  /**
   * Inversion: price CLOSED beyond the far side of the gap (bull gap: close
   * below bottom; bear gap: close above top). The gap now acts as the
   * opposite zone (bull FVG → bearish iFVG resistance and vice versa).
   */
  inverted: boolean;
  invertedIndex: number | null;
  invertedT: number | null;
  /** After inversion: price came back and touched the zone from the other side. */
  inversionRetested: boolean;
  inversionRetestIndex: number | null;
  inversionRetestT: number | null;
}

/**
 * 3-candle fair value gaps with displacement-qualified middle candle, plus
 * fill / inversion / inversion-retest tracking. Single forward pass — status
 * at each bar uses only bars up to that bar (no lookahead).
 */
export function detectFvgs(bars: OhlcBar[]): FvgResult[] {
  if (bars.length < MIN_BARS) return [];
  const atr = rollingAtr(bars);
  const out: FvgResult[] = [];

  for (let i = 2; i < bars.length; i++) {
    const a = bars[i - 2]!;
    const mid = bars[i - 1]!;
    const c = bars[i]!;
    const atrHere = atr[i - 1]!;
    if (!Number.isFinite(atrHere) || atrHere <= 0) continue;
    const ratio = body(mid) / atrHere;
    // The gap is candle 1's wick not meeting candle 3's wick. A small middle
    // body can still leave that hole, so the body-size filter is off.
    if (ratio < FVG_MIDDLE_BODY_ATR) continue;

    // Bull FVG: gap between bar[i-2] high and bar[i] low, middle candle up.
    if (a.h < c.l && mid.c > mid.o) {
      out.push({
        kind: "bull",
        createdIndex: i,
        createdT: c.t,
        top: c.l,
        bottom: a.h,
        middleBodyAtrRatio: +ratio.toFixed(2),
        fill: "none",
        fillIndex: null,
        fillT: null,
        inverted: false,
        invertedIndex: null,
        invertedT: null,
        inversionRetested: false,
        inversionRetestIndex: null,
        inversionRetestT: null,
      });
    }
    // Bear FVG: gap between bar[i] high and bar[i-2] low, middle candle down.
    if (a.l > c.h && mid.c < mid.o) {
      out.push({
        kind: "bear",
        createdIndex: i,
        createdT: c.t,
        top: a.l,
        bottom: c.h,
        middleBodyAtrRatio: +ratio.toFixed(2),
        fill: "none",
        fillIndex: null,
        fillT: null,
        inverted: false,
        invertedIndex: null,
        invertedT: null,
        inversionRetested: false,
        inversionRetestIndex: null,
        inversionRetestT: null,
      });
    }
  }

  // Forward status pass per gap (bars strictly after creation).
  for (const g of out) {
    for (let j = g.createdIndex + 1; j < bars.length; j++) {
      const b = bars[j]!;
      if (g.kind === "bull") {
        // Trade INTO the gap = partial; through the far side = full.
        if (g.fill === "none" && b.l < g.top) {
          g.fill = "partial";
          g.fillIndex = j;
          g.fillT = b.t;
        }
        if (g.fill !== "full" && b.l <= g.bottom) {
          g.fill = "full";
          g.fillIndex = j;
          g.fillT = b.t;
        }
        // Inversion = CLOSE beyond the far side (not just a wick).
        if (!g.inverted && b.c < g.bottom) {
          g.inverted = true;
          g.invertedIndex = j;
          g.invertedT = b.t;
        } else if (g.inverted && !g.inversionRetested) {
          // Retest from below: high back into the (now bearish) zone.
          if (b.h >= g.bottom) {
            g.inversionRetested = true;
            g.inversionRetestIndex = j;
            g.inversionRetestT = b.t;
          }
        }
      } else {
        if (g.fill === "none" && b.h > g.bottom) {
          g.fill = "partial";
          g.fillIndex = j;
          g.fillT = b.t;
        }
        if (g.fill !== "full" && b.h >= g.top) {
          g.fill = "full";
          g.fillIndex = j;
          g.fillT = b.t;
        }
        if (!g.inverted && b.c > g.top) {
          g.inverted = true;
          g.invertedIndex = j;
          g.invertedT = b.t;
        } else if (g.inverted && !g.inversionRetested) {
          // Retest from above: low back into the (now bullish) zone.
          if (b.l <= g.top) {
            g.inversionRetested = true;
            g.inversionRetestIndex = j;
            g.inversionRetestT = b.t;
          }
        }
      }
    }
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Displacement                                                         */
/* ------------------------------------------------------------------ */

/** The gap a displacement candle left, as the middle candle of its own
 *  3-bar window. `createdIndex` is the THIRD candle — the bar at which the
 *  gap becomes a fact, which is one bar AFTER the displacement itself. */
export interface DisplacementGap {
  top: number;
  bottom: number;
  createdIndex: number;
  createdT: number;
}

/**
 * Which test lets a candle through as displacement.
 *
 *   "body"   — body >= GATE.displacementK x ATR(14). The original rule, and
 *              TODAY'S DEFAULT, so nothing downstream moves until the
 *              scanner owner flips it.
 *   "gap"    — the candle LEFT a fair-value gap and no later bar has CLOSED
 *              back through it, whatever the body measured. This is the rule
 *              the trader describes: delivery that skipped price and held is
 *              displacement; a fat candle that filled its own path is not.
 *   "either" — body OR held gap.
 *
 * Mutable on purpose, same contract as GATE: scripts set it between runs so
 * each variant goes through the live code path. Nothing writes it at runtime.
 *
 * NOT MEASURED. No |z| >= 2 result in this repo compares these three on the
 * four-year capture — `scripts/measure-*` has never swept the displacement
 * DEFINITION, only its multiple (gate-tuning.ts v6/v17, displacementK 1.25,
 * which moved 0 takes). Flipping the default is an edge claim and needs the
 * same bar every other claim here is held to.
 */
export type DisplacementRule = "body" | "gap" | "either";
export const DISPLACEMENT_RULE: { rule: DisplacementRule } = { rule: "body" };

/** How far forward `gapClosedIndex` is located. `gapHeld` itself is exact to
 *  the end of the series regardless (it comes from a suffix scan); this only
 *  bounds the search for WHERE, so a 100k-bar history stays O(n). */
export const GAP_CLOSE_SCAN_BARS = 240;

export interface DisplacementEvent {
  index: number;
  t: number;
  direction: "bull" | "bear";
  /** |c-o| of the candle. */
  bodySize: number;
  /** ATR(14) of ranges at that bar (previous 14 bars). */
  atr: number;
  /** bodySize / atr — >= DISPLACEMENT_K by construction. */
  ratio: number;
  open: number;
  close: number;
  /** The fair-value gap this candle left, or null when it closed none.
   *  Known only once the third candle prints, so a displacement on the last
   *  bar of the series always reports null — that is the absence of
   *  evidence, not a no. */
  gap: DisplacementGap | null;
  /** "gap left, close held": a gap exists AND no later bar CLOSED back
   *  through its far side. false whenever `gap` is null. */
  gapHeld: boolean;
  /** Index of the bar that closed back through the gap; null while held, and
   *  null when the close-through is further out than GAP_CLOSE_SCAN_BARS. */
  gapClosedIndex: number | null;
  /** The original 1.5-ATR body test, reported whether or not it gated. */
  bodyQualified: boolean;
  /** Which test this candle actually satisfied. */
  qualifiedBy: "body" | "gap" | "both";
}

/** The 3-bar gap whose MIDDLE candle is bar `i`, in `direction`. Same
 *  geometry detectFvgs uses (candle 1's wick not reaching candle 3's), read
 *  from the displacement's own point of view instead of the third candle's.
 *  Inlined rather than calling detectFvgs: that function is O(bars x gaps)
 *  and detectOrderBlocks/detectMechanicalModel already call it, so routing
 *  displacement through it would multiply the cost the file's own
 *  performance note warns about. */
function gapLeftBy(bars: OhlcBar[], i: number, direction: "bull" | "bear"): DisplacementGap | null {
  if (i < 1 || i + 1 >= bars.length) return null;
  const a = bars[i - 1]!;
  const c = bars[i + 1]!;
  if (direction === "bull") {
    if (!(a.h < c.l)) return null;
    return { top: c.l, bottom: a.h, createdIndex: i + 1, createdT: c.t };
  }
  if (!(a.l > c.h)) return null;
  return { top: a.l, bottom: c.h, createdIndex: i + 1, createdT: c.t };
}

/**
 * Displacement candles.
 *
 * Under the default rule ("body") this is unchanged: body >=
 * GATE.displacementK (1.5) × rolling ATR(14) of bar ranges, close in the
 * move's direction. What is NEW is that every event now carries the gap it
 * left and whether that gap still holds, so "a big candle" and "delivery that
 * skipped price and held" stop being the same fact — and so the gap-first
 * rule can be switched on (DISPLACEMENT_RULE) without a second detector that
 * could disagree with this one.
 */
export function detectDisplacements(
  bars: OhlcBar[],
  opts: { rule?: DisplacementRule } = {},
): DisplacementEvent[] {
  if (bars.length < MIN_BARS) return [];
  const rule = opts.rule ?? DISPLACEMENT_RULE.rule;
  const atr = rollingAtr(bars);

  // Suffix extremes of CLOSES: minCloseAfter[i] = min close over j > i. One
  // O(n) pass gives an exact "did anything ever close through this level"
  // answer for every candidate, instead of a forward scan per displacement
  // (which is the O(n^2)-over-full-history shape this file already got
  // burned by once in build-evidence-pack.mjs).
  const n = bars.length;
  const minCloseAfter: number[] = new Array<number>(n).fill(Infinity);
  const maxCloseAfter: number[] = new Array<number>(n).fill(-Infinity);
  for (let i = n - 2; i >= 0; i--) {
    minCloseAfter[i] = Math.min(minCloseAfter[i + 1]!, bars[i + 1]!.c);
    maxCloseAfter[i] = Math.max(maxCloseAfter[i + 1]!, bars[i + 1]!.c);
  }

  const out: DisplacementEvent[] = [];
  for (let i = ATR_PERIOD; i < bars.length; i++) {
    const b = bars[i]!;
    const a = atr[i]!;
    if (!Number.isFinite(a) || a <= 0) continue;
    if (b.c === b.o) continue; // no direction, so neither test can read it
    const direction: "bull" | "bear" = b.c > b.o ? "bull" : "bear";
    const bs = body(b);
    const bodyQualified = bs >= GATE.displacementK * a;

    const gap = gapLeftBy(bars, i, direction);
    let gapHeld = false;
    let gapClosedIndex: number | null = null;
    if (gap) {
      const k = gap.createdIndex;
      const closedThrough =
        direction === "bull" ? minCloseAfter[k]! < gap.bottom : maxCloseAfter[k]! > gap.top;
      gapHeld = !closedThrough;
      if (closedThrough) {
        const ceil = Math.min(n - 1, k + GAP_CLOSE_SCAN_BARS);
        for (let j = k + 1; j <= ceil; j++) {
          const c = bars[j]!.c;
          if (direction === "bull" ? c < gap.bottom : c > gap.top) {
            gapClosedIndex = j;
            break;
          }
        }
      }
    }
    const gapQualified = gap != null && gapHeld;

    const keep =
      rule === "body" ? bodyQualified : rule === "gap" ? gapQualified : bodyQualified || gapQualified;
    if (!keep) continue;

    out.push({
      index: i,
      t: b.t,
      direction,
      bodySize: +bs.toFixed(2),
      atr: +a.toFixed(2),
      ratio: +(bs / a).toFixed(2),
      open: b.o,
      close: b.c,
      gap,
      gapHeld,
      gapClosedIndex,
      bodyQualified,
      qualifiedBy: bodyQualified && gapQualified ? "both" : bodyQualified ? "body" : "gap",
    });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Order blocks                                                         */
/* ------------------------------------------------------------------ */

export interface OrderBlock {
  /** Direction of the displacement move the block precedes (bull OB supports longs). */
  kind: "bull" | "bear";
  /** Index/time of the opposing candle that IS the order block. */
  index: number;
  t: number;
  /** Body zone: [min(o,c), max(o,c)] of the opposing candle. */
  bodyTop: number;
  bodyBottom: number;
  /** Full-range zone: [l, h] of the opposing candle. */
  rangeTop: number;
  rangeBottom: number;
  /** Index of the displacement candle that validated this block. */
  displacementIndex: number;
  /** Mitigated = SPENT: a bar CLOSED beyond the block, so it did not hold.
   *  (Before 2026-09-23 this was a mere TOUCH of the full range, which
   *  deleted the block on the same bar that made it tradeable.) */
  mitigated: boolean;
  mitigatedIndex: number | null;
  mitigatedT: number | null;
}

/**
 * Order blocks: the last opposing-direction candle immediately before a
 * displacement move. We walk back from the displacement candle through at
 * most OB_SCAN_BACK (3) consecutive same-direction candles; the first
 * opposing candle found is the block. Mitigation = any later bar re-entering
 * the block's full range.
 */
export function detectOrderBlocks(bars: OhlcBar[]): OrderBlock[] {
  if (bars.length < MIN_BARS) return [];
  const displacements = detectDisplacements(bars);
  const out: OrderBlock[] = [];
  const used = new Set<number>(); // one block per opposing candle

  for (const d of displacements) {
    let obIdx = -1;
    // Walk back: skip same-direction candles (the run-up), stop at opposing.
    for (let k = 1; k <= OB_SCAN_BACK; k++) {
      const idx = d.index - k;
      if (idx < 0) break;
      const b = bars[idx]!;
      const isOpposing =
        d.direction === "bull" ? b.c < b.o : b.c > b.o;
      if (isOpposing) {
        obIdx = idx;
        break;
      }
    }
    if (obIdx < 0 || used.has(obIdx)) continue;
    used.add(obIdx);
    const ob = bars[obIdx]!;

    const block: OrderBlock = {
      kind: d.direction,
      index: obIdx,
      t: ob.t,
      bodyTop: Math.max(ob.o, ob.c),
      bodyBottom: Math.min(ob.o, ob.c),
      rangeTop: ob.h,
      rangeBottom: ob.l,
      displacementIndex: d.index,
      mitigated: false,
      mitigatedIndex: null,
      mitigatedT: null,
    };

    // Mitigation scan: bars AFTER the displacement candle only (revisit).
    for (let j = d.index + 1; j < bars.length; j++) {
      const b = bars[j]!;
      // 2026-09-23: this tested a TOUCH of the block's full range, and
      // smc-board drops mitigated arrays from the tape — while the retrace
      // layer requires price to be INSIDE the block. The bar that put price
      // in the zone was the bar that deleted the zone, so on closed-bar
      // replay an OB could never satisfy retrace.
      //
      // Mitigated now means SPENT: a bar CLOSED beyond the far edge, so the
      // block failed to hold. Price sitting inside it is the entry.
      const through =
        d.direction === "bull"
          ? b.c < block.rangeBottom // closed BELOW a bull OB — it did not hold
          : b.c > block.rangeTop; // closed ABOVE a bear OB
      if (through) {
        block.mitigated = true;
        block.mitigatedIndex = j;
        block.mitigatedT = b.t;
        break;
      }
    }

    out.push(block);
  }

  return out;
}

/* ------------------------------------------------------------------ */
/* Mechanical model state machine                                       */
/* ------------------------------------------------------------------ */

export type MechanicalState =
  | "idle"
  | "swept"
  | "displaced"
  | "inverted"
  | "retest_ready"
  | "complete";

export interface SweepEvent {
  index: number;
  t: number;
  /** Which pool got taken. */
  side: "buyside" | "sellside";
  /** The swing extreme that was swept. */
  sweptLevel: number;
  /** The wick extreme of the sweeping bar. */
  wickExtreme: number;
  /** Close back inside — distance from the swept level. */
  closeBackInside: number;
}

/**
 * Why a sequence stopped being live. Evaluated in this order, first hit wins:
 * price-action invalidation before mere ageing.
 */
export type MechanicalInvalidation =
  /** Price CLOSED beyond the sweep's own extreme — the model's stop level. */
  | "structure_break"
  /** The opposite pool was swept after this sequence armed. */
  | "contrary_sweep"
  /** `swept` with no qualifying displacement inside MM_DISPLACE_WITHIN bars. */
  | "displacement_window_closed"
  /** Armed longer than MM_MAX_ARMED_AGE bars with no retest. */
  | "stale_armed"
  /** Retest happened more than MM_MAX_COMPLETE_AGE bars ago. */
  | "stale_complete";

export interface MechanicalSequence {
  state: MechanicalState;
  /** Trade direction the completed model implies (sweep low → long). */
  direction: "long" | "short" | null;
  sweep: SweepEvent | null;
  displacement: DisplacementEvent | null;
  /** The FVG/iFVG zone created by the displacement leg. */
  zone: {
    source: "fvg" | "ifvg";
    top: number;
    bottom: number;
    createdIndex: number;
    createdT: number;
  } | null;
  retest: { index: number; t: number; price: number } | null;
  /**
   * TRADEABLE completion: all four legs present AND the sequence is still
   * alive (`legsComplete && alive`). Partial sequences stay false, and so
   * does a completed sequence that has since been invalidated or aged out —
   * consumers score this field, so a dead model must not light it.
   */
  complete: boolean;
  /** Raw leg presence, ignoring liveness. Diagnostics only. */
  legsComplete: boolean;
  /**
   * Live = neither expired nor invalidated. A dead sequence is still returned
   * (with the furthest state it reached plus `invalidation`) when nothing
   * live exists, so the desk can say WHY there is no mechanical setup.
   */
  alive: boolean;
  /** Why the sequence died; null while alive. */
  invalidation: MechanicalInvalidation | null;
  /**
   * Bars from the sequence's most recent leg (retest → zone → displacement →
   * sweep, whichever is latest) to the last bar handed in.
   */
  ageBars: number;
}

/**
 * Sweeps: a bar whose wick trades beyond a prior CONFIRMED swing extreme but
 * whose close comes back inside. Buyside sweep: h > swing-high price, c <
 * swing-high price. Sellside symmetric. A swing is only usable
 * MM_SWING_WIDTH bars after it forms (fractal confirmation) — no lookahead.
 */
export function detectSweeps(bars: OhlcBar[]): SweepEvent[] {
  if (bars.length < MIN_BARS) return [];
  const swings = fractalSwings(bars, MM_SWING_WIDTH);
  const out: SweepEvent[] = [];

  for (let i = 2 * MM_SWING_WIDTH; i < bars.length; i++) {
    const b = bars[i]!;
    // Most recent confirmed, unswept-at-time swing above/below.
    let bestHigh: SwingPoint | null = null;
    let bestLow: SwingPoint | null = null;
    for (const s of swings) {
      if (s.index + MM_SWING_WIDTH >= i) continue; // not confirmed yet at bar i
      if (s.kind === "high" && (!bestHigh || s.index > bestHigh.index))
        bestHigh = s;
      if (s.kind === "low" && (!bestLow || s.index > bestLow.index))
        bestLow = s;
    }
    if (bestHigh && b.h > bestHigh.price && b.c < bestHigh.price) {
      out.push({
        index: i,
        t: b.t,
        side: "buyside",
        sweptLevel: bestHigh.price,
        wickExtreme: b.h,
        closeBackInside: +(bestHigh.price - b.c).toFixed(2),
      });
    }
    if (bestLow && b.l < bestLow.price && b.c > bestLow.price) {
      out.push({
        index: i,
        t: b.t,
        side: "sellside",
        sweptLevel: bestLow.price,
        wickExtreme: b.l,
        closeBackInside: +(b.c - bestLow.price).toFixed(2),
      });
    }
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Sweep confirmation on the finer tape                                 */
/* ------------------------------------------------------------------ */

/**
 * A sweep is a 15-MINUTE object here, and that is the hole: detectSweeps runs
 * on whatever bars it is handed, so a 15m candle whose wick pokes a pool and
 * whose close comes back inside is called a raid even when the 1-minute
 * candles underneath CLOSED outside and stayed there for ten minutes. That is
 * a breakout wearing a raid's shape, and it is exactly the trade the desk
 * must not take.
 *
 * Tri-state on purpose. A boolean would have to pick a side when there is no
 * finer tape at all, and both choices are wrong: `true` lets an unverified
 * raid arm, `false` shuts the desk off every time the gateway is down and
 * Yahoo's 1m hole-fill is thin. "no_tape" says the question was not answered,
 * and NOTHING may read it as confirmation.
 */
export type SweepTapeVerdict = "confirmed" | "breakout" | "no_tape";

export interface SweepTapeRead {
  verdict: SweepTapeVerdict;
  /** Closed finer-tape bars found inside the sweep candle's own span. */
  barsSeen: number;
  /** Closed bars the span should contain at this spacing. */
  barsExpected: number;
  /** First closed finer bar whose WICK traded through the pool (index into
   *  the covered slice, not the caller's array). */
  wickIndex: number | null;
  /** First closed finer bar at/after the wick that CLOSED back inside. */
  closeBackIndex: number | null;
  /** How many closed finer bars CLOSED outside the pool. 0 with a
   *  "confirmed" verdict means the raid was a pure wick on the fine tape. */
  closedOutside: number;
  reason: string;
}

/** Fraction of the sweep candle the finer tape must actually cover before the
 *  question can be answered. A 1m feed that holds only the first third of a
 *  15m candle cannot tell you where that candle closed, so it must read
 *  "no_tape" rather than confirm off a partial window. */
export const SWEEP_TAPE_MIN_COVERAGE = 0.8;

/**
 * Grade a sweep against the CLOSED finer tape inside its own candle.
 *
 * `structureBars` is the series the sweep was detected on (its spacing gives
 * the candle's span); `minute` is the finer series. Both spacings are read
 * from the data (barSpanMs) — no 15m or 1m is hard-coded, so this works
 * unchanged on a 5m structure series or a 15-second tape.
 *
 * Closed bars only: a finer bar counts when `nowMs >= b.t + fineSpan`. The
 * forming bar is never evidence about where anything closed.
 */
export function confirmSweepOnTape(
  sweep: SweepEvent,
  structureBars: OhlcBar[],
  minute: OhlcBar[] | null | undefined,
  opts: { nowMs?: number } = {},
): SweepTapeRead {
  const noTape = (reason: string, barsSeen = 0, barsExpected = 0): SweepTapeRead => ({
    verdict: "no_tape",
    barsSeen,
    barsExpected,
    wickIndex: null,
    closeBackIndex: null,
    closedOutside: 0,
    reason,
  });

  if (!minute || minute.length < 2)
    return noTape("No finer tape — a wick through the pool cannot be told from a breakout.");
  const structSpan = barSpanMs(structureBars);
  const fineSpan = barSpanMs(minute);
  if (!Number.isFinite(structSpan) || structSpan <= 0 || !Number.isFinite(fineSpan) || fineSpan <= 0)
    return noTape("Bar spacing unreadable on one of the two series.");
  if (fineSpan >= structSpan)
    return noTape("The second series is not finer than the one the raid was found on.");

  const nowMs = opts.nowMs ?? Date.now();
  const from = sweep.t;
  const to = sweep.t + structSpan;
  const covered = minute.filter((b) => b.t >= from && b.t < to && nowMs >= b.t + fineSpan);
  const expected = Math.max(1, Math.round(structSpan / fineSpan));
  const need = Math.ceil(SWEEP_TAPE_MIN_COVERAGE * expected);
  if (covered.length < need)
    return noTape(
      `Only ${covered.length} of ${expected} closed finer bars inside the raid candle — not enough to say where it closed.`,
      covered.length,
      expected,
    );

  const isBuy = sweep.side === "buyside";
  const lvl = sweep.sweptLevel;

  let wickIndex: number | null = null;
  for (let i = 0; i < covered.length; i++) {
    const b = covered[i]!;
    if (isBuy ? b.h > lvl : b.l < lvl) {
      wickIndex = i;
      break;
    }
  }
  if (wickIndex == null)
    return noTape(
      "The finer tape never traded through the pool this raid claims — the two series disagree, so neither is evidence.",
      covered.length,
      expected,
    );

  let closeBackIndex: number | null = null;
  let closedOutside = 0;
  for (let i = wickIndex; i < covered.length; i++) {
    const b = covered[i]!;
    const outside = isBuy ? b.c >= lvl : b.c <= lvl;
    if (outside) closedOutside++;
    else if (closeBackIndex == null) closeBackIndex = i;
  }

  if (closeBackIndex == null)
    return {
      verdict: "breakout",
      barsSeen: covered.length,
      barsExpected: expected,
      wickIndex,
      closeBackIndex: null,
      closedOutside,
      reason: `Every one of ${closedOutside} closed finer bars after the wick CLOSED outside the pool. That is a breakout, not a raid.`,
    };

  return {
    verdict: "confirmed",
    barsSeen: covered.length,
    barsExpected: expected,
    wickIndex,
    closeBackIndex,
    closedOutside,
    reason: closedOutside
      ? `Wick through the pool, ${closedOutside} finer close(s) outside, then a close back inside. Confirmed, but price accepted outside first.`
      : "Wick through the pool and every finer bar closed back inside. A clean raid.",
  };
}

/**
 * Inducement: was the sweep a card is keyed on preceded by a SHALLOWER sweep
 * of the same polarity — the decoy grab TradingHub/Photon's framing names,
 * "the first pullback, not the external extreme" (src/lib/learn/canon.ts's
 * research note on it, which flagged this as coded but unresolved until now).
 *
 * MEASURED, NOT ASSUMED: scripts/measure-inducement-news.mjs ran this exact
 * definition against 4 years / 3,501 filled cards. A card WITH a decoy sweep
 * beforehand paid -0.259R, both halves negative, CI excludes zero (n=525) —
 * confirmed negative, not the edge the classic framing implies. A card
 * without one was flat/mixed at -0.084R. So this is wired in as a CAUTION —
 * evidence.ts's per-card line — never a bonus, never a gate. See that
 * module's own docstring on why a measured fact becomes a labelled line, not
 * a score.
 *
 * Deliberately reuses detectSweeps() rather than a second sweep scanner: two
 * detectors that could disagree on what "the sweep" was would make this
 * finding unfalsifiable the moment they drifted.
 */
export const INDUCEMENT_WINDOW_BARS = 16;

export interface InducementRead {
  /** True only when a live, in-window main sweep AND an earlier, shallower
   *  decoy of the same polarity are both present. */
  inducement: boolean;
  /** The sweep the card is actually keyed on, for the caller to show it. */
  mainSweep: SweepEvent | null;
  /** The earlier, shallower sweep, when `inducement` is true. */
  decoy: SweepEvent | null;
}

const NO_INDUCEMENT: InducementRead = { inducement: false, mainSweep: null, decoy: null };

/**
 * `side` is the trade direction the card wants: "long" needs a sellside
 * main sweep (lows taken), "short" needs buyside — the same polarity rule
 * every other sweep-reading layer in this file already uses.
 */
export function detectInducement(
  bars: OhlcBar[],
  side: "long" | "short",
  opts: { recentSweepBars?: number; inducementWindowBars?: number } = {},
): InducementRead {
  if (bars.length < MIN_BARS) return NO_INDUCEMENT;
  const recentWindow = opts.recentSweepBars ?? GATE.recentSweepBars;
  const inducementWindow = opts.inducementWindowBars ?? INDUCEMENT_WINDOW_BARS;
  const wantSide = side === "long" ? "sellside" : "buyside";
  const sweeps = detectSweeps(bars).filter((s) => s.side === wantSide);
  if (!sweeps.length) return NO_INDUCEMENT;

  const main = sweeps[sweeps.length - 1]!;
  const lastIndex = bars.length - 1;
  if (lastIndex - main.index > recentWindow) return NO_INDUCEMENT;

  // Shallower = a less extreme level taken first: for a sellside pair the
  // earlier low must sit ABOVE the main (deeper) low; for buyside, the
  // earlier high must sit BELOW the main (higher) high.
  const decoy =
    [...sweeps]
      .reverse()
      .find(
        (s) =>
          s.index < main.index &&
          main.index - s.index <= inducementWindow &&
          (wantSide === "sellside" ? s.sweptLevel > main.sweptLevel : s.sweptLevel < main.sweptLevel),
      ) ?? null;

  return { inducement: decoy != null, mainSweep: main, decoy };
}

/**
 * The OTHER half of inducement, and the half that decides whether a card may
 * arm: `detectInducement` above answers "did a decoy print BEFORE the raid we
 * are keyed on" (shallow first, then deep — the configuration measured at
 * -0.259R). It says nothing about the case where the decoy IS the latest
 * raid: price took a minor pool and the obvious swing beyond it is STILL
 * unswept. That raid is the trap. The raid that arms is the one that takes
 * the swing the inducement sat in front of.
 *
 * `lookbackBars` bounds what counts as "the obvious swing beyond": 80 bars is
 * the same window structure.ts's dealingRange uses, so the pool has to belong
 * to the range being traded rather than to a high from days ago.
 *
 * EXPORTED AS A TEST, NOT WIRED AS A GATE — deliberately. This repo's only
 * measured inducement result is on the other configuration, and the
 * difference test there came in at z = -1.39 (under the |z| >= 2 bar). A
 * refusal built on "the bigger pool is still out there" has NO measurement at
 * all yet; wiring it as a must-layer would be asserting the answer. Measure
 * `inducementOnly` against the four-year capture the way
 * scripts/measure-model-claims.mjs measures the others, then decide.
 */
export interface InducementArmRead {
  /** The latest polarity raid took a MINOR pool while a more extreme swing
   *  beyond it sits unswept. On this reading it must not arm the trade. */
  inducementOnly: boolean;
  /** The raid that may arm this side — the one that took the swing the
   *  inducement sat in front of. null while only the decoy has printed. */
  armingSweep: SweepEvent | null;
  /** The raid that is (or was) the decoy. */
  inducementSweep: SweepEvent | null;
  /** The NEAREST still-unswept swing beyond the decoy: the pool price has
   *  yet to take, and the one whose raid would arm. */
  unsweptBeyond: SwingPoint | null;
  reason: string;
}

/** How far back a still-unswept pool may sit and still be "the obvious swing
 *  beyond". 80 bars = structure.ts's own dealing-range window (20h on 15m). */
export const ARM_LOOKBACK_BARS = 80;

const NO_ARM: InducementArmRead = {
  inducementOnly: false,
  armingSweep: null,
  inducementSweep: null,
  unsweptBeyond: null,
  reason: "No raid of this polarity inside the recency window.",
};

export function readArmingSweep(
  bars: OhlcBar[],
  side: "long" | "short",
  opts: { recentSweepBars?: number; lookbackBars?: number; inducementWindowBars?: number } = {},
): InducementArmRead {
  if (bars.length < MIN_BARS) return NO_ARM;
  const recentWindow = opts.recentSweepBars ?? GATE.recentSweepBars;
  const lookback = opts.lookbackBars ?? ARM_LOOKBACK_BARS;
  const inducementWindow = opts.inducementWindowBars ?? INDUCEMENT_WINDOW_BARS;
  const wantSide = side === "long" ? "sellside" : "buyside";
  const sweeps = detectSweeps(bars).filter((s) => s.side === wantSide);
  if (!sweeps.length) return NO_ARM;

  const latest = sweeps[sweeps.length - 1]!;
  const lastIndex = bars.length - 1;
  if (lastIndex - latest.index > recentWindow) return NO_ARM;

  // The pool a raid of this polarity takes: a buyside raid takes swing HIGHS,
  // a sellside raid takes swing LOWS.
  const poolKind: "high" | "low" = wantSide === "buyside" ? "high" : "low";
  const floor = Math.max(0, latest.index - lookback);
  const beyond = fractalSwings(bars).filter(
    (s) =>
      s.kind === poolKind &&
      s.index >= floor &&
      // Confirmed before the raid printed — a swing the raid could not have
      // known about is not a pool it chose to leave alone.
      s.index + MM_SWING_WIDTH < latest.index &&
      (poolKind === "high" ? s.price > latest.sweptLevel : s.price < latest.sweptLevel),
  );

  // Still unswept at the last bar: nothing since has traded through it.
  const unswept = beyond.filter((s) => {
    for (let j = s.index + 1; j <= lastIndex; j++) {
      const b = bars[j]!;
      if (poolKind === "high" ? b.h > s.price : b.l < s.price) return false;
    }
    return true;
  });

  if (unswept.length) {
    // The NEAREST one beyond: least extreme, because that is the next pool
    // price must take, and the raid of IT is the one that would arm.
    const nearest = unswept.reduce((best, s) =>
      poolKind === "high" ? (s.price < best.price ? s : best) : (s.price > best.price ? s : best),
    );
    return {
      inducementOnly: true,
      armingSweep: null,
      inducementSweep: latest,
      unsweptBeyond: nearest,
      reason: `The raid took ${latest.sweptLevel} while the ${poolKind === "high" ? "high" : "low"} at ${nearest.price} is still unswept beyond it. That is the inducement, not the arming raid.`,
    };
  }

  // Nothing bigger is left standing, so this raid took the swing the
  // inducement sat in front of. Name the decoy it cleared, when there was one.
  const decoy =
    [...sweeps]
      .reverse()
      .find(
        (s) =>
          s.index < latest.index &&
          latest.index - s.index <= inducementWindow &&
          (wantSide === "sellside" ? s.sweptLevel > latest.sweptLevel : s.sweptLevel < latest.sweptLevel),
      ) ?? null;

  return {
    inducementOnly: false,
    armingSweep: latest,
    inducementSweep: decoy,
    unsweptBeyond: null,
    reason: decoy
      ? `The raid at ${latest.sweptLevel} took the pool the decoy at ${decoy.sweptLevel} sat in front of. This is the arming raid.`
      : `No more extreme pool of this polarity is left unswept inside ${lookback} bars. This raid arms.`,
  };
}

/* ------------------------------------------------------------------ */
/* Accumulation, manipulation-quality, distribution-quality             */
/* ------------------------------------------------------------------ */

/**
 * RESEARCHED 2026-09-30 alongside inducement (canon.ts moduleId "sweep").
 * Independent research on all three below converged on the same verdict:
 * Wyckoff/ICT/TJR agree a pre-move range ("accumulation"), the raid itself
 * ("manipulation"), and the reaction leg ("distribution") are real concepts,
 * but NONE of the lineage — verified across primary and secondary sources —
 * publishes a depth/duration/shape threshold that turns "present" into
 * "good." The one directly-relevant peer-reviewed test (Sullivan,
 * Timmermann & White 1999, channel/range-breakout rules on 100+ years of
 * DJIA) found the apparent edge was a data-snooping artifact once corrected
 * for how many rules were tried. Two 2026 preprints on futures/MNQ
 * specifically (Fetna; Mesfin) found no OHLCV-only signal family survives
 * walk-forward + cost + stability testing. This repo's own score-drivers.ts
 * already measured aggregate confluence (which includes the plain
 * displacement boolean) at r=-0.031 vs T1 reach, n=387.
 *
 * So these three are shipped as RAW FACT EXTRACTORS ONLY — no pre-baked
 * score, no confluence weight, no gate. A tiered scoring function invented
 * before measurement would just be asserting the answer. Whoever measures
 * these against evidence-pack.json decides bucket edges from the data, the
 * same discipline every other threshold in this file was held to
 * (DISPLACEMENT_K, the stop-distance band in evidence.ts, etc.).
 *
 * PERFORMANCE: these all reuse detectSweeps()/detectDisplacements(), which
 * are cheap on a bounded slice but were the exact cause of an O(n^2)-over-
 * full-history bug caught this session in build-evidence-pack.mjs (an
 * 8-billion-operation run before it was bounded to a 300-bar lookback).
 * ALWAYS call these on a bounded recent slice, never on full multi-year
 * history.
 */

/** Bars to search back from a sweep for a qualifying pre-move range. 40 on
 *  15m bars = 10h — must belong to the current/prior session's build, not a
 *  range from days ago that happens to sit nearby in price. */
export const ACCUM_LOOKBACK_BARS = 40;
/** Minimum bars a range must hold. 8 * 15m = 2h — below this it is a pause,
 *  not ICT's "longest phase by time" or a Wyckoff range with room to test. */
export const ACCUM_MIN_BARS = 8;
/** Window height (max high - min low) / ATR(14) at the window's last bar.
 *  A first-cut "meaningfully tighter than noise" bar — a starting point for
 *  scripts/measure-amd-signals.mjs to sweep, not a validated cutoff. */
export const ACCUM_MAX_RANGE_ATR = 2.5;
/** Mean per-bar range inside the window / ATR(14) — the actual Bollinger-
 *  squeeze/VCP/NR7 analogue (did realized volatility contract), distinct
 *  from ACCUM_MAX_RANGE_ATR above, which only checks net drift. */
export const ACCUM_MAX_BAR_RANGE_ATR = 0.85;

export interface AccumulationRead {
  present: boolean;
  startIndex: number | null;
  endIndex: number | null;
  barsInRange: number;
  /** (rangeHigh - rangeLow) / ATR at the window's last bar. */
  rangeAtrRatio: number | null;
  /** Mean per-bar range / ATR — the compression test proper. */
  compressionRatio: number | null;
  /** Is the sweep's own swept level at/near this range's own extreme? A
   *  range detected nearby that has nothing to do with what got raided
   *  would be a false positive wearing the right shape. */
  sweepAtRangeExtreme: boolean;
}

const NO_ACCUMULATION: AccumulationRead = {
  present: false,
  startIndex: null,
  endIndex: null,
  barsInRange: 0,
  rangeAtrRatio: null,
  compressionRatio: null,
  sweepAtRangeExtreme: false,
};

/**
 * Pre-sweep range detector. The window's START is fixed deterministically —
 * the bar right after the most recent prior sweep or displacement within
 * the lookback ceiling, NEVER a best-fit search over candidate starts. A
 * floating search would manufacture "accumulation" out of nothing: some
 * qualifying sub-window exists before nearly every sweep once the search is
 * free to pick its own start. Measure the deterministic-anchor hit rate
 * against a floating-search hit rate on the same tape before trusting this;
 * if they are close, the anchor is not doing its job either.
 */
export function detectAccumulation(
  bars: OhlcBar[],
  sweep: SweepEvent,
  opts: { lookbackBars?: number; minBars?: number } = {},
): AccumulationRead {
  if (bars.length < MIN_BARS) return NO_ACCUMULATION;
  const lookback = opts.lookbackBars ?? ACCUM_LOOKBACK_BARS;
  const minBars = opts.minBars ?? ACCUM_MIN_BARS;
  const endIndex = sweep.index - 1;
  if (endIndex < minBars) return NO_ACCUMULATION;

  const floor = Math.max(0, endIndex - lookback);
  const priorSlice = bars.slice(floor, endIndex + 1);
  let startRel = 0;
  for (const s of detectSweeps(priorSlice)) startRel = Math.max(startRel, s.index + 1);
  for (const d of detectDisplacements(priorSlice)) startRel = Math.max(startRel, d.index + 1);
  const startIndex = floor + startRel;
  const barsInRange = endIndex - startIndex + 1;
  if (barsInRange < minBars) return NO_ACCUMULATION;

  const atr = rollingAtr(bars);
  const a = atr[endIndex];
  if (!Number.isFinite(a) || a! <= 0) return NO_ACCUMULATION;

  const window = bars.slice(startIndex, endIndex + 1);
  const rangeHigh = Math.max(...window.map((b) => b.h));
  const rangeLow = Math.min(...window.map((b) => b.l));
  const rangeAtrRatio = (rangeHigh - rangeLow) / a!;
  const meanBarRange = window.reduce((s, b) => s + (b.h - b.l), 0) / window.length;
  const compressionRatio = meanBarRange / a!;

  const extreme = sweep.side === "buyside" ? rangeHigh : rangeLow;
  const sweepAtRangeExtreme = Math.abs(sweep.sweptLevel - extreme) <= 0.1 * a!;

  const present =
    rangeAtrRatio <= ACCUM_MAX_RANGE_ATR && compressionRatio <= ACCUM_MAX_BAR_RANGE_ATR;

  return {
    present,
    startIndex,
    endIndex,
    barsInRange,
    rangeAtrRatio: +rangeAtrRatio.toFixed(3),
    compressionRatio: +compressionRatio.toFixed(3),
    sweepAtRangeExtreme,
  };
}

export interface SweepQuality {
  /** How far beyond the level, in ATR units — may reach back past the
   *  single sweep bar if the raid took several bars to complete. */
  depthAtr: number;
  /** Consecutive bars (walking back from the sweep bar) still outside the
   *  swept level — 1 means the raid was a single-bar wick. */
  speedBars: number;
  /** Wick length / body length of the sweep bar itself. */
  shapeRatio: number;
  /** The sweep's own closeBackInside, normalized by ATR. */
  closeBackAtr: number;
}

/**
 * Manipulation-leg quality, as raw facts only (see file-section docstring —
 * no lineage source publishes a threshold here, and GATE.sameBarDisplacement
 * being live means the sweep bar and the "displacement" bar are frequently
 * IDENTICAL. Before trusting this as new information, correlate it against
 * the card's own DisplacementEvent.ratio — if they move together, this is
 * displacement magnitude measured twice, not independent signal.
 */
export function gradeSweepQuality(bars: OhlcBar[], sweep: SweepEvent): SweepQuality | null {
  const atr = rollingAtr(bars);
  const a = atr[sweep.index];
  if (!Number.isFinite(a) || a! <= 0) return null;
  const isBuy = sweep.side === "buyside";
  const bar = bars[sweep.index]!;

  let clusterExtreme = sweep.wickExtreme;
  let speedBars = 1;
  for (let j = sweep.index - 1; j >= Math.max(0, sweep.index - MM_DISPLACE_WITHIN); j--) {
    const b = bars[j]!;
    const stillOutside = isBuy ? b.c > sweep.sweptLevel : b.c < sweep.sweptLevel;
    if (!stillOutside) break;
    clusterExtreme = isBuy ? Math.max(clusterExtreme, b.h) : Math.min(clusterExtreme, b.l);
    speedBars++;
  }
  const depthAtr =
    (isBuy ? clusterExtreme - sweep.sweptLevel : sweep.sweptLevel - clusterExtreme) / a!;

  const bodySize = Math.abs(bar.c - bar.o);
  const wick = isBuy ? bar.h - Math.max(bar.o, bar.c) : Math.min(bar.o, bar.c) - bar.l;
  const shapeRatio = wick / Math.max(bodySize, 0.01);
  const closeBackAtr = sweep.closeBackInside / a!;

  return {
    depthAtr: +depthAtr.toFixed(3),
    speedBars,
    shapeRatio: +shapeRatio.toFixed(2),
    closeBackAtr: +closeBackAtr.toFixed(3),
  };
}

export interface DisplacementQuality {
  /** displacement.ratio, exposed here for convenience alongside the rest. */
  ratio: number;
  /** Close-location-value, signed toward the move's own direction: +1 =
   *  closed at the extreme in-direction, -1 = closed against it (a body
   *  that clears the ATR bar but is really a rejection tail). */
  directionalClv: number;
  /** Consecutive supporting bars immediately before the displacement bar:
   *  same direction, body >= half the displacement threshold. 1 = the
   *  displacement bar stood alone. */
  runLength: number;
}

/**
 * Distribution-leg (displacement) quality, as raw facts only — see
 * file-section docstring. Primary falsification risk: time-of-day /
 * session-volatility confound, not the bar's own shape — stratify by
 * session before trusting any correlation this surfaces.
 */
export function gradeDisplacementQuality(
  bars: OhlcBar[],
  displacement: DisplacementEvent,
): DisplacementQuality {
  const bar = bars[displacement.index]!;
  const range = bar.h - bar.l || 0.01;
  const clv = (bar.c - bar.l - (bar.h - bar.c)) / range;
  const directionalClv = displacement.direction === "bull" ? clv : -clv;

  const atr = rollingAtr(bars);
  let runLength = 1;
  for (let k = 1; k <= OB_SCAN_BACK; k++) {
    const idx = displacement.index - k;
    if (idx < 0) break;
    const b = bars[idx]!;
    const a = atr[idx];
    if (!Number.isFinite(a) || a! <= 0) break;
    const sameDir = displacement.direction === "bull" ? b.c > b.o : b.c < b.o;
    const halfBody = Math.abs(b.c - b.o) >= 0.5 * GATE.displacementK * a!;
    if (!sameDir || !halfBody) break;
    runLength++;
  }

  return {
    ratio: displacement.ratio,
    directionalClv: +directionalClv.toFixed(3),
    runLength,
  };
}

/* ------------------------------------------------------------------ */
/* Mitigation blocks                                                     */
/* ------------------------------------------------------------------ */

/**
 * Mitigation block (ICT), RESEARCHED and VERIFIED 2026-09-30 against
 * multiple independent sources (canon.ts moduleId "sweep") — distinct from
 * both an order block (fresh, unspent origin of a displacement) and a
 * breaker (an order block that got closed through and now acts as the
 * opposite polarity). A mitigation block forms from a FAILED second push:
 * price sets a swing extreme, pulls back, pushes again but FAILS to exceed
 * the first extreme (a lower high after a high, or a higher low after a
 * low), then breaks structure back through the pullback swing — confirming
 * the failed push was a trapped, underfilled attempt. The pullback swing
 * candle IS the zone: it is the last bar before the failed push began, by
 * construction of fractalSwings().
 *
 * THIS FIXES A REAL BUG, independent of whether the concept has edge:
 * scanner.ts's old "mitigation" confluence component computed
 * `ob.mitigated && obAligned`, where `obAligned` already requires
 * `!ob.mitigated` — a permanent `X && !X`, always false, for every bar,
 * confirmed by direct read. That component fed a weight-3 confluence slot
 * (engine-weights.ts) and one of five OR'd paths in smc-canon.ts's POI
 * must-layer, both silently and permanently dead since OrderBlock.mitigated
 * was redefined 2026-09-23 (from "touched" to "SPENT/closed-through") and
 * this component was never updated to match.
 *
 * Deliberately does NOT reuse the word "mitigated" for its own state field
 * below (see `invalidated`) — that exact word's redefinition is what let
 * the scanner.ts bug ship unnoticed; a second concept reusing the same word
 * for a different thing would repeat the mistake.
 *
 * No independent (non-ICT-community) validation exists for this concept —
 * treat any measured result as a coin flip until proven otherwise. TJR's
 * own glossary does not use the term (same pattern already found for
 * Photon/"inducement").
 */
export const MITIGATION_WINDOW_BARS = 16;

export interface MitigationBlock {
  /** Polarity the zone acts as when retested: bull = support, bear = resistance. */
  kind: "bull" | "bear";
  index: number;
  t: number;
  bodyTop: number;
  bodyBottom: number;
  rangeTop: number;
  rangeBottom: number;
  /** The first swing extreme (H1 / L1) the second push failed to exceed. */
  priorExtreme: SwingPoint;
  /** The second, failed swing (H2 < H1, or L2 > L1). */
  failedExtreme: SwingPoint;
  /** The pullback swing between them — also the zone's own candle. */
  breakLevel: SwingPoint;
  confirmedIndex: number;
  confirmedT: number;
  /** A later CLOSE retook failedExtreme's own price — the "failure" was not real. */
  invalidated: boolean;
  invalidatedIndex: number | null;
  invalidatedT: number | null;
}

export interface MitigationRead {
  /** True only when a confirmed block exists and has not been invalidated. */
  present: boolean;
  block: MitigationBlock | null;
}

const NO_MITIGATION: MitigationRead = { present: false, block: null };

/**
 * `side` follows the same long/short convention as detectInducement: "long"
 * looks for a failed-lower-low (bullish reversal, zone acts as support);
 * "short" looks for a failed-higher-high (bearish reversal, zone acts as
 * resistance). Scans swing pairs newest-first and returns the first fully
 * confirmed pair found — mirrors detectOrderBlocks/detectInducement's own
 * "most recent qualifying event" convention rather than requiring the
 * caller to separately filter for recency.
 */
export function detectMitigationBlock(
  bars: OhlcBar[],
  side: "long" | "short",
  opts: { windowBars?: number; confirmWithinBars?: number } = {},
): MitigationRead {
  if (bars.length < MIN_BARS) return NO_MITIGATION;
  const windowBars = opts.windowBars ?? MITIGATION_WINDOW_BARS;
  const confirmWithin = opts.confirmWithinBars ?? MM_DISPLACE_WITHIN;
  const swingKind = side === "long" ? "low" : "high";
  const oppositeKind = side === "long" ? "high" : "low";
  const allSwings = fractalSwings(bars);
  const swings = allSwings.filter((s) => s.kind === swingKind);
  if (swings.length < 2) return NO_MITIGATION;

  for (let i = swings.length - 1; i >= 1; i--) {
    const failed = swings[i]!;
    const prior = swings[i - 1]!;
    if (failed.index - prior.index > windowBars) continue;
    const didFail = side === "long" ? failed.price > prior.price : failed.price < prior.price;
    if (!didFail) continue;

    const breakLevel = allSwings
      .filter((s) => s.kind === oppositeKind && s.index > prior.index && s.index < failed.index)
      .sort((a, b) => b.index - a.index)[0];
    if (!breakLevel) continue;

    let confirmedIndex = -1;
    const confirmCeil = Math.min(bars.length - 1, failed.index + confirmWithin);
    for (let j = failed.index + 1; j <= confirmCeil; j++) {
      const b = bars[j]!;
      const broke = side === "long" ? b.c > breakLevel.price : b.c < breakLevel.price;
      if (broke) {
        confirmedIndex = j;
        break;
      }
    }
    if (confirmedIndex < 0) continue;

    const zoneBar = bars[breakLevel.index]!;
    const block: MitigationBlock = {
      kind: side === "long" ? "bull" : "bear",
      index: breakLevel.index,
      t: zoneBar.t,
      bodyTop: Math.max(zoneBar.o, zoneBar.c),
      bodyBottom: Math.min(zoneBar.o, zoneBar.c),
      rangeTop: zoneBar.h,
      rangeBottom: zoneBar.l,
      priorExtreme: prior,
      failedExtreme: failed,
      breakLevel,
      confirmedIndex,
      confirmedT: bars[confirmedIndex]!.t,
      invalidated: false,
      invalidatedIndex: null,
      invalidatedT: null,
    };

    for (let j = confirmedIndex + 1; j < bars.length; j++) {
      const b = bars[j]!;
      const retook = side === "long" ? b.c < failed.price : b.c > failed.price;
      if (retook) {
        block.invalidated = true;
        block.invalidatedIndex = j;
        block.invalidatedT = b.t;
        break;
      }
    }

    return { present: !block.invalidated, block };
  }

  return NO_MITIGATION;
}

/* ------------------------------------------------------------------ */
/* Blake — the swing, not a generic CISD                                */
/* ------------------------------------------------------------------ */

/**
 * Blake's model is a SWING with four named parts, and the desk has been
 * grading it with `cisdThroughSeries` (raid-pair.ts) — "a close back through
 * a run of opposing candles". That fires on any momentum flip anywhere, with
 * no raid, no pullback and no level to close through. It is a different
 * model wearing Blake's name.
 *
 * For a long: a LOW, then a pullback HIGH, then a LOWER LOW that takes the
 * first low, then a candle whose BODY closes back through that pullback high.
 * Short is the mirror. The lower low IS the raid (it takes the first low's
 * resting orders) and the pullback high is the level the body has to reclaim
 * — a close through it is the statement that the raid failed. A CISD that
 * never traded back through the pullback swing does not qualify, which is
 * precisely the case the generic test was passing.
 *
 * All four parts come from `fractalSwings`, so a part is only usable
 * MM_SWING_WIDTH bars after it formed — no lookahead.
 *
 * This is a DETECTOR, not a new gate: it is stricter than what ships today,
 * so wiring it will cut the blake card count, and nobody has measured by how
 * much or at what expectancy. Report, then measure, then wire.
 */
export const BLAKE_WINDOW_BARS = 16;

export interface BlakeSwing {
  /** Polarity of the trade the swing implies. */
  kind: "bull" | "bear";
  /** L1 / H1 — the first extreme the later push took out. */
  firstExtreme: SwingPoint;
  /** The pullback swing between them. Its PRICE is the level a body must
   *  close through, and the one the generic CISD test never checked. */
  pullback: SwingPoint;
  /** L2 / H2 — the lower low (or higher high) that took `firstExtreme`. */
  takeExtreme: SwingPoint;
  /** The candle whose body closed back through `pullback`. */
  confirmIndex: number;
  confirmT: number;
  confirmClose: number;
  /** The raid wick — `takeExtreme`'s own price, i.e. the stop side. */
  stop: number;
}

export interface BlakeRead {
  present: boolean;
  swing: BlakeSwing | null;
  reason: string;
}

const NO_BLAKE = (reason: string): BlakeRead => ({ present: false, swing: null, reason });

/**
 * `side` follows the long/short convention the rest of this file uses.
 * Scans swing pairs newest-first and returns the first fully confirmed one,
 * same convention as detectMitigationBlock.
 *
 * `confirmWithinBars` defaults to MM_DISPLACE_WITHIN (6) — the same
 * handful-of-candles family as the mechanical window, not a new number. Pass
 * `mechanicalWindowBars(bars)` for the minute-derived version.
 * `maxAgeBars` defaults to GATE.recentSweepBars, the window every other layer
 * already uses for "is this the raid this session trades".
 */
export function detectBlakeSwing(
  bars: OhlcBar[],
  side: "long" | "short",
  opts: { windowBars?: number; confirmWithinBars?: number; maxAgeBars?: number } = {},
): BlakeRead {
  if (bars.length < MIN_BARS) return NO_BLAKE("Not enough bars for swings.");
  const windowBars = opts.windowBars ?? BLAKE_WINDOW_BARS;
  const confirmWithin = opts.confirmWithinBars ?? MM_DISPLACE_WITHIN;
  const maxAge = opts.maxAgeBars ?? GATE.recentSweepBars;
  const long = side === "long";
  const extremeKind: "high" | "low" = long ? "low" : "high";
  const pullbackKind: "high" | "low" = long ? "high" : "low";
  const lastIndex = bars.length - 1;

  const all = fractalSwings(bars);
  const extremes = all.filter((s) => s.kind === extremeKind);
  if (extremes.length < 2) return NO_BLAKE("Fewer than two swings of the raid's own kind.");

  let sawTake = false;
  let sawPullback = false;
  for (let i = extremes.length - 1; i >= 1; i--) {
    const take = extremes[i]!;
    const first = extremes[i - 1]!;
    if (take.index - first.index > windowBars) continue;
    // The second push must TAKE the first extreme, not merely follow it.
    const took = long ? take.price < first.price : take.price > first.price;
    if (!took) continue;
    sawTake = true;

    // The pullback between them. When several printed, the relevant level is
    // the most extreme one — the full height of the pullback is what a body
    // has to reclaim, and taking the nearest instead would be the loose read.
    const between = all.filter(
      (s) => s.kind === pullbackKind && s.index > first.index && s.index < take.index,
    );
    if (!between.length) continue;
    const pullback = between.reduce((best, s) =>
      long ? (s.price > best.price ? s : best) : (s.price < best.price ? s : best),
    );
    sawPullback = true;

    const ceil = Math.min(lastIndex, take.index + confirmWithin);
    for (let j = take.index + 1; j <= ceil; j++) {
      const b = bars[j]!;
      // BODY close through the level: the close is beyond it AND the candle
      // is a body in that direction. A wick that pierced and closed back is
      // the thing this detector exists to refuse.
      const bodyThrough = long ? b.c > pullback.price && b.c > b.o : b.c < pullback.price && b.c < b.o;
      if (!bodyThrough) continue;
      if (lastIndex - j > maxAge)
        return NO_BLAKE(
          `A blake swing confirmed ${lastIndex - j} bars ago, past the ${maxAge}-bar window. Not this session's.`,
        );
      return {
        present: true,
        swing: {
          kind: long ? "bull" : "bear",
          firstExtreme: first,
          pullback,
          takeExtreme: take,
          confirmIndex: j,
          confirmT: b.t,
          confirmClose: b.c,
          stop: take.price,
        },
        reason: `${long ? "Low" : "High"} at ${first.price}, pullback ${pullbackKind} at ${pullback.price}, ${long ? "lower low" : "higher high"} at ${take.price} took it, then a body close at ${b.c} back through the pullback.`,
      };
    }
  }

  if (sawPullback)
    return NO_BLAKE(
      "The raid and the pullback printed, but no body ever closed back through the pullback swing. A CISD here is not blake.",
    );
  if (sawTake) return NO_BLAKE("A lower low took the prior low, but no pullback swing sits between them.");
  return NO_BLAKE("No second push took the prior extreme inside the window.");
}

/**
 * Mechanical model (engine weight 0.14 — its highest): sweep → displacement
 * in the opposite direction within MM_DISPLACE_WITHIN (6) bars → FVG or iFVG
 * created by that displacement → retest of the zone. `complete` is true ONLY
 * with all legs — partial sequences are reported with their state but never
 * marked complete (engine lesson: "refuse partial sequences").
 *
 * SELECTION (changed in Phase A2): still-ALIVE first, then how far the
 * sequence got, then recency. Previously it ranked by state alone with
 * recency as a tiebreak only WITHIN an equal rank, so a `retest_ready` whose
 * zone had been abandoned 300 bars earlier permanently outranked every fresh
 * sequence — and nothing in the file ever expired or invalidated a sequence.
 */
export function detectMechanicalModel(bars: OhlcBar[]): MechanicalSequence {
  const idle: MechanicalSequence = {
    state: "idle",
    direction: null,
    sweep: null,
    displacement: null,
    zone: null,
    retest: null,
    complete: false,
    legsComplete: false,
    // `idle` is not a live setup — it is the absence of one. Seeding it dead
    // means any live sequence wins outright, and a dead-but-real sequence
    // still beats it on rank so the desk can report what died.
    alive: false,
    invalidation: null,
    ageBars: 0,
  };
  if (bars.length < MIN_BARS) return idle;
  const lastIndex = bars.length - 1;

  const sweeps = detectSweeps(bars);
  if (!sweeps.length) return idle;
  const displacements = detectDisplacements(bars);
  const fvgs = detectFvgs(bars);
  // ITEM 6: the confirmation window in the series' OWN units. On the desk's
  // 15m structure series this is 2 bars (30 min), not 6 (90 min) — a
  // displacement ninety minutes after the raid is no longer the answer to it.
  const within = mechanicalWindowBars(bars);

  const rank: Record<MechanicalState, number> = {
    idle: 0,
    swept: 1,
    displaced: 2,
    inverted: 3,
    retest_ready: 4,
    complete: 5,
  };
  let best = idle;

  for (const sweep of sweeps) {
    // Leg 1: sweep. Sellside sweep → long model; buyside sweep → short model.
    const direction: "long" | "short" =
      sweep.side === "sellside" ? "long" : "short";
    const wantDisp = direction === "long" ? "bull" : "bear";
    const seq: MechanicalSequence = {
      state: "swept",
      direction,
      sweep,
      displacement: null,
      zone: null,
      retest: null,
      complete: false,
      legsComplete: false,
      alive: true,
      invalidation: null,
      ageBars: 0,
    };

    // Leg 2: opposite-direction displacement inside the minute-derived window.
    const disp = displacements.find(
      (d) =>
        d.direction === wantDisp &&
        d.index > sweep.index &&
        d.index <= sweep.index + within,
    );
    if (disp) {
      seq.displacement = disp;
      seq.state = "displaced";

      // Leg 3: FVG created by the displacement (displacement bar is one of
      // the 3 candles: createdIndex ∈ [disp.index, disp.index + 2]) with the
      // move's direction — OR an opposite-direction FVG that the displacement
      // leg inverted (iFVG), inversion landing in the same window.
      const fvg = fvgs.find(
        (g) =>
          g.kind === wantDisp &&
          g.createdIndex >= disp.index &&
          g.createdIndex <= disp.index + 2,
      );
      const ifvg = fvgs.find(
        (g) =>
          g.kind !== wantDisp &&
          g.inverted &&
          g.invertedIndex != null &&
          g.invertedIndex >= disp.index &&
          g.invertedIndex <= disp.index + 2,
      );
      const zoneSrc = fvg ?? ifvg;
      if (zoneSrc) {
        const createdIndex =
          zoneSrc === fvg
            ? zoneSrc.createdIndex
            : (zoneSrc.invertedIndex ?? zoneSrc.createdIndex);
        seq.zone = {
          source: zoneSrc === fvg ? "fvg" : "ifvg",
          top: zoneSrc.top,
          bottom: zoneSrc.bottom,
          createdIndex,
          createdT: bars[createdIndex]!.t,
        };
        seq.state = "inverted";

        // Leg 4: retest. First the price must LEAVE the zone (armed →
        // retest_ready), then trade back into it (complete).
        let armed = false;
        for (let j = createdIndex + 1; j < bars.length; j++) {
          const b = bars[j]!;
          const away =
            direction === "long"
              ? b.l > seq.zone.top // fully above a bullish zone
              : b.h < seq.zone.bottom; // fully below a bearish zone
          const touch =
            direction === "long"
              ? b.l <= seq.zone.top && b.h >= seq.zone.bottom
              : b.h >= seq.zone.bottom && b.l <= seq.zone.top;
          if (!armed && away) {
            armed = true;
            seq.state = "retest_ready";
            continue;
          }
          if (armed && touch) {
            seq.retest = {
              index: j,
              t: b.t,
              price:
                direction === "long"
                  ? Math.min(b.h, seq.zone.top)
                  : Math.max(b.l, seq.zone.bottom),
            };
            seq.state = "complete";
            seq.legsComplete = true;
            break;
          }
        }
      }
    }

    /* -------------------------------------------------------------- */
    /* Lifecycle: expiry + invalidation (Phase A2)                      */
    /* -------------------------------------------------------------- */

    // "Armed" = the latest leg this sequence actually reached. Everything
    // after this point is measured from it, not from the sweep, so a
    // sequence that keeps progressing keeps resetting its own clock.
    const armIndex =
      seq.zone?.createdIndex ?? seq.displacement?.index ?? sweep.index;
    seq.ageBars = lastIndex - (seq.retest?.index ?? armIndex);

    // (1) Structure break — a CLOSE beyond the sweep's own wick extreme. That
    // level is what the entire model is predicated on holding (it is also the
    // trade's stop), so it invalidates from the moment the sweep prints, not
    // only after arming.
    let structureBreak = false;
    for (let j = sweep.index + 1; j <= lastIndex; j++) {
      const c = bars[j]!.c;
      if (
        direction === "long" ? c < sweep.wickExtreme : c > sweep.wickExtreme
      ) {
        structureBreak = true;
        break;
      }
    }

    // (2) Contrary sweep after arming — the OPPOSITE pool has since been
    // hunted, so this sequence is no longer the live story regardless of how
    // far through the state machine it got.
    const contrarySweep = sweeps.some(
      (s) => s.index > armIndex && s.side !== sweep.side,
    );

    // (3)–(5) Ageing. Order below is deliberate: price-action invalidation
    // outranks mere elapsed time when reporting the reason.
    seq.invalidation = structureBreak
      ? "structure_break"
      : contrarySweep
        ? "contrary_sweep"
        : seq.state === "swept" && seq.ageBars > within
          ? // The displacement window closed empty — leg 2 can no longer
            // arrive for this sweep, so the sequence can never advance.
            "displacement_window_closed"
          : seq.state === "complete"
            ? seq.ageBars > MM_MAX_COMPLETE_AGE
              ? "stale_complete"
              : null
            : seq.ageBars > MM_MAX_ARMED_AGE
              ? "stale_armed"
              : null;
    seq.alive = seq.invalidation === null;
    seq.complete = seq.legsComplete && seq.alive;

    // ALIVE first, then rank, then recency. Each term is 0 when equal, so
    // `||` falls through to the next tiebreak.
    const better =
      (seq.alive ? 1 : 0) - (best.alive ? 1 : 0) ||
      rank[seq.state] - rank[best.state] ||
      (seq.sweep?.index ?? -1) - (best.sweep?.index ?? -1);
    if (better > 0) best = seq;
  }

  return best;
}

/* ------------------------------------------------------------------ */
/* Summary — shaped for future scanner integration                      */
/* ------------------------------------------------------------------ */

export interface DetectorSummary {
  bars: number;
  atr: number | null;
  fvg: {
    count: number;
    open: number; // not fully filled, not inverted
    inverted: number;
    inversionRetested: number;
    latest: FvgResult | null;
  };
  displacement: {
    count: number;
    /** Most recent displacement within RECENT_DISPLACEMENT_BARS of the end, else null. */
    latest: DisplacementEvent | null;
    /** Most recent ever, regardless of age (history / debrief only). */
    lastEver: DisplacementEvent | null;
  };
  orderBlock: {
    count: number;
    unmitigated: number;
    latest: OrderBlock | null;
  };
  sweep: {
    count: number;
    /** Most recent sweep within RECENT_SWEEP_BARS of the end, else null. */
    latest: SweepEvent | null;
    /** Most recent ever, regardless of age (history / debrief only). */
    lastEver: SweepEvent | null;
    /**
     * Tri-state confirmation of `latest` on the finer tape. null means the
     * question was NOT ASKED (no `minute` series handed in) — which must
     * read the same as "no_tape": never as confirmation.
     */
    tape: SweepTapeRead | null;
  };
  mechanical: MechanicalSequence;
}

/**
 * Recency windows for `latest`. Before 2026-09-16 `latest` was the last event
 * in the whole series, so a sweep from two days ago lit today's
 * `sweep_significant` component and a displacement from yesterday satisfied
 * the LTF-shift layer. On the desk's 15m structure series:
 *   - sweep: 24 bars = 6h — a London-open raid (03:00 ET) still counts at the
 *     NY open; anything older is not "the raid" this session trades.
 *   - displacement: 12 bars = 3h — the impulse has to belong to this morning.
 */
/** Original recency windows. Live values are GATE.recent*Bars (gate-tuning.ts). */
export const RECENT_SWEEP_BARS = 24;
export const RECENT_DISPLACEMENT_BARS = 12;

function recent<T extends { index: number }>(events: T[], total: number, window: number): T | null {
  if (!events.length) return null;
  const last = events[events.length - 1]!;
  return total - 1 - last.index <= window ? last : null;
}

/**
 * One-call summary over a bar series: counts + latest instances per
 * detector. This is the shape the scanner integrator consumes — see
 * INTEGRATION-P2.md for how each field maps onto a confluence component.
 */
export function summarizeDetectors(
  bars: OhlcBar[],
  opts: { minute?: OhlcBar[] | null; nowMs?: number } = {},
): DetectorSummary {
  const fvgs = detectFvgs(bars);
  const displacements = detectDisplacements(bars);
  const blocks = detectOrderBlocks(bars);
  const sweeps = detectSweeps(bars);
  const mechanical = detectMechanicalModel(bars);
  const atrSeries = rollingAtr(bars);
  const lastAtr = atrSeries.length ? atrSeries[atrSeries.length - 1]! : NaN;
  const latestSweep = recent(sweeps, bars.length, GATE.recentSweepBars);

  return {
    bars: bars.length,
    atr: Number.isFinite(lastAtr) ? +lastAtr.toFixed(2) : null,
    fvg: {
      count: fvgs.length,
      open: fvgs.filter((g) => g.fill !== "full" && !g.inverted).length,
      inverted: fvgs.filter((g) => g.inverted).length,
      inversionRetested: fvgs.filter((g) => g.inversionRetested).length,
      latest: fvgs.length ? fvgs[fvgs.length - 1]! : null,
    },
    displacement: {
      count: displacements.length,
      latest: recent(displacements, bars.length, GATE.recentDisplacementBars),
      lastEver: displacements.length ? displacements[displacements.length - 1]! : null,
    },
    orderBlock: {
      count: blocks.length,
      unmitigated: blocks.filter((b) => !b.mitigated).length,
      latest: blocks.length ? blocks[blocks.length - 1]! : null,
    },
    sweep: {
      count: sweeps.length,
      latest: latestSweep,
      lastEver: sweeps.length ? sweeps[sweeps.length - 1]! : null,
      tape:
        opts.minute && latestSweep
          ? confirmSweepOnTape(latestSweep, bars, opts.minute, { nowMs: opts.nowMs })
          : null,
    },
    mechanical,
  };
}
