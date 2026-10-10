/**
 * The dollars. Names live on the long board, not here.
 * A month with nothing swept shows an example, not eight zeros.
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

function money(n: number): string {
  return n > 0 ? `$${n.toFixed(2)}` : "—";
}

function Rows({ slices }: { slices: SlicePlan[] }) {
  return (
    <>
      <div className="grid gap-1 sm:hidden">
        {slices.map((s) => (
          <div key={s.sleeve} className="flex items-baseline justify-between gap-2 border-t border-[var(--color-border)] py-1 text-[11px]">
            <span className="font-medium text-[var(--color-fg)]">{LABEL[s.sleeve]}</span>
            <span className="tabular-nums text-[var(--color-muted)]">{Math.round(s.weight * 100)}% · {money(s.usd)}</span>
          </div>
        ))}
      </div>
      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full text-left text-[11px]">
          <thead className="text-[10px] uppercase text-[var(--color-muted)]">
            <tr>
              <th className="py-1 pr-2 font-medium">Sleeve</th>
              <th className="py-1 pr-2 text-right font-medium">Share</th>
              <th className="py-1 pr-2 text-right font-medium">Dollars</th>
              <th className="py-1 font-medium">Why this share</th>
            </tr>
          </thead>
          <tbody>
            {slices.map((s) => (
              <tr key={s.sleeve} className="border-t border-[var(--color-border)] align-top">
                <td className="py-1.5 pr-2 font-medium text-[var(--color-fg)]">{LABEL[s.sleeve]}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{Math.round(s.weight * 100)}%</td>
                <td className="py-1.5 pr-2 text-right tabular-nums">{money(s.usd)}</td>
                <td className="py-1.5 text-[var(--color-muted)]">{s.demand}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export function FunnelCard({ waitingUsd, marks }: { waitingUsd: number; marks: InvestMarks | null }) {
  const live = waitingUsd > 0;
  const example = workedMonth(1000);
  const slices = funnelPlan(live ? waitingUsd : example.sweep, marks?.marks);
  return (
    <Card
      title="Sweep split"
      right={<span className="font-mono text-[10px] text-[var(--color-muted)]">{live ? `$${waitingUsd.toFixed(2)} waiting` : "nothing swept yet"}</span>}
    >
      {live ? (
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
          These are the dollars waiting to be bought, after rent and the sleeve refill. Names are on the board below.
        </p>
      ) : (
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
          Nothing swept yet. {example.line} The rows below are that example, not this month.
        </p>
      )}
      {!live && <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Example · not this month</p>}
      <Rows slices={slices} />
    </Card>
  );
}
