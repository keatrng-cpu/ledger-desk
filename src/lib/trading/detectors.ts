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
export const DISPLACEMENT_K = 1.5;

/**
 * FVG qualification: the middle candle (bar[i-1]) of the 3-bar window must
 * have a body >= 1.0 × ATR(14). A gap left by a sub-average candle is noise;
 * requiring a displacement-grade middle body keeps FVGs meaningful without
 * demanding the full 1.5× displacement threshold.
 */
export const FVG_MIDDLE_BODY_ATR = 1.0;

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
    // Threshold: middle body must be >= FVG_MIDDLE_BODY_ATR × ATR(14).
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
    if (bs >= DISPLACEMENT_K * a && b.c !== b.o) {
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
  /** Mitigated = price traded back into the FULL range zone after the move. */
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
      const touches =
        d.direction === "bull"
          ? b.l <= block.rangeTop // price dips back into a bull OB below
          : b.h >= block.rangeBottom; // price lifts back into a bear OB above
      if (touches) {
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
    latest: DisplacementEvent | null;
  };
  orderBlock: {
    count: number;
    unmitigated: number;
    latest: OrderBlock | null;
  };
  sweep: {
    count: number;
    latest: SweepEvent | null;
  };
  mechanical: MechanicalSequence;
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
      latest: displacements.length
        ? displacements[displacements.length - 1]!
        : null,
    },
    orderBlock: {
      count: blocks.length,
      unmitigated: blocks.filter((b) => !b.mitigated).length,
      latest: blocks.length ? blocks[blocks.length - 1]! : null,
    },
    sweep: {
      count: sweeps.length,
      latest: sweeps.length ? sweeps[sweeps.length - 1]! : null,
    },
    mechanical,
  };
}
