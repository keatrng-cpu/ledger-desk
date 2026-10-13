/**
 * A raid and the displacement that answers it are one pair.
 *
 * The newest sweep does not erase the older one. Sellside taken still arms
 * a long after a later buyside tag, and that later tag only becomes the
 * trade if a bearish displacement actually answers it. The raid candle is
 * not the shift. The gap that counts is the one that displacement left.
 *
 * A strong extension is not a fade. A short inside a bullish run stays only
 * when bearish signs printed inside that run. A long inside a bearish run
 * stays only when bullish signs printed inside it.
 */

import type { OhlcBar } from "../market/types";
import {
  barSpanMs,
  fractalSwings,
  MM_SWING_WIDTH,
  detectDisplacements,
  detectFvgs,
  detectOrderBlocks,
  detectSweeps,
  mechanicalWindowBars,
  type DisplacementEvent,
  type SweepEvent,
} from "./detectors";
import { GATE } from "./gate-tuning";

/**
 * DATED SWEEPS (2026-10-13): a decay, not a cliff.
 *
 * Was: a raid older than GATE.recentSweepBars (24 × 15m = 6h) vanished on the
 * next bar. On 2026-10-13 the London SSL raids (02:15–03:15 ET) sat at age
 * 24–28 at the NY open and dropped off exactly while the 09:30 bar was
 * forming, so the brain printed "No raid yet" over a swept book.
 *
 * Now: full weight to `recentSweepBars`, linear to zero at twice that, and a
 * raid stays only while it is NOT invalidated — no close beyond its own wick
 * (that is where the stop lives). The weight is on the event (`ageWeight`)
 * for display/ranking; it does not enter q.
 */
export const SWEEP_DECAY = {
  get fullBars() {
    return GATE.recentSweepBars;
  },
  get maxBars() {
    return 2 * GATE.recentSweepBars;
  },
};

export function sweepAgeWeight(ageBars: number): number {
  const full = SWEEP_DECAY.fullBars;
  const max = SWEEP_DECAY.maxBars;
  if (ageBars <= full) return 1;
  if (ageBars >= max) return 0;
  return +(1 - (ageBars - full) / (max - full)).toFixed(3);
}

/** A close beyond the raid's own wick after the raid bar kills it. */
export function sweepInvalidated(bars: OhlcBar[], s: SweepEvent): boolean {
  for (let i = s.index + 1; i < bars.length; i++) {
    const c = bars[i]!.c;
    if (s.side === "sellside" ? c < s.wickExtreme : c > s.wickExtreme) return true;
  }
  return false;
}

export function recentRealSweeps(bars: OhlcBar[]): (SweepEvent & { ageWeight: number })[] {
  if (bars.length < 20) return [];
  const last = bars.length - 1;
  return detectSweeps(bars)
    .filter((s) => s.closeBackInside > 0)
    .map((s) => ({ ...s, ageWeight: sweepAgeWeight(last - s.index) }))
    .filter((s) => s.ageWeight > 0 && !sweepInvalidated(bars, s));
}

/**
 * The sweep that arms this side. A later sweep of the other pool does not
 * replace it.
 *
 * ITEM 12, DELIBERATELY NOT WIRED HERE. `readArmingSweep` (detectors.ts) can
 * say that the latest polarity raid took only a MINOR pool while a more extreme
 * swing beyond it is still unswept, i.e. that the raid may be the trap. Making
 * this function return `armingSweep` would turn that into a hard refusal of
 * 12.1% of MNQ and 9.2% of ES same-polarity sweeps, with ZERO measurement
 * behind it — and the 2026-09-21 precedent (18 gate variants, 0 takes) shows
 * how invisible that failure mode is. It is surfaced on the card instead
 * (`SetupCandidate.arming`, scanner.ts) and is the trader's call to promote.
 */
export function polaritySweep(bars: OhlcBar[], direction: "bull" | "bear"): SweepEvent | null {
  const side = direction === "bull" ? "sellside" : "buyside";
  const hits = recentRealSweeps(bars).filter((s) => s.side === side);
  return hits.length ? hits[hits.length - 1]! : null;
}

/**
 * A later bar, inside the mechanical window. The sweep candle itself is not
 * the shift.
 *
 * ITEM 6 — THE WINDOW IS WALL-CLOCK, NOT A BAR COUNT.
 *
 * This used the flat `MM_DISPLACE_WITHIN` (6), which is "a handful of candles"
 * on the 5m rung the model was described on and **90 minutes** on the 15m
 * series the desk actually grades. A displacement an hour and a half after a
 * raid is a different story, not the answer to that raid.
 *
 * `mechanicalWindowBars(bars)` reads the series' own bar spacing and takes the
 * MINIMUM of 30 wall-clock minutes and the original 6 bars, so no series
 * anywhere gets a LOOSER window than it has today — on 15m it tightens 6 -> 2,
 * on 5m it is unchanged at 6, and it falls back to 6 whenever the spacing
 * cannot be read (one bar, identical timestamps). `MM_WINDOW.mode = "bars"`
 * restores the old behaviour exactly in one flip.
 *
 * KNOWN RISK, STATED: on 15m, 30 minutes is 2 candles. The mechanical model
 * carries the highest single weight (0.14) and may complete less often, which
 * pushes the board onto weaker models rather than onto nothing. That is a
 * tightening in the safe direction (fewer takes, never more) and the four-year
 * census is what should confirm the cost.
 */
export function pairedDisplacement(
  bars: OhlcBar[],
  sweep: SweepEvent,
  direction: "bull" | "bear",
): DisplacementEvent | null {
  const within = mechanicalWindowBars(bars);
  const hits = detectDisplacements(bars).filter(
    (d) => d.direction === direction && d.index > sweep.index && d.index <= sweep.index + within,
  );
  return hits.length ? hits[hits.length - 1]! : null;
}

/**
 * The gap or order block the displacement just left. An older gap does not
 * qualify.
 *
 * ITEM 5 — the event now CARRIES the gap it left (`disp.gap`, Wave 1), so the
 * cheap answer is read off the displacement itself instead of re-deriving it
 * from a full `detectFvgs` pass. Same question, one source: a displacement
 * that reports its own gap cannot disagree with the gap list about whether it
 * left one.
 *
 * The `detectFvgs` scan stays as the fallback. `disp.gap` is null whenever the
 * third candle has not printed yet — the absence of evidence, not a no — and
 * it is also null for a displacement detected under a rule that did not need a
 * gap. The order-block branch is untouched.
 */
export function displacementLeftArray(
  bars: OhlcBar[],
  disp: DisplacementEvent,
  direction: "bull" | "bear",
): boolean {
  if (disp.gap) return true;
  const gap = detectFvgs(bars).some(
    (g) => g.kind === direction && g.createdIndex >= disp.index && g.createdIndex <= disp.index + 3,
  );
  if (gap) return true;
  return detectOrderBlocks(bars).some((o) => o.kind === direction && o.displacementIndex === disp.index);
}

/**
 * Which raid gets to name the trade: the latest real sweep that a later
 * displacement has answered. An unanswered tag of the other side does not.
 */
export function namingSweep(bars: OhlcBar[]): SweepEvent | null {
  const recent = recentRealSweeps(bars);
  for (let i = recent.length - 1; i >= 0; i--) {
    const s = recent[i]!;
    const direction = s.side === "sellside" ? "bull" : "bear";
    if (pairedDisplacement(bars, s, direction)) return s;
  }
  return null;
}

/**
 * Change in state of delivery: a close back through a run of opposing
 * candles, not "a break of structure and some displacement exist."
 */
export function cisdThroughSeries(
  bars: OhlcBar[],
  direction: "bull" | "bear",
  minIndex = 0,
): boolean {
  const start = Math.max(1, minIndex, bars.length - 20);
  const oppose = (b: OhlcBar) => (direction === "bull" ? b.c < b.o : b.c > b.o);
  for (let i = bars.length - 1; i >= start; i--) {
    const b = bars[i]!;
    const withDir = direction === "bull" ? b.c > b.o : b.c < b.o;
    if (!withDir) continue;
    let j = i - 1;
    if (j < 0 || !oppose(bars[j]!)) continue;
    let seriesOpen = bars[j]!.o;
    while (j >= 0 && oppose(bars[j]!)) {
      seriesOpen = bars[j]!.o;
      j--;
    }
    if (direction === "bull" ? b.c > seriesOpen : b.c < seriesOpen) return true;
  }
  return false;
}

/** Two hours of tape that has already run about two ATRs one way. */
export function strongExtension(bars: OhlcBar[]): "bull" | "bear" | null {
  if (bars.length < 16) return null;
  const slice = bars.slice(-8);
  const net = slice[slice.length - 1]!.c - slice[0]!.o;
  let atr = 0;
  const n = 14;
  for (let i = bars.length - n; i < bars.length; i++) {
    const prev = bars[i - 1]!.c;
    const b = bars[i]!;
    atr += Math.max(b.h - b.l, Math.abs(b.h - prev), Math.abs(b.l - prev));
  }
  atr /= n;
  if (!(atr > 0)) return null;
  const ratio = net / atr;
  if (ratio >= 2) return "bull";
  if (ratio <= -2) return "bear";
  return null;
}

function reversalInside(bars: OhlcBar[], direction: "bull" | "bear", minIndex: number): boolean {
  if (cisdThroughSeries(bars, direction, minIndex)) return true;
  const sweep = polaritySweep(bars, direction);
  if (!sweep || sweep.index < minIndex) return false;
  const disp = pairedDisplacement(bars, sweep, direction);
  return disp != null && disp.index >= minIndex;
}

/** False only when this side is fading a strong extension with no reversal signs. */
export function extensionAllows(bars: OhlcBar[], side: "long" | "short"): boolean {
  const ext = strongExtension(bars);
  if (!ext) return true;
  if (ext === "bull" && side === "long") return true;
  if (ext === "bear" && side === "short") return true;
  const dir = side === "short" ? "bear" : "bull";
  return reversalInside(bars, dir, bars.length - 8);
}


/**
 * PROVISIONAL RAID FROM THE 1-MINUTE TAPE (Keaton 2026-10-13).
 *
 * Before the 15m bar closes, a CLOSED 1m bar whose wick pierces this side's
 * pool (the latest confirmed 15m swing) followed by a CLOSED 1m close back
 * inside counts as the raid — marked `provisional: true`. The latest closed
 * 1m bar must still be inside; a 1m close back beyond the level drops it.
 * When the 15m bar closes, the normal 15m sweep takes over: a 15m close
 * beyond the level is not a sweep, so the provisional raid simply disappears.
 * Only closed 1m bars are evidence (nowMs >= t + span).
 */
export interface ProvisionalRaid extends SweepEvent {
  provisional: true;
}

export function provisionalRaid(
  bars: OhlcBar[],
  minute: OhlcBar[] | null | undefined,
  direction: "bull" | "bear",
  nowMs: number = Date.now(),
): ProvisionalRaid | null {
  if (!minute || minute.length < 2 || bars.length < 20) return null;
  const span = barSpanMs(bars);
  const fine = barSpanMs(minute);
  if (!Number.isFinite(span) || !Number.isFinite(fine) || fine <= 0 || fine >= span) return null;
  const closed = bars.filter((b) => b.t + span <= nowMs);
  if (closed.length < 20) return null;
  const formingStart = closed[closed.length - 1]!.t + span;
  if (nowMs >= formingStart + span) return null; // no forming bar in reach — stale tape
  const n = closed.length;
  const want = direction === "bull" ? "low" : "high";
  let pool: { price: number } | null = null;
  for (const sw of fractalSwings(closed, MM_SWING_WIDTH)) {
    if (sw.kind !== want || sw.index + MM_SWING_WIDTH >= n) continue;
    if (!pool || sw.index > (pool as { index?: number }).index!) pool = sw;
  }
  if (!pool) return null;
  const lvl = pool.price;
  const ones = minute.filter((b) => b.t >= formingStart && b.t + fine <= nowMs && b.t < formingStart + span);
  if (!ones.length) return null;
  const bull = direction === "bull";
  const wickAt = ones.findIndex((b) => (bull ? b.l < lvl : b.h > lvl));
  if (wickAt < 0) return null;
  const back = ones.slice(wickAt).some((b) => (bull ? b.c > lvl : b.c < lvl));
  const lastInside = bull ? ones[ones.length - 1]!.c > lvl : ones[ones.length - 1]!.c < lvl;
  if (!back || !lastInside) return null;
  const extreme = bull ? Math.min(...ones.slice(wickAt).map((b) => b.l)) : Math.max(...ones.slice(wickAt).map((b) => b.h));
  const lastC = ones[ones.length - 1]!.c;
  return {
    index: n,
    t: formingStart,
    side: bull ? "sellside" : "buyside",
    sweptLevel: lvl,
    wickExtreme: extreme,
    closeBackInside: +Math.abs(lastC - lvl).toFixed(2),
    provisional: true,
  };
}
