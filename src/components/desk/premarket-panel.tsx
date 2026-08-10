import { Sunrise } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { cn } from "@/lib/utils";

export function PremarketPanel({ desk }: { desk: DeskPayload }) {
  const { clock, bias, scan, checklist } = desk;
  const narrative = [
    `${clock.nowEt} — ${clock.sessionPhase}.`,
    bias.left.summary,
    bias.right.summary,
    scan.smt.note,
    scan.focus,
    clock.inTradeWindow
      ? "Trade window open — only take ideas that clear HTF + floor + killzone."
      : "Outside primary window — journal, mark levels, do not force.",
  ];

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
          <Sunrise className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            Premarket / session brief
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Auto-built from live structure + session clock
          </p>
        </div>
      </header>

      <div className="mb-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {checklist.map((c) => (
          <div
            key={c.id}
            className={cn(
              "rounded-[var(--radius-sm)] border px-2.5 py-2",
              c.ok
                ? "border-[color-mix(in_oklab,var(--color-up)_30%,var(--color-border))]"
                : "border-[var(--color-border)]",
            )}
          >
            <p
              className={cn(
                "text-[10px] font-medium uppercase tracking-wider",
                c.ok ? "text-[var(--color-up)]" : "text-[var(--color-subtle)]",
              )}
            >
              {c.ok ? "OK" : "WAIT"} · {c.label}
            </p>
            <p className="mt-0.5 line-clamp-2 text-xs text-[var(--color-muted)]">
              {c.detail}
            </p>
          </div>
        ))}
      </div>

      <ul className="space-y-1.5 text-sm text-[var(--color-muted)]">
        {narrative.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-[var(--color-primary)]">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
