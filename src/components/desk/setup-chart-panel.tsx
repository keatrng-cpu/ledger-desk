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

import { useEffect, useMemo, useRef, useState } from "react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { SmcLayer, SmcMasterBook } from "@/lib/trading/smc-master";
import { planRiskText } from "@/lib/trading/trade-plan";
import { HIGH_CONFLUENCE_THRESHOLD } from "@/lib/trading/scanner";
import { buildChartOverlay } from "@/lib/trading/chart-overlay";
import { SetupChart, VISIBLE_BARS } from "./setup-chart";

/** How long a bias/side/book flip keeps the red flash up (ms). Three polls. */
const FLIP_FLASH_MS = 75_000;

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

interface Flip {
  reason: string;
  until: number;
}

/**
 * Detect a change between polls that the trader must see.
 *
 * Compared per poll (`desk.fetchedAt`), not per render, so a re-render from
 * a click cannot fire it. The first poll after mount has nothing to compare
 * against and never flashes — a fresh tab is not a flip.
 */
function useFlipDetector(desk: DeskPayload, book: SmcMasterBook, topDown: string): Flip | null {
  const prev = useRef<{ symbol: string; topDown: string; side: string | null; at: string } | null>(null);
  const [flip, setFlip] = useState<Flip | null>(null);

  useEffect(() => {
    const cur = { symbol: book.symbol, topDown, side: book.side, at: desk.fetchedAt };
    const p = prev.current;
    prev.current = cur;
    if (!p || p.at === cur.at) return;
    // Only the SAME symbol's read can flip. `smcMaster.oneBook` is a per-poll
    // ranking (rank word, then must-layers passed), so it can alternate
    // between books on a tie; comparing MNQ's bias to ES's would flash red on
    // nothing. The charted symbol moving is shown in the badge, not flashed.
    if (p.symbol !== cur.symbol) return;
    let reason: string | null = null;
    if (p.topDown !== cur.topDown) {
      reason = `${cur.symbol} HTF bias flipped ${p.topDown} → ${cur.topDown}`;
    } else if (p.side && cur.side && p.side !== cur.side) {
      reason = `${cur.symbol} book side flipped ${p.side} → ${cur.side}`;
    }
    if (reason) setFlip({ reason, until: Date.now() + FLIP_FLASH_MS });
  }, [desk.fetchedAt, book.symbol, book.side, topDown]);

  // Clear the flash when its window closes, without waiting for a poll.
  useEffect(() => {
    if (!flip) return;
    const ms = flip.until - Date.now();
    if (ms <= 0) {
      setFlip(null);
      return;
    }
    const id = window.setTimeout(() => setFlip(null), ms);
    return () => window.clearTimeout(id);
  }, [flip]);

  return flip;
}

export function SetupChartPanel({ desk }: { desk: DeskPayload }) {
  const [teaching, setTeaching] = useState(false);
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
  const flip = useFlipDetector(desk, book ?? desk.smcMaster.left, topDown);

  if (!book) return null;

  const candidate = desk.scan.candidates.find((c) => c.symbol === book.symbol);
  const hot = candidate != null && candidate.confluence >= HIGH_CONFLUENCE_THRESHOLD;

  // Red beats green: a TAKE on the bar the bias flipped is a TAKE to re-read.
  const warnReason = overlay?.warn.active ? overlay.warn.reason : flip ? flip.reason : null;
  const take = book.word === "TAKE";
  const frame = warnReason
    ? "flash-warn rounded-[var(--radius-lg)]"
    : take
      ? "flash-take rounded-[var(--radius-lg)]"
      : hot && book.word === "WAIT"
        ? "flash-high-confluence rounded-[var(--radius-lg)]"
        : "";

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

      {/* What entry still needs. The must-layers ARE the confluences; a pill
          per layer shows which have printed and which the desk is waiting on,
          so "STAND" is never a bare word. */}
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

      {plan && (
        <p className="tabular text-[10px] text-[var(--color-subtle)]">
          {planRiskText(plan)}
          {plan.draw
            ? ` · draw ${plan.draw.name} reached ${(plan.draw.reachProbability * 100).toFixed(0)}% of past sessions`
            : ""}
        </p>
      )}

      {teaching && <Key />}
    </section>
  );
}

/**
 * The confluence strip: one pill per sequence layer.
 *
 * Musts first, in sequence order, with their state; optional layers after,
 * dimmer. The detail is the tooltip so the strip stays one line — the
 * missing layer's detail is already printed in full under the chart.
 */
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
