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
 * still clutter.
 */

import { useMemo } from "react";
import type { OhlcBar } from "@/lib/market/types";
import type { TradePlan } from "@/lib/trading/trade-plan";
import type { SmcArray } from "@/lib/trading/smc-board";
import type { ChartOverlay, OverlayPool } from "@/lib/trading/chart-overlay";

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
const PAD_L = 18;
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
 * Pool and draw names from structure.ts carry a parenthetical class —
 * "PWH (external BSL)", "Swing low (internal SSL)" — that the line's own
 * colour and the BSL/SSL prefix already say. Strip it so the label is the
 * name a trader would write: "BSL PWH".
 */
function shortName(label: string): string {
  return label.replace(/\s*\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
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
              ? [{ p: plan.t1, c: "var(--color-up)", t: plan.rr1 != null ? `T1 ${plan.rr1.toFixed(1)}R` : "T1", dim: false }]
              : []),
            ...(plan.t2 != null
              ? [{ p: plan.t2, c: "var(--color-up)", t: plan.rr2 != null ? `T2 ${plan.rr2.toFixed(1)}R` : "T2", dim: false }]
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

  // Array labels sit at the top-left of each box, one per 9px of height at
  // a given origin; boxes that share a price band AND a start bar (a 15m FVG
  // inside a 1H OB) would otherwise print their names on top of each other.
  // The entry array takes the slot ahead of everything else — it is the only
  // box whose name changes what the trader does — and nearest-to-price wins
  // the rest, the order chart-overlay.ts emits them in.
  const arrayLabelSlots = new Set<SmcArray>();
  {
    const taken: { x: number; y: number }[] = [];
    const byImportance = entryDrawn
      ? [...shownArrays].sort((a, b) => Number(isEntryArray(b)) - Number(isEntryArray(a)))
      : shownArrays;
    for (const a of byImportance) {
      const y = scale.y(a.top);
      const x = xStart(a.t);
      // 9px against 8px text meant two names one pixel apart counted as
      // "resolved". 16 is the line box; 150 is roughly the widest name.
      if (taken.every((t) => Math.abs(t.y - y) >= 16 || Math.abs(t.x - x) >= 150)) {
        taken.push({ x, y });
        arrayLabelSlots.add(a);
      }
    }
  }

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

        {/* ── PD arrays: a box from the bar that made it, extended right ───── */}
        {shownArrays.map((a) => {
          const y = scale.y(a.top);
          const h = Math.max(1.5, scale.y(a.bottom) - y);
          const x0 = xStart(a.t);
          const isPlanSide = plan == null || (plan.side === "long" ? "bull" : "bear") === a.side;
          const strong = a.state === "fresh" || a.state === "inverted";
          const labelled = arrayLabelSlots.has(a);
          const isEntry = isEntryArray(a);
          // One box on this chart is the trade; the others are what is in the
          // way. Drawn at equal weight the eye cannot tell them apart, so the
          // entry takes the plan's own colour at full strength and everything
          // else is pushed back behind it whenever an entry is on screen.
          const context = (strong ? 0.18 : 0.09) * (isPlanSide ? 1 : 0.6) * (entryDrawn ? 0.5 : 1);
          const edgeOpacity = (isPlanSide ? 0.7 : 0.4) * (entryDrawn ? 0.55 : 1);
          const name = isEntry ? `ENTRY ${arrayName(a)}` : arrayName(a);
          return (
            <g key={`${a.kind}-${a.tf}-${a.t}-${a.top}`}>
              <rect
                x={x0}
                y={y}
                width={PAD_L + PLOT_W - x0}
                height={h}
                fill={isEntry ? "var(--color-primary)" : arrayFill(a)}
                opacity={isEntry ? 0.3 : context}
              />
              {isEntry ? (
                <rect
                  x={x0}
                  y={y}
                  width={PAD_L + PLOT_W - x0}
                  height={h}
                  fill="none"
                  stroke="var(--color-primary)"
                  strokeWidth={1.5}
                />
              ) : (
                <>
                  <line
                    x1={x0}
                    x2={PAD_L + PLOT_W}
                    y1={y}
                    y2={y}
                    stroke={arrayFill(a)}
                    strokeWidth={0.75}
                    opacity={edgeOpacity}
                  />
                  <line
                    x1={x0}
                    x2={PAD_L + PLOT_W}
                    y1={y + h}
                    y2={y + h}
                    stroke={arrayFill(a)}
                    strokeWidth={0.75}
                    opacity={edgeOpacity}
                  />
                </>
              )}
              {labelled && (
                // At the box's origin, where the candles are already history,
                // not at the right edge where the live bars are. A plate
                // keeps it legible over the wicks it does cover.
                <g>
                  <rect
                    x={x0 + 1}
                    y={y + 1}
                    width={name.length * (isEntry ? 4.9 : 4.4) + 4}
                    height={isEntry ? 10 : 9}
                    rx={2}
                    fill="var(--color-bg)"
                    opacity={isEntry ? 0.85 : 0.6}
                  />
                  <text
                    x={x0 + 3}
                    y={isEntry ? y + 8.5 : y + 8}
                    fill={isEntry ? "var(--color-primary)" : "var(--color-muted)"}
                    fontSize={isEntry ? 8.5 : 7.5}
                    fontWeight={isEntry ? 700 : 400}
                    opacity={isEntry ? 1 : entryDrawn ? 0.7 : 1}
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
                  y={Math.min(PAD_T + PLOT_H - 2, Math.max(PAD_T + 9, y + (up ? -2 : 8)))}
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

        {/* ── Replay: the decision bar and the future to its right ─────────── */}
        {decisionInView != null && decisionInView >= 0 && decisionInView < view.length - 1 && (
          <>
            <rect
              x={scale.x(decisionInView) + scale.step / 2}
              y={PAD_T}
              width={PAD_L + PLOT_W - (scale.x(decisionInView) + scale.step / 2)}
              height={PLOT_H}
              fill="var(--color-bg)"
              opacity={0.35}
            />
            <line
              x1={scale.x(decisionInView) + scale.step / 2}
              x2={scale.x(decisionInView) + scale.step / 2}
              y1={PAD_T}
              y2={PAD_T + PLOT_H}
              stroke="var(--color-fg)"
              strokeWidth={1}
              strokeDasharray="3 3"
              opacity={0.6}
            />
            <text
              x={scale.x(decisionInView) + scale.step / 2 + 4}
              y={PAD_T + PLOT_H - 4}
              fill="var(--color-fg)"
              fontSize={9}
              opacity={0.7}
            >
              decision → what followed
            </text>
          </>
        )}

        {/* ── Candles ──────────────────────────────────────────────────────── */}
        {view.map((b, i) => {
          const x = scale.x(i);
          const up = b.c >= b.o;
          const color = up ? "var(--color-up)" : "var(--color-down)";
          const bodyTop = scale.y(Math.max(b.o, b.c));
          const bodyH = Math.max(1, scale.y(Math.min(b.o, b.c)) - bodyTop);
          const bw = Math.max(1.5, scale.step * 0.6);
          return (
            <g key={b.t} opacity={0.92}>
              <line x1={x} x2={x} y1={scale.y(b.h)} y2={scale.y(b.l)} stroke={color} strokeWidth={1} />
              <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} />
            </g>
          );
        })}

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
            PAD_T + PLOT_H - 3,
            Math.max(PAD_T + 9, yExt + (sweep.above ? 14 : -9)),
          );
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
