/**
 * The Learn tab.
 *
 * Not a manual. A manual is read once and then rots, because it restates
 * numbers the engine owns. Every threshold on this surface is imported from
 * `aplus/config.ts`, `profit-rules.ts`, `scanner.ts`, `detectors.ts` and
 * `shock.ts` (see `learn/curriculum.ts`), so the lesson and the gate cannot
 * drift apart — if the floor moves, the sentence moves.
 *
 * Ordered by the sequence a trade is actually read in rather than by topic,
 * because the order IS the model. Each module ends with a question about the
 * tape in front of you, so the concept gets applied while it is still warm
 * rather than filed.
 *
 * The figures are illustrations and say so at the render layer. Inside a
 * trading app the one dangerous confusion is a teaching diagram being read as
 * a signal, so none of this touches the scanner, the alarm or the book.
 */

import { useState } from "react";
import { MODULES, type LearnModule } from "@/lib/learn/curriculum";
import { getFigure } from "@/lib/learn/figures";
import { LearnFigure } from "./learn-figure";

export function LearnTab() {
  const [openId, setOpenId] = useState<string>(MODULES[0]!.id);
  const active = MODULES.find((m) => m.id === openId) ?? MODULES[0]!;

  return (
    <div className="grid gap-4 lg:grid-cols-[210px_minmax(0,1fr)]">
      <nav aria-label="Curriculum" className="lg:sticky lg:top-2 lg:self-start">
        <ol className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
          {MODULES.map((m) => {
            const on = m.id === active.id;
            return (
              <li key={m.id} className="shrink-0 lg:shrink">
                <button
                  type="button"
                  onClick={() => setOpenId(m.id)}
                  aria-current={on ? "step" : undefined}
                  className={`flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-xs transition-colors ${
                    on
                      ? "bg-[var(--color-primary-dim)] text-[var(--color-fg)]"
                      : "text-[var(--color-muted)] hover:bg-[var(--color-surface-2)] hover:text-[var(--color-fg)]"
                  }`}
                >
                  <span
                    className={`tabular grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] font-semibold ${
                      on
                        ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                        : "bg-[var(--color-surface-3)] text-[var(--color-subtle)]"
                    }`}
                  >
                    {m.step}
                  </span>
                  <span className="truncate font-medium">{m.title}</span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <article className="flex min-w-0 flex-col gap-3">
        <ModuleView module={active} />
        <div className="flex justify-between gap-2 border-t border-[var(--color-border)] pt-3">
          <StepButton
            module={MODULES[MODULES.indexOf(active) - 1]}
            onGo={setOpenId}
            dir="prev"
          />
          <StepButton
            module={MODULES[MODULES.indexOf(active) + 1]}
            onGo={setOpenId}
            dir="next"
          />
        </div>
      </article>
    </div>
  );
}

function StepButton({
  module: m,
  onGo,
  dir,
}: {
  module: LearnModule | undefined;
  onGo: (id: string) => void;
  dir: "prev" | "next";
}) {
  if (!m) return <span />;
  return (
    <button
      type="button"
      onClick={() => onGo(m.id)}
      className={`rounded-[var(--radius-sm)] border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)] ${dir === "next" ? "ml-auto text-right" : ""}`}
    >
      <span className="block text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">
        {dir === "prev" ? "Back" : "Next"}
      </span>
      {m.title}
    </button>
  );
}

function ModuleView({ module: m }: { module: LearnModule }) {
  const figures = m.figures.map(getFigure).filter((f): f is NonNullable<typeof f> => f != null);
  return (
    <>
      <header>
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-subtle)]">
          Step {m.step} of {MODULES.length}
        </p>
        <h2 className="text-lg font-semibold tracking-tight">{m.title}</h2>
        <p className="mt-0.5 text-sm text-[var(--color-primary)]">{m.oneLine}</p>
      </header>

      {figures.length > 0 && (
        <div className={figures.length > 1 ? "grid gap-3 md:grid-cols-2" : ""}>
          {figures.map((f) => (
            <LearnFigure key={f.id} figure={f} />
          ))}
        </div>
      )}

      <Block label="How it works" body={m.mechanism} />
      <Block label="The rule" body={m.rule} tone="accent" />
      <Block label="Trigger" body={m.trigger} tone="mono" />
      <Block label="How this is usually got wrong" body={m.error} tone="warn" />
      <Block label="What this desk does" body={m.desk} tone="muted" />

      <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_7%,transparent)] p-3">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
          Apply it to the tape in front of you
        </p>
        <p className="mt-1 text-sm leading-snug text-[var(--color-fg)]">{m.check}</p>
      </div>
    </>
  );
}

function Block({
  label,
  body,
  tone = "plain",
}: {
  label: string;
  body: string;
  tone?: "plain" | "accent" | "mono" | "warn" | "muted";
}) {
  const bodyClass =
    tone === "mono"
      ? "tabular font-mono text-[12px] leading-relaxed text-[var(--color-fg)]"
      : tone === "warn"
        ? "text-sm leading-relaxed text-[var(--color-fg)]"
        : tone === "muted"
          ? "text-[13px] leading-relaxed text-[var(--color-muted)]"
          : "text-sm leading-relaxed text-[var(--color-fg)]";
  const labelColor =
    tone === "accent"
      ? "text-[var(--color-primary)]"
      : tone === "warn"
        ? "text-[var(--color-down)]"
        : "text-[var(--color-subtle)]";
  return (
    <section>
      <h3 className={`text-[10px] font-semibold uppercase tracking-wide ${labelColor}`}>
        {label}
      </h3>
      <p className={`mt-1 ${bodyClass}`}>{body}</p>
    </section>
  );
}
