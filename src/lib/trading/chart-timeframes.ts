/**
 * The five timeframes a card's chart can show, and what each one honestly
 * covers.
 *
 * WHY THIS IS NOT JUST resampleMs
 * Every timeframe on the desk is derived from two real series — the 15m bars
 * the engine grades on, and the ~8h of 1m bars fetched for the ladder's lower
 * rungs. Nothing new is fetched to switch timeframe. But the two series cover
 * very different spans, and resampling hides that: sixty 1m bars is one hour,
 * sixty 4h bars is ten days. A chart that silently shows an hour when the
 * trader believes they are looking at a week is worse than one that refuses.
 *
 * So every timeframe carries its own `coverage` sentence and its `source`, and
 * a timeframe whose series is absent returns `bars: []` with a reason rather
 * than an empty picture.
 *
 * THE 1m WINDOW IS THE ONE THAT SURPRISES PEOPLE
 * `mtf[side].minute` is roughly the last eight hours. That is plenty to see
 * the entry turn inside a 15m array, which is what it is for, and far too
 * little to read structure. The 1m rung exists for timing, never for bias —
 * the same split the timeframe ladder already enforces by reading direction
 * from the top rung down.
 *
 * WHAT DOWNSAMPLING CANNOT DO
 * 5m is resampled from 1m, so it inherits the 1m window — about eight hours,
 * not eight days. 1h and 4h are resampled from 15m, which is honest because
 * 15m divides both exactly. Nothing here upsamples: you cannot make a 1m bar
 * out of a 15m bar, and a caller asking for one gets an empty series and a
 * sentence saying why.
 */

import type { OhlcBar } from "../market/types";
import type { MarkKind } from "./setup-anticipation";
import { resampleMs } from "./tf-ladder";

export type ChartTf = "1m" | "2m" | "3m" | "5m" | "15m" | "1h" | "4h";

/**
 * The rungs that can ONLY come from the real 1m series.
 *
 * 2m and 3m are here for the same reason 1m and 5m are: 15m does not divide
 * into them, so building them from 15m would invent bars that never printed.
 * They exist at all because the Judas window (09:30-09:45 ET) is ONE 15m
 * candle — a raid and its failure cannot both be seen on a series whose bar
 * is the whole window — and 2m/3m are the coarsest honest views that still
 * resolve a manipulation leg from the reaction to it.
 */
export const MINUTE_ONLY_TFS: ChartTf[] = ["1m", "2m", "3m", "5m"];

/** In the order a trader steps through them: context down to timing. */
export const CHART_TFS: ChartTf[] = ["4h", "1h", "15m", "5m", "3m", "2m", "1m"];

const MS: Record<ChartTf, number> = {
  "1m": 60_000,
  "2m": 2 * 60_000,
  "3m": 3 * 60_000,
  "5m": 5 * 60_000,
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "4h": 4 * 60 * 60_000,
};

/** What each rung is FOR. Printed on the switch so it is never ambiguous. */
export const TF_ROLE: Record<ChartTf, string> = {
  "4h": "bias — where the week is going",
  "1h": "structure — the dealing range and the draw",
  "15m": "the setup — what the engine grades",
  "5m": "confirmation — the shift after the raid",
  "3m": "the open's manipulation leg, resolved",
  "2m": "the open's manipulation leg, resolved",
  "1m": "timing — the turn inside the array",
};

export interface TfSeries {
  tf: ChartTf;
  bars: OhlcBar[];
  /** "15m" or "1m" — which real series this was built from. */
  source: "15m" | "1m" | null;
  /** Hours of tape actually represented. Null when empty. */
  coverageHours: number | null;
  /** One sentence a trader can trust about what they are looking at. */
  coverage: string;
  /**
   * Is the LAST bar still forming?
   *
   * `resampleMs` buckets by `floor(t/ms)*ms`, so the trailing bucket is
   * whatever has printed so far — on 4h that can be a single 15m bar wearing
   * the shape of a closed four-hour candle. This is the same class of error as
   * the gateway flushing a partial minute as a whole bar: a detector or a
   * trader reads a high and a low that the period has not finished making.
   *
   * We cannot refuse to draw it — the forming bar is where price IS. So it is
   * named instead, and the chart dims it.
   */
  lastBarPartial: boolean;
  /** How much of the final bucket has printed, 0–1. Null when not resampled. */
  lastBarFill: number | null;
}

function hoursOf(bars: OhlcBar[]): number | null {
  if (bars.length < 2) return null;
  const span = bars[bars.length - 1]!.t - bars[0]!.t;
  return span > 0 ? Math.round((span / 3_600_000) * 10) / 10 : null;
}

/**
 * Build one timeframe from the series the desk already has.
 *
 * `m15` is the engine's own series; `m1` is the ladder's minute series and may
 * be empty on a desk that never fetched it. Pure — no clock, no fetch.
 */
export function seriesFor(tf: ChartTf, m15: OhlcBar[], m1: OhlcBar[]): TfSeries {
  const empty = (why: string): TfSeries => ({
    tf,
    bars: [],
    source: null,
    coverageHours: null,
    coverage: why,
    lastBarPartial: false,
    lastBarFill: null,
  });

  // 1m and 5m can only come from the minute series. Resampling 15m down would
  // invent bars that never printed.
  if (MINUTE_ONLY_TFS.includes(tf)) {
    if (!m1.length) {
      return empty(
        `No 1m series on this desk, so ${tf} cannot be drawn. It is fetched for the ladder's lower rungs; without it, 15m is the finest honest view.`,
      );
    }
    const bars = tf === "1m" ? m1 : resampleMs(m1, MS[tf]);
    const h = hoursOf(bars);
    return {
      tf,
      bars,
      source: "1m",
      coverageHours: h,
      coverage: `${bars.length} bars from the 1m series${h != null ? ` — about ${spanLabel(h)} of tape` : ""}. This window is for TIMING, not bias.`,
      // 1m is passed through untouched, so its last bar is exactly what the
      // feed delivered and this module makes no claim about it. 5m IS bucketed
      // and can trail a partial.
      // 1m is passed through untouched, so its last bar is exactly what the
      // feed delivered. Every bucketed rung can trail a partial.
      ...(tf === "1m"
        ? { lastBarPartial: false, lastBarFill: null }
        : partial(bars, MS[tf], m1, 60_000)),
    };
  }

  if (!m15.length) return empty("No 15m series — nothing to draw.");

  if (tf === "15m") {
    const h = hoursOf(m15);
    return {
      tf,
      bars: m15,
      source: "15m",
      coverageHours: h,
      coverage: `${m15.length} bars${h != null ? ` — about ${spanLabel(h)}` : ""}. This is the series the engine grades on.`,
      lastBarPartial: false,
      lastBarFill: null,
    };
  }

  const bars = resampleMs(m15, MS[tf]);
  const h = hoursOf(bars);
  const p = partial(bars, MS[tf], m15, 900_000);
  return {
    tf,
    bars,
    source: "15m",
    coverageHours: h,
    coverage:
      `${bars.length} bars resampled from 15m${h != null ? ` — about ${spanLabel(h)}` : ""}.` +
      ` 15m divides ${tf} exactly, so no bar is invented.` +
      (p.lastBarPartial
        ? ` The last ${tf} bar is still forming (${Math.round((p.lastBarFill ?? 0) * 100)}% printed).`
        : ""),
    ...p,
  };
}

/**
 * Days, or hours when "days" would round to a lie.
 *
 * `Math.round(h / 24)` reported "about 0d" for anything under twelve hours —
 * which is what a short 15m series on a fresh session actually is. A chart
 * claiming zero days of coverage is worse than one claiming hours.
 */
function spanLabel(h: number): string {
  if (h < 48) return `${Math.round(h)}h`;
  // 1600 15m bars is 639.7 hours, and "about 639.7h" is a number nobody reads
  // as three and a half weeks. Past two days, say days.
  return `${Math.round(h / 24)}d`;
}

/**
 * Is the trailing bucket complete?
 *
 * A bucket starting at `t` is finished only once the source series has
 * delivered a bar at or after `t + ms - srcMs`. Anything less and the bucket's
 * high, low and close are provisional.
 */
function partial(
  bucketed: OhlcBar[],
  ms: number,
  src: OhlcBar[],
  srcMs: number,
): { lastBarPartial: boolean; lastBarFill: number | null } {
  if (!bucketed.length || !src.length) {
    return { lastBarPartial: false, lastBarFill: null };
  }
  const start = bucketed[bucketed.length - 1]!.t;
  const lastSrc = src[src.length - 1]!.t;
  const printed = Math.min(ms, lastSrc + srcMs - start);
  const fill = Math.max(0, Math.min(1, printed / ms));
  return { lastBarPartial: fill < 0.999, lastBarFill: +fill.toFixed(3) };
}

/** Every timeframe at once, for a switch that can grey out what it lacks. */
export function allSeries(m15: OhlcBar[], m1: OhlcBar[]): Record<ChartTf, TfSeries> {
  return Object.fromEntries(CHART_TFS.map((tf) => [tf, seriesFor(tf, m15, m1)])) as Record<
    ChartTf,
    TfSeries
  >;
}

/**
 * The timeframe to open a card on.
 *
 * 15m, always — it is the series the engine graded, so the first thing a
 * trader sees is the chart the score was computed from. Dropping them onto 1m
 * would show a turn with no context; onto 4h, context with no setup.
 */
export const DEFAULT_TF: ChartTf = "15m";

/**
 * How many bars to show at each timeframe.
 *
 * Fewer on the slow rungs because each bar is worth more screen: sixty 4h
 * bars is ten days and reads as noise in a card-sized chart, where forty 1m
 * bars is the forty minutes that decide an entry.
 */
export const TF_VISIBLE_BARS: Record<ChartTf, number> = {
  "4h": 40,
  "1h": 48,
  "15m": 60,
  "5m": 60,
  "3m": 50,
  "2m": 48,
  "1m": 45,
};

// ─────────────────────────────────────────────────────────────────────────────
// WHAT EACH RUNG IS ALLOWED TO DRAW
//
// The same eight mark kinds exist at every timeframe, and drawing all of them
// at every timeframe is how the chart became unreadable in the first place. A
// 4h chart with an entry line on it is a lie of precision: a 4h bar is four
// hours wide and the entry is a limit resting at one price. A 1m chart with
// the weekly high on it is clutter — that level is nine hours of tape away.
//
// So each rung declares what it draws. The rule is the one a trader already
// uses top-down: the slow rungs carry CONTEXT (where the week is going, what
// the range is), the fast rungs carry EXECUTION (the array, the limit, the
// stop), and only 15m — the series the engine actually grades — carries both.
// ─────────────────────────────────────────────────────────────────────────────

/** Levels that belong to a rung rather than to the setup. */
export type TfContext =
  /** Premium / EQ / discount shading of the dealing range. */
  | "dealing_range"
  /** The draw on liquidity, priced. Every rung that can see it. */
  | "draw_line"
  /** The weighted components that built the score, labelled with their weight. */
  | "score_drivers"
  /** Consequent encroachment of the entry array — the resting limit. */
  | "ce_line";

export interface TfMarkSpec {
  kinds: MarkKind[];
  context: TfContext[];
  /** What the trader is reading here. One line, printed under the chart. */
  reads: string;
}

export const TF_MARKS: Record<ChartTf, TfMarkSpec> = {
  "4h": {
    // Pools and the target only. An entry line on a 4h bar is false precision.
    kinds: ["pool", "target"],
    // The pools ARE the higher-timeframe levels worth drawing here, and they
    // arrive as marks. A separate `htf_levels` layer was declared once and
    // consumed nowhere, which is how a spec starts lying about the picture.
    context: ["draw_line"],
    reads: "Which pool the week is drawing to. Nothing here is an entry.",
  },
  "1h": {
    kinds: ["pool", "sweep", "target", "eq"],
    context: ["dealing_range", "draw_line"],
    reads: "The dealing range and which half price is in. Shorts in premium, longs in discount.",
  },
  "15m": {
    // The engine's own series — everything, because this is the chart the
    // score was computed from and the trader should be able to audit it.
    kinds: ["pool", "sweep", "displacement", "array", "entry", "stop", "target", "eq"],
    context: ["dealing_range", "draw_line", "score_drivers"],
    reads: "The graded setup. Every mark here is a layer the sequence scored.",
  },
  "5m": {
    kinds: ["sweep", "displacement", "array", "entry", "stop"],
    context: ["score_drivers", "ce_line"],
    reads: "The shift after the raid. Displacement and MSS confirm, or they do not.",
  },
  // 3m and 2m exist for one job the other rungs cannot do: resolving the
  // open's manipulation leg from the reaction to it. 09:30-09:45 ET is a
  // SINGLE 15m candle, so on the engine's own series a raid and its failure
  // are the same bar and cannot be told apart. These two are the coarsest
  // views that separate them, so they draw the raid and the shift, and no
  // targets — a target is a 15m fact and does not belong at this scale.
  "3m": {
    kinds: ["sweep", "displacement", "array", "entry", "stop"],
    context: ["score_drivers", "ce_line"],
    reads: "The open's raid and whether it failed. This is where a Judas swing is confirmed, not guessed.",
  },
  "2m": {
    kinds: ["sweep", "displacement", "array", "entry", "stop"],
    context: ["ce_line"],
    reads: "The manipulation leg, bar by bar. Enter against it only once it has closed back inside.",
  },
  "1m": {
    // Timing only. No pools, no targets — they are off-screen at this scale.
    kinds: ["array", "entry", "stop"],
    context: ["ce_line"],
    reads: "The turn inside the array. Rest the limit at CE; never pay the print.",
  },
};

/** Filter a setup's marks to the ones this rung draws. */
export function marksFor<T extends { kind: MarkKind }>(tf: ChartTf, marks: T[]): T[] {
  const allowed = new Set<MarkKind>(TF_MARKS[tf].kinds);
  return marks.filter((m) => allowed.has(m.kind));
}

/** Does this rung draw that context layer? */
export function showsContext(tf: ChartTf, c: TfContext): boolean {
  return TF_MARKS[tf].context.includes(c);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-ADAPT
//
// The desk picks the rung, and the rung it picks follows the trade's own life:
// context while the sequence is still assembling, execution once it is armed.
// This is the same top-down discipline the ladder enforces for direction, only
// applied to which chart is in front of you.
//
// The trader can always pin a rung — this is a default, not a cage. But the
// default matters: the moment a card goes live is exactly the moment nobody
// has spare attention to go find the right chart.
// ─────────────────────────────────────────────────────────────────────────────

export interface AutoTfRead {
  tf: ChartTf;
  why: string;
}

export interface AutoTfInput {
  /** From SetupAnticipation.entry. */
  entry: "not-yet" | "armed" | "live" | "gone";
  /** smc-master's word for the card. */
  word?: "TAKE" | "WAIT" | "STAND";
  /** The must-layer the sequence is currently missing, if any. */
  missingLayer?: string | null;
}

/**
 * Which rung the desk should be showing.
 *
 * The ordering is deliberate and the reasons are not interchangeable:
 *
 *  - `live` → 1m. Price is in the array. The only remaining question is the
 *    turn, and the turn is a 1m fact. Everything else is already decided.
 *  - `armed` → 5m. The sequence is complete and price is away from the array.
 *    5m is where the retrace is read without the noise of 1m.
 *  - missing an HTF or range layer → 1h. The thing being waited on is a
 *    structure fact, so show structure. Sending the trader to 15m to wait on
 *    a 1h condition is how a card gets stared at for an hour.
 *  - everything else → 15m, the graded series.
 *
 * `gone` deliberately returns to 15m rather than staying on 1m: once the array
 * is left or the stop is traded, the next useful question is whether there is
 * a continuation setup, and that is a 15m read.
 */
export function autoTf(input: AutoTfInput): AutoTfRead {
  if (input.entry === "live") {
    return { tf: "1m", why: "Price is in the array — this is a timing decision now." };
  }
  if (input.entry === "armed") {
    return { tf: "5m", why: "Sequence complete, price away from the array. Watching the retrace." };
  }
  const missing = (input.missingLayer ?? "").toLowerCase();
  if (missing.includes("htf") || missing.includes("pd_half") || missing.includes("dol")) {
    return {
      tf: "1h",
      why: `Waiting on a structure layer (${input.missingLayer}) — that is read on 1h, not 15m.`,
    };
  }
  if (input.entry === "gone") {
    return { tf: "15m", why: "Array left or stop traded. Looking for the next setup, not the last one." };
  }
  return { tf: "15m", why: "The series the engine graded. Default until the setup arms." };
}

/**
 * The rung actually shown, given what the desk wants and what has bars.
 *
 * `autoTf` is pure and knows nothing about data availability, so on a desk with
 * no minute series it happily returns "1m" for a live card — and a live card is
 * the single worst moment to replace the chart with a paragraph explaining why
 * there is no chart. This resolves the want against reality.
 *
 * The fallback order is 15m first, because it is the series the engine graded
 * and therefore the one whose picture matches the score; then outward to
 * whatever exists. `substituted` is returned rather than hidden so the switch
 * can say the desk wanted a rung it could not draw.
 */
export function resolveTf(
  want: ChartTf,
  rungs: Record<ChartTf, TfSeries>,
): { tf: ChartTf; substituted: boolean; why: string | null } {
  if (rungs[want]?.bars.length) return { tf: want, substituted: false, why: null };

  const order: ChartTf[] = ["15m", "1h", "5m", "4h", "1m"];
  for (const tf of order) {
    if (tf !== want && rungs[tf]?.bars.length) {
      return {
        tf,
        substituted: true,
        why: `No ${want} series on this book — showing ${tf} instead.`,
      };
    }
  }
  return { tf: want, substituted: false, why: null };
}
