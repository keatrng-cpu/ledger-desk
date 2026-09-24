/**
 * The setup, drawn.
 *
 * WHY THIS IS RENDERED AND NOT SCREENSHOTTED OR GENERATED
 * Three options existed for "show me the chart with the levels on it":
 *
 *   1. Screenshot an external chart and annotate it. That is what
 *      `chart-markup.ts` does, and it needs the trader to paste an image
 *      first — which is the lag, and it means the annotation is drawn onto a
 *      picture whose prices nothing in this app verified.
 *   2. Ask an image model to draw it. An image model produces a picture that
 *      LOOKS like a chart. The candles would not be the candles, the levels
 *      would not be the levels, and it would take seconds. For a surface a
 *      trader reads before risking money, a plausible-looking wrong chart is
 *      the worst possible artifact.
 *   3. Draw the data the desk already has. Sub-millisecond, pixel-exact, and
 *      — the part that matters — it renders from the SAME objects the grade
 *      is computed from, so the drawing cannot disagree with the verdict
 *      sitting next to it.
 *
 * This is (3). It is also the only one of the three compatible with the house
 * rule that nothing in the poll loop is an LLM.
 *
 * TWO LAYERS
 * The OVERLAY (chart-overlay.ts) is what an SMC trader marks before deciding
 * anything: liquidity pools with their labels, the live PD arrays as boxes
 * from the bar that made them, structure breaks, the last raid, the dealing
 * range, and the draw on liquidity. It is drawn on every bar, pre-market and
 * in-session, with or without a trade. The PLAN (trade-plan.ts) — entry,
 * stop, targets — is drawn on top only when the sequence has priced one.
 * Before this split, a STAND day showed bare candles, which told the trader
 * nothing about WHY it was a stand.
 *
 * WHAT IS DELIBERATELY NOT DRAWN
 * Mitigated arrays, pools outside the visible band, structure older than two
 * hours, and anything past the caps in chart-overlay.ts. Clutter in pixels is
 * still clutter. Three more refusals live further down: a nested array does
 * not get its own box (the containing one is drawn and the inner EDGE is
 * marked), session bells are not drawn on bars coarser than 30 minutes, and
 * killzone dimming is dropped when no bar in the window is inside one —
 * dimming everything says nothing.
 */

import { useMemo } from "react";
import type { OhlcBar } from "@/lib/market/types";
import type { TradePlan } from "@/lib/trading/trade-plan";
import type { SmcArray } from "@/lib/trading/smc-board";
import type { ChartOverlay, OverlayPool } from "@/lib/trading/chart-overlay";
import { etWallParts, resolveKillzone } from "@/lib/trading/sessions";

const W = 720;
const H = 340;
/**
 * The left strip is not padding — it is the premium/discount rail. The range
 * used to be two full-width rects, which bathed two thirds of the frame in
 * red and made every candle inside it read as "in premium" by colour rather
 * than by position. The rail says the same thing in 9px and leaves the plot
 * to price action, so the plot starts to the RIGHT of it.
 */
const RAIL_X = 5;
const RAIL_W = 9;
/**
 * The R rail — the second nine-pixel column, and the answer to "how big is
 * this trade?" before any number is read.
 *
 * Entry, stop and T1 were already three horizontal lines, but the DISTANCE
 * between them is the trade and three lines do not carry it: a 0.55R plan and
 * a 2R plan draw the same three lines. The full-width risk/reward tints below
 * help, but they sit under six boxes and a hundred candles at 0.1 opacity, so
 * the comparison the eye needs — this block against that block — never
 * happens. Here the two blocks are adjacent in one column at one x, with
 * nothing else in it, and the 1R step marks step the risk block's own height
 * up the page. A target that does not reach the first step is a sub-1R plan,
 * visibly, from across the room.
 */
const R_RAIL_X = 16;
const R_RAIL_W = 9;
const PAD_L = 29;
/**
 * The gutter carries every level's NAME as well as its price now, so it is
 * sized for both: ~50px of tabular price on the left of the column, ~60px of
 * name right-aligned against the frame. Names used to print at PAD_L + 3 —
 * directly over the candles — which is the one column of a chart that has no
 * spare pixels.
 */
const PAD_R = 128;
const PAD_T = 12;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
/** Left edge of the gutter's text column. */
const GUTTER_X = W - PAD_R + 6;

/** Bars shown. Enough for structure, few enough that bodies stay readable. */
export const VISIBLE_BARS = 60;
/** Hard cap on shaded PD arrays when only a plan (no overlay) is given. */
const MAX_PLAN_ARRAYS = 4;
/**
 * Hard cap with a live overlay. The tape can carry a dozen arrays; a chart
 * showing a dozen boxes is not a chart, it is a stained-glass window. Six is
 * the plan's side plus the nearest few on the other.
 */
const MAX_OVERLAY_ARRAYS = 6;
/**
 * Minimum vertical gap between two gutter rows before the lower-priority one
 * is dropped.
 *
 * A row is one 9.5px line of price with its name beside it, so 12 leaves a
 * clear band of daylight. The old over-the-candles chips needed 16 because a
 * chip is 10px of plate around 8px of text; in the gutter the rows are text
 * on background and read cleanly closer together. A real price axis never
 * stacks two names at one height — it drops the weaker one, which is why the
 * list below is built in priority order.
 */
const GUTTER_GAP = 12;
/**
 * A rail band shorter than this cannot carry its rotated PREMIUM / DISCOUNT
 * name, so it is left as bare tint rather than printing a clipped word.
 */
const RAIL_LABEL_MIN_H = 38;
/**
 * The draw on liquidity is pulled INTO frame when it is within this many
 * visible-band heights of the edge. Further than that, squeezing the candles
 * to fit it would hide the structure, so it becomes an edge arrow instead.
 */
const DRAW_INFRAME_SPANS = 0.6;
/**
 * An R-rail block shorter than this cannot carry its rotated "1R" / "2.1R"
 * without clipping, so it is left as bare colour. The block's HEIGHT is the
 * fact; the text is the confirmation.
 */
const R_LABEL_MIN_H = 24;
/**
 * The session bells. SMC is a time-based method and this chart had no time
 * structure at all beyond the two corner stamps.
 *
 * 09:30 is the cash open and the start of the Judas window (no entries until
 * 09:45). 10:00 is the desk's own cutoff — after it, A+ only unless already in
 * a trade. 11:30 is where the live gateway's NY window ends, so it is the last
 * bar with sub-second prints behind it. Note the NY AM killzone itself ends at
 * 11:00 per sessions.ts, and the dimming below uses that clock, not this list.
 */
const SESSION_MARKS: { minute: number; label: string }[] = [
  { minute: 9 * 60 + 30, label: "09:30" },
  { minute: 10 * 60, label: "10:00" },
  { minute: 11 * 60 + 30, label: "11:30" },
];
/**
 * Above this many bells the window is spanning so many sessions that the
 * verticals become the grid this chart refuses to draw, so none are drawn.
 */
const MAX_TIME_MARKS = 8;
/**
 * Bars coarser than this cannot carry an intraday bell honestly — a 1H bar
 * CONTAINS 09:30 rather than starting at it, and a line on its left edge
 * would be off by up to an hour.
 */
const MAX_MARK_SPACING_MS = 30 * 60_000;
/**
 * Candle opacity inside a trade window, and outside one.
 *
 * Outside is pushed back, not hidden: the Asia range and the London extremes
 * are drawn FROM bars nobody trades, so a chart that erased them would erase
 * the levels the session is priced against.
 */
const KZ_ON = 0.92;
const KZ_OFF = 0.32;
/**
 * The bottom strip of the plot belongs to the time axis — two rows of it.
 * Every other label that can be pushed to the floor — the raid, the structure
 * breaks — stops above the strip, so a stamp never shares a row with a price
 * annotation.
 */
const TIME_AXIS_H = 20;
/**
 * Horizontal room a stamp needs before the next one can share its row.
 *
 * "09:30" is ~20px at 7.5px, and on 15m bars the 10:00 bell is two bars —
 * about 19px — later, so the first render printed "09:3010:00" as one word.
 * Closer than this the stamp moves to the upper row instead of being dropped:
 * 10:00 is the desk's A+-only cutoff and is not worth losing to a collision.
 */
const TIME_LABEL_GAP = 26;
/** Below this the two rows would still touch, so the later stamp is dropped. */
const TIME_LABEL_MIN = 10;

export interface SetupChartProps {
  bars: OhlcBar[];
  plan: TradePlan | null;
  /** The always-on SMC markup. Null = plan-only (replays, figures). */
  overlay?: ChartOverlay | null;
  /** Shown when there is no plan yet — the missing must-layer, in tape terms. */
  emptyDetail?: string;
  /** "TAKE" / "WAIT" / "STAND", for the corner badge. */
  word?: string;
  className?: string;
  /** Bars shown. Defaults to the live desk's window. */
  visibleBars?: number;
  /**
   * Index (in `bars`) of the decision bar, for replays. Draws a divider and
   * dims everything to its right so what was knowable at the decision is
   * visually separate from what happened next.
   */
  decisionIndex?: number | null;
  /** Suppress the empty-plan caption (a replay explains itself elsewhere). */
  hideEmptyCaption?: boolean;
}

interface Scale {
  x: (i: number) => number;
  y: (p: number) => number;
  step: number;
  lo: number;
  hi: number;
}

/**
 * Price→pixel projection.
 *
 * Exported because it is the part that can be wrong in a way the eye does not
 * catch: a target drawn off-canvas, or a stop that looks closer to entry than
 * it is, is a misleading chart rather than an ugly one.
 */
export function buildScale(
  bars: OhlcBar[],
  plan: TradePlan | null,
  overlay?: ChartOverlay | null,
): Scale | null {
  if (!bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, b.l);
    hi = Math.max(hi, b.h);
  }
  const barSpan = hi - lo || 1;
  // Plan levels must be IN FRAME. A chart that crops the target silently
  // tells the trader the trade is tighter than it is.
  if (plan) {
    for (const lv of plan.levels) {
      lo = Math.min(lo, lv.price);
      hi = Math.max(hi, lv.price);
    }
    if (plan.entryZone) {
      lo = Math.min(lo, plan.entryZone.bottom);
      hi = Math.max(hi, plan.entryZone.top);
    }
  }
  if (overlay) {
    // Pools are pre-filtered to (near) the band, so they widen it only a
    // little; the draw is pulled in when close and arrowed when far.
    for (const p of overlay.pools) {
      lo = Math.min(lo, p.price);
      hi = Math.max(hi, p.price);
    }
    if (overlay.draw && drawInFrame(overlay.draw.price, lo, hi, barSpan)) {
      lo = Math.min(lo, overlay.draw.price);
      hi = Math.max(hi, overlay.draw.price);
    }
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const span = hi - lo || 1;
  const padPx = span * 0.06;
  lo -= padPx;
  hi += padPx;
  const step = PLOT_W / Math.max(bars.length, 1);
  return {
    lo,
    hi,
    step,
    x: (i) => PAD_L + i * step + step / 2,
    y: (p) => PAD_T + ((hi - p) / (hi - lo)) * PLOT_H,
  };
}

function drawInFrame(price: number, lo: number, hi: number, barSpan: number): boolean {
  if (price >= lo && price <= hi) return true;
  const beyond = price > hi ? price - hi : lo - price;
  return beyond <= barSpan * DRAW_INFRAME_SPANS;
}

function arrayFill(a: SmcArray): string {
  if (a.kind === "ob" || a.kind === "bb" || a.kind === "rb") return "var(--color-chart-4)";
  if (a.kind === "ifvg") return "var(--color-chart-2)";
  return "var(--color-chart-3)";
}

/**
 * What a trader writes on the chart, not what the type system calls it.
 *
 * "15M BEAR IFVG · PARTIAL" is 23 characters of box-width that overlaps the
 * next array and the candles under it. The timeframe and kind are what you
 * read; the side is already the box colour, and the state only matters when
 * the array is NOT fresh — and even then "partial" is the only state worth
 * the pixels, because it is the one that changes where you enter.
 */
function arrayName(a: SmcArray): string {
  const kind = (a.kind === "bb" ? "BRK" : a.kind === "rb" ? "REJ" : a.kind === "sponsored" ? "FVG+" : a.kind).toUpperCase();
  const partial = a.state === "partial" ? "·part" : "";
  return `${a.tf.toUpperCase()} ${kind}${partial}`;
}

/**
 * A drawn array and everything sitting inside it.
 *
 * A 15m FVG inside a 1H OB is not two objects a trader reads separately — it
 * is one zone with a tighter edge in it. Drawn as two boxes it came out as a
 * box inside a box with two labels forty pixels apart, which is the collision
 * problem again in a different costume.
 */
interface ArrayGroup {
  outer: SmcArray;
  inner: SmcArray[];
}

/**
 * True when b's price span sits wholly inside a's, with enough room left for
 * the containment to be legible.
 *
 * The 0.92 is not a tolerance on equality — it is the point below which the
 * inner box is so nearly the outer box that marking an inner edge would draw
 * a second line on top of the first. Two arrays that close are one zone, and
 * the larger one is drawn.
 */
function containsArray(a: SmcArray, b: SmcArray): boolean {
  const ah = a.top - a.bottom;
  const bh = b.top - b.bottom;
  if (!(ah > 0) || !(bh > 0)) return false;
  return b.top <= a.top && b.bottom >= a.bottom && bh < ah * 0.92;
}

/**
 * Collapse containment into groups: one outer box per group, everything it
 * swallows listed beside it.
 *
 * Exported for the same reason buildScale is: it decides what the trader does
 * NOT see, and a grouping bug hides an array rather than drawing an ugly one.
 * Widest first, so an array always lands in the largest box that holds it and
 * a three-deep nest still resolves to one group rather than two.
 */
export function groupNestedArrays(arrays: SmcArray[]): ArrayGroup[] {
  const groups: ArrayGroup[] = [];
  for (const a of [...arrays].sort((x, y) => y.top - y.bottom - (x.top - x.bottom))) {
    const host = groups.find((g) => containsArray(g.outer, a));
    if (host) host.inner.push(a);
    else groups.push({ outer: a, inner: [] });
  }
  return groups;
}

/**
 * One name for the whole group.
 *
 * The entry array owns the name whenever it is in the group — it is the only
 * box whose identity changes what the trader does — and the box around it is
 * named after it with ⊂. Otherwise the outer is named and what it holds is
 * counted, because "1H OB ⊃ 15M FVG" is the sentence a trader would write and
 * a list of three is a paragraph.
 */
export function groupName(g: ArrayGroup, entry: SmcArray | null): string {
  const outerName = arrayName(g.outer);

  if (entry && entry !== g.outer) {
    const rest = g.inner.length - 1;
    // "in", not ⊂. The set-theory glyphs read as noise at 8px over candles,
    // and this label has to be legible at a glance in the twenty seconds
    // before a limit fills.
    return `ENTRY ${arrayName(entry)} in ${outerName}${rest > 0 ? ` +${rest}` : ""}`;
  }

  const head = `${entry ? "ENTRY " : ""}${outerName}`;
  if (!g.inner.length) return head;

  // A group whose members all share the outer's name said "15M REJ ⊃ 15M REJ"
  // on the live chart — a label that costs pixels and tells the trader
  // nothing. Same name means one zone confirmed at one timeframe more than
  // once, so it counts instead of repeating itself.
  const names = g.inner.map(arrayName);
  if (names.every((n) => n === outerName)) {
    return `${head} ×${g.inner.length + 1}`;
  }

  const distinct = [...new Set(names.filter((n) => n !== outerName))];
  if (distinct.length === 1 && g.inner.length === 1) return `${head} · ${distinct[0]} inside`;
  return `${head} · ${g.inner.length} inside`;
}

/**
 * Pool and draw names from structure.ts carry a parenthetical class —
 * "PWH (external BSL)", "Swing low (internal SSL)" — that the line's own
 * colour and the BSL/SSL prefix already say. Strip it so the label is the
 * name a trader would write: "BSL PWH".
 */
function shortName(label: string): string {
  return label.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

/**
 * One R, printed the same way everywhere on this chart.
 *
 * Below 1R the second decimal is the whole point — 0.55R and 0.6R are the
 * same trade, but the gutter printing one while the R rail printed the other
 * reads as two measurements disagreeing, which is the one thing a chart
 * drawn from a single plan object must never do.
 */
function rLabel(r: number): string {
  return `${r.toFixed(r < 1 ? 2 : 1)}R`;
}

export function SetupChart({
  bars,
  plan,
  overlay = null,
  emptyDetail,
  word,
  className,
  visibleBars,
  decisionIndex = null,
  hideEmptyCaption = false,
}: SetupChartProps) {
  const window_ = visibleBars ?? VISIBLE_BARS;
  const offset = Math.max(0, bars.length - window_);
  const view = useMemo(() => bars.slice(-window_), [bars, window_]);
  const decisionInView = decisionIndex == null ? null : decisionIndex - offset;
  const scale = useMemo(() => buildScale(view, plan, overlay), [view, plan, overlay]);

  /**
   * ET time structure: where the session bells fall in this window, and which
   * bars are inside a trade window at all.
   *
   * Both facts come from sessions.ts — the same clock the HUD and the gates
   * read — so the chart cannot disagree with the killzone the desk is quoting.
   * It refuses in two places rather than guessing: no bells on bars too coarse
   * to carry them, and no dimming when every bar is on the same side of the
   * window, because a uniformly dim chart is just a dim chart.
   */
  const timeStructure = useMemo(() => {
    const inWindow: boolean[] = [];
    const hit = new Map<number, string>();
    if (!view.length) return { marks: [] as { i: number; label: string }[], inWindow, dimOutside: false };
    const gaps: number[] = [];
    for (let i = 1; i < view.length; i++) gaps.push(view[i]!.t - view[i - 1]!.t);
    gaps.sort((a, b) => a - b);
    const spacing = gaps.length ? (gaps[Math.floor(gaps.length / 2)] ?? Infinity) : Infinity;
    const fineEnough = spacing <= MAX_MARK_SPACING_MS;
    let prev: { day: number; minute: number } | null = null;
    for (let i = 0; i < view.length; i++) {
      const p = etWallParts(view[i]!.t);
      const minute = p.hour * 60 + p.minute;
      inWindow.push(resolveKillzone(p.hour, p.minute).inTradeWindow);
      if (fineEnough && prev) {
        // The first bar at or after each bell. SESSION_MARKS is ascending, so
        // when an overnight gap jumps several at once the latest one wins the
        // index rather than three lines landing on the same pixel column.
        for (const m of SESSION_MARKS) {
          if (minute >= m.minute && (p.day !== prev.day || prev.minute < m.minute)) hit.set(i, m.label);
        }
      }
      prev = { day: p.day, minute };
    }
    const marks = [...hit].map(([i, label]) => ({ i, label }));
    return {
      marks: marks.length <= MAX_TIME_MARKS ? marks : [],
      inWindow,
      dimOutside: inWindow.some((v) => v) && inWindow.some((v) => !v),
    };
  }, [view]);

  // With an overlay the arrays are the tape's live arrays on both sides
  // (capped upstream). Without one — replays, figures — fall back to the
  // plan's own arrays on the traded side, as before.
  const shownArrays = useMemo(() => {
    if (!scale) return [];
    if (overlay) {
      // A real SMC chart does not draw every gap on the tape — it draws the
      // one you would enter and the structure around it. Drawing all of them
      // is how the 2026-09-23 screenshot ended up with four overlapping box
      // labels across the same forty pixels of price.
      //
      // Keep the plan's side first (that is the trade), nearest price first
      // within each side (that is the one you would actually fill), and cap.
      // Boxes off the plan's side are still drawn — you need to see what is
      // in the way — but they lose the label slot to the ones that matter.
      const inFrame = overlay.arrays.filter((a) => a.top >= scale.lo && a.bottom <= scale.hi);
      const want = plan?.side === "long" ? "bull" : plan?.side === "short" ? "bear" : null;
      const ref = plan?.price ?? view[view.length - 1]?.c ?? null;
      const near = (a: SmcArray) => (ref == null ? 0 : Math.abs((a.top + a.bottom) / 2 - ref));
      return [...inFrame]
        .sort((a, b) => {
          if (want) {
            const sa = a.side === want ? 0 : 1;
            const sb = b.side === want ? 0 : 1;
            if (sa !== sb) return sa - sb;
          }
          return near(a) - near(b);
        })
        .slice(0, MAX_OVERLAY_ARRAYS);
    }
    if (!plan) return [];
    const side = plan.side === "long" ? "bull" : "bear";
    return plan.arrays
      .filter(
        (a) =>
          a.side === side &&
          a.state !== "mitigated" &&
          a.top >= scale.lo &&
          a.bottom <= scale.hi,
      )
      .sort((a, b) => b.t - a.t)
      .slice(0, MAX_PLAN_ARRAYS);
  }, [plan, overlay, scale]);

  if (!scale || !view.length) {
    return (
      <div
        className={`panel grid place-items-center p-6 text-sm text-[var(--color-subtle)] ${className ?? ""}`}
      >
        No bars to draw.
      </div>
    );
  }

  const long = plan?.side === "long";
  const firstT = view[0]!.t;
  const lastT = view[view.length - 1]!.t;
  const lastClose = view[view.length - 1]!.c;
  const range = plan?.range ?? overlay?.range ?? null;
  const symbol = plan?.symbol ?? overlay?.symbol ?? "";
  const side = plan?.side ?? null;
  const badgeWord = word ?? overlay?.word;
  /**
   * Where the replay divider stands, or null when the decision bar is the
   * newest bar and there is no future to separate from it. Held here because
   * the time stamps at the plot's foot have to give its caption right of way.
   */
  const replayEdge =
    decisionInView != null && decisionInView >= 0 && decisionInView < view.length - 1
      ? scale.x(decisionInView) + scale.step / 2
      : null;

  /**
   * Which session stamps get printed, and on which of the two rows.
   *
   * The lines are always drawn — a boundary costs half a pixel of ink and
   * carries itself. The STAMP is what collides, so it is staggered first and
   * only dropped when even two rows cannot separate it.
   */
  const timeLabelRow = new Map<number, number>();
  {
    let lastX = -Infinity;
    let lastRow = 1;
    for (const m of timeStructure.marks) {
      const x = scale.x(m.i) - scale.step / 2;
      const gap = x - lastX;
      if (gap < TIME_LABEL_MIN) continue;
      const row = gap >= TIME_LABEL_GAP ? 0 : lastRow === 0 ? 1 : 0;
      timeLabelRow.set(m.i, row);
      lastX = x;
      lastRow = row;
    }
  }

  // Which of the drawn boxes the plan actually enters.
  //
  // Every array on screen used to carry the same weight, so the one the limit
  // rests in looked exactly like the three that are merely in the way. The
  // plan does not hand over the array object — it keeps the entry array's
  // EDGES as `entryZone`, rounded to 2dp — so the match is on those edges.
  // No match is a normal answer (the entry array can sit outside the drawn
  // set), and then the teal zone rect below carries the entry on its own.
  const zone = plan?.entryZone ?? null;
  const isEntryArray = (a: SmcArray): boolean =>
    zone != null &&
    Math.abs(a.top - zone.top) < 0.006 &&
    Math.abs(a.bottom - zone.bottom) < 0.006;
  const entryDrawn = shownArrays.some(isEntryArray);

  // Containment collapsed to one object each, and the group holding the entry
  // drawn LAST so the teal box and its 1.5px stroke sit on top of whatever
  // contains it rather than under it.
  const arrayGroups = groupNestedArrays(shownArrays)
    .map((g) => ({ ...g, entry: [g.outer, ...g.inner].find(isEntryArray) ?? null }))
    .sort((a, b) => Number(a.entry != null) - Number(b.entry != null));

  /** Index in `view` of the bar containing time t; 0 if before the window. */
  const idxOf = (t: number): number => {
    if (t <= firstT) return 0;
    for (let i = view.length - 1; i >= 0; i--) if (view[i]!.t <= t) return i;
    return 0;
  };
  /** Left x of the bar containing t — where a box or line begins. */
  const xStart = (t: number | undefined): number =>
    t == null || t <= firstT ? PAD_L : scale.x(idxOf(t)) - scale.step / 2;

  // The raid: plan's sweep when priced, else the overlay's last sweep.
  //
  // A raid is a wick THROUGH a level, so the drawing needs both ends of it.
  // Only the overlay carries the level that was taken; TradePlan.sweep keeps
  // the extreme and the time and nothing else. When the plan is describing a
  // different raid than the overlay's last one, the level stays null and the
  // excursion is not drawn — an invented level on a chart a trader prices
  // risk from is worse than a missing one, because a missing one is visibly
  // missing.
  const overlaySweep = overlay?.sweep ?? null;
  const sweep =
    plan?.sweep?.t != null
      ? {
          price: plan.sweep.price,
          t: plan.sweep.t,
          above: !long,
          level: overlaySweep && overlaySweep.t === plan.sweep.t ? overlaySweep.level : null,
        }
      : overlaySweep
        ? {
            price: overlaySweep.price,
            t: overlaySweep.t,
            above: overlaySweep.side === "buyside",
            level: overlaySweep.level,
          }
        : null;
  const sweepIdx = sweep ? idxOf(sweep.t) : -1;

  // Draw on liquidity: in frame → a line; out of frame → an edge arrow.
  const draw = overlay?.draw ?? null;
  const drawVisible = draw != null && draw.price >= scale.lo && draw.price <= scale.hi;

  // ── The gutter: every level's name, at the price axis ────────────────────
  //
  // Pool, draw and EQ names used to be chips at PAD_L + 3 — printed over the
  // candles, over each other, and over the corner badge. Every platform a
  // trader has ever used puts the name at the axis and leaves the plot to
  // price action; the horizontal line still crosses the whole plot, so the
  // only thing lost is the overprinting.
  //
  // Order IS the priority, because dedupeByY keeps the first entry at a given
  // height: the plan's own levels (what the order is priced off) outrank the
  // draw, the draw outranks live pools, live pools outrank EQ, and spent
  // pools come last — a swept pool losing its name to the stop is the right
  // trade every time.
  const visiblePools = (overlay?.pools ?? []).filter(
    (p) => p.price >= scale.lo && p.price <= scale.hi,
  );
  const poolRow = (p: OverlayPool) => ({
    p: p.price,
    c: poolColor(p),
    t: `${p.swept ? "✕ " : ""}${p.side === "buyside" ? "BSL" : "SSL"} ${shortName(p.label)}`,
    dim: p.swept,
  });
  const gutter = dedupeByY(
    [
      ...(plan
        ? [
            { p: plan.price, c: "var(--color-fg)", t: "live", dim: false },
            { p: plan.entry, c: "var(--color-primary)", t: "entry", dim: false },
            { p: plan.stop, c: "var(--color-down)", t: "stop", dim: false },
            ...(plan.t1 != null
              ? [{ p: plan.t1, c: "var(--color-up)", t: plan.rr1 != null ? `T1 ${rLabel(plan.rr1)}` : "T1", dim: false }]
              : []),
            ...(plan.t2 != null
              ? [{ p: plan.t2, c: "var(--color-up)", t: plan.rr2 != null ? `T2 ${rLabel(plan.rr2)}` : "T2", dim: false }]
              : []),
          ]
        : overlay
          ? [{ p: lastClose, c: "var(--color-fg)", t: "last", dim: false }]
          : []),
      ...(drawVisible && draw
        ? [
            {
              p: draw.price,
              c: "var(--color-up)",
              // The reach rate belongs to the name, not to a second chip:
              // "DOL PDH 68%" is the whole sentence a trader reads here.
              t: `DOL ${shortName(draw.name)} ${(draw.reachProbability * 100).toFixed(0)}%`,
              dim: false,
            },
          ]
        : []),
      ...visiblePools.filter((p) => !p.swept).sort(poolPriority).map(poolRow),
      ...(range && range.eq >= scale.lo && range.eq <= scale.hi
        ? [{ p: range.eq, c: "var(--color-muted)", t: "EQ", dim: true }]
        : []),
      ...visiblePools.filter((p) => p.swept).sort(poolPriority).map(poolRow),
    ],
    scale,
    GUTTER_GAP,
  );

  // One label per GROUP, at the top-left of the box that names it. Nesting
  // used to produce two names forty pixels apart describing one zone; now the
  // second name is a suffix on the first, and only collisions BETWEEN groups
  // can still cost a label. The entry's group takes its slot ahead of
  // everything else — it is the only name that changes what the trader does —
  // and nearest-to-price wins the rest, the order chart-overlay.ts emits in.
  const groupLabelAnchor = (g: { outer: SmcArray; entry: SmcArray | null }) => g.entry ?? g.outer;

  /**
   * Plate width for a name, in px.
   *
   * The old estimate multiplied character count by a constant and used the
   * result both to draw the plate and to test collisions, so a long name
   * overflowed the plot into the price rail — which is how
   * "15M REJ ⊃ 15M REJ" ended up printed across the LIVE price. Measured the
   * same way in both places, and the plate is clamped below.
   */
  const plateWidth = (name: string, isEntry: boolean) =>
    name.length * (isEntry ? 4.9 : 4.7) + 6;

  /**
   * Where a group's label actually lands.
   *
   * Clamped so the plate's RIGHT edge never crosses into the price gutter.
   * A label that runs under the rail is unreadable exactly where the numbers
   * matter most.
   */
  const groupLabelX = (g: { outer: SmcArray; entry: SmcArray | null }, name: string) => {
    const w = plateWidth(name, g.entry != null);
    const raw = xStart(groupLabelAnchor(g).t) + 1;
    return Math.max(PAD_L + 1, Math.min(raw, PAD_L + PLOT_W - w - 1));
  };

  /**
   * Which groups get a FILL, as opposed to just their edges.
   *
   * Every group's box runs from its origin to the right edge, so three
   * overlapping zones stack three translucent fills and the result is a
   * muddy block where no single zone is readable — which is what the live
   * chart was doing. Fills are a scarce resource: the entry group always has
   * one because it is the trade, plus the single nearest-to-price zone
   * because that is the one price is about to interact with. Everything else
   * keeps its edges, which is enough to see where it is without repainting
   * the same pixels a third time.
   */
  const filledGroups = new Set<(typeof arrayGroups)[number]>();
  {
    const entryGroup = arrayGroups.find((g) => g.entry != null);
    if (entryGroup) filledGroups.add(entryGroup);
    const nearest = [...arrayGroups]
      .filter((g) => g !== entryGroup)
      .sort(
        (a, b) =>
          Math.abs((a.outer.top + a.outer.bottom) / 2 - lastClose) -
          Math.abs((b.outer.top + b.outer.bottom) / 2 - lastClose),
      )[0];
    if (nearest) filledGroups.add(nearest);
  }

  const labelledGroups = new Set<(typeof arrayGroups)[number]>();
  {
    const taken: { x: number; y: number; w: number }[] = [];

    // The live-price line and its rail label own their row. A group label
    // sharing that row is the collision in the screenshot: the name printed
    // straight through "30468.50 LIVE".
    taken.push({ x: PAD_L, y: scale.y(lastClose), w: PLOT_W });

    // So does the raid annotation. It renders AFTER the array labels and so
    // draws over them — "15M REJ · 3 INSIDE" printed under
    // "raid 7739.50 · 1.75pt through" on the live chart. The raid wins that
    // row on merit: it is a must-layer and the reason the setup exists, where
    // the array name is context. Reserved with a band wide enough to cover
    // the label's own ±14px offset from the wick extreme, since the exact
    // offset is computed later in the render.
    if (sweep) {
      // ONE tight row, at the raid line itself.
      //
      // Two ±12px bands across the plot suppressed every array label on the
      // chart, and a narrower version still killed the one that mattered:
      // the rejection block IS the raid, so they sit at the same price by
      // construction. A band around the raid therefore eats the label of the
      // structure the raid created — trading a collision for no label, which
      // is the worse chart.
      //
      // So only the raid's own line row is reserved; its text is offset from
      // that row and carries a plate, which is what actually makes an overlap
      // readable. Belt, not straitjacket.
      const raidY = scale.y(sweep.price);
      const raidX = scale.x(sweepIdx);
      const raidW = 150;
      const flipped = raidX > PAD_L + PLOT_W * 0.72;
      taken.push({ x: flipped ? raidX - raidW - 6 : raidX + 6, y: raidY, w: raidW });
    }

    const byImportance = entryDrawn
      ? [...arrayGroups].sort((a, b) => Number(b.entry != null) - Number(a.entry != null))
      : arrayGroups;
    for (const g of byImportance) {
      const name = groupName(g, g.entry);
      const y = scale.y(groupLabelAnchor(g).top);
      const x = groupLabelX(g, name);
      const w = plateWidth(name, g.entry != null);
      // Real overlap: rows within one line box AND horizontal spans that
      // actually intersect. The old test compared a fixed 150px against the
      // anchor x, which let two long names on nearby rows both draw.
      const clashes = taken.some(
        (t) => Math.abs(t.y - y) < 12 && x < t.x + t.w && t.x < x + w,
      );
      if (!clashes) {
        taken.push({ x, y, w });
        labelledGroups.add(g);
      }
    }
  }

  /**
   * One array's ink.
   *
   * `mode` is the whole difference. "box" paints a zone, "entry" paints the
   * one the limit rests in, and "edge" marks where a tighter array's boundary
   * falls INSIDE a zone that is already painted — no second fill, no second
   * border, no second label. That third mode is what stops a 15m FVG inside a
   * 1H OB from reading as two trades instead of one.
   */
  const arrayInk = (a: SmcArray, mode: "box" | "edge" | "entry", key: string) => {
    const y = scale.y(a.top);
    const h = Math.max(1.5, scale.y(a.bottom) - y);
    const x0 = xStart(a.t);
    const w = PAD_L + PLOT_W - x0;
    if (mode === "entry") {
      return (
        <g key={key}>
          <rect x={x0} y={y} width={w} height={h} fill="var(--color-primary)" opacity={0.3} />
          <rect
            x={x0}
            y={y}
            width={w}
            height={h}
            fill="none"
            stroke="var(--color-primary)"
            strokeWidth={1.5}
          />
        </g>
      );
    }
    // One box on this chart is the trade; the others are what is in the way.
    // Drawn at equal weight the eye cannot tell them apart, so everything
    // else is pushed back whenever an entry is on screen.
    const isPlanSide = plan == null || (plan.side === "long" ? "bull" : "bear") === a.side;
    const strong = a.state === "fresh" || a.state === "inverted";
    const edgeOpacity = (isPlanSide ? 0.7 : 0.4) * (entryDrawn ? 0.55 : 1);
    const dash = mode === "edge" ? "3 3" : undefined;
    return (
      <g key={key}>
        {mode === "box" && (
          <rect
            x={x0}
            y={y}
            width={w}
            height={h}
            fill={arrayFill(a)}
            opacity={(strong ? 0.18 : 0.09) * (isPlanSide ? 1 : 0.6) * (entryDrawn ? 0.5 : 1)}
          />
        )}
        <line
          x1={x0}
          x2={PAD_L + PLOT_W}
          y1={y}
          y2={y}
          stroke={arrayFill(a)}
          strokeWidth={0.75}
          strokeDasharray={dash}
          opacity={edgeOpacity}
        />
        <line
          x1={x0}
          x2={PAD_L + PLOT_W}
          y1={y + h}
          y2={y + h}
          stroke={arrayFill(a)}
          strokeWidth={0.75}
          strokeDasharray={dash}
          opacity={edgeOpacity}
        />
      </g>
    );
  };

  const ariaLabel = plan
    ? `${plan.symbol} ${plan.side} — entry ${plan.entry}, stop ${plan.stop}${plan.t1 != null ? `, target ${plan.t1}` : ""}`
    : overlay
      ? `${overlay.symbol} ${overlay.word} — ${overlay.pools.length} liquidity pools, ${overlay.arrays.length} arrays${draw ? `, draw ${draw.name} ${draw.price}` : ""}`
      : "Setup chart, no plan priced";

  return (
    <figure className={`panel overflow-hidden ${className ?? ""}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={ariaLabel}>
        {/* ── Dealing range: the rail at the edge, EQ across the plot ─────── */}
        {range && <RangeRail range={range} scale={scale} />}

        {/* ── R as a SHAPE: risk block, reward block, 1R steps ─────────────── */}
        {plan && <RiskRail plan={plan} scale={scale} />}

        {/* ── Time structure: the session bells, behind everything ─────────── */}
        {timeStructure.marks.map((m) => {
          const x = scale.x(m.i) - scale.step / 2;
          // At the BOTTOM, where a time axis belongs and where buildScale's 6%
          // padding leaves ~18px of clear canvas under the lowest wick. The
          // first try put these at the top and every one of them landed under
          // the opaque corner badge, because a window that starts at the open
          // puts all three bells in the first hundred pixels.
          //
          // The one thing down there is the replay's "decision → what
          // followed" caption, so a stamp that would land in it is dropped:
          // the line still carries the boundary, and two texts in one place is
          // the collision this chart was pruned of.
          const captionAt = replayEdge;
          const clash = captionAt != null && x > captionAt - 34 && x < captionAt + 120;
          const row = timeLabelRow.get(m.i);
          return (
            <g key={`t-${m.i}`}>
              <line
                x1={x}
                x2={x}
                y1={PAD_T}
                y2={PAD_T + PLOT_H}
                stroke="var(--color-muted)"
                strokeWidth={0.5}
                strokeDasharray="2 5"
                opacity={0.35}
              />
              {!clash && row != null && (
                <text
                  x={x + 2}
                  y={PAD_T + PLOT_H - 3 - row * 8}
                  fill="var(--color-muted)"
                  fontSize={7.5}
                  opacity={0.65}
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {m.label}
                </text>
              )}
            </g>
          );
        })}

        {/* ── Risk and reward bands, so R is a SIZE and not a number ───────── */}
        {plan && (
          <>
            <rect
              x={PAD_L}
              y={scale.y(long ? plan.entry : plan.stop)}
              width={PLOT_W}
              height={Math.abs(scale.y(plan.stop) - scale.y(plan.entry))}
              fill="var(--color-down)"
              opacity={0.12}
            />
            {plan.t1 != null && (
              <rect
                x={PAD_L}
                y={scale.y(long ? plan.t1 : plan.entry)}
                width={PLOT_W}
                height={Math.abs(scale.y(plan.t1) - scale.y(plan.entry))}
                fill="var(--color-up)"
                opacity={0.1}
              />
            )}
          </>
        )}

        {/* ── PD arrays: one object per containment group, extended right ──── */}
        {arrayGroups.map((g) => {
          const key = `${g.outer.kind}-${g.outer.tf}-${g.outer.t}-${g.outer.top}`;
          const isEntry = g.entry != null;
          const anchor = groupLabelAnchor(g);
          const y = scale.y(anchor.top);
          const x0 = xStart(anchor.t);
          const name = groupName(g, g.entry);
          // Same measurement the collision pass used, so what was tested is
          // what is drawn.
          const labelX = groupLabelX(g, name);
          const labelW = plateWidth(name, isEntry);
          return (
            <g key={key}>
              {arrayInk(
                g.outer,
                g.entry === g.outer ? "entry" : filledGroups.has(g) ? "box" : "edge",
                `${key}-o`,
              )}
              {g.inner.map((b, n) =>
                arrayInk(b, b === g.entry ? "entry" : "edge", `${key}-i${n}`),
              )}
              {labelledGroups.has(g) && (
                // At the box's origin, where the candles are already history,
                // not at the right edge where the live bars are. A plate
                // keeps it legible over the wicks it does cover.
                <g>
                  <rect
                    x={labelX}
                    y={y + 1}
                    width={labelW}
                    height={isEntry ? 10 : 9}
                    rx={2}
                    fill="var(--color-bg)"
                    // Opaque enough to read over a wick. The old 0.6 let
                    // candle bodies show through the letters.
                    opacity={isEntry ? 0.92 : 0.82}
                  />
                  <text
                    x={labelX + 2}
                    y={isEntry ? y + 8.5 : y + 8}
                    // 7.5px at 400 weight over candles was legible on a
                    // monitor and not on the phone the trader actually reads
                    // this on. A non-entry name still has to be READ — it is
                    // what is in the way of the trade — so it gets a real
                    // size and a medium weight, and stays distinguishable
                    // from the entry by colour and weight rather than by
                    // being too small to see.
                    fill={isEntry ? "var(--color-primary)" : "var(--color-fg)"}
                    fontSize={isEntry ? 8.5 : 8}
                    fontWeight={isEntry ? 700 : 500}
                    opacity={isEntry ? 1 : entryDrawn ? 0.82 : 1}
                    style={{ textTransform: "uppercase" }}
                  >
                    {name}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Liquidity pools: the lines a trader draws first ──────────────── */}
        {/* A swept pool is spent. The stops that rested there are gone, and
            the only thing it still explains is the raid that took them — so
            it goes to a thin, widely-dashed ghost rather than a solid line
            0.35 bright, which at a glance was still competing with liquidity
            that is actually live. Live external > live internal > history. */}
        {visiblePools.map((p) => (
          <line
            key={`pool-${p.side}-${p.price}`}
            x1={PAD_L}
            x2={PAD_L + PLOT_W}
            y1={scale.y(p.price)}
            y2={scale.y(p.price)}
            stroke={poolColor(p)}
            strokeWidth={p.swept ? 0.7 : p.scope === "external" ? 1.2 : 0.8}
            strokeDasharray={p.swept ? "2 6" : p.scope === "external" ? undefined : "4 3"}
            opacity={p.swept ? 0.22 : p.scope === "external" ? 0.85 : 0.6}
          />
        ))}

        {/* ── Structure: MSS / BOS at the level, displacement on the bar ───── */}
        {(overlay?.structure ?? [])
          .filter((s) => s.price >= scale.lo && s.price <= scale.hi)
          .map((s) => {
            const i = idxOf(s.t);
            const x = scale.x(i);
            const y = scale.y(s.price);
            const up = s.side === "bull";
            if (s.kind === "displacement") {
              const bar = view[i]!;
              const cy = scale.y(up ? bar.l : bar.h) + (up ? 8 : -8);
              return (
                <path
                  key={`disp-${s.t}`}
                  d={up ? `M${x - 3.5},${cy + 3} L${x + 3.5},${cy + 3} L${x},${cy - 3} Z` : `M${x - 3.5},${cy - 3} L${x + 3.5},${cy - 3} L${x},${cy + 3} Z`}
                  fill="var(--color-warn)"
                  opacity={0.9}
                />
              );
            }
            const color = s.kind === "mss" ? "var(--color-primary)" : "var(--color-fg)";
            return (
              <g key={`${s.kind}-${s.t}`}>
                <line
                  x1={Math.max(PAD_L, x - scale.step * 4)}
                  x2={Math.min(PAD_L + PLOT_W, x + scale.step * 2)}
                  y1={y}
                  y2={y}
                  stroke={color}
                  strokeWidth={1}
                  opacity={0.8}
                />
                <text
                  // Right of the segment normally; left of it when the break
                  // is on the newest bars, so it never sits on the live candle.
                  x={x > PAD_L + PLOT_W * 0.85 ? Math.max(PAD_L, x - scale.step * 4) - 2 : Math.min(PAD_L + PLOT_W - 24, x + scale.step * 2 + 2)}
                  textAnchor={x > PAD_L + PLOT_W * 0.85 ? "end" : "start"}
                  y={Math.min(PAD_T + PLOT_H - TIME_AXIS_H, Math.max(PAD_T + 9, y + (up ? -2 : 8)))}
                  fill={color}
                  fontSize={8}
                  fontWeight={600}
                  opacity={0.9}
                >
                  {s.kind.toUpperCase()} {up ? "↑" : "↓"}
                </text>
              </g>
            );
          })}

        {/* ── Candles ──────────────────────────────────────────────────────── */}
        {/* Bars outside a trade window are pushed back rather than annotated.
            The tradeable stretch of the day is then the bright part of the
            chart, which needs no copy and costs no ink — the window comes
            from sessions.ts (London / NY AM / NY PM), the same clock the HUD
            and the gates read. */}
        {view.map((b, i) => {
          const x = scale.x(i);
          const up = b.c >= b.o;
          const color = up ? "var(--color-up)" : "var(--color-down)";
          const bodyTop = scale.y(Math.max(b.o, b.c));
          const bodyH = Math.max(1, scale.y(Math.min(b.o, b.c)) - bodyTop);
          const bw = Math.max(1.5, scale.step * 0.6);
          const dim = timeStructure.dimOutside && timeStructure.inWindow[i] === false;
          return (
            <g key={b.t} opacity={dim ? KZ_OFF : KZ_ON}>
              <line x1={x} x2={x} y1={scale.y(b.h)} y2={scale.y(b.l)} stroke={color} strokeWidth={1} />
              <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} />
            </g>
          );
        })}

        {/* ── Replay: the decision bar, and the future to its right ─────────── */}
        {/* Drawn AFTER the candles, not before. The dimming rect used to be
            painted first, so every candle it was meant to push back was then
            drawn over it at full strength and the "future" read exactly as
            bright as the history. */}
        {decisionInView != null && decisionInView >= 0 && decisionInView < view.length && (() => {
          const edge = replayEdge;
          const cx = scale.x(decisionInView);
          const floor = PAD_T + PLOT_H;
          const yLow = scale.y(view[decisionInView]!.l);
          return (
            <g>
              {edge != null && (
                <>
                  <rect
                    x={edge}
                    y={PAD_T}
                    width={PAD_L + PLOT_W - edge}
                    height={PLOT_H}
                    fill="var(--color-bg)"
                    opacity={0.35}
                  />
                  <line
                    x1={edge}
                    x2={edge}
                    y1={PAD_T}
                    y2={floor}
                    stroke="var(--color-fg)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.6}
                  />
                  <text x={edge + 4} y={floor - 4} fill="var(--color-fg)" fontSize={9} opacity={0.7}>
                    decision → what followed
                  </text>
                </>
              )}
              {/* The bar ITSELF, not just the boundary beside it. A divider
                  says where the future starts; reviewing an entry needs the
                  candle the call was made on, and on a replay whose decision
                  bar is the newest bar there was no divider at all. */}
              <line
                x1={cx}
                x2={cx}
                y1={Math.min(yLow + 3, floor - 9)}
                y2={floor - 8}
                stroke="var(--color-fg)"
                strokeWidth={0.75}
                strokeDasharray="1 2"
                opacity={0.7}
              />
              <path
                d={`M${cx - 4},${floor - 1} L${cx + 4},${floor - 1} L${cx},${floor - 8} Z`}
                fill="var(--color-fg)"
                opacity={0.85}
              />
            </g>
          );
        })()}

        {/* ── The raid: the wick THROUGH the level, not a ring near it ─────── */}
        {sweep && sweepIdx >= 0 && sweep.price >= scale.lo && sweep.price <= scale.hi && (() => {
          const cx = scale.x(sweepIdx);
          const yExt = scale.y(sweep.price);
          const half = Math.max(2.5, scale.step * 1.15);
          // The excursion is the raid. A circle at the extreme says "something
          // happened here"; the wick crossing the level and closing back
          // inside is the thing a trader is actually looking for, and it is
          // the difference between a sweep and a breakout. Drawn only when
          // the level is known AND the extreme is genuinely beyond it on the
          // right side — a "raid" whose extreme did not clear the level is a
          // data disagreement, and this chart draws nothing rather than
          // resolving one in pixels.
          const lv = sweep.level;
          const level =
            lv != null &&
            Number.isFinite(lv) &&
            lv >= scale.lo &&
            lv <= scale.hi &&
            (sweep.above ? sweep.price > lv : sweep.price < lv)
              ? lv
              : null;
          const yLevel = level != null ? scale.y(level) : null;
          const through = level != null ? Math.abs(sweep.price - level) : null;
          // Near the right edge the label runs into the gutter, so it flips
          // to the other side of the wick — the same trick the structure
          // labels use.
          const flip = cx > PAD_L + PLOT_W * 0.72;
          const ty = Math.min(
            PAD_T + PLOT_H - TIME_AXIS_H,
            Math.max(PAD_T + 9, yExt + (sweep.above ? 14 : -9)),
          );
          const raidText = `raid ${sweep.price.toFixed(2)}${through != null ? ` · ${through.toFixed(2)}pt through` : ""}`;
          const raidLabelW = raidText.length * 4.9;
          return (
            <g>
              {yLevel != null ? (
                <>
                  <line
                    x1={Math.max(PAD_L, cx - scale.step * 5)}
                    x2={Math.min(PAD_L + PLOT_W, cx + scale.step * 3)}
                    y1={yLevel}
                    y2={yLevel}
                    stroke="var(--color-warn)"
                    strokeWidth={1}
                    strokeDasharray="3 3"
                    opacity={0.75}
                  />
                  <rect
                    x={cx - half}
                    y={Math.min(yLevel, yExt)}
                    width={half * 2}
                    height={Math.max(1.5, Math.abs(yExt - yLevel))}
                    fill="var(--color-warn)"
                    opacity={0.24}
                  />
                  <line
                    x1={cx}
                    x2={cx}
                    y1={yLevel}
                    y2={yExt}
                    stroke="var(--color-warn)"
                    strokeWidth={2.25}
                    opacity={0.95}
                  />
                  <line
                    x1={cx - half}
                    x2={cx + half}
                    y1={yExt}
                    y2={yExt}
                    stroke="var(--color-warn)"
                    strokeWidth={1.5}
                  />
                </>
              ) : (
                // No level measured for this raid — the ring marks the
                // extreme and nothing claims what it went through.
                <circle
                  cx={cx}
                  cy={yExt}
                  r={3.5}
                  fill="none"
                  stroke="var(--color-warn)"
                  strokeWidth={1.5}
                />
              )}
              {/* A plate under the raid text. It renders after the array
                  labels and so draws over them; without a backing the two
                  strings interleaved into one unreadable line. */}
              <rect
                x={flip ? cx - 6 - raidLabelW : cx + 4}
                y={ty - 8}
                width={raidLabelW + 4}
                height={11}
                rx={2}
                fill="var(--color-bg)"
                opacity={0.85}
              />
              <text
                x={flip ? cx - 6 : cx + 6}
                textAnchor={flip ? "end" : "start"}
                // A buyside raid is the HIGH of the frame, so its label goes
                // BELOW the wick or it clips the top edge; a sellside raid is
                // the low, so its label goes above.
                y={ty}
                fill="var(--color-warn)"
                fontSize={9}
                fontWeight={500}
              >
                raid {sweep.price.toFixed(2)}
                {through != null ? ` · ${through.toFixed(2)}pt through` : ""}
              </text>
            </g>
          );
        })()}

        {/* ── Draw on liquidity ────────────────────────────────────────────── */}
        {draw && drawVisible && (
          <line
            x1={PAD_L}
            x2={PAD_L + PLOT_W}
            y1={scale.y(draw.price)}
            y2={scale.y(draw.price)}
            stroke="var(--color-up)"
            strokeWidth={1.25}
            strokeDasharray="6 3"
            opacity={0.9}
          />
        )}
        {draw && !drawVisible && (
          <g>
            <rect
              x={PAD_L + PLOT_W - 178}
              y={draw.price > scale.hi ? PAD_T + 2 : PAD_T + PLOT_H - 15}
              width={176}
              height={13}
              rx={3}
              fill="var(--color-bg)"
              opacity={0.9}
            />
            <text
              x={PAD_L + PLOT_W - 4}
              y={draw.price > scale.hi ? PAD_T + 12 : PAD_T + PLOT_H - 5}
              textAnchor="end"
              fill="var(--color-up)"
              fontSize={9}
              fontWeight={600}
            >
              {draw.price > scale.hi ? "▲" : "▼"} DOL {draw.name} {draw.price.toFixed(2)} (
              {draw.price > lastClose ? "+" : ""}
              {(draw.price - lastClose).toFixed(0)})
            </text>
          </g>
        )}

        {/* ── Entry zone and the plan lines ────────────────────────────────── */}
        {plan && (
          <>
            {/* Only when the entry array is NOT among the drawn boxes. When
                it is, that box is already the loud teal one from the bar that
                made it; painting this full-width band over it doubles the
                tint and hides where the array actually starts. */}
            {plan.entryZone && !entryDrawn && (
              <rect
                x={PAD_L}
                y={scale.y(plan.entryZone.top)}
                width={PLOT_W}
                height={Math.max(2, scale.y(plan.entryZone.bottom) - scale.y(plan.entryZone.top))}
                fill="var(--color-primary)"
                opacity={0.22}
              />
            )}
            <PlanLine y={scale.y(plan.entry)} color="var(--color-primary)" dash="5 3" />
            <PlanLine y={scale.y(plan.stop)} color="var(--color-down)" />
            {plan.t1 != null && <PlanLine y={scale.y(plan.t1)} color="var(--color-up)" dash="5 3" />}
            {plan.t2 != null && <PlanLine y={scale.y(plan.t2)} color="var(--color-up)" dash="2 4" />}
            <PlanLine y={scale.y(plan.price)} color="var(--color-fg)" dash="1 3" />
          </>
        )}
        {!plan && overlay && (
          <PlanLine y={scale.y(lastClose)} color="var(--color-fg)" dash="1 3" />
        )}

        {/* ── Price gutter: the price, its name, and a tick to its line ────── */}
        {/* Only levels that matter — not a grid. One row per level, so the
            names of the plan, the draw and the pools all read down a single
            column instead of being scattered across the candles. */}
        {gutter.map((l) => {
          const y = scale.y(l.p);
          return (
            <g key={`${l.t}-${l.p}`} opacity={l.dim ? 0.5 : 1}>
              <line
                x1={PAD_L + PLOT_W}
                x2={GUTTER_X - 3}
                y1={y}
                y2={y}
                stroke={l.c}
                strokeWidth={0.75}
                opacity={0.6}
              />
              <text
                x={GUTTER_X}
                y={y + 3.2}
                fill={l.c}
                fontSize={9.5}
                fontWeight={600}
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {l.p.toFixed(2)}
              </text>
              <text
                x={W - 4}
                y={y + 3.2}
                textAnchor="end"
                fill={l.c}
                fontSize={7.5}
                opacity={0.8}
                style={{ textTransform: "uppercase" }}
              >
                {fitName(l.t)}
              </text>
            </g>
          );
        })}

        {/* ── Corner badge ─────────────────────────────────────────────────── */}
        {(plan || overlay) && (
          <g>
            {/* Backing plate: the badge sits over the risk band, and coloured
                text on a coloured band is unreadable at 10px. */}
            <rect
              x={PAD_L}
              y={PAD_T - 1}
              width={badgeWidth(symbol, side, badgeWord, plan?.riskOverCap ?? false)}
              height={14}
              rx={3}
              fill="var(--color-bg)"
              opacity={0.92}
            />
            <text x={PAD_L + 4} y={PAD_T + 9} fill="var(--color-fg)" fontSize={10} fontWeight={600}>
              {symbol}
              {side ? ` ${side.toUpperCase()}` : ""}
              {badgeWord ? ` · ${badgeWord}` : ""}
            </text>
            {plan?.riskOverCap && (
              <text x={PAD_L + 4} y={PAD_T + 23} fill="var(--color-down)" fontSize={9} fontWeight={600}>
                RISK OVER CAP
              </text>
            )}
          </g>
        )}

        {/* ── Time footer ──────────────────────────────────────────────────── */}
        <text x={PAD_L} y={H - 6} fill="var(--color-subtle)" fontSize={9}>
          {etStamp(firstT)}
        </text>
        <text x={PAD_L + PLOT_W} y={H - 6} textAnchor="end" fill="var(--color-subtle)" fontSize={9}>
          {etStamp(lastT)} ET
        </text>
      </svg>

      {!plan && !hideEmptyCaption && (
        <figcaption className="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span className="text-[var(--color-warn)]">No plan priced yet.</span>{" "}
          {emptyDetail ?? "Waiting on the sequence — nothing to draw."}
        </figcaption>
      )}
    </figure>
  );
}

/**
 * Premium and discount as a rail, not a wash.
 *
 * Two full-width rects at 0.05 tinted two thirds of the frame red, and a
 * trader ends up judging premium by how red the screen looks instead of by
 * where price sits against EQ — which is what premium and discount actually
 * are. The rail carries the same two facts (the halves, and their extent) in
 * nine pixels at the edge, and the EQ line carries the one that decides the
 * side, so both are legible without competing with the candles.
 */
function RangeRail({
  range,
  scale,
}: {
  range: { high: number; low: number; eq: number };
  scale: Scale;
}) {
  const clamp = (y: number) => Math.min(PAD_T + PLOT_H, Math.max(PAD_T, y));
  const yHigh = clamp(scale.y(range.high));
  const yEq = clamp(scale.y(range.eq));
  const yLow = clamp(scale.y(range.low));
  const bands = [
    { top: yHigh, bottom: yEq, color: "var(--color-down)", name: "PREMIUM" },
    { top: yEq, bottom: yLow, color: "var(--color-up)", name: "DISCOUNT" },
  ];
  const cx = RAIL_X + RAIL_W / 2;
  return (
    <g>
      {bands.map((b) => {
        const h = b.bottom - b.top;
        if (!(h > 0)) return null;
        const cy = b.top + h / 2;
        return (
          <g key={b.name}>
            <rect x={RAIL_X} y={b.top} width={RAIL_W} height={h} rx={1.5} fill={b.color} opacity={0.22} />
            {h >= RAIL_LABEL_MIN_H && (
              <text
                x={cx}
                y={cy}
                transform={`rotate(-90 ${cx} ${cy})`}
                textAnchor="middle"
                dominantBaseline="middle"
                fill={b.color}
                fontSize={6.5}
                fontWeight={700}
                letterSpacing={0.6}
                opacity={0.95}
              >
                {b.name}
              </text>
            )}
          </g>
        );
      })}
      {range.eq >= scale.lo && range.eq <= scale.hi && (
        <line
          x1={PAD_L}
          x2={PAD_L + PLOT_W}
          y1={scale.y(range.eq)}
          y2={scale.y(range.eq)}
          stroke="var(--color-muted)"
          strokeWidth={1}
          strokeDasharray="7 5"
          opacity={0.6}
        />
      )}
    </g>
  );
}

/**
 * R as a shape, in its own column.
 *
 * WHY THIS EXISTS
 * The plan lines already put entry, stop and the targets on the chart, and the
 * gutter already prints "T1 0.6R". Both are numbers, and a number is read
 * after the decision has already started forming. What the eye decides on is
 * SIZE: the risk block is 1R by construction, the reward block is drawn to
 * scale beside it, and the step marks repeat the risk block's own height up
 * the page. A 0.55R plan is then a stub next to a tall red block that does not
 * reach the first step, and a 2R plan is twice the block — no reading
 * required. The desk took a 0.55R plan this week with all three lines on
 * screen, which is what a chart with no measure column looks like.
 *
 * WHAT IT REFUSES
 * A stop at entry has no R: the denominator is zero, so nothing is drawn
 * rather than a rail scaled off a made-up risk. A target the plan did not
 * price is not a zero-reward block, it is no block. And it never re-derives
 * R — rr1/rr2 come from trade-plan.ts, so the shape and the number beside it
 * cannot disagree.
 */
function RiskRail({ plan, scale }: { plan: TradePlan; scale: Scale }) {
  const clamp = (y: number) => Math.min(PAD_T + PLOT_H, Math.max(PAD_T, y));
  const yEntry = scale.y(plan.entry);
  const yStop = scale.y(plan.stop);
  const riskPx = Math.abs(yStop - yEntry);
  if (!Number.isFinite(riskPx) || riskPx < 0.5) return null;

  const cx = R_RAIL_X + R_RAIL_W / 2;
  const block = (a: number, b: number, fill: string, opacity: number, key: string, label?: string) => {
    const top = clamp(Math.min(a, b));
    const bottom = clamp(Math.max(a, b));
    const h = bottom - top;
    if (!(h > 0)) return null;
    const cy = top + h / 2;
    return (
      <g key={key}>
        <rect x={R_RAIL_X} y={top} width={R_RAIL_W} height={h} rx={1.5} fill={fill} opacity={opacity} />
        {label && h >= R_LABEL_MIN_H && (
          <text
            x={cx}
            y={cy}
            transform={`rotate(-90 ${cx} ${cy})`}
            textAnchor="middle"
            dominantBaseline="middle"
            fill={fill}
            fontSize={6.5}
            fontWeight={700}
            letterSpacing={0.4}
            opacity={0.95}
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {label}
          </text>
        )}
      </g>
    );
  };

  // Sub-1R is a hard-gate failure (R:R ≥ 1:1, enforced by the smc-master
  // "target priced" must-layer), so the reward block wears the warning colour
  // instead of the win colour. This is a display rule reading the gate, never
  // a gate: the chart does not decide anything, it shows what was decided.
  const short1R = plan.rr1 != null && plan.rr1 < 1;
  const rTxt = (r: number | null) => (r == null ? undefined : rLabel(r));
  const yT1 = plan.t1 != null ? scale.y(plan.t1) : null;
  const yT2 = plan.t2 != null ? scale.y(plan.t2) : null;

  // Each step is one risk block further in the direction the trade is trying
  // to go, taken from where the STOP sits rather than from the side string —
  // the stop is always on the risk side, so the steps cannot end up pointing
  // away from the blocks they are measuring. Three is where a target stops
  // being a target and starts being a wish; past that the marks are only ink.
  const dir = yStop > yEntry ? -1 : 1;
  const steps: number[] = [];
  for (let k = 1; k <= 3; k++) {
    const y = yEntry + dir * riskPx * k;
    if (y >= PAD_T && y <= PAD_T + PLOT_H) steps.push(y);
  }

  return (
    <g>
      {/* A track the blocks sit in, so this column reads as a gauge and not
          as a second premium/discount rail — they are neighbours, and red
          beside red at the top of the frame otherwise merges into one bar. */}
      <rect
        x={R_RAIL_X}
        y={PAD_T}
        width={R_RAIL_W}
        height={PLOT_H}
        rx={1.5}
        fill="var(--color-muted)"
        opacity={0.07}
      />
      {block(yEntry, yStop, "var(--color-down)", 0.5, "risk", "1R")}
      {yT1 != null && block(yEntry, yT1, short1R ? "var(--color-warn)" : "var(--color-up)", 0.5, "t1", rTxt(plan.rr1))}
      {/* The runner's extra, drawn beyond T1 rather than over it — half the
          position is already off at T1, so the two are not the same reward. */}
      {yT2 != null && block(yT1 ?? yEntry, yT2, "var(--color-up)", 0.22, "t2", rTxt(plan.rr2))}
      {steps.map((y, k) => (
        <line
          key={`step-${k}`}
          x1={R_RAIL_X - 2}
          x2={R_RAIL_X + R_RAIL_W + 2}
          y1={y}
          y2={y}
          stroke="var(--color-muted)"
          strokeWidth={0.6}
          strokeDasharray="2 2"
          opacity={0.55}
        />
      ))}
      <line
        x1={R_RAIL_X - 2}
        x2={R_RAIL_X + R_RAIL_W + 2}
        y1={yEntry}
        y2={yEntry}
        stroke="var(--color-fg)"
        strokeWidth={1}
        opacity={0.8}
      />
    </g>
  );
}

/**
 * The gutter's name column is about fifteen characters wide at 7.5px.
 *
 * A longer name is cut rather than allowed to run past the frame: the price
 * beside it is the unambiguous half of the row, and a name bleeding off the
 * edge is the same overprinting this column was built to end.
 */
function fitName(s: string, max = 15): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function poolColor(p: OverlayPool): string {
  // Buy stops rest above highs: raiding them is the short's fuel, so the
  // line takes the down colour. Sell stops below lows take the up colour.
  return p.side === "buyside" ? "var(--color-down)" : "var(--color-up)";
}

/** External first, then unswept, then strength. First wins a label slot. */
function poolPriority(a: OverlayPool, b: OverlayPool): number {
  if (a.scope !== b.scope) return a.scope === "external" ? -1 : 1;
  if (a.swept !== b.swept) return a.swept ? 1 : -1;
  return b.strength - a.strength;
}

/** Rough text width for the badge plate — 10px semibold averages ~5.6px/char. */
function badgeWidth(
  symbol: string,
  side: string | null,
  word: string | undefined,
  overCap: boolean,
): number {
  const text = `${symbol}${side ? ` ${side.toUpperCase()}` : ""}${word ? ` · ${word}` : ""}`;
  return Math.max(overCap ? 86 : 0, text.length * 5.6 + 8);
}

function PlanLine({ y, color, dash }: { y: number; color: string; dash?: string }) {
  return (
    <line
      x1={PAD_L}
      x2={PAD_L + PLOT_W}
      y1={y}
      y2={y}
      stroke={color}
      strokeWidth={1.25}
      strokeDasharray={dash}
    />
  );
}

/**
 * Drop labels that would overlap.
 *
 * Two prices 0.3pt apart render on top of each other and produce an unreadable
 * smear exactly where the trader is looking hardest. Earlier entries win, and
 * the list is ordered by importance, so `live` and `entry` survive a collision
 * with a target rather than the other way round.
 */
function dedupeByY<T extends { p: number }>(items: T[], scale: Scale, gap: number): T[] {
  const kept: T[] = [];
  for (const it of items) {
    if (!Number.isFinite(it.p)) continue;
    const y = scale.y(it.p);
    if (kept.every((k) => Math.abs(scale.y(k.p) - y) >= gap)) kept.push(it);
  }
  return kept;
}

function etStamp(t: number): string {
  return new Date(t).toLocaleTimeString("en-US", {
    timeZone: "America/New_York",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
