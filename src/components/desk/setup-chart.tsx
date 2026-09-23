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
const PAD_L = 8;
const PAD_R = 74; // price gutter
const PAD_T = 12;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

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
 * Minimum vertical gap between two left-side labels before one is dropped.
 *
 * The chip is 10px tall around 8px text, so 11 left one pixel of daylight and
 * the labels read as a single smear — "BSL Range high" sitting on "BSL PDH"
 * sitting on the badge. A real SMC chart never stacks level names; it drops
 * the weaker one. 16 is the chip plus a clear gap.
 */
const LABEL_GAP = 16;
/**
 * The corner badge (symbol · side · word, plus RISK OVER CAP on a second row)
 * owns the top-left. Level labels that would land inside it are pushed right
 * of it rather than drawn underneath it.
 */
const BADGE_H = 16;
const BADGE_H_RISK = 30;
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

  /** Index in `view` of the bar containing time t; 0 if before the window. */
  const idxOf = (t: number): number => {
    if (t <= firstT) return 0;
    for (let i = view.length - 1; i >= 0; i--) if (view[i]!.t <= t) return i;
    return 0;
  };
  /** Left x of the bar containing t — where a box or line begins. */
  const xStart = (t: number | undefined): number =>
    t == null || t <= firstT ? PAD_L : scale.x(idxOf(t)) - scale.step / 2;
  const clampY = (y: number) => Math.min(PAD_T + PLOT_H, Math.max(PAD_T, y));

  // The raid: plan's sweep when priced, else the overlay's last sweep.
  const sweep =
    plan?.sweep?.t != null
      ? { price: plan.sweep.price, t: plan.sweep.t, above: !long }
      : overlay?.sweep
        ? { price: overlay.sweep.price, t: overlay.sweep.t, above: overlay.sweep.side === "buyside" }
        : null;
  const sweepIdx = sweep ? idxOf(sweep.t) : -1;

  // Draw on liquidity: in frame → a line; out of frame → an edge arrow.
  const draw = overlay?.draw ?? null;
  const drawVisible = draw != null && draw.price >= scale.lo && draw.price <= scale.hi;

  // ── Left-side labels, collision-resolved by priority ─────────────────────
  // Order matters: the first entry at a given height wins. Externals and the
  // draw are what a trader reads first, so they outrank internal pools.
  const leftLabels = dedupeByY(
    [
      ...(drawVisible && draw
        ? [
            {
              p: draw.price,
              c: "var(--color-up)",
              text: `DOL ${shortName(draw.name)} ${draw.price.toFixed(2)} · ${(draw.reachProbability * 100).toFixed(0)}%`,
              x: PAD_L + 3,
            },
          ]
        : []),
      ...(overlay?.pools ?? [])
        .filter((p) => p.price >= scale.lo && p.price <= scale.hi)
        .sort(poolPriority)
        .map((p) => ({
          p: p.price,
          c: poolColor(p),
          text: `${p.swept ? "✕ " : ""}${p.side === "buyside" ? "BSL" : "SSL"} ${shortName(p.label)}`,
          x: PAD_L + 3,
        })),
      ...(range
        ? [{ p: range.eq, c: "var(--color-muted)", text: `EQ ${range.eq.toFixed(2)}`, x: PAD_L + 3 }]
        : []),
    ],
    scale,
    LABEL_GAP,
  );

  // ── Right gutter: plan first, then the draw, then external pools ─────────
  const gutter = dedupeByY(
    [
      ...(plan
        ? [
            { p: plan.price, c: "var(--color-fg)", t: "live" },
            { p: plan.entry, c: "var(--color-primary)", t: "entry" },
            { p: plan.stop, c: "var(--color-down)", t: "stop" },
            ...(plan.t1 != null
              ? [{ p: plan.t1, c: "var(--color-up)", t: plan.rr1 != null ? `T1 ${plan.rr1.toFixed(1)}R` : "T1" }]
              : []),
            ...(plan.t2 != null
              ? [{ p: plan.t2, c: "var(--color-up)", t: plan.rr2 != null ? `T2 ${plan.rr2.toFixed(1)}R` : "T2" }]
              : []),
          ]
        : overlay
          ? [{ p: lastClose, c: "var(--color-fg)", t: "last" }]
          : []),
      ...(drawVisible && draw ? [{ p: draw.price, c: "var(--color-up)", t: "DOL" }] : []),
      ...(overlay?.pools ?? [])
        .filter((p) => p.scope === "external" && !p.swept && p.price >= scale.lo && p.price <= scale.hi)
        .map((p) => ({ p: p.price, c: poolColor(p), t: shortName(p.label) })),
    ],
    scale,
    16,
  );

  // Array labels sit at the top-left of each box, one per 9px of height at
  // a given origin; boxes that share a price band AND a start bar (a 15m FVG
  // inside a 1H OB) would otherwise print their names on top of each other.
  // Nearest-to-price wins the slot — the order chart-overlay.ts emits them.
  const arrayLabelSlots = new Set<SmcArray>();
  {
    const taken: { x: number; y: number }[] = [];
    for (const a of shownArrays) {
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
        {/* ── Dealing range: premium above EQ, discount below ─────────────── */}
        {range && (
          <>
            <rect
              x={PAD_L}
              y={clampY(scale.y(range.high))}
              width={PLOT_W}
              height={Math.max(0, clampY(scale.y(range.eq)) - clampY(scale.y(range.high)))}
              fill="var(--color-down)"
              opacity={0.05}
            />
            <rect
              x={PAD_L}
              y={clampY(scale.y(range.eq))}
              width={PLOT_W}
              height={Math.max(0, clampY(scale.y(range.low)) - clampY(scale.y(range.eq)))}
              fill="var(--color-up)"
              opacity={0.05}
            />
            {range.eq >= scale.lo && range.eq <= scale.hi && (
              <line
                x1={PAD_L}
                x2={PAD_L + PLOT_W}
                y1={scale.y(range.eq)}
                y2={scale.y(range.eq)}
                stroke="var(--color-subtle)"
                strokeWidth={1}
                strokeDasharray="1 5"
              />
            )}
          </>
        )}

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
          return (
            <g key={`${a.kind}-${a.tf}-${a.t}-${a.top}`}>
              <rect
                x={x0}
                y={y}
                width={PAD_L + PLOT_W - x0}
                height={h}
                fill={arrayFill(a)}
                opacity={(strong ? 0.18 : 0.09) * (isPlanSide ? 1 : 0.6)}
              />
              <line
                x1={x0}
                x2={PAD_L + PLOT_W}
                y1={y}
                y2={y}
                stroke={arrayFill(a)}
                strokeWidth={0.75}
                opacity={isPlanSide ? 0.7 : 0.4}
              />
              <line
                x1={x0}
                x2={PAD_L + PLOT_W}
                y1={y + h}
                y2={y + h}
                stroke={arrayFill(a)}
                strokeWidth={0.75}
                opacity={isPlanSide ? 0.7 : 0.4}
              />
              {labelled && (
                // At the box's origin, where the candles are already history,
                // not at the right edge where the live bars are. A plate
                // keeps it legible over the wicks it does cover.
                <g>
                  <rect
                    x={x0 + 1}
                    y={y + 1}
                    width={arrayName(a).length * 4.4 + 4}
                    height={9}
                    rx={2}
                    fill="var(--color-bg)"
                    opacity={0.6}
                  />
                  <text
                    x={x0 + 3}
                    y={y + 8}
                    fill="var(--color-muted)"
                    fontSize={7.5}
                    style={{ textTransform: "uppercase" }}
                  >
                    {arrayName(a)}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        {/* ── Liquidity pools: the lines a trader draws first ──────────────── */}
        {(overlay?.pools ?? [])
          .filter((p) => p.price >= scale.lo && p.price <= scale.hi)
          .map((p) => (
            <line
              key={`pool-${p.side}-${p.price}`}
              x1={PAD_L}
              x2={PAD_L + PLOT_W}
              y1={scale.y(p.price)}
              y2={scale.y(p.price)}
              stroke={poolColor(p)}
              strokeWidth={p.scope === "external" ? 1.2 : 0.8}
              strokeDasharray={p.scope === "external" ? undefined : "4 3"}
              opacity={p.swept ? 0.35 : p.scope === "external" ? 0.85 : 0.6}
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

        {/* ── The raid ─────────────────────────────────────────────────────── */}
        {sweep && sweepIdx >= 0 && sweep.price >= scale.lo && sweep.price <= scale.hi && (
          <g>
            <circle
              cx={scale.x(sweepIdx)}
              cy={scale.y(sweep.price)}
              r={3.5}
              fill="none"
              stroke="var(--color-warn)"
              strokeWidth={1.5}
            />
            <text
              x={scale.x(sweepIdx) + 6}
              // A buyside raid is the HIGH of the frame, so its label goes
              // BELOW the wick or it clips the top edge; a sellside raid is
              // the low, so its label goes above.
              y={scale.y(sweep.price) + (sweep.above ? 13 : -7)}
              fill="var(--color-warn)"
              fontSize={9}
              fontWeight={500}
            >
              raid {sweep.price.toFixed(2)}
            </text>
          </g>
        )}

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
            {plan.entryZone && (
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

        {/* ── Left labels (pools, draw, EQ) ────────────────────────────────── */}
        {leftLabels.map((l) => {
          // Above the line by default; below it when "above" would run into
          // the corner badge or off the top edge.
          const ly = scale.y(l.p);
          const badgeH = plan?.riskOverCap ? BADGE_H_RISK : BADGE_H;
          const below = ly - 10 < PAD_T + badgeH;
          const top = below ? ly + 1 : ly - 10;
          // Still inside the badge after flipping below it? Start the chip to
          // the RIGHT of the badge instead of painting over it. This is the
          // three-labels-on-one-corner case in the 2026-09-23 screenshot.
          const collides = top < PAD_T + badgeH;
          const lx = collides
            ? PAD_L + badgeWidth(symbol, side, badgeWord, plan?.riskOverCap ?? false) + 6
            : l.x;
          return (
            <g key={`ll-${l.text}-${l.p}`}>
              <rect
                x={lx - 1}
                y={top}
                width={l.text.length * 4.6 + 4}
                height={10}
                rx={2}
                fill="var(--color-bg)"
                opacity={0.75}
              />
              <text x={lx + 1} y={top + 8} fill={l.c} fontSize={8} fontWeight={600}>
                {l.text}
              </text>
            </g>
          );
        })}

        {/* ── Price gutter. Only levels that matter — not a grid ───────────── */}
        {gutter.map((l) => (
          <g key={`${l.t}-${l.p}`}>
            <text
              x={W - PAD_R + 6}
              y={scale.y(l.p) + 3}
              fill={l.c}
              fontSize={10}
              fontWeight={500}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {l.p.toFixed(2)}
            </text>
            <text
              x={W - PAD_R + 6}
              y={scale.y(l.p) + 13}
              fill={l.c}
              fontSize={8}
              opacity={0.7}
              style={{ textTransform: "uppercase" }}
            >
              {l.t}
            </text>
          </g>
        ))}

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
