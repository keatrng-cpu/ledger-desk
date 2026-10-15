import type { OhlcBar } from "./types";

/**
 * 1m series hole detection + fill (Accuracy Review 2026-10-15 run 4, nit #19).
 *
 * The gateway reconnected at 09:12 ET with no replay, so its 1m rows jumped
 * 00:10 → 09:12. `loadMinute` trusted any ≥30 gateway rows, skipped the Yahoo
 * fill, and the arrays/levels built on the hole (phantom FVGs, wrong PMH/low,
 * no London) were published as live. Now every series is checked for missing
 * Globex minutes; holes are filled from Yahoo (gateway rows win), and a hole
 * that is still open marks the series gapped so the desk fails closed.
 */

const MIN = 60_000;
/** A run of this many (or more) missing Globex minutes is a hole. Thin minutes (1–2 missing) are normal. */
export const GAP_MIN_MISSING = 3;

export interface MinuteGap {
  /** Last bar before the hole (ms). */
  fromMs: number;
  /** First bar after the hole (ms). */
  toMs: number;
  /** Globex minutes expected but missing between them. */
  missing: number;
}

const etFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** CME Globex equity index hours, ET: Sun 18:00 → Fri 17:00, daily halt 17:00–18:00. */
export function globexOpenAt(ms: number): boolean {
  const parts = etFmt.formatToParts(new Date(ms));
  const wd = parts.find((p) => p.type === "weekday")?.value ?? "";
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? 0);
  if (wd === "Sat") return false;
  if (wd === "Sun") return h >= 18;
  if (h === 17) return false; // daily halt (and Fri close onward)
  if (wd === "Fri" && h >= 17) return false;
  return true;
}

/** Count Globex-open minute stamps strictly between a and b (minute-aligned). */
export function expectedMinutesBetween(aMs: number, bMs: number): number {
  let n = 0;
  const start = Math.floor(aMs / MIN) * MIN + MIN;
  for (let t = start; t < bMs; t += MIN) if (globexOpenAt(t)) n++;
  return n;
}

/** Holes in a sorted 1m series (only between its first and last bar). */
export function findMinuteGaps(bars: OhlcBar[], minMissing = GAP_MIN_MISSING): MinuteGap[] {
  const out: MinuteGap[] = [];
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1]!.t;
    const b = bars[i]!.t;
    if (b - a <= MIN) continue;
    const missing = expectedMinutesBetween(a, b);
    if (missing >= minMissing) out.push({ fromMs: a, toMs: b, missing });
  }
  return out;
}

/** Merge two 1m series by bar time; `primary` (gateway) wins on the same minute. */
export function mergePriority(primary: OhlcBar[], fill: OhlcBar[]): OhlcBar[] {
  const map = new Map<number, OhlcBar>();
  for (const b of fill) map.set(b.t, b);
  for (const b of primary) map.set(b.t, b);
  return [...map.values()].sort((a, b) => a.t - b.t);
}

export interface FilledMinute {
  bars: OhlcBar[];
  /** Holes left after the fill (empty = contiguous). */
  gaps: MinuteGap[];
  /** Holes the gateway series had before the fill. */
  gatewayGaps: MinuteGap[];
  filled: boolean;
}

/**
 * Gateway first; fill its holes (and any short history) from `fill`. Only
 * fill bars inside the window [first fill bar, last primary bar] are used, so
 * a delayed Yahoo print never sits on top of the live end.
 */
export function fillMinuteSeries(primary: OhlcBar[], fill: OhlcBar[], keep: number): FilledMinute {
  const gatewayGaps = findMinuteGaps(primary);
  const lastPrimary = primary.length ? primary[primary.length - 1]!.t : Infinity;
  const usable = primary.length ? fill.filter((b) => b.t <= lastPrimary) : fill;
  const merged = (fill.length ? mergePriority(primary, usable) : primary.slice()).slice(-keep);
  const gaps = findMinuteGaps(merged);
  return { bars: merged, gaps, gatewayGaps, filled: usable.length > 0 && gatewayGaps.length > gaps.length };
}
