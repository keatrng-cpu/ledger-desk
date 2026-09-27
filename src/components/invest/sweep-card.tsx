/**
 * THE SWEEP — the only thing on the tab that moves money, so it is first.
 *
 * Changed 2026-09-26:
 *   - The month is PICKED, and a month that has not ended cannot be logged
 *     (validateSweepMonth). The old "Month is closed" checkbox was the only
 *     check, and it was the trader's word against the calendar.
 *   - The month's realized P&L is OFFERED from the desk's own RH journal,
 *     closed trades only, for the trader to confirm — never pre-filled.
 *   - The waterfall runs backwards too: what a month must realize for a
 *     sweep of a given size.
 */

import { useMemo, useState } from "react";
import { TriangleAlert } from "lucide-react";
import {
  planSweep,
  rentVsSweep,
  realizedNeededFor,
  validateSweepMonth,
  DATA_RENT_MONTHLY_USD,
  SLEEVE_TARGET_USD,
  type SweepPlan,
} from "@/lib/invest/policy";
import { logSweep, etMonth } from "@/lib/invest/store";
import { rhMonth } from "@/lib/invest/rh-bridge";
import { BUTTON, INPUT, VERDICT_CLS, usd, usd0 } from "./format";
import { Card, Note } from "./ui";

function priorMonth(now = new Date()): string {
  const [y, m] = etMonth(now).split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function SweepCard({
  closedMonths,
  rate,
  onWrite,
}: {
  closedMonths: number;
  /** The earned rate from the ladder (policy.rateLadder) — never chosen here. */
  rate: { fullRateEarned: boolean };
  onWrite: () => void;
}) {
  const [month, setMonth] = useState(() => priorMonth());
  const [realized, setRealized] = useState("");
  const [sleeve, setSleeve] = useState(String(SLEEVE_TARGET_USD));
  const [msg, setMsg] = useState<string | null>(null);

  const monthCheck = validateSweepMonth(month, etMonth());
  const journal = useMemo(() => rhMonth(month), [month]);

  const plan: SweepPlan = planSweep({
    realizedMonthUsd: Number(realized) || 0,
    monthClosed: monthCheck.ok,
    sleeveEquityUsd: Number(sleeve) || 0,
    closedMonths,
    fullRateEarned: rate.fullRateEarned,
  });
  const rent = rentVsSweep(plan);
  const needs = [25, 100, 250].map((t) => ({ t, need: realizedNeededFor(t, plan.rate) }));

  return (
    <>
      <Card title="This month's sweep">
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <label className="text-[11px] text-[var(--color-muted)]">
            Month
            <input
              type="month"
              value={month}
              onChange={(e) => {
                setMonth(e.target.value);
                setMsg(null);
              }}
              className={`mt-1 w-full ${INPUT}`}
            />
          </label>
          <label className="text-[11px] text-[var(--color-muted)]">
            Realized options P&amp;L (closed only)
            <input
              value={realized}
              onChange={(e) => setRealized(e.target.value)}
              inputMode="decimal"
              placeholder="e.g. 226"
              className={`mt-1 w-full ${INPUT}`}
            />
          </label>
          <label className="text-[11px] text-[var(--color-muted)]">
            RH sleeve cash after the month
            <input
              value={sleeve}
              onChange={(e) => setSleeve(e.target.value)}
              inputMode="decimal"
              className={`mt-1 w-full ${INPUT}`}
            />
          </label>
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-2 rounded border border-[var(--color-border)] p-2">
          <span className="text-[11px] text-[var(--color-muted)]">{journal.line}</span>
          {journal.closedCount > 0 && (
            <button type="button" className={BUTTON} onClick={() => setRealized(String(journal.realizedUsd))}>
              Use {usd(journal.realizedUsd)}
            </button>
          )}
          {journal.capNote && <Note tone="warn">{journal.capNote}</Note>}
        </div>

        {!monthCheck.ok && <Note tone="warn">{monthCheck.why}</Note>}

        <div className="mb-2 mt-1 flex flex-wrap items-baseline gap-2">
          <span
            className={`rounded border px-2 py-0.5 text-xs font-semibold ${
              plan.verdict === "SWEEP" ? VERDICT_CLS.CORE : plan.verdict === "SHORT" ? VERDICT_CLS.OUT : VERDICT_CLS.HOLD
            }`}
          >
            {plan.verdict}
          </span>
          <span className="text-lg font-semibold tabular-nums">{usd(plan.sweepUsd)}</span>
          <span className="text-[11px] text-[var(--color-muted)]">
            to shares at the earned {Math.round(plan.rate * 100)}% ({closedMonths} closed month{closedMonths === 1 ? "" : "s"}{" "}
            logged)
          </span>
        </div>

        {plan.steps.length > 0 && (
          <ol className="mb-2 space-y-0.5">
            {plan.steps.map((s) => (
              <li key={s.label} className="flex flex-wrap justify-between gap-x-2 text-[11px] tabular-nums">
                <span className="text-[var(--color-muted)]">{s.label}</span>
                <span className="flex gap-3">
                  <span className={s.usd < 0 ? "text-[var(--color-down)]" : "text-[var(--color-fg)]"}>{usd(s.usd)}</span>
                  <span className="text-right text-[var(--color-muted)]">{s.note}</span>
                </span>
              </li>
            ))}
          </ol>
        )}
        <Note>{plan.note}</Note>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className={BUTTON}
            disabled={!monthCheck.ok || realized.trim() === "" || !Number.isFinite(Number(realized))}
            onClick={() => {
              const res = logSweep({
                month,
                verdict: plan.verdict,
                realizedUsd: Number(realized) || 0,
                rentUsd: plan.rentCoveredUsd,
                restoreUsd: plan.restoreUsd,
                sweptUsd: plan.sweepUsd,
                rate: plan.rate,
                loggedAt: new Date().toISOString(),
                note: plan.note,
              });
              setMsg(res.logged ? `${month} logged — ${usd(plan.sweepUsd)} to shares.` : res.why);
              if (res.logged) onWrite();
            }}
          >
            Log {month}
          </button>
          <span className="text-[10px] text-[var(--color-muted)]">
            {msg ?? "A month is priced once, after it ends. A wrong entry is voided with a reason, never edited."}
          </span>
        </div>

        <div className="mt-3 border-t border-[var(--color-border)] pt-2">
          <Note>
            <span className="text-[var(--color-fg)]">What a sweep costs to earn</span> at {Math.round(plan.rate * 100)}%:
            every $1 swept needs ${(1 / plan.rate).toFixed(0)} realized above the ${DATA_RENT_MONTHLY_USD} rent.{" "}
            {needs.map((n) => `${usd0(n.t)}/mo needs ${usd0(n.need)}`).join(" · ")} realized (sleeve whole). The rent alone
            is ${Math.round(DATA_RENT_MONTHLY_USD / 4.33)}/week before a dollar reaches shares.
          </Note>
        </div>
      </Card>

      {plan.rentAlarm && (
        <Card title="The bill is the story" tone="warn">
          <p className="flex gap-2 text-[11px] leading-relaxed">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-[var(--color-warn)]" />
            <span>
              Databento is eating {Math.round(plan.rentDrag * 100)}% of gross. {rent.line}
            </span>
          </p>
        </Card>
      )}
    </>
  );
}
