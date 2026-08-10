import {
  ArrowDownRight,
  ArrowUpRight,
  DollarSign,
  TrendingUp,
  UserMinus,
  Users,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatNumber, formatPct } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface KpiCardsProps {
  revenue: number;
  growth: number;
  churn: number;
  customers: number;
  newMrr: number;
}

function Delta({ value, invert }: { value: number; invert?: boolean }) {
  const good = invert ? value <= 0 : value >= 0;
  const Icon = value >= 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 text-xs font-medium tabular",
        good ? "text-[var(--color-up)]" : "text-[var(--color-down)]",
      )}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden />
      {formatPct(value)}
    </span>
  );
}

export function KpiCards({
  revenue,
  growth,
  churn,
  customers,
  newMrr,
}: KpiCardsProps) {
  const items = [
    {
      key: "revenue",
      label: "Period revenue",
      value: formatCurrency(revenue),
      sub: `New MRR ${formatCurrency(newMrr, true)}`,
      icon: DollarSign,
      delta: growth,
    },
    {
      key: "growth",
      label: "Growth (half-over-half)",
      value: formatPct(growth),
      sub: "First half vs second half of range",
      icon: TrendingUp,
      delta: growth,
    },
    {
      key: "churn",
      label: "Churn (monthly eq.)",
      value: `${churn.toFixed(1)}%`,
      sub: "Gross MRR attrition rate",
      icon: UserMinus,
      delta: -churn,
      invert: true as const,
    },
    {
      key: "customers",
      label: "Active customers",
      value: formatNumber(customers),
      sub: "End of selected range",
      icon: Users,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4 sm:gap-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <Card
            key={item.key}
            className="relative overflow-hidden transition-colors duration-200 hover:border-[var(--color-border-strong)]"
          >
            <div
              className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-[var(--color-primary)] to-transparent opacity-40"
              aria-hidden
            />
            <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
              <CardTitle className="text-xs uppercase tracking-wider text-[var(--color-subtle)]">
                {item.label}
              </CardTitle>
              <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
                <Icon className="h-4 w-4" aria-hidden />
              </div>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2">
                <p className="font-mono text-2xl font-semibold tracking-tight tabular text-[var(--color-fg)] sm:text-[1.75rem]">
                  {item.value}
                </p>
                {"delta" in item && item.delta !== undefined && item.key !== "growth" && (
                  <Delta value={item.delta} invert={item.invert} />
                )}
              </div>
              <p className="mt-1.5 text-xs text-[var(--color-subtle)]">{item.sub}</p>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
