/**
 * Lower-timeframe confirmation. The raid is not the entry. The confirm is a
 * later body close through the gap that the manipulation leg left, on the
 * highest 1m–5m rung that has that gap. A 1-minute flicker does not confirm
 * while a higher gap is still waiting on its close.
 *
 * 15s and 30s are read only when the tape is actually finer than one minute.
 * A one-minute feed cannot invent them.
 *
 * Closed bars only. The forming bucket is dropped.
 */

import { aggregateBars } from "../market/databento";
import type { OhlcBar } from "../market/types";
import type { MarketNarrative } from "./market-narrative";
import { detectFvgs, type FvgResult } from "./detectors";
import { cisdThroughSeries } from "./raid-pair";

export const LTF_REACTION_MINUTES = [1, 2, 3, 4, 5] as const;

export interface LtfReaction {
  confirmed: boolean;
  /** A close printed and then failed back through the gap. Not a reason to enter. */
  manipulated: boolean;
  tf: string | null;
  reason: string;
  /** The four fills, once a gap has been closed through. */
  fills?: { near: number; ce: number; far: number; bodyClose: number } | null;
}

function closedOnly(bars: OhlcBar[], minutes: number, nowMs: number): OhlcBar[] {
  const span = minutes * 60_000;
  return bars.filter((b) => nowMs >= b.t + span);
}

function bucket(minute: OhlcBar[], minutes: number, nowMs: number): OhlcBar[] {
  const bars = minutes >= 2 ? aggregateBars(minute, minutes) : minute;
  return closedOnly(bars, minutes, nowMs);
}

function throughGap(bar: OhlcBar, gap: FvgResult, direction: "bull" | "bear"): boolean {
  return direction === "bull" ? bar.c > gap.top : bar.c < gap.bottom;
}

function failedGap(bars: OhlcBar[], gap: FvgResult, after: number, direction: "bull" | "bear"): boolean {
  return bars.some(
    (b) => b.t > after && (direction === "bull" ? b.c < gap.bottom : b.c > gap.top),
  );
}

function rungRead(
  minute: OhlcBar[],
  minutes: number,
  direction: "bull" | "bear",
  raidT: number,
  nowMs: number,
): { kind: "confirm" | "wait" | "manip" | "none"; tf: string; fills?: LtfReaction["fills"] } {
  const tf = `${minutes}m`;
  const closed = bucket(minute, minutes, nowMs);
  const gaps = detectFvgs(closed).filter((g) => g.createdT > raidT && g.kind !== direction);
  if (!gaps.length) return { kind: "none", tf };
  const gap = gaps[gaps.length - 1]!;
  const closeBar = closed.find((b) => b.t > gap.createdT && throughGap(b, gap, direction));
  if (!closeBar) return { kind: "wait", tf };
  if (failedGap(closed, gap, closeBar.t, direction)) return { kind: "manip", tf };
  const raidIndex = closed.findIndex((b) => b.t >= raidT);
  const shifted = raidIndex >= 0 && cisdThroughSeries(closed, direction, raidIndex + 1);
  if (!shifted) return { kind: "wait", tf };
  const near = direction === "bull" ? gap.top : gap.bottom;
  const far = direction === "bull" ? gap.bottom : gap.top;
  return {
    kind: "confirm",
    tf,
    fills: { near, ce: (gap.top + gap.bottom) / 2, far, bodyClose: closeBar.c },
  };
}

export function readLtfReaction(
  minute: OhlcBar[] | null | undefined,
  direction: "bull" | "bear",
  raidT: number | null,
  nowMs: number = Date.now(),
): LtfReaction {
  if (!minute || minute.length < 20) {
    return { confirmed: false, manipulated: false, tf: null, reason: "No 1m tape — the close through the gap cannot be read." };
  }
  if (raidT == null) {
    return {
      confirmed: false,
      manipulated: false,
      tf: null,
      reason: "No raid yet. An LTF push is the manipulation until a sweep is named.",
    };
  }
  const span = minute.length > 1 ? minute[1]!.t - minute[0]!.t : 60_000;
  const rungs = span > 0 && span <= 30_000 ? [5, 4, 3, 2, 1, 0.5, 0.25] : [5, 4, 3, 2, 1];
  let waiting: string | null = null;
  let manipulated: string | null = null;
  for (const minutes of rungs) {
    const rung = rungRead(minute, minutes, direction, raidT, nowMs);
    if (rung.kind === "confirm") {
      return {
        confirmed: true,
        manipulated: false,
        tf: rung.tf,
        fills: rung.fills,
        reason: `${rung.tf} body close through the gap after the raid, and the delivery shifted. Highest rung that had the gap.`,
      };
    }
    if (rung.kind === "wait" && !waiting) waiting = rung.tf;
    if (rung.kind === "manip") manipulated = rung.tf;
    if (rung.kind === "wait") break;
  }
  if (waiting) {
    return {
      confirmed: false,
      manipulated: false,
      tf: waiting,
      reason: `Wait for the ${waiting} body close through the gap. A lower rung does not confirm while this one is open.`,
    };
  }
  if (manipulated) {
    return {
      confirmed: false,
      manipulated: true,
      tf: manipulated,
      reason: `${manipulated} close failed back through the gap. That is the manipulation. Wait for a later close.`,
    };
  }
  const fine = span <= 30_000 ? "" : " Finest tape is 1m, so 15s and 30s are not in the feed.";
  return {
    confirmed: false,
    manipulated: false,
    tf: null,
    reason: `No 1m–5m gap inside the leg after the raid yet.${fine}`,
  };
}

/** Upgrade a 15m narrative when the highest post-raid gap has been closed through. */
export function applyLtfReaction(
  n: MarketNarrative,
  minute: OhlcBar[] | null | undefined,
  direction: "bull" | "bear",
  nowMs: number = Date.now(),
): MarketNarrative {
  const read = readLtfReaction(minute, direction, n.liquidity.lastSweepT, nowMs);
  const paint = (line: string) => n.sequence.map((s) => (s.startsWith("2.") ? line : s));
  if (!read.confirmed) {
    if (!read.manipulated && !read.tf) return n;
    return { ...n, sequence: paint(`2. Displacement: ${read.reason}`) };
  }
  const already =
    n.confirmation === "armed_entry" || n.confirmation === "confirmed" || n.confirmation === "sweep_displace";
  const confirmation = already || n.liquidity.lastSweep === "none" ? n.confirmation : "sweep_displace";
  const waitFor = n.waitFor.filter((w) => !/Displacement candle|Do NOT enter on sweep/.test(w));
  const sequence = paint(`2. ${read.reason}`).map((s) =>
    !already && s.startsWith("3.")
      ? "3. Confirmation: a later body close through the gap the raid left"
      : s,
  );
  return { ...n, confirmation, sequence, waitFor };
}
