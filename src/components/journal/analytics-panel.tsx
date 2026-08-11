import { useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  TrendingUp,
} from "lucide-react";
import {
  getAnalytics,
  exportTradesCsv,
  type AnalyticsPayload,
} from "@/lib/journal/analytics-server";
import type { AnalyticsReport, Bucket } from "@/lib/journal/analytics";
import {
  MIN_MEANINGFUL_N,
  STATISTICALLY_MEANINGFUL_N,
} from "@/lib/journal/analytics";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Mode = "live" | "paper";

const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(n).toFixed(2)}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const rr = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}R`;

function expCls(n: number): string {
  if (n > 0) return "text-[var(--color-up)]";
  if (n < 0) return "text-[var(--color-down)]";
  return "text-[var(--color-muted)]";
}

/**
 * A bucket table. Cells that depend on a sample size too small to mean
 * anything render as "—" rather than a confident-looking number: an n=2
 * bucket showing "100% · +2.00R" is the single most misleading thing an
 * analytics panel can do to a trader.
 */
function BucketTable({
  title,
  hint,
  buckets,
}: {
  title: string;
  hint?: string;
  buckets: Bucket[];
}) {
  const rows = buckets.filter((b) => b.n > 0);
  return (
    <div>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
        {title}
      </p>
      {hint && (
        <p className="mb-1.5 text-[10px] text-[var(--color-subtle)]">{hint}</p>
      )}
      {rows.length === 0 ? (
        <p className="text-xs text-[var(--color-subtle)]">No closed trades.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                <th className="py-1 pr-3 font-medium">Bucket</th>
                <th className="py-1 pr-3 text-right font-medium">n</th>
                <th className="py-1 pr-3 text-right font-medium">Win</th>
                <th className="py-1 pr-3 text-right font-medium">Net</th>
                <th className="py-1 text-right font-medium">Expectancy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b) => (
                <tr
                  key={b.key}
                  className="border-t border-[var(--color-border)]"
                >
                  <td className="py-1.5 pr-3 text-[var(--color-fg)]">
                    {b.label}
                    {!b.meaningful && (
                      <span
                        className="ml-1 text-[var(--color-warn)]"
                        title={`n < ${MIN_MEANINGFUL_N} — not enough trades to read`}
                      >
                        ?
                      </span>
                    )}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular text-[var(--color-muted)]">
                    {b.n}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular">
                    {b.meaningful ? pct(b.winRate) : "—"}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 pr-3 text-right tabular",
                      b.netPnl > 0 && "text-[var(--color-up)]",
                      b.netPnl < 0 && "text-[var(--color-down)]",
                    )}
                  >
                    {money(b.netPnl)}
                  </td>
                  <td
                    className={cn(
                      "py-1.5 text-right tabular",
                      b.meaningful ? expCls(b.expectancyR) : "",
                    )}
                  >
                    {b.meaningful ? rr(b.expectancyR) : "—"}
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

/** Equity curve + underwater (drawdown) plot, inline SVG — no chart lib. */
function EquitySpark({ report }: { report: AnalyticsReport }) {
  const pts = report.equityCurve;
  if (pts.length < 2) {
    return (
      <p className="text-xs text-[var(--color-subtle)]">
        Equity curve needs at least 2 closed trades.
      </p>
    );
  }
  const w = 600;
  const h = 120;
  const eq = pts.map((p) => p.equity);
  const min = Math.min(...eq);
  const max = Math.max(...eq);
  const span = max - min || 1;
  const x = (i: number) => (i / (pts.length - 1)) * w;
  const y = (v: number) => h - ((v - min) / span) * h;
  const path = pts.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p.equity)}`).join(" ");
  const last = pts[pts.length - 1]!;
  const up = last.equity >= (pts[0]?.equity ?? 0);

  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between">
        <p className="text-[11px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
          Equity curve ({report.mode})
        </p>
        <p className="font-mono text-xs text-[var(--color-muted)]">
          {money(last.equity)} · peak DD {money(-last.drawdown)}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-24 w-full"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${report.mode} equity curve, ${pts.length} closed trades, ending at ${money(last.equity)}`}
      >
        <path
          d={path}
          fill="none"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
          className={up ? "stroke-[var(--color-up)]" : "stroke-[var(--color-down)]"}
        />
      </svg>
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  sub,
}: {
  label: string;
  value: string;
  tone?: "up" | "down" | "warn";
  sub?: string;
}) {
  return (
    <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-bg)]/40 px-2.5 py-2">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
        {label}
      </p>
      <p
        className={cn(
          "mt-0.5 font-mono text-sm font-semibold tabular",
          tone === "up" && "text-[var(--color-up)]",
          tone === "down" && "text-[var(--color-down)]",
          tone === "warn" && "text-[var(--color-warn)]",
          !tone && "text-[var(--color-fg)]",
        )}
      >
        {value}
      </p>
      {sub && (
        <p className="mt-0.5 text-[10px] text-[var(--color-subtle)]">{sub}</p>
      )}
    </div>
  );
}

function ReportView({ report }: { report: AnalyticsReport }) {
  const m = report.overall;
  return (
    <div className="space-y-4">
      {/* Sample-size honesty first — before any number that could seduce. */}
      {!report.statisticallyMeaningful && (
        <div className="flex items-start gap-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_8%,transparent)] px-3 py-2 text-xs text-[var(--color-warn)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            n={report.n} of {STATISTICALLY_MEANINGFUL_N} — this sample is too
            small to prove an edge. Every figure below is directional only.
          </span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Trades" value={String(m.trades)} />
        <StatTile
          label="Win rate"
          value={m.trades ? pct(m.winRate) : "—"}
          sub={`${m.wins}W / ${m.losses}L`}
        />
        <StatTile
          label="Net PnL"
          value={money(m.netPnl)}
          tone={m.netPnl > 0 ? "up" : m.netPnl < 0 ? "down" : undefined}
        />
        <StatTile
          label="Expectancy"
          value={m.trades ? rr(m.expectancyR) : "—"}
          tone={m.expectancyR > 0 ? "up" : m.expectancyR < 0 ? "down" : undefined}
          sub="per trade"
        />
        <StatTile
          label="Profit factor"
          value={
            m.profitFactor == null
              ? m.trades
                ? "no losses"
                : "—"
              : m.profitFactor.toFixed(2)
          }
        />
        <StatTile
          label="Max DD"
          value={money(-m.maxDrawdown)}
          tone={m.maxDrawdown > 0 ? "down" : undefined}
          sub={pct(m.maxDrawdownPct)}
        />
      </div>

      <EquitySpark report={report} />

      {/* What the numbers actually support, in words. */}
      <ul className="space-y-1 text-xs text-[var(--color-muted)]">
        {report.readout.map((line) => (
          <li key={line} className="flex gap-2">
            <span className="text-[var(--color-primary)]">•</span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <BucketTable
          title="By pre-score"
          hint="Does a higher desk pre-score actually produce a better outcome? If not, the score is not earning its gate."
          buckets={report.byPrescore}
        />
        <BucketTable
          title="By killzone"
          hint="Which session pays. Cut what doesn't."
          buckets={report.byKillzone}
        />
        <BucketTable title="By symbol" buckets={report.bySymbol} />
        <BucketTable title="By grade" buckets={report.byGrade} />
        <BucketTable title="By side" buckets={report.bySide} />
        <BucketTable
          title="By weekday (ET)"
          buckets={report.byWeekday}
        />
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatTile
          label="Current streak"
          value={
            report.streaks.currentType === "none"
              ? "—"
              : `${report.streaks.currentLength} ${report.streaks.currentType}`
          }
          tone={
            report.streaks.currentType === "loss"
              ? "down"
              : report.streaks.currentType === "win"
                ? "up"
                : undefined
          }
        />
        <StatTile
          label="Longest win run"
          value={String(report.streaks.longestWin)}
        />
        <StatTile
          label="Longest loss run"
          value={String(report.streaks.longestLoss)}
          tone={report.streaks.longestLoss >= 4 ? "warn" : undefined}
        />
        <StatTile
          label="After a loss"
          value={
            report.streaks.afterLossExpectancyR == null
              ? "—"
              : rr(report.streaks.afterLossExpectancyR)
          }
          tone={
            report.streaks.afterLossExpectancyR != null &&
            report.streaks.afterLossExpectancyR < m.expectancyR - 0.15
              ? "down"
              : undefined
          }
          sub={`n=${report.streaks.afterLossN} · tilt probe`}
        />
      </div>
    </div>
  );
}

export function AnalyticsPanel({ onChanged }: { onChanged?: () => void }) {
  const [data, setData] = useState<AnalyticsPayload | null>(null);
  const [mode, setMode] = useState<Mode>("live");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getAnalytics({ data: {} }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analytics unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const download = useCallback(async () => {
    setExporting(true);
    try {
      const res = await exportTradesCsv({ data: { mode: "all" } });
      const blob = new Blob([res.csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ledger-journal-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
      onChanged?.();
    }
  }, [onChanged]);

  const report = data ? (mode === "live" ? data.live : data.paper) : null;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <TrendingUp className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              Performance analytics
            </h2>
            <p className="text-xs text-[var(--color-subtle)]">
              Live and paper are tracked separately — never blended
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Explicit mode switch — there is no combined view, by design. */}
          <div
            className="flex rounded-full border border-[var(--color-border)] p-0.5"
            role="group"
            aria-label="Analytics mode"
          >
            {(["live", "paper"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMode(m)}
                aria-pressed={mode === m}
                className={cn(
                  "rounded-full px-3 py-1 text-[11px] font-medium uppercase tracking-wide transition-colors",
                  mode === m
                    ? m === "live"
                      ? "bg-[var(--color-primary-dim)] text-[var(--color-primary)]"
                      : "bg-[var(--color-surface-2)] text-[var(--color-warn)]"
                    : "text-[var(--color-subtle)] hover:text-[var(--color-fg)]",
                )}
              >
                {m}
                {data && (
                  <span className="ml-1 opacity-70">
                    {m === "live" ? data.live.n : data.paper.n}
                  </span>
                )}
              </button>
            ))}
          </div>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void download()}
            disabled={exporting || !data}
          >
            {exporting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Download className="h-3.5 w-3.5" />
            )}
            CSV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Refresh
          </Button>
        </div>
      </header>

      {mode === "paper" && (
        <p className="mb-3 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_30%,var(--color-border))] px-3 py-1.5 text-[11px] text-[var(--color-warn)]">
          PAPER results. Same math as live (net of commission), but simulated
          fills — the market never actually offered these prices.
        </p>
      )}

      {error && (
        <p className="mb-3 text-xs text-[var(--color-down)]">{error}</p>
      )}

      {!data && loading && (
        <div className="flex items-center gap-2 py-6 text-xs text-[var(--color-subtle)]">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--color-primary)]" />
          Aggregating closed trades…
        </div>
      )}

      {report && <ReportView report={report} />}

      {data && (
        <div className="mt-4 border-t border-[var(--color-border)] pt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
            <Activity className="h-3 w-3 text-[var(--color-primary)]" />
            Discipline tape (all modes)
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <StatTile
              label="Skip ratio"
              value={
                data.discipline.skipRatio == null
                  ? "—"
                  : pct(data.discipline.skipRatio)
              }
              sub="skips ÷ decisions"
              tone={
                data.discipline.skipRatio != null &&
                data.discipline.skipRatio < 0.5
                  ? "warn"
                  : undefined
              }
            />
            <StatTile label="Skips" value={String(data.discipline.skips)} />
            <StatTile label="Entries" value={String(data.discipline.entries)} />
            <StatTile
              label="Candidates"
              value={String(data.discipline.candidates)}
            />
            <StatTile
              label="Halts"
              value={String(data.discipline.halts)}
              tone={data.discipline.halts > 0 ? "warn" : undefined}
            />
          </div>
        </div>
      )}
    </section>
  );
}
