/**
 * The shadow book, on screen.
 *
 * Two surfaces from one component:
 *   compact — the Now tab: today's shadows with live R, one line each, and
 *             the running totals. What the refusals are doing right now.
 *   full    — the Book tab: the ledger (any day, both legs), each row
 *             expandable to its path and its analysis, plus the scorecard —
 *             per-gate verdicts and the little things.
 *
 * Every number here is R or R × the grade's paper risk. Nothing is a fill
 * the trader made; the header says so, on both surfaces, on purpose.
 */

import { useMemo, useState } from "react";
import { APLUS_RULES } from "@/lib/aplus/config";
import {
  buildScorecard,
  fmtR,
  fmtUsd,
  MIN_VERDICT_N,
  type ReasonScore,
  type Scorecard,
} from "@/lib/trading/discretion-memory";
import { etDayKey, etTime, type ShadowTrade } from "@/lib/trading/shadow-book";
import { useShadowBook } from "@/lib/trading/shadow-store";

const px = (n: number) => n.toFixed(2);

function statusTone(s: ShadowTrade): string {
  switch (s.status) {
    case "won":
      return "text-[var(--color-up)]";
    case "lost":
      return "text-[var(--color-down)]";
    case "open":
      return "text-[var(--color-primary)]";
    case "resting":
      return "text-[var(--color-warn)]";
    default:
      return "text-[var(--color-muted)]";
  }
}

/** Live R for an open shadow against the last print it has seen. */
function liveR(s: ShadowTrade): number | null {
  if (s.status !== "open" || s.fillPrice == null) return null;
  // The last print is whichever extreme moved last; without a stored last
  // price, mark at the midpoint of the excursion — honest enough for a strip.
  const mark = (s.seenHi + s.seenLo) / 2;
  const open = (s.side === "long" ? mark - s.fillPrice : s.fillPrice - mark) / (s.riskPts || 1);
  return s.banked + open * s.remaining;
}

function Row({ s, expanded, onToggle }: { s: ShadowTrade; expanded: boolean; onToggle: () => void }) {
  const r = s.r ?? liveR(s);
  const pnl = s.pnl ?? (r != null ? r * s.riskDollars : null);
  return (
    <li className="border-b border-[var(--color-border)] last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="grid w-full grid-cols-[52px_72px_1fr_44px_64px_64px] items-center gap-2 px-2 py-1.5 text-left text-[11px] hover:bg-[var(--color-surface-2)] sm:grid-cols-[52px_72px_1fr_56px_44px_64px_72px]"
      >
        <span className="tabular text-[var(--color-subtle)]">{etTime(s.openedAt)}</span>
        <span className="font-semibold">
          {s.symbol} <span className={s.side === "long" ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>{s.side}</span>
        </span>
        <span className="truncate text-[var(--color-muted)]">
          <span className="text-[var(--color-warn)]">{s.word}</span> · {s.reason}
          {s.source === "replay" ? <span className="ml-1 rounded bg-[var(--color-surface-3)] px-1 text-[9px]">replay</span> : null}
        </span>
        <span className="hidden text-[10px] uppercase text-[var(--color-subtle)] sm:inline">{s.leg}</span>
        <span className={`text-[10px] uppercase ${statusTone(s)}`}>{s.status}</span>
        <span className={`tabular text-right font-semibold ${r == null ? "text-[var(--color-subtle)]" : r >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
          {r == null ? "—" : fmtR(r)}
        </span>
        <span className={`tabular text-right ${pnl == null ? "text-[var(--color-subtle)]" : pnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
          {pnl == null ? "—" : fmtUsd(pnl)}
        </span>
      </button>
      {expanded && (
        <div className="grid gap-3 border-t border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px] md:grid-cols-2">
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">Path</div>
            <ol className="flex flex-col gap-1">
              {s.path.map((e, i) => (
                <li key={i} className="text-[var(--color-muted)]">
                  <span className="mr-1 text-[var(--color-fg)]">{i + 1}.</span>
                  {e.text}
                </li>
              ))}
            </ol>
            <div className="tabular mt-2 text-[10px] text-[var(--color-subtle)]">
              {s.leg === "limit" ? `limit ${px(s.entry)}` : `chase ${px(s.entry)}`} · stop {px(s.stop)}
              {s.t1 != null ? ` · T1 ${px(s.t1)}` : ""}
              {s.t2 != null ? ` · T2 ${px(s.t2)}` : ""} · risk {s.riskPts.toFixed(2)}pt = {fmtUsd(s.riskDollars)} at {s.grade} · Q {s.confluence.toFixed(2)} · {s.strategy}
            </div>
          </div>
          <div>
            <div className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">Analysis</div>
            {s.analysis ? (
              <>
                <p
                  className={`font-medium ${
                    s.analysis.verdict === "gate-right"
                      ? "text-[var(--color-up)]"
                      : s.analysis.verdict === "gate-cost"
                        ? "text-[var(--color-down)]"
                        : "text-[var(--color-fg)]"
                  }`}
                >
                  {s.analysis.headline}
                </p>
                <ul className="mt-1 flex flex-col gap-0.5 text-[var(--color-muted)]">
                  {s.analysis.why.map((w, i) => (
                    <li key={i}>· {w}</li>
                  ))}
                </ul>
                <p className="mt-1 text-[var(--color-fg)]">{s.analysis.lesson}</p>
              </>
            ) : (
              <p className="text-[var(--color-muted)]">
                Refused on <span className="text-[var(--color-warn)]">{s.reason}</span> — {s.reasonDetail}. Still {s.status}; the analysis writes itself at the exit.
              </p>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {Object.entries(s.tags).map(([k, v]) => (
                <span key={k} className="rounded bg-[var(--color-surface-3)] px-1.5 py-0.5 text-[9px] text-[var(--color-muted)]">
                  {k}={v}
                </span>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {s.layers
                .filter((l) => l.must)
                .map((l) => (
                  <span
                    key={l.id}
                    className={`rounded-full border px-1.5 py-0.5 text-[9px] ${
                      l.state === "pass"
                        ? "border-[color-mix(in_oklab,var(--color-up)_45%,transparent)] text-[var(--color-up)]"
                        : l.state === "fail"
                          ? "border-[color-mix(in_oklab,var(--color-down)_45%,transparent)] text-[var(--color-down)]"
                          : "border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] text-[var(--color-warn)]"
                    }`}
                  >
                    {l.state === "pass" ? "✓" : l.state === "fail" ? "✕" : "○"} {l.label}
                  </span>
                ))}
            </div>
          </div>
        </div>
      )}
    </li>
  );
}

function Totals({ card, label }: { card: Scorecard; label: string }) {
  const c = card.total.chase;
  const l = card.total.limit;
  const dec = (x: typeof c) => x.wins + x.losses + x.scratch;
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-border)]">
      {[
        { name: `${label} · chase`, s: c },
        { name: `${label} · limit`, s: l },
      ].map(({ name, s }) => (
        <div key={name} className="bg-[var(--color-surface)] px-3 py-2">
          <div className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">{name}</div>
          <div className={`tabular text-sm font-semibold ${s.sumPnl >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}`}>
            {fmtUsd(s.sumPnl)} <span className="text-[11px] font-medium text-[var(--color-muted)]">{fmtR(s.sumR)}</span>
          </div>
          <div className="tabular text-[10px] text-[var(--color-muted)]">
            n={dec(s)} · WR {s.wr == null ? "—" : `${(s.wr * 100).toFixed(0)}%`} · {fmtR(s.exp)}/t
            {s.unfilled ? ` · ${s.unfilled} unfilled` : ""}
            {s.open ? ` · ${s.open} live` : ""}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReasonRow({ r }: { r: ReasonScore }) {
  const tone =
    r.verdict === "earning" ? "text-[var(--color-up)]" : r.verdict === "costing" ? "text-[var(--color-down)]" : "text-[var(--color-muted)]";
  const dec = r.chase.wins + r.chase.losses + r.chase.scratch;
  return (
    <li className="grid grid-cols-[1fr_auto] items-baseline gap-2 border-b border-[var(--color-border)] py-1.5 last:border-b-0">
      <div>
        <div className="text-[11px] font-medium text-[var(--color-fg)]">{r.reason}</div>
        <div className="tabular text-[10px] text-[var(--color-muted)]">
          chase n={dec} WR {r.chase.wr == null ? "—" : `${(r.chase.wr * 100).toFixed(0)}%`} {fmtR(r.chase.exp)}/t {fmtUsd(r.chase.sumPnl)} · limit n={r.limit.wins + r.limit.losses + r.limit.scratch} {fmtR(r.limit.exp)}/t{r.limit.unfilled ? ` (${r.limit.unfilled} unfilled)` : ""}
        </div>
      </div>
      <div className={`text-[10px] font-semibold ${tone}`}>
        {r.verdict === "earning" ? "earning its keep" : r.verdict === "costing" ? "costing — sweep" : `early ${dec}/${MIN_VERDICT_N}`}
      </div>
    </li>
  );
}

export function ShadowBookPanel({ mode }: { mode: "compact" | "full" }) {
  const { live, replay } = useShadowBook();
  const [expanded, setExpanded] = useState<string | null>(null);
  const [scope, setScope] = useState<"today" | "live" | "all">(mode === "compact" ? "today" : "live");
  const today = etDayKey(Date.now());

  const shown = useMemo(() => {
    if (scope === "today") return live.filter((s) => s.dayKey === today);
    if (scope === "live") return live;
    return [...live, ...replay].sort((a, b) => b.openedAt - a.openedAt);
  }, [scope, live, replay, today]);

  const cardLive = useMemo(() => buildScorecard(live), [live]);
  const cardAll = useMemo(() => buildScorecard([...live, ...replay]), [live, replay]);
  const cardToday = useMemo(() => buildScorecard(live.filter((s) => s.dayKey === today)), [live, today]);

  if (mode === "compact") {
    const openN = shown.filter((s) => s.status === "open" || s.status === "resting").length;
    return (
      <section className="flex flex-col gap-2">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold tracking-tight">Shadow book — the refusals, paper-traded</h2>
            <span className="text-[10px] text-[var(--color-muted)]">
              today {shown.length}{openN ? ` · ${openN} live` : ""} · not the paper book
            </span>
          </div>
          <span className="text-[10px] text-[var(--color-subtle)]">full ledger + scorecard in Book</span>
        </header>
        {shown.length ? (
          <>
            <Totals card={cardToday} label="today" />
            <ol className="rounded-[var(--radius-md)] border border-[var(--color-border)]">
              {shown.slice(0, 12).map((s) => (
                <Row key={s.id} s={s} expanded={expanded === s.id} onToggle={() => setExpanded(expanded === s.id ? null : s.id)} />
              ))}
            </ol>
          </>
        ) : (
          <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
            No refusals today yet. When a PATH-grade card prints and the sequence says STAND or WAIT, both legs open here automatically and resolve on the tape.
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold tracking-tight">Shadow book</h2>
          <p className="text-[11px] text-[var(--color-muted)]">
            Every PATH-grade card the sequence refused, paper-traded both ways on real tape at {APLUS_RULES.paperEquity.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} grade sizing. Evidence about the gates — never a fill you made.
          </p>
        </div>
        <div className="flex gap-1">
          {(["today", "live", "all"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setScope(k)}
              className={`rounded-[var(--radius-sm)] border px-2 py-1 text-[10px] ${scope === k ? "border-[var(--color-primary)] text-[var(--color-fg)]" : "border-[var(--color-border)] text-[var(--color-muted)]"}`}
            >
              {k === "all" ? `all (+${replay.length} replay)` : k}
            </button>
          ))}
        </div>
      </header>

      <Totals card={scope === "today" ? cardToday : scope === "live" ? cardLive : cardAll} label={scope} />

      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
        <ol className="max-h-[520px] overflow-auto rounded-[var(--radius-md)] border border-[var(--color-border)]">
          {shown.length ? (
            shown.slice(0, 300).map((s) => (
              <Row key={s.id} s={s} expanded={expanded === s.id} onToggle={() => setExpanded(expanded === s.id ? null : s.id)} />
            ))
          ) : (
            <li className="px-3 py-3 text-xs text-[var(--color-muted)]">Nothing in this scope yet.</li>
          )}
        </ol>
        <div className="flex flex-col gap-3">
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            <div className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">Gate scorecard · live + replay</div>
            {cardAll.byReason.length ? (
              <ul>
                {cardAll.byReason.map((r) => (
                  <ReasonRow key={r.reasonId} r={r} />
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--color-muted)]">No shadows yet.</p>
            )}
            {cardAll.sweepNext && (
              <p className="mt-2 text-[11px] text-[var(--color-down)]">
                Next sweep: "{cardAll.sweepNext.reason}" — its refusals paid {fmtR(cardAll.sweepNext.chase.exp)}/t. Measure it with scripts/sweep-gates.mjs before touching the gate.
              </p>
            )}
          </div>
          <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
            <div className="mb-1 text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">The little things · chase leg vs baseline</div>
            {cardAll.lifts.length ? (
              <ul className="flex flex-col gap-1">
                {cardAll.lifts.map((l) => (
                  <li key={`${l.tag}=${l.value}`} className="tabular flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="text-[var(--color-fg)]">
                      {l.tag}=<span className="text-[var(--color-muted)]">{l.value}</span>
                    </span>
                    <span className={l.lift >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>
                      {fmtR(l.lift)} <span className="text-[var(--color-subtle)]">n={l.n} · WR {(l.wr * 100).toFixed(0)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-[var(--color-muted)]">Needs a few decided shadows before a pattern can be counted.</p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
