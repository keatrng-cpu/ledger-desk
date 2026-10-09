/**
 * The brain's headline: the word, the one missing layer, and which of the four
 * conditions is red.
 *
 * It used to be nine green-and-red rows, which is a diagnostic and not a
 * headline — a trader reading it has to work out which row matters before the
 * tab has told them anything. The grader is unchanged (`smc-master.ts`
 * gradeBook names the first must-layer that is not passing); this prints that
 * name, then the LESSON for that layer in one sentence
 * (`src/lib/learn/live-lesson.ts`), then the four conditions.
 *
 * The notes — the half, the kill zone, the middle frame, Judas and news — are
 * the layers the grader marked as notes rather than musts (bcd0e928). They are
 * real and they are under the disclosure, not in front of the word.
 *
 * Nothing here gates. The lesson only speaks.
 */

import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { lessonForLayer, readLiveLessons } from "@/lib/learn/live-lesson";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { fourFacts } from "@/lib/trading/ticket-facts";

export function BrainWord({ desk }: { desk: DeskPayload }) {
  const leg: "left" | "right" =
    desk.smcMaster.oneBook?.symbol === desk.right.symbol ? "right" : "left";
  const facts = useMemo(() => fourFacts(desk, leg), [desk, leg]);
  const lessons = useMemo(() => readLiveLessons(desk, { leg }), [desk, leg]);
  const book = leg === "left" ? desk.smcMaster.left : desk.smcMaster.right;

  const lesson = lessonForLayer(lessons, book.missing);
  const red = facts.four.find((c) => !c.ok) ?? null;
  // Notes, not musts: the grader demoted these and the headline must not read
  // like they stand the trade down.
  const notes = book.layers.filter((l) => !l.must);

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <header className="flex flex-wrap items-baseline gap-2">
        <span
          className={cn(
            "rounded-[var(--radius-md)] px-2.5 py-1 font-mono text-base font-bold",
            facts.word === "TAKE"
              ? "bg-[color-mix(in_oklab,var(--color-up)_16%,transparent)] text-[var(--color-up)]"
              : facts.word === "STAND"
                ? "bg-[color-mix(in_oklab,var(--color-down)_16%,transparent)] text-[var(--color-down)]"
                : "bg-[color-mix(in_oklab,var(--color-warn)_16%,transparent)] text-[var(--color-warn)]",
          )}
        >
          {facts.word}
        </span>
        <p className="font-mono text-[12px] text-[var(--color-fg)]">
          {facts.symbol} {facts.side ?? "flat"}
          <span className="ml-2 text-[var(--color-muted)]">
            {book.mustPass}/{book.mustNeed} musts
          </span>
        </p>
      </header>

      <p className="mt-2 text-[12px] leading-snug text-[var(--color-fg)]">
        <span className="font-semibold">{facts.missing}</span>
        {facts.missing === "Sequence complete" ? "" : " — "}
        <span className="text-[var(--color-muted)]">{facts.missingDetail}</span>
      </p>

      {lesson && (
        <p className="mt-1.5 rounded-[var(--radius-md)] border-l-2 border-[var(--color-primary)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-[12px] leading-snug text-[var(--color-fg)]">
          {lesson.say}
          <span className="ml-1 text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">
            {lesson.title}
          </span>
        </p>
      )}

      <p className="mt-2 text-[11px] leading-snug">
        <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Red condition
        </span>
        {red ? (
          <span className="text-[var(--color-down)]">
            {red.label} — {red.detail}
          </span>
        ) : (
          <span className="text-[var(--color-up)]">
            All four are true: the raid named the side, the 1–5m close confirmed it, price is in the
            array, and the target pays.
          </span>
        )}
      </p>

      <details className="group mt-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
        <summary className="cursor-pointer list-none px-2.5 py-1.5 text-[11px] text-[var(--color-muted)] [&::-webkit-details-marker]:hidden">
          Notes — the half, the kill zone, the middle frame, Judas and news ({notes.length})
          <span className="ml-1 text-[10px] uppercase tracking-wide text-[var(--color-subtle)] group-open:hidden">
            show
          </span>
        </summary>
        <ul className="space-y-1 border-t border-[var(--color-border)] px-2.5 py-2">
          {notes.map((l) => (
            <li key={l.id} className="text-[11px] leading-snug">
              <span
                className={cn(
                  "mr-1 font-mono",
                  l.state === "pass"
                    ? "text-[var(--color-up)]"
                    : l.state === "fail"
                      ? "text-[var(--color-down)]"
                      : "text-[var(--color-warn)]",
                )}
              >
                {l.state === "pass" ? "●" : l.state === "fail" ? "×" : "○"} {l.label}
              </span>
              <span className="text-[var(--color-muted)]">{l.detail}</span>
            </li>
          ))}
          {notes.length === 0 && (
            <li className="text-[11px] text-[var(--color-muted)]">No notes on this book.</li>
          )}
        </ul>
      </details>
    </section>
  );
}
