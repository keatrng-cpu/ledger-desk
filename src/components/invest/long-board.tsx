/**
 * The long board. Sleeve chips filter the list. A card shows the state,
 * the price, and the one reason. The rest sits one click down so the
 * lines cannot run into each other. Nothing here places an order.
 */

import { useMemo, useState } from "react";
import { gradeBoard, LEFT_OFF, SLEEVE_CAP, SLEEVE_ORDER, sleeveLoad, type LongCard, type LongSleeve, type LongState } from "@/lib/invest/long-board";
import type { InvestMarks } from "@/lib/invest/marks";
import { Card } from "./ui";

const SLEEVE_LABEL: Record<LongSleeve, string> = {
  safety: "Safety",
  power: "Power",
  grid: "Grid",
  fuel: "Fuel",
  compute: "Compute",
  building: "Buildings",
  space: "Space",
  health: "Health",
};

function stateClass(state: LongState): string {
  if (state === "fail") return "border-[var(--color-warn)] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]";
  if (state === "pass") return "border-[var(--color-fg)] bg-[var(--color-surface-1)] text-[var(--color-fg)]";
  return "border-dashed border-[var(--color-border)] text-[var(--color-muted)]";
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">{label}</p>
      <p className="truncate text-[11px] text-[var(--color-fg)]" title={value}>{value}</p>
    </div>
  );
}

export function LongBoard({
  marks,
  weights,
  onRefresh,
  refreshing,
}: {
  marks: InvestMarks | null;
  weights: { ticker: string; weight: number }[];
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  const cards = useMemo(() => gradeBoard({ marks: marks?.marks }), [marks]);
  const [sleeve, setSleeve] = useState<LongSleeve | "all">("all");
  const [state, setState] = useState<LongState | "all">("all");
  const load = sleeveLoad(weights);
  const shown = cards.filter((c) => (sleeve === "all" || c.name.sleeve === sleeve) && (state === "all" || c.state === state));
  const counts = {
    pass: cards.filter((c) => c.state === "pass").length,
    wait: cards.filter((c) => c.state === "wait").length,
    fail: cards.filter((c) => c.state === "fail").length,
  };
  const quoteAt = marks?.fetchedAt
    ? new Date(marks.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })
    : null;

  return (
    <Card
      title="Names"
      right={
        <span className="flex items-center gap-2 font-mono text-[10px] text-[var(--color-muted)]">
          {quoteAt ? `quotes ${quoteAt} ET` : "no quote yet"}
          {onRefresh && (
            <button type="button" onClick={onRefresh} className="rounded border border-[var(--color-border)] px-1.5 py-0.5 normal-case">
              {refreshing ? "…" : "Refresh"}
            </button>
          )}
        </span>
      }
    >
      <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
        The 25 names. The dollars are in the split above. Pass still does not buy.
      </p>
      <div className="mb-2 flex flex-wrap gap-1">
        {(["all", "pass", "wait", "fail"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setState(s)}
            className={`rounded-full border px-2 py-0.5 text-[10px] uppercase ${state === s ? "border-[var(--color-fg)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
          >
            {s === "all" ? `All ${cards.length}` : `${s} ${counts[s]}`}
          </button>
        ))}
      </div>
      <div className="mb-3 flex flex-wrap gap-1">
        <button
          type="button"
          onClick={() => setSleeve("all")}
          className={`rounded-full border px-2 py-0.5 text-[10px] ${sleeve === "all" ? "border-[var(--color-fg)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
        >
          Every sleeve
        </button>
        {SLEEVE_ORDER.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setSleeve(s)}
            className={`rounded-full border px-2 py-0.5 text-[10px] ${sleeve === s ? "border-[var(--color-fg)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
          >
            {SLEEVE_LABEL[s]} {cards.filter((c) => c.name.sleeve === s).length}
          </button>
        ))}
      </div>
      {load.some((s) => s.over) && (
        <p className="mb-2 text-[11px] text-[var(--color-warn)]">
          {load.filter((s) => s.over).map((s) => `${SLEEVE_LABEL[s.sleeve]} is ${Math.round(s.weight * 100)}%`).join(" · ")}. A sleeve over {Math.round(SLEEVE_CAP * 100)}% is one bet.
        </p>
      )}
      <div className="grid gap-2 lg:grid-cols-2">
        {shown.map((c) => (
          <article key={c.name.ticker} className="min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate text-[13px] font-semibold text-[var(--color-fg)]">
                  {c.name.ticker} <span className="font-normal text-[var(--color-muted)]">{c.name.name}</span>
                </p>
                <p className="text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">{SLEEVE_LABEL[c.name.sleeve]} · {c.name.book}</p>
              </div>
              <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${stateClass(c.state)}`}>{c.state}</span>
            </div>
            <p className="mt-1 text-[12px] leading-snug text-[var(--color-fg)]">{c.reason}</p>
            <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
              <Fact label="Quote" value={c.price} />
              <Fact label="Implied" value={c.implied} />
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[10px] text-[var(--color-muted)]">Role, kill, source</summary>
              <div className="mt-1 space-y-1 text-[11px] leading-snug text-[var(--color-muted)]">
                <p>{c.name.role}</p>
                <p>{c.name.evidence}</p>
                <p>Kill · {c.name.kill}</p>
                <p>Against · {c.name.competitor}</p>
                <p>{c.drawdown} · {c.trend}</p>
                <p>{c.quality} · {c.capex} · {c.dilution}</p>
                <p>{c.overlap} · {c.shares}</p>
                <p>{c.fresh}</p>
                <p>{c.source}</p>
              </div>
            </details>
          </article>
        ))}
      </div>
      {shown.length === 0 && <p className="text-[11px] text-[var(--color-muted)]">Nothing in this filter.</p>}
      <details className="mt-3 border-t border-[var(--color-border)] pt-2">
        <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-[var(--color-muted)]">Researched, not featured</summary>
        <div className="mt-1 space-y-1">
          {LEFT_OFF.map((r) => (
            <p key={r.area} className="text-[11px] leading-snug text-[var(--color-muted)]"><span className="text-[var(--color-fg)]">{r.area}.</span> {r.why}</p>
          ))}
        </div>
      </details>
    </Card>
  );
}
