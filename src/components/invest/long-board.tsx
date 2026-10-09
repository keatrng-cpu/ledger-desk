/**
 * The long board. Grouped by sleeve so a power name cannot sit on top of
 * the safety net. Quiet on purpose: pass, wait, and fail are words, not a
 * green button. Nothing here places an order.
 */

import { gradeBoard, LEFT_OFF, SLEEVE_CAP, SLEEVE_ORDER, sleeveLoad, type LongCard, type LongSleeve } from "@/lib/invest/long-board";
import type { InvestMarks } from "@/lib/invest/marks";
import { Card } from "./ui";

const SLEEVE_LABEL: Record<LongSleeve, string> = {
  safety: "Safety net",
  power: "Power — operators",
  grid: "Grid and the room",
  fuel: "Fuel and the pipe",
  compute: "Compute — under the sleeve cap",
  building: "The building",
  space: "Space — watch",
  health: "Health",
};

function tone(state: LongCard["state"]): string {
  if (state === "fail") return "text-[var(--color-warn)]";
  if (state === "wait") return "text-[var(--color-muted)]";
  return "text-[var(--color-fg)]";
}

export function LongBoard({ marks, weights }: { marks: InvestMarks | null; weights: { ticker: string; weight: number }[] }) {
  const cards = gradeBoard({ marks: marks?.marks });
  const load = sleeveLoad(weights);
  const groups = SLEEVE_ORDER.map((s) => ({ sleeve: s, cards: cards.filter((c) => c.name.sleeve === s) })).filter((g) => g.cards.length);
  const quoteAt = marks?.fetchedAt ? new Date(marks.fetchedAt).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : null;

  return (
    <Card title="Long board" right={<span className="font-mono text-[10px] text-[var(--color-muted)]">{quoteAt ? `quotes ${quoteAt} ET` : "quotes —"} · ranks, does not buy</span>}>
      <p className="mb-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
        Safety net first, then the chain that feeds a data center: power, the grid, fuel, compute, the building, listed space, and health. A card is pass, wait, or fail. Pass still does not buy. The add gate is the dossier.
      </p>
      {load.some((s) => s.over) && (
        <p className="mb-2 text-[11px] text-[var(--color-warn)]">
          {load.filter((s) => s.over).map((s) => `${SLEEVE_LABEL[s.sleeve]} is ${Math.round(s.weight * 100)}% of the book`).join(". ")}. A sleeve over {Math.round(SLEEVE_CAP * 100)}% is one bet.
        </p>
      )}
      <div className="space-y-3">
        {groups.map((g) => (
          <section key={g.sleeve}>
            <h4 className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">{SLEEVE_LABEL[g.sleeve]}</h4>
            <div className="grid gap-2 md:grid-cols-2">
              {g.cards.map((c) => (
                <article key={c.name.ticker} className="min-w-0 rounded-md border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="truncate text-[12px] font-semibold text-[var(--color-fg)]">
                      {c.name.ticker} <span className="font-normal text-[var(--color-muted)]">{c.name.name}</span>
                    </p>
                    <span className={`shrink-0 font-mono text-[10px] uppercase ${tone(c.state)}`}>{c.state}</span>
                  </div>
                  <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-fg)]">{c.name.role}</p>
                  <p className="text-[11px] leading-snug text-[var(--color-muted)]">{c.reason}</p>
                  <p className="mt-1 text-[10px] leading-snug text-[var(--color-muted)]">{c.name.evidence}</p>
                  <p className="text-[10px] leading-snug text-[var(--color-muted)]">Kill · {c.name.kill}</p>
                  <p className="text-[10px] leading-snug text-[var(--color-muted)]">Against · {c.name.competitor}</p>
                  <p className="mt-1 font-mono text-[10px] leading-snug text-[var(--color-subtle)]">
                    {c.price} · {c.drawdown} · {c.trend}
                  </p>
                  <p className="font-mono text-[10px] leading-snug text-[var(--color-subtle)]">
                    {c.implied} · {c.quality} · {c.capex} · {c.dilution}
                  </p>
                  <p className="font-mono text-[10px] leading-snug text-[var(--color-subtle)]">{c.overlap} · {c.shares}</p>
                  <p className="font-mono text-[10px] leading-snug text-[var(--color-subtle)]">{c.fresh} · {c.source}</p>
                </article>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="mt-3 border-t border-[var(--color-border)] pt-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">Researched, not featured</p>
        {LEFT_OFF.map((r) => (
          <p key={r.area} className="text-[10px] leading-snug text-[var(--color-muted)]">{r.area} — {r.why}</p>
        ))}
      </div>
    </Card>
  );
}
