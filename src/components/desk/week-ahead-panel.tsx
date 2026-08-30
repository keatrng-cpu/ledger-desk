import { CalendarRange } from "lucide-react";
import type { WeekAheadRead, WeekBookLevels, WeekDayPlan } from "@/lib/trading/week-ahead";
import { cn } from "@/lib/utils";

function px(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function BookCol({ label, b }: { label: string; b: WeekBookLevels }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm text-[var(--color-fg)]">
        settle {px(b.settle)}
      </p>
      <p className="font-mono text-[11px] text-[var(--color-muted)]">
        PWH {px(b.pwh)} · EQ {px(b.eq)} · PWL {px(b.pwl)}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">
        ↑ {b.drawUp}
      </p>
      <p className="text-[11px] leading-snug text-[var(--color-muted)]">
        ↓ {b.drawDown}
      </p>
      <p className="mt-1 text-[10px] text-[var(--color-subtle)]">{b.note}</p>
    </div>
  );
}

function DayRow({
  d,
  active,
  next,
}: {
  d: WeekDayPlan;
  active: boolean;
  next: boolean;
}) {
  return (
    <article
      className={cn(
        "rounded-[var(--radius-sm)] border px-2.5 py-2",
        active &&
          "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_8%,transparent)]",
        next &&
          !active &&
          "border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))]",
        !active && !next && "border-[var(--color-border)]",
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-fg)]">
          {d.weekday} {d.date.slice(5)}
          {active ? " · today" : next ? " · next" : ""}
        </p>
        <p className="text-[11px] text-[var(--color-muted)]">{d.dailyBias}</p>
      </div>
      <p className="mt-1 font-mono text-[10px] text-[var(--color-subtle)]">
        {d.news.map((n) => `${n.timeEt} ${n.name}`).join(" · ") || "No high-impact"}
      </p>
      {(active || next) && (
        <div className="mt-1.5 space-y-1 text-[12px] leading-snug text-[var(--color-fg)]">
          <p>{d.likelyTape}</p>
          <p className="text-[var(--color-muted)]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">
              Trade ·{" "}
            </span>
            {d.trade}
          </p>
          <p className="text-[var(--color-warn)]">
            Skip if: {d.skipIf}
          </p>
          <p className="text-[10px] text-[var(--color-subtle)]">{d.pathNote}</p>
        </div>
      )}
    </article>
  );
}

export function WeekAheadPanel({ week }: { week: WeekAheadRead | null }) {
  if (!week) return null;
  const { plan, today, next, phase } = week;
  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-2 flex items-start gap-2">
        <CalendarRange className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-primary)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">
            Week ahead · {plan.weekLabel}
          </h3>
          <p className="text-[11px] text-[var(--color-muted)]">
            {phase === "prep" ? "Sunday prep — cash opens Mon" : plan.headline}
          </p>
        </div>
      </header>

      <p className="text-[12px] leading-snug text-[var(--color-fg)]">{plan.htfBias}</p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">
        {plan.macro}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-warn)]">
        {plan.asymmetry}
      </p>
      <p className="mt-1 text-[11px] text-[var(--color-subtle)]">{plan.po3}</p>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <BookCol label="NQ / MNQ (primary book)" b={plan.nq} />
        <BookCol label="ES (stronger, SMT companion)" b={plan.es} />
      </div>

      <div className="mt-2 space-y-1.5">
        {plan.days.map((d) => (
          <DayRow
            key={d.date}
            d={d}
            active={today?.date === d.date}
            next={next?.date === d.date && !today}
          />
        ))}
      </div>

      <ul className="mt-2 flex flex-wrap gap-1.5">
        {plan.outcomes.map((o) => (
          <li
            key={o.name}
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 font-mono text-[10px] text-[var(--color-muted)]"
            title={o.detail}
          >
            {o.p}% {o.name}
          </li>
        ))}
      </ul>
      <ul className="mt-2 space-y-0.5 text-[10px] text-[var(--color-subtle)]">
        {plan.filters.slice(0, 4).map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
    </section>
  );
}
