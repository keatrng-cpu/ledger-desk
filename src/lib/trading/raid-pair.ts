/**
 * A raid and the displacement that answers it are one pair.
 *
 * The newest sweep does not erase the older one. Sellside taken still arms
 * a long after a later buyside tag, and that later tag only becomes the
 * trade if a bearish displacement actually answers it. The raid candle is
 * not the shift. The gap that counts is the one that displacement left.
 */

import type { OhlcBar } from "../market/types";
import {
  detectDisplacements,
  detectFvgs,
  detectOrderBlocks,
  detectSweeps,
  MM_DISPLACE_WITHIN,
  type DisplacementEvent,
  type SweepEvent,
} from "./detectors";
import { GATE } from "./gate-tuning";

export function recentRealSweeps(bars: OhlcBar[]): SweepEvent[] {
  if (bars.length < 20) return [];
  const last = bars.length - 1;
  return detectSweeps(bars).filter(
    (s) => s.closeBackInside > 0 && last - s.index <= GATE.recentSweepBars,
  );
}

/** The sweep that arms this side. A later sweep of the other pool does not replace it. */
export function polaritySweep(bars: OhlcBar[], direction: "bull" | "bear"): SweepEvent | null {
  const side = direction === "bull" ? "sellside" : "buyside";
  const hits = recentRealSweeps(bars).filter((s) => s.side === side);
  return hits.length ? hits[hits.length - 1]! : null;
}

/** A later bar, inside the mechanical window. The sweep candle itself is not the shift. */
export function pairedDisplacement(
  bars: OhlcBar[],
  sweep: SweepEvent,
  direction: "bull" | "bear",
): DisplacementEvent | null {
  const hits = detectDisplacements(bars).filter(
    (d) =>
      d.direction === direction &&
      d.index > sweep.index &&
      d.index <= sweep.index + MM_DISPLACE_WITHIN,
  );
  return hits.length ? hits[hits.length - 1]! : null;
}

/** The gap or order block the displacement just left. An older gap does not qualify. */
export function displacementLeftArray(
  bars: OhlcBar[],
  disp: DisplacementEvent,
  direction: "bull" | "bear",
): boolean {
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
export function cisdThroughSeries(bars: OhlcBar[], direction: "bull" | "bear"): boolean {
  const start = Math.max(1, bars.length - 20);
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
