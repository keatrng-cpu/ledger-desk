import { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Crosshair, Gauge, Shield, Terminal } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { APLUS_RULES, riskDollars } from "@/lib/aplus/config";
import { CONFLUENCE_KNOWLEDGE } from "@/lib/aplus/confluence";
import {
  buildBacktestPayload,
  buildNarrative,
  buildPremarketSnapshot,
  type Bias,
} from "@/lib/aplus/sample-run";
import { cn, formatPct } from "@/lib/utils";

type Tab = "backtest" | "premarket" | "rules";

function fmt(n: number | null | undefined, d = 2) {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, {
    minimumFractionDigits: d,
    maximumFractionDigits: d,
  });
}

function BiasPill({ v }: { v: Bias | string }) {
  const x = (v || "neutral").toLowerCase();
  const cls =
    x === "bull" || x === "long"
      ? "border-[color-mix(in_oklab,var(--color-up)_45%,var(--color-border))] text-[var(--color-up)]"
      : x === "bear" || x === "short"
        ? "border-[color-mix(in_oklab,var(--color-down)_45%,var(--color-border))] text-[var(--color-down)]"
        : "border-[var(--color-border)] text-[var(--color-subtle)]";
  return (
    <span
      className={cn(
        "inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        cls,
      )}
    >
      {x}
    </span>
  );
}

function Kv({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className="contents">
      <div className="text-[var(--color-subtle)]">{label}</div>
      <div className={cn("text-[var(--color-fg)]", className)}>{children}</div>
    </div>
  );
}

function Section({
  title,
  children,
  className,
}: {
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3 sm:p-4",
        className,
      )}
    >
      <h3 className="mb-2 text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--color-subtle)]">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function AplusOps() {
  const [tab, setTab] = useState<Tab>("backtest");
  const backtest = useMemo(() => buildBacktestPayload(), []);
  const premarket = useMemo(() => buildPremarketSnapshot(), []);
  const narrative = useMemo(() => buildNarrative(), []);
  const m = backtest.metrics;

  const histData = backtest.histogram.map((count, i) => ({
    bucket: (i / 10).toFixed(1),
    count,
    over: i / 10 >= backtest.floor - 1e-9,
  }));

  const equityData = backtest.equity.map((e, i) => ({
    i,
    equity: +e.toFixed(2),
  }));

  const tabs: { id: Tab; label: string }[] = [
    { id: "backtest", label: "Backtest" },
    { id: "premarket", label: "Premarket" },
    { id: "rules", label: "Rules / knowledge" },
  ];

  return (
    <Card className="overflow-hidden border-[color-mix(in_oklab,var(--color-primary)_18%,var(--color-border))]">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-md)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <Terminal className="h-5 w-5" aria-hidden />
          </div>
          <div>
            <CardTitle className="flex flex-wrap items-center gap-2 text-sm font-medium text-[var(--color-fg)]">
              aplus ops console
              <span className="rounded-full border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-primary)]">
                Trading-Automation
              </span>
            </CardTitle>
            <CardDescription>
              Port of{" "}
              <code className="text-[var(--color-fg)]">
                keatrng-cpu/Trading-Automation
              </code>{" "}
              — dual NQ/ES SMC·ICT·TJR desk · rules decide, AI explains
            </CardDescription>
          </div>
        </div>
        <div
          className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] p-0.5"
          role="tablist"
          aria-label="aplus mode"
        >
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "min-h-8 rounded-[calc(var(--radius-sm)-2px)] px-2.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-[var(--color-surface-3)] text-[var(--color-fg)]"
                  : "text-[var(--color-muted)] hover:text-[var(--color-fg)]",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[var(--color-subtle)]">
          <span className="rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[var(--color-primary)]">
            {tab}
          </span>
          <span>
            {backtest.symbol} · {backtest.bars.toLocaleString()} bars ·{" "}
            {backtest.first_ts.slice(0, 10)} → {backtest.last_ts.slice(0, 10)}
          </span>
          <span className="text-[var(--color-warn)]">demo offline sample</span>
        </div>

        {tab === "backtest" && (
          <>
            {m.isStatisticallyWeak ? (
              <div className="rounded-[var(--radius-md)] border-l-4 border-[var(--color-warn)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-muted)]">
                <b className="text-[var(--color-fg)]">Weak sample:</b> {m.trades}{" "}
                trades {"<"} 100 — directional only (CLAUDE.md §7).
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <Section title="Outcome">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <Kv label="trades">
                    <span className="text-lg font-semibold">{m.trades}</span>
                  </Kv>
                  <Kv
                    label="net pnl"
                    className={
                      m.netPnl > 0
                        ? "text-[var(--color-up)]"
                        : m.netPnl < 0
                          ? "text-[var(--color-down)]"
                          : ""
                    }
                  >
                    ${fmt(m.netPnl)}
                  </Kv>
                  <Kv label="win rate">{formatPct(m.winRate * 100)}</Kv>
                  <Kv label="expectancy">{fmt(m.expectancyR, 3)}R</Kv>
                  <Kv label="profit factor">
                    {m.profitFactor == null ? "∞" : fmt(m.profitFactor)}
                  </Kv>
                  <Kv label="max DD">{formatPct(m.maxDrawdownPct * 100)}</Kv>
                  <Kv label="sharpe">{fmt(m.sharpe)}</Kv>
                  <Kv label="costs">
                    ${fmt(m.totalCommission)} + ${fmt(m.totalSlippage)}
                  </Kv>
                </div>
              </Section>

              <Section title="Funnel">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <Kv label="scored">
                    <span className="text-lg font-semibold">
                      {backtest.scored}
                    </span>
                  </Kv>
                  <Kv label="best">{fmt(backtest.best_score, 3)}</Kv>
                  <Kv label="floor">{fmt(backtest.floor, 2)}</Kv>
                  <Kv
                    label="cleared"
                    className={
                      backtest.above_floor > 0
                        ? "text-[var(--color-up)]"
                        : "text-[var(--color-down)]"
                    }
                  >
                    {backtest.above_floor}
                  </Kv>
                  <Kv label="candidates">{backtest.candidates}</Kv>
                  <Kv label="skipped">{backtest.skips}</Kv>
                </div>
              </Section>

              <Section title="Equity" className="sm:col-span-2">
                <div className="h-[140px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={equityData}>
                      <defs>
                        <linearGradient id="eqFill" x1="0" y1="0" x2="0" y2="1">
                          <stop
                            offset="0%"
                            stopColor="#2dd4bf"
                            stopOpacity={0.35}
                          />
                          <stop
                            offset="100%"
                            stopColor="#2dd4bf"
                            stopOpacity={0}
                          />
                        </linearGradient>
                      </defs>
                      <CartesianGrid
                        stroke="#27272a"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis dataKey="i" hide />
                      <YAxis
                        domain={["auto", "auto"]}
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        width={52}
                        tickFormatter={(v) => `$${Number(v).toFixed(0)}`}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#18181c",
                          border: "1px solid #3f3f46",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                        formatter={(v: number) => [`$${fmt(v)}`, "equity"]}
                      />
                      <Area
                        type="monotone"
                        dataKey="equity"
                        stroke="#2dd4bf"
                        fill="url(#eqFill)"
                        strokeWidth={2}
                        isAnimationActive={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 font-mono text-xs text-[var(--color-muted)]">
                  <span>start ${fmt(backtest.starting_equity)}</span>
                  <span className="text-right">
                    end ${fmt(backtest.equity[backtest.equity.length - 1])}
                  </span>
                </div>
              </Section>
            </div>

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <Section title="Confluence distribution">
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histData}>
                      <CartesianGrid
                        stroke="#27272a"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="bucket"
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <YAxis
                        tick={{ fill: "#71717a", fontSize: 10 }}
                        width={32}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          background: "#18181c",
                          border: "1px solid #3f3f46",
                          borderRadius: 8,
                          fontSize: 12,
                        }}
                      />
                      <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                        {histData.map((e, i) => (
                          <Cell
                            key={i}
                            fill={e.over ? "#34d399" : "#2dd4bf"}
                            fillOpacity={e.over ? 0.9 : 0.55}
                          />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Section>

              <Section title="Top skip reasons">
                <div className="max-h-[180px] overflow-auto">
                  <table className="w-full text-left text-xs">
                    <thead className="text-[var(--color-subtle)]">
                      <tr>
                        <th className="pb-1 font-medium">reason</th>
                        <th className="pb-1 text-right font-medium">count</th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {backtest.skip_reasons.map((s) => (
                        <tr
                          key={s.reason}
                          className="border-t border-[var(--color-border)]"
                        >
                          <td className="py-1.5 text-[var(--color-muted)]">
                            {s.reason}
                          </td>
                          <td className="py-1.5 text-right tabular text-[var(--color-fg)]">
                            {s.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            </div>

            <Section title={`Trades (${backtest.trades.length})`}>
              <div className="max-h-[260px] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 bg-[var(--color-surface-2)] text-[var(--color-subtle)]">
                    <tr>
                      <th className="pb-1 pr-2 font-medium">opened</th>
                      <th className="pb-1 pr-2 font-medium">sym</th>
                      <th className="pb-1 pr-2 font-medium">side</th>
                      <th className="pb-1 pr-2 text-right font-medium">entry</th>
                      <th className="pb-1 pr-2 text-right font-medium">exit</th>
                      <th className="pb-1 pr-2 text-right font-medium">pnl</th>
                      <th className="pb-1 pr-2 text-right font-medium">R</th>
                      <th className="pb-1 font-medium">reason</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {backtest.trades.map((t) => (
                      <tr
                        key={t.id}
                        className="border-t border-[var(--color-border)]"
                      >
                        <td className="py-1.5 pr-2 text-[var(--color-subtle)]">
                          {t.opened.slice(0, 16).replace("T", " ")}
                        </td>
                        <td className="py-1.5 pr-2">{t.symbol}</td>
                        <td className="py-1.5 pr-2">
                          <BiasPill v={t.side} />
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular">
                          {fmt(t.entry)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular">
                          {fmt(t.exit)}
                        </td>
                        <td
                          className={cn(
                            "py-1.5 pr-2 text-right tabular",
                            t.pnl > 0
                              ? "text-[var(--color-up)]"
                              : "text-[var(--color-down)]",
                          )}
                        >
                          {fmt(t.pnl)}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular">
                          {fmt(t.r)}
                        </td>
                        <td className="py-1.5 text-[var(--color-muted)]">
                          {t.reason}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Journal tail">
              <div className="mb-2 grid grid-cols-2 gap-2 font-mono text-xs sm:grid-cols-5">
                <span>cand {backtest.journal.candidates}</span>
                <span>skip {backtest.journal.skips}</span>
                <span>in {backtest.journal.entries}</span>
                <span>out {backtest.journal.exits}</span>
                <span>halt {backtest.journal.halts}</span>
              </div>
              <div className="max-h-[200px] overflow-auto">
                <table className="w-full text-left text-xs">
                  <thead className="text-[var(--color-subtle)]">
                    <tr>
                      <th className="pb-1 pr-2 font-medium">ts</th>
                      <th className="pb-1 pr-2 font-medium">event</th>
                      <th className="pb-1 pr-2 font-medium">sym</th>
                      <th className="pb-1 font-medium">detail</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    {[...backtest.journal.tail].reverse().map((r, i) => {
                      let detail =
                        r.skip_reason ||
                        r.reason ||
                        (r.confluence != null
                          ? `conf ${fmt(r.confluence, 3)}`
                          : "");
                      if (r.pnl != null)
                        detail = `pnl ${fmt(r.pnl)}  R ${fmt(r.r_multiple, 2)}`;
                      const evColor =
                        r.event === "ENTRY"
                          ? "text-[var(--color-up)]"
                          : r.event === "EXIT"
                            ? "text-[var(--color-warn)]"
                            : r.event === "HALT"
                              ? "text-[var(--color-down)]"
                              : r.event === "CANDIDATE"
                                ? "text-[var(--color-primary)]"
                                : "text-[var(--color-subtle)]";
                      return (
                        <tr
                          key={i}
                          className="border-t border-[var(--color-border)]"
                        >
                          <td className="py-1 pr-2 text-[var(--color-subtle)]">
                            {r.ts.slice(0, 19).replace("T", " ")}
                          </td>
                          <td className={cn("py-1 pr-2", evColor)}>
                            {r.event}
                          </td>
                          <td className="py-1 pr-2">{r.symbol}</td>
                          <td className="py-1 text-[var(--color-muted)]">
                            {detail}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Section>

            <Section title="Assumptions">
              <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-[var(--color-muted)]">
                {backtest.assumptions}
              </pre>
            </Section>
          </>
        )}

        {tab === "premarket" && (
          <>
            <div className="rounded-[var(--radius-md)] border-l-4 border-[var(--color-up)] bg-[var(--color-surface-2)] px-3 py-2 text-sm text-[var(--color-muted)]">
              <b className="text-[var(--color-fg)]">Premarket</b> — detectors
              only, zero orders. Dual charts above for live MNQ/ES tape.
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              <Section title="Bias stack">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs">
                  {(
                    [
                      ["top-down", premarket.bias.top_down],
                      ["15m", premarket.bias.mid_15m],
                      ["60m", premarket.bias.htf_60m],
                      ["PO3", premarket.bias.po3],
                      ["opening", premarket.bias.opening],
                      ["weekly PD", premarket.bias.weekly_pd],
                      ["LTF trend", premarket.bias.ltf_trend],
                    ] as const
                  ).map(([k, v]) => (
                    <Kv key={k} label={k}>
                      <BiasPill v={v} />
                    </Kv>
                  ))}
                </div>
              </Section>

              <Section title="Conditions">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <Kv
                    label="tradeable"
                    className={
                      premarket.conditions.tradeable
                        ? "text-[var(--color-up)]"
                        : "text-[var(--color-down)]"
                    }
                  >
                    {String(premarket.conditions.tradeable)}
                  </Kv>
                  <Kv label="regime">{premarket.conditions.regime}</Kv>
                  <Kv label="vol">{premarket.conditions.volatility}</Kv>
                  <Kv label="ER">{fmt(premarket.conditions.er, 3)}</Kv>
                  <Kv label="ATR ratio">
                    {fmt(premarket.conditions.atr_ratio)}
                  </Kv>
                </div>
              </Section>

              <Section title="Session">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <Kv label="config">{premarket.session.config}</Kv>
                  <Kv
                    label="in window"
                    className={
                      premarket.session.in_session
                        ? "text-[var(--color-up)]"
                        : "text-[var(--color-down)]"
                    }
                  >
                    {String(premarket.session.in_session)}
                  </Kv>
                  <Kv label="killzone">{premarket.session.killzone}</Kv>
                  <Kv label="PDH / PDL">
                    {fmt(premarket.session.pdh)} / {fmt(premarket.session.pdl)}
                  </Kv>
                  <Kv label="PWH / PWL">
                    {fmt(premarket.session.pwh)} / {fmt(premarket.session.pwl)}
                  </Kv>
                  <Kv label="day open">{fmt(premarket.session.day_open)}</Kv>
                  <Kv label="NY open">{fmt(premarket.session.ny_open)}</Kv>
                </div>
              </Section>

              <Section title="News">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                  <Kv
                    label="verdict"
                    className={
                      premarket.news.verdict === "clear"
                        ? "text-[var(--color-up)]"
                        : premarket.news.verdict === "caution"
                          ? "text-[var(--color-warn)]"
                          : "text-[var(--color-down)]"
                    }
                  >
                    {premarket.news.verdict}
                  </Kv>
                  <Kv label="detail">{premarket.news.reason}</Kv>
                </div>
              </Section>

              <Section title="Dealing range">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <Kv label="low – high">
                    {fmt(premarket.dealing_range.low)} –{" "}
                    {fmt(premarket.dealing_range.high)}
                  </Kv>
                  <Kv label="EQ">
                    {fmt(premarket.dealing_range.equilibrium)}
                  </Kv>
                  <Kv label="zone">{premarket.dealing_range.zone}</Kv>
                </div>
              </Section>

              <Section title="PD-array inventory">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <Kv label="FVGs">{premarket.zone_counts.fvgs}</Kv>
                  <Kv label="order blocks">
                    {premarket.zone_counts.order_blocks}
                  </Kv>
                  <Kv label="breakers">{premarket.zone_counts.breakers}</Kv>
                  <Kv label="mitigations">
                    {premarket.zone_counts.mitigations}
                  </Kv>
                  <Kv label="propulsions">
                    {premarket.zone_counts.propulsions}
                  </Kv>
                  <Kv label="pools">{premarket.zone_counts.pools}</Kv>
                </div>
              </Section>

              <Section title="Key levels">
                <div className="max-h-[160px] overflow-auto">
                  <table className="w-full text-left text-xs font-mono">
                    <tbody>
                      {premarket.levels.map((l) => (
                        <tr
                          key={l.name}
                          className="border-t border-[var(--color-border)]"
                        >
                          <td className="py-1 text-[var(--color-subtle)]">
                            {l.name}
                          </td>
                          <td className="py-1 text-right tabular">
                            {fmt(l.price)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>

              {premarket.last_sweep && (
                <Section title="Last sweep">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                    <Kv label="kind">{premarket.last_sweep.kind}</Kv>
                    <Kv label="price">{fmt(premarket.last_sweep.price)}</Kv>
                    <Kv label="bars ago">{premarket.last_sweep.bars_ago}</Kv>
                  </div>
                </Section>
              )}

              {premarket.last_event && (
                <Section title="Last structure">
                  <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                    <Kv label="kind">{premarket.last_event.kind}</Kv>
                    <Kv label="direction">
                      <BiasPill v={premarket.last_event.direction} />
                    </Kv>
                    <Kv label="level">{fmt(premarket.last_event.level)}</Kv>
                    <Kv label="MSS">
                      {String(premarket.last_event.is_mss)}
                    </Kv>
                    <Kv label="displaced">
                      {String(premarket.last_event.displaced)}
                    </Kv>
                  </div>
                </Section>
              )}
            </div>

            <Section title="Premarket narrative">
              <ul className="space-y-1 text-sm text-[var(--color-muted)]">
                {narrative.map((line) => (
                  <li key={line} className="flex gap-2">
                    <Crosshair className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--color-primary)]" />
                    {line}
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}

        {tab === "rules" && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <Section title="Non-negotiables">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 font-mono text-xs">
                  <Kv label="floor (active)">
                    {APLUS_RULES.confluenceFloor} TEST
                  </Kv>
                  <Kv label="floor (calib)">
                    {APLUS_RULES.confluenceFloorCalibration}
                  </Kv>
                  <Kv label="A+ tag">≥ {APLUS_RULES.aPlusThreshold}</Kv>
                  <Kv label="risk">
                    {APLUS_RULES.riskPct * 100}% (cap{" "}
                    {APLUS_RULES.riskPctCeiling * 100}%)
                  </Kv>
                  <Kv
                    label={`$ risk @ ${APLUS_RULES.accountEquity.toLocaleString()}`}
                  >
                    ${fmt(riskDollars())}
                  </Kv>
                  <Kv label="R:R">
                    {APLUS_RULES.minRr}:1 – 1:{APLUS_RULES.tpMaxR}
                  </Kv>
                  <Kv label="setups / KZ">
                    {APLUS_RULES.maxSetupsPerSession}
                  </Kv>
                  <Kv label="daily / weekly halt">
                    {APLUS_RULES.dailyLossLimitPct * 100}% /{" "}
                    {APLUS_RULES.weeklyLossLimitPct * 100}%
                  </Kv>
                  <Kv label="HTF gate">{APLUS_RULES.htfTopDownGate}</Kv>
                  <Kv label="symbols">
                    {APLUS_RULES.symbols.join("+")} · micros{" "}
                    {String(APLUS_RULES.useMicros)}
                  </Kv>
                  <Kv label="session">{APLUS_RULES.session}</Kv>
                </div>
              </Section>

              <Section title="Model">
                <p className="text-sm leading-relaxed text-[var(--color-muted)]">
                  {APLUS_RULES.model}
                </p>
                <p className="mt-2 text-xs text-[var(--color-subtle)]">
                  Rules detect · statistics decide · AI only explains. LLM never
                  gates a trade (Trading-Automation CLAUDE.md §5).
                </p>
                <div className="mt-3 flex items-center gap-2 text-xs text-[var(--color-muted)]">
                  <Shield className="h-4 w-4 text-[var(--color-primary)]" />
                  Live off until three locks: mode=live · creds · risk_ack
                </div>
              </Section>

              <Section title="Knowledge window">
                <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-xs">
                  <Kv label="symbol">{CONFLUENCE_KNOWLEDGE.symbol}</Kv>
                  <Kv label="samples">{CONFLUENCE_KNOWLEDGE.samples}</Kv>
                  <Kv label="bars">
                    {CONFLUENCE_KNOWLEDGE.bars.toLocaleString()}
                  </Kv>
                  <Kv label="best">
                    {fmt(CONFLUENCE_KNOWLEDGE.bestScore, 3)}
                  </Kv>
                  <Kv label="floor (mine)">{CONFLUENCE_KNOWLEDGE.floor}</Kv>
                  <Kv label="cleared">{CONFLUENCE_KNOWLEDGE.cleared}</Kv>
                </div>
                <p className="mt-2 text-[10px] text-[var(--color-subtle)]">
                  {CONFLUENCE_KNOWLEDGE.window}
                </p>
              </Section>
            </div>

            <Section title="Component fire rates">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(CONFLUENCE_KNOWLEDGE.componentFirePct)
                  .sort((a, b) => b[1] - a[1])
                  .map(([name, pct]) => {
                    const cold =
                      CONFLUENCE_KNOWLEDGE.coldComponents.includes(name);
                    const hot =
                      CONFLUENCE_KNOWLEDGE.hotComponents.includes(name);
                    return (
                      <div key={name} className="flex items-center gap-2">
                        <span
                          className={cn(
                            "w-28 shrink-0 truncate font-mono text-[11px]",
                            cold && "text-[var(--color-down)]",
                            hot && "text-[var(--color-warn)]",
                            !cold && !hot && "text-[var(--color-muted)]",
                          )}
                        >
                          {name}
                        </span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--color-bg)]">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              cold
                                ? "bg-[var(--color-down)]"
                                : hot
                                  ? "bg-[var(--color-warn)]"
                                  : "bg-[var(--color-primary)]",
                            )}
                            style={{ width: `${Math.min(100, pct)}%` }}
                          />
                        </div>
                        <span className="w-10 text-right font-mono text-[11px] tabular text-[var(--color-fg)]">
                          {pct}%
                        </span>
                      </div>
                    );
                  })}
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-[var(--color-subtle)]">
                <Gauge className="h-3.5 w-3.5" />
                Red = cold · amber = hot (low-info alone)
              </p>
            </Section>

            <Section title="Lessons">
              <ul className="space-y-2 text-sm text-[var(--color-muted)]">
                {CONFLUENCE_KNOWLEDGE.lessons.map((l) => (
                  <li key={l} className="flex gap-2">
                    <span className="text-[var(--color-primary)]">•</span>
                    {l}
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </CardContent>
    </Card>
  );
}
