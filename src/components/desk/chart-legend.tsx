/**
 * The colour key for the stacked charts.
 *
 * Five charts share one colour language, so the key is stated ONCE above them
 * rather than repeated five times or — worse — left to be learned. Every entry
 * here is read from the same place the chart reads it: `arrayFill` decides the
 * box colours, `smc-board` decides the kinds, and if one of those changes this
 * is wrong in an obvious way rather than a quiet one.
 *
 * WHY IT IS A KEY AND NOT A TOOLTIP
 * A tooltip teaches one item at a time to someone who already suspects what it
 * is. The point of a key is that a glance answers "what is the amber box" the
 * first three hundred times, and then never again.
 */

/** Swatch shapes match how the thing is actually drawn on the chart. */
type Mark =
  | { as: "box"; colour: string }
  | { as: "line"; colour: string; dash?: string; width?: number }
  | { as: "text"; colour: string; glyph: string };

const GROUPS: { title: string; items: { mark: Mark; label: string; note: string }[] }[] = [
  {
    title: "PD arrays",
    items: [
      {
        mark: { as: "box", colour: "var(--color-chart-3)" },
        label: "FVG · FVG+",
        note: "imbalance left by displacement; FVG+ is a sponsored candle",
      },
      {
        mark: { as: "box", colour: "var(--color-chart-2)" },
        label: "IFVG",
        note: "a gap filled and then rejected from the other side",
      },
      {
        mark: { as: "box", colour: "var(--color-chart-4)" },
        label: "OB · BRK · REJ",
        note: "order block, breaker, rejection block",
      },
    ],
  },
  {
    title: "Structure",
    items: [
      {
        mark: { as: "line", colour: "var(--color-primary)", width: 1.5 },
        label: "MSS",
        note: "market structure shift — the break that turns the leg",
      },
      {
        mark: { as: "line", colour: "var(--color-fg)", width: 1.5 },
        label: "BOS",
        note: "break of structure — continuation of the leg already running",
      },
      {
        mark: { as: "text", colour: "var(--color-warn)", glyph: "▲" },
        label: "Displacement",
        note: "a wide-range bar delivering away from the raid",
      },
    ],
  },
  {
    title: "Liquidity",
    items: [
      {
        mark: { as: "line", colour: "var(--color-up)", dash: "6 3" },
        label: "BSL / draw",
        note: "buy stops above; dashed is the draw the plan is aimed at",
      },
      {
        mark: { as: "line", colour: "var(--color-down)", dash: "6 3" },
        label: "SSL",
        note: "sell stops below",
      },
      {
        mark: { as: "line", colour: "var(--color-muted)", dash: "2 4" },
        label: "swept",
        note: "a pool already taken — spent, kept only to explain the raid",
      },
      {
        mark: { as: "line", colour: "var(--color-muted)", dash: "8 6" },
        label: "EQ",
        note: "equilibrium of the dealing range — premium above, discount below",
      },
    ],
  },
  {
    title: "The plan",
    items: [
      {
        mark: { as: "line", colour: "var(--color-primary)", width: 1.5 },
        label: "Entry / CE",
        note: "where the limit rests",
      },
      {
        mark: { as: "line", colour: "var(--color-down)", width: 1.5 },
        label: "Stop",
        note: "beyond the sweep — where the read is wrong",
      },
      {
        mark: { as: "line", colour: "var(--color-up)", dash: "5 3" },
        label: "T1 / T2",
        note: "nearest IRL, then the original ERL",
      },
    ],
  },
];

function Swatch({ mark }: { mark: Mark }) {
  if (mark.as === "box") {
    return (
      <span
        aria-hidden
        className="inline-block h-2.5 w-4 shrink-0 rounded-[2px] border"
        style={{
          backgroundColor: `color-mix(in oklab, ${mark.colour} 18%, transparent)`,
          borderColor: mark.colour,
        }}
      />
    );
  }
  if (mark.as === "text") {
    return (
      <span
        aria-hidden
        className="inline-block w-4 shrink-0 text-center font-mono text-[8px] font-semibold leading-none"
        style={{ color: mark.colour }}
      >
        {mark.glyph}
      </span>
    );
  }
  return (
    <svg aria-hidden width="16" height="10" className="shrink-0">
      <line
        x1="0"
        x2="16"
        y1="5"
        y2="5"
        stroke={mark.colour}
        strokeWidth={mark.width ?? 1}
        strokeDasharray={mark.dash}
      />
    </svg>
  );
}

export function ChartLegend() {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2">
      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="mb-0.5 text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
              {g.title}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.items.map((it) => (
                <li
                  key={it.label}
                  title={it.note}
                  className="flex items-center gap-1.5 text-[9px] leading-none text-[var(--color-fg)]"
                >
                  <Swatch mark={it.mark} />
                  <span className="truncate">{it.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <p className="mt-1.5 text-[9px] leading-snug text-[var(--color-subtle)]">
        Solid box = zone still live · dashed edge = a tighter array inside one
        already drawn · struck through = dead for the session. Hover any item
        for what it means.
      </p>
    </div>
  );
}
