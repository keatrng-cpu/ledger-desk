/**
 * The setup, marked on the card that proposes it.
 *
 * WHY A SECOND, SMALLER CHART EXISTS
 * `setup-chart.tsx` draws ONE book — the one `smcMaster.oneBook` settled on —
 * and it sits far above the scanner. So the trader reads "ES SHORT 0.95" on
 * one card and "MNQ LONG 0.94" on the next with nothing drawn against either
 * of them, and then scrolls up to a picture of whichever book the desk
 * happened to pick. Two setups need two markups, beside the two cards that
 * propose them, or the picture is describing a different trade than the score
 * next to it.
 *
 * WHY IT IS DRAWN FROM `anticipate()` AND NOT FROM A PLAN
 * A plan exists only once the sequence has priced one, which is exactly the
 * moment a markup stops being useful and starts being a record. An SMC trader
 * marks the pool, the raid, the displacement and the entry array BEFORE any of
 * them print, and confirms them one at a time. That is what `SetupAnticipation`
 * carries, and this file is the only place it becomes pixels.
 *
 * THE ONE THING THIS COMPONENT REFUSES TO BLUR
 * PRINTED is solid. AWAITED is dashed and dimmer. DEAD is crossed. If those
 * three ever render alike, the chart is telling the trader a setup exists when
 * three fifths of it is still a hope — which is the desk's measured failure
 * mode, not a cosmetic issue. The same rule governs the flash: bright green
 * fires only at `entry === "live"`, meaning every must has printed AND price is
 * in the array right now. An ARMED card gets a calm steady ring and nothing
 * else, because "nearly" must look nothing like "now".
 *
 * WHAT IS DELIBERATELY NOT DRAWN
 * No PD array boxes, no structure breaks, no pools beyond the anticipated ones,
 * no session bells, no time axis. At 340x170 those are ink, not information —
 * the big chart carries them. And a mark whose price sits more than
 * `OUT_OF_FRAME_SPANS` of the visible band outside it is NOT squeezed into
 * frame: forty candles flattened to a ribbon so an 8 ATR target can share the
 * axis is a worse chart than one saying the target is off screen and by how
 * much.
 */

import { memo, useMemo } from "react";
import type { OhlcBar } from "@/lib/market/types";
import type {
  AnticipatedMark,
  MarkKind,
  SetupAnticipation,
  StepState,
} from "@/lib/trading/setup-anticipation";
import {
  TF_MARKS,
  TF_VISIBLE_BARS,
  marksFor,
  showsContext,
  type ChartTf,
} from "@/lib/trading/chart-timeframes";
import type { ScoreDriver } from "@/lib/trading/score-drivers";
import { cn } from "@/lib/utils";

const W = 340;
const H = 170;
const PAD_L = 4;
/** The gutter: one short name per mark, right-aligned against the frame. */
const PAD_R = 70;
const PAD_T = 9;
const PAD_B = 9;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;
const GUTTER_X = W - PAD_R + 4;

/**
 * Bars shown. The big chart draws 60; at 266px of plot that would put a candle
 * body under 3px wide, which is a texture rather than a tape. Forty covers a NY
 * AM session on 15m bars and still leaves a readable body.
 */
export const MINI_BARS = 40;

/**
 * Minimum vertical gap between two gutter rows before the lower-priority one is
 * dropped rather than drawn over the higher one.
 *
 * 7px text in a ~9px line box, so 10 leaves daylight. Dropping is the right
 * answer and not a compromise: two names at one height is unreadable for BOTH,
 * and `MARK_PRIORITY` below is ordered so the loser is always the mark that
 * changes the trader's next action least. It keeps its LINE either way.
 */
const GUTTER_GAP = 10;

/**
 * How far outside the candles' own range a mark may sit and still be allowed to
 * widen the price axis, measured in bar-range spans.
 *
 * Same refusal as `DRAW_INFRAME_SPANS` in setup-chart.tsx, and it earns its keep
 * here: on 2026-09-23 the board carried two A+ cards whose draws sat 4.18 and
 * 8.33 ATR away. Scaling to those would have drawn both setups as a flat line
 * with a target at the edge.
 */
const OUT_OF_FRAME_SPANS = 0.6;

export interface SetupMiniChartProps {
  bars: OhlcBar[];
  a: SetupAnticipation;
  /**
   * The entry array's EDGES, for the shaded band. `AnticipatedMark` carries only
   * the array's midpoint, and a band drawn from a midpoint would be an invented
   * width. Null draws the array as a single line instead.
   */
  zone?: { top: number; bottom: number } | null;
  /**
   * Which rung to draw. Each one draws a DIFFERENT set of marks — see
   * `TF_MARKS`. A 4h chart with an entry line on it is false precision (the
   * bar is four hours wide, the limit is one price), and a 1m chart with the
   * weekly high on it is clutter nine hours out of frame. Defaults to 15m,
   * the series the engine graded.
   */
  tf?: ChartTf;
  /**
   * What actually built the score, so a mark can carry its own weight. These
   * are MARGINAL contributions computed against the real engine, not raw
   * `RAW_WEIGHTS` values — see `score-drivers.ts` for why the raw weight would
   * be a lie. Only drawn on rungs whose spec lists `score_drivers`.
   */
  drivers?: ScoreDriver[];
  /**
   * Is the final candle still forming? On a resampled rung the trailing bucket
   * holds only what has printed so far, so a 4h bar fifteen minutes old is
   * drawn with the shape of a closed one. Passed in from `TfSeries` and drawn
   * hollow, because a provisional high and low must not look settled — the
   * same reason a partial minute is never flushed as a bar.
   */
  lastBarPartial?: boolean;
  /**
   * The dealing range, tinted premium/discount on the rungs whose spec asks
   * for it. This is the range `pd_half` graded against, not a fresh one — the
   * chart must never compute a second opinion about which half price is in.
   */
  range?: { high: number; low: number; eq: number } | null;
  /** The draw on liquidity, as a single line. */
  drawPrice?: number | null;
  /** Consequent encroachment — where the limit rests. */
  cePrice?: number | null;
  className?: string;
}

interface Scale {
  x: (i: number) => number;
  y: (p: number) => number;
  step: number;
  lo: number;
  hi: number;
}

/**
 * Which mark survives a collision. Lower wins.
 *
 * The order is "what does this change about the next click": where the limit
 * rests outranks what must be raided, which outranks where the trade is aiming,
 * which outranks context.
 */
const MARK_PRIORITY: Record<MarkKind, number> = {
  entry: 0,
  array: 1,
  sweep: 2,
  stop: 3,
  target: 4,
  pool: 5,
  displacement: 6,
  eq: 7,
};

/** Printed, awaited, dead — readable before any colour is decoded. */
const STATE_GLYPH: Record<StepState, string> = {
  printed: "●",
  awaited: "○",
  dead: "✕",
};

const STATE_INK: Record<
  StepState,
  { width: number; dash?: string; opacity: number }
> = {
  printed: { width: 1.3, opacity: 0.95 },
  awaited: { width: 1, dash: "4 3", opacity: 0.58 },
  dead: { width: 0.75, dash: "1 3", opacity: 0.3 },
};

/**
 * A dead mark loses its colour as well as its weight.
 *
 * A dead sweep drawn in warn amber at 0.3 still reads as "the raid" from a metre
 * away; in muted grey it reads as something that is over, which is what it is.
 * Everything else keeps the colour its role implies, and an unreachable target
 * wears the warn colour rather than the win colour — the chart is reading the
 * reachability verdict, never making one.
 */
function markColor(m: AnticipatedMark, targetReachable: boolean): string {
  if (m.state === "dead") return "var(--color-muted)";
  switch (m.kind) {
    case "entry":
    case "array":
      return "var(--color-primary)";
    case "sweep":
    case "displacement":
      return "var(--color-warn)";
    case "target":
      return targetReachable ? "var(--color-up)" : "var(--color-warn)";
    case "stop":
      return "var(--color-down)";
    case "eq":
      return "var(--color-muted)";
    case "pool":
    default:
      return "var(--color-fg)";
  }
}

/**
 * The name a trader would write beside the line, not the label the type carries.
 *
 * "PDH — UNREACHABLE" is 17 characters into a column that holds about 13, and
 * truncating it to "PDH — UNREAC…" turns the loudest fact on the chart into a
 * typo. The full sentence is printed under the chart by `targetNote`; here the
 * level only has to be identifiable as the far one.
 */
function shortLabel(label: string): string {
  const far = label.replace(/\s*—\s*UNREACHABLE\s*$/i, " ✕far");
  return far.length <= 13 ? far : `${far.slice(0, 12)}…`;
}

function finite(n: number | null | undefined): n is number {
  return n != null && Number.isFinite(n);
}

/**
 * Price to pixel projection for the card-sized frame.
 *
 * Exported for the same reason `buildScale` is in setup-chart.tsx: a mark
 * projected off-canvas, or an entry band drawn nearer the stop than it is, is a
 * misleading chart rather than an ugly one, and that is not something the eye
 * catches. Marks that do not fit are left OUT of the axis and reported by
 * position, never clipped onto the frame edge.
 */
export function buildMiniScale(
  bars: OhlcBar[],
  marks: AnticipatedMark[],
  zone: { top: number; bottom: number } | null,
): Scale | null {
  if (!bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    if (!Number.isFinite(b.l) || !Number.isFinite(b.h)) continue;
    lo = Math.min(lo, b.l);
    hi = Math.max(hi, b.h);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  const barLo = lo;
  const barHi = hi;
  const barSpan = hi - lo || 1;

  const admit = (p: number) => {
    if (!Number.isFinite(p)) return;
    if (p < barLo - barSpan * OUT_OF_FRAME_SPANS) return;
    if (p > barHi + barSpan * OUT_OF_FRAME_SPANS) return;
    lo = Math.min(lo, p);
    hi = Math.max(hi, p);
  };
  for (const m of marks) if (finite(m.price)) admit(m.price);
  if (zone) {
    admit(zone.top);
    admit(zone.bottom);
  }

  const span = hi - lo || 1;
  const pad = span * 0.06;
  lo -= pad;
  hi += pad;
  const step = PLOT_W / Math.max(bars.length, 1);
  return {
    lo,
    hi,
    step,
    x: (i) => PAD_L + i * step + step / 2,
    y: (p) => PAD_T + ((hi - p) / (hi - lo)) * PLOT_H,
  };
}

/**
 * Which marks win a gutter row.
 *
 * Same refusal as `dedupeByY` in setup-chart.tsx: two prices a third of a point
 * apart render as one unreadable smear exactly where the trader is looking
 * hardest, so the weaker one is dropped rather than overprinted.
 *
 * Off-frame marks are excluded before anything is measured. They get an edge
 * chip instead of a row, so letting one into this pass would spend a row slot
 * it never uses — and cost an on-frame name for a line that is not drawn.
 */
function pickRows(marks: AnticipatedMark[], scale: Scale): Set<AnticipatedMark> {
  const kept: { m: AnticipatedMark; y: number }[] = [];
  const byPriority = [...marks].sort(
    (a, b) => MARK_PRIORITY[a.kind] - MARK_PRIORITY[b.kind],
  );
  for (const m of byPriority) {
    if (!finite(m.price)) continue;
    if (m.price < scale.lo || m.price > scale.hi) continue;
    const y = scale.y(m.price);
    if (kept.every((k) => Math.abs(k.y - y) >= GUTTER_GAP)) kept.push({ m, y });
  }
  return new Set(kept.map((k) => k.m));
}

/**
 * The flash, and the calm.
 *
 * Injected here rather than added to styles.css so the rule and the component
 * that decides when to apply it cannot drift apart. React 19 hoists and dedupes
 * on `href`, so two cards flashing at once still ship one rule.
 *
 * The BASE `--live` class is already bright — full ring, green wash — and the
 * animation only pulses on top of it. That ordering is the whole reduced-motion
 * story: the app's global `prefers-reduced-motion` rule forces every animation
 * to one 0.01ms iteration, after which an element falls back to its un-animated
 * styles. A flash built purely out of keyframes would therefore go INVISIBLE for
 * the trader who most needs it static and loud.
 */
const MINI_CSS = `
.setup-mini { border: 1px solid var(--color-border); background: var(--color-bg); }
.setup-mini--armed {
  border-color: color-mix(in oklab, var(--color-primary) 55%, var(--color-border));
  box-shadow: inset 0 0 0 1px color-mix(in oklab, var(--color-primary) 22%, transparent);
}
.setup-mini--gone { opacity: 0.72; }
.setup-mini--live {
  border-color: var(--color-up);
  background: color-mix(in oklab, var(--color-up) 22%, var(--color-bg));
  box-shadow:
    0 0 0 4px color-mix(in oklab, var(--color-up) 70%, transparent),
    0 0 26px 6px color-mix(in oklab, var(--color-up) 50%, transparent);
  animation: setup-mini-live 0.7s ease-in-out infinite;
}
@keyframes setup-mini-live {
  0%, 100% {
    box-shadow:
      0 0 0 2px color-mix(in oklab, var(--color-up) 100%, transparent),
      0 0 30px 8px color-mix(in oklab, var(--color-up) 65%, transparent);
    background: color-mix(in oklab, var(--color-up) 30%, var(--color-bg));
  }
  50% {
    box-shadow:
      0 0 0 13px color-mix(in oklab, var(--color-up) 0%, transparent),
      0 0 8px 0 color-mix(in oklab, var(--color-up) 18%, transparent);
    background: color-mix(in oklab, var(--color-up) 6%, var(--color-bg));
  }
}
@media (prefers-reduced-motion: reduce) { .setup-mini--live { animation: none; } }
`;

function SetupMiniChartImpl({
  bars,
  a,
  zone = null,
  tf = "15m",
  drivers,
  lastBarPartial = false,
  range = null,
  drawPrice = null,
  cePrice = null,
  className,
}: SetupMiniChartProps) {
  // The rung decides what is drawn, not just which bars. Filtering here rather
  // than at each draw site means the scale, the collision rows and the legend
  // all agree about what exists on this chart — a scale widened to fit a mark
  // the rung does not draw would leave visible dead space.
  const marks = useMemo(() => marksFor(tf, a.marks), [tf, a.marks]);
  const view = useMemo(
    () => bars.slice(-(TF_VISIBLE_BARS[tf] ?? MINI_BARS)),
    [bars, tf],
  );
  // The array band belongs to the entry, so it is dropped on any rung that
  // does not draw the entry array at all.
  const bandZone = TF_MARKS[tf].kinds.includes("array") ? zone : null;
  const scale = useMemo(
    () => buildMiniScale(view, marks, bandZone ?? null),
    [view, marks, bandZone],
  );
  const rows = useMemo(
    () => (scale ? pickRows(marks, scale) : new Set<AnticipatedMark>()),
    [marks, scale],
  );

  /**
   * Points contributed, per mark kind, for the gutter.
   *
   * Several components can draw as the same mark (ifvg, order_block, breaker
   * and four others are all "array"), so the figure shown against one mark is
   * the SUM of the drivers that drew it. Summing is right rather than showing
   * the max: the trader is asking what that box on the chart is worth, and it
   * is worth everything that drew it.
   */
  const ptsByKind = useMemo(() => {
    if (!drivers || !TF_MARKS[tf].context.includes("score_drivers")) return null;
    const m = new Map<MarkKind, number>();
    for (const d of drivers) {
      if (!d.draws || d.points <= 0) continue;
      m.set(d.draws, (m.get(d.draws) ?? 0) + d.pts100);
    }
    return m;
  }, [drivers, tf]);

  // No bars, or bars carrying no finite prices, draw nothing. The card is then
  // exactly the card it was before this component existed, which is the correct
  // degraded state — an empty frame reading "no bars" costs vertical space and
  // answers nothing.
  if (!scale || !view.length) return null;

  const lastClose = view[view.length - 1]!.c;
  const inFrame = (p: number) => p >= scale.lo && p <= scale.hi;
  const priced = marks.filter((m): m is AnticipatedMark & { price: number } =>
    finite(m.price),
  );
  const onFrame = priced.filter((m) => inFrame(m.price));
  const offFrame = priced.filter((m) => !inFrame(m.price));

  const frame = a.flash
    ? "setup-mini--live"
    : a.entry === "armed"
      ? "setup-mini--armed"
      : a.entry === "gone"
        ? "setup-mini--gone"
        : "";

  const stateWord =
    a.entry === "live"
      ? "ENTER NOW"
      : a.entry === "armed"
        ? "ARMED · wait for the array"
        : a.entry === "gone"
          ? "GONE · price left the array"
          : `${a.mustPass}/${a.mustNeed} musts`;

  const zoneBand =
    bandZone && inFrame(bandZone.top) && inFrame(bandZone.bottom)
      ? {
          y: scale.y(bandZone.top),
          h: Math.max(2, scale.y(bandZone.bottom) - scale.y(bandZone.top)),
        }
      : null;

  return (
    <figure
      className={cn(
        "setup-mini overflow-hidden rounded-[var(--radius-sm)]",
        frame,
        className,
      )}
    >
      <style href="setup-mini-chart" precedence="medium">
        {MINI_CSS}
      </style>

      {/* The two numbers that disagree, side by side and named. The engine score
          grades how well the MODEL fits; the fraction grades how much of the
          TRADE has printed. One row is the cheapest way to stop a 0.95 being
          read as a green light. */}
      <div className="flex items-center justify-between gap-2 px-2 pt-1.5 text-[9px] uppercase tracking-wide">
        <span className="truncate font-semibold text-[var(--color-muted)]">
          {a.symbol}{" "}
          <span
            className={
              a.side === "long"
                ? "text-[var(--color-up)]"
                : "text-[var(--color-down)]"
            }
          >
            {a.side}
          </span>{" "}
          <span className="tabular text-[var(--color-subtle)]">
            engine {a.engine.toFixed(2)} &middot; seq {a.mustPass}/{a.mustNeed}
          </span>
        </span>
        <span
          className={cn(
            "shrink-0 rounded-full px-1.5 py-0.5 font-semibold",
            a.entry === "live" && "bg-[var(--color-up)] text-[var(--color-bg)]",
            a.entry === "armed" && "text-[var(--color-primary)]",
            a.entry === "gone" && "text-[var(--color-subtle)]",
            a.entry === "not-yet" && "text-[var(--color-warn)]",
          )}
        >
          {stateWord}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={`${a.symbol} ${a.side} anticipation — ${a.mustPass} of ${a.mustNeed} must-layers printed, entry ${a.entry}. ${a.next}`}
      >
        {/* ── The entry array, shaded ──────────────────────────────────────
            Drawn from the array's real edges or not at all. When the sequence
            has not priced an array the band is absent and the midpoint line
            below carries whatever the tape does know. */}
        {zoneBand && (
          <rect
            x={PAD_L}
            y={zoneBand.y}
            width={PLOT_W}
            height={zoneBand.h}
            fill="var(--color-primary)"
            opacity={a.entry === "live" ? 0.34 : 0.17}
          />
        )}

        {/* ── The marks: printed solid, awaited dashed, dead crossed ──────── */}
        {onFrame.map((m, i) => {
          const y = scale.y(m.price);
          const color = markColor(m, a.targetReachable);
          const ink = STATE_INK[m.state];
          const cx = PAD_L + PLOT_W / 2;
          return (
            <g key={`mark-${m.kind}-${i}`}>
              <title>{`${m.label} ${m.price.toFixed(2)} — ${m.state}. ${m.watchFor}`}</title>
              <line
                x1={PAD_L}
                x2={PAD_L + PLOT_W}
                y1={y}
                y2={y}
                stroke={color}
                strokeWidth={ink.width}
                strokeDasharray={ink.dash}
                opacity={ink.opacity}
              />
              {/* A dead layer is struck, not merely faded. Waiting will not
                  bring it back, and a dim line still reads as "pending". */}
              {m.state === "dead" && (
                <line
                  x1={cx - 11}
                  x2={cx + 11}
                  y1={y - 4}
                  y2={y + 4}
                  stroke="var(--color-muted)"
                  strokeWidth={1.1}
                  opacity={0.85}
                />
              )}
            </g>
          );
        })}

        {/* ── Candles ─────────────────────────────────────────────────────── */}
        {/* ── CONTEXT LAYERS ─────────────────────────────────────────────
            Drawn UNDER the candles and under the marks: they are the room the
            trade happens in, not the trade. Each is gated on this rung's own
            spec, so a rung never carries ink it did not ask for. */}
        {showsContext(tf, "dealing_range") && range && inFrame(range.eq) && (
          <g opacity={0.5}>
            {/* Premium above EQ, discount below. Tinted, not outlined — an
                outlined box reads as an array, which is a different thing. */}
            <rect
              x={PAD_L}
              y={scale.y(Math.min(range.high, scale.hi))}
              width={PLOT_W}
              height={Math.max(0, scale.y(range.eq) - scale.y(Math.min(range.high, scale.hi)))}
              fill="var(--color-down)"
              opacity={0.07}
            />
            <rect
              x={PAD_L}
              y={scale.y(range.eq)}
              width={PLOT_W}
              height={Math.max(0, scale.y(Math.max(range.low, scale.lo)) - scale.y(range.eq))}
              fill="var(--color-up)"
              opacity={0.07}
            />
          </g>
        )}
        {showsContext(tf, "draw_line") && finite(drawPrice) && inFrame(drawPrice) && (
          <line
            x1={PAD_L}
            x2={PAD_L + PLOT_W}
            y1={scale.y(drawPrice)}
            y2={scale.y(drawPrice)}
            stroke="var(--color-accent)"
            strokeWidth={0.7}
            strokeDasharray="6 4"
            opacity={0.45}
          />
        )}
        {showsContext(tf, "ce_line") && finite(cePrice) && inFrame(cePrice) && (
          <line
            x1={PAD_L}
            x2={PAD_L + PLOT_W}
            y1={scale.y(cePrice)}
            y2={scale.y(cePrice)}
            stroke="var(--color-accent)"
            strokeWidth={0.9}
            strokeDasharray="2 2"
            opacity={0.8}
          />
        )}

        {view.map((b, i) => {
          const x = scale.x(i);
          const up = b.c >= b.o;
          const color = up ? "var(--color-up)" : "var(--color-down)";
          const bodyTop = scale.y(Math.max(b.o, b.c));
          const bodyH = Math.max(1, scale.y(Math.min(b.o, b.c)) - bodyTop);
          const bw = Math.max(1.2, scale.step * 0.58);
          // The trailing bucket on a resampled rung is provisional: hollow it
          // so its high and low do not read as finished.
          const forming = lastBarPartial && i === view.length - 1;
          return (
            <g key={b.t} opacity={forming ? 0.55 : 0.9}>
              <line
                x1={x}
                x2={x}
                y1={scale.y(b.h)}
                y2={scale.y(b.l)}
                stroke={color}
                strokeWidth={0.8}
              />
              <rect
                x={x - bw / 2}
                y={bodyTop}
                width={bw}
                height={bodyH}
                fill={forming ? "none" : color}
                stroke={forming ? color : "none"}
                strokeWidth={forming ? 0.7 : 0}
              />
            </g>
          );
        })}

        {/* ── Last close, so "price is in the array" is visible, not asserted ── */}
        <line
          x1={PAD_L}
          x2={PAD_L + PLOT_W}
          y1={scale.y(lastClose)}
          y2={scale.y(lastClose)}
          stroke="var(--color-fg)"
          strokeWidth={0.75}
          strokeDasharray="1 3"
          opacity={0.7}
        />

        {/* ── Gutter: one short name per surviving mark ────────────────────── */}
        {onFrame
          .filter((m) => rows.has(m))
          .map((m, i) => {
            const y = scale.y(m.price);
            const color = markColor(m, a.targetReachable);
            return (
              <text
                key={`row-${m.kind}-${i}`}
                x={GUTTER_X}
                y={Math.min(
                  PAD_T + PLOT_H - 1,
                  Math.max(PAD_T + 6, y + 2.6),
                )}
                fill={color}
                fontSize={7}
                fontWeight={m.state === "printed" ? 700 : 500}
                opacity={m.state === "dead" ? 0.55 : 1}
                style={{ textTransform: "uppercase" }}
              >
                {STATE_GLYPH[m.state]} {shortLabel(m.label)}
                {ptsByKind?.get(m.kind)
                  ? ` ${ptsByKind.get(m.kind)!.toFixed(0)}p`
                  : ""}
              </text>
            );
          })}

        {/* ── Marks the axis refused to stretch to ─────────────────────────
            An arrow and the distance in points, rather than a target pinned to
            the frame edge as though it were one candle away. This is where the
            4.18 and 8.33 ATR draws land. */}
        {offFrame.map((m, i) => {
          const above = m.price > scale.hi;
          const color = markColor(m, a.targetReachable);
          const delta = m.price - lastClose;
          return (
            <text
              key={`off-${m.kind}-${i}`}
              x={PAD_L + PLOT_W - 2}
              y={above ? PAD_T + 8 : PAD_T + PLOT_H - 2}
              textAnchor="end"
              fill={color}
              fontSize={7.5}
              fontWeight={600}
              style={{ fontVariantNumeric: "tabular-nums" }}
            >
              {above ? "▲" : "▼"} {shortLabel(m.label)}{" "}
              {delta > 0 ? "+" : ""}
              {delta.toFixed(0)}
            </text>
          );
        })}

        {/* ── The call to the screen ────────────────────────────────────────
            The frame's pulse lives in CSS; this is the PLOT going green, and
            it is here because a ring around a 340px card on a black desk is
            not what "unmistakable from across the room" means. Only ever
            drawn at `flash`, which is only ever `entry === "live"`. */}
        {a.flash && (
          <g pointerEvents="none">
            <rect
              x={0}
              y={0}
              width={W}
              height={H}
              fill="var(--color-up)"
              opacity={0.14}
            />
            <rect
              x={1.5}
              y={1.5}
              width={W - 3}
              height={H - 3}
              fill="none"
              stroke="var(--color-up)"
              strokeWidth={2.5}
              opacity={0.9}
            />
          </g>
        )}
      </svg>

      {/* ── The sequence as pills, including the layers that have no price ──
          Displacement never gets a line — it is an event on a bar, not a level
          — and it is still a must. Without this strip it would be the one step
          the markup silently omits. */}
      <ol className="flex flex-wrap items-center gap-1 px-2 pb-1 pt-0.5">
        {/* EVERY step, at every rung. The pills are the sequence's own state —
            which layers printed, which are awaited, which died — and that does
            not change because the trader is looking at 4h. Filtering these the
            way the CHART is filtered silently dropped must-layers, including
            the displacement pill that has no price and therefore no rung. */}
        {a.marks.map((m, i) => (
          <li
            key={`pill-${m.kind}-${i}`}
            title={m.watchFor}
            className={cn(
              "rounded-full border px-1.5 py-[1px] text-[9px] font-medium",
              m.state === "printed" &&
                "border-[color-mix(in_oklab,var(--color-up)_45%,transparent)] text-[var(--color-up)]",
              m.state === "awaited" &&
                "border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] text-[var(--color-warn)]",
              m.state === "dead" &&
                "border-[var(--color-border)] text-[var(--color-subtle)] line-through",
            )}
          >
            <span aria-hidden>{STATE_GLYPH[m.state]} </span>
            {m.label}
          </li>
        ))}
      </ol>

      {/* ── The watch line: the single next thing, in tape terms ───────────
          And above it, when the draw is somewhere the tape does not go, the
          warning that belongs on the chart rather than in grey text. */}
      <figcaption className="border-t border-[var(--color-border)] px-2 py-1.5 text-[10px] leading-snug">
        {!a.targetReachable && a.targetNote && (
          <p className="mb-1 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] px-1.5 py-1 font-semibold text-[var(--color-warn)]">
            {a.targetNote}
          </p>
        )}
        <p
          className={
            a.flash
              ? "font-semibold text-[var(--color-up)]"
              : "text-[var(--color-muted)]"
          }
        >
          <span className="uppercase tracking-wide text-[var(--color-subtle)]">
            watch &middot;{" "}
          </span>
          {a.next}
        </p>
      </figcaption>
    </figure>
  );
}

/**
 * Memoised because the scanner renders a LIST of these and the desk repaints
 * every 20 seconds. The anticipation object is rebuilt per card per poll, so
 * this only skips work when a card's inputs are genuinely unchanged — which is
 * the common case between quote ticks.
 */
export const SetupMiniChart = memo(SetupMiniChartImpl);
