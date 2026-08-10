import {
  Clock,
  Crosshair,
  Radio,
  ShieldAlert,
  Zap,
} from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { cn } from "@/lib/utils";

export function SessionHud({
  desk,
  wallNow,
}: {
  desk: DeskPayload;
  wallNow: string;
}) {
  const { clock, risk, scan, quotes } = desk;
  return (
    <div className="sticky top-[var(--grok-banner-h,0px)] z-20 -mx-4 border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-bg)_92%,transparent)] px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex items-center gap-2 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-fg)]">
          <Clock className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {clock.nowEt}
        </div>

        <div
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium",
            clock.inTradeWindow
              ? "border-[color-mix(in_oklab,var(--color-up)_40%,var(--color-border))] text-[var(--color-up)]"
              : "border-[var(--color-border)] text-[var(--color-subtle)]",
          )}
        >
          <Zap className="h-3.5 w-3.5" />
          {clock.killzoneLabel}
        </div>

        <div className="hidden items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] text-[var(--color-muted)] sm:flex">
          <Crosshair className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          {clock.sessionPhase}
        </div>

        <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 font-mono text-[11px] text-[var(--color-muted)]">
          <ShieldAlert className="h-3.5 w-3.5 text-[var(--color-warn)]" />
          Risk ${risk.riskDollars.toFixed(0)} · floor {risk.floor}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2 font-mono text-[11px]">
          <span className="text-[var(--color-fg)]">
            {quotes.left.symbol}{" "}
            <span
              className={
                quotes.left.changePct >= 0
                  ? "text-[var(--color-up)]"
                  : "text-[var(--color-down)]"
              }
            >
              {quotes.left.price.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </span>
          </span>
          <span className="text-[var(--color-subtle)]">|</span>
          <span className="text-[var(--color-fg)]">
            {quotes.right.symbol}{" "}
            <span
              className={
                quotes.right.changePct >= 0
                  ? "text-[var(--color-up)]"
                  : "text-[var(--color-down)]"
              }
            >
              {quotes.right.price.toLocaleString(undefined, {
                maximumFractionDigits: 2,
              })}
            </span>
          </span>
          <span className="inline-flex items-center gap-1 text-[var(--color-subtle)]">
            <Radio className="h-3 w-3 text-[var(--color-up)]" />
            {wallNow}
          </span>
        </div>
      </div>
      <p className="mx-auto mt-1.5 max-w-7xl truncate text-[11px] text-[var(--color-muted)]">
        <span className="font-medium text-[var(--color-primary)]">Focus · </span>
        {scan.focus}
      </p>
    </div>
  );
}
