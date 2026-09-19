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
 * ONE BOOK. `smcMaster.oneBook` is charted when the desk has settled on one,
 * because the house rule is one book per day and showing two charts invites
 * exactly the split attention the rule exists to prevent.
 */

import { useState } from "react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import type { SmcMasterBook } from "@/lib/trading/smc-master";
import { planRiskText } from "@/lib/trading/trade-plan";
import { HIGH_CONFLUENCE_THRESHOLD } from "@/lib/trading/scanner";
import { SetupChart } from "./setup-chart";

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
  const picked = pickBook(desk);
  if (!picked) return null;
  const { book, bars } = picked;
  const plan = book.plan;

  const candidate = desk.scan.candidates.find((c) => c.symbol === book.symbol);
  const hot =
    candidate != null && candidate.confluence >= HIGH_CONFLUENCE_THRESHOLD;

  return (
    <section
      className={`flex flex-col gap-2 ${hot && book.word !== "STAND" ? "flash-high-confluence rounded-[var(--radius-lg)]" : ""}`}
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold tracking-tight">The trade, drawn</h2>
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
              book.word === "TAKE"
                ? "bg-[color-mix(in_oklab,var(--color-up)_22%,transparent)] text-[var(--color-up)]"
                : book.word === "WAIT"
                  ? "bg-[color-mix(in_oklab,var(--color-warn)_22%,transparent)] text-[var(--color-warn)]"
                  : "bg-[var(--color-surface-3)] text-[var(--color-muted)]"
            }`}
          >
            {book.word}
          </span>
          {candidate && (
            <span className="tabular text-[10px] text-[var(--color-muted)]">
              Q {candidate.confluence.toFixed(2)}
              {candidate.pathBand ? ` · ${candidate.pathBand}` : ""}
            </span>
          )}
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

      <SetupChart
        bars={bars}
        plan={plan}
        word={book.word}
        emptyDetail={book.missingDetail || book.missing}
      />

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
      swatch: "var(--color-primary)",
      opacity: 0.25,
      term: "Teal band — entry array",
      means:
        "The FVG/IFVG/OB price has to come back into. The dashed line through it is consequent encroachment, where a limit rests.",
    },
    {
      swatch: "var(--color-warn)",
      opacity: 1,
      term: "Amber ring — the raid",
      means:
        "The wick that took liquidity and closed back inside. Everything else is only valid AFTER this: no raid, no sequence.",
    },
    {
      swatch: "var(--color-down)",
      opacity: 0.25,
      term: "Red band — risk",
      means:
        "Entry to stop. The stop sits beyond the raid wick because that is the price the market already proved it rejects.",
    },
    {
      swatch: "var(--color-up)",
      opacity: 0.22,
      term: "Green band — reward to T1",
      means:
        "Entry to the draw. Compare the two band HEIGHTS — that ratio is your R, before you read any number.",
    },
    {
      swatch: "var(--color-chart-3)",
      opacity: 0.25,
      term: "Grey / blue / amber blocks",
      means:
        "Other live PD arrays on the traded side — FVG, IFVG, order block. Faded ones are partially filled.",
    },
    {
      swatch: "var(--color-subtle)",
      opacity: 1,
      term: "Red tint above EQ, green below",
      means:
        "The dealing range. Shorts belong in premium (upper half), longs in discount (lower half). Taking a long in the red tint is fighting the range.",
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
        Drawn from the same object the grade is computed from, so the picture
        and the verdict cannot disagree. Nothing here is generated or estimated —
        a level the tape has not produced is left off rather than guessed.
      </p>
    </dl>
  );
}
