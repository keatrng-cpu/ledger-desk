/**
 * Evidence as small bar strips: one row per bucket, the bar is the measured
 * value, losing buckets are red. The text a bucket used to print in full sits
 * behind an expand. Values are the evidence pack's / shadow book's own
 * numbers — this only draws them.
 */
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface StripRow {
  key: string;
  label: string;
  /** The measured value (e.g. R per card, or a win rate 0–1). Null = not measured. */
  value: number | null;
  /** How the value prints next to the bar. */
  valueText: string;
  /** Sample size, printed small. */
  n?: number | null;
  tone: "good" | "bad" | "neutral";
  /** The full sentence, shown on expand. */
  detail?: string;
}

/**
 * `mode="signed"` centres zero (R per card: left red, right green);
 * `mode="rate"` fills 0→1 (win rate).
 */
export function BarStrip({
  rows,
  mode = "signed",
  title,
  scale,
  className,
}: {
  rows: StripRow[];
  mode?: "signed" | "rate";
  title?: string;
  /** Max |value| for signed mode; defaults to the largest in the rows. */
  scale?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const max = scale ?? Math.max(1e-6, ...rows.map((r) => Math.abs(r.value ?? 0)));
  const color = (t: StripRow["tone"]) =>
    t === "bad" ? "var(--color-down)" : t === "good" ? "var(--color-up)" : "var(--color-subtle)";
  const anyDetail = rows.some((r) => r.detail);
  return (
    <div className={cn("min-w-0", className)}>
      {title && (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          {title}
        </p>
      )}
      <ul className="space-y-1">
        {rows.map((r) => {
          const v = r.value;
          const w =
            v == null
              ? 0
              : mode === "rate"
                ? Math.max(0, Math.min(1, v)) * 100
                : (Math.min(Math.abs(v), max) / max) * 50;
          return (
            <li
              key={r.key}
              className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-2"
              title={r.detail}
            >
              <span className="truncate text-[12px] text-[var(--color-fg)]">{r.label}</span>
              <span className="relative h-2.5 rounded-sm bg-[var(--color-surface-3)]">
                {mode === "signed" && (
                  <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border-strong)]" />
                )}
                {v != null && (
                  <span
                    className="absolute inset-y-0 rounded-sm"
                    style={{
                      background: color(r.tone),
                      width: `${w}%`,
                      left: mode === "rate" ? 0 : v >= 0 ? "50%" : `${50 - w}%`,
                      transition: "width 500ms",
                    }}
                  />
                )}
              </span>
              <span
                className="whitespace-nowrap font-mono text-[12px]"
                style={{ color: color(r.tone) }}
              >
                {r.valueText}
                {r.n != null && (
                  <span className="ml-1 text-[10px] text-[var(--color-muted)]">n{r.n}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
      {anyDetail && (
        <>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            className="mt-1 inline-flex items-center gap-1 text-[11px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            <ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
            {open ? "Hide detail" : "Detail"}
          </button>
          {open && (
            <ul className="mt-1 space-y-0.5">
              {rows
                .filter((r) => r.detail)
                .map((r) => (
                  <li
                    key={r.key}
                    className="text-[12px] leading-snug"
                    style={{
                      color:
                        r.tone === "bad"
                          ? "var(--color-down)"
                          : r.tone === "good"
                            ? "var(--color-up)"
                            : "var(--color-muted)",
                    }}
                  >
                    {r.detail}
                  </li>
                ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
