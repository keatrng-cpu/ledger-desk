import type { DeskPayload } from "@/lib/trading/build-desk";

/**
 * A small live example: the last bars of today's desk tape for the book the
 * desk is reading (or the left index when there is none), with that book's
 * primary draw on liquidity dashed in. Real desk data only — when the tape is
 * empty it says so instead of drawing anything.
 */
export function LiveExampleChart({ desk }: { desk: DeskPayload }) {
  const bookSym = desk.smcMaster.oneBook?.symbol;
  const useRight = bookSym != null && bookSym === desk.right?.symbol;
  const series = useRight ? desk.right : desk.left;
  const draw = useRight ? desk.draws?.right : desk.draws?.left;
  const bars = (series?.bars ?? []).slice(-36);
  const W = 200;
  const H = 120;
  if (bars.length < 5) {
    return (
      <div className="rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] px-2 py-3 text-[11px] text-[var(--color-subtle)]">
        Live example appears once today&apos;s tape has a few bars.
      </div>
    );
  }
  const drawPx = draw?.primary?.price;
  const hi = Math.max(...bars.map((b) => b.h), ...(drawPx != null ? [drawPx] : []));
  const lo = Math.min(...bars.map((b) => b.l), ...(drawPx != null ? [drawPx] : []));
  const span = hi - lo || 1;
  const y = (p: number) => 4 + ((hi - p) / span) * (H - 8);
  const step = W / bars.length;
  const bw = Math.max(1.5, step * 0.6);
  return (
    <figure className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
      <figcaption className="mb-1 flex items-baseline justify-between gap-1 text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">
        <span>
          {series.source === "live_gateway"
            ? "Live"
            : series.source === "yahoo"
              ? "Yahoo (delayed)"
              : series.source === "databento"
                ? "Databento"
                : series.source === "synthetic"
                  ? "Synthetic"
                  : series.source}{" "}
          · {series.symbol} · {series.interval}
        </span>
        <span className="font-mono normal-case">{series.price.toFixed(2)}</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Last ${bars.length} ${series.interval} bars of ${series.symbol}`}>
        {drawPx != null && (
          <line x1={0} x2={W} y1={y(drawPx)} y2={y(drawPx)} stroke="var(--color-primary)" strokeDasharray="3 3" strokeWidth={0.8} />
        )}
        {bars.map((b, i) => {
          const up = b.c >= b.o;
          const col = up ? "var(--color-up)" : "var(--color-down)";
          const cx = i * step + step / 2;
          const top = y(Math.max(b.o, b.c));
          const bot = y(Math.min(b.o, b.c));
          return (
            <g key={b.t}>
              <line x1={cx} x2={cx} y1={y(b.h)} y2={y(b.l)} stroke={col} strokeWidth={0.7} />
              <rect x={cx - bw / 2} y={top} width={bw} height={Math.max(0.8, bot - top)} fill={col} />
            </g>
          );
        })}
      </svg>
      {drawPx != null && draw?.primary && (
        <p className="mt-1 text-[10px] text-[var(--color-muted)]">
          <span className="text-[var(--color-primary)]">- -</span> draw: {draw.primary.name} {drawPx.toFixed(2)}
        </p>
      )}
    </figure>
  );
}
