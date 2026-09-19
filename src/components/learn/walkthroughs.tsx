/**
 * Real-tape walkthroughs.
 *
 * Every case here was FOUND, not drawn: the live desk's own assembly run
 * causally over a captured month of 15m bars, one closed bar at a time, in
 * the NY AM window. What you see at the decision is exactly what the desk
 * would have printed at that moment; what follows is what the tape did.
 *
 * The chart is the live desk's own chart component on real bars, so a lesson
 * looks like the thing it is teaching you to read. Everything to the right of
 * the divider is the future, hidden until you decide.
 *
 * Nothing is curated toward winners. The pool tally in the header is the
 * whole month, and the "if you had not waited" line under a refused setup is
 * a simulation with intrabar ties resolved AGAINST the trade.
 */

import { useMemo, useState } from "react";
import type { LearnCase, CaseOutcome } from "@/lib/learn/cases";
import casesJson from "@/data/learn-cases.json";
import { SetupChart } from "@/components/desk/setup-chart";

interface CasesFile {
  builtAt: string;
  historyCapturedAt: string;
  interval: string;
  pool: { takes: number; wins: number; losses: number; scratch: number; unfilled: number; stands: number; sumR: number };
  cases: LearnCase[];
}

const FILE = casesJson as unknown as CasesFile;

function outcomeStyle(o: CaseOutcome | "chase-win" | "chase-loss" | "chase-scratch"): { color: string; bg: string } {
  const up = { color: "var(--color-up)", bg: "color-mix(in oklab, var(--color-up) 14%, transparent)" };
  const down = { color: "var(--color-down)", bg: "color-mix(in oklab, var(--color-down) 14%, transparent)" };
  const warn = { color: "var(--color-warn)", bg: "color-mix(in oklab, var(--color-warn) 14%, transparent)" };
  const muted = { color: "var(--color-muted)", bg: "var(--color-surface-3)" };
  if (o === "win" || o === "chase-win") return up;
  if (o === "loss" || o === "chase-loss") return down;
  if (o === "scratch" || o === "chase-scratch" || o === "unfilled") return warn;
  return muted;
}

function badgeText(c: LearnCase): { text: string; key: CaseOutcome | "chase-win" | "chase-loss" | "chase-scratch" } {
  if (c.outcome !== "stand") {
    const r = c.r != null ? ` ${c.r >= 0 ? "+" : ""}${c.r.toFixed(2)}R` : "";
    return { text: `${c.entryMode === "armed" ? "ARMED · " : ""}${c.outcome.toUpperCase()}${r}`, key: c.outcome };
  }
  if (c.chase) {
    const r = c.chase.r != null ? ` ${c.chase.r >= 0 ? "+" : ""}${c.chase.r.toFixed(2)}R` : "";
    return { text: `${c.word} · chase ${c.chase.outcome}${r}`, key: `chase-${c.chase.outcome === "win" ? "win" : c.chase.outcome === "loss" ? "loss" : "scratch"}` };
  }
  return { text: c.word, key: "stand" };
}

export function Walkthroughs() {
  const cases = FILE.cases;
  const [idx, setIdx] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const c = cases[Math.min(idx, cases.length - 1)];

  // The honest month: every chase counterfactual, summed.
  const chaseTally = useMemo(() => {
    let w = 0, l = 0, s = 0, sum = 0;
    for (const k of cases) {
      if (!k.chase) continue;
      if (k.chase.outcome === "win") w++;
      else if (k.chase.outcome === "loss") l++;
      else s++;
      sum += k.chase.r ?? 0;
    }
    return { w, l, s, sum: Math.round(sum * 100) / 100, n: w + l + s };
  }, [cases]);

  if (!c) {
    return <p className="text-sm text-[var(--color-muted)]">No cases built yet — run `npx tsx scripts/build-learn-cases.mjs`.</p>;
  }

  const shownBars = revealed ? c.bars : c.bars.slice(0, c.decisionIndex + 1);
  // For a refused setup there is no desk plan; draw the chase plan so the
  // trader can see where the entry, stop and target would have sat.
  const plan = c.plan ?? c.chase?.plan ?? null;
  const badge = badgeText(c);
  const bStyle = outcomeStyle(badge.key);

  function go(i: number) {
    setIdx(i);
    setRevealed(false);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-muted)]">
        <span className="font-semibold text-[var(--color-fg)]">The month, honestly.</span>{" "}
        Real 15m bars captured {FILE.historyCapturedAt.slice(0, 10)}, NY AM window, the live desk's own engine
        on every closed bar. It printed TAKE <span className="tabular text-[var(--color-fg)]">{FILE.pool.takes}</span>{" "}
        times and refused <span className="tabular text-[var(--color-fg)]">{FILE.pool.stands}</span> PATH-grade setups
        with a named missing layer. Taking those refused setups anyway would have gone{" "}
        <span className="tabular text-[var(--color-fg)]">
          {chaseTally.w}W / {chaseTally.l}L / {chaseTally.s}S · {chaseTally.sum >= 0 ? "+" : ""}
          {chaseTally.sum}R
        </span>{" "}
        across {chaseTally.n} chases, ties resolved against the trade.
      </div>

      <div className="flex flex-wrap gap-1">
        {cases.map((k, i) => {
          const b = badgeText(k);
          const st = outcomeStyle(b.key);
          const on = i === idx;
          return (
            <button
              key={k.id}
              type="button"
              onClick={() => go(i)}
              aria-current={on ? "true" : undefined}
              className={`rounded-[var(--radius-sm)] border px-2 py-1 text-left text-[10px] leading-tight transition-colors ${
                on ? "border-[var(--color-primary)] bg-[var(--color-primary-dim)]" : "border-[var(--color-border)] hover:border-[var(--color-border-strong)]"
              }`}
            >
              <span className="block text-[var(--color-fg)]">
                {k.decisionEt.replace(" ET", "")} · {k.symbol} {k.side ?? ""}
              </span>
              <span className="tabular" style={{ color: st.color }}>
                Q{k.confluence.toFixed(2)} · {b.text}
              </span>
            </button>
          );
        })}
      </div>

      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold tracking-tight">
            {c.symbol} {c.side?.toUpperCase() ?? ""} · {c.decisionEt}
          </h3>
          <p className="text-[11px] text-[var(--color-muted)]">
            Confluence {c.confluence.toFixed(2)} ({c.grade}) · desk printed{" "}
            <span className="font-semibold text-[var(--color-fg)]">{c.word}</span>
            {c.word !== "TAKE" ? ` — ${c.missing}` : ""}
          </p>
        </div>
        <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: bStyle.color, background: bStyle.bg }}>
          {badge.text}
        </span>
      </header>

      <SetupChart
        bars={shownBars}
        plan={plan}
        word={c.word}
        visibleBars={100}
        decisionIndex={revealed ? c.decisionIndex : null}
        hideEmptyCaption
      />

      {!revealed ? (
        <button
          type="button"
          onClick={() => setRevealed(true)}
          className="w-full rounded-[var(--radius-sm)] border border-dashed border-[var(--color-border-strong)] py-2 text-xs text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          Read the steps, decide what you would do — then reveal what the tape did
        </button>
      ) : (
        <p className="text-[10px] text-[var(--color-subtle)]">
          Right of the divider is the future. {c.plan ? "Lines are the desk's plan." : c.chase ? "Lines are the CHASE plan — the trade the desk refused." : ""}
        </p>
      )}

      <ol className="flex flex-col gap-2">
        {c.steps.map((st, i) => {
          // The outcome steps stay hidden until revealed — that is the exercise.
          const isFuture = /^7/.test(st.title) || (/^6/.test(st.title) && c.outcome !== "stand" && false);
          if (isFuture && !revealed) return null;
          const color =
            st.tone === "pass" ? "var(--color-up)" : st.tone === "fail" ? "var(--color-down)" : st.tone === "wait" ? "var(--color-warn)" : "var(--color-muted)";
          return (
            <li key={i} className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide" style={{ color }}>
                {st.title}
              </p>
              <p className="mt-1 text-[13px] leading-relaxed text-[var(--color-fg)]">{st.body}</p>
            </li>
          );
        })}
      </ol>

      {revealed && (
        <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_7%,transparent)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">The lesson</p>
          <p className="mt-1 text-sm leading-relaxed text-[var(--color-fg)]">{c.lesson}</p>
        </div>
      )}

      <div className="flex justify-between border-t border-[var(--color-border)] pt-2">
        <button type="button" disabled={idx === 0} onClick={() => go(idx - 1)} className="text-xs text-[var(--color-muted)] disabled:opacity-40 hover:text-[var(--color-fg)]">
          ← Previous case
        </button>
        <span className="tabular text-[10px] text-[var(--color-subtle)]">
          {idx + 1} / {cases.length}
        </span>
        <button type="button" disabled={idx >= cases.length - 1} onClick={() => go(idx + 1)} className="text-xs text-[var(--color-muted)] disabled:opacity-40 hover:text-[var(--color-fg)]">
          Next case →
        </button>
      </div>
    </div>
  );
}
