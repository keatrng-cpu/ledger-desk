/**
 * Teaching figures — deterministic price series with annotations.
 *
 * WHY THESE ARE SYNTHETIC, AND WHY THAT IS STATED EVERYWHERE
 * A lesson needs the SAME shape every time it is opened: the sweep has to be
 * the sweep, the gap has to be a gap. Live tape will not cooperate, and a
 * lesson that silently changes shape teaches nothing. So these are generated
 * from a fixed seed — reproducible to the tick.
 *
 * The cost of that is the one real risk in a teaching surface inside a trading
 * app: a diagram being mistaken for a signal. Every figure is therefore
 * labelled as an illustration at the render layer, uses its own bare axis
 * rather than the live chart's, and carries no symbol, no clock and no live
 * price. Nothing here is ever wired to the alarm, the scanner or the book.
 *
 * WHAT IS *NOT* SYNTHETIC
 * Every RULE and THRESHOLD in the curriculum is imported from the engine
 * (`aplus/config.ts`, `profit-rules.ts`, `sessions.ts`), never typed as a
 * literal. The picture is an illustration; the numbers are the real ones. If a
 * gate moves, the lesson moves with it — see curriculum.ts.
 */

export type FigureTone = "good" | "bad" | "warn" | "accent" | "neutral";

export interface FigureBar {
  o: number;
  h: number;
  l: number;
  c: number;
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

/** Equal highs, then a raid through them that closes back inside. */
function sweepReal(): Figure {
  const bars = series(100, [
    { n: 6, drift: 1.6 },
    { n: 5, drift: -1.4 },
    { n: 5, drift: 1.5, wickUp: 0 },
    { n: 4, drift: -1.2 },
    // The raid: pokes above, closes back under.
    { n: 1, drift: -2.5, wickUp: 7 },
    { n: 7, drift: -2.2 },
  ]);
  const raidIdx = 20;
  const pool = Math.max(hiOf(bars, 15), hiOf(bars, 5));
  return {
    id: "sweep-real",
    caption: "A raid: wick through the pool, body closes back inside.",
    verdict: "right",
    bars,
    marks: [
      { kind: "level", price: pool, label: "BSL — equal highs", tone: "warn", dash: true },
      { kind: "point", bar: raidIdx, price: bars[raidIdx]!.h, label: "swept, closed back under", tone: "good" },
      { kind: "split", bar: raidIdx, label: "sequence starts here", tone: "accent" },
    ],
  };
}

/** The same pool, but price closes and holds above it — that is a breakout. */
function sweepFake(): Figure {
  const bars = series(
    100,
    [
      { n: 6, drift: 1.6 },
      { n: 5, drift: -1.4 },
      { n: 5, drift: 1.5 },
      { n: 4, drift: -1.2 },
      // Closes ABOVE and keeps going — acceptance, not rejection.
      { n: 1, drift: 6, wickUp: 2 },
      { n: 7, drift: 2.4 },
    ],
    7,
  );
  const pool = Math.max(hiOf(bars, 15), hiOf(bars, 5));
  return {
    id: "sweep-fake",
    caption: "Not a raid: price closed above the pool and held. That is acceptance.",
    verdict: "wrong",
    bars,
    marks: [
      { kind: "level", price: pool, label: "BSL — equal highs", tone: "warn", dash: true },
      { kind: "point", bar: 20, price: bars[20]!.c, label: "closed ABOVE — no rejection", tone: "bad" },
    ],
  };
}

/** Premium / discount around equilibrium. */
function dealingRange(): Figure {
  const bars = series(100, [
    { n: 7, drift: 2.2 },
    { n: 6, drift: -2.0 },
    { n: 8, drift: 1.8 },
    { n: 7, drift: -1.6 },
  ]);
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars) {
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
  }
  const eq = (hi + lo) / 2;
  return {
    id: "dealing-range",
    caption: "Shorts belong in the upper half, longs in the lower half.",
    bars,
    marks: [
      { kind: "zone", top: hi, bottom: eq, label: "premium — sell here", tone: "bad" },
      { kind: "zone", top: eq, bottom: lo, label: "discount — buy here", tone: "good" },
      { kind: "level", price: eq, label: "EQ (50%)", tone: "neutral", dash: true },
    ],
  };
}

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

/** Displacement through structure = the shift. */
function mss(): Figure {
  const bars = series(100, [
    { n: 5, drift: 1.4 },
    { n: 4, drift: -1.6 },
    { n: 4, drift: 1.2, wickUp: 5 },
    { n: 3, drift: -1.0 },
    { n: 1, drift: -7, displace: true },
    { n: 7, drift: -1.8 },
  ]);
  const swingLow = Math.min(loOf(bars, 8), loOf(bars, 9));
  return {
    id: "mss",
    caption:
      "A wide body CLOSES through the last protected low. Structure has shifted; drifting through it has not.",
    bars,
    marks: [
      { kind: "level", price: swingLow, label: "protected low", tone: "warn", dash: true },
      { kind: "point", bar: 16, price: bars[16]!.c, label: "MSS — closed through", tone: "good" },
    ],
  };
}

/** Entering on the retrace vs chasing the impulse. */
function retraceBars(): FigureBar[] {
  return series(100, [
    { n: 4, drift: 1.4, noise: 3, wickUp: 6 }, // rally into the raid
    { n: 1, drift: -13, noise: 1 },            // displacement down
    { n: 2, drift: -1.2, noise: 3 },
    { n: 5, drift: 2.0, noise: 3 },            // retrace UP into the gap
    { n: 8, drift: -1.9, noise: 4 },
  ]);
}

/**
 * The gap, built the way a bearish FVG actually is: the low of the bar BEFORE
 * the displacement down to the high of the bar AFTER it. Taking it from the
 * displacement bar's own open instead produces a band the height of the whole
 * move — which is not what anyone trades, and swamps the drawing.
 */
function retraceGap(bars: FigureBar[]): { top: number; bottom: number } {
  return { top: bars[3]!.l, bottom: bars[5]!.h };
}

function retraceRight(): Figure {
  const bars = retraceBars();
  const gap = retraceGap(bars);
  // The retrace peak — the bar that trades back up into the gap.
  let peak = 7;
  for (let i = 7; i < 13; i++) if (bars[i]!.h > bars[peak]!.h) peak = i;
  return {
    id: "retrace-right",
    caption: "Wait for price to come back INTO the array, then take the rejection.",
    verdict: "right",
    bars,
    marks: [
      { kind: "zone", top: gap.top, bottom: gap.bottom, label: "FVG — the array", tone: "accent", from: 3 },
      { kind: "point", bar: peak, price: bars[peak]!.h, label: "entry on the retest", tone: "good" },
      { kind: "level", price: gap.top, label: "stop just above", tone: "bad", dash: true },
    ],
  };
}

function retraceChase(): Figure {
  const bars = retraceBars();
  const gap = retraceGap(bars);
  return {
    id: "retrace-chase",
    caption:
      "Selling the impulse instead. The stop has to sit above the array either way, so the same idea costs several times the risk — and the ordinary retrace takes you out before it works.",
    verdict: "wrong",
    bars,
    marks: [
      { kind: "zone", top: gap.top, bottom: gap.bottom, label: "FVG — still unfilled", tone: "accent", from: 3 },
      { kind: "point", bar: 6, price: bars[6]!.c, label: "chased here", tone: "bad" },
      { kind: "level", price: gap.top, label: "stop STILL goes here", tone: "bad", dash: true },
    ],
  };
}

/** IRL vs ERL — where the money sits. */
function liquidityMap(): Figure {
  const bars = series(100, [
    { n: 6, drift: 1.8 },
    { n: 5, drift: -1.6 },
    { n: 6, drift: 1.4 },
    { n: 8, drift: -1.2 },
  ]);
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars) {
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
  }
  const midHigh = hiOf(bars, 16);
  const midLow = loOf(bars, 10);
  return {
    id: "liquidity",
    caption: "External liquidity is the session's edges. Internal liquidity is everything between.",
    bars,
    marks: [
      { kind: "level", price: hi, label: "ERL — session high (BSL)", tone: "bad" },
      { kind: "level", price: lo, label: "ERL — session low (SSL)", tone: "good" },
      { kind: "level", price: midHigh, label: "IRL", tone: "neutral", dash: true },
      { kind: "level", price: midLow, label: "IRL", tone: "neutral", dash: true },
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
  "sweep-real": sweepReal(),
  "sweep-fake": sweepFake(),
  "dealing-range": dealingRange(),
  fvg: fvg(),
  mss: mss(),
  "retrace-right": retraceRight(),
  "retrace-chase": retraceChase(),
  liquidity: liquidityMap(),
  "smt-nq": smtLead(),
  "smt-es": smtLag(),
  risk: riskShape(),
};

export function getFigure(id: string): Figure | null {
  return FIGURES[id] ?? null;
}
