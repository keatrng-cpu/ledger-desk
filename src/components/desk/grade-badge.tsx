/**
 * PATH band pill. One badge for the desk card and the shadow panel.
 * Colors stay the live palette. `shadow` is the dashed v2 pill.
 */
import { cn } from "@/lib/utils";

export interface GradeBadgeProps {
  g: string;
  size?: "sm" | "md" | "lg";
  vetoed?: boolean;
  shadow?: boolean;
}

const SIZE = {
  sm: "min-h-5 px-2 py-0.5 text-[12px] font-bold",
  md: "min-h-6 px-2.5 py-1 text-[14px] font-bold",
  lg: "min-h-[30px] px-3 py-1 text-[18px] font-extrabold",
} as const;

export function GradeBadge({ g, size = "md", vetoed = false, shadow = false }: GradeBadgeProps) {
  const aPlus = g === "A+";
  const execute = aPlus || g === "A" || g === "A-" || g === "A−";
  return (
    <span
      title={
        shadow
          ? "q_v2 shadow band — not traded"
          : execute
            ? "PATH band — an execute grade (A+ sizes at the A probe until n≥20 A+ at WR≥65%)"
            : g === "B+"
              ? "B+ is live. One contract. The score sizes. It does not pick the side."
              : "Not an execute grade"
      }
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-mono uppercase leading-none",
        SIZE[size],
        shadow && "border-dashed opacity-70",
        vetoed && "border-[var(--color-down)] text-[var(--color-down)] line-through",
        !vetoed && !shadow && execute && "border-[color-mix(in_oklab,var(--color-primary)_45%,var(--color-border))] text-[var(--color-primary)]",
        !vetoed && !shadow && aPlus && "font-extrabold ring-1 ring-[color-mix(in_oklab,var(--color-primary)_45%,transparent)]",
        !vetoed && !shadow && g === "B+" && "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] text-[var(--color-warn)]",
        !vetoed && !shadow && !execute && g !== "B+" && "border-[var(--color-border)] text-[var(--color-subtle)]",
        !vetoed && shadow && "border-dashed border-[var(--shadow-border)] bg-transparent text-[var(--shadow-fg)]",
      )}
    >
      {shadow && <span className="text-[11px] font-semibold tracking-wide">v2</span>}
      {g}
    </span>
  );
}
