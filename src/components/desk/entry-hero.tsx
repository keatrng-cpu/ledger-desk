/**
 * The first thing on the Now tab: should I enter right now?
 *
 * One of four words (WAIT / STALKING / ARMED / ENTER), one plain sentence,
 * a countdown when the desk says ENTER inside a killzone, and any CONFLICT
 * the desk can see. The word is derived — never decided — from the board
 * verdict, the sequence and the PATH card (src/lib/ui/entry-state.ts has the
 * mapping table). Presentation only.
 */
import { useEffect, useState } from "react";
import { Timer } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { ConflictChip } from "@/components/desk/viz/conflict-chip";
import { Plain, PlainToggle } from "@/components/desk/plain-text";
import { displayEntry, useAutomation, useEntryState } from "@/components/desk/use-entry-state";
import { cn } from "@/lib/utils";

function Countdown({ endsAtMs, label }: { endsAtMs: number; label: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const left = Math.max(0, endsAtMs - now);
  const h = Math.floor(left / 3600_000);
  const m = Math.floor((left % 3600_000) / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  const txt = `${h > 0 ? `${h}:` : ""}${String(m).padStart(h > 0 ? 2 : 1, "0")}:${String(s).padStart(2, "0")}`;
  return (
    <div
      className="flex items-center gap-2 rounded-lg border border-[#4ade80]/50 bg-[#4ade80]/10 px-3 py-2"
      title={`${label} ends — the time window this entry belongs to`}
    >
      <Timer className="h-4 w-4 text-[#4ade80]" aria-hidden />
      <div>
        <p className="font-mono text-xl font-bold tabular-nums text-[#4ade80]">{txt}</p>
        <p className="text-[11px] text-[var(--color-muted)]">left in {label}</p>
      </div>
    </div>
  );
}

export function EntryHero({ desk }: { desk: DeskPayload }) {
  const { read, conflicts } = useEntryState(desk);
  const auto = useAutomation();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!read) return null;
  const st = displayEntry(read, auto);
  return (
    <section
      aria-live="polite"
      aria-label={`Entry signal: ${st.label}`}
      className="rounded-[var(--radius-xl)] border-2 p-4 sm:p-5"
      style={{
        borderColor: `color-mix(in oklab, ${st.color} 55%, var(--color-border))`,
        background: `linear-gradient(135deg, color-mix(in oklab, ${st.color} 14%, var(--color-surface)) 0%, var(--color-surface) 60%)`,
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div
          className={cn(
            "rounded-xl border-2 px-4 py-2 font-mono text-3xl font-black tracking-[0.12em] sm:text-4xl",
            st.pulse,
          )}
          style={{
            color: st.color,
            borderColor: st.color,
            background: `color-mix(in oklab, ${st.color} 10%, transparent)`,
          }}
          title={`Rule ${read.rule} of the mapping in src/lib/ui/entry-state.ts — ${st.hint}`}
        >
          {st.label}
        </div>
        <div className="min-w-[16rem] flex-1">
          <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-[var(--color-muted)]">
            Should I enter right now?
            {read.symbol ? (
              <span className="ml-2 font-mono normal-case tracking-normal text-[var(--color-fg)]">
                {read.symbol}
                {read.side ? ` ${read.side}` : ""}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-base leading-snug text-[var(--color-fg)] sm:text-lg">
            <Plain>{st.why}</Plain>
          </p>
        </div>
        {mounted && read.countdown && st.key === "ENTER" && (
          <Countdown endsAtMs={read.countdown.endsAtMs} label={read.countdown.label} />
        )}
        <PlainToggle className="ml-auto" />
      </div>
      {conflicts.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5 border-t border-[var(--color-border)] pt-3">
          {conflicts.map((c) => (
            <ConflictChip key={`${c.kind}-${c.symbol}`} c={c} />
          ))}
        </div>
      )}
    </section>
  );
}
