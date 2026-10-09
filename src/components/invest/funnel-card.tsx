/**
 * The split of the swept dollars. A table, not a button.
 */

import { funnelPlan, workedMonth, type SlicePlan } from "@/lib/invest/funnel";
import type { InvestMarks } from "@/lib/invest/marks";
import { Card } from "./ui";

const LABEL: Record<SlicePlan["sleeve"], string> = {
  safety: "Safety",
  power: "Power",
  grid: "Grid",
  fuel: "Fuel",
  compute: "Compute",
  building: "Buildings",
  space: "Space",
  health: "Health",
};

export function FunnelCard({ waitingUsd, marks }: { waitingUsd: number; marks: InvestMarks | null }) {
  const slices = funnelPlan(waitingUsd, marks?.marks);
  const example = workedMonth(1000);
  return (
    <Card title="Sweep split" right={<span className="font-mono text-[10px] text-[var(--color-muted)]">{`$${waitingUsd.toFixed(2)} waiting`}</span>}>
      <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
        The earned cut is 20% of a closed, positive month after the $199 data rent and after the sleeve is back to $1,000. This table splits that cut. It does not buy.
      </p>
      <p className="mb-2 text-[11px] leading-snug text-[var(--color-muted)]">{example.line} On a $1,000 month the split below would be ${example.sweep.toFixed(2)}.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left text-[11px]">
          <thead className="text-[10px] uppercase text-[var(--color-muted)]">
            <tr>
              <th className="py-1 pr-2 font-medium">Sleeve</th>
              <th className="py-1 pr-2 text-right font-medium">Share</th>
              <th className="py-1 pr-2 text-right font-medium">Of waiting</th>
              <th className="py-1 pr-2 font-medium">Next name</th>
              <th className="py-1 font-medium">Why this share</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.sleeve} className="border-t border-[var(--color-border)] align-top">
                <td className="py-1.5 pr-2 font-medium text-[var(--color-fg)]">{LABEL[s.sleeve]}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{Math.round(s.weight * 100)}%</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">${s.usd.toFixed(2)}</td>
                <td className="py-1.5 pr-2">
                  <span className="font-medium">{s.ticker ?? "—"}</span>
                  <span className="text-[var(--color-muted)]"> {s.state}</span>
                </td>
                <td className="py-1.5 text-[var(--color-muted)]">{s.demand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
