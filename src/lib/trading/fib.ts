/**
 * Fibonacci retracement / extension — OTE (Optimal Trade Entry).
 *
 * WHY THIS FILE EXISTS. Two independent audits (2026-08-12, 2026-08-13)
 * found ZERO Fibonacci math anywhere in this repo — no 0.618, no 0.705, no
 * 0.79, no retracement, in any file. The upstream Python engine does not
 * have it either: its own CLAUDE.md specifies OTE in the model and then
 * lists it under "NOT implemented (need fib.py, none built)". So OTE has
 * been named in the desk's rules and in its strategy copy the whole time
 * while nothing computed it.
 *
 * That gap has a measured cost. On 2026-08-13 the open manipulated into
 * equilibrium and a gap, then reversed hard to the highs. The retracement
 * into that gap IS the OTE entry — the one thing that would have priced the
 * reversal — and the desk had no way to express it.
 *
 * WHAT OTE IS, precisely (ICT): after an impulse leg, price retraces into
 * the 61.8%–79% band of that leg. 70.5% is the commonly-cited sweet spot
 * (the midpoint of 0.618 and 0.79, and near the 0.707 square-root-of-2
 * level). Deeper than 79% invalidates the leg's premise; shallower than
 * 61.8% is not yet discounted enough to be "optimal".
 *
 * MEASUREMENT DIRECTION MATTERS. For a BULLISH leg (low -> high) the
 * retracement is measured DOWN from the high, so 0.79 sits NEARER the low.
 * For a BEARISH leg (high -> low) it is measured UP from the low. Getting
 * this backwards silently produces a zone on the wrong half of the leg,
 * which is why the anchors are named `from`/`to` rather than `high`/`low`.
 *
 * Pure and deterministic — no I/O, no dates, no randomness. Same discipline
 * as the rest of src/lib/trading.
 */

import type { OhlcBar } from "@/lib/market/types";

/** Classic ICT OTE band. */
export const OTE_SHALLOW = 0.618;
export const OTE_DEEP = 0.79;
/** The sweet spot inside the band. */
export const OTE_OPTIMAL = 0.705;

/** Retracement ratios worth drawing, shallow -> deep. */
export const RETRACEMENT_LEVELS = [0.236, 0.382, 0.5, 0.618, 0.705, 0.79] as const;

/** Extension ratios beyond the leg's origin, used for targets. */
export const EXTENSION_LEVELS = [1.0, 1.272, 1.618, 2.0] as const;

/**
 * A directional impulse leg. `from` is where the move STARTED, `to` is the
 * extreme it reached — so for a bull leg `from < to`, and for a bear leg
 * `from > to`. Retracement is always measured back from `to` toward `from`.
 */
export interface ImpulseLeg {
  direction: "bull" | "bear";
  from: number;
  to: number;
  /** Bar index of `from`, when known — lets callers age the leg. */
  fromIndex?: number;
  toIndex?: number;
}

export interface FibLevel {
  ratio: number;
  price: number;
}

export interface OteRead {
  leg: ImpulseLeg;
  /** |to - from|. Zero-length legs are rejected before this is built. */
  legSize: number;
  /** The 61.8%–79% band, ordered low..high in PRICE terms. */
  zoneLow: number;
  zoneHigh: number;
  /** The 70.5% sweet spot. */
  optimal: number;
  /** Equilibrium (50%) of the leg — cheaper than OTE, reported for context. */
  equilibrium: number;
  /** Every retracement level, for display. */
  retracements: FibLevel[];
  /** Extensions beyond `to`, for targets. */
  extensions: FibLevel[];
}

/** Price at `ratio` retraced from the leg's extreme back toward its origin. */
export function retracementPrice(leg: ImpulseLeg, ratio: number): number {
  // Measured from `to` back toward `from`, so ratio 0 == to and 1 == from.
  return leg.to - (leg.to - leg.from) * ratio;
}

/** Price at `ratio` extended beyond the leg's extreme, away from its origin. */
export function extensionPrice(leg: ImpulseLeg, ratio: number): number {
  return leg.from + (leg.to - leg.from) * ratio;
}

/** Zero-length or non-finite legs cannot produce meaningful ratios. */
export function isUsableLeg(leg: ImpulseLeg | null | undefined): leg is ImpulseLeg {
  if (!leg) return false;
  if (!Number.isFinite(leg.from) || !Number.isFinite(leg.to)) return false;
  if (Math.abs(leg.to - leg.from) <= 0) return false;
  // Direction must agree with the anchors, or every level lands inverted.
  return leg.direction === "bull" ? leg.to > leg.from : leg.to < leg.from;
}

/** Full fib read for a leg, or null when the leg cannot support one. */
export function readOte(leg: ImpulseLeg | null | undefined): OteRead | null {
  if (!isUsableLeg(leg)) return null;

  const a = retracementPrice(leg, OTE_SHALLOW);
  const b = retracementPrice(leg, OTE_DEEP);
  return {
    leg,
    legSize: Math.abs(leg.to - leg.from),
    // Order by PRICE, not by ratio — for a bear leg the deep level is higher.
    zoneLow: Math.min(a, b),
    zoneHigh: Math.max(a, b),
    optimal: retracementPrice(leg, OTE_OPTIMAL),
    equilibrium: retracementPrice(leg, 0.5),
    retracements: RETRACEMENT_LEVELS.map((r) => ({
      ratio: r,
      price: retracementPrice(leg, r),
    })),
    extensions: EXTENSION_LEVELS.map((r) => ({
      ratio: r,
      price: extensionPrice(leg, r),
    })),
  };
}

/** Is `price` inside the OTE band (inclusive)? */
export function inOte(ote: OteRead | null | undefined, price: number): boolean {
  if (!ote || !Number.isFinite(price)) return false;
  return price >= ote.zoneLow && price <= ote.zoneHigh;
}

/**
 * How deep into the leg `price` sits, as a ratio. 0 == at the extreme,
 * 1 == fully retraced to the origin. Useful for "how discounted is this"
 * independent of the OTE band.
 */
export function retracementRatio(
  leg: ImpulseLeg | null | undefined,
  price: number,
): number | null {
  if (!isUsableLeg(leg) || !Number.isFinite(price)) return null;
  const span = leg.to - leg.from;
  if (span === 0) return null;
  return (leg.to - price) / span;
}

/**
 * TJR's "79% extension close" confirmation: price CLOSED beyond 79% of the
 * retracement leg, i.e. it went so deep that the prior leg's premise is
 * spent and a reversal is being confirmed rather than a pullback continuing.
 *
 * Distinct from `inOte` — that asks "is this a good entry", this asks
 * "has the counter-move gone too far to still be a pullback".
 */
export function closedBeyondDeepOte(
  leg: ImpulseLeg | null | undefined,
  closePrice: number,
): boolean {
  const r = retracementRatio(leg, closePrice);
  return r != null && r > OTE_DEEP;
}

/**
 * Find the most recent impulse leg from bars, anchored at a known origin.
 *
 * The origin is the sweep's wick extreme when there is one — that is the
 * ICT construction: the raid makes the low (bull case) and the displacement
 * away from it makes the leg whose retracement you then buy. Falling back to
 * the window's own extreme keeps this usable when no sweep is on the tape,
 * but a caller with a real sweep should always pass it.
 */
export function buildImpulseLeg(
  bars: OhlcBar[],
  direction: "bull" | "bear",
  opts?: { originPrice?: number; originIndex?: number; lookback?: number },
): ImpulseLeg | null {
  if (!bars.length) return null;
  const lookback = Math.max(2, opts?.lookback ?? 60);
  const start = Math.max(0, bars.length - lookback);
  const window = bars.slice(start);
  if (window.length < 2) return null;

  if (direction === "bull") {
    // Origin = the low the move started from; extreme = highest high after it.
    let fromIndex = 0;
    let from = opts?.originPrice;
    if (from == null) {
      let lo = Infinity;
      window.forEach((b, i) => {
        if (b.l < lo) {
          lo = b.l;
          fromIndex = i;
        }
      });
      from = lo;
    } else if (opts?.originIndex != null) {
      fromIndex = Math.max(0, opts.originIndex - start);
    }
    // The extreme must come AFTER the origin, or it is not this leg's high.
    let to = -Infinity;
    let toIndex = fromIndex;
    for (let i = fromIndex; i < window.length; i += 1) {
      if (window[i]!.h > to) {
        to = window[i]!.h;
        toIndex = i;
      }
    }
    if (!Number.isFinite(to) || to <= from) return null;
    return {
      direction,
      from,
      to,
      fromIndex: start + fromIndex,
      toIndex: start + toIndex,
    };
  }

  let fromIndex = 0;
  let from = opts?.originPrice;
  if (from == null) {
    let hi = -Infinity;
    window.forEach((b, i) => {
      if (b.h > hi) {
        hi = b.h;
        fromIndex = i;
      }
    });
    from = hi;
  } else if (opts?.originIndex != null) {
    fromIndex = Math.max(0, opts.originIndex - start);
  }
  let to = Infinity;
  let toIndex = fromIndex;
  for (let i = fromIndex; i < window.length; i += 1) {
    if (window[i]!.l < to) {
      to = window[i]!.l;
      toIndex = i;
    }
  }
  if (!Number.isFinite(to) || to >= from) return null;
  return {
    direction,
    from,
    to,
    fromIndex: start + fromIndex,
    toIndex: start + toIndex,
  };
}

/**
 * Consequent Encroachment — the 50% midpoint of a gap/zone.
 *
 * ICT treats CE, not the gap edge, as the reference price inside an FVG.
 * The desk previously used the WHOLE gap as an entry zone, which makes the
 * planned risk depend on which edge you happened to fill at.
 */
export function consequentEncroachment(top: number, bottom: number): number {
  return (top + bottom) / 2;
}

/**
 * Where OTE and a POI zone (FVG/OB) overlap — the highest-quality entry in
 * the ICT construction, because two independent reasons point at the same
 * price. Returns null when they do not touch.
 */
export function oteZoneOverlap(
  ote: OteRead | null | undefined,
  zoneTop: number,
  zoneBottom: number,
): { low: number; high: number; mid: number } | null {
  if (!ote) return null;
  const zLow = Math.min(zoneTop, zoneBottom);
  const zHigh = Math.max(zoneTop, zoneBottom);
  const low = Math.max(ote.zoneLow, zLow);
  const high = Math.min(ote.zoneHigh, zHigh);
  if (low > high) return null;
  return { low, high, mid: (low + high) / 2 };
}
