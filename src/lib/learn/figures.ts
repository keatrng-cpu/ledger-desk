/**
 * Teaching figures — deterministic price series with annotations.
 *
 * WHY THESE ARE SYNTHETIC UNTIL A HISTORIC SLICE EXISTS
 * A lesson needs the SAME shape every time it is opened. Live tape will not
 * cooperate. August 2026 Databento 15m slices (`learn-figures.json`) replace
 * the seed when present; the generators below remain the fallback.
 *
 * The one real risk in a teaching surface inside a trading app: a diagram
 * being mistaken for a signal. Every figure is labelled as an illustration,
 * uses its own axis, and is never wired to the alarm, the scanner or the book.
 *
 * WHAT IS NEVER SYNTHETIC
 * Every RULE and THRESHOLD in the curriculum is imported from the engine.
 */

import historic from "@/data/learn-figures.json";
import { CONTRAST_VERDICT } from "./drill";

export type FigureTone = "good" | "bad" | "warn" | "accent" | "neutral";

export interface FigureBar {
  o: number;
  h: number;
  l: number;
  c: number;
  /** Present on historic slices; ignored by the renderer. */
  t?: number;
}

export type FigureMark =
  /** A horizontal price band — an array, a range half, a risk leg. */
  | {
      kind: "zone";
      top: number;
      bottom: number;
      label?: string;
      tone: FigureTone;
      /** Bar index the band starts at. Omitted = full width. */
      from?: number;
    }
  /** A horizontal line — a pool, a level, a stop. */
  | { kind: "level"; price: number; label: string; tone: FigureTone; dash?: boolean }
  /** A ring on one bar — the raid, the shift, the entry bar. */
  | { kind: "point"; bar: number; price: number; label: string; tone: FigureTone }
  /** A vertical divider — "everything right of here is after the raid". */
  | { kind: "split"; bar: number; label: string; tone: FigureTone };

export interface Figure {
  id: string;
  /** Shown above the drawing. */
  caption: string;
  bars: FigureBar[];
  marks: FigureMark[];
  /** Renders a green or red border — for right/wrong comparison pairs. */
  verdict?: "right" | "wrong";
  /** Historic stamp, e.g. "ESU6 15m · Tue Aug 4 09:30–16:00 ET". */
  stamp?: string;
  symbol?: string;
}

/* ── Deterministic generation ─────────────────────────────────────────────── */

function prng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Leg {
  /** Bars in this leg. */
  n: number;
  /** Points of drift per bar. */
  drift: number;
  /** Body noise amplitude. */
  noise?: number;
  /** Extra upper wick on the LAST bar of the leg. */
  wickUp?: number;
  /** Extra lower wick on the last bar of the leg. */
  wickDown?: number;
  /** Force the last bar of the leg to be one large body (displacement). */
  displace?: boolean;
}

/** Build a series from legs. Same seed, same bars, forever. */
function series(start: number, legs: Leg[], seed = 7): FigureBar[] {
  const rnd = prng(seed);
  const bars: FigureBar[] = [];
  let px = start;
  for (const leg of legs) {
    for (let i = 0; i < leg.n; i++) {
      const last = i === leg.n - 1;
      const amp = leg.noise ?? 5;
      const o = px;
      const body = leg.displace && last ? leg.drift * 4 : leg.drift + (rnd() - 0.5) * amp;
      const c = o + body;
      const hi = Math.max(o, c);
      const lo = Math.min(o, c);
      bars.push({
        o: +o.toFixed(2),
        h: +(hi + (last && leg.wickUp ? leg.wickUp : rnd() * amp * 0.5 + 0.6)).toFixed(2),
        l: +(lo - (last && leg.wickDown ? leg.wickDown : rnd() * amp * 0.5 + 0.6)).toFixed(2),
        c: +c.toFixed(2),
      });
      px = c;
    }
  }
  return bars;
}

const hiOf = (b: FigureBar[], i: number) => b[i]!.h;
const loOf = (b: FigureBar[], i: number) => b[i]!.l;

/* ── The figures ──────────────────────────────────────────────────────────── */

/** A gap left by a fast three-bar move. */
function fvg(): Figure {
  const bars = series(100, [
    { n: 5, drift: -0.8 },
    { n: 1, drift: 2.0 },
    { n: 1, drift: 9, displace: false, wickDown: 0.2 },
    { n: 1, drift: 2.0, wickDown: 0.2 },
    { n: 8, drift: 0.4 },
  ]);
  // The gap: bar 5's high to bar 7's low, with bar 6 spanning it untouched.
  const gapBottom = bars[5]!.h;
  const gapTop = bars[7]!.l;
  return {
    id: "fvg",
    caption:
      "Three bars. The middle one runs so fast that bar 1's high never meets bar 3's low — that untouched band is the gap.",
    bars,
    marks: [
      {
        kind: "zone",
        top: Math.max(gapTop, gapBottom),
        bottom: Math.min(gapTop, gapBottom),
        label: "FVG — inefficiency",
        tone: "accent",
        from: 5,
      },
      { kind: "point", bar: 6, price: bars[6]!.c, label: "displacement bar", tone: "accent" },
    ],
  };
}

/** IRL vs ERL — where the money sits. */
function liquidityMap(): Figure {
  const bars = series(100, [
    { n: 6, drift: 1.8 }, // first rally — its peak is an INTERNAL high
    { n: 5, drift: -1.6 }, // pullback — its trough is an INTERNAL low
    { n: 6, drift: 2.2 }, // second rally makes the SESSION high
    { n: 8, drift: -1.2 },
  ]);
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars) {
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
  }
  // Internal levels are the swings INSIDE the range: the first rally's peak
  // (bars 0-5) and the pullback's trough (bars 6-10). An earlier version took
  // bar 16's high, which was the session high itself, so "IRL" rendered on
  // top of "ERL — session high" and its dashed line vanished under the red
  // one. The suite now asserts every internal level sits strictly inside.
  const firstPeak = bars.slice(0, 6).reduce((m, b) => Math.max(m, b.h), -Infinity);
  const pullbackLow = bars.slice(6, 11).reduce((m, b) => Math.min(m, b.l), Infinity);
  return {
    id: "liquidity",
    caption: "External liquidity is the session's edges. Internal liquidity is everything between.",
    bars,
    marks: [
      { kind: "level", price: hi, label: "ERL — session high (BSL)", tone: "bad" },
      { kind: "level", price: lo, label: "ERL — session low (SSL)", tone: "good" },
      { kind: "level", price: firstPeak, label: "IRL — first swing high", tone: "neutral", dash: true },
      { kind: "level", price: pullbackLow, label: "IRL — pullback low", tone: "neutral", dash: true },
    ],
  };
}

/** SMT: one index makes the high, the other fails to. */
function smtLead(): Figure {
  const bars = series(100, [
    { n: 5, drift: 1.6 },
    { n: 4, drift: -1.4 },
    { n: 5, drift: 1.9, wickUp: 4 },
    { n: 8, drift: -1.5 },
  ]);
  return {
    id: "smt-nq",
    caption: "NQ — takes out the prior high.",
    bars,
    marks: [
      { kind: "level", price: hiOf(bars, 4), label: "prior high", tone: "neutral", dash: true },
      { kind: "point", bar: 13, price: bars[13]!.h, label: "higher high", tone: "bad" },
    ],
  };
}

function smtLag(): Figure {
  const bars = series(
    100,
    [
      { n: 5, drift: 1.6 },
      { n: 4, drift: -1.4 },
      { n: 5, drift: 1.1 }, // fails to reach
      { n: 8, drift: -1.5 },
    ],
    11,
  );
  return {
    id: "smt-es",
    caption: "ES — same window, cannot reach its own prior high. That disagreement is the crack.",
    bars,
    marks: [
      { kind: "level", price: hiOf(bars, 4), label: "prior high", tone: "neutral", dash: true },
      { kind: "point", bar: 13, price: bars[13]!.h, label: "LOWER high — divergence", tone: "good" },
    ],
  };
}

/** Risk, reward and where the stop belongs relative to the raid. */
function riskShape(): Figure {
  const bars = series(100, [
    { n: 5, drift: 1.5 },
    { n: 1, drift: -1.5, wickUp: 6 },
    { n: 4, drift: -1.8 },
    { n: 4, drift: 1.2 },
    { n: 10, drift: -2.4 },
  ]);
  const raidHigh = bars[5]!.h;
  const entry = bars[13]!.c;
  const stop = raidHigh + 1.5;
  const risk = stop - entry;
  return {
    id: "risk",
    caption: "Stop beyond the raid wick. Target at least the same distance away, or there is no trade.",
    bars,
    marks: [
      { kind: "zone", top: stop, bottom: entry, label: "1R risk", tone: "bad" },
      { kind: "zone", top: entry, bottom: entry - risk, label: "1R", tone: "good" },
      { kind: "zone", top: entry - risk, bottom: entry - risk * 2, label: "2R", tone: "good" },
      { kind: "level", price: stop, label: "stop — beyond the wick", tone: "bad" },
      { kind: "level", price: entry, label: "entry", tone: "accent", dash: true },
      { kind: "point", bar: 5, price: raidHigh, label: "raid", tone: "warn" },
    ],
  };
}

export const FIGURES: Record<string, Figure> = {
  fvg: fvg(),
  liquidity: liquidityMap(),
  "smt-nq": smtLead(),
  "smt-es": smtLag(),
  risk: riskShape(),
};

const HISTORIC = (historic as { figures?: Record<string, Figure> }).figures ?? {};

/** Prefer the August 2026 Databento slice. Synthetic seed is the fallback. */
export function getFigure(id: string): Figure | null {
  const real = HISTORIC[id];
  const base = real?.bars?.length ? real : (FIGURES[id] ?? null);
  if (!base) return null;
  const verdict = CONTRAST_VERDICT[id];
  if (verdict && base.verdict !== verdict) return { ...base, verdict };
  return base;
}
