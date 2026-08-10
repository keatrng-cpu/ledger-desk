import { AlertTriangle, OctagonX } from "lucide-react";
import type { RiskState } from "@/lib/journal/risk";

/**
 * Governor banner. Full-width red when a daily/weekly loss halt is hit,
 * amber when the per-killzone entry cap is reached. Renders nothing when
 * no gate is active.
 */
export function HaltBanner({ risk }: { risk: RiskState }) {
  if (risk.dailyHaltHit || risk.weeklyHaltHit) {
    const label = risk.weeklyHaltHit
      ? `WEEKLY HALT −5% HIT — flat until Sunday 18:00 ET reset. Discipline is the edge.`
      : `DAILY HALT −2% HIT — no more entries today. Discipline is the edge.`;
    const pnl = risk.weeklyHaltHit ? risk.weekPnl : risk.dayPnl;
    return (
      <div
        role="alert"
        className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-down)_60%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_18%,var(--color-surface))] px-4 py-3"
      >
        <OctagonX className="h-5 w-5 shrink-0 text-[var(--color-down)]" />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-[var(--color-down)]">
            {label}
          </p>
          <p className="font-mono text-xs text-[var(--color-muted)]">
            Realized {risk.weeklyHaltHit ? "week" : "day"} PnL ${pnl.toFixed(2)}{" "}
            · limit −$
            {(risk.weeklyHaltHit ? risk.weeklyLimit : risk.dailyLimit).toFixed(0)}{" "}
            on ${risk.equity.toLocaleString()} equity
          </p>
        </div>
      </div>
    );
  }

  if (risk.killzoneCapHit) {
    return (
      <div
        role="status"
        className="flex w-full items-center gap-3 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_55%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_12%,var(--color-surface))] px-4 py-3"
      >
        <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--color-warn)]" />
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight text-[var(--color-warn)]">
            Killzone cap hit — {risk.entriesThisKillzone}/{risk.killzoneCap}{" "}
            entries this window ({risk.killzoneLabel}).
          </p>
          <p className="text-xs text-[var(--color-muted)]">
            No further setups this killzone. Wait for the next window or journal
            only.
          </p>
        </div>
      </div>
    );
  }

  return null;
}
