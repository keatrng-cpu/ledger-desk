/**
 * The hand-logged real trades, finally read back.
 *
 * Two numbers that must never be mixed, kept in two boxes:
 *
 *   DISCIPLINE measures the TRADER. Did the click follow the plan it was
 *   supposed to follow? A profitable violation is flagged hardest, because a
 *   rule break that loses money corrects itself and one that pays teaches the
 *   wrong lesson at the moment nobody wants to hear it.
 *
 *   SHAPES measures the SETUPS, and `recallShapes` excludes every
 *   non-compliant record from it. A losing run caused by skipping the stop is
 *   not evidence against the setup, and letting it count would retire a model
 *   for the trader's mistake.
 *
 * Below MIN_N_FOR_LESSON (8) this panel says so rather than printing a win
 * rate. n=1 is not a statistic, and a number that only appears once it is
 * flattering is not one either.
 */

import { useMemo } from "react";
import { readTradeLog } from "@/lib/trading/trade-log";
import { MIN_N_FOR_LESSON } from "@/lib/trading/setup-memory";

export function TradeLogPanel() {
  const read = useMemo(() => readTradeLog(), []);
  const { discipline, shapes, records, skipped } = read;

  if (!records.length) {
    return (
      <p className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-3 text-[11px] leading-snug text-[var(--color-subtle)]">
        No hand-logged trades yet. Log one with{" "}
        <code className="font-mono text-[var(--color-fg)]">npm run log</code> and
        this reads it back — the file has been written since the sleeve went live
        and read by nothing until now.
      </p>
    );
  }

  const dangerous = discipline.broke > 0 && discipline.brokeExpR > 0;

  return (
    <div className="flex flex-col gap-2">
      {/* ── The trader's own record ─────────────────────────────────────── */}
      <div
        className={
          dangerous
            ? "rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-warn)_60%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)] px-3 py-2"
            : "rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2"
        }
      >
        <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
          Discipline · measures you, not the setup
        </p>
        <p
          className={
            dangerous
              ? "mt-1 text-[11px] font-medium leading-snug text-[var(--color-warn)]"
              : "mt-1 text-[11px] leading-snug text-[var(--color-fg)]"
          }
        >
          {discipline.line}
        </p>
        {Object.keys(discipline.violations).length > 0 && (
          <ul className="mt-1.5 flex flex-wrap gap-1">
            {Object.entries(discipline.violations)
              .sort((a, b) => b[1] - a[1])
              .map(([v, n]) => (
                <li
                  key={v}
                  className="rounded-full border border-[var(--color-border)] px-1.5 py-[1px] font-mono text-[9px] text-[var(--color-subtle)]"
                >
                  {v} ×{n}
                </li>
              ))}
          </ul>
        )}
      </div>

      {/* ── The setups, compliant records only ──────────────────────────── */}
      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
        <p className="text-[9px] uppercase tracking-wider text-[var(--color-subtle)]">
          Setups · non-compliant records excluded
        </p>
        {shapes.length === 0 ? (
          <p className="mt-1 text-[11px] leading-snug text-[var(--color-subtle)]">
            Nothing measurable yet. Every logged trade so far broke a rule, so
            none of them say anything about a setup —{" "}
            <span className="text-[var(--color-fg)]">
              they measure the click, not the edge.
            </span>{" "}
            {MIN_N_FOR_LESSON} compliant closed trades of one shape before a
            lesson is printed.
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1">
            {shapes.map((s) => (
              <li key={s.fingerprint} className="text-[11px] leading-snug">
                <span className="font-mono text-[var(--color-fg)]">{s.shape}</span>
                <span className="text-[var(--color-subtle)]">
                  {" "}
                  n={s.n}
                  {s.n >= MIN_N_FOR_LESSON
                    ? ` · WR ${Math.round(s.wr * 100)}% · ${s.expR >= 0 ? "+" : ""}${s.expR.toFixed(2)}R`
                    : ` · below the ${MIN_N_FOR_LESSON}-trade floor, no read`}
                </span>
                {s.lesson && (
                  <p className="mt-0.5 text-[10px] leading-snug text-[var(--color-fg)]">
                    {s.lesson}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="text-[9px] leading-snug text-[var(--color-subtle)]">
        {records.length} logged trade{records.length === 1 ? "" : "s"}
        {skipped > 0 && (
          <>
            {" · "}
            <span className="text-[var(--color-warn)]">
              {skipped} unusable (no entry/stop recorded — they cannot be
              attributed, so they are left out rather than half-counted)
            </span>
          </>
        )}
        . Statistically weak below ~100 trades; treat every figure here as a
        direction, not a rate.
      </p>
    </div>
  );
}
