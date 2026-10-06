import type { CardRead, CommandCardDef } from "./types";
import { cn } from "@/lib/utils";

const STATUS_CLS: Record<CardRead["status"], string> = {
  live: "border-[var(--color-border)]",
  empty: "border-dashed border-[var(--color-border)] opacity-90",
  offline: "border-[color-mix(in_oklab,var(--color-down)_40%,transparent)]",
  stale: "border-[color-mix(in_oklab,var(--color-warn)_40%,transparent)]",
  loading: "border-[var(--color-border)] opacity-70",
};

const CHIP: Record<"up" | "down" | "warn" | "muted", string> = {
  up: "border-[var(--color-up)] text-[var(--color-up)]",
  down: "border-[var(--color-down)] text-[var(--color-down)]",
  warn: "border-[var(--color-warn)] text-[var(--color-warn)]",
  muted: "border-[var(--color-border)] text-[var(--color-muted)]",
};

export function CommandCard({
  def,
  read,
  active,
  onOpen,
}: {
  def: CommandCardDef;
  read: CardRead;
  active?: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={read.title ?? def.label}
      className={cn(
        "flex min-w-[11.5rem] max-w-[16rem] shrink-0 flex-col gap-1 rounded-lg border bg-[var(--color-surface-1)] px-3 py-2 text-left transition-colors hover:border-[var(--color-primary)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] sm:min-w-0 sm:max-w-none",
        STATUS_CLS[read.status],
        active && "border-[var(--color-primary)] ring-1 ring-[var(--color-primary)]",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {def.label}
        </span>
        {read.status !== "live" && (
          <span className="text-[9px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
            {read.status}
          </span>
        )}
      </div>
      <p className="line-clamp-2 text-[12px] font-medium leading-snug text-[var(--color-fg)]">{read.primary}</p>
      {read.chips && read.chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {read.chips.slice(0, 3).map((c, i) => (
            <span
              key={`${c.label}-${i}`}
              className={cn(
                "rounded-full border px-1.5 py-0 text-[9px] font-semibold",
                CHIP[c.tone ?? "muted"],
              )}
            >
              {c.label}
            </span>
          ))}
        </div>
      )}
      {read.lines && read.lines.length > 0 && (
        <ul className="space-y-0.5">
          {read.lines.slice(0, 2).map((line, i) => (
            <li key={i} className="truncate text-[10px] text-[var(--color-muted)]">
              {line}
            </li>
          ))}
        </ul>
      )}
    </button>
  );
}
