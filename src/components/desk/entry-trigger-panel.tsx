/**
 * The entry strip — tier, the resting limit, and what the click costs.
 *
 * Sits directly under the drawn chart, because those three answers are what
 * the trader does next: is this worth watching, put the order where the plan
 * says, and know the loss before it happens rather than after.
 *
 * The button rests a limit; it does not take a trade. The justification is
 * not a statistic — the pooled "+0.35R resting" figure turned out to live
 * entirely in the London killzone (see entry-trigger.ts) — it is that the
 * plan named a price, and an order sitting at that price cannot be turned
 * into a market click by impatience.
 */

import { useEffect, useMemo, useState } from "react";
import { Timer } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { SmcMasterBook } from "@/lib/trading/smc-master";
import { previewLoss, readEntry, readRunner, type EntryTier } from "@/lib/trading/entry-trigger";
import {
  cancelPending,
  loadPending,
  pendingLeftMin,
  restLimit,
  restingFor,
  subscribePending,
  type PendingOrder,
} from "@/lib/trading/pending-order";
import { readRhIncome } from "@/lib/trading/rh-income";
import { loadRhSleeve, rhRiskBudgetUsd } from "@/lib/trading/options-sleeve";

const TIER_STYLE: Record<EntryTier, { label: string; cls: string }> = {
  live: {
    label: "LIVE",
    cls: "border-[color-mix(in_oklab,var(--color-up)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-up)_14%,transparent)] text-[var(--color-up)]",
  },
  armed: {
    label: "ARMED",
    cls: "border-[color-mix(in_oklab,var(--color-warn)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]",
  },
  forming: {
    label: "FORMING",
    cls: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]",
  },
  gone: {
    label: "WALKED OFF",
    cls: "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-subtle)]",
  },
};

const PATH_BANDS = new Set(["A+", "A", "A-", "A−"]);

export function EntryTriggerPanel({ desk, book }: { desk: DeskPayload; book: SmcMasterBook }) {
  // Bumped on every pending-order event and read by the memo below. It used
  // to be a throwaway counter while the memo keyed on the symbol alone, so a
  // rested, filled, expired or cancelled order never reached the screen.
  const [pendingVersion, bump] = useState(0);
  useEffect(() => subscribePending(() => bump((n) => n + 1)), []);

  const plan = book.plan;
  const isLeft = desk.left.symbol === book.symbol;
  const price = isLeft ? desk.quotes.left.price : desk.quotes.right.price;
  const atr = (isLeft ? desk.draws.left : desk.draws.right).atr || null;

  const read = useMemo(() => readEntry(plan, price, atr), [plan, price, atr]);
  const pending = useMemo(() => {
    void loadPending();
    return restingFor(book.symbol);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.symbol, pendingVersion]);

  const runner = useMemo(() => readRunner(plan, false), [plan]);
  const loss = useMemo(() => {
    // The number the trader feels is the SLEEVE ticket, not the $100k paper
    // book's 2%. Quote the real money first and the paper risk beside it.
    const income = typeof window === "undefined" ? null : readRhIncome();
    return previewLoss({
      // The LOSS budget, not the ticket ceiling. Still $150 — under the old
      // model that number was mislabelled "max debit" and happened to be the
      // right answer here by coincidence. Now it is the right answer by name.
      sleeveRisk: rhRiskBudgetUsd(loadRhSleeve()),
      paperRisk: desk.risk.riskDollars,
      weekPnl: income?.weekPnl ?? null,
      rr1: plan?.rr1 ?? null,
      logged: (income?.openCount ?? 0) + (income?.closedCount ?? 0),
    });
  }, [desk.risk.riskDollars, plan?.rr1]);

  if (!plan || !read) return null;
  const style = TIER_STYLE[read.tier];
  const now = Date.parse(desk.fetchedAt) || 0;

  // The same refusals the ticket prints (entry-ticket.ts / card-plan.ts). A
  // resting order is a commitment to size at a fill, so it may only rest
  // where a ticket would size: a PATH band, a book not standing down, and a
  // stop inside the measured band.
  const riskAtr = plan.riskAtr && plan.riskAtr > 0 ? plan.riskPts / plan.riskAtr : null;
  const restRefusal =
    read.tier === "gone"
      ? "price has walked off the array"
      : book.word === "STAND"
        ? `the sequence says STAND — ${book.missing}`
        : !PATH_BANDS.has(String(book.pathBand ?? ""))
          ? `grade ${book.pathBand ?? "—"} is not a PATH band (A+/A/A−)`
          : plan.riskOverCap
            ? "stop is wider than this symbol's cap"
            : plan.riskTooTight
              ? `stop is ${riskAtr != null ? riskAtr.toFixed(2) : "<0.5"}×ATR, inside the 0.5×ATR floor`
              : plan.riskTooWide
                ? `stop is ${riskAtr != null ? riskAtr.toFixed(2) : ">1.5"}×ATR, beyond the 1.5×ATR band`
                : null;

  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`rounded-[var(--radius-sm)] border px-2 py-0.5 text-[10px] font-bold tracking-wide ${style.cls}`}>
          {style.label}
        </span>
        <span className="text-[11px] text-[var(--color-fg)]">{read.action}</span>
        {read.awayAtr != null && (
          <span className="tabular text-[10px] text-[var(--color-subtle)]">
            {read.inZone ? "in zone" : `${read.awayAtr.toFixed(2)} ATR`}
          </span>
        )}
      </div>

      <p className="text-[10px] leading-snug text-[var(--color-muted)]">{read.detail}</p>

      {pending ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_45%,transparent)] bg-[color-mix(in_oklab,var(--color-primary)_8%,transparent)] px-3 py-2">
          <div className="flex items-center gap-2">
            <Timer className="h-3.5 w-3.5 text-[var(--color-primary)]" aria-hidden />
            <span className="tabular text-[11px] text-[var(--color-fg)]">
              Limit resting at <b>{pending.limit.toFixed(2)}</b> · stop {pending.stop.toFixed(2)}
              {pending.t1 != null ? ` · T1 ${pending.t1.toFixed(2)}` : ""}
            </span>
            <span className="tabular text-[10px] text-[var(--color-muted)]">
              {pendingLeftMin(pending, now)} min left · fills on the touch, not the print
            </span>
          </div>
          <button
            type="button"
            onClick={() => cancelPending(pending.id)}
            className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={restRefusal != null}
            title={restRefusal ? `Not rested: ${restRefusal}` : undefined}
            onClick={() =>
              restLimit(plan, {
                grade: book.pathBand ?? "—",
                strategy: desk.scan.candidates.find((c) => c.symbol === book.symbol && c.side === book.side)?.completeStrategy ?? "sequence",
                now,
              })
            }
            className="rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-primary)_55%,transparent)] px-2.5 py-1 text-[11px] font-medium text-[var(--color-primary)] hover:bg-[color-mix(in_oklab,var(--color-primary)_12%,transparent)] disabled:opacity-40"
          >
            Rest the limit at {plan.entry.toFixed(2)}
          </button>
          <span className="text-[10px] text-[var(--color-subtle)]">
            {restRefusal
              ? `Not restable — ${restRefusal}.`
              : "Decide now, fill on the touch — the plan already named this price, and a resting order cannot be talked into a worse one."}
          </span>
        </div>
      )}

      <p className="tabular text-[10px] leading-snug text-[var(--color-warn)]">{loss.line}</p>
      {runner && <p className="text-[10px] leading-snug text-[var(--color-subtle)]">{runner.line}</p>}
    </section>
  );
}

/** Rendered by the shell when a pending order fills, so the fill is visible. */
export function pendingFillToast(o: PendingOrder): string {
  return `Limit filled — ${o.symbol} ${o.side} at ${o.limit.toFixed(2)} (stop ${o.stop.toFixed(2)}${o.t1 != null ? `, T1 ${o.t1.toFixed(2)}` : ""}). Booked to paper at the resting price.`;
}
