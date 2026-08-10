/**
 * News-gate chip for the Session HUD area. Self-contained: ticks a
 * deterministic newsRead against the bundled econ calendar every 30 s.
 * Red = blackout (high-impact ±15 min), amber = caution, subtle = clear.
 * The integrator mounts this inside session-hud.tsx (see INTEGRATION-P3.md).
 */

import { useEffect, useState } from "react";
import { CalendarClock, Newspaper, ShieldAlert } from "lucide-react";
import { NEWS_CALENDAR, newsRead, type NewsRead } from "@/lib/trading/news";
import { cn } from "@/lib/utils";

function countdown(minutesAway: number): string {
  if (minutesAway <= 0) return "now";
  if (minutesAway < 60) return `in ${minutesAway}m`;
  if (minutesAway < 36 * 60) {
    const h = Math.floor(minutesAway / 60);
    const m = minutesAway % 60;
    return m ? `in ${h}h ${String(m).padStart(2, "0")}m` : `in ${h}h`;
  }
  return `in ${Math.round(minutesAway / (24 * 60))}d`;
}

export function NewsChip({ className }: { className?: string }) {
  // Computed client-side only (first tick in effect) to avoid SSR
  // hydration drift on the countdown text.
  const [read, setRead] = useState<NewsRead | null>(null);

  useEffect(() => {
    const tick = () => setRead(newsRead(new Date(), NEWS_CALENDAR));
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, []);

  if (!read) {
    return (
      <div
        className={cn(
          "flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-[11px] text-[var(--color-subtle)]",
          className,
        )}
      >
        <Newspaper className="h-3.5 w-3.5" />
        News —
      </div>
    );
  }

  const { verdict, nextEvent } = read;
  const Icon =
    verdict === "blackout"
      ? ShieldAlert
      : verdict === "caution"
        ? CalendarClock
        : Newspaper;

  const label =
    verdict === "blackout"
      ? "News blackout"
      : verdict === "caution"
        ? "News caution"
        : "News clear";

  const detail = nextEvent
    ? `${nextEvent.name} · ${nextEvent.timeEt} ET ${countdown(nextEvent.minutesAway)}`
    : "no scheduled releases";

  return (
    <div
      title={read.reason}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-medium",
        verdict === "blackout" &&
          "border-[color-mix(in_oklab,var(--color-down)_55%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_12%,var(--color-surface))] text-[var(--color-down)]",
        verdict === "caution" &&
          "border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[var(--color-surface)] text-[var(--color-warn)]",
        verdict === "clear" &&
          "border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-subtle)]",
        className,
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{label}</span>
      <span className="hidden font-mono font-normal sm:inline">{detail}</span>
    </div>
  );
}
