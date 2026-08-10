import { CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type DatePreset,
  DATA_ANCHOR,
  DATA_START,
  rangeForPreset,
} from "@/lib/data/sample-revenue";
import { cn } from "@/lib/utils";

const PRESETS: { id: DatePreset; label: string }[] = [
  { id: "7d", label: "7D" },
  { id: "30d", label: "30D" },
  { id: "90d", label: "90D" },
  { id: "ytd", label: "YTD" },
  { id: "12m", label: "12M" },
];

interface DateRangeFilterProps {
  preset: DatePreset;
  from: string;
  to: string;
  onPreset: (p: DatePreset) => void;
  onCustom: (from: string, to: string) => void;
}

export function DateRangeFilter({
  preset,
  from,
  to,
  onPreset,
  onCustom,
}: DateRangeFilterProps) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm text-[var(--color-muted)]">
        <CalendarRange className="h-4 w-4 shrink-0 text-[var(--color-primary)]" aria-hidden />
        <span className="font-mono text-xs tabular text-[var(--color-subtle)] sm:text-sm">
          {from} → {to}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div
          className="inline-flex rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-1"
          role="group"
          aria-label="Date range presets"
        >
          {PRESETS.map((p) => {
            const active = preset === p.id;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onPreset(p.id)}
                className={cn(
                  "min-h-9 min-w-11 rounded-[calc(var(--radius-md)-2px)] px-3 text-xs font-medium transition-colors duration-150",
                  active
                    ? "bg-[var(--color-surface-3)] text-[var(--color-fg)] shadow-sm"
                    : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
                )}
              >
                {p.label}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-1.5">
          <label className="sr-only" htmlFor="from-date">
            From
          </label>
          <input
            id="from-date"
            type="date"
            min={DATA_START}
            max={to}
            value={from}
            onChange={(e) => {
              const v = e.target.value;
              if (v && v <= to) onCustom(v, to);
            }}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 font-mono text-xs text-[var(--color-fg)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <span className="text-[var(--color-subtle)]">–</span>
          <label className="sr-only" htmlFor="to-date">
            To
          </label>
          <input
            id="to-date"
            type="date"
            min={from}
            max={DATA_ANCHOR}
            value={to}
            onChange={(e) => {
              const v = e.target.value;
              if (v && v >= from) onCustom(from, v);
            }}
            className="h-9 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 font-mono text-xs text-[var(--color-fg)] outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="hidden md:inline-flex"
          onClick={() => {
            const r = rangeForPreset("30d");
            onPreset("30d");
            onCustom(r.from, r.to);
          }}
        >
          Reset
        </Button>
      </div>
    </div>
  );
}
