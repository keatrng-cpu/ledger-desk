import type { OptionMark } from "@/lib/execution/option-marks";

/** The four live asks, the same numbers the floor and the connector are reading. */
export function OptionMarksStrip({ marks }: { marks: OptionMark[] | null | undefined }) {
  if (!marks?.length) {
    return (
      <p className="mb-2 text-[11px] text-[var(--color-muted)]">
        No live Robinhood ask. The session is not quoting, so nothing here is a price.
      </p>
    );
  }
  const age = Math.max(0, Math.round((Date.now() - Math.min(...marks.map((m) => m.asOfMs))) / 1000));
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {marks.map((m) => (
        <div key={`${m.underlier}-${m.side}`} className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1">
          <p className="text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">
            {m.underlier} {m.strike} {m.side}
          </p>
          <p className="font-mono text-sm text-[var(--color-fg)]">${m.ask.toFixed(2)}</p>
        </div>
      ))}
      <p className="self-end text-[10px] text-[var(--color-muted)]">Robinhood ask · {age}s</p>
    </div>
  );
}
