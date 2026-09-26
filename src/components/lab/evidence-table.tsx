/**
 * Lab › Evidence — every bucket of the four-year pack, with both halves and
 * the verdict, so the numbers the card quotes can be checked in one place.
 *
 * Built by scripts/build-evidence-pack.mjs (rule as coded: limit at CE, 50%
 * at T1, BE, runner to T2, ties against). Weekday and half-hour cuts have no
 * mechanism behind them and are marked EXPLORATORY: at ~60 cuts, two or three
 * will clear the verdict bar by chance.
 */

import { useState } from "react";
import { EVIDENCE, evidenceHeadlines, type EvidenceBucket } from "@/lib/trading/evidence";
import { cn } from "@/lib/utils";

const SECTIONS: { key: keyof typeof EVIDENCE; title: string; exploratory?: boolean }[] = [
  { key: "q", title: "Fit score (Q)" },
  { key: "riskAtr", title: "Stop width (× ATR)" },
  { key: "inBand", title: "The 0.5–1.5 ATR band" },
  { key: "session", title: "Session" },
  { key: "event", title: "Tape events" },
  { key: "side", title: "Side" },
  { key: "sideDrift", title: "Side × 4-week drift" },
  { key: "word", title: "The desk's word" },
  { key: "musts", title: "Must-layers passing" },
  { key: "composite", title: "Pre-declared composites" },
  { key: "weekday", title: "Weekday", exploratory: true },
  { key: "etHalfHour", title: "Half-hour (ET)", exploratory: true },
];

const r = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(3)}`);

function Row({ b }: { b: EvidenceBucket }) {
  return (
    <tr className="border-t border-[var(--color-border)]">
      <td className="py-0.5 pr-2 text-[var(--color-fg)]">{b.label}</td>
      <td className="pr-2 text-right">{b.n}</td>
      <td
        className={cn(
          "pr-2 text-right",
          b.verdict === "negative" && "text-[var(--color-down)]",
          b.verdict === "positive" && "text-[var(--color-up)]",
        )}
      >
        {r(b.exp)}
      </td>
      <td className="pr-2 text-right text-[var(--color-subtle)]">
        {b.lo != null && b.hi != null ? `[${r(b.lo)}, ${r(b.hi)}]` : "—"}
      </td>
      <td className="pr-2 text-right">{r(b.isExp)}</td>
      <td className="pr-2 text-right">{r(b.oosExp)}</td>
      <td className="pr-2 text-right">{b.dirHit != null ? `${(b.dirHit * 100).toFixed(1)}%` : "—"}</td>
      <td className="text-[var(--color-muted)]">{b.verdict}</td>
    </tr>
  );
}

export function EvidenceTable() {
  const [open, setOpen] = useState<string>("q");
  return (
    <section className="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3">
      <header className="mb-2">
        <h3 className="text-sm font-semibold text-[var(--color-fg)]">Evidence · four years of the desk&apos;s own cards</h3>
        <p className="text-[10px] text-[var(--color-subtle)]">
          {EVIDENCE.source.filled.toLocaleString()} filled plans · {EVIDENCE.source.tape} · R per card, before
          commission · 95% intervals clustered by day · a verdict needs both halves to agree AND the interval to
          clear zero.
        </p>
      </header>
      <ul className="mb-2 space-y-0.5">
        {evidenceHeadlines().map((l) => (
          <li key={l} className="text-[11px] leading-snug text-[var(--color-fg)]">
            {l}
          </li>
        ))}
      </ul>
      <div className="mb-2 flex flex-wrap gap-1">
        {SECTIONS.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setOpen(s.key)}
            className={cn(
              "rounded-full border px-2 py-0.5 text-[10px]",
              open === s.key
                ? "border-[var(--color-primary)] text-[var(--color-fg)]"
                : "border-[var(--color-border)] text-[var(--color-muted)]",
            )}
          >
            {s.title}
            {s.exploratory ? " · exploratory" : ""}
          </button>
        ))}
      </div>
      {SECTIONS.filter((s) => s.key === open).map((s) => {
        const rows = (EVIDENCE[s.key] as EvidenceBucket[]).filter((b) => (s.key === "etHalfHour" ? b.n >= 30 : true));
        return (
          <div key={s.key} className="overflow-x-auto">
            {s.exploratory && (
              <p className="mb-1 text-[10px] text-[var(--color-warn)]">
                Exploratory — no mechanism behind this cut; treat any verdict here as a hypothesis.
              </p>
            )}
            <table className="w-full text-left font-mono text-[10.5px] text-[var(--color-muted)]">
              <thead className="text-[var(--color-subtle)]">
                <tr>
                  <th className="py-0.5 pr-2 font-medium">Bucket</th>
                  <th className="pr-2 text-right font-medium">n</th>
                  <th className="pr-2 text-right font-medium">R/card</th>
                  <th className="pr-2 text-right font-medium">95% CI</th>
                  <th className="pr-2 text-right font-medium">2022-24</th>
                  <th className="pr-2 text-right font-medium">2025-26</th>
                  <th className="pr-2 text-right font-medium">Dir</th>
                  <th className="font-medium">Verdict</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((b) => (
                  <Row key={b.key} b={b} />
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </section>
  );
}
