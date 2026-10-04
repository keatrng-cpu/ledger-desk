/**
 * WHEN a plan pays — the measured time profile of the live rule.
 *
 * `src/data/room-time-odds.json` is built by scripts/measure-option-time.mjs
 * from the four-year capture: for filled cards (stop inside 0.5–1.5 ATR), how
 * many 15-minute bars after the fill T1 printed, how many until a loss, and
 * how often a plan that has done nothing yet still reaches T1. The hit-odds
 * model says WHETHER T1 prints inside 8 hours; this says WHEN — which is the
 * whole question for an option that is flat at 11:00 ET.
 *
 * Pure lookups. If the file has not been measured yet (version 0), every
 * function says so through `measured: false` and the room prices with the
 * 8-hour probability and a caveat instead of inventing a curve.
 */

import raw from "@/data/room-time-odds.json";

export interface TimeHeadline {
  n: number;
  pT1: number | null;
  medianT1Bars: number | null;
  medianLossBars: number | null;
  t1Within4: number | null;
  lossWithin4: number | null;
}

export interface TimeCurve {
  label: string;
  n: number;
  t1: number;
  loss: number;
  open: number;
  pT1: number | null;
  lossR: number | null;
  medianT1Bars: number | null;
  medianLossBars: number | null;
  /** cdfT1[k] = share of T1 fills whose T1 printed within k bars of the fill bar. */
  cdfT1: (number | null)[];
  /** cdfLoss[k] = share of NON-T1 fills that exited on a loss within k bars. */
  cdfLoss: (number | null)[];
  /** P(T1 later | nothing has happened after k bars). */
  pT1Unresolved: (number | null)[];
  nUnresolved: number[];
  /** Mean close-of-bar R of the plans still open after k bars. */
  markR: (number | null)[];
  /** The same closes as a fraction of the way from entry to T1 — what prices one plan's flat. */
  markFrac?: (number | null)[];
  is: TimeHeadline;
  oos: TimeHeadline;
}

export interface TimeOddsFile {
  version: number;
  builtAt: string | null;
  barMinutes: number;
  holdBars: number;
  population?: { cards: number; eligible: number; unfilled: number; fills: number; nyAmFills: number };
  subsets: Record<string, TimeCurve>;
}

export const TIME_ODDS = raw as unknown as TimeOddsFile;
export const BAR_MINUTES = TIME_ODDS.barMinutes || 15;
export const BAR_MS = BAR_MINUTES * 60_000;
/** Below this many fills a subset is too thin to price from; the room falls back to its parent. */
export const MIN_CURVE_N = 60;

export function timeOddsMeasured(f: TimeOddsFile = TIME_ODDS): boolean {
  return f.version >= 1 && Object.keys(f.subsets ?? {}).length > 0;
}

export type DistBucket = "lt1" | "1to2" | "ge2";

export function distBucket(t1Atr: number | null): DistBucket | null {
  if (t1Atr == null || !Number.isFinite(t1Atr) || t1Atr <= 0) return null;
  return t1Atr < 1 ? "lt1" : t1Atr < 2 ? "1to2" : "ge2";
}

/**
 * The curve for a plan: NY AM (the room's window) split by T1 distance, else
 * NY AM pooled, else every session at that distance, else every session —
 * the first one with at least MIN_CURVE_N fills.
 */
export function curveFor(t1Atr: number | null, f: TimeOddsFile = TIME_ODDS): { key: string; curve: TimeCurve } | null {
  if (!timeOddsMeasured(f)) return null;
  const d = distBucket(t1Atr);
  const order = [d ? `nyam_${d}` : null, "nyam_all", d ? `all_${d}` : null, "all_all"].filter((k): k is string => k != null);
  for (const key of order) {
    const c = f.subsets[key];
    if (c && c.n >= MIN_CURVE_N && c.cdfT1.length && c.cdfLoss.length) return { key, curve: c };
  }
  return null;
}

const at = (xs: (number | null)[], k: number): number => {
  if (!xs.length) return 0;
  const i = Math.max(0, Math.min(xs.length - 1, Math.floor(k)));
  return xs[i] ?? 0;
};

/** Share of events at an offset BEFORE bar k (none before the fill bar). */
const before = (xs: (number | null)[], k: number): number => (k <= 0 ? 0 : at(xs, k - 1));

/** The first bar in [from, limit] by which the events still ahead reach `q` of their total — a conditional median at q = 0.5. */
function quantileBar(cdf: (number | null)[], from: number, limit: number, q: number): number {
  const lo = before(cdf, from);
  const hi = at(cdf, limit);
  if (!(hi > lo)) return limit;
  const want = lo + (hi - lo) * q;
  for (let k = from; k <= limit; k++) if (at(cdf, k) >= want - 1e-9) return k;
  return limit;
}

export interface WindowOdds {
  measured: boolean;
  curveKey: string | null;
  /**
   * The bar now in progress, counted from the fill bar (0 at entry). Events on
   * bars BEFORE it are known not to have happened; this bar's are still ahead —
   * at entry that includes the fill bar itself, where the measured stops and
   * failed holds cluster.
   */
  fromBar: number;
  /** Bars from `fromBar` through the last bar that opens before the flat, inclusive. */
  windowBars: number;
  /** T1 prints inside the window. */
  pT1: number;
  /** A loss exit (stop / failed hold) inside the window. */
  pLoss: number;
  /** Neither — the flat closes it. */
  pNone: number;
  /** Bar (after the fill) a T1 inside the window most likely lands on. */
  t1Bar: number;
  lossBar: number;
  /** Mean R of a losing exit, measured. */
  lossR: number;
  /** Mean R mark of a plan still unresolved at the flat, measured (pooled across targets). */
  noneR: number;
  /** The same mark as a fraction of the way to T1, when measured — how quant.ts prices the flat. */
  noneFrac: number | null;
  /** Share of all eventual T1s that land inside this window. */
  shareOfHitsInWindow: number;
}

/**
 * Split an 8-hour P(T1 | filled) into what happens before the room's flat.
 * At entry `fromBar` is 0 and nothing is conditioned away — the fill bar's own
 * events are still ahead. For a held position `fromBar` is the bar in
 * progress and the odds are conditional on nothing having happened before it.
 * `windowBars` 0 means the flat is now: everything is the flat path.
 */
export function windowOdds(pT1At8h: number, t1Atr: number | null, fromBar: number, windowBars: number, f: TimeOddsFile = TIME_ODDS): WindowOdds {
  const p = Math.min(0.99, Math.max(0.01, pT1At8h));
  const found = curveFor(t1Atr, f);
  const w = Math.max(0, Math.floor(windowBars));
  const k0 = Math.max(0, Math.floor(fromBar));
  if (!found) {
    // Unmeasured: the 8-hour odds stand in for the window, and say so.
    return {
      measured: false,
      curveKey: null,
      fromBar: k0,
      windowBars: w,
      pT1: p,
      pLoss: 1 - p,
      pNone: 0,
      t1Bar: k0 + Math.max(0, Math.ceil(w / 2) - 1),
      lossBar: k0 + Math.max(0, Math.ceil(w / 2) - 1),
      lossR: -0.89,
      noneR: 0,
      noneFrac: null,
      shareOfHitsInWindow: 1,
    };
  }
  const c = found.curve;
  // Past the measured hold the CDFs are flat at their last value (at() clamps).
  const end = k0 + w - 1;
  const aliveNow = Math.max(1e-6, 1 - p * before(c.cdfT1, k0) - (1 - p) * before(c.cdfLoss, k0));
  const pT1 = w > 0 ? Math.min(1, Math.max(0, (p * (at(c.cdfT1, end) - before(c.cdfT1, k0))) / aliveNow)) : 0;
  const pLoss = w > 0 ? Math.min(1 - pT1, Math.max(0, ((1 - p) * (at(c.cdfLoss, end) - before(c.cdfLoss, k0))) / aliveNow)) : 0;
  // The mark of plans still open at the flat: open after bar `end` (the last bar before it).
  const markIdx = Math.max(0, Math.min(end, c.markR.length - 1));
  const frac = c.markFrac?.length ? (c.markFrac[Math.max(0, Math.min(end, c.markFrac.length - 1))] ?? null) : null;
  return {
    measured: true,
    curveKey: found.key,
    fromBar: k0,
    windowBars: w,
    pT1,
    pLoss,
    pNone: Math.max(0, 1 - pT1 - pLoss),
    t1Bar: w > 0 ? quantileBar(c.cdfT1, k0, end, 0.5) : k0,
    lossBar: w > 0 ? quantileBar(c.cdfLoss, k0, end, 0.5) : k0,
    lossR: c.lossR ?? -0.89,
    noneR: c.markR[markIdx] ?? 0,
    noneFrac: frac,
    shareOfHitsInWindow: w > 0 ? at(c.cdfT1, end) : before(c.cdfT1, k0),
  };
}

/**
 * The measured bar grid for a fill: the fill bar is the 15-minute bar the
 * fill printed in (the capture's clock), so a 09:56 fill has bars 0–4 before an
 * 11:00 flat and a 10:00 fill has bars 0–3. Returns the bar in progress at
 * `nowMs`, how many bars run to the flat, and where a bar's midpoint falls.
 */
export function barGrid(fillMs: number, nowMs: number, flatMs: number): { barStart: number; fromBar: number; windowBars: number; midOf: (bar: number) => number } {
  const barStart = Math.floor(fillMs / BAR_MS) * BAR_MS;
  const fromBar = Math.max(0, Math.floor((nowMs - barStart) / BAR_MS));
  const lastBar = Math.ceil((flatMs - barStart) / BAR_MS) - 1;
  const windowBars = nowMs >= flatMs ? 0 : Math.max(0, lastBar - fromBar + 1);
  return { barStart, fromBar, windowBars, midOf: (bar: number) => barStart + (bar + 0.5) * BAR_MS };
}

/** Bars from `fromMs` until `untilMs`, whole bars only. */
export function barsBetween(fromMs: number, untilMs: number): number {
  return Math.max(0, Math.floor((untilMs - fromMs) / BAR_MS));
}
