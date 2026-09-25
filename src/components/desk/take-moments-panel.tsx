/**
 * Book › Hesitation ledger — the moments the desk said "now", and what
 * happened next. See take-moments.ts for why this is the quadrant no journal
 * can see and this desk can.
 */

import { useEffect, useMemo, useState } from "react";
import {
  loadMoments,
  subscribeMoments,
  summarizeMoments,
  type TakeMoment,
} from "@/lib/trading/take-moments";
import { cn } from "@/lib/utils";

const OUTCOME_LABEL: Record<NonNullable<TakeMoment["outcome"]>, string> = {
  unfilled: "never filled",
  stop: "stopped",
  be: "T1 then BE",
  t1: "T1",
  t2: "T2",
  time: "time exit",
  open: "in progress",
};

function etTime(t: number): string {
  return new Date(t).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function TakeMomentsPanel() {
  const [rows, setRows] = useState<TakeMoment[]>([]);
  useEffect(() => {
    const sync = () => setRows(loadMoments());
    sync();
    return subscribeMoments(sync);
  }, []);
  const sum = useMemo(() => summarizeMoments(rows), [rows]);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <header className="mb-2">
        <h3 className="text-sm font-semibold text-[var(--color-fg)]">Hesitation ledger</h3>
        <p className="text-[10px] text-[var(--color-subtle)]">
          Every desk TAKE and CE-touch, logged the instant it printed — then whether you acted, how fast,
          and what the plan did either way. This browser only.
        </p>
      </header>
      <p className="text-[11px] leading-snug text-[var(--color-fg)]">{sum.line}</p>
      {rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left font-mono text-[10.5px]">
            <thead className="text-[var(--color-subtle)]">
              <tr>
                <th className="py-0.5 pr-2 font-medium">When (ET)</th>
                <th className="pr-2 font-medium">Desk</th>
                <th className="pr-2 font-medium">Plan</th>
                <th className="pr-2 font-medium">You</th>
                <th className="font-medium">Plan did</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 20).map((m) => (
                <tr key={m.key} className="border-t border-[var(--color-border)]">
                  <td className="py-0.5 pr-2 text-[var(--color-muted)]">{etTime(m.at)}</td>
                  <td className="pr-2 text-[var(--color-fg)]">
                    {m.kind} {m.symbol} {m.side === "long" ? "L" : "S"} {m.band}
                  </td>
                  <td className="pr-2 text-[var(--color-muted)]">
                    {m.entry.toFixed(2)} / {m.stop.toFixed(2)}
                    {m.t1 != null ? ` → ${m.t1.toFixed(2)}` : ""}
                  </td>
                  <td className={cn("pr-2", m.action ? "text-[var(--color-up)]" : "text-[var(--color-subtle)]")}>
                    {m.action
                      ? `${m.action.replace("_", " ")}${m.latencySec != null ? ` +${m.latencySec < 90 ? `${m.latencySec}s` : `${Math.round(m.latencySec / 60)}m`}` : ""}`
                      : "—"}
                  </td>
                  <td
                    className={cn(
                      (m.r ?? 0) > 0 && "text-[var(--color-up)]",
                      (m.r ?? 0) < 0 && "text-[var(--color-down)]",
                      m.r == null && "text-[var(--color-subtle)]",
                    )}
                  >
                    {m.outcome ? OUTCOME_LABEL[m.outcome] : "…"}
                    {m.r != null && m.outcome !== "unfilled" ? ` ${m.r >= 0 ? "+" : ""}${m.r.toFixed(2)}R` : ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
