/**
 * Shadow order review — ROADMAP E4, missing half.
 *
 * `recordShadowOrder` (execution/shadow.ts) has existed since the E1/E4 merge
 * with a real, tested writer and reader pair — but nothing in the app ever
 * CALLED the writer, and this panel (the reader) did not exist. The
 * 2026-08-12 audit found it fully orphaned: zero producer, zero consumer.
 * `src/routes/index.tsx`'s `recordArmedShadow` is now the producer (called on
 * every desk poll, once per armed setup per killzone/day — see its doc for
 * the idempotency key). This is the consumer.
 *
 * WHAT THIS SHOWS: the order the desk WOULD have placed for the best
 * actionable candidate, each time one armed. Read it against the Journal tab
 * to spot the gap between "the desk was ready" and "I actually took it" —
 * that gap is the whole point of shadow mode (see shadow.ts's header for the
 * Phase E unlock conditions this log exists to eventually satisfy).
 *
 * Self-fetching, no props required. Read-only — this file sends nothing
 * anywhere, same as shadow.ts itself.
 */

import { useCallback, useEffect, useState } from "react";
import { Loader2, RefreshCw, Target } from "lucide-react";
import { listShadowOrders, type ShadowOrder } from "@/lib/execution/shadow";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ShadowOrderReview() {
  const [rows, setRows] = useState<ShadowOrder[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listShadowOrders({ data: { limit: 50 } });
      setRows(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shadow log");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-[var(--color-fg)]">
          <Target className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          Shadow log — what the desk would have placed
        </h3>
        <Button variant="ghost" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
      <p className="mb-2 text-[10px] leading-relaxed text-[var(--color-subtle)]">
        Records only — nothing here is ever sent to a broker. One row per
        armed setup per killzone/day. Compare against the Journal tab: a
        setup that shows up here but never became a trade is either a
        correct skip or a missed one — this log is what lets you tell which.
      </p>

      {error && (
        <p className="text-xs text-[var(--color-down)]">{error}</p>
      )}

      {!error && rows && rows.length === 0 && (
        <p className="text-xs text-[var(--color-subtle)]">
          Empty — no armed setup has been recorded yet. This fills in as the
          desk poll finds actionable candidates.
        </p>
      )}

      {rows && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] border-collapse text-left font-mono text-[11px]">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                <th className="pb-1 pr-2 font-medium">Time</th>
                <th className="pb-1 pr-2 font-medium">Symbol</th>
                <th className="pb-1 pr-2 font-medium">Side</th>
                <th className="pb-1 pr-2 font-medium">Entry</th>
                <th className="pb-1 pr-2 font-medium">Stop</th>
                <th className="pb-1 pr-2 font-medium">Qty</th>
                <th className="pb-1 pr-2 font-medium">Strategy</th>
                <th className="pb-1 font-medium">Killzone</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  className="border-t border-[var(--color-border)] text-[var(--color-fg)]"
                >
                  <td className="py-1 pr-2 text-[var(--color-subtle)]">
                    {fmtTime(row.ts)}
                  </td>
                  <td className="py-1 pr-2">{row.intent.symbol}</td>
                  <td
                    className={cn(
                      "py-1 pr-2",
                      row.intent.side === "long"
                        ? "text-[var(--color-up)]"
                        : "text-[var(--color-down)]",
                    )}
                  >
                    {row.intent.side}
                  </td>
                  <td className="py-1 pr-2">{row.intent.entry}</td>
                  <td className="py-1 pr-2">{row.intent.stop}</td>
                  <td className="py-1 pr-2">{row.intent.qty}</td>
                  <td className="py-1 pr-2 text-[var(--color-subtle)]">
                    {row.intent.context.strategy ?? "—"}
                  </td>
                  <td className="py-1 text-[var(--color-subtle)]">
                    {row.intent.context.killzone ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
