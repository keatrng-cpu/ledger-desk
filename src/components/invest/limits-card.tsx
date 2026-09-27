/**
 * WHAT THIS TAB CAN AND CANNOT ANSWER — folded by default.
 *
 * It sat open between the rent line and the book, a wall of text above the
 * thing the trader came to check. The content is unchanged and one click
 * away; the summary line carries the part that matters most.
 */

import { BASE_RATES, HORIZON_EVIDENCE } from "@/lib/invest/factors";
import { evidenceSummary, STALENESS_TRAPS } from "@/lib/invest/evidence";
import { LINK, VERDICT_CLS } from "./format";

export function LimitsCard() {
  return (
    <details className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-1)] p-3">
      <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wide text-[var(--color-muted)]">
        What this tab can and cannot predict{" "}
        <span className="font-normal normal-case tracking-normal">
          — long horizon only; 58% of US stocks never beat T-bills over their lives
        </span>
      </summary>
      <div className="mt-2 space-y-1">
        {HORIZON_EVIDENCE.map((h) => (
          <p key={h.horizon} className="text-[11px] leading-relaxed">
            <span className={`mr-1.5 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${h.usable ? VERDICT_CLS.CORE : VERDICT_CLS.HOLD}`}>
              {h.horizon} · {h.window}
            </span>
            <span className="text-[var(--color-muted)]">{h.verdict}</span>
          </p>
        ))}
      </div>
      <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
        {BASE_RATES.map((b) => (
          <p key={b.id} className="text-[11px] leading-relaxed text-[var(--color-muted)]">
            <a href={b.url} target="_blank" rel="noopener noreferrer" className={LINK}>
              {b.source.split(",")[0]}
            </a>
            {" · "}
            {b.claim} <span className="text-[var(--color-warn)]">{b.soWhat}</span>
          </p>
        ))}
      </div>
      <div className="mt-2 space-y-1 border-t border-[var(--color-border)] pt-2">
        <p className="text-[11px] text-[var(--color-muted)]">{evidenceSummary().line}</p>
        {STALENESS_TRAPS.map((t) => (
          <p key={t.ticker} className="text-[11px] leading-relaxed text-[var(--color-muted)]">
            <span className="text-[var(--color-fg)]">{t.ticker} · </span>
            {t.lesson}{" "}
            <a href={t.url} target="_blank" rel="noopener noreferrer" className={LINK}>
              filing
            </a>
          </p>
        ))}
      </div>
    </details>
  );
}
