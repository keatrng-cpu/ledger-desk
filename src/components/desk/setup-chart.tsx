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
 *      — the part that matters — it renders from the SAME `TradePlan` the
 *      grade is computed from, so the drawing cannot disagree with the verdict
 *      sitting next to it.
 *
 * This is (3). It is also the only one of the three compatible with the house
 * rule that nothing in the poll loop is an LLM.
 *
 * WHAT IS DRAWN, AND WHAT IS DELIBERATELY NOT
 * The desk's complaint was that it reads as a wall of words. The answer to
 * that is not to draw every object the tape knows about — that just moves the
 * clutter into pixels. Only what a trader acts on is drawn: the raid, the
 * array being entered, the stop, the targets, and where price is now relative
 * to all of them. Mitigated arrays, opposite-side arrays and anything outside
 * the visible price band are dropped.
 */

import { useMemo } from "react";
import type { OhlcBar } from "@/lib/market/types";
import type { TradePlan } from "@/lib/trading/trade-plan";
import type { SmcArray } from "@/lib/trading/smc-board";

const W = 720;
const H = 340;
const PAD_L = 8;
const PAD_R = 74; // price gutter
const PAD_T = 12;
const PAD_B = 22;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

/** Bars shown. Enough for structure, few enough that bodies stay readable. */
const VISIBLE_BARS = 60;
/** Hard cap on shaded PD arrays — past this the chart is noise, not a chart. */
const MAX_ARRAYS = 4;

export interface SetupChartProps {
  bars: OhlcBar[];
  plan: TradePlan | null;
  /** Shown when there is no plan yet — the missing must-layer, in tape terms. */
  emptyDetail?: string;
  /** "TAKE" / "WAIT" / "STAND", for the corner badge. */
  word?: string;
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
 * Price→pixel projection.
 *
 * Exported because it is the part that can be wrong in a way the eye does not
 * catch: a target drawn off-canvas, or a stop that looks closer to entry than
 * it is, is a misleading chart rather than an ugly one.
 */
export function buildScale(bars: OhlcBar[], plan: TradePlan | null): Scale | null {
  if (!bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, b.l);
    hi = Math.max(hi, b.h);
  }
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

function arrayFill(a: SmcArray): string {
  if (a.kind === "ob" || a.kind === "bb") return "var(--color-chart-4)";
  if (a.kind === "ifvg") return "var(--color-chart-2)";
  return "var(--color-chart-3)";
}

export function SetupChart({
  bars,
  plan,
  emptyDetail,
  word,
  className,
}: SetupChartProps) {
  const view = useMemo(() => bars.slice(-VISIBLE_BARS), [bars]);
  const scale = useMemo(() => buildScale(view, plan), [view, plan]);

  const shownArrays = useMemo(() => {
    if (!plan || !scale) return [];
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
      .slice(0, MAX_ARRAYS);
  }, [plan, scale]);

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

  // Index of the raid bar, so the marker lands on the candle that swept.
  const sweepIdx =
    plan?.sweep?.t != null
      ? view.findIndex((b, i) => {
          const next = view[i + 1];
          return b.t <= plan.sweep!.t! && (!next || next.t > plan.sweep!.t!);
        })
      : -1;

  return (
    <figure className={`panel overflow-hidden ${className ?? ""}`}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block w-full"
        role="img"
        aria-label={
          plan
            ? `${plan.symbol} ${plan.side} — entry ${plan.entry}, stop ${plan.stop}${plan.t1 != null ? `, target ${plan.t1}` : ""}`
            : "Setup chart, no plan priced"
        }
      >
        {/* ── Dealing range: premium above EQ, discount below ─────────────── */}
        {plan?.range && (
          <>
            <rect
              x={PAD_L}
              y={scale.y(plan.range.high)}
              width={PLOT_W}
              height={Math.max(0, scale.y(plan.range.eq) - scale.y(plan.range.high))}
              fill="var(--color-down)"
              opacity={0.05}
            />
            <rect
              x={PAD_L}
              y={scale.y(plan.range.eq)}
              width={PLOT_W}
              height={Math.max(0, scale.y(plan.range.low) - scale.y(plan.range.eq))}
              fill="var(--color-up)"
              opacity={0.05}
            />
            <line
              x1={PAD_L}
              x2={PAD_L + PLOT_W}
              y1={scale.y(plan.range.eq)}
              y2={scale.y(plan.range.eq)}
              stroke="var(--color-subtle)"
              strokeWidth={1}
              strokeDasharray="1 5"
            />
            <text
              x={PAD_L + 3}
              y={scale.y(plan.range.eq) - 3}
              fill="var(--color-muted)"
              fontSize={9}
              fontWeight={500}
            >
              EQ {plan.range.eq.toFixed(2)}
            </text>
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

        {/* ── PD arrays ────────────────────────────────────────────────────── */}
        {shownArrays.map((a) => {
          const y = scale.y(a.top);
          const h = Math.max(1.5, scale.y(a.bottom) - y);
          return (
            <g key={`${a.kind}-${a.t}-${a.top}`}>
              <rect
                x={PAD_L}
                y={y}
                width={PLOT_W}
                height={h}
                fill={arrayFill(a)}
                opacity={a.state === "fresh" ? 0.18 : 0.09}
              />
              <text
                x={PAD_L + 3}
                y={y + Math.min(h - 2, 9)}
                fill="var(--color-muted)"
                fontSize={8}
                style={{ textTransform: "uppercase" }}
              >
                {a.tf} {a.kind}
                {a.state !== "fresh" ? ` · ${a.state}` : ""}
              </text>
            </g>
          );
        })}

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
              <line
                x1={x}
                x2={x}
                y1={scale.y(b.h)}
                y2={scale.y(b.l)}
                stroke={color}
                strokeWidth={1}
              />
              <rect x={x - bw / 2} y={bodyTop} width={bw} height={bodyH} fill={color} />
            </g>
          );
        })}

        {/* ── The raid ─────────────────────────────────────────────────────── */}
        {plan?.sweep && sweepIdx >= 0 && (
          <g>
            <circle
              cx={scale.x(sweepIdx)}
              cy={scale.y(plan.sweep.price)}
              r={3.5}
              fill="none"
              stroke="var(--color-warn)"
              strokeWidth={1.5}
            />
            <text
              x={scale.x(sweepIdx) + 6}
              // A short's raid is the HIGH of the frame, so its label goes
              // BELOW the wick or it clips the top edge; a long's raid is the
              // low, so its label goes above. This was inverted and the label
              // ran off-canvas on exactly the setup the desk trades most.
              y={scale.y(plan.sweep.price) + (long ? -7 : 13)}
              fill="var(--color-warn)"
              fontSize={9}
              fontWeight={500}
            >
              raid {plan.sweep.price.toFixed(2)}
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
                height={Math.max(
                  2,
                  scale.y(plan.entryZone.bottom) - scale.y(plan.entryZone.top),
                )}
                fill="var(--color-primary)"
                opacity={0.22}
              />
            )}
            <PlanLine y={scale.y(plan.entry)} color="var(--color-primary)" dash="5 3" />
            <PlanLine y={scale.y(plan.stop)} color="var(--color-down)" />
            {plan.t1 != null && (
              <PlanLine y={scale.y(plan.t1)} color="var(--color-up)" dash="5 3" />
            )}
            {plan.t2 != null && (
              <PlanLine y={scale.y(plan.t2)} color="var(--color-up)" dash="2 4" />
            )}
            <PlanLine y={scale.y(plan.price)} color="var(--color-fg)" dash="1 3" />
          </>
        )}

        {/* ── Price gutter. Only levels that matter — not a grid ───────────── */}
        {plan &&
          dedupeByY(
            [
              { p: plan.price, c: "var(--color-fg)", t: "live" },
              { p: plan.entry, c: "var(--color-primary)", t: "entry" },
              { p: plan.stop, c: "var(--color-down)", t: "stop" },
              ...(plan.t1 != null
                ? [
                    {
                      p: plan.t1,
                      c: "var(--color-up)",
                      t: plan.rr1 != null ? `T1 ${plan.rr1.toFixed(1)}R` : "T1",
                    },
                  ]
                : []),
              ...(plan.t2 != null
                ? [
                    {
                      p: plan.t2,
                      c: "var(--color-up)",
                      t: plan.rr2 != null ? `T2 ${plan.rr2.toFixed(1)}R` : "T2",
                    },
                  ]
                : []),
            ],
            scale,
          ).map((l) => (
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
        {plan && (
          <g>
            {/* Backing plate: the badge sits over the risk band, and coloured
                text on a coloured band is unreadable at 10px. */}
            <rect
              x={PAD_L}
              y={PAD_T - 1}
              width={badgeWidth(plan.symbol, plan.side, word, plan.riskOverCap)}
              height={14}
              rx={3}
              fill="var(--color-bg)"
              opacity={0.92}
            />
            <text
              x={PAD_L + 4}
              y={PAD_T + 9}
              fill="var(--color-fg)"
              fontSize={10}
              fontWeight={600}
            >
              {plan.symbol} {plan.side.toUpperCase()}
              {word ? ` · ${word}` : ""}
            </text>
            {plan.riskOverCap && (
              <text
                x={PAD_L + 4}
                y={PAD_T + 23}
                fill="var(--color-down)"
                fontSize={9}
                fontWeight={600}
              >
                RISK OVER CAP
              </text>
            )}
          </g>
        )}

        {/* ── Time footer ──────────────────────────────────────────────────── */}
        <text x={PAD_L} y={H - 6} fill="var(--color-subtle)"
          fontSize={9}>
          {etStamp(firstT)}
        </text>
        <text
          x={PAD_L + PLOT_W}
          y={H - 6}
          textAnchor="end"
          fill="var(--color-subtle)"
          fontSize={9}
        >
          {etStamp(lastT)} ET
        </text>
      </svg>

      {!plan && (
        <figcaption className="border-t border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span className="text-[var(--color-warn)]">No plan priced yet.</span>{" "}
          {emptyDetail ?? "Waiting on the sequence — nothing to draw."}
        </figcaption>
      )}
    </figure>
  );
}

/** Rough text width for the badge plate — 10px semibold averages ~5.6px/char. */
function badgeWidth(
  symbol: string,
  side: string,
  word: string | undefined,
  overCap: boolean,
): number {
  const text = `${symbol} ${side.toUpperCase()}${word ? ` · ${word}` : ""}`;
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
 * Drop gutter labels that would overlap.
 *
 * Two prices 0.3pt apart render on top of each other and produce an unreadable
 * smear exactly where the trader is looking hardest. Earlier entries win, and
 * the list is ordered by importance, so `live` and `entry` survive a collision
 * with a target rather than the other way round.
 */
function dedupeByY<T extends { p: number }>(items: T[], scale: Scale): T[] {
  const kept: T[] = [];
  for (const it of items) {
    if (!Number.isFinite(it.p)) continue;
    const y = scale.y(it.p);
    if (kept.every((k) => Math.abs(scale.y(k.p) - y) >= 16)) kept.push(it);
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
