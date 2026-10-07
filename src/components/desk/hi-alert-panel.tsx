/**
 * The high-alert ledger on the Brain tab. The rows are the ones hi-alert.ts
 * already keeps. This panel does not grade and does not decide.
 */
import { useEffect, useState } from "react";
import { loadHiAlerts, type HiAlert } from "@/lib/trading/hi-alert";

function when(ms: number): string {
  const d = new Date(ms);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function row(h: HiAlert): string {
  const taken = h.taken === "no" ? "passed" : h.taken;
  const out = h.outcome ? `${h.outcome.status}${h.outcome.R != null ? ` ${h.outcome.R >= 0 ? "+" : ""}${h.outcome.R.toFixed(2)}R` : ""}` : "open";
  return `${h.day} ${h.sym} ${h.side} fit ${h.fit.toFixed(2)} ${taken} ${out}`;
}

export function HiAlertPanel() {
  const [rows, setRows] = useState<HiAlert[]>([]);
  useEffect(() => {
    const read = () => setRows([...loadHiAlerts()].reverse().slice(0, 24));
    read();
    const id = window.setInterval(read, 15_000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <section className="mb-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] p-2.5" aria-label="High alert ledger">
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--color-fg)]">0.90 ledger</h3>
      {rows.length === 0 ? (
        <p className="mt-1 text-[11px] text-[var(--color-subtle)]">No 0.90 card kept yet. The ledger fills while the desk is open, including a hidden tab.</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {rows.map((h) => (
            <li key={h.id} className="text-[11px] leading-snug text-[var(--color-fg)]">
              <span className="font-mono">{row(h)}</span>
              {h.why[0] ? <span className="block text-[var(--color-subtle)]">{h.why[0]}</span> : null}
              {h.why[1] ? <span className="block text-[var(--color-subtle)]">{h.why[1]}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-1 text-[10px] text-[var(--color-subtle)]">First seen {rows[0] ? when(rows[0].firstMs) : "—"}. Passing right is on the graded row.</p>
    </section>
  );
}
