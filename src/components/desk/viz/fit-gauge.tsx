/**
 * The fit as a gauge with the two numbers that decide what happens to it:
 * the PATH floor (0.65) and the A+ line (0.75), both read from config.ts.
 * The needle eases to the value. A veto does not move the needle (the fit is
 * not discounted by a veto — scanner.ts applyVeto) — it lays a red hatched
 * band over the whole gauge, because a vetoed card is refused at any fit.
 */
import { APLUS_RULES } from "@/lib/aplus/config";
import { cn } from "@/lib/utils";

export function FitGauge({
  fit,
  vetoes,
  className,
  compact = false,
}: {
  fit: number | null;
  vetoes?: string[] | null;
  className?: string;
  compact?: boolean;
}) {
  const floor = APLUS_RULES.confluenceFloor;
  const aplus = APLUS_RULES.aPlusThreshold;
  const v = fit == null ? null : Math.max(0, Math.min(1, fit));
  const veto = vetoes?.length ? vetoes[0]! : null;
  const tone =
    v == null
      ? "var(--color-subtle)"
      : v >= aplus
        ? "var(--color-up)"
        : v >= floor
          ? "var(--color-primary)"
          : "var(--color-warn)";
  const verdict =
    v == null
      ? "no card"
      : veto
        ? "vetoed"
        : v >= aplus
          ? "A+ territory"
          : v >= floor
            ? "above floor"
            : "below floor";
  return (
    <div className={cn("min-w-0", className)}>
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          Fit
        </span>
        <span
          className="font-mono text-[13px] font-semibold"
          style={{ color: veto ? "var(--color-down)" : tone }}
        >
          {v == null ? "—" : fit!.toFixed(2)}
          <span className="ml-1.5 font-sans text-[11px] font-normal text-[var(--color-muted)]">
            {verdict}
          </span>
        </span>
      </div>
      <div
        className={cn(
          "relative w-full rounded-full bg-[var(--color-surface-3)]",
          compact ? "h-2" : "h-3",
        )}
        role="meter"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={v ?? undefined}
        aria-label={`Fit ${v == null ? "none" : fit!.toFixed(2)}; floor ${floor}, A+ ${aplus}${veto ? `; vetoed: ${veto}` : ""}`}
      >
        {/* Zones: below floor / floor→A+ / A+ and up, faint. */}
        <div
          className="absolute inset-y-0 rounded-l-full bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)]"
          style={{ left: 0, width: `${floor * 100}%` }}
        />
        <div
          className="absolute inset-y-0 bg-[color-mix(in_oklab,var(--color-primary)_16%,transparent)]"
          style={{ left: `${floor * 100}%`, width: `${(aplus - floor) * 100}%` }}
        />
        <div
          className="absolute inset-y-0 rounded-r-full bg-[color-mix(in_oklab,var(--color-up)_18%,transparent)]"
          style={{ left: `${aplus * 100}%`, right: 0 }}
        />
        {v != null && (
          <div
            className="absolute inset-y-0 left-0 rounded-full"
            style={{
              width: `${v * 100}%`,
              background: tone,
              opacity: veto ? 0.35 : 0.85,
              transition: "width 700ms cubic-bezier(.2,.8,.2,1)",
            }}
          />
        )}
        {/* Notches. */}
        {[
          { at: floor, label: `floor ${floor}` },
          { at: aplus, label: `A+ ${aplus}` },
        ].map((n) => (
          <div
            key={n.label}
            className="absolute -inset-y-1 w-0.5 bg-[var(--color-fg)]/70"
            style={{ left: `${n.at * 100}%` }}
            title={n.label}
          />
        ))}
        {/* Needle. */}
        {v != null && (
          <div
            className="absolute -top-1.5 h-0 w-0 -translate-x-1/2 border-x-[5px] border-t-[7px] border-x-transparent"
            style={{
              left: `${v * 100}%`,
              borderTopColor: veto ? "var(--color-down)" : "var(--color-fg)",
              transition: "left 700ms cubic-bezier(.2,.8,.2,1)",
            }}
            aria-hidden
          />
        )}
        {veto && (
          <div
            className="hatch-veto absolute inset-0 rounded-full opacity-80"
            title={`Vetoed: ${veto}`}
          />
        )}
      </div>
      <div className="relative mt-1 h-3.5 font-mono text-[10px] text-[var(--color-muted)]">
        <span className="absolute -translate-x-1/2" style={{ left: `${floor * 100}%` }}>
          {floor}
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${aplus * 100}%` }}>
          A+ {aplus}
        </span>
      </div>
      {veto && !compact && (
        <p className="mt-1 text-[12px] font-semibold leading-snug text-[var(--color-down)]">
          VETO · {veto.split(" — ")[0]}
        </p>
      )}
    </div>
  );
}
