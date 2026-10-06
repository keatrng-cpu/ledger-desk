import { useDeskSynapse, type SynapseTab } from "@/lib/trading/desk-synapse";
import { cn } from "@/lib/utils";
import { Activity, ChevronDown, Link2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StateWord } from "@/components/desk/state-word";
import { displayLead } from "@/lib/ui/state-words";

const TAB_LABEL: Record<SynapseTab, string> = {
  brain: "Brain",
  trade: "Now",
  swing: "Opt",
  path: "Book",
  backtest: "BT",
  tape: "Tape",
  risk: "Risk",
  lab: "Lab",
};

/** Compact cross-tab feed — show on every category */
export function SynapseRail({ tab, className }: { tab: SynapseTab; className?: string }) {
  const feeds = useDeskSynapse((s) => s.feeds);
  const posture = useDeskSynapse((s) => s.posture);
  const fused = useDeskSynapse((s) => s.fusedSetups);
  const updatedAt = useDeskSynapse((s) => s.updatedAt);
  const lines = feeds[tab] ?? [];
  const others = (Object.keys(TAB_LABEL) as SynapseTab[]).filter(
    (t) => t !== tab,
  );

  return (
    <div className={cn("rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))]", className)}>
    <div className="rounded-[var(--radius-md)] border-0 border-[color-mix(in_oklab,var(--color-primary)_25%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_5%,var(--color-surface))] px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          <Link2 className="h-3.5 w-3.5" />
          Synapse · all tabs linked
          <span className="inline-flex items-center gap-1 font-mono font-normal normal-case text-[var(--color-subtle)]">
            <Activity className="h-3 w-3 animate-pulse" />
            live
          </span>
        </p>
        <StateWord raw={posture.verdict} className="text-[10px]" />
      </div>
      <p className="text-[12px] font-medium text-[var(--color-fg)]">
        {displayLead(posture.line)}
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
              <span>{displayLead(l)}</span>
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
    </div>
  );
}

export const SYNAPSE_TABS = Object.keys(TAB_LABEL) as SynapseTab[];

/**
 * The Synapse as ONE header chip ("Synapse · WAIT") that expands into the
 * full box — instead of the same box repeated at the top of Options, Charts,
 * Brain, Book and Lab. Same store, same feed for the tab you are on.
 */
export function SynapseChip({ tab }: { tab: SynapseTab }) {
  const posture = useDeskSynapse((s) => s.posture);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={`Synapse — cross-tab feed for ${TAB_LABEL[tab]}. ${displayLead(posture.line)}`}
        className="flex items-center gap-1.5 rounded-full border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] px-2 py-1 text-[12px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
      >
        <Link2 className="h-3.5 w-3.5 text-[var(--color-primary)]" aria-hidden />
        <span className="hidden xl:inline">Synapse</span>
        <StateWord raw={posture.verdict} className="px-1.5 py-0 text-[10px]" />
        <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-2 w-[min(32rem,90vw)] shadow-2xl">
          <SynapseRail tab={tab} className="bg-[var(--color-surface)]" />
        </div>
      )}
    </div>
  );
}
