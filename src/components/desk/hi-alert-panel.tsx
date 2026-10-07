import { useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { ledgerExport, ledgerStats, loadHiAlerts, type LedgerRow } from "@/lib/trading/hi-alert";
import { onBeat } from "@/lib/live/keep-live";

const CALL_TEXT: Record<LedgerRow["call"], string> = {
  right: "passing was right",
  cost: "passing cost",
  paid: "taking it paid",
  lost: "taking it lost",
  open: "still being graded",
};
const CALL_TONE: Record<LedgerRow["call"], string> = {
  right: "text-[var(--color-up)]",
  cost: "text-[var(--color-down)]",
  paid: "text-[var(--color-up)]",
  lost: "text-[var(--color-down)]",
  open: "text-[var(--color-muted)]",
};

/**
 * The high-alert ledger (hi-alert.ts): every card at fit 0.90 or higher, taken or not, with why and how the chart graded it.
 * The Floor's five read these as lessons. Copy or download the JSON and paste it into the lab (brainlab, "High-alert ledger"), which indexes
 * the graded ones for similarity search. Nothing here gates or sizes anything.
 */
export function HiAlertPanel() {
  const [tick, setTick] = useState(0);
  const [copied, setCopied] = useState<"" | "copied" | "failed">("");
  // The ledger is written by the desk loop (also with the tab hidden); this refreshes the view every 15 s.
  useEffect(() => onBeat(() => setTick((n) => n + 1), 15), []);
  const list = useMemo(() => loadHiAlerts(), [tick]);
  const rows = useMemo(() => ledgerExport(list), [list]);
  const stats = useMemo(() => ledgerStats(list), [list]);

  const json = () => JSON.stringify(rows, null, 2);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json());
      setCopied("copied");
    } catch {
      setCopied("failed");
    }
    window.setTimeout(() => setCopied(""), 2500);
  };
  const download = () => {
    try {
      const url = URL.createObjectURL(new Blob([json()], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `hi-alert-ledger-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setCopied("failed");
    }
  };

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3 sm:p-4" aria-label="High-alert ledger">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-fg)]">High-alert ledger · fit 0.90 and up</h3>
        <div className="flex gap-2">
          <button type="button" onClick={copy} disabled={!rows.length} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] disabled:opacity-40">
            {copied === "copied" ? "Copied" : copied === "failed" ? "Copy failed" : "Copy JSON"}
          </button>
          <button type="button" onClick={download} disabled={!rows.length} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2 py-1 text-[11px] text-[var(--color-fg)] disabled:opacity-40">
            Download
          </button>
        </div>
      </div>
      <p className="mt-1 text-[12px] leading-snug text-[var(--color-muted)]">
        {stats.n === 0
          ? "No card has reached 0.90 on this browser yet. Each one is kept here whether or not it is taken, with why, and graded on the chart."
          : `${stats.n} kept · passed right ${stats.passedRight}, passing cost ${stats.passedCost} · taken: paid ${stats.paid}, lost ${stats.lost}. ${stats.note}`}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-[var(--color-subtle)]">
        Kept in this browser only. It fills while a desk tab is open (a hidden Chrome tab counts). A high fit is not a high win rate: Q 0.85+ went the card's way less often than 0.65–0.70 over four years.
      </p>
      <ul className="mt-2 space-y-1.5">
        {rows.slice(0, 12).map((r) => (
          <li key={r.id} className="rounded-[var(--radius-sm)] border border-[var(--color-border)] px-2.5 py-1.5">
            <details>
              <summary className="cursor-pointer list-none text-[12px] leading-snug text-[var(--color-fg)]">
                <span className="font-mono text-[11px] text-[var(--color-muted)]">{r.day.slice(5)}</span> {r.sym} {r.side} · fit {r.fit.toFixed(2)} ·{" "}
                {r.taken === "no" ? "not taken" : r.taken === "paper" ? "taken (paper)" : "limit rested"} ·{" "}
                <span className={cn("font-medium", CALL_TONE[r.call])}>{CALL_TEXT[r.call]}</span>
                {r.R != null ? <span className="font-mono text-[11px] text-[var(--color-muted)]"> · {r.R >= 0 ? "+" : "−"}{Math.abs(r.R).toFixed(2)}R</span> : null}
              </summary>
              <p className="mt-1 text-[12px] leading-snug text-[var(--color-fg)]">{r.lesson}</p>
              {r.why.length > 0 && (
                <ul className="mt-1 list-disc pl-4 text-[11px] leading-snug text-[var(--color-muted)]">
                  {r.why.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              )}
              {r.evidence.length > 0 && <p className="mt-1 text-[11px] leading-snug text-[var(--color-subtle)]">Four years: {r.evidence.join(" · ")}</p>}
            </details>
          </li>
        ))}
      </ul>
      {rows.length > 12 && <p className="mt-1 text-[11px] text-[var(--color-subtle)]">{rows.length - 12} older cards are in the JSON.</p>}
    </section>
  );
}
