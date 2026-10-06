/**
 * A split-colour CONFLICT chip: the left half is one read's colour, the right
 * half the other's (teal = up/bull, red = down/bear), so a disagreement is
 * visible before it is read. The short explanation sits beside it; the full
 * one is the tooltip. Data: detectConflicts (src/lib/ui/entry-state.ts).
 */
import type { Conflict } from "@/lib/ui/entry-state";
import { Plain } from "@/components/desk/plain-text";

const DIR = { up: "var(--color-up)", down: "var(--color-down)" } as const;

export function ConflictChip({ c, showExplain = true }: { c: Conflict; showExplain?: boolean }) {
  return (
    <div className="flex min-w-0 items-start gap-2" title={c.explain}>
      <span
        className="inline-flex shrink-0 overflow-hidden rounded-full border border-[var(--color-border-strong)] text-[11px] font-bold uppercase tracking-wide text-[var(--color-bg)]"
        aria-label={`Conflict on ${c.symbol}: ${c.a.label} versus ${c.b.label}`}
      >
        <span className="px-2 py-0.5" style={{ background: DIR[c.a.dir] }}>
          CON
        </span>
        <span className="px-2 py-0.5" style={{ background: DIR[c.b.dir] }}>
          FLICT
        </span>
      </span>
      {showExplain && (
        <span className="min-w-0 text-[12px] leading-snug text-[var(--color-fg)]">
          <span className="font-mono font-semibold">{c.symbol}</span>{" "}
          <span style={{ color: DIR[c.a.dir] }}>{c.a.label}</span>
          <span className="text-[var(--color-muted)]"> vs </span>
          <span style={{ color: DIR[c.b.dir] }}>{c.b.label}</span>
          <span className="text-[var(--color-muted)]">
            {" — "}
            <Plain>{c.explain.replace(/^[^:]+: /, "")}</Plain>
          </span>
        </span>
      )}
    </div>
  );
}
