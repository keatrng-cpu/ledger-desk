import { useCallback, useEffect, useState } from "react";
import {
  BadgeAlert,
  BookOpenCheck,
  Check,
  Loader2,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { computeMetrics, type ClosedTrade } from "@/lib/aplus/analytics";
import { metricsByGrade, type GradedTrade } from "@/lib/trading/profit-path";
import {
  closeTrade,
  getSettings,
  listTrades,
  updateEquity,
  type JournalTrade,
} from "@/lib/journal/server";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

function toClosedTrade(t: JournalTrade): GradedTrade {
  return {
    id: t.id,
    symbol: t.symbol,
    side: t.side,
    opened: t.openedAt,
    closed: t.closedAt ?? t.openedAt,
    entry: t.entry,
    exit: t.exit ?? t.entry,
    pnl: t.pnl ?? 0,
    r: t.r ?? 0,
    commission: t.commission,
    slippage: t.slippage,
    reason: t.reason ?? "",
    confluence: t.prescore ?? undefined,
    grade: t.grade ?? undefined,
  };
}

function money(n: number): string {
  const sign = n < 0 ? "−" : "";
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function timeLabel(isoTs: string): string {
  return new Date(isoTs).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function PnlText({ v }: { v: number }) {
  return (
    <span
      className={cn(
        "font-mono",
        v > 0 && "text-[var(--color-up)]",
        v < 0 && "text-[var(--color-down)]",
        v === 0 && "text-[var(--color-muted)]",
      )}
    >
      {money(v)}
    </span>
  );
}

function MetricTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </p>
      <p className="font-mono text-sm font-semibold text-[var(--color-fg)]">
        {value}
      </p>
      {sub && (
        <p className="font-mono text-[10px] text-[var(--color-subtle)]">{sub}</p>
      )}
    </div>
  );
}

function CloseTradeRow({
  trade,
  onClosed,
}: {
  trade: JournalTrade;
  onClosed: () => void;
}) {
  const [exit, setExit] = useState("");
  const [slippage, setSlippage] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async () => {
    const exitNum = Number(exit);
    if (!exit || !Number.isFinite(exitNum) || exitNum <= 0) {
      setErr("Exit price required");
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await closeTrade({
        data: {
          id: trade.id,
          exit: exitNum,
          slippage: slippage ? Math.max(0, Number(slippage) || 0) : 0,
        },
      });
      onClosed();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Close failed");
      setBusy(false);
    }
  };

  return (
    <li className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-mono text-xs text-[var(--color-fg)]">
          <span className="font-semibold">{trade.symbol}</span>{" "}
          <span
            className={
              trade.side === "long"
                ? "text-[var(--color-up)]"
                : "text-[var(--color-down)]"
            }
          >
            {trade.side.toUpperCase()}
          </span>{" "}
          <span className="text-[var(--color-muted)]">
            {trade.contracts}x @ {trade.entry}
          </span>
          {trade.stop != null && (
            <span className="text-[var(--color-subtle)]"> · stop {trade.stop}</span>
          )}
          {trade.mode === "paper" && (
            <span className="ml-1.5 rounded-full border border-[var(--color-border)] px-1.5 py-px text-[10px] uppercase text-[var(--color-subtle)]">
              paper
            </span>
          )}
        </div>
        <span className="text-[10px] text-[var(--color-subtle)]">
          opened {timeLabel(trade.openedAt)} ET
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="number"
          inputMode="decimal"
          placeholder="Exit price"
          value={exit}
          onChange={(e) => setExit(e.target.value)}
          className="w-28 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
        <input
          type="number"
          inputMode="decimal"
          placeholder="Slippage $"
          value={slippage}
          onChange={(e) => setSlippage(e.target.value)}
          className="w-24 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 font-mono text-xs text-[var(--color-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void submit()}
        >
          {busy ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          Close trade
        </Button>
        {err && (
          <span className="text-[10px] text-[var(--color-down)]">{err}</span>
        )}
      </div>
    </li>
  );
}

/**
 * Journal panel — metrics header (computeMetrics over REAL closed trades),
 * open trades with an inline close form, and the closed-trade table (newest
 * first). Equity is editable inline and persists via updateEquity.
 */
export function JournalPanel({
  onChanged,
}: {
  /** Called after any mutation (trade closed, equity saved) so parents can refresh risk state. */
  onChanged?: () => void;
} = {}) {
  const [trades, setTrades] = useState<JournalTrade[] | null>(null);
  const [equity, setEquity] = useState(100_000);
  const [equityDraft, setEquityDraft] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [allTrades, settings] = await Promise.all([
        listTrades({ data: {} }),
        getSettings(),
      ]);
      setTrades(allTrades);
      setEquity(settings.equity);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Journal load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(() => {
    void load();
    onChanged?.();
  }, [load, onChanged]);

  const saveEquity = async () => {
    if (equityDraft == null) return;
    const value = Number(equityDraft);
    if (!Number.isFinite(value) || value < 100) {
      setEquityDraft(null);
      return;
    }
    try {
      const saved = await updateEquity({ data: { equity: value } });
      setEquity(saved.equity);
      setEquityDraft(null);
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Equity update failed");
    }
  };

  const openTrades = (trades ?? []).filter((t) => t.status === "open");
  // listTrades is newest-first by opened_at; metrics equity curve wants
  // chronological order, so reverse for computeMetrics.
  const closedDesc = (trades ?? []).filter((t) => t.status === "closed");
  const metrics = computeMetrics(
    [...closedDesc].reverse().map(toClosedTrade),
    equity,
  );

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <BookOpenCheck className="h-4 w-4 text-[var(--color-primary)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              Journal — real trades
            </h2>
            <p className="text-xs text-[var(--color-subtle)]">
              Net of commission + slippage · CONTRACTS math · newest first
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Inline-editable equity */}
          <div className="flex items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1 font-mono text-[11px] text-[var(--color-muted)]">
            <span className="text-[var(--color-subtle)]">equity</span>
            {equityDraft == null ? (
              <>
                <span className="text-[var(--color-fg)]">
                  ${equity.toLocaleString()}
                </span>
                <button
                  type="button"
                  aria-label="Edit equity"
                  onClick={() => setEquityDraft(String(equity))}
                  className="text-[var(--color-subtle)] transition-colors hover:text-[var(--color-fg)]"
                >
                  <Pencil className="h-3 w-3" />
                </button>
              </>
            ) : (
              <>
                <input
                  autoFocus
                  type="number"
                  value={equityDraft}
                  onChange={(e) => setEquityDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveEquity();
                    if (e.key === "Escape") setEquityDraft(null);
                  }}
                  className="w-20 bg-transparent text-[var(--color-fg)] focus:outline-none"
                />
                <button
                  type="button"
                  aria-label="Save equity"
                  onClick={() => void saveEquity()}
                  className="text-[var(--color-up)]"
                >
                  <Check className="h-3 w-3" />
                </button>
              </>
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={loading}
            onClick={refresh}
            aria-label="Refresh journal"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </header>

      {/* Statistical honesty badge — prominent until n >= 100 */}
      {metrics.isStatisticallyWeak && (
        <div className="mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_45%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2 text-xs font-medium text-[var(--color-warn)]">
          <BadgeAlert className="h-4 w-4 shrink-0" />
          n&lt;100 — expectancy not yet statistically meaningful ({metrics.trades}{" "}
          closed trade{metrics.trades === 1 ? "" : "s"})
        </div>
      )}

      {/* Metrics header */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        <MetricTile label="Trades" value={String(metrics.trades)} />
        <MetricTile
          label="Win rate"
          value={`${(metrics.winRate * 100).toFixed(0)}%`}
          sub={`${metrics.wins}W / ${metrics.losses}L`}
        />
        <MetricTile label="Net PnL" value={money(metrics.netPnl)} />
        <MetricTile
          label="Expectancy"
          value={`${metrics.expectancyR >= 0 ? "+" : ""}${metrics.expectancyR.toFixed(2)}R`}
        />
        <MetricTile
          label="Profit factor"
          value={
            metrics.profitFactor == null
              ? "∞"
              : metrics.profitFactor.toFixed(2)
          }
        />
        <MetricTile
          label="Max DD"
          value={money(-metrics.maxDrawdown)}
          sub={`${(metrics.maxDrawdownPct * 100).toFixed(1)}%`}
        />
      </div>

      {error && (
        <p className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-down)]/30 px-3 py-2 text-xs text-[var(--color-down)]">
          {error}
        </p>
      )}

      {/* Open trades + inline close */}
      <div className="mb-4">
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
          Open trades ({openTrades.length})
        </h3>
        {openTrades.length ? (
          <ul className="space-y-2">
            {openTrades.map((t) => (
              <CloseTradeRow key={t.id} trade={t} onClosed={refresh} />
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[var(--color-subtle)]">
            Flat — no open positions.
          </p>
        )}
      </div>

      {/* Closed trades table */}
      <div>
        <h3 className="mb-2 text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
          Closed trades ({closedDesc.length})
        </h3>
        {closedDesc.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                  <th className="py-1.5 pr-3 font-medium">Time (ET)</th>
                  <th className="py-1.5 pr-3 font-medium">Symbol</th>
                  <th className="py-1.5 pr-3 font-medium">Side</th>
                  <th className="py-1.5 pr-3 text-right font-medium">R</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Net PnL</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Prescore</th>
                  <th className="py-1.5 font-medium">Reason</th>
                </tr>
              </thead>
              <tbody>
                {closedDesc.map((t) => (
                  <tr
                    key={t.id}
                    className="border-b border-[var(--color-border)] last:border-b-0"
                  >
                    <td className="py-1.5 pr-3 font-mono text-[var(--color-muted)]">
                      {timeLabel(t.closedAt ?? t.openedAt)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono font-semibold text-[var(--color-fg)]">
                      {t.symbol}
                      {t.mode === "paper" && (
                        <span className="ml-1 text-[10px] font-normal uppercase text-[var(--color-subtle)]">
                          p
                        </span>
                      )}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-3 font-mono uppercase",
                        t.side === "long"
                          ? "text-[var(--color-up)]"
                          : "text-[var(--color-down)]",
                      )}
                    >
                      {t.side}
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-[var(--color-fg)]">
                      {t.r == null ? "—" : `${t.r >= 0 ? "+" : ""}${t.r.toFixed(2)}`}
                    </td>
                    <td className="py-1.5 pr-3 text-right">
                      <PnlText v={t.pnl ?? 0} />
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-[var(--color-muted)]">
                      {t.prescore == null ? "—" : t.prescore.toFixed(2)}
                    </td>
                    <td className="max-w-[220px] truncate py-1.5 text-[var(--color-muted)]">
                      {t.reason ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-[var(--color-subtle)]">
            No closed trades yet — expectancy starts counting with the first
            exit.
          </p>
        )}
      </div>
    </section>
  );
}
