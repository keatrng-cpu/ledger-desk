/** Offline sample revenue dataset — 14 months of daily metrics. */

export type Segment = "Enterprise" | "Pro" | "Starter" | "Marketplace";
export type Channel = "Direct" | "Partner" | "Self-serve" | "Expansion";

export interface DailyPoint {
  date: string; // YYYY-MM-DD
  revenue: number;
  newMrr: number;
  churnedMrr: number;
  customers: number;
  churnedCustomers: number;
}

export interface SegmentRow {
  segment: Segment;
  revenue: number;
  customers: number;
  growth: number;
  churn: number;
  arpu: number;
}

export interface ChannelRow {
  channel: Channel;
  revenue: number;
  share: number;
  growth: number;
}

const SEGMENTS: Segment[] = ["Enterprise", "Pro", "Starter", "Marketplace"];
const CHANNELS: Channel[] = ["Direct", "Partner", "Self-serve", "Expansion"];

/** Deterministic PRNG for stable sample data across reloads. */
function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Generate ~14 months ending “today” (fixed anchor for SSR stability). */
const ANCHOR = new Date("2026-08-10T12:00:00Z");
const START = addDays(ANCHOR, -420);

export function generateDailySeries(): DailyPoint[] {
  const rand = mulberry32(42);
  const out: DailyPoint[] = [];
  let baseRev = 42_000;
  let customers = 1_850;

  for (let i = 0; i <= 420; i++) {
    const d = addDays(START, i);
    const day = d.getUTCDay();
    const month = d.getUTCMonth();
    // Seasonal + weekly pattern
    const weekend = day === 0 || day === 6 ? 0.72 : 1;
    const season = 1 + 0.08 * Math.sin((month / 12) * Math.PI * 2);
    const trend = 1 + i * 0.00055;
    const noise = 0.92 + rand() * 0.16;
    // Occasional soft dips / spikes
    const event = rand() > 0.97 ? 0.82 : rand() > 0.95 ? 1.18 : 1;

    const revenue = Math.round(baseRev * weekend * season * trend * noise * event);
    const newMrr = Math.round(revenue * (0.04 + rand() * 0.05));
    const churnRateDay = 0.0012 + rand() * 0.0018 + (month === 0 || month === 6 ? 0.0006 : 0);
    const churnedMrr = Math.round(revenue * churnRateDay * 8);
    const newCust = Math.max(1, Math.round(newMrr / 180 + rand() * 4));
    const churnedCust = Math.max(0, Math.round(customers * churnRateDay * 2.2));
    customers = Math.max(800, customers + newCust - churnedCust);

    out.push({
      date: iso(d),
      revenue,
      newMrr,
      churnedMrr,
      customers,
      churnedCustomers: churnedCust,
    });
    baseRev += (rand() - 0.42) * 120;
  }
  return out;
}

export const DAILY_SERIES: DailyPoint[] = generateDailySeries();

export function filterSeries(
  series: DailyPoint[],
  from: string,
  to: string,
): DailyPoint[] {
  return series.filter((p) => p.date >= from && p.date <= to);
}

export function summarize(series: DailyPoint[]) {
  if (series.length === 0) {
    return {
      revenue: 0,
      prevRevenue: 0,
      growth: 0,
      churn: 0,
      customers: 0,
      newMrr: 0,
      churnedMrr: 0,
      arpu: 0,
    };
  }
  const revenue = series.reduce((s, p) => s + p.revenue, 0);
  const newMrr = series.reduce((s, p) => s + p.newMrr, 0);
  const churnedMrr = series.reduce((s, p) => s + p.churnedMrr, 0);
  const customers = series[series.length - 1]?.customers ?? 0;
  const mid = Math.floor(series.length / 2);
  const firstHalf = series.slice(0, mid);
  const secondHalf = series.slice(mid);
  const firstRev = firstHalf.reduce((s, p) => s + p.revenue, 0) || 1;
  const secondRev = secondHalf.reduce((s, p) => s + p.revenue, 0);
  const growth = ((secondRev - firstRev) / firstRev) * 100;
  const churn =
    revenue > 0 ? (churnedMrr / (revenue + churnedMrr)) * 100 * (30 / Math.max(series.length, 1)) * (series.length / 30) : 0;
  // Normalize churn to approximate monthly rate
  const days = Math.max(series.length, 1);
  const monthlyChurn = (churnedMrr / Math.max(revenue, 1)) * (30 / days) * 100;
  const arpu = customers > 0 ? revenue / customers / (days / 30) : 0;

  return {
    revenue,
    prevRevenue: firstRev,
    growth,
    churn: Math.min(18, Math.max(0.4, monthlyChurn)),
    customers,
    newMrr,
    churnedMrr,
    arpu,
  };
}

export function segmentBreakdown(series: DailyPoint[]): SegmentRow[] {
  const rand = mulberry32(99);
  const total = series.reduce((s, p) => s + p.revenue, 0) || 1;
  const weights: Record<Segment, number> = {
    Enterprise: 0.42 + rand() * 0.04,
    Pro: 0.28 + rand() * 0.03,
    Starter: 0.18 + rand() * 0.02,
    Marketplace: 0.12,
  };
  // Normalize
  const sumW = Object.values(weights).reduce((a, b) => a + b, 0);
  return SEGMENTS.map((segment) => {
    const w = weights[segment] / sumW;
    const revenue = Math.round(total * w);
    const customers = Math.round(
      (series[series.length - 1]?.customers ?? 1000) * w * (segment === "Enterprise" ? 0.35 : 1.1),
    );
    const growth =
      segment === "Enterprise"
        ? 8 + rand() * 6
        : segment === "Pro"
          ? 12 + rand() * 8
          : segment === "Starter"
            ? 4 + rand() * 10
            : 18 + rand() * 12;
    const churn =
      segment === "Enterprise"
        ? 1.2 + rand() * 0.8
        : segment === "Pro"
          ? 2.4 + rand() * 1.2
          : segment === "Starter"
            ? 4.5 + rand() * 2
            : 3.1 + rand() * 1.5;
    return {
      segment,
      revenue,
      customers: Math.max(40, customers),
      growth: Math.round(growth * 10) / 10,
      churn: Math.round(churn * 10) / 10,
      arpu: Math.round(revenue / Math.max(customers, 1)),
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

export function channelBreakdown(series: DailyPoint[]): ChannelRow[] {
  const rand = mulberry32(77);
  const total = series.reduce((s, p) => s + p.revenue, 0) || 1;
  const raw: Record<Channel, number> = {
    Direct: 0.34 + rand() * 0.05,
    Partner: 0.22 + rand() * 0.04,
    "Self-serve": 0.28 + rand() * 0.04,
    Expansion: 0.16 + rand() * 0.03,
  };
  const sum = Object.values(raw).reduce((a, b) => a + b, 0);
  return CHANNELS.map((channel) => {
    const share = (raw[channel] / sum) * 100;
    const revenue = Math.round(total * (share / 100));
    const growth =
      channel === "Expansion"
        ? 15 + rand() * 12
        : channel === "Self-serve"
          ? 9 + rand() * 8
          : channel === "Partner"
            ? 5 + rand() * 7
            : 7 + rand() * 6;
    return {
      channel,
      revenue,
      share: Math.round(share * 10) / 10,
      growth: Math.round(growth * 10) / 10,
    };
  }).sort((a, b) => b.revenue - a.revenue);
}

export function aggregateTrend(
  series: DailyPoint[],
  granularity: "day" | "week" | "month",
): { date: string; revenue: number; newMrr: number; churnedMrr: number; label: string }[] {
  if (granularity === "day") {
    return series.map((p) => ({
      date: p.date,
      revenue: p.revenue,
      newMrr: p.newMrr,
      churnedMrr: p.churnedMrr,
      label: p.date.slice(5),
    }));
  }

  const buckets = new Map<
    string,
    { revenue: number; newMrr: number; churnedMrr: number; date: string }
  >();

  for (const p of series) {
    const d = new Date(p.date + "T00:00:00Z");
    let key: string;
    let label: string;
    if (granularity === "week") {
      const day = d.getUTCDay();
      const mondayOffset = day === 0 ? -6 : 1 - day;
      const mon = addDays(d, mondayOffset);
      key = iso(mon);
      label = key.slice(5);
    } else {
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
      label = key;
    }
    const cur = buckets.get(key) ?? { revenue: 0, newMrr: 0, churnedMrr: 0, date: key };
    cur.revenue += p.revenue;
    cur.newMrr += p.newMrr;
    cur.churnedMrr += p.churnedMrr;
    buckets.set(key, cur);
  }

  return Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, v]) => ({
      date: key,
      revenue: v.revenue,
      newMrr: v.newMrr,
      churnedMrr: v.churnedMrr,
      label: granularity === "month" ? key : key.slice(5),
    }));
}

export type DatePreset = "7d" | "30d" | "90d" | "ytd" | "12m";

export function rangeForPreset(preset: DatePreset): { from: string; to: string } {
  const to = iso(ANCHOR);
  if (preset === "7d") return { from: iso(addDays(ANCHOR, -6)), to };
  if (preset === "30d") return { from: iso(addDays(ANCHOR, -29)), to };
  if (preset === "90d") return { from: iso(addDays(ANCHOR, -89)), to };
  if (preset === "ytd") return { from: "2026-01-01", to };
  return { from: iso(addDays(ANCHOR, -364)), to };
}

export const DATA_ANCHOR = iso(ANCHOR);
export const DATA_START = iso(START);
