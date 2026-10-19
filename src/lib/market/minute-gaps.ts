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
  /** Set by classifyGap: true = materially affects LTF structure → gapped, fail closed. */
  blocking?: boolean;
  /** Why it blocks (or "minor-overnight"). */
  why?: string;
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
const openMemo = new Map<number, boolean>();
export function globexOpenAt(ms: number): boolean {
  const key = Math.floor(ms / MIN);
  const hit = openMemo.get(key);
  if (hit !== undefined) return hit;
  const v = globexOpenRaw(ms);
  if (openMemo.size > 50_000) openMemo.clear();
  openMemo.set(key, v);
  return v;
}
function globexOpenRaw(ms: number): boolean {
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

// ── Which residual holes block (preview-16, 2026-10-15) ──────────────────
// A 4-minute thin-overnight hole (01:14–01:19 CT, Yahoo lacks it too) blocked
// every card all day. Only holes that materially touch LTF structure block.

/**
 * Active LTF lookback (minutes): a hole ending inside it blocks. Kept at 240 (GATEWAY_BARS_LIMIT, the live
 * gateway read), NOT MINUTE_KEEP 480: at 480 every hole anywhere in the kept series blocks until it ages out,
 * so today's 4-min 01:14 CT thin-overnight hole (Yahoo lacks it too) would block every card 01:14–09:19 CT,
 * through the whole premarket — the preview-16 blocker again. The phantom-structure risk from an older hole is
 * handled at the source instead: detectFvgs / gapLeftBy skip 3-candle patterns across a hole, mtfArrays and
 * premarket-map drop resampled buckets missing a bar, and premarket-map flags/withholds windows a hole touches.
 */
export const ACTIVE_LOOKBACK_MIN = 240;
/** London 02:00–05:00 ET; a hole of LONDON_BLOCK_MIN+ open minutes in it blocks (London H/L feed the AMD/raid read). */
export const LONDON_ET = { from: 120, to: 300 };
export const LONDON_BLOCK_MIN = 6;
/** A hole this large blocks wherever it is. */
export const LARGE_GAP_MIN = 15;
/**
 * ET windows (minutes after midnight, [start, end)) where ANY hole blocks: NY premarket and RTH (the live
 * session the 1m–5m arrays and PMH/PML are built on). London 02:00–05:00 ET is deliberately NOT here:
 * preview-16's blocker hole (06:14–06:19Z = 02:14–02:19 ET, 4 min, Yahoo lacks it too) sits inside London,
 * and it must not block. A London hole blocks at LONDON_BLOCK_MIN (6) open minutes, via LARGE_GAP_MIN, or the
 * active lookback; smaller London holes only flag the London H/L incomplete (premarket-map).
 */
export const KEY_WINDOWS_ET: { name: string; from: number; to: number }[] = [
  { name: "NY premarket 07:00–09:30 ET", from: 420, to: 570 },
  { name: "RTH 09:30–16:00 ET", from: 570, to: 960 },
];

const hmFmt = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function etMinuteOfDay(ms: number): number {
  const p = hmFmt.formatToParts(new Date(ms));
  return Number(p.find((x) => x.type === "hour")?.value ?? 0) * 60 + Number(p.find((x) => x.type === "minute")?.value ?? 0);
}

/** Classify one hole at `nowMs`. Trailing (live end) always blocks. */
export function classifyGap(g: MinuteGap, nowMs: number): MinuteGap {
  if (g.trailing) return { ...g, blocking: true, why: "live-end stall" };
  if (g.missing >= LARGE_GAP_MIN) return { ...g, blocking: true, why: `large (${g.missing}m >= ${LARGE_GAP_MIN})` };
  const lon = openMinutesInEtWindow(g.fromMs + MIN, g.toMs, LONDON_ET.from, LONDON_ET.to);
  if (lon >= LONDON_BLOCK_MIN) return { ...g, blocking: true, why: `London hole ${lon}m (>= ${LONDON_BLOCK_MIN}) — London H/L incomplete` };
  if (g.toMs > nowMs - ACTIVE_LOOKBACK_MIN * MIN) return { ...g, blocking: true, why: `inside active ${ACTIVE_LOOKBACK_MIN}m lookback` };
  // Missing minutes are < LARGE_GAP_MIN here, so walking them is cheap.
  for (let t = floorMinute(g.fromMs) + MIN; t < g.toMs; t += MIN) {
    if (!globexOpenAt(t)) continue;
    const m = etMinuteOfDay(t);
    const w = KEY_WINDOWS_ET.find((k) => m >= k.from && m < k.to);
    if (w) return { ...g, blocking: true, why: `overlaps ${w.name}` };
  }
  return { ...g, blocking: false, why: "minor-overnight" };
}

export const classifyGaps = (gaps: MinuteGap[], nowMs: number): MinuteGap[] => gaps.map((g) => classifyGap(g, nowMs));
export const blockingGaps = (gaps: MinuteGap[], nowMs: number): MinuteGap[] => classifyGaps(gaps, nowMs).filter((g) => g.blocking);

// ── Gap-aware detectors (Accuracy Review on 4e112f2a) ────────────────────
// mtfArrays / detectFvgs read the full kept series (MINUTE_KEEP 480) with no
// check that bars are consecutive, so even a non-blocking hole could print a
// phantom 3-candle FVG or a partial resampled bucket. Detectors call these.

/** Intraday bar step of a series (smallest positive spacing), or null for a daily+ / too-short series. */
export function barStepMs(bars: { t: number }[]): number | null {
  let step = Infinity;
  for (let i = 1; i < Math.min(bars.length, 64); i++) {
    const d = bars[i]!.t - bars[i - 1]!.t;
    if (d > 0 && d < step) step = d;
  }
  return Number.isFinite(step) && step <= 15 * MIN ? step : null;
}

/**
 * True when consecutive bars a→b (step `stepMs`) skip a Globex-open minute:
 * the missing span [a + step, b) contains trading time. The daily halt and
 * the weekend are not gaps. stepMs null (daily+) → never a gap.
 */
export function spansGap(aT: number, bT: number, stepMs: number | null): boolean {
  if (stepMs == null || bT - aT <= stepMs) return false;
  for (let t = aT + stepMs; t < bT; t += MIN) if (globexOpenAt(t)) return true;
  return false;
}


const FOUR_H_MS = 14_400_000;
const ET_HM = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hour12: false });
const sinceGlobexOpen = (t: number): number => {
  const p = ET_HM.formatToParts(new Date(t));
  const h = Number(p.find((x) => x.type === "hour")!.value) % 24, m = Number(p.find((x) => x.type === "minute")!.value);
  return ((h * 60 + m - 18 * 60) % 1440 + 1440) % 1440;
};
/**
 * Bucket start for a resample of `ms`. 4h buckets are anchored to the 18:00 ET Globex open, DST-aware
 * (18:00, 22:00, 02:00, 06:00, 10:00, 14:00 ET), the same anchor as every-tf.ts sessionBucketStart.
 * Every other size keeps the epoch floor (15m/30m/1h epoch buckets already line up with ET wall time).
 * Fix 2026-10-19 (firing-audit-1019): epoch-floored 4h buckets were 20:00/00:00/04:00/08:00/12:00/16:00 ET in EDT
 * (19:00/23:00/... in EST), so the gating 4h rung (mtf-context bias4h, 4h arrays, tf-ladder 4h) read a different
 * candle than the chart, the every-TF facts and the morning-anatomy study.
 */
export function bucketStart(t: number, ms: number): number {
  if (ms !== FOUR_H_MS) return Math.floor(t / ms) * ms;
  return t - (t % 60_000) - (sinceGlobexOpen(t) % 240) * 60_000;
}
/** End of a bucket that starts at `start`: 4h buckets stop at the 17:00 ET halt (the 14:00 bucket is 3h). */
export function bucketEnd(start: number, ms: number): number {
  if (ms !== FOUR_H_MS) return start + ms;
  return start + Math.min(ms, (23 * 60 - sinceGlobexOpen(start)) * 60_000);
}

/**
 * Resample `src` into `ms` buckets and DROP any bucket missing a Globex-open
 * source bar (a bucket built across a hole is not that timeframe's candle).
 * The dropped bucket leaves a time hole, so the 3-candle detectors skip
 * patterns across it as well.
 */
export function completeBuckets<T extends { t: number; o: number; h: number; l: number; c: number; v?: number }>(src: T[], ms: number, srcMs = barStepMs(src)): T[] {
  const out: (T & { ts: number[] })[] = [];
  for (const b of src) {
    const k = bucketStart(b.t, ms);
    const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; L.v = (L.v ?? 0) + (b.v ?? 0); L.ts.push(b.t); }
    else out.push({ ...b, t: k, ts: [b.t] });
  }
  const strip = (b: T & { ts: number[] }) => { const { ts: _ts, ...r } = b; return r as unknown as T; };
  if (srcMs == null || srcMs >= ms) return out.map(strip);
  const limit = Math.max(GAP_MIN_MISSING, Math.round((ms / MIN) * 0.1));
  // A bucket "spans a gap" when it is missing a run of >= max(GAP_MIN_MISSING, 10% of the bucket) Globex-open
  // minutes: any 3-minute hole for 1m–30m buckets, 6m for 1h, 24m for 4h. 1–2 missing minutes are thin trading.
  // Yahoo 1m has a systematic ~10-minute hole at the 00:00 ET roll every night; dropping the whole 4h candle for
  // it erased real 4h EQ pools (desk-seq EQH/EQL test, 4h EQL 7834.5), while the LTF rungs still drop it.
  return out
    .filter((b) => {
      const have = new Set(b.ts);
      let run = 0;
      for (let t = b.t; t < bucketEnd(b.t, ms); t += srcMs) {
        if (have.has(t) || !globexOpenAt(t)) { run = 0; continue; }
        run += srcMs / MIN;
        if (run >= limit) return false;
      }
      return true;
    })
    .map(strip);
}

/** Globex-open minutes of [aT, bT) whose ET minute-of-day falls in [from, to) (wraps past midnight when from > to). */
export function openMinutesInEtWindow(aT: number, bT: number, from: number, to: number): number {
  let n = 0;
  for (let t = floorMinute(aT); t < bT; t += MIN) {
    if (!globexOpenAt(t)) continue;
    const m = etMinuteOfDay(t);
    if (from <= to ? m >= from && m < to : m >= from || m < to) n++;
  }
  return n;
}
