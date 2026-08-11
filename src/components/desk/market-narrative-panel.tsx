import {
  Droplets,
  GitBranch,
  MapPin,
  ShieldAlert,
  Target,
} from "lucide-react";
import type { MarketNarrative } from "@/lib/trading/market-narrative";
import { narrativeCoachLines } from "@/lib/trading/market-narrative";
import { cn } from "@/lib/utils";

function confTone(c: MarketNarrative["confirmation"]): string {
  if (c === "armed_entry") return "text-[var(--color-up)]";
  if (c === "confirmed") return "text-[var(--color-primary)]";
  if (c === "sweep_only") return "text-[var(--color-warn)]";
  return "text-[var(--color-muted)]";
}

function classTone(c: MarketNarrative["class"]): string {
  if (c === "continuation") return "text-[var(--color-up)]";
  if (c === "reversal") return "text-[var(--color-down)]";
  if (c === "range_chop") return "text-[var(--color-warn)]";
  return "text-[var(--color-muted)]";
}

function BookCard({
  label,
  n,
}: {
  label: string;
  n: MarketNarrative;
}) {
  const lines = narrativeCoachLines(n);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-xs font-semibold text-[var(--color-fg)]">
          {label}
        </p>
        <div className="flex flex-wrap gap-1.5 text-[10px] font-mono">
          <span className={cn("rounded border border-[var(--color-border)] px-1.5 py-0.5", classTone(n.class))}>
            {n.class}
          </span>
          <span className={cn("rounded border border-[var(--color-border)] px-1.5 py-0.5", confTone(n.confirmation))}>
            {n.confirmation}
          </span>
          <span className="rounded border border-[var(--color-border)] px-1.5 py-0.5 text-[var(--color-subtle)]">
            {n.entryModel}
          </span>
        </div>
      </div>

      <p className="text-[12px] leading-relaxed text-[var(--color-fg)]">
        {n.thesis}
      </p>

      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
          <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            <Droplets className="h-3 w-3" />
            Liquidity
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-muted)]">
            Last: {n.liquidity.lastSweepLabel ?? "none"}
          </p>
          <p className="font-mono text-[10px] text-[var(--color-subtle)]">
            BSL {n.liquidity.nearestBsl?.toFixed(2) ?? "—"} · SSL{" "}
            {n.liquidity.nearestSsl?.toFixed(2) ?? "—"}
          </p>
        </div>
        <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
          <p className="flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            <Target className="h-3 w-3" />
            Draw on liquidity
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-[var(--color-fg)]">
            {n.dol.direction.toUpperCase()} → {n.dol.target}
          </p>
          <p className="text-[10px] text-[var(--color-subtle)]">{n.dol.reason}</p>
        </div>
      </div>

      <ul className="mt-2 space-y-0.5 text-[11px] text-[var(--color-muted)]">
        {n.sequence.map((s) => (
          <li key={s} className="flex gap-1.5">
            <GitBranch className="mt-0.5 h-3 w-3 shrink-0 text-[var(--color-primary)]" />
            <span>{s}</span>
          </li>
        ))}
      </ul>

      {n.waitFor.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] text-[var(--color-warn)]">
          <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Wait: {n.waitFor.slice(0, 3).join(" · ")}
        </p>
      )}

      <p className="mt-2 text-[10px] text-[var(--color-subtle)]">
        Preferred models (alone): {n.preferredStrategies.join(" · ")}
        {n.dealingZone ? ` · dealing ${n.dealingZone}` : ""}
        {n.killzoneOk ? " · in window" : " · outside KZ"}
      </p>

      <p className="mt-1 text-[10px] text-[var(--color-subtle)]">
        {lines[lines.length - 1]}
      </p>
    </div>
  );
}

export function MarketNarrativePanel({
  left,
  right,
  leftLabel,
  rightLabel,
  summary,
}: {
  left: MarketNarrative;
  right: MarketNarrative;
  leftLabel: string;
  rightLabel: string;
  summary: string;
}) {
  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_22%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex items-start gap-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)] text-[var(--color-primary)]">
          <MapPin className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            Liquidity · confirmation · entry
          </h2>
          <p className="text-[11px] text-[var(--color-subtle)]">
            SMC/ICT narrative — sweep ≠ entry · DOL maps targets · models graded alone
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-[var(--color-muted)]">
            {summary}
          </p>
        </div>
      </header>

      <div className="grid gap-3 lg:grid-cols-2">
        <BookCard label={leftLabel} n={left} />
        <BookCard label={rightLabel} n={right} />
      </div>

      <div className="mt-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-primary)_5%,transparent)] px-3 py-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Hard rules
        </p>
        <ul className="mt-1 grid gap-0.5 text-[10px] text-[var(--color-muted)] sm:grid-cols-2">
          {left.rules.slice(0, 6).map((r) => (
            <li key={r}>· {r}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
