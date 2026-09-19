/**
 * Ring 3 — real-tape walkthroughs.
 *
 * The trader names TAKE / WAIT / STAND and the missing must-layer BEFORE the
 * engine's word, the plan, the chase R, or step 6 are on screen. Outcome-first
 * is hindsight. Chips show date and book only until that case is committed.
 *
 * Every case was FOUND by running the live assembly causally over captured
 * 15m bars. Ties resolve against the trade.
 */

import { useMemo, useState } from "react";
import type { LearnCase, CaseOutcome } from "@/lib/learn/cases";
import casesJson from "@/data/learn-cases.json";
import { SetupChart } from "@/components/desk/setup-chart";
import { DrillCall } from "./drill-call";
import type { CallScore } from "@/lib/learn/drill";

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
  const [seen, setSeen] = useState<Record<string, CallScore["grade"]>>({});
  const c = cases[Math.min(idx, cases.length - 1)];

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

  const hits = Object.values(seen).filter((g) => g === "hit").length;
  const nSeen = Object.keys(seen).length;

  if (!c) {
    return <p className="text-sm text-[var(--color-muted)]">No cases built yet — run `npx tsx scripts/build-learn-cases.mjs`.</p>;
  }

  const shownBars = revealed ? c.bars : c.bars.slice(0, c.decisionIndex + 1);
  const plan = revealed ? (c.plan ?? c.chase?.plan ?? null) : null;
  const badge = badgeText(c);
  const bStyle = outcomeStyle(badge.key);

  function go(i: number) {
    setIdx(i);
    setRevealed(false);
  }

  function commit(score: CallScore) {
    setSeen((prev) => ({ ...prev, [c.id]: score.grade }));
    setRevealed(true);
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2">
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Ring 3 · transfer · future hidden until you call
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] sm:grid-cols-4">
          <div>
            <dt className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">Capture</dt>
            <dd className="tabular text-[var(--color-fg)]">
              {FILE.interval} · {FILE.historyCapturedAt.slice(0, 10)} · NY AM
            </dd>
          </div>
          <div>
            <dt className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">Engine</dt>
            <dd className="tabular text-[var(--color-fg)]">
              TAKE {FILE.pool.takes} · STAND {FILE.pool.stands} · ΣR {FILE.pool.sumR >= 0 ? "+" : ""}
              {FILE.pool.sumR}
            </dd>
          </div>
          <div>
            <dt className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">If taken anyway</dt>
            <dd className="tabular text-[var(--color-fg)]">
              {chaseTally.w}W / {chaseTally.l}L / {chaseTally.s}S · {chaseTally.sum >= 0 ? "+" : ""}
              {chaseTally.sum}R
            </dd>
          </div>
          <div>
            <dt className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">Your calls</dt>
            <dd className="tabular text-[var(--color-fg)]">
              {nSeen ? `${hits} hit / ${nSeen}` : "none yet"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="flex flex-wrap gap-1">
        {cases.map((k, i) => {
          const on = i === idx;
          const grade = seen[k.id];
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
                {k.decisionEt.replace(" ET", "")} · {k.symbol}
              </span>
              <span className="tabular text-[var(--color-subtle)]">
                {grade ? (grade === "hit" ? "hit" : grade === "word" ? "word" : "miss") : "unseen"}
              </span>
            </button>
          );
        })}
      </div>

      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-base font-semibold tracking-tight">
            {c.symbol} · {c.decisionEt}
          </h3>
          <p className="text-[11px] text-[var(--color-muted)]">
            {revealed
              ? `Confluence ${c.confluence.toFixed(2)} (${c.grade}) · desk printed ${c.word}${c.word !== "TAKE" ? ` — ${c.missing}` : ""}`
              : "Tape through the decision bar. Name the word. Then the missing layer."}
          </p>
        </div>
        {revealed && (
          <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ color: bStyle.color, background: bStyle.bg }}>
            {badge.text}
          </span>
        )}
      </header>

      <SetupChart
        bars={shownBars}
        plan={plan}
        word={revealed ? c.word : undefined}
        visibleBars={100}
        decisionIndex={revealed ? c.decisionIndex : null}
        hideEmptyCaption
      />

      <DrillCall
        key={c.id}
        prompt="Cold window. TAKE, WAIT, or STAND. If not TAKE, the one missing must-layer."
        truth={{ word: c.word, missing: c.missing }}
        onCommit={commit}
      />

      {revealed && (
        <p className="text-[10px] text-[var(--color-subtle)]">
          Right of the divider is the future. {c.plan ? "Lines are the desk's plan." : c.chase ? "Lines are the CHASE plan — the trade the desk refused." : ""}
        </p>
      )}

      {revealed && (
        <ol className="flex flex-col gap-2">
          {c.steps.map((st, i) => {
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
      )}

      {revealed && (
        <div className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_7%,transparent)] p-3">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-primary)]">
            {c.word}
            {c.r != null ? ` · ${c.r >= 0 ? "+" : ""}${c.r.toFixed(2)}R` : ""}
            {c.chase?.r != null
              ? ` · chase ${c.chase.outcome} ${c.chase.r >= 0 ? "+" : ""}${c.chase.r.toFixed(2)}R`
              : ""}
          </p>
          <p className="mt-1 text-sm leading-snug text-[var(--color-fg)]">
            {c.missing}
            {c.missingDetail ? ` — ${c.missingDetail}` : ""}
            {c.exitReason && c.outcome !== "stand" ? ` · ${c.exitReason}` : ""}
          </p>
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
