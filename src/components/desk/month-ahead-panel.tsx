import { CalendarDays } from "lucide-react";
import type {
  MonthAheadRead,
  MonthBookLevels,
  MonthLiq,
  MonthPhase,
} from "@/lib/trading/month-ahead";
import { cn } from "@/lib/utils";

function px(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function BookCol({ label, b }: { label: string; b: MonthBookLevels }) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </p>
      <p className="mt-0.5 font-mono text-sm text-[var(--color-fg)]">
        settle {px(b.settle)}
        {b.live ? (
          <span className="ml-1.5 text-[10px] font-sans uppercase tracking-wider text-[var(--color-up)]">
            live
          </span>
        ) : null}
      </p>
      <p className="font-mono text-[11px] text-[var(--color-muted)]">
        PWH {px(b.pwh)} · EQ {px(b.eq)} · PWL {px(b.pwl)}
      </p>
      {(b.cmh != null || b.cml != null) && (
        <p className="font-mono text-[11px] text-[var(--color-fg)]">
          CMH {b.cmh != null ? px(b.cmh) : "—"} · CML{" "}
          {b.cml != null ? px(b.cml) : "—"}
        </p>
      )}
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">
        ↑ {b.drawUp}
      </p>
      <p className="text-[11px] leading-snug text-[var(--color-muted)]">
        ↓ {b.drawDown}
      </p>
    </div>
  );
}

function LiqLine({ title, l }: { title: string; l: MonthLiq }) {
  return (
    <p className="font-mono text-[10px] leading-snug text-[var(--color-subtle)]">
      <span className="text-[var(--color-muted)]">{title}</span> BSL {l.bsl.join(" · ")}{" "}
      · IRL {l.irl.join(" · ")} · SSL {l.ssl.join(" · ")}
    </p>
  );
}

function PhaseRow({
  p,
  active,
  next,
}: {
  p: MonthPhase;
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
          {p.label}
          {active ? " · now" : next ? " · next" : ""}
        </p>
        <p className="font-mono text-[10px] text-[var(--color-subtle)]">
          {p.start.slice(5)}–{p.end.slice(5)}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">{p.dailyBias}</p>
      {(active || next) && (
        <div className="mt-1.5 space-y-1 text-[12px] leading-snug text-[var(--color-fg)]">
          <p>{p.character}</p>
          <p className="text-[var(--color-muted)]">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--color-subtle)]">
              Strategy ·{" "}
            </span>
            {p.strategy}
          </p>
          <p className="text-[11px] text-[var(--color-muted)]">
            Book {p.book} · {p.pathQuota}
          </p>
          <p className="text-[var(--color-warn)]">Skip if: {p.skipIf}</p>
          <p className="font-mono text-[10px] text-[var(--color-subtle)]">
            {p.blackouts}
          </p>
        </div>
      )}
    </article>
  );
}

export function MonthAheadPanel({ month }: { month: MonthAheadRead | null }) {
  if (!month) return null;
  const { plan, phase, nextPhase, window } = month;
  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-warn)_28%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-2 flex items-start gap-2">
        <CalendarDays className="mt-0.5 h-4 w-4 shrink-0 text-[var(--color-warn)]" />
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">
            Month ahead · {plan.monthLabel}
            {month.live ? " · live tape" : ""}
          </h3>
          <p className="text-[11px] text-[var(--color-muted)]">
            {window === "prep" ? "Sunday prep — cash opens this month" : plan.headline}
          </p>
        </div>
      </header>

      <p className="text-[12px] leading-snug text-[var(--color-fg)]">{plan.thesis}</p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-muted)]">
        {plan.htfBias}
      </p>
      <p className="mt-1 text-[11px] leading-snug text-[var(--color-warn)]">
        {plan.fed}
      </p>
      <p className="mt-1 text-[11px] text-[var(--color-subtle)]">{plan.seasonality}</p>

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <BookCol label="NQ / MNQ (primary)" b={plan.nq} />
        <BookCol label="ES (SMT companion)" b={plan.es} />
      </div>
      <div className="mt-1.5 space-y-0.5">
        <LiqLine title="NQ" l={plan.liqNq} />
        <LiqLine title="ES" l={plan.liqEs} />
      </div>

      <div className="mt-2 space-y-1.5">
        {plan.phases.map((p) => (
          <PhaseRow
            key={p.id}
            p={p}
            active={phase?.id === p.id}
            next={nextPhase?.id === p.id && !phase}
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
        {plan.rules.slice(0, 5).map((f) => (
          <li key={f}>· {f}</li>
        ))}
      </ul>
    </section>
  );
}
