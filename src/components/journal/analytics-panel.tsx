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
import type {
  AnalyticsReport,
  Bucket,
  MatrixCell,
  RegimeMatrix,
  StrategyVerdict,
  StrategyVerdictResult,
} from "@/lib/journal/analytics";
import {
  cellLabel,
  MIN_MEANINGFUL_N,
  MIN_STRATEGY_N,
  STATISTICALLY_MEANINGFUL_N,
  TRAILING_WINDOW,
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

function SectionHead({ title, hint }: { title: string; hint?: string }) {
  return (
    <>
      <p className="mb-1 text-[11px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
        {title}
      </p>
      {hint && (
        <p className="mb-1.5 text-[10px] text-[var(--color-subtle)]">{hint}</p>
      )}
    </>
  );
}

const kzLabel = (k: string) => k.replace(/_/g, " ");

/**
 * C4 — per-symbol expectancy, given its own block rather than a row in the
 * table grid. The ROADMAP's instruction is to NOT add instruments until the
 * current book proves positive, so the number that decides it has to be the
 * one you cannot miss.
 */
function BookCoverage({ report }: { report: AnalyticsReport }) {
  const symbols = report.bySymbol.filter((b) => b.n > 0);
  return (
    <div>
      <SectionHead
        title="Per-symbol expectancy · book coverage"
        hint={`Do not add an instrument until the current book is positive at n>=${MIN_STRATEGY_N}. Adding books to an unproven book multiplies an unknown.`}
      />
      {symbols.length === 0 ? (
        <p className="text-xs text-[var(--color-subtle)]">
          No closed trades — nothing to cover.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {symbols.map((b) => (
            <StatTile
              key={b.key}
              label={b.label}
              value={b.meaningful ? rr(b.expectancyR) : "—"}
              tone={
                b.meaningful
                  ? b.expectancyR > 0
                    ? "up"
                    : b.expectancyR < 0
                      ? "down"
                      : undefined
                  : undefined
              }
              sub={
                b.n >= MIN_STRATEGY_N
                  ? `n=${b.n} · at the ${MIN_STRATEGY_N}-trade bar · ${money(b.netPnl)}`
                  : `n=${b.n} · ${MIN_STRATEGY_N - b.n} more to the bar`
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

const VERDICT_STYLE: Record<StrategyVerdict, { label: string; cls: string }> = {
  promote: {
    label: "promote",
    cls: "border-[var(--color-up)] text-[var(--color-up)]",
  },
  demote: {
    label: "demote",
    cls: "border-[var(--color-down)] text-[var(--color-down)]",
  },
  hold: {
    label: "hold",
    cls: "border-[var(--color-border)] text-[var(--color-muted)]",
  },
  "insufficient-data": {
    label: "no read",
    cls: "border-[var(--color-border)] text-[var(--color-subtle)]",
  },
};

/** C3 — the verdict as a pill; the numbers behind it live in `title`. */
function VerdictPill({ v }: { v: StrategyVerdictResult }) {
  const s = VERDICT_STYLE[v.verdict];
  return (
    <span
      title={v.reason}
      className={cn(
        "inline-block rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        s.cls,
      )}
    >
      {s.label}
    </span>
  );
}

/**
 * C1 + C3 — the per-strategy scoreboard.
 *
 * Two independent gates, because they answer different questions: win rate and
 * profit factor print at n>=MIN_MEANINGFUL_N, but EXPECTANCY — the number that
 * makes someone abandon a model — stays "—" until n>=MIN_STRATEGY_N.
 */
function StrategyBoard({ report }: { report: AnalyticsReport }) {
  const verdictOf = new Map(report.verdicts.map((v) => [v.strategy, v]));
  return (
    <div>
      <SectionHead
        title="Per-strategy scoreboard"
        hint={`Expectancy is withheld until n>=${MIN_STRATEGY_N}. Verdict reads the trailing ${TRAILING_WINDOW} closes only — hover it for the numbers.`}
      />
      {report.byStrategy.length === 0 ? (
        <p className="text-xs text-[var(--color-subtle)]">
          No closed trade carries a strategy label
          {report.unattributedN > 0
            ? ` — all ${report.unattributedN} closed trade${report.unattributedN === 1 ? " is" : "s are"} unattributed.`
            : "."}{" "}
          Attribution starts at migration 0008; nothing logged before it can be
          scored.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                <th className="py-1 pr-3 font-medium">Strategy</th>
                <th className="py-1 pr-3 text-right font-medium">n</th>
                <th className="py-1 pr-3 text-right font-medium">Win</th>
                <th className="py-1 pr-3 text-right font-medium">Net</th>
                <th className="py-1 pr-3 text-right font-medium">PF</th>
                <th className="py-1 pr-3 text-right font-medium">Expectancy</th>
                <th className="py-1 text-right font-medium">
                  Trailing {TRAILING_WINDOW}
                </th>
              </tr>
            </thead>
            <tbody>
              {report.byStrategy.map((s) => {
                const v = verdictOf.get(s.key);
                return (
                  <tr
                    key={s.key}
                    className="border-t border-[var(--color-border)]"
                  >
                    <td className="py-1.5 pr-3 text-[var(--color-fg)]">
                      {s.label}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular text-[var(--color-muted)]">
                      {s.n}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular">
                      {s.meaningful ? pct(s.winRate) : "—"}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-3 text-right tabular",
                        s.netPnl > 0 && "text-[var(--color-up)]",
                        s.netPnl < 0 && "text-[var(--color-down)]",
                      )}
                    >
                      {money(s.netPnl)}
                    </td>
                    <td className="py-1.5 pr-3 text-right tabular text-[var(--color-muted)]">
                      {!s.meaningful
                        ? "—"
                        : s.profitFactor == null
                          ? "no loss"
                          : s.profitFactor.toFixed(2)}
                    </td>
                    <td
                      className={cn(
                        "py-1.5 pr-3 text-right tabular",
                        s.expectancyReadable ? expCls(s.expectancyR) : "",
                      )}
                      title={
                        s.expectancyReadable
                          ? undefined
                          : `n < ${MIN_STRATEGY_N} — ${s.tradesToReadable} more closes before a strategy-level expectancy means anything`
                      }
                    >
                      {s.expectancyReadable ? rr(s.expectancyR) : "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      {v ? <VerdictPill v={v} /> : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {report.unattributedN > 0 && report.byStrategy.length > 0 && (
        <p className="mt-1.5 text-[10px] text-[var(--color-warn)]">
          {report.unattributedN} closed trade
          {report.unattributedN === 1 ? "" : "s"} carry no strategy label and are
          excluded from this table.
        </p>
      )}
    </div>
  );
}

/** One matrix cell: expectancy over n, or "—" when the slice is too thin. */
function MatrixValue({ cell }: { cell: MatrixCell | undefined }) {
  if (!cell) {
    return <span className="text-[var(--color-subtle)]">·</span>;
  }
  return (
    <span
      className="flex flex-col items-end leading-tight"
      title={
        cell.meaningful
          ? `${cellLabel(cell)} · ${pct(cell.winRate)} win · ${money(cell.netPnl)}`
          : `${cellLabel(cell)} · n=${cell.n} < ${MIN_MEANINGFUL_N} — not readable`
      }
    >
      <span className={cell.meaningful ? expCls(cell.expectancyR) : ""}>
        {cell.meaningful ? rr(cell.expectancyR) : "—"}
      </span>
      <span className="text-[9px] text-[var(--color-subtle)]">n={cell.n}</span>
    </span>
  );
}

/**
 * C2 — strategy x regime x killzone.
 *
 * Built to answer "when should I NOT use this model", so the losing cells get
 * named in full underneath rather than left for the reader to spot. Every cell
 * shows its own n; a cell under MIN_MEANINGFUL_N shows "—" and never a rate.
 */
function RegimeMatrixTable({ matrix }: { matrix: RegimeMatrix }) {
  const byKey = new Map(matrix.cells.map((c) => [c.key, c]));
  const rows = matrix.cells
    .map((c) => `${c.strategy}|${c.regime}`)
    .filter((v, i, a) => a.indexOf(v) === i);

  return (
    <div>
      <SectionHead
        title="Regime matrix · when NOT to use each model"
        hint={`Strategy x regime x killzone. Every cell carries its own n; below n=${MIN_MEANINGFUL_N} it reads "—", because a three-way slice is the thinnest sample on this page.`}
      />
      {matrix.cells.length === 0 ? (
        <p className="text-xs text-[var(--color-subtle)]">
          Empty — no closed trade carries strategy, regime and killzone together
          {matrix.unclassified > 0
            ? ` (${matrix.unclassified} unclassified closed trade${matrix.unclassified === 1 ? "" : "s"}).`
            : "."}{" "}
          This is a wiring gap, not a trading result.
        </p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                  <th className="py-1 pr-3 font-medium">Strategy</th>
                  <th className="py-1 pr-3 font-medium">Regime</th>
                  {matrix.killzones.map((kz) => (
                    <th key={kz} className="py-1 pl-3 text-right font-medium">
                      {kzLabel(kz)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const [strategy = "", regime = ""] = row.split("|");
                  return (
                    <tr
                      key={row}
                      className="border-t border-[var(--color-border)]"
                    >
                      <td className="py-1.5 pr-3 text-[var(--color-fg)]">
                        {strategy}
                      </td>
                      <td className="py-1.5 pr-3 text-[var(--color-muted)]">
                        {regime}
                      </td>
                      {matrix.killzones.map((kz) => (
                        <td key={kz} className="py-1.5 pl-3 text-right tabular">
                          <MatrixValue cell={byKey.get(`${row}|${kz}`)} />
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {matrix.avoid.length > 0 ? (
            <div className="mt-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-down)_35%,var(--color-border))] px-3 py-2">
              <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-[var(--color-down)]">
                Stop taking these
              </p>
              <ul className="space-y-0.5 font-mono text-[11px] text-[var(--color-muted)]">
                {matrix.avoid.map((c) => (
                  <li key={c.key}>
                    <span className="text-[var(--color-fg)]">
                      {cellLabel(c)}
                    </span>{" "}
                    = <span className="text-[var(--color-down)]">
                      {rr(c.expectancyR)}
                    </span>{" "}
                    over {c.n} trades · {money(c.netPnl)}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="mt-1.5 text-[10px] text-[var(--color-subtle)]">
              No combination has a readable negative expectancy yet — nothing
              can be ruled out on evidence.
            </p>
          )}

          {matrix.unclassified > 0 && (
            <p className="mt-1.5 text-[10px] text-[var(--color-warn)]">
              {matrix.unclassified} closed trade
              {matrix.unclassified === 1 ? "" : "s"} missing strategy, regime or
              killzone — not in any cell above.
            </p>
          )}
        </>
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

      {/* C4 — the instrument decision, before any of the finer slices. */}
      <BookCoverage report={report} />

      {/* C1 + C3 — which model, and what measurement says to do about it. */}
      <StrategyBoard report={report} />

      {/* C2 — and where each model stops working. */}
      <RegimeMatrixTable matrix={report.matrix} />

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
