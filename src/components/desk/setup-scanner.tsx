import { AlertTriangle, CheckCircle2, NotebookPen, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ScanResult, SetupCandidate } from "@/lib/trading/scanner";
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

function SetupCard({
  c,
  onLog,
  entryAllowed = true,
}: {
  c: SetupCandidate;
  onLog?: (c: SetupCandidate) => void;
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
        <div>
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
                <AlertTriangle className="h-3 w-3" /> risk gate — no entries
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-[var(--color-subtle)]">{c.title}</p>
        </div>
        <div className="flex items-start gap-2">
          <div className="text-right font-mono">
            <p className="text-lg font-semibold tabular text-[var(--color-fg)]">
              {c.confluence.toFixed(2)}
            </p>
            <p className="text-[10px] text-[var(--color-subtle)]">pre-score</p>
          </div>
          {onLog && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => onLog(c)}
              title={
                entryAllowed
                  ? "Log this setup to the journal"
                  : "Risk gate active — journal it as a skip"
              }
            >
              <NotebookPen className="h-3.5 w-3.5" />
              Log
            </Button>
          )}
        </div>
      </div>

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

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-up)]">
            Present
          </p>
          <ul className="space-y-0.5 text-xs text-[var(--color-muted)]">
            {c.reasons.slice(0, 4).map((r) => (
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
            {c.missing.slice(0, 4).map((r) => (
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
  /** Opens the journal dialog for a candidate. Journaling skips is valuable too. */
  onLog?: (c: SetupCandidate) => void;
  /** False when the risk governor has halted entries (daily/weekly/KZ cap). */
  entryAllowed?: boolean;
}) {
  return (
    <section>
      <header className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
            2 · Active setup scanner
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Desk pre-score — NOT engine confluence; engine floor 0.75 never
            cleared in calibration · floor {scan.floor} · A+ ≥ {scan.aPlus} ·
            rules decide, never the LLM
          </p>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-2.5 py-1 text-[11px] text-[var(--color-muted)]">
          <Target className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {scan.smt.state.replace(/_/g, " ")}
        </div>
      </header>

      <div className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-muted)]">
        <span className="font-medium text-[var(--color-primary)]">SMT · </span>
        {scan.smt.note}
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
        {scan.candidates.map((c) => (
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
