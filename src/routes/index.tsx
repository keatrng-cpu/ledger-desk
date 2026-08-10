import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Activity, BarChart3 } from "lucide-react";
import { AiInsights } from "@/components/dashboard/ai-insights";
import { AplusOps } from "@/components/dashboard/aplus-ops";
import { BreakdownTable } from "@/components/dashboard/breakdown-table";
import { DateRangeFilter } from "@/components/dashboard/date-range-filter";
import { DualIndexCharts } from "@/components/dashboard/dual-index-charts";
import { KpiCards } from "@/components/dashboard/kpi-cards";
import { TrendCharts } from "@/components/dashboard/trend-charts";
import type { MetricsSnapshot } from "@/lib/ai/analyze";
import {
  DAILY_SERIES,
  aggregateTrend,
  channelBreakdown,
  filterSeries,
  rangeForPreset,
  segmentBreakdown,
  summarize,
  type DatePreset,
} from "@/lib/data/sample-revenue";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const initial = rangeForPreset("30d");
  const [preset, setPreset] = useState<DatePreset | "custom">("30d");
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [granularity, setGranularity] = useState<"day" | "week" | "month">(
    "day",
  );

  const filtered = useMemo(
    () => filterSeries(DAILY_SERIES, from, to),
    [from, to],
  );

  const metrics = useMemo(() => summarize(filtered), [filtered]);
  const segments = useMemo(() => segmentBreakdown(filtered), [filtered]);
  const channels = useMemo(() => channelBreakdown(filtered), [filtered]);
  const trend = useMemo(
    () => aggregateTrend(filtered, granularity),
    [filtered, granularity],
  );

  const snapshot: MetricsSnapshot = useMemo(
    () => ({
      from,
      to,
      revenue: metrics.revenue,
      growth: metrics.growth,
      churn: metrics.churn,
      customers: metrics.customers,
      newMrr: metrics.newMrr,
      churnedMrr: metrics.churnedMrr,
      arpu: metrics.arpu,
      topSegment: segments[0]?.segment ?? "—",
      topChannel: channels[0]?.channel ?? "—",
      segments: segments.map((s) => ({
        segment: s.segment,
        revenue: s.revenue,
        growth: s.growth,
        churn: s.churn,
      })),
      channels: channels.map((c) => ({
        channel: c.channel,
        revenue: c.revenue,
        share: c.share,
        growth: c.growth,
      })),
    }),
    [from, to, metrics, segments, channels],
  );

  return (
    <div className="min-h-dvh bg-[var(--color-bg)]">
      <div
        className="pointer-events-none fixed inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "radial-gradient(ellipse 80% 50% at 50% -20%, color-mix(in oklab, var(--color-primary) 12%, transparent), transparent), linear-gradient(var(--color-border) 1px, transparent 1px), linear-gradient(90deg, var(--color-border) 1px, transparent 1px)",
          backgroundSize: "100% 100%, 48px 48px, 48px 48px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 70%)",
        }}
        aria-hidden
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-[calc(var(--grok-banner-h,0px)+1rem)] sm:px-6 lg:px-8">
        <header className="mb-6 flex flex-col gap-4 border-b border-[var(--color-border)] pb-6 sm:mb-8 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-[var(--color-primary)]">
              <BarChart3 className="h-5 w-5" aria-hidden />
              <span className="text-xs font-semibold uppercase tracking-[0.14em]">
                Ledger · aplus
              </span>
            </div>
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--color-fg)] sm:text-3xl">
              Trading desk + revenue
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm text-[var(--color-muted)]">
              Dual MNQ/ES live charts, Trading-Automation ops console (backtest ·
              premarket · rules), and sample SaaS analytics — one surface for
              Grok and Claude.
            </p>
          </div>
          <div className="flex items-center gap-2 self-start rounded-full border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1.5 text-xs text-[var(--color-subtle)] sm:self-auto">
            <Activity className="h-3.5 w-3.5 text-[var(--color-up)]" aria-hidden />
            <span>keatrng-cpu/Trading-Automation ported</span>
          </div>
        </header>

        <div className="mb-6">
          <DateRangeFilter
            preset={preset === "custom" ? "30d" : preset}
            from={from}
            to={to}
            onPreset={(p) => {
              setPreset(p);
              const r = rangeForPreset(p);
              setFrom(r.from);
              setTo(r.to);
              if (p === "7d" || p === "30d") setGranularity("day");
              else if (p === "90d") setGranularity("week");
              else setGranularity("month");
            }}
            onCustom={(f, t) => {
              setFrom(f);
              setTo(t);
              setPreset("custom");
            }}
          />
        </div>

        <div className="space-y-4 sm:space-y-5">
          <DualIndexCharts />

          <AplusOps />

          <KpiCards
            revenue={metrics.revenue}
            growth={metrics.growth}
            churn={metrics.churn}
            customers={metrics.customers}
            newMrr={metrics.newMrr}
          />

          <AiInsights snapshot={snapshot} />

          <TrendCharts
            data={trend}
            granularity={granularity}
            onGranularity={setGranularity}
          />

          <BreakdownTable segments={segments} channels={channels} />
        </div>

        <footer className="mt-10 border-t border-[var(--color-border)] pt-6 text-center text-xs text-[var(--color-subtle)]">
          aplus rules/metrics from Trading-Automation · futures OHLC Yahoo
          continuous · revenue sample offline · AI never gates trades
        </footer>
      </div>
    </div>
  );
}
