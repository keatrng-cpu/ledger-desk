/**
 * The timeframe ladder on the Now tab: the trader's twelve frames in four
 * tiers, read top-down from CLOSED candles, for both books.
 *
 * This renders the server's ladder as-is. It used to rebuild the ladder in
 * the browser with Date.now() to keep a 30-second rung live; under the
 * closed-candle rule that is a partial-data hazard — a 1m bar that was still
 * forming when the poll fetched it would be treated as closed once the
 * minute rolled over on the client. The server reads the ladder at poll time
 * with the right `now`; that is the read shown here.
 */

import { useState } from "react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { TF_LABEL, TIER_LABEL, type LadderTier, type TfLadder, type TfRead } from "@/lib/trading/tf-ladder";

function tone(b: TfRead["bias"], src: TfRead["source"]): string {
  if (src === "none") return "border-[var(--color-border)] text-[var(--color-subtle)]";
  if (b === "bull") return "border-[color-mix(in_oklab,var(--color-up)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-up)_16%,transparent)] text-[var(--color-up)]";
  if (b === "bear") return "border-[color-mix(in_oklab,var(--color-down)_55%,transparent)] bg-[color-mix(in_oklab,var(--color-down)_16%,transparent)] text-[var(--color-down)]";
  return "border-[var(--color-border)] bg-[var(--color-surface-2)] text-[var(--color-muted)]";
}

function Rungs({ group }: { group: TfRead[] }) {
  return (
    <div className="flex items-center gap-1">
      {group.map((r) => (
        <span
          key={r.tf}
          title={`${TF_LABEL[r.tf]}: ${r.bias} — ${r.why} · source ${r.source}`}
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

const TIERS: LadderTier[] = [1, 2, 3, 4];

function Book({ ladder }: { ladder: TfLadder }) {
  const [open, setOpen] = useState(false);
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
            {ladder.decidedBy ? (
              <span className="ml-1 text-[9px] font-normal normal-case text-[var(--color-subtle)]">from {TF_LABEL[ladder.decidedBy]}</span>
            ) : null}
          </span>
          <span className={`text-[11px] ${phaseTone}`}>{ladder.phase.replace(/-/g, " ")}</span>
          <span className="tabular text-[10px] text-[var(--color-muted)]">align {(ladder.alignment * 100).toFixed(0)}%</span>
          {ladder.ipda ? (
            <span
              className="tabular text-[10px] text-[var(--color-muted)]"
              title={`IPDA 20d ${ladder.ipda.low20.toFixed(2)}–${ladder.ipda.high20.toFixed(2)} · 40d ${ladder.ipda.low40.toFixed(2)}–${ladder.ipda.high40.toFixed(2)} · 60d ${ladder.ipda.low60.toFixed(2)}–${ladder.ipda.high60.toFixed(2)}`}
            >
              60d {(ladder.ipda.pct60 * 100).toFixed(0)}% · {ladder.ipda.zone}
            </span>
          ) : null}
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
        {TIERS.map((tier, i) => (
          <div key={tier} className="flex items-center gap-1">
            {i > 0 ? <span className="text-[var(--color-subtle)]">|</span> : null}
            <span className="text-[9px] uppercase tracking-wide text-[var(--color-subtle)]">{TIER_LABEL[tier]}</span>
            <Rungs group={ladder.reads.filter((r) => r.tier === tier)} />
          </div>
        ))}
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
                <span className="inline-block w-8 font-semibold text-[var(--color-fg)]">{TF_LABEL[r.tf]}</span>
                <span className={r.bias === "bull" ? "text-[var(--color-up)]" : r.bias === "bear" ? "text-[var(--color-down)]" : ""}>{r.bias}</span> · {r.why}
                {r.source === "none" ? "" : ` · ${r.source}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TfLadderPanel({ desk }: { desk: DeskPayload }) {
  const ladders = desk.ladder;
  if (!ladders) return null;
  return (
    <section className="flex flex-col gap-2">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-tight">Top-down — closed candles only</h2>
        <span className="text-[10px] text-[var(--color-subtle)]">
          Q·M·W·D bias · 4H·1H·30 range · 15·5 confirm · 3·2·1 trigger (timing only) — higher tier wins
        </span>
      </header>
      <div className="grid gap-2 lg:grid-cols-2">
        <Book ladder={ladders.left} />
        <Book ladder={ladders.right} />
      </div>
    </section>
  );
}
