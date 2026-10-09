/**
 * Now, as four facts per book, then the option underneath.
 *
 * The Now tab is the FUTURES card the option expresses, so it says the same
 * four things the ticket says — direction, counter-bias, entry, target — for
 * MNQ and for ES, read from the one reader (`ticket-facts.ts`) so this board
 * and the ticket above it cannot print different entry prices for the same
 * tape. The option is one line at the bottom, because on this tab it is the
 * consequence and not the question.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { evaluateOptionsDesk } from "@/lib/trading/options-desk";
import { loadRhSleeve } from "@/lib/trading/options-sleeve";
import { bothFacts, type CounterRead, type FourFacts } from "@/lib/trading/ticket-facts";

function wordClass(word: FourFacts["word"]): string {
  if (word === "TAKE") return "text-[var(--color-up)]";
  if (word === "STAND") return "text-[var(--color-down)]";
  return "text-[var(--color-warn)]";
}

function counterClass(read: CounterRead): string {
  if (read === "agrees") return "text-[var(--color-up)]";
  if (read === "disrespected") return "text-[var(--color-warn)]";
  return "text-[var(--color-muted)]";
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-1.5 text-[11px] leading-snug">
      <span className="w-[5.25rem] shrink-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
        {label}
      </span>
      <span className={cn("min-w-0 flex-1", tone ?? "text-[var(--color-fg)]")}>{value}</span>
    </p>
  );
}

function BookFacts({ f }: { f: FourFacts }) {
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
      <header className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="font-mono text-[12px] font-semibold text-[var(--color-fg)]">
          {f.symbol} <span className="text-[var(--color-muted)]">{f.side ?? "flat"}</span>
        </p>
        <span className={cn("font-mono text-[11px] font-bold", wordClass(f.word))}>{f.word}</span>
      </header>
      <div className="space-y-0.5">
        <Fact
          label="Direction"
          value={f.direction.text}
          tone={f.four[0]!.ok ? "text-[var(--color-fg)]" : "text-[var(--color-warn)]"}
        />
        <Fact
          label="Counter"
          value={`HTF ${f.counter.htf} · mid ${f.counter.mid} · ${f.counter.half}`}
          tone={counterClass(f.counter.htf)}
        />
        <Fact
          label="Entry"
          value={f.entry.text}
          tone={
            f.entry.inside
              ? "text-[var(--color-up)]"
              : f.entry.chase || f.entry.px == null
                ? "text-[var(--color-down)]"
                : "text-[var(--color-muted)]"
          }
        />
        <Fact
          label="Target"
          value={f.target.text}
          tone={f.target.pays ? "text-[var(--color-up)]" : f.target.px == null ? "text-[var(--color-muted)]" : "text-[var(--color-down)]"}
        />
      </div>
    </article>
  );
}

export function FourFactsBoard({ desk }: { desk: DeskPayload }) {
  const facts = useMemo(() => bothFacts(desk), [desk]);
  const book = useMemo(() => evaluateOptionsDesk(desk, loadRhSleeve()), [desk]);
  const t = book.best?.ticket ?? null;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
        The four facts · both books
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {facts.map((f) => (
          <BookFacts key={`${f.leg}-${f.symbol}`} f={f} />
        ))}
      </div>
      <p className="mt-2 border-t border-[var(--color-border)] pt-2 font-mono text-[11px] text-[var(--color-muted)]">
        <span className="mr-1.5 not-italic text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">
          The option
        </span>
        {t
          ? `${t.contracts} ${t.underlier} ${t.side.toUpperCase()} · $${Math.round(t.estDebitTotal)} ${t.pricedFrom === "live_chain" ? "live ask" : "model, not a contract"} · ${book.best?.verdict ?? "STAND"}`
          : book.focus}
      </p>
    </section>
  );
}

/**
 * The three marks the Charts tab draws, and nothing above them.
 *
 * A trader marks the raid wick, the array and the draw. Everything else the
 * tape knows — every pool, every structure break, the dealing box — is real
 * and is BELOW these three, not in front of them. Same reader as the ticket,
 * so a price named here is the price the order rests at.
 */
export function ChartMarks({ desk }: { desk: DeskPayload }) {
  const facts = useMemo(() => bothFacts(desk), [desk]);
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
        The three marks · the raid wick, the array, the draw
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {facts.map((f) => (
          <article
            key={`marks-${f.leg}`}
            className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2"
          >
            <p className="mb-1 font-mono text-[12px] font-semibold text-[var(--color-fg)]">
              {f.symbol} <span className="text-[var(--color-muted)]">{f.side ?? "flat"}</span>
            </p>
            <Fact
              label="Raid wick"
              value={
                f.direction.wick != null
                  ? `${f.direction.wick.toFixed(2)} — the ${f.direction.raidSide} wick${f.direction.pool ? ` through ${f.direction.pool}` : ""}. The stop sits beyond it.`
                  : "No raid wick to mark."
              }
              tone={f.direction.wick != null ? "text-[var(--color-fg)]" : "text-[var(--color-muted)]"}
            />
            <Fact
              label="Array"
              value={
                f.entry.zone
                  ? `${f.entry.zone.bottom.toFixed(2)}–${f.entry.zone.top.toFixed(2)}, limit at ${(f.entry.px ?? 0).toFixed(2)}.`
                  : "not at the array"
              }
              tone={f.entry.zone ? "text-[var(--color-fg)]" : "text-[var(--color-muted)]"}
            />
            <Fact
              label="Draw"
              value={
                f.target.px != null
                  ? `${f.target.pool ?? "next pool"} ${f.target.px.toFixed(2)}${f.target.r != null ? ` · ${f.target.r.toFixed(2)}R` : ""}`
                  : "No unswept pool in front."
              }
              tone={f.target.pays ? "text-[var(--color-up)]" : "text-[var(--color-muted)]"}
            />
          </article>
        ))}
      </div>
    </section>
  );
}
