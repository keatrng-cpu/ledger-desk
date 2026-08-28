import { Radio } from "lucide-react";
import type { LiveSays } from "@/lib/trading/live-says";
import { cn } from "@/lib/utils";

export function LiveSaysPanel({ says }: { says: LiveSays }) {
  const body = {
    live: says.live,
    window: says.window,
    asOf: says.asOf,
    source: says.source,
    lagSec: says.lagSec,
    mnq: says.mnq,
    es: says.es,
    htf: says.htf,
    smt: says.smt,
    path: says.path,
  };

  return (
    <div
      className={cn(
        "rounded-[var(--radius-md)] border p-3 font-mono",
        says.live
          ? "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_8%,transparent)]"
          : "border-[var(--color-border)] bg-[var(--color-surface)]",
      )}
    >
      <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--color-subtle)]">
        <Radio
          className={cn(
            "h-3.5 w-3.5",
            says.live ? "text-[var(--color-up)]" : "text-[var(--color-subtle)]",
          )}
        />
        Live data says
        <span
          className={cn(
            "ml-auto rounded-full border px-1.5 py-0.5 text-[9px]",
            says.live
              ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
              : "border-[var(--color-border)] text-[var(--color-subtle)]",
          )}
        >
          {says.live ? "LIVE" : "NOT LIVE"}
        </span>
      </p>
      <pre className="overflow-x-auto whitespace-pre text-[11px] leading-relaxed text-[var(--color-fg)]">
        {JSON.stringify(body, null, 2)}
      </pre>
      <p className="mt-1.5 text-[10px] font-sans leading-relaxed text-[var(--color-muted)]">
        {says.reason}
      </p>
    </div>
  );
}
