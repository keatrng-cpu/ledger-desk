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
  /** Hole at the live end: last bar → now (gateway stalled). toMs is the current minute, not a bar. */
  trailing?: boolean;
}

/** CME equity index futures tick. */
export const TICK = 0.25;
export const snapTick = (p: number, tick = TICK): number => Math.round(p / tick) * tick;
export const floorMinute = (t: number): number => Math.floor(t / MIN) * MIN;

/**
 * Normalise fill (Yahoo) bars before they sit next to gateway bars: stamps
 * floored to the minute (a 09:15:30 stamp would otherwise survive beside the
 * gateway's 09:15:00 and double-count) and prices snapped to the 0.25 tick.
 * Two fill bars landing on one minute are combined (first o, last c, max h, min l, Σv).
 */
export function normalizeFillBars(fill: OhlcBar[], tick = TICK): OhlcBar[] {
  const map = new Map<number, OhlcBar>();
  for (const b of [...fill].sort((a, b) => a.t - b.t)) {
    const t = floorMinute(b.t);
    const n = { t, o: snapTick(b.o, tick), h: snapTick(b.h, tick), l: snapTick(b.l, tick), c: snapTick(b.c, tick), v: b.v };
    const prev = map.get(t);
    map.set(t, prev ? { t, o: prev.o, c: n.c, h: Math.max(prev.h, n.h), l: Math.min(prev.l, n.l), v: (prev.v ?? 0) + (n.v ?? 0) } : n);
  }
  return [...map.values()];
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

/**
 * Holes in a sorted 1m series. Between bars always; with `nowMs`, also the
 * live end (last bar → current minute), for a gateway that stalled. Pass
 * nowMs only for a live source — a delayed source (Yahoo ~10 min) would
 * always read as stalled.
 */
export function findMinuteGaps(bars: OhlcBar[], minMissing = GAP_MIN_MISSING, nowMs?: number): MinuteGap[] {
  const out: MinuteGap[] = [];
  for (let i = 1; i < bars.length; i++) {
    const a = bars[i - 1]!.t;
    const b = bars[i]!.t;
    if (b - a <= MIN) continue;
    const missing = expectedMinutesBetween(a, b);
    if (missing >= minMissing) out.push({ fromMs: a, toMs: b, missing });
  }
  if (nowMs != null && bars.length) {
    const last = bars[bars.length - 1]!.t;
    const nowMin = floorMinute(nowMs);
    if (nowMin > last) {
      const missing = expectedMinutesBetween(last, nowMin);
      if (missing >= minMissing) out.push({ fromMs: last, toMs: nowMin, missing, trailing: true });
    }
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
export function fillMinuteSeries(primary: OhlcBar[], fill: OhlcBar[], keep: number, nowMs?: number): FilledMinute {
  const gatewayGaps = findMinuteGaps(primary, GAP_MIN_MISSING, nowMs);
  const lastPrimary = primary.length ? primary[primary.length - 1]!.t : Infinity;
  const norm = normalizeFillBars(fill);
  const usable = primary.length ? norm.filter((b) => b.t <= lastPrimary) : norm;
  const merged = (usable.length ? mergePriority(primary, usable) : primary.slice()).slice(-keep);
  // Trailing hole stays: Yahoo past the gateway end is not used (delayed, and no lookahead past the live tape).
  const gaps = findMinuteGaps(merged, GAP_MIN_MISSING, nowMs);
  return { bars: merged, gaps, gatewayGaps, filled: usable.length > 0 && gatewayGaps.length > gaps.length };
}
