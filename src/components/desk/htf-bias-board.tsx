import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { HtfBiasRead } from "@/lib/trading/structure";
import { cn } from "@/lib/utils";

function BiasIcon({ b }: { b: string }) {
  if (b === "bull")
    return <ArrowUpRight className="h-4 w-4 text-[var(--color-up)]" />;
  if (b === "bear")
    return <ArrowDownRight className="h-4 w-4 text-[var(--color-down)]" />;
  return <Minus className="h-4 w-4 text-[var(--color-subtle)]" />;
}

function BiasChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]/50 px-2 py-1.5">
      <span className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </span>
      <span
        className={cn(
          "flex items-center gap-1 font-mono text-xs font-semibold uppercase",
          value === "bull" && "text-[var(--color-up)]",
          value === "bear" && "text-[var(--color-down)]",
          value === "neutral" && "text-[var(--color-subtle)]",
        )}
      >
        <BiasIcon b={value} />
        {value}
      </span>
    </div>
  );
}

function Card({ read }: { read: HtfBiasRead }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-sm font-semibold text-[var(--color-fg)]">
            {read.symbol}
          </p>
          <p className="mt-0.5 text-xs text-[var(--color-subtle)]">
            Last {read.last.toLocaleString(undefined, { maximumFractionDigits: 2 })} ·{" "}
            <span
              className={
                read.changePct >= 0
                  ? "text-[var(--color-up)]"
                  : "text-[var(--color-down)]"
              }
            >
              {read.changePct >= 0 ? "+" : ""}
              {read.changePct.toFixed(2)}%
            </span>
          </p>
        </div>
        <div
          className={cn(
            "rounded-full border px-2.5 py-1 font-mono text-xs font-semibold uppercase tracking-wide",
            read.topDown === "bull" &&
              "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]",
            read.topDown === "bear" &&
              "border-[color-mix(in_oklab,var(--color-down)_40%,var(--color-border))] text-[var(--color-down)]",
            read.topDown === "neutral" &&
              "border-[var(--color-border)] text-[var(--color-subtle)]",
          )}
        >
          HTF {read.topDown}
        </div>
      </div>

      <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-[var(--color-bg)]">
        <div
          className={cn(
            "h-full rounded-full",
            read.topDown === "bull" && "bg-[var(--color-up)]",
            read.topDown === "bear" && "bg-[var(--color-down)]",
            read.topDown === "neutral" && "bg-[var(--color-subtle)]",
          )}
          style={{ width: `${Math.round(read.confidence * 100)}%` }}
        />
      </div>
      <p className="mb-3 text-[10px] text-[var(--color-subtle)]">
        Confidence {(read.confidence * 100).toFixed(0)}%
      </p>

      <div className="grid grid-cols-2 gap-1.5">
        <BiasChip label="Daily" value={read.daily} />
        <BiasChip label="Mid" value={read.mid} />
        <BiasChip label="LTF" value={read.ltf} />
        <BiasChip
          label={
            read.sessionStrength
              ? `Sess ${Math.round(read.sessionStrength * 100)}%`
              : "Session"
          }
          value={read.sessionStance ?? "neutral"}
        />
        <BiasChip
          label="Zone"
          value={read.dealing?.zone ?? "—"}
        />
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        {read.summary}
      </p>

      {read.lastBOS && (
        <p className="mt-2 font-mono text-[10px] text-[var(--color-subtle)]">
          Last BOS {read.lastBOS.direction} @{" "}
          {read.lastBOS.level.toLocaleString(undefined, {
            maximumFractionDigits: 2,
          })}
        </p>
      )}
    </div>
  );
}

export function HtfBiasBoard({
  left,
  right,
}: {
  left: HtfBiasRead;
  right: HtfBiasRead;
}) {
  return (
    <section>
      <header className="mb-3 flex items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
            1 · Automatic HTF bias
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Structure-derived top-down — absolute gate for entries (not a weighted guess)
          </p>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Card read={left} />
        <Card read={right} />
      </div>
    </section>
  );
}
