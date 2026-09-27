/**
 * Shared bits for the Investments tab. Quiet on purpose: no motion, no
 * flash, no green "go" styling — the other tabs are allowed to shout.
 */

import type { ReactNode } from "react";

export function Card({
  title,
  children,
  tone,
  right,
}: {
  title: string;
  children: ReactNode;
  tone?: "warn";
  right?: ReactNode;
}) {
  return (
    <section
      className={`min-w-0 rounded-lg border p-3 ${
        tone === "warn"
          ? "border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_7%,transparent)]"
          : "border-[var(--color-border)] bg-[var(--color-surface-1)]"
      }`}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-[11px] leading-relaxed">
      <span className="text-[var(--color-muted)]">{label} · </span>
      {children}
    </p>
  );
}

export function Note({ children, tone }: { children: ReactNode; tone?: "warn" | "down" | "muted" }) {
  const cls =
    tone === "warn"
      ? "text-[var(--color-warn)]"
      : tone === "down"
        ? "text-[var(--color-down)]"
        : "text-[var(--color-muted)]";
  return <p className={`text-[11px] leading-relaxed ${cls}`}>{children}</p>;
}

/** A horizontal share bar — for weights, never for a score. */
export function ShareBar({ value, mark, label }: { value: number; mark?: number; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="relative h-1.5 w-full rounded bg-[var(--color-surface-2)]" aria-label={label} role="img">
      <div className="h-1.5 rounded bg-[var(--color-muted)]" style={{ width: `${v * 100}%` }} />
      {mark != null && (
        <div
          className="absolute top-[-2px] h-2.5 w-px bg-[var(--color-warn)]"
          style={{ left: `${Math.max(0, Math.min(1, mark)) * 100}%` }}
        />
      )}
    </div>
  );
}
