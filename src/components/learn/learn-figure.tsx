/**
 * Renders a teaching figure.
 *
 * Separate from `setup-chart.tsx` on purpose. The live chart draws ONE thing —
 * the trade — and every feature added to it competes with that. Teaching
 * figures need free annotation, right/wrong framing and callouts that would be
 * clutter on a surface a trader reads under time pressure. Keeping them apart
 * means the live chart stays focused and the lessons stay flexible.
 *
 * They deliberately SHARE the visual language: same candle colours, same
 * accent for arrays, same amber for a raid, same red/green for risk and
 * reward. The point of learning on a diagram is that the live chart then looks
 * familiar, and that only works if a gap is the same colour in both places.
 *
 * Every figure is stamped as an illustration. Inside a trading app, the one
 * genuinely dangerous failure is a diagram being read as a signal.
 */

import type { Figure, FigureBar, FigureMark, FigureTone } from "@/lib/learn/figures";

const W = 560;
const H = 260;
const PAD_L = 6;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 8;
const PLOT_W = W - PAD_L - PAD_R;
const PLOT_H = H - PAD_T - PAD_B;

function toneColor(t: FigureTone): string {
  switch (t) {
    case "good":
      return "var(--color-up)";
    case "bad":
      return "var(--color-down)";
    case "warn":
      return "var(--color-warn)";
    case "accent":
      return "var(--color-primary)";
    default:
      return "var(--color-muted)";
  }
}

interface Scale {
  x: (i: number) => number;
  y: (p: number) => number;
  step: number;
}

function buildScale(bars: FigureBar[], marks: FigureMark[]): Scale | null {
  if (!bars.length) return null;
  let lo = Infinity;
  let hi = -Infinity;
  for (const b of bars) {
    lo = Math.min(lo, b.l);
    hi = Math.max(hi, b.h);
  }
  // Annotations must be in frame for the same reason plan levels must be on
  // the live chart: a callout drawn off-canvas teaches the wrong distance.
  for (const m of marks) {
    if (m.kind === "level" || m.kind === "point") {
      lo = Math.min(lo, m.price);
      hi = Math.max(hi, m.price);
    } else if (m.kind === "zone") {
      lo = Math.min(lo, m.bottom);
      hi = Math.max(hi, m.top);
    }
  }
  const span = hi - lo || 1;
  lo -= span * 0.1;
  hi += span * 0.1;
  const step = PLOT_W / bars.length;
  return {
    step,
    x: (i) => PAD_L + i * step + step / 2,
    y: (p) => PAD_T + ((hi - p) / (hi - lo)) * PLOT_H,
  };
}

/** Vertical room one 9px label needs. */
const LABEL_H = 11;

/**
 * Assign a label y to every level mark so no two overlap.
 *
 * Default slot is just above the line. Levels are walked top-down; if a
 * label's slot would sit within LABEL_H of an already-placed label, it is
 * moved just below its own line instead. Two levels closer than a label
 * height in BOTH directions is a degenerate figure and is left to the eye —
 * the suite catches the specific case of an internal level at an extreme.
 */
function placeLevelLabels(
  marks: FigureMark[],
  scale: Scale,
): { m: FigureMark; i: number; labelY: number }[] {
  const levels = marks
    .map((m, i) => ({ m, i }))
    .filter((x): x is { m: Extract<FigureMark, { kind: "level" }>; i: number } => x.m.kind === "level")
    .sort((a, b) => b.m.price - a.m.price); // top of chart first
  const taken: number[] = [];
  const out: { m: FigureMark; i: number; labelY: number }[] = [];
  for (const { m, i } of levels) {
    const lineY = scale.y(m.price);
    let labelY = lineY - 4; // above the line
    if (taken.some((y) => Math.abs(y - labelY) < LABEL_H)) labelY = lineY + LABEL_H; // below instead
    taken.push(labelY);
    out.push({ m, i, labelY });
  }
  // Non-level marks are rendered by their own passes; return levels in
  // original order so keys stay stable.
  return out.sort((a, b) => a.i - b.i);
}

export function LearnFigure({ figure }: { figure: Figure }) {
  const scale = buildScale(figure.bars, figure.marks);
  if (!scale) return null;

  const border =
    figure.verdict === "right"
      ? "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))]"
      : figure.verdict === "wrong"
        ? "border-[color-mix(in_oklab,var(--color-down)_45%,var(--color-border))]"
        : "border-[var(--color-border)]";

  return (
    <figure className={`overflow-hidden rounded-[var(--radius-md)] border ${border} bg-[var(--color-surface)]`}>
      {figure.verdict && (
        <div
          className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide"
          style={{
            color: figure.verdict === "right" ? "var(--color-up)" : "var(--color-down)",
            background:
              figure.verdict === "right"
                ? "color-mix(in oklab, var(--color-up) 12%, transparent)"
                : "color-mix(in oklab, var(--color-down) 12%, transparent)",
          }}
        >
          {figure.verdict === "right" ? "This is the setup" : "This is not"}
        </div>
      )}

      <svg viewBox={`0 0 ${W} ${H}`} className="block w-full" role="img" aria-label={figure.caption}>
        {/* Zones first — everything else reads on top of them. */}
        {figure.marks.map((m, i) =>
          m.kind === "zone" ? (
            <g key={`z${i}`}>
              <rect
                x={m.from != null ? scale.x(m.from) : PAD_L}
                y={scale.y(m.top)}
                width={m.from != null ? PLOT_W - (scale.x(m.from) - PAD_L) : PLOT_W}
                height={Math.max(1.5, scale.y(m.bottom) - scale.y(m.top))}
                fill={toneColor(m.tone)}
                opacity={0.14}
              />
              {m.label && (
                <text
                  x={(m.from != null ? scale.x(m.from) : PAD_L) + 4}
                  y={scale.y(m.top) + 10}
                  fill={toneColor(m.tone)}
                  fontSize={9}
                  fontWeight={500}
                >
                  {m.label}
                </text>
              )}
            </g>
          ) : null,
        )}

        {/* Vertical split — "the sequence starts here". */}
        {figure.marks.map((m, i) =>
          m.kind === "split" ? (
            <g key={`s${i}`}>
              <line
                x1={scale.x(m.bar)}
                x2={scale.x(m.bar)}
                y1={PAD_T}
                y2={PAD_T + PLOT_H}
                stroke={toneColor(m.tone)}
                strokeWidth={1}
                strokeDasharray="3 3"
                opacity={0.8}
              />
              <text
                x={scale.x(m.bar) + 4}
                y={PAD_T + PLOT_H - 4}
                fill={toneColor(m.tone)}
                fontSize={9}
                fontWeight={500}
              >
                {m.label}
              </text>
            </g>
          ) : null,
        )}

        {/* Candles. */}
        {figure.bars.map((b, i) => {
          const x = scale.x(i);
          const up = b.c >= b.o;
          const color = up ? "var(--color-up)" : "var(--color-down)";
          const top = scale.y(Math.max(b.o, b.c));
          const h = Math.max(1, scale.y(Math.min(b.o, b.c)) - top);
          const bw = Math.max(2, scale.step * 0.6);
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={scale.y(b.h)} y2={scale.y(b.l)} stroke={color} strokeWidth={1} />
              <rect x={x - bw / 2} y={top} width={bw} height={h} fill={color} />
            </g>
          );
        })}

        {/* Levels. Labels are placed with collision avoidance: two levels
            within a label's height of each other would print on top of one
            another (an IRL drawn at the session high did exactly that), so
            a label whose slot is taken drops below its line instead. */}
        {placeLevelLabels(figure.marks, scale).map(({ m, i, labelY }) =>
          m.kind === "level" ? (
            <g key={`l${i}`}>
              <line
                x1={PAD_L}
                x2={PAD_L + PLOT_W}
                y1={scale.y(m.price)}
                y2={scale.y(m.price)}
                stroke={toneColor(m.tone)}
                strokeWidth={1.25}
                strokeDasharray={m.dash ? "4 3" : undefined}
              />
              {/* Left-anchored: point labels sit near the action, which is
                  usually mid-right, and both right-anchored put a level name
                  on top of a callout at the same height. */}
              <text
                x={PAD_L + 3}
                y={labelY}
                fill={toneColor(m.tone)}
                fontSize={9}
                fontWeight={500}
              >
                {m.label}
              </text>
            </g>
          ) : null,
        )}

        {/* Points — ring plus a leader label that stays inside the frame. */}
        {figure.marks.map((m, i) => {
          if (m.kind !== "point") return null;
          const x = scale.x(m.bar);
          const y = scale.y(m.price);
          // Flip the label to whichever side has room.
          const rightSide = x < W * 0.55;
          return (
            <g key={`p${i}`}>
              <circle cx={x} cy={y} r={4} fill="none" stroke={toneColor(m.tone)} strokeWidth={1.5} />
              <text
                x={rightSide ? x + 7 : x - 7}
                y={y - 6}
                textAnchor={rightSide ? "start" : "end"}
                fill={toneColor(m.tone)}
                fontSize={9}
                fontWeight={600}
              >
                {m.label}
              </text>
            </g>
          );
        })}

        {/* Illustration stamp — never let a diagram read as live tape. */}
        <text
          x={W - PAD_R}
          y={H - 2}
          textAnchor="end"
          fill="var(--color-subtle)"
          fontSize={8}
          opacity={0.75}
        >
          illustration — not live tape
        </text>
      </svg>

      <figcaption className="border-t border-[var(--color-border)] px-3 py-2 text-[11px] leading-snug text-[var(--color-muted)]">
        {figure.caption}
      </figcaption>
    </figure>
  );
}
