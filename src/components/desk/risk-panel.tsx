import { Shield } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { APLUS_RULES } from "@/lib/aplus/config";

export function RiskPanel({ desk }: { desk: DeskPayload }) {
  const r = desk.risk;
  const rows = [
    ["Account equity", `$${r.equity.toLocaleString()}`],
    ["Risk / trade", `${(r.riskPct * 100).toFixed(1)}% · $${r.riskDollars.toFixed(0)}`],
    ["Ceiling", `${(APLUS_RULES.riskPctCeiling * 100).toFixed(0)}% hard cap`],
    ["R:R band", `${APLUS_RULES.minRr}:1 – 1:${APLUS_RULES.tpMaxR}`],
    ["Setups / killzone", String(r.maxSetups)],
    ["Daily halt", `${(r.dailyLimitPct * 100).toFixed(0)}%`],
    ["Weekly halt", `${(r.weeklyLimitPct * 100).toFixed(0)}%`],
    ["Micros preferred", r.micros ? "MNQ / MES" : "Minis"],
    ["Confluence floor", String(r.floor)],
    ["A+ tag", `≥ ${APLUS_RULES.aPlusThreshold}`],
  ] as const;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex items-center gap-2">
        <Shield className="h-4 w-4 text-[var(--color-primary)]" />
        <div>
          <h2 className="text-sm font-semibold text-[var(--color-fg)]">
            5 · Risk governor
          </h2>
          <p className="text-xs text-[var(--color-subtle)]">
            Non-negotiables from Trading-Automation — AI cannot override
          </p>
        </div>
      </header>
      <div className="grid grid-cols-1 gap-x-4 gap-y-1.5 font-mono text-xs sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div
            key={k}
            className="flex justify-between gap-3 border-b border-[var(--color-border)] py-1.5"
          >
            <span className="text-[var(--color-subtle)]">{k}</span>
            <span className="text-right text-[var(--color-fg)]">{v}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[var(--color-muted)]">
        One idea per instrument. Zero trades on a quiet day is correct. Live
        trading stays locked until mode + credentials + risk ack.
      </p>
    </section>
  );
}
