/**
 * Formatting and class constants for the Investments tab — kept out of the
 * component file so fast refresh keeps working on the components.
 */

import type { InvestVerdict } from "@/lib/invest/universe";

export const VERDICT_CLS: Record<InvestVerdict, string> = {
  CORE: "border-[color-mix(in_oklab,var(--color-up)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)] text-[var(--color-up)]",
  ADD: "border-[color-mix(in_oklab,var(--color-up)_35%,transparent)] bg-[color-mix(in_oklab,var(--color-up)_8%,transparent)] text-[var(--color-up)]",
  HOLD: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  TRIM: "border-[color-mix(in_oklab,var(--color-warn)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]",
  OUT: "border-[color-mix(in_oklab,var(--color-down)_50%,transparent)] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] text-[var(--color-down)]",
};

export const usd = (n: number) => `${n < 0 ? "-" : ""}$${Math.abs(n).toFixed(2)}`;
export const usd0 = (n: number) =>
  `${n < 0 ? "-" : ""}$${Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
export const pct = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`;
export const signed = (n: number) => `${n >= 0 ? "+" : "-"}$${Math.abs(n).toFixed(2)}`;

export const INPUT =
  "rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2 py-1 text-xs text-[var(--color-fg)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)]";
export const BUTTON =
  "rounded border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] hover:border-[var(--color-accent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40";
export const LINK = "text-[var(--color-accent)] underline underline-offset-2";
