/**
 * Today and the next 14 days as one horizontal strip with an event pin per
 * scheduled release / report (src/lib/news/schedule.ts — the official
 * calendar, nothing invented). Colour = kind; hover a pin for the time and
 * what it means for an option held through it.
 */
import type { TimelineEvent } from "@/lib/news/schedule";

const KIND: Record<TimelineEvent["kind"], { c: string; label: string }> = {
  fomc: { c: "#ef4444", label: "FOMC" },
  "macro-high": { c: "#f59e0b", label: "high-impact macro" },
  "macro-medium": { c: "#64748b", label: "medium macro" },
  earnings: { c: "#38bdf8", label: "earnings" },
};

function addDays(date: string, n: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

export function NewsTimeline({ today, events }: { today: string; events: TimelineEvent[] }) {
  const days = Array.from({ length: 15 }, (_, i) => addDays(today, i));
  const byDay = new Map<string, TimelineEvent[]>();
  for (const e of events) byDay.set(e.date, [...(byDay.get(e.date) ?? []), e]);
  return (
    <section className="min-w-0 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
      <div className="mb-2 flex flex-wrap items-center gap-3">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Today → next 14 days</h3>
        {Object.values(KIND).map((k) => (
          <span key={k.label} className="flex items-center gap-1 text-[10px] text-[var(--color-muted)]">
            <span className="h-2 w-2 rounded-full" style={{ background: k.c }} />
            {k.label}
          </span>
        ))}
      </div>
      <div className="overflow-x-auto pb-1">
        <ol className="grid min-w-[44rem] grid-cols-[repeat(15,minmax(0,1fr))]">
          {days.map((d, i) => {
            const wd = new Date(`${d}T12:00:00Z`).getUTCDay();
            const weekend = wd === 0 || wd === 6;
            const evs = byDay.get(d) ?? [];
            return (
              <li
                key={d}
                className={`relative border-l border-[var(--color-border)] px-1 pt-1 first:border-l-0 ${weekend ? "opacity-50" : ""} ${i === 0 ? "rounded bg-[color-mix(in_oklab,var(--color-primary)_10%,transparent)]" : ""}`}
              >
                <p className={`text-center text-[10px] tabular-nums ${i === 0 ? "font-bold text-[var(--color-primary)]" : "text-[var(--color-muted)]"}`}>
                  {i === 0 ? "Today" : ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"][wd]}
                  <br />
                  {d.slice(5).replace("-", "/")}
                </p>
                <div className="mt-1 h-px bg-[var(--color-border-strong)]" />
                <ul className="mt-1 flex min-h-8 flex-col items-center gap-1">
                  {evs.map((e) => (
                    <li key={`${e.when}${e.name}`} className="group relative flex w-full justify-center">
                      <button
                        type="button"
                        className="h-3 w-3 rounded-full ring-2 ring-[var(--color-surface-1)] focus:outline-none focus-visible:ring-[var(--color-accent)]"
                        style={{ background: KIND[e.kind].c }}
                        aria-label={`${d} ${e.when} ${e.name}`}
                        title={`${d} ${e.when} ET · ${e.name}${e.qqqWeight ? ` · ${(e.qqqWeight * 100).toFixed(1)}% of QQQ` : ""}\n${e.implication.swing}`}
                      />
                      {(e.kind === "fomc" || e.kind === "macro-high") && (
                        <span className="pointer-events-none mt-3.5 hidden max-w-full truncate text-[9px] leading-tight text-[var(--color-fg)] sm:absolute sm:block">
                          {e.name.replace(/\s*\(.*\)$/, "")}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
