import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { ChannelRow, SegmentRow } from "@/lib/data/sample-revenue";
import { cn, formatCurrency, formatNumber, formatPct } from "@/lib/utils";

interface BreakdownTableProps {
  segments: SegmentRow[];
  channels: ChannelRow[];
}

export function BreakdownTable({ segments, channels }: BreakdownTableProps) {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-[var(--color-fg)]">
            Segment breakdown
          </CardTitle>
          <CardDescription>Revenue mix by customer tier</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[420px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-subtle)]">
                <th className="pb-2 pr-3 font-medium">Segment</th>
                <th className="pb-2 pr-3 font-medium text-right">Revenue</th>
                <th className="pb-2 pr-3 font-medium text-right">Customers</th>
                <th className="pb-2 pr-3 font-medium text-right">Growth</th>
                <th className="pb-2 font-medium text-right">Churn</th>
              </tr>
            </thead>
            <tbody>
              {segments.map((row) => (
                <tr
                  key={row.segment}
                  className="border-b border-[var(--color-border)]/60 transition-colors last:border-0 hover:bg-[var(--color-surface-2)]"
                >
                  <td className="py-3 pr-3 font-medium text-[var(--color-fg)]">
                    {row.segment}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono tabular text-[var(--color-fg)]">
                    {formatCurrency(row.revenue)}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono tabular text-[var(--color-muted)]">
                    {formatNumber(row.customers)}
                  </td>
                  <td
                    className={cn(
                      "py-3 pr-3 text-right font-mono tabular",
                      row.growth >= 0
                        ? "text-[var(--color-up)]"
                        : "text-[var(--color-down)]",
                    )}
                  >
                    {formatPct(row.growth)}
                  </td>
                  <td
                    className={cn(
                      "py-3 text-right font-mono tabular",
                      row.churn > 4
                        ? "text-[var(--color-down)]"
                        : "text-[var(--color-muted)]",
                    )}
                  >
                    {row.churn.toFixed(1)}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium text-[var(--color-fg)]">
            Channel breakdown
          </CardTitle>
          <CardDescription>Acquisition and expansion mix</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full min-w-[380px] border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-xs uppercase tracking-wider text-[var(--color-subtle)]">
                <th className="pb-2 pr-3 font-medium">Channel</th>
                <th className="pb-2 pr-3 font-medium text-right">Revenue</th>
                <th className="pb-2 pr-3 font-medium text-right">Share</th>
                <th className="pb-2 font-medium text-right">Growth</th>
              </tr>
            </thead>
            <tbody>
              {channels.map((row) => (
                <tr
                  key={row.channel}
                  className="border-b border-[var(--color-border)]/60 transition-colors last:border-0 hover:bg-[var(--color-surface-2)]"
                >
                  <td className="py-3 pr-3 font-medium text-[var(--color-fg)]">
                    {row.channel}
                  </td>
                  <td className="py-3 pr-3 text-right font-mono tabular text-[var(--color-fg)]">
                    {formatCurrency(row.revenue)}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <div className="hidden h-1.5 w-16 overflow-hidden rounded-full bg-[var(--color-surface-3)] sm:block">
                        <div
                          className="h-full rounded-full bg-[var(--color-primary)]"
                          style={{ width: `${Math.min(100, row.share)}%` }}
                        />
                      </div>
                      <span className="font-mono tabular text-[var(--color-muted)]">
                        {row.share.toFixed(1)}%
                      </span>
                    </div>
                  </td>
                  <td
                    className={cn(
                      "py-3 text-right font-mono tabular",
                      row.growth >= 0
                        ? "text-[var(--color-up)]"
                        : "text-[var(--color-down)]",
                    )}
                  >
                    {formatPct(row.growth)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
