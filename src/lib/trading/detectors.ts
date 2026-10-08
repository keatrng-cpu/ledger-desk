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
 */
export const MM_DISPLACE_WITHIN = 6;

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
}

/**
 * Displacement candles: body >= DISPLACEMENT_K (1.5) × rolling ATR(14) of
 * bar ranges, with the close in the move's direction (bull = c > o).
 */
export function detectDisplacements(bars: OhlcBar[]): DisplacementEvent[] {
  if (bars.length < MIN_BARS) return [];
  const atr = rollingAtr(bars);
  const out: DisplacementEvent[] = [];
  for (let i = ATR_PERIOD; i < bars.length; i++) {
    const b = bars[i]!;
    const a = atr[i]!;
    if (!Number.isFinite(a) || a <= 0) continue;
    const bs = body(b);
    if (bs >= GATE.displacementK * a && b.c !== b.o) {
      out.push({
        index: i,
        t: b.t,
        direction: b.c > b.o ? "bull" : "bear",
        bodySize: +bs.toFixed(2),
        atr: +a.toFixed(2),
        ratio: +(bs / a).toFixed(2),
        open: b.o,
        close: b.c,
      });
    }
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

    // Leg 2: opposite-direction displacement within MM_DISPLACE_WITHIN bars.
    const disp = displacements.find(
      (d) =>
        d.direction === wantDisp &&
        d.index > sweep.index &&
        d.index <= sweep.index + MM_DISPLACE_WITHIN,
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
        : seq.state === "swept" && seq.ageBars > MM_DISPLACE_WITHIN
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
export function summarizeDetectors(bars: OhlcBar[]): DetectorSummary {
  const fvgs = detectFvgs(bars);
  const displacements = detectDisplacements(bars);
  const blocks = detectOrderBlocks(bars);
  const sweeps = detectSweeps(bars);
  const mechanical = detectMechanicalModel(bars);
  const atrSeries = rollingAtr(bars);
  const lastAtr = atrSeries.length ? atrSeries[atrSeries.length - 1]! : NaN;

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
      latest: recent(sweeps, bars.length, GATE.recentSweepBars),
      lastEver: sweeps.length ? sweeps[sweeps.length - 1]! : null,
    },
    mechanical,
  };
}
