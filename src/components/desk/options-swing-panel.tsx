import { useMemo } from "react";
import {
  CalendarClock,
  CheckCircle2,
  Circle,
  Layers,
  ShieldAlert,
  Sparkles,
  XCircle,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import {
  evaluateOptionsSwing,
  optionsSwingPlaybook,
  swingVerdictTone,
  type SwingVerdict,
} from "@/lib/trading/options-swing";
import { cn } from "@/lib/utils";
import { useDeskSynapse } from "@/lib/trading/desk-synapse";

function verdictClass(v: SwingVerdict): string {
  const t = swingVerdictTone(v);
  if (t === "up")
    return "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)] text-[var(--color-up)]";
  if (t === "down")
    return "border-[color-mix(in_oklab,var(--color-down)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] text-[var(--color-down)]";
  if (t === "warn")
    return "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]";
  return "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]";
}

export function OptionsSwingPanel({ desk }: { desk: DeskPayload }) {
  const signal = useMemo(() => evaluateOptionsSwing(desk), [desk]);
  const posture = useDeskSynapse((s) => s.posture);
  const tradeFeed = useDeskSynapse((s) => s.feeds.trade);
  const pathFeed = useDeskSynapse((s) => s.feeds.path);
  const playbook = useMemo(() => optionsSwingPlaybook(), []);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--color-primary)_28%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--color-primary)_14%,transparent)] text-[var(--color-primary)]">
            <Layers className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              Options swing · Robinhood
            </h2>
            <p className="text-[11px] text-[var(--color-subtle)]">
              Long debit only · SPY←ES · QQQ←NQ · arms only when time occurs
            </p>
          </div>
        </div>
        <span
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-[11px] font-bold tracking-wide",
            verdictClass(signal.verdict),
          )}
        >
          {signal.verdict}
        </span>
      </header>

      <p className="mb-2 text-[11px] text-[var(--color-muted)]">
        Cross-tab: {posture.verdict} · {tradeFeed[0] ?? "—"} · {pathFeed[0] ?? "—"}
      </p>
      {/* Time occurs banner */}
      <div
        className={cn(
          "mb-3 rounded-[var(--radius-md)] border px-3 py-2.5",
          signal.timeOccurs
            ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_10%,var(--color-surface-2))]"
            : "border-[var(--color-border)] bg-[var(--color-surface-2)]",
        )}
      >
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <CalendarClock className="h-3.5 w-3.5" />
          {signal.timeOccurs ? "Time occurs — swing armed" : "Waiting for time"}
        </p>
        <p className="mt-1 text-sm font-medium text-[var(--color-fg)]">
          {signal.focus}
        </p>
        <p className="mt-1 text-[11px] text-[var(--color-muted)]">
          {signal.timing.label} · conf{" "}
          {(signal.confidence * 100).toFixed(0)}% · HTF {signal.htf}
          {signal.dealing ? ` · ${signal.dealing}` : ""}
        </p>
      </div>

      {/* Plan card */}
      {signal.plan && (
        <div className="mb-3 grid gap-2 sm:grid-cols-2">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
              Robinhood ticket
            </p>
            <p className="mt-1 font-mono text-sm text-[var(--color-fg)]">
              BUY {signal.plan.side.toUpperCase()} {signal.plan.underlier}
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
              <li>
                DTE {signal.plan.dteMin}–{signal.plan.dteMax} (target ~
                {signal.plan.dteTarget})
              </li>
              <li>
                Delta ~{signal.plan.deltaMin}–{signal.plan.deltaMax}
              </li>
              <li>
                Max premium ${signal.plan.riskDollars.toLocaleString()} (
                {(signal.plan.riskPct * 100).toFixed(2)}%)
              </li>
              <li>
                Hold {signal.plan.holdSessionsMin}–{signal.plan.holdSessionsMax}{" "}
                sessions
              </li>
            </ul>
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
              Manage
            </p>
            <p className="mt-1 text-[11px] text-[var(--color-fg)]">
              <span className="text-[var(--color-subtle)]">Invalid: </span>
              {signal.plan.invalidation}
            </p>
            <ul className="mt-1.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
              {signal.plan.targets.map((t) => (
                <li key={t}>→ {t}</li>
              ))}
            </ul>
            <p className="mt-2 text-[10px] leading-relaxed text-[var(--color-subtle)]">
              {signal.plan.robinhoodNote}
            </p>
          </div>
        </div>
      )}

      {/* Checklist */}
      <div className="mb-3">
        <p className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          <ShieldAlert className="h-3 w-3" />
          When the time occurs (all must pass)
        </p>
        <ul className="grid gap-1 sm:grid-cols-2">
          {signal.checklist.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1.5 text-[11px]"
            >
              {c.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-[var(--color-up)]" />
              ) : (
                <XCircle className="h-3.5 w-3.5 shrink-0 text-[var(--color-down)]" />
              )}
              <span
                className={
                  c.ok ? "text-[var(--color-fg)]" : "text-[var(--color-muted)]"
                }
              >
                {c.label}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
          <p className="text-[9px] uppercase text-[var(--color-up)]">Reasons</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
            {(signal.reasons.length ? signal.reasons : ["—"]).map((r) => (
              <li key={r} className="flex gap-1">
                <Circle className="mt-1 h-2 w-2 shrink-0 text-[var(--color-up)]" />
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded border border-[var(--color-border)] px-2 py-1.5">
          <p className="text-[9px] uppercase text-[var(--color-down)]">Blocks</p>
          <ul className="mt-0.5 space-y-0.5 text-[11px] text-[var(--color-muted)]">
            {(signal.blocks.length ? signal.blocks : ["None"]).map((r) => (
              <li key={r} className="flex gap-1">
                <Circle className="mt-1 h-2 w-2 shrink-0 text-[var(--color-down)]" />
                {r}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_22%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] px-3 py-2">
        <p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <Sparkles className="h-3 w-3" />
          Playbook
        </p>
        <ul className="space-y-0.5 text-[11px] text-[var(--color-muted)]">
          {playbook.map((p) => (
            <li key={p}>· {p}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}
