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
      {/* ONE chip: the word is never split; the background is split in two
          colours (left = one read's direction, right = the other's). */}
      <span
        className="inline-block shrink-0 whitespace-nowrap rounded-full border border-[var(--color-border-strong)] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-[var(--color-bg)]"
        style={{ background: `linear-gradient(90deg, ${DIR[c.a.dir]} 0 50%, ${DIR[c.b.dir]} 50% 100%)` }}
        aria-label={`Conflict on ${c.symbol}: ${c.a.label} versus ${c.b.label}`}
      >
        Conflict
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
