/**
 * The Learn tab.
 *
 * Three rings, one skill: name the first failing must-layer, then TAKE or STAND.
 *
 *   Ring 1  SCHEMA    worked figure + the near-miss of the same object
 *   Ring 2  RETRIEVE  call the word before the engine's answer is on screen
 *   Ring 3  TRANSFER  real-tape walkthrough, clock running, one word
 *
 * Every threshold is imported (see curriculum.ts). None of this touches the
 * scanner, the alarm or the book.
 */

import { useState } from "react";
import { MODULES, type LearnModule } from "@/lib/learn/curriculum";
import { getFigure } from "@/lib/learn/figures";
import { scenariosFor, type Scenario, type Verdict } from "@/lib/learn/scenarios";
import { scenarioCall, type Call } from "@/lib/learn/drill";
import { LearnFigure } from "./learn-figure";
import { Walkthroughs } from "./walkthroughs";
import { DrillCall, WhyBox } from "./drill-call";
import type { DeskPayload } from "@/lib/trading/build-desk";

export function LearnTab({ desk }: { desk: DeskPayload }) {
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
        <ModuleView key={active.id} module={active} desk={desk} />
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

function verdictStyle(v: Verdict): { color: string; bg: string } {
  if (v === "TAKE") return { color: "var(--color-up)", bg: "color-mix(in oklab, var(--color-up) 14%, transparent)" };
  if (v === "WAIT") return { color: "var(--color-warn)", bg: "color-mix(in oklab, var(--color-warn) 14%, transparent)" };
  return { color: "var(--color-down)", bg: "color-mix(in oklab, var(--color-down) 14%, transparent)" };
}

/**
 * The scenario set for a subject.
 *
 * One at a time rather than a stack: the point is to look at a shape, decide,
 * and then read the verdict — which only works if the next scenario is not
 * already visible underneath with its answer showing.
 */
function Scenarios({ items }: { items: Scenario[] }) {
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const active = items[Math.min(idx, items.length - 1)]!;
  const style = verdictStyle(active.verdict);
  const truth = scenarioCall(active.id, active.verdict);

  function go(i: number) {
    setIdx(i);
    setRevealed(false);
  }

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Ring 2 · retrieve — {items.length}
        </h3>
        <div className="flex flex-wrap gap-1">
          {items.map((sc, i) => (
            <button
              key={sc.id}
              type="button"
              onClick={() => go(i)}
              aria-current={i === idx ? "true" : undefined}
              className={`rounded-[var(--radius-sm)] px-2 py-1 text-[11px] transition-colors ${
                i === idx
                  ? "bg-[var(--color-primary)] text-[var(--color-primary-fg)]"
                  : "bg-[var(--color-surface-3)] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
              }`}
            >
              {sc.name}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-2 text-sm text-[var(--color-fg)]">{active.situation}</p>

      <LearnFigure figure={active.figure} hideCaption={!revealed} />

      <div className="mt-2">
        <DrillCall
          key={active.id}
          prompt="Same object, different dress. Name the word. If not TAKE, name the missing layer."
          truth={truth}
          onCommit={() => setRevealed(true)}
        />
      </div>

      {revealed && (
        <div className="mt-2 rounded-[var(--radius-sm)] p-3" style={{ background: style.bg }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: style.color }}>
            {active.verdict}
            {truth.word !== "TAKE" ? ` · ${truth.missing}` : ""}
          </p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-fg)]">{active.read}</p>
        </div>
      )}
    </section>
  );
}

function ModuleView({ module: m, desk }: { module: LearnModule; desk: DeskPayload }) {
  const figures = m.figures.map(getFigure).filter((f): f is NonNullable<typeof f> => f != null);
  const scenarios = scenariosFor(m.id);
  const [called, setCalled] = useState(false);
  const live = liveFacts(m.id, desk, called);
  const book = desk.smcMaster.oneBook;
  const liveTruth: Call = {
    word: book?.word ?? "STAND",
    missing: book?.missing ?? "Sequence complete",
  };

  return (
    <>
      <header>
        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--color-subtle)]">
          Step {m.step} of {MODULES.length}
        </p>
        <h2 className="text-lg font-semibold tracking-tight">{m.title}</h2>
        <p className="mt-0.5 text-sm text-[var(--color-primary)]">{m.oneLine}</p>
      </header>

      <LiveStrip rows={live} />

      {m.id === "walkthroughs" ? (
        <Walkthroughs />
      ) : (
        <>
          {figures.length > 0 && (
            <div>
              <p className="mb-1 text-[10px] uppercase tracking-wide text-[var(--color-subtle)]">
                {m.pairing === "compare"
                  ? "Ring 1 · same window · two books"
                  : m.pairing === "contrast"
                    ? "Ring 1 · schema · the object and its near-miss"
                    : "Ring 1 · schema"}
              </p>
              <div className={figures.length > 1 ? "grid gap-3 md:grid-cols-2" : ""}>
                {figures.map((f) => (
                  <LearnFigure key={f.id} figure={f} />
                ))}
              </div>
            </div>
          )}

          {m.why && m.whyAnswer && <WhyBox key={m.id} prompt={m.why} answer={m.whyAnswer} />}

          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[5.5rem_minmax(0,1fr)]">
            <Spec k="Rule" v={m.rule} />
            <Spec k="Trigger" v={m.trigger} mono />
            <Spec k="Trap" v={m.error} warn />
            <Spec k="Code" v={m.desk} muted />
          </dl>

          <DrillCall
            key={`${m.id}-live`}
            prompt={m.check}
            truth={liveTruth}
            onCommit={() => setCalled(true)}
          />

          {scenarios.length > 0 && <Scenarios items={scenarios} />}
        </>
      )}
    </>
  );
}

function Spec({
  k,
  v,
  mono,
  warn,
  muted,
}: {
  k: string;
  v: string;
  mono?: boolean;
  warn?: boolean;
  muted?: boolean;
}) {
  return (
    <>
      <dt
        className={`text-[10px] font-semibold uppercase tracking-wide ${
          warn ? "text-[var(--color-down)]" : "text-[var(--color-subtle)]"
        }`}
      >
        {k}
      </dt>
      <dd
        className={
          mono
            ? "tabular font-mono text-[12px] leading-snug text-[var(--color-fg)]"
            : muted
              ? "text-[12px] leading-snug text-[var(--color-muted)]"
              : "text-[13px] leading-snug text-[var(--color-fg)]"
        }
      >
        {v}
      </dd>
    </>
  );
}

function LiveStrip({ rows }: { rows: { k: string; v: string }[] }) {
  if (!rows.length) return null;
  return (
    <dl className="grid grid-cols-2 gap-x-3 gap-y-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 sm:grid-cols-4">
      {rows.map((r) => (
        <div key={r.k} className="min-w-0">
          <dt className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">{r.k}</dt>
          <dd className="truncate tabular text-[12px] font-medium text-[var(--color-fg)]">{r.v}</dd>
        </div>
      ))}
    </dl>
  );
}

function liveFacts(id: string, desk: DeskPayload, called: boolean): { k: string; v: string }[] {
  const lag = Math.round(Math.max(desk.quotes.left.lagSec, desk.quotes.right.lagSec));
  const feed = `${desk.quotes.left.source} ${lag}s`;
  const book = desk.smcMaster.oneBook;
  const left = desk.bias.left;
  const right = desk.bias.right;
  const base = [
    { k: "Feed", v: feed },
    {
      k: "Live",
      v: `${desk.quotes.left.symbol} ${desk.quotes.left.price.toFixed(2)} · ${desk.quotes.right.symbol} ${desk.quotes.right.price.toFixed(2)}`,
    },
  ];
  if (id === "sequence" || id === "sweep" || id === "shift" || id === "retrace" || id === "arrays") {
    return [
      ...base,
      { k: "SMC", v: called ? (book ? `${book.symbol} ${book.word} ${book.mustPass}/${book.mustNeed}` : desk.smcMaster.thesis) : "call first" },
      { k: "Missing", v: called ? (book ? `${book.missing}${book.missingDetail ? ` — ${book.missingDetail}` : ""}` : "—") : "call first" },
    ];
  }
  if (id.startsWith("bias") || id === "range") {
    return [
      ...base,
      {
        k: "HTF",
        v: `${left.symbol} ${left.topDown} ${(left.confidence * 100).toFixed(0)}% · ${right.symbol} ${right.topDown} ${(right.confidence * 100).toFixed(0)}%`,
      },
      {
        k: "Zone",
        v: `${left.symbol} ${left.dealing?.zone ?? "—"} · ${right.symbol} ${right.dealing?.zone ?? "—"}`,
      },
    ];
  }
  if (id === "dol" || id === "liquidity") {
    const dL = desk.draws.left;
    const dR = desk.draws.right;
    return [
      ...base,
      { k: "Draw L", v: dL?.primary ? `${dL.primary.name} ${dL.primary.price.toFixed(2)}` : "—" },
      { k: "Draw R", v: dR?.primary ? `${dR.primary.name} ${dR.primary.price.toFixed(2)}` : "—" },
    ];
  }
  if (id === "smt") {
    return [
      ...base,
      { k: "SMT", v: desk.scan.smt?.note ?? desk.smtStack?.primary?.note ?? "—" },
      { k: "Book", v: book ? `${book.symbol} ${book.side ?? "flat"}` : "one-book none" },
    ];
  }
  if (id === "time") {
    return [
      ...base,
      { k: "Clock", v: `${desk.clock.nowEt} · ${desk.clock.killzoneLabel}` },
      { k: "News", v: desk.news.verdict + (desk.news.nextEvent ? ` · ${desk.news.nextEvent.name} ${desk.news.nextEvent.timeEt}` : "") },
    ];
  }
  if (id === "risk" || id === "gates") {
    return [
      ...base,
      { k: "Risk", v: `$${desk.risk.riskDollars.toFixed(0)} · ${(desk.risk.riskPct * 100).toFixed(1)}% · floor ${desk.risk.floor}` },
      { k: "PATH", v: book?.pathBand ?? desk.scan.candidates[0]?.pathBand ?? "—" },
    ];
  }
  return [
    ...base,
    { k: "SMC", v: called ? (book ? `${book.word}` : "—") : "call first" },
    { k: "Missing", v: called ? (book?.missing ?? "—") : "call first" },
  ];
}
