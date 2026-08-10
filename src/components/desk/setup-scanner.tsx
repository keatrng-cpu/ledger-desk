import { useState } from "react";
import { AlertTriangle, CheckCircle2, NotebookPen, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScanResult, SetupCandidate } from "@/lib/trading/scanner";
import { strategyLabel } from "@/lib/trading/strategies";
import { cn } from "@/lib/utils";

function GradeBadge({ g }: { g: SetupCandidate["grade"] }) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase",
        g === "A+" &&
          "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]",
        g === "A-" &&
          "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] text-[var(--color-primary)]",
        g === "B" &&
          "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] text-[var(--color-warn)]",
        g === "skip" && "border-[var(--color-border)] text-[var(--color-subtle)]",
      )}
    >
      {g}
    </span>
  );
}

function StratChip({ id, primary }: { id: string; primary?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide",
        primary
          ? "border-[color-mix(in_oklab,var(--color-primary)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] text-[var(--color-primary)]"
          : "border-[var(--color-border)] text-[var(--color-muted)]",
      )}
    >
      {strategyLabel(id)}
    </span>
  );
}

export type LogMode = "paper" | "live";

function SetupCard({
  c,
  onLog,
  entryAllowed = true,
}: {
  c: SetupCandidate;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  entryAllowed?: boolean;
}) {
  return (
    <article
      className={cn(
        "rounded-[var(--radius-md)] border bg-[var(--color-surface)] p-3 sm:p-4",
        c.actionable
          ? "border-[color-mix(in_oklab,var(--color-up)_35%,var(--color-border))]"
          : "border-[var(--color-border)]",
      )}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-[var(--color-fg)]">
              {c.symbol}{" "}
              <span
                className={
                  c.side === "long"
                    ? "text-[var(--color-up)]"
                    : "text-[var(--color-down)]"
                }
              >
                {c.side.toUpperCase()}
              </span>
            </h3>
            <GradeBadge g={c.grade} />
            {c.actionable && entryAllowed && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-up)]">
                <CheckCircle2 className="h-3 w-3" /> actionable
              </span>
            )}
            {c.actionable && !entryAllowed && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-[var(--color-warn)]">
                <AlertTriangle className="h-3 w-3" /> risk gate
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-subtle)]">{c.title}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {c.strategyPrimary ? (
              <StratChip id={c.strategyPrimary} primary />
            ) : (
              <span className="text-[10px] text-[var(--color-subtle)]">
                no strategy tag
              </span>
            )}
            {c.strategies
              .filter((s) => s !== c.strategyPrimary)
              .map((s) => (
                <StratChip key={s} id={s} />
              ))}
          </div>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right font-mono">
            <p className="text-lg font-semibold tabular text-[var(--color-fg)]">
              {c.confluence.toFixed(2)}
            </p>
            <p className="text-[10px] text-[var(--color-subtle)]">engine score</p>
          </div>
          {onLog && (
            <div className="flex flex-col items-stretch gap-1">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onLog(c, "paper")}
                title="Log as PAPER trade (recommended until path proven)"
                className="border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))]"
              >
                <NotebookPen className="h-3.5 w-3.5" />
                Paper
              </Button>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => onLog(c, "live")}
                title={
                  entryAllowed
                    ? "Log as LIVE trade"
                    : "Risk gate active — still journalable as live intent"
                }
                className="text-[var(--color-warn)]"
              >
                Live
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {c.components.slice(0, 10).map((comp) => (
          <span
            key={comp}
            className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-muted)]"
          >
            {comp}
          </span>
        ))}
        {c.components.length > 10 && (
          <span className="text-[9px] text-[var(--color-subtle)]">
            +{c.components.length - 10}
          </span>
        )}
      </div>

      <p className="mb-2 text-[10px] text-[var(--color-subtle)]">
        {c.regime} · {c.volatility} vol · HTF{" "}
        {c.htfOk ? "ok" : "block"} · KZ {c.killzoneOk ? "ok" : "out"} · cond{" "}
        {c.conditionsOk ? "ok" : "block"}
      </p>

      <div className="mb-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            Entry zone
          </p>
          <p className="font-mono text-[var(--color-muted)]">{c.entryZone}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            Invalidation
          </p>
          <p className="font-mono text-[var(--color-muted)]">{c.invalidation}</p>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
            Targets
          </p>
          <p className="font-mono text-[var(--color-muted)]">
            {c.targets.slice(0, 2).join(" · ")}
          </p>
        </div>
      </div>

      {c.strategyWhy.length > 0 && (
        <p className="mb-2 text-[11px] text-[var(--color-muted)]">
          {c.strategyWhy[0]}
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-up)]">
            Present
          </p>
          <ul className="space-y-0.5 text-xs text-[var(--color-muted)]">
            {c.reasons.slice(0, 6).map((r) => (
              <li key={r} className="flex gap-1.5">
                <span className="text-[var(--color-up)]">+</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-down)]">
            Missing
          </p>
          <ul className="space-y-0.5 text-xs text-[var(--color-muted)]">
            {c.missing.slice(0, 6).map((r) => (
              <li key={r} className="flex gap-1.5">
                <span className="text-[var(--color-down)]">−</span>
                {r}
              </li>
            ))}
            {!c.missing.length && (
              <li className="text-[var(--color-subtle)]">— full stack —</li>
            )}
          </ul>
        </div>
      </div>
    </article>
  );
}

export function SetupScanner({
  scan,
  onLog,
  entryAllowed = true,
}: {
  scan: ScanResult;
  onLog?: (c: SetupCandidate, mode: LogMode) => void;
  entryAllowed?: boolean;
}) {
  const [pathOnly, setPathOnly] = useState(true);
  const shown = pathOnly
    ? scan.candidates.filter(
        (c) => c.actionable || c.pathBand === "A+" || c.pathBand === "A" || c.pathBand === "A-" || c.grade === "A+" || c.grade === "A-",
      )
    : scan.candidates;
  const display = pathOnly && shown.length === 0 ? scan.candidates.slice(0, 4) : shown;

  return (
    <section>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
            2 · Active setup scanner
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Profit path: action only A/A+ (calib floor 0.65) · incomplete veto · full catalog · test floor {scan.floor} · A+ ≥ {scan.aPlus}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setPathOnly((v) => !v)}
            className={
              pathOnly
                ? "rounded-full border border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_10%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-up)]"
                : "rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]"
            }
          >
            {pathOnly ? "Path grades only" : "Show all grades"}
          </button>
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]">
            <Target className="h-3.5 w-3.5 text-[var(--color-primary)]" />
            {scan.smt.state.replace(/_/g, " ")}
          </div>
        </div>
      </header>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {scan.catalog.map((id) => (
          <span
            key={id}
            className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-subtle)]"
          >
            {strategyLabel(id)}
          </span>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-primary)]">SMT · </span>
          {scan.smt.note}
        </div>
        <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-primary)]">
            Conditions ·{" "}
          </span>
          L {scan.conditions.left.regime}/{scan.conditions.left.volatility}
          {scan.conditions.left.tradeable ? " ok" : " BLOCK"} · R{" "}
          {scan.conditions.right.regime}/{scan.conditions.right.volatility}
          {scan.conditions.right.tradeable ? " ok" : " BLOCK"}
        </div>
      </div>

      {scan.blocked.length > 0 && (
        <div className="mb-3 flex items-start gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-3 py-2 text-xs text-[var(--color-warn)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <div>
            {scan.blocked.map((b) => (
              <p key={b}>{b}</p>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {display.map((c) => (
          <SetupCard
            key={c.id}
            c={c}
            onLog={onLog}
            entryAllowed={entryAllowed}
          />
        ))}
      </div>
    </section>
  );
}
