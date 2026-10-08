/**
 * Lower-timeframe reaction. A closed 1m, 2m, 3m, 4m, or 5m displacement
 * AFTER the raid is the confirmation the 15m book is waiting on. The raid
 * itself, and a displacement that the next bars close back through, is the
 * manipulation — it does not confirm.
 *
 * Closed bars only. The forming bucket is dropped. No raid, no confirmation:
 * an LTF push with nothing swept is the leg into liquidity, not the reaction.
 */

import { aggregateBars } from "../market/databento";
import type { OhlcBar } from "../market/types";
import type { MarketNarrative } from "./market-narrative";
import { detectDisplacements, type DisplacementEvent } from "./detectors";

export const LTF_REACTION_MINUTES = [1, 2, 3, 4, 5] as const;

export interface LtfReaction {
  confirmed: boolean;
  /** A displacement printed and then failed. Not a reason to enter. */
  manipulated: boolean;
  tf: string | null;
  reason: string;
}

function closedOnly(bars: OhlcBar[], minutes: number, nowMs: number): OhlcBar[] {
  const span = minutes * 60_000;
  return bars.filter((b) => nowMs >= b.t + span);
}

function failedAfter(bars: OhlcBar[], disp: DisplacementEvent, direction: "bull" | "bear"): boolean {
  return bars.some((b) => b.t > disp.t && (direction === "bull" ? b.c < disp.open : b.c > disp.open));
}

function onRung(
  minute: OhlcBar[],
  minutes: number,
  direction: "bull" | "bear",
  raidT: number,
  nowMs: number,
): { kind: "confirm" | "manip" | "none"; tf: string } {
  const tf = `${minutes}m`;
  const closed = closedOnly(minutes === 1 ? minute : aggregateBars(minute, minutes), minutes, nowMs);
  const after = detectDisplacements(closed).filter((d) => d.t > raidT);
  const latest = after[after.length - 1];
  if (!latest) return { kind: "none", tf };
  if (latest.direction !== direction || failedAfter(closed, latest, direction)) return { kind: "manip", tf };
  return { kind: "confirm", tf };
}

export function readLtfReaction(
  minute: OhlcBar[] | null | undefined,
  direction: "bull" | "bear",
  raidT: number | null,
  nowMs: number = Date.now(),
): LtfReaction {
  if (!minute || minute.length < 20) {
    return { confirmed: false, manipulated: false, tf: null, reason: "No 1m tape — LTF displacement cannot be read." };
  }
  if (raidT == null) {
    return {
      confirmed: false,
      manipulated: false,
      tf: null,
      reason: "No raid yet. An LTF push is the manipulation until a sweep is named.",
    };
  }
  let manipulated: string | null = null;
  for (const minutes of LTF_REACTION_MINUTES) {
    const rung = onRung(minute, minutes, direction, raidT, nowMs);
    if (rung.kind === "confirm") {
      return {
        confirmed: true,
        manipulated: false,
        tf: rung.tf,
        reason: `${rung.tf} displacement ${direction} closed after the raid and held. That is the reaction, not the sweep.`,
      };
    }
    if (rung.kind === "manip") manipulated = rung.tf;
  }
  if (manipulated) {
    return {
      confirmed: false,
      manipulated: true,
      tf: manipulated,
      reason: `${manipulated} displacement failed or ran the other way. That is the manipulation. Wait for a later bar that holds.`,
    };
  }
  return {
    confirmed: false,
    manipulated: false,
    tf: null,
    reason: "No 1m–5m displacement after the raid yet.",
  };
}

/** Upgrade a 15m narrative when a held 1m–5m displacement is the missing shift. */
export function applyLtfReaction(
  n: MarketNarrative,
  minute: OhlcBar[] | null | undefined,
  direction: "bull" | "bear",
  nowMs: number = Date.now(),
): MarketNarrative {
  const read = readLtfReaction(minute, direction, n.liquidity.lastSweepT, nowMs);
  const paint = (line: string) => n.sequence.map((s) => (s.startsWith("2.") ? line : s));
  if (!read.confirmed) {
    if (!read.manipulated) return n;
    return { ...n, sequence: paint(`2. Displacement: ${read.reason}`) };
  }
  const already =
    n.confirmation === "armed_entry" || n.confirmation === "confirmed" || n.confirmation === "sweep_displace";
  const confirmation = already || n.liquidity.lastSweep === "none" ? n.confirmation : "sweep_displace";
  const waitFor = n.waitFor.filter((w) => !/Displacement candle|Do NOT enter on sweep/.test(w));
  const sequence = paint(`2. Displacement ${direction} on the ${read.tf} — after the raid, and it held`).map((s) =>
    !already && s.startsWith("3.")
      ? "3. Confirmation: the lower timeframe displaced after the raid and the close held"
      : s,
  );
  return { ...n, confirmation, sequence, waitFor };
}
