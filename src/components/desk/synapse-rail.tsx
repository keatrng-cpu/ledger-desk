import { useDeskSynapse, type SynapseTab } from "@/lib/trading/desk-synapse";
import { cn } from "@/lib/utils";
import { Activity, Link2 } from "lucide-react";

const TAB_LABEL: Record<SynapseTab, string> = {
  brain: "Brain",
  trade: "Trade",
  swing: "Swing",
  path: "Path",
  backtest: "BT",
  tape: "Tape",
  risk: "Risk",
  lab: "Lab",
};

/** Compact cross-tab feed — show on every category */
export function SynapseRail({ tab }: { tab: SynapseTab }) {
  const feeds = useDeskSynapse((s) => s.feeds);
  const posture = useDeskSynapse((s) => s.posture);
  const fused = useDeskSynapse((s) => s.fusedSetups);
  const updatedAt = useDeskSynapse((s) => s.updatedAt);
  const lines = feeds[tab] ?? [];
  const others = (Object.keys(TAB_LABEL) as SynapseTab[]).filter(
    (t) => t !== tab,
  );

  return (
    <div className="mb-4 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_5%,var(--color-surface))] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <Link2 className="h-3.5 w-3.5" />
          Synapse · all tabs linked
          <span className="inline-flex items-center gap-1 font-mono font-normal normal-case text-[var(--color-subtle)]">
            <Activity className="h-3 w-3 animate-pulse" />
            live
          </span>
        </p>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold",
            posture.verdict === "TAKE"
              ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
              : posture.verdict === "REDUCE"
                ? "border-[color-mix(in_oklab,var(--color-warn)_40%,var(--color-border))] text-[var(--color-warn)]"
                : "border-[var(--color-border)] text-[var(--color-muted)]",
          )}
        >
          {posture.verdict}
        </span>
      </div>
      <p className="text-[12px] font-medium text-[var(--color-fg)]">
        {posture.line}
      </p>
      <p className="mt-0.5 text-[11px] text-[var(--color-muted)]">
        {posture.pathPace}
        {posture.bookWr != null
          ? ` · book WR ${(posture.bookWr * 100).toFixed(0)}%`
          : ""}
        {fused[0]
          ? ` · fused ${fused[0].symbol} ${fused[0].side} ${fused[0].fusedScore.toFixed(2)}`
          : ""}
      </p>
      {lines.length > 0 && (
        <ul className="mt-2 space-y-0.5 border-t border-[var(--color-border)] pt-2 text-[11px] text-[var(--color-muted)]">
          {lines.slice(0, 4).map((l) => (
            <li key={l} className="flex gap-1.5">
              <span className="text-[var(--color-primary)]">↗</span>
              <span>{l}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex flex-wrap gap-1">
        <span className="text-[9px] uppercase text-[var(--color-subtle)]">
          Prefer
        </span>
        {posture.prefer.map((p) => (
          <span
            key={p}
            className="rounded bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-up)]"
          >
            {p}
          </span>
        ))}
        <span className="ml-1 text-[9px] uppercase text-[var(--color-subtle)]">
          Avoid
        </span>
        {posture.avoid.slice(0, 3).map((p) => (
          <span
            key={p}
            className="rounded bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--color-down)]"
          >
            {p}
          </span>
        ))}
      </div>
      <p className="mt-1.5 text-[9px] text-[var(--color-subtle)]">
        Cross-feed: {others.map((t) => TAB_LABEL[t]).join(" · ")}
        {updatedAt
          ? ` · synced ${new Date(updatedAt).toLocaleTimeString()}`
          : ""}
      </p>
    </div>
  );
}
