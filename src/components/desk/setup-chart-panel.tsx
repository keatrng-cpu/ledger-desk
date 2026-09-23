/**
 * The Now tab's picture of the trade.
 *
 * This exists to REPLACE prose, not to sit next to it. The desk's complaint
 * was that every fact arrived as a sentence — "IFVG 24180.25–24195.50",
 * "Beyond the sweep extreme", "PDH 24030.00 · 68%" — which a trader has to
 * assemble into a mental chart before it means anything. Those three sentences
 * are one picture, and the picture is the format the decision is actually made
 * in. The numeric strip underneath is the same plan again for the values you
 * type into a broker; nothing here is a second source of truth.
 *
 * ALWAYS MARKED. The chart carries the SMC overlay (chart-overlay.ts) on every
 * poll — pools, arrays, structure, range, draw, last raid — whether the word
 * is TAKE, WAIT or STAND, and pre-market as much as in-session. Before this a
 * STAND day drew bare candles, which is the one state where the trader most
 * needs to see WHY. The plan (entry / stop / targets) is layered on top only
 * when the sequence has priced one.
 *
 * TWO FLASHES. Green when the desk prints TAKE — that is the only thing green
 * means here. Red when something changed that a trader must not miss: the
 * charted symbol's HTF bias flipped between polls, its book side flipped, a
 * news blackout began, or the tape shock breaker tripped. Red wins over green
 * because a TAKE printed on the bar the bias flipped is a TAKE to re-read.
 *
 * ONE BOOK. `smcMaster.oneBook` is charted when the desk has settled on one,
 * because the house rule is one book per day and showing two charts invites
 * exactly the split attention the rule exists to prevent.
 */

import { useMemo, useState } from "react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { SmcLayer, SmcMasterBook } from "@/lib/trading/smc-master";
import { walkthrough } from "@/lib/trading/setup-steps";
import type { SetupCandidate } from "@/lib/trading/scanner";
import { planRiskText } from "@/lib/trading/trade-plan";
import { HIGH_CONFLUENCE_THRESHOLD } from "@/lib/trading/scanner";
import { buildChartOverlay } from "@/lib/trading/chart-overlay";
import { chartFrameClass, useBiasFlip } from "@/lib/trading/use-bias-flip";
import { evidenceFor, fmtR, managementLine, pathStats } from "@/lib/trading/discretion-memory";
import { refusingLayer } from "@/lib/trading/shadow-book";
import { useShadowBook } from "@/lib/trading/shadow-store";
import { SetupChart, VISIBLE_BARS } from "./setup-chart";
import { EntryTriggerPanel } from "./entry-trigger-panel";

/** The book to draw, and the bars that belong to it. */
function pickBook(desk: DeskPayload): { book: SmcMasterBook; bars: typeof desk.left.bars } | null {
  const m = desk.smcMaster;
  if (!m) return null;
  const candidates: SmcMasterBook[] = m.oneBook
    ? [m.oneBook]
    : [m.left, m.right].filter(Boolean);
  // Prefer a book that actually has a plan; among those, the one closest to a
  // TAKE. A WAIT with a priced plan is more useful to look at than a STAND
  // with nothing drawn on it.
  const rank = (b: SmcMasterBook) =>
    (b.plan ? 4 : 0) + (b.word === "TAKE" ? 2 : b.word === "WAIT" ? 1 : 0);
  const book = candidates.sort((a, b) => rank(b) - rank(a))[0];
  if (!book) return null;
  const bars =
    book.symbol === desk.left.symbol
      ? desk.left.bars
      : book.symbol === desk.right.symbol
        ? desk.right.bars
        : desk.left.bars;
  return { book, bars };
}

export function SetupChartPanel({ desk }: { desk: DeskPayload }) {
  const [teaching, setTeaching] = useState(false);
  const shadows = useShadowBook();
  const picked = pickBook(desk);
  const book = picked?.book ?? null;
  const bars = picked?.bars ?? [];
  const plan = book?.plan ?? null;

  // The overlay is built against the bars the chart will show, so "in frame"
  // means what is actually on screen.
  const overlay = useMemo(
    () => (book ? buildChartOverlay(desk, book.symbol, bars.slice(-VISIBLE_BARS)) : null),
    [desk, book, bars],
  );
  const topDown = overlay?.topDown ?? "neutral";
  const flip = useBiasFlip(desk.fetchedAt, book?.symbol ?? "", topDown, book?.side ?? null);

  if (!book) return null;

  const candidate = desk.scan.candidates.find((c) => c.symbol === book.symbol);
  const hot = candidate != null && candidate.confluence >= HIGH_CONFLUENCE_THRESHOLD;

  // Red beats green: a TAKE on the bar the bias flipped is a TAKE to re-read.
  const warnReason = overlay?.warn.active ? overlay.warn.reason : flip ? flip.reason : null;
  const take = book.word === "TAKE";
  const frameClass = chartFrameClass({ warn: warnReason != null, take, hotWait: hot && book.word === "WAIT" });
  const frame = frameClass ? `${frameClass} rounded-[var(--radius-lg)]` : "";

  const caution = desk.news?.verdict === "caution" ? desk.news.reason : null;

  return (
    <section className={`flex flex-col gap-2 ${frame}`}>
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">The trade, drawn</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              take
                ? "bg-[color-mix(in_oklab,var(--color-up)_22%,transparent)] text-[var(--color-up)]"
                : book.word === "WAIT"
                  ? "bg-[color-mix(in_oklab,var(--color-warn)_22%,transparent)] text-[var(--color-warn)]"
                  : "bg-[var(--color-surface-3)] text-[var(--color-muted)]"
            }`}
          >
            {book.word}
          </span>
          <span className="tabular text-[10px] text-[var(--color-muted)]">
            HTF {topDown}
            {candidate ? ` · Q ${candidate.confluence.toFixed(2)}` : ""}
            {candidate?.pathBand ? ` · ${candidate.pathBand}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setTeaching((t) => !t)}
          aria-expanded={teaching}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          {teaching ? "Hide key" : "What am I looking at?"}
        </button>
      </header>

      {warnReason && (
        <p
          role="alert"
          className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-down)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-down)_14%,transparent)] px-3 py-1.5 text-xs font-medium text-[var(--color-down)]"
        >
          {warnReason}
        </p>
      )}
      {!warnReason && caution && (
        <p className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)] px-3 py-1.5 text-xs text-[var(--color-warn)]">
          {caution}
        </p>
      )}

      <SetupChart
        bars={bars}
        plan={plan}
        overlay={overlay}
        word={book.word}
        emptyDetail={book.missingDetail || book.missing}
      />

      {/* Is this plan worth watching right now, where the order goes, and
          what the click costs — the three answers between the picture and
          the trade. */}
      <EntryTriggerPanel desk={desk} book={book} />

      {/* What entry still needs, IN ORDER. The flat pill row is kept below
          as the at-a-glance summary, but the sequence is causal — there is no
          point watching for an LTF shift before a sweep has printed — so the
          numbered walkthrough leads, and it carries the one line the grid
          cannot: what has to happen next, and why the engine grade and the
          sequence word are both right when they disagree. */}
      <SequenceWalkthrough book={book} candidate={candidate} />
      <LayerStrip layers={book.layers} />

      {/* The same plan as typeable numbers. Derived from `plan`, never re-stated. */}
      {plan ? (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-border)] sm:grid-cols-5">
          <Cell label="Entry" value={plan.entry.toFixed(2)} tone="primary" />
          <Cell label="Stop" value={plan.stop.toFixed(2)} tone="down" />
          <Cell
            label={plan.draw ? `T1 ${plan.draw.name}` : "T1"}
            value={plan.t1 != null ? plan.t1.toFixed(2) : "—"}
            sub={plan.rr1 != null ? `${plan.rr1.toFixed(2)}R` : undefined}
            tone="up"
          />
          <Cell
            label="T2 ERL"
            value={plan.t2 != null ? plan.t2.toFixed(2) : "—"}
            sub={plan.rr2 != null ? `${plan.rr2.toFixed(2)}R` : undefined}
            tone="up"
          />
          <Cell
            label="Risk"
            value={`${plan.riskPts.toFixed(2)}pt`}
            sub={plan.riskOverCap ? "over cap" : undefined}
            tone={plan.riskOverCap ? "down" : "muted"}
          />
        </div>
      ) : (
        <p className="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3 py-2 text-xs text-[var(--color-muted)]">
          <span className="font-medium text-[var(--color-warn)]">{book.missing}</span>
          {book.missingDetail ? ` — ${book.missingDetail}` : ""}
        </p>
      )}

      {/* What the shadow book knows about THIS refusal. Evidence about the
          gate, from every time it refused a PATH card — never permission. */}
      {book.word !== "TAKE" && (() => {
        const layer = refusingLayer(book);
        const ev = layer ? evidenceFor(layer.id, [...shadows.live, ...shadows.replay]) : null;
        if (!layer) return null;
        const tone =
          ev?.verdict === "earning"
            ? "text-[var(--color-up)]"
            : ev?.verdict === "costing"
              ? "text-[var(--color-down)]"
              : "text-[var(--color-muted)]";
        return (
          <p className={`tabular text-[10px] ${tone}`}>
            {ev ? `Shadow book on "${layer.label}": ${ev.line.replace(/^[^:]+: /, "")}` : `Shadow book on "${layer.label}": no refusals measured yet — the next one opens both legs automatically.`}
          </p>
        );
      })()}

      {plan && (
        <p className="tabular text-[10px] text-[var(--color-subtle)]">
          {planRiskText(plan)}
          {plan.draw
            ? ` · draw ${plan.draw.name} reached ${(plan.draw.reachProbability * 100).toFixed(0)}% of past sessions`
            : ""}
        </p>
      )}

      {/* What a card like this usually does after the fill — so the median
          drawdown is labelled normal before it happens, and the value of
          waiting for CE is a number, not a feeling. */}
      {plan && <ExpectedPath desk={desk} book={book} shadows={[...shadows.live, ...shadows.replay]} />}

      {teaching && <Key />}
    </section>
  );
}

/**
 * The expected path, from the shadow book's most similar cards.
 */
function ExpectedPath({ desk, book, shadows }: { desk: DeskPayload; book: SmcMasterBook; shadows: Parameters<typeof pathStats>[0] }) {
  void desk;
  const layer = refusingLayer(book);
  const stats = useMemo(
    () => pathStats(shadows, { symbol: book.symbol, side: book.side ?? undefined, reasonId: layer?.id }),
    [shadows, book.symbol, book.side, layer?.id],
  );
  if (!stats || !stats.decided) return null;
  const pctTxt = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(0)}%`);
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2 text-[11px]">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-[var(--color-fg)]">What a card like this usually does</span>
        <span className="text-[10px] text-[var(--color-subtle)]">
          {stats.scope} · n={stats.decided} filled of {stats.cards} cards
        </span>
      </div>
      <div className="tabular grid grid-cols-2 gap-x-3 gap-y-0.5 text-[var(--color-muted)] sm:grid-cols-4">
        <span>fills <b className="text-[var(--color-fg)]">{pctTxt(stats.fillRate)}</b>{stats.medianBarsToFill != null ? ` · ${stats.medianBarsToFill} bars` : ""}</span>
        <span>drawdown first <b className="text-[var(--color-warn)]">{stats.maeP50 != null ? `−${stats.maeP50.toFixed(2)}R` : "—"}</b>{stats.maeP90 != null ? ` (p90 −${stats.maeP90.toFixed(2)}R)` : ""}</span>
        <span>stop first <b className="text-[var(--color-down)]">{pctTxt(stats.stopFirst)}</b> · T1 <b className="text-[var(--color-up)]">{pctTxt(stats.t1Rate)}</b></span>
        <span>held <b className="text-[var(--color-fg)]">{stats.medianBarsHeld ?? "—"}</b> bars</span>
        <span>per fill <b className={stats.expPerFill != null && stats.expPerFill >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>{fmtR(stats.expPerFill)}</b></span>
        <span>per card <b className={stats.evPerCard != null && stats.evPerCard >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>{fmtR(stats.evPerCard)}</b> (unfilled = 0)</span>
        <span className="sm:col-span-2">chasing instead <b className={stats.chaseExp != null && stats.chaseExp >= 0 ? "text-[var(--color-up)]" : "text-[var(--color-down)]"}>{fmtR(stats.chaseExp)}</b>/t (n={stats.chaseN}) — you are paid to wait</span>
      </div>
      <p className="mt-1 text-[10px] leading-snug text-[var(--color-subtle)]">{managementLine()}</p>
    </div>
  );
}

/**
 * The confluence strip: one pill per sequence layer.
 *
 * Musts first, in sequence order, with their state; optional layers after,
 * dimmer. The detail is the tooltip so the strip stays one line — the
 * missing layer's detail is already printed in full under the chart.
 */
/**
 * The sequence as a numbered process rather than a scoreboard.
 *
 * On screen today the desk can show STAND · 3/9 and A+ · 0.87 within one
 * scroll and explain neither. Both are correct and they measure different
 * things — the grade is how well the MODEL fits, the word is how much of the
 * TRADE has printed — and this is where that gets said out loud.
 */
function SequenceWalkthrough({
  book,
  candidate,
}: {
  book: SmcMasterBook;
  candidate: SetupCandidate | undefined;
}) {
  // The engine numbers are the ones on the scanner card the trader is looking
  // at, passed in rather than re-derived so the reconciliation quotes the
  // figures actually on screen.
  const w = useMemo(
    () =>
      walkthrough(book, {
        score: candidate?.confluence ?? null,
        grade: candidate?.grade ?? null,
        model: candidate?.strategyPrimary ?? null,
      }),
    [book, candidate],
  );

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5">
      <header className="mb-2 flex items-baseline gap-2">
        <h4 className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
          The setup, step by step
        </h4>
        <span className="text-[11px] tabular-nums text-[var(--color-muted)]">
          {w.mustPass}/{w.mustNeed} musts
        </span>
        <span className="ml-auto text-[11px] font-semibold">{w.word}</span>
      </header>

      <ol className="mb-2 space-y-0.5">
        {w.steps.map((st) => (
          <li
            key={st.id}
            className={`flex items-start gap-2 rounded px-1.5 py-1 text-[11px] leading-snug ${
              st.current
                ? "border border-[color-mix(in_oklab,var(--color-warn)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-warn)_10%,transparent)]"
                : ""
            }`}
          >
            <span className="w-4 shrink-0 text-right tabular-nums text-[var(--color-muted)]">{st.n}</span>
            <span
              className={`w-3 shrink-0 ${
                st.status === "done"
                  ? "text-[var(--color-up)]"
                  : st.status === "failed"
                    ? "text-[var(--color-down)]"
                    : "text-[var(--color-warn)]"
              }`}
              aria-hidden
            >
              {st.status === "done" ? "✓" : st.status === "failed" ? "✕" : "○"}
            </span>
            <span className={st.status === "done" ? "text-[var(--color-muted)]" : ""}>
              <span className="font-medium">{st.label}</span>
              {!st.must && <span className="ml-1 text-[var(--color-muted)]">(optional)</span>}
              {st.detail && <span className="ml-1 text-[var(--color-muted)]">— {st.detail}</span>}
            </span>
          </li>
        ))}
      </ol>

      <p className="mb-1 text-[11px] font-medium leading-relaxed">{w.nextAction}</p>
      <p className="text-[11px] leading-relaxed text-[var(--color-muted)]">{w.reconcile}</p>
    </section>
  );
}

function LayerStrip({ layers }: { layers: SmcLayer[] }) {
  const musts = layers.filter((l) => l.must);
  const extras = layers.filter((l) => !l.must);
  return (
    <ol className="flex flex-wrap items-center gap-1" aria-label="Sequence layers">
      {musts.map((l) => (
        <LayerPill key={l.id} layer={l} />
      ))}
      {extras.length > 0 && <li aria-hidden className="mx-1 h-3 w-px bg-[var(--color-border)]" />}
      {extras.map((l) => (
        <LayerPill key={l.id} layer={l} soft />
      ))}
    </ol>
  );
}

function LayerPill({ layer, soft = false }: { layer: SmcLayer; soft?: boolean }) {
  const tone =
    layer.state === "pass"
      ? "text-[var(--color-up)] border-[color-mix(in_oklab,var(--color-up)_45%,transparent)]"
      : layer.state === "fail"
        ? "text-[var(--color-down)] border-[color-mix(in_oklab,var(--color-down)_45%,transparent)]"
        : "text-[var(--color-warn)] border-[color-mix(in_oklab,var(--color-warn)_45%,transparent)]";
  const mark = layer.state === "pass" ? "✓" : layer.state === "fail" ? "✕" : "○";
  return (
    <li
      title={layer.detail}
      className={`rounded-full border px-2 py-0.5 text-[10px] font-medium ${tone} ${soft ? "opacity-60" : ""}`}
    >
      <span aria-hidden>{mark} </span>
      {layer.label}
      {layer.price != null ? <span className="tabular text-[var(--color-muted)]"> {layer.price.toFixed(2)}</span> : null}
    </li>
  );
}

function Cell({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "primary" | "up" | "down" | "muted";
}) {
  const color =
    tone === "primary"
      ? "var(--color-primary)"
      : tone === "up"
        ? "var(--color-up)"
        : tone === "down"
          ? "var(--color-down)"
          : "var(--color-fg)";
  return (
    <div className="bg-[var(--color-surface)] px-3 py-2">
      <div className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">
        {label}
      </div>
      <div className="tabular text-sm font-semibold" style={{ color }}>
        {value}
      </div>
      {sub && <div className="tabular text-[9px] text-[var(--color-muted)]">{sub}</div>}
    </div>
  );
}

/**
 * The teaching layer.
 *
 * Collapsed by default and never auto-opened: a legend that is always visible
 * is clutter for the ~500th time you look at the chart, and clutter was the
 * original complaint. It explains what each mark MEANS rather than what it is
 * called, because the second is already on the chart.
 */
function Key() {
  const rows: { swatch: string; opacity: number; term: string; means: string }[] = [
    {
      swatch: "var(--color-down)",
      opacity: 1,
      term: "Red line — BSL (buy-side liquidity)",
      means:
        "Buy stops resting above a high: PDH, session high, equal highs, the range high. A raid through it is the fuel for a short. Solid = external (outside the range), dashed = internal. ✕ = already swept.",
    },
    {
      swatch: "var(--color-up)",
      opacity: 1,
      term: "Green line — SSL (sell-side liquidity)",
      means:
        "Sell stops below a low: PDL, session low, equal lows, range low. A raid through it is the fuel for a long.",
    },
    {
      swatch: "var(--color-up)",
      opacity: 0.9,
      term: "Long-dash green — DOL",
      means:
        "The draw on liquidity: where price is most likely headed, with how often that level was reached in past sessions. Off-screen, it becomes an arrow with the distance in points.",
    },
    {
      swatch: "var(--color-chart-3)",
      opacity: 0.25,
      term: "Boxes from a bar — PD arrays",
      means:
        "FVG (grey), IFVG (blue), order block / breaker (amber), each drawn from the bar that made it and extended right. Faded = partially filled or on the side against the book. These are where the retrace is expected to react.",
    },
    {
      swatch: "var(--color-primary)",
      opacity: 0.25,
      term: "Teal band — entry array",
      means:
        "The array the plan enters from. The dashed line through it is consequent encroachment, where a limit rests.",
    },
    {
      swatch: "var(--color-warn)",
      opacity: 1,
      term: "Amber ring — the raid · amber triangle — displacement",
      means:
        "The wick that took liquidity and closed back inside; the candle whose body is ≥ the displacement multiple of ATR. Everything else is only valid AFTER the raid: no raid, no sequence.",
    },
    {
      swatch: "var(--color-primary)",
      opacity: 1,
      term: "MSS ↑↓ · BOS ↑↓",
      means:
        "Market structure shift (teal) — the first break against the prior leg after a raid; break of structure (white) — continuation through a swing. Shown for the last two hours.",
    },
    {
      swatch: "var(--color-down)",
      opacity: 0.25,
      term: "Red band — risk · green band — reward",
      means:
        "Entry to stop, entry to T1. Compare the two band HEIGHTS — that ratio is your R, before you read any number.",
    },
    {
      swatch: "var(--color-subtle)",
      opacity: 1,
      term: "Red tint above EQ, green below",
      means:
        "The dealing range. Shorts belong in premium (upper half), longs in discount (lower half). Taking a long in the red tint is fighting the range.",
    },
    {
      swatch: "var(--color-up)",
      opacity: 0.6,
      term: "Frame flashes green / red",
      means:
        "Green: the desk printed TAKE. Red: the HTF bias flipped between polls, the one book switched, a news blackout started, or the tape shock breaker tripped — re-read before acting. Red wins.",
    },
  ];
  return (
    <dl className="flex flex-col gap-2 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-3">
      {rows.map((r) => (
        <div key={r.term} className="flex gap-2">
          <span
            aria-hidden
            className="mt-[3px] h-3 w-3 shrink-0 rounded-[3px]"
            style={{ background: r.swatch, opacity: r.opacity }}
          />
          <div>
            <dt className="text-[11px] font-medium text-[var(--color-fg)]">{r.term}</dt>
            <dd className="text-[11px] leading-snug text-[var(--color-muted)]">{r.means}</dd>
          </div>
        </div>
      ))}
      <p className="mt-1 border-t border-[var(--color-border)] pt-2 text-[10px] text-[var(--color-subtle)]">
        Drawn from the same objects the grade is computed from, so the picture
        and the verdict cannot disagree. Nothing here is generated or estimated —
        a level the tape has not produced is left off rather than guessed.
      </p>
    </dl>
  );
}
