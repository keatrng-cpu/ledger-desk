/**
 * Book › Discipline — the real fills, priced by the rule each one kept or
 * broke.
 *
 * Reads the live rows `recordRealFill` writes (desk word, override, mistakes,
 * pre-click state) and prints the split the research ranks highest for
 * execution: rule-following trades against rule-breaking trades, each with
 * its own money, then the costliest habit by name. No score, no streak, no
 * badge — those raise trading volume, not results.
 *
 * Signed-out or DB-less desks show why there is nothing to read rather than
 * a blank card.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { getBookCounters, listTrades, type BookCountersView, type JournalTrade } from "@/lib/journal/server";
import { disciplineScorecard, MIN_READ, type Split } from "@/lib/journal/discipline";
import { cn } from "@/lib/utils";

const money = (x: number) => `${x >= 0 ? "+" : "−"}$${Math.abs(Math.round(x)).toLocaleString()}`;

function SplitCell({ label, s, tone }: { label: string; s: Split; tone: "up" | "down" | "muted" }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">{label}</p>
      <p
        className={cn(
          "font-mono text-sm font-semibold",
          tone === "up" && "text-[var(--color-up)]",
          tone === "down" && "text-[var(--color-down)]",
          tone === "muted" && "text-[var(--color-fg)]",
        )}
      >
        {s.n ? money(s.pnl) : "—"}
      </p>
      <p className="font-mono text-[10px] text-[var(--color-subtle)]">
        n={s.n}
        {s.avgR != null ? ` · ${s.avgR >= 0 ? "+" : ""}${s.avgR.toFixed(2)}R/t` : ""}
        {s.winRate != null ? ` · WR ${(s.winRate * 100).toFixed(0)}%` : ""}
      </p>
    </div>
  );
}

export function DisciplinePanel() {
  const [rows, setRows] = useState<JournalTrade[] | null>(null);
  const [counters, setCounters] = useState<BookCountersView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [trades, c] = await Promise.all([
        listTrades({ data: { mode: "live" } }),
        getBookCounters({ data: { mode: "live" } }).catch(() => null),
      ]);
      setRows(trades);
      setCounters(c);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read the live journal");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const card = useMemo(
    () =>
      disciplineScorecard(
        (rows ?? []).map((t) => ({
          status: t.status,
          pnl: t.pnl,
          r: t.r,
          mistakes: t.mistakes,
          override: t.override,
          deskWord: t.deskWord,
          stateRating: t.stateRating,
        })),
      ),
    [rows],
  );

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <header className="mb-2 flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-[var(--color-fg)]">Discipline · real fills</h3>
          <p className="text-[10px] text-[var(--color-subtle)]">
            Rules kept vs rules broken, in money. Log every real fill from a card&apos;s <b>Log live fill</b> —
            especially the ones against the desk.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] p-1 text-[var(--color-subtle)] hover:text-[var(--color-fg)]"
          aria-label="Refresh discipline"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </header>

      {error ? (
        <p className="text-[11px] text-[var(--color-muted)]">
          {/Unauthorized/i.test(error)
            ? "Sign in to read the live journal — real fills live in the database, not this browser."
            : error}
        </p>
      ) : (
        <>
          {counters && (
            <p className="mb-2 font-mono text-[10.5px] text-[var(--color-muted)]">
              PATH {counters.pathThisMonth}/{counters.pathCap} this month
              {counters.pathThisMonth >= counters.pathCap ? " — cap hit, A+ only" : ""} · A+ unlock{" "}
              {counters.aPlusUnlocked
                ? "EARNED (3%)"
                : `${counters.aPlusTaken}/20 at WR ${counters.aPlusTaken ? Math.round((counters.aPlusWins / counters.aPlusTaken) * 100) : 0}% (needs ≥65%) — A+ sizes at the 2% probe`}{" "}
              · loss streak {counters.consecLosses}
              {counters.bookTakenToday ? ` · today's book ${counters.bookTakenToday}` : ""}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <SplitCell label="Rules followed" s={card.followed} tone="up" />
            <SplitCell label="Rules broken" s={card.broken} tone="down" />
            <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">Adherence</p>
              <p className="font-mono text-sm font-semibold text-[var(--color-fg)]">
                {card.adherence != null ? `${Math.round(card.adherence * 100)}%` : "—"}
              </p>
              <p className="font-mono text-[10px] text-[var(--color-subtle)]">
                {card.closed} closed{card.closed < MIN_READ ? " · a direction, not a rate" : ""}
              </p>
            </div>
          </div>

          <div className="mt-2 space-y-1">
            {card.lines.map((l) => (
              <p key={l} className="text-[11px] leading-snug text-[var(--color-fg)]">
                {l}
              </p>
            ))}
          </div>

          {card.byMistake.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">By mistake</p>
              <ul className="mt-1 space-y-0.5">
                {card.byMistake.map((m) => (
                  <li key={m.id} className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                    <span className="text-[var(--color-fg)]" title={m.rule}>
                      {m.label} ×{m.n}
                    </span>
                    <span className={m.pnl < 0 ? "text-[var(--color-down)]" : "text-[var(--color-up)]"}>
                      {money(m.pnl)}
                      {m.avgR != null ? ` · ${m.avgR >= 0 ? "+" : ""}${m.avgR.toFixed(2)}R` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {card.byWord.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] uppercase tracking-wider text-[var(--color-subtle)]">
                By what the desk said at the click
              </p>
              <ul className="mt-1 space-y-0.5">
                {card.byWord.map((w) => (
                  <li key={w.word} className="flex items-baseline justify-between gap-2 font-mono text-[11px]">
                    <span className="text-[var(--color-fg)]">
                      {w.word} ×{w.n}
                    </span>
                    <span className={w.pnl < 0 ? "text-[var(--color-down)]" : "text-[var(--color-up)]"}>
                      {money(w.pnl)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
