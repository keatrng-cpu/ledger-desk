/**
 * The timeframe ladder on the Now tab: fourteen rungs from the year to the
 * 30-second, read top-down, for both books.
 *
 * The server ships the ladder without its 30s rung (it has no prints); this
 * panel rebuilds each book's ladder client-side with the bars the quote poll
 * has accumulated, so the bottom rung is live during the session and reads
 * "no data" outside it. Every rung is a button: the hover title carries the
 * mechanism (structure + location vs the period open) so a colour never has
 * to be taken on faith.
 */

import { useMemo, useState } from "react";
import { barsFromPrints, printCount } from "@/lib/market/print-bars";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { buildTfLadder, TF_LABEL, type TfLadder, type TfRead } from "@/lib/trading/tf-ladder";

function tone(b: TfRead["bias"], src: TfRead["source"]): string {
  if (src === "none") return "border-[var(--color-border)] text-[var(--color-subtle)]";
  if (b === "bull") return "border-[color-mix(in_oklab,var(--color-up)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-up)_16%,transparent)] text-[var(--color-up)]";
  if (b === "bear") return "border-[color-mix(in_oklab,var(--color-down)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-down)_16%,transparent)] text-[var(--color-down)]";
  return "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]";
}

function Rungs({ ladder, group }: { ladder: TfLadder; group: TfRead[] }) {
  void ladder;
  return (
    <div className="flex items-center gap-1">
      {group.map((r) => (
        <span
          key={r.tf}
          title={`${r.tf}: ${r.bias} — ${r.why} · source ${r.source}`}
          className={`tabular rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[10px] font-semibold ${tone(r.bias, r.source)}`}
        >
          {TF_LABEL[r.tf]}
          <span aria-hidden className="ml-0.5">
            {r.source === "none" ? "·" : r.bias === "bull" ? "▲" : r.bias === "bear" ? "▼" : "·"}
          </span>
        </span>
      ))}
    </div>
  );
}

function Book({ ladder }: { ladder: TfLadder }) {
  const [open, setOpen] = useState(false);
  const htf = ladder.reads.slice(0, 4);
  const mtf = ladder.reads.slice(4, 7);
  const ltf = ladder.reads.slice(7);
  const dirTone =
    ladder.direction === "bull" ? "text-[var(--color-up)]" : ladder.direction === "bear" ? "text-[var(--color-down)]" : "text-[var(--color-muted)]";
  const phaseTone =
    ladder.phase === "reversal-forming" || ladder.phase === "expansion" || ladder.phase === "htf-retrace-ending"
      ? "text-[var(--color-up)]"
      : ladder.phase === "conflict"
        ? "text-[var(--color-down)]"
        : "text-[var(--color-warn)]";
  return (
    <div className="rounded-[var(--radius-md)] border border-[var(--color-border)] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold">{ladder.symbol}</span>
          <span className={`text-[11px] font-semibold uppercase ${dirTone}`}>
            {ladder.direction}
            {ladder.decidedBy ? <span className="ml-1 text-[9px] font-normal normal-case text-[var(--color-subtle)]">from the {ladder.decidedBy}</span> : null}
          </span>
          <span className={`text-[11px] ${phaseTone}`}>{ladder.phase.replace(/-/g, " ")}</span>
          <span className="tabular text-[10px] text-[var(--color-muted)]">align {(ladder.alignment * 100).toFixed(0)}%</span>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] text-[var(--color-muted)] hover:text-[var(--color-fg)]"
        >
          {open ? "Hide read" : "Top-down read"}
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Rungs ladder={ladder} group={htf} />
        <span className="text-[var(--color-subtle)]">|</span>
        <Rungs ladder={ladder} group={mtf} />
        <span className="text-[var(--color-subtle)]">|</span>
        <Rungs ladder={ladder} group={ltf} />
      </div>
      <div className="mt-2 grid gap-1 text-[11px] sm:grid-cols-2">
        <p className="text-[var(--color-muted)]">
          <span className="text-[var(--color-up)]">Longs:</span> {ladder.forLongs}
        </p>
        <p className="text-[var(--color-muted)]">
          <span className="text-[var(--color-down)]">Shorts:</span> {ladder.forShorts}
        </p>
      </div>
      {open && (
        <div className="mt-2 border-t border-[var(--color-border)] pt-2">
          <p className="text-[11px] leading-snug text-[var(--color-fg)]">{ladder.summary}</p>
          <ul className="mt-2 grid gap-0.5 text-[10px] text-[var(--color-muted)] sm:grid-cols-2">
            {ladder.reads.map((r) => (
              <li key={r.tf} className="tabular">
                <span className="inline-block w-8 font-semibold text-[var(--color-fg)]">{r.tf}</span>
                <span className={r.bias === "bull" ? "text-[var(--color-up)]" : r.bias === "bear" ? "text-[var(--color-down)]" : ""}>{r.bias}</span> · {r.why}
                {r.source === "prints" ? " · from prints" : r.source === "none" ? "" : ` · ${r.source}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TfLadderPanel({ desk }: { desk: DeskPayload }) {
  // Rebuild with the client's prints so the 30s rung is live; everything
  // else is identical to the server's read (same bars, same function).
  const ladders = useMemo(() => {
    const now = Date.now();
    const mk = (side: "left" | "right") => {
      const series = desk[side];
      const s30 = barsFromPrints(series.symbol, 30_000);
      return buildTfLadder({
        symbol: series.symbol,
        daily: desk.mtf?.[side].daily ?? [],
        m15: series.bars,
        m1: desk.mtf?.[side].minute ?? [],
        s30,
        nowMs: now,
        engineTopDown: desk.bias[side].topDown,
      });
    };
    return { left: mk("left"), right: mk("right") };
    // printCount changes with every quote; include it so the 30s rung refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desk, printCount(desk.left.symbol), printCount(desk.right.symbol)]);

  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Top-down — every timeframe, in sync</h2>
        <span className="text-[10px] text-[var(--color-subtle)]">
          Y·M·W·D set direction · 4H·1H·30 the phase · 15…30s the timing · 30s from this tab's prints
        </span>
      </header>
      <div className="grid gap-2 lg:grid-cols-2">
        <Book ladder={ladders.left} />
        <Book ladder={ladders.right} />
      </div>
    </section>
  );
}
