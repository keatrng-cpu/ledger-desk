import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";

export interface TrendPoint {
  date: string;
  revenue: number;
  newMrr: number;
  churnedMrr: number;
  label: string;
}

interface TrendChartsProps {
  data: TrendPoint[];
  granularity: "day" | "week" | "month";
  onGranularity: (g: "day" | "week" | "month") => void;
}

const tooltipStyle = {
  backgroundColor: "#18181c",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  fontSize: 12,
  color: "#f4f4f5",
  boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
};

function MoneyTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name: string; value: number; color: string }[];
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div style={tooltipStyle} className="px-3 py-2">
      <p className="mb-1.5 font-mono text-[11px] text-[var(--color-subtle)]">{label}</p>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-6 text-xs">
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: p.color }}
            />
            {p.name}
          </span>
          <span className="font-mono tabular text-[var(--color-fg)]">
            {formatCurrency(p.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

export function TrendCharts({ data, granularity, onGranularity }: TrendChartsProps) {
  const grains: { id: "day" | "week" | "month"; label: string }[] = [
    { id: "day", label: "Day" },
    { id: "week", label: "Week" },
    { id: "month", label: "Month" },
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-5">
      <Card className="xl:col-span-3">
        <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="text-sm font-medium text-[var(--color-fg)]">
              Revenue trend
            </CardTitle>
            <CardDescription>Gross revenue over the selected range</CardDescription>
          </div>
          <div
            className="inline-flex rounded-[var(--radius-sm)] border border-[var(--color-border)] p-0.5"
            role="group"
            aria-label="Chart granularity"
          >
            {grains.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => onGranularity(g.id)}
                className={
                  granularity === g.id
                    ? "rounded-[calc(var(--radius-sm)-2px)] bg-[var(--color-surface-3)] px-2.5 py-1 text-xs font-medium text-[var(--color-fg)]"
                    : "rounded-[calc(var(--radius-sm)-2px)] px-2.5 py-1 text-xs font-medium text-[var(--color-muted)] hover:text-[var(--color-fg)]"
                }
              >
                {g.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent className="h-[280px] sm:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="revFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#2dd4bf" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#2dd4bf" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(Number(v), true)}
                width={56}
              />
              <Tooltip content={<MoneyTooltip />} cursor={{ stroke: "#3f3f46" }} />
              <Area
                type="monotone"
                dataKey="revenue"
                name="Revenue"
                stroke="#2dd4bf"
                strokeWidth={2}
                fill="url(#revFill)"
                isAnimationActive
                animationDuration={400}
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-[var(--color-fg)]">
            New vs churned MRR
          </CardTitle>
          <CardDescription>Inflows against attrition</CardDescription>
        </CardHeader>
        <CardContent className="h-[280px] sm:h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={32}
              />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(Number(v), true)}
                width={52}
              />
              <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              <Legend
                wrapperStyle={{ fontSize: 12, color: "#a1a1aa" }}
                iconType="circle"
                iconSize={8}
              />
              <Bar
                dataKey="newMrr"
                name="New MRR"
                fill="#60a5fa"
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
              />
              <Bar
                dataKey="churnedMrr"
                name="Churned"
                fill="#f87171"
                radius={[3, 3, 0, 0]}
                maxBarSize={18}
              />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="xl:col-span-5">
        <CardHeader>
          <CardTitle className="text-sm font-medium text-[var(--color-fg)]">
            Net new MRR line
          </CardTitle>
          <CardDescription>New MRR minus churned MRR — the real book build</CardDescription>
        </CardHeader>
        <CardContent className="h-[220px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={data.map((d) => ({
                ...d,
                net: d.newMrr - d.churnedMrr,
              }))}
              margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
            >
              <CartesianGrid stroke="#27272a" strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                minTickGap={28}
              />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 11 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => formatCurrency(Number(v), true)}
                width={56}
              />
              <Tooltip content={<MoneyTooltip />} />
              <Line
                type="monotone"
                dataKey="net"
                name="Net new MRR"
                stroke="#94a3b8"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#94a3b8" }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
}
