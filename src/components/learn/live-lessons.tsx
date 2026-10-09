/**
 * The nine lessons, with the live tape beside each one.
 *
 * This replaces the generic prose the Learn tab opened with. Each card is the
 * OBJECT, the PASS, and the tape that is NOT it — and then what the desk reads
 * right now, from the detector named at the bottom of the card. If a lesson
 * and its detector disagree, the detector wins and the lesson is the bug; the
 * file and function are printed so that is checkable rather than asserted.
 *
 * A checked box is the trader's progress. It is stored in this browser, it is
 * not a gate, and nothing in the ticket path reads it.
 */

import { useCallback, useState } from "react";
import { cn } from "@/lib/utils";
import { readLiveLessons, type LessonState, type LiveLesson } from "@/lib/learn/live-lesson";
import type { DeskPayload } from "@/lib/trading/build-desk";

const DONE_KEY = "ledger.learn.lessons";

function readDone(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(DONE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function stateChip(state: LessonState): { text: string; cls: string } {
  if (state === "pass")
    return {
      text: "PASS",
      cls: "border-[color-mix(in_oklab,var(--color-up)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-up)_12%,transparent)] text-[var(--color-up)]",
    };
  if (state === "fail")
    return {
      text: "FAIL",
      cls: "border-[color-mix(in_oklab,var(--color-down)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-down)_12%,transparent)] text-[var(--color-down)]",
    };
  return {
    text: "WAIT",
    cls: "border-[color-mix(in_oklab,var(--color-warn)_50%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warn)_12%,transparent)] text-[var(--color-warn)]",
  };
}

function LessonCard({
  lesson,
  n,
  done,
  onToggle,
}: {
  lesson: LiveLesson;
  n: number;
  done: boolean;
  onToggle: () => void;
}) {
  const chip = stateChip(lesson.state);
  return (
    <article className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <header className="mb-1.5 flex flex-wrap items-start justify-between gap-2">
        <h3 className="flex min-w-0 items-baseline gap-2 text-[13px] font-semibold text-[var(--color-fg)]">
          <span className="font-mono text-[10px] text-[var(--color-subtle)]">{n}</span>
          {lesson.title}
        </h3>
        <div className="flex shrink-0 items-center gap-1.5">
          <span className={cn("rounded-full border px-2 py-0.5 font-mono text-[10px] font-bold", chip.cls)}>
            {chip.text}
          </span>
          <button
            type="button"
            onClick={onToggle}
            aria-pressed={done}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              done
                ? "border-[color-mix(in_oklab,var(--color-up)_50%,transparent)] text-[var(--color-up)]"
                : "border-[var(--color-border)] text-[var(--color-muted)] hover:text-[var(--color-fg)]",
            )}
          >
            {done ? "✓ Learned" : "Mark learned"}
          </button>
        </div>
      </header>

      <dl className="grid gap-x-3 gap-y-1 sm:grid-cols-[4.25rem_minmax(0,1fr)]">
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">Object</dt>
        <dd className="text-[12px] leading-snug text-[var(--color-fg)]">{lesson.object}</dd>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">Pass</dt>
        <dd className="text-[12px] leading-snug text-[var(--color-fg)]">{lesson.pass}</dd>
        <dt className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-down)]">Not it</dt>
        <dd className="text-[12px] leading-snug text-[var(--color-muted)]">{lesson.notIt}</dd>
      </dl>

      <p
        className={cn(
          "mt-2 rounded-[var(--radius-sm)] border-l-2 px-2.5 py-1.5 text-[12px] leading-snug",
          lesson.state === "pass"
            ? "border-[var(--color-up)] text-[var(--color-fg)]"
            : lesson.state === "fail"
              ? "border-[var(--color-down)] text-[var(--color-fg)]"
              : "border-[var(--color-warn)] text-[var(--color-fg)]",
        )}
      >
        <span className="mr-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Live
        </span>
        {lesson.live}
      </p>

      <p className="mt-1.5 font-mono text-[10px] text-[var(--color-subtle)]">
        {lesson.owner.file} · {lesson.owner.fn}
        {lesson.layers.length ? ` · layer ${lesson.layers.join(", ")}` : ""}
      </p>
    </article>
  );
}

export function LiveLessonBoard({ desk }: { desk: DeskPayload }) {
  const [done, setDone] = useState<Set<string>>(() => readDone());
  const toggle = useCallback((id: string) => {
    setDone((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        window.localStorage.setItem(DONE_KEY, JSON.stringify([...next]));
      } catch {
        /* storage unavailable — the check still shows for this visit */
      }
      return next;
    });
  }, []);

  const lessons = readLiveLessons(desk);
  const passing = lessons.filter((l) => l.state === "pass").length;
  const failing = lessons.filter((l) => l.state === "fail").length;

  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <header className="mb-2">
        <h2 className="text-sm font-semibold tracking-tight text-[var(--color-fg)]">
          The nine lessons, graded on this tape
        </h2>
        <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-muted)]">
          {passing} passing · {failing} failing · {lessons.length - passing - failing} waiting ·{" "}
          {done.size}/{lessons.length} marked learned. A checked box is your progress — nothing in
          the ticket path reads it, and the Learn tab never vetoes a trade.
        </p>
      </header>
      <div className="grid gap-2">
        {lessons.map((l, i) => (
          <LessonCard
            key={l.id}
            lesson={l}
            n={i + 1}
            done={done.has(l.id)}
            onToggle={() => toggle(l.id)}
          />
        ))}
      </div>
    </section>
  );
}
