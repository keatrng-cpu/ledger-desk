/**
 * The canon, rendered: who says what, and how sure we are.
 *
 * Collapsed by default. The desk's rule is the thing to train on; the
 * sources are context for the trader who wants to know where a rule came
 * from and whether the people who popularised it agree with each other. An
 * always-open block of quotations under every module is the essay this tab
 * was pruned of.
 *
 * Status is a badge, not a footnote. "verified" and "unverified" must read
 * differently at a glance, because the trader will meet the unverified
 * claims in the wild presented as gospel.
 */

import { useState } from "react";
import type { CanonBlock, CanonClaim, CanonStatus } from "@/lib/learn/canon";

function statusStyle(s: CanonStatus): { label: string; color: string; bg: string } {
  switch (s) {
    case "verified":
      return { label: "verified", color: "var(--color-up)", bg: "color-mix(in oklab, var(--color-up) 14%, transparent)" };
    case "paraphrase":
      return { label: "paraphrase", color: "var(--color-chart-2)", bg: "color-mix(in oklab, var(--color-chart-2) 14%, transparent)" };
    case "contested":
      return { label: "contested", color: "var(--color-warn)", bg: "color-mix(in oklab, var(--color-warn) 14%, transparent)" };
    default:
      return { label: "unverified", color: "var(--color-down)", bg: "color-mix(in oklab, var(--color-down) 12%, transparent)" };
  }
}

function whoColor(who: CanonClaim["who"]): string {
  switch (who) {
    case "ICT":
      return "var(--color-primary)";
    case "TJR":
      return "var(--color-chart-4)";
    case "PB":
      return "var(--color-chart-2)";
    case "Evidence":
      return "var(--color-fg)";
    default:
      return "var(--color-muted)";
  }
}

export function CanonBox({ block }: { block: CanonBlock }) {
  const [open, setOpen] = useState(false);
  const verified = block.claims.filter((c) => c.status === "verified").length;
  const unverified = block.claims.filter((c) => c.status === "unverified").length;

  return (
    <section className="rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)]">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--color-subtle)]">
          Canon · what the sources say
        </span>
        <span className="tabular text-[10px] text-[var(--color-muted)]">
          {block.claims.length} claims · {verified} verified
          {unverified ? ` · ${unverified} unverified` : ""} · {open ? "hide" : "show"}
        </span>
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-[var(--color-border)] px-3 py-2">
          <ul className="flex flex-col gap-1.5">
            {block.claims.map((c, i) => {
              const st = statusStyle(c.status);
              return (
                <li key={i} className="grid grid-cols-[2.6rem_minmax(0,1fr)_auto] items-start gap-2 text-[12px] leading-snug">
                  <span className="pt-0.5 text-[10px] font-semibold" style={{ color: whoColor(c.who) }}>
                    {c.who}
                  </span>
                  <span className="text-[var(--color-fg)]">
                    {c.says}
                    {c.ref && <span className="text-[var(--color-subtle)]"> — {c.ref}</span>}
                  </span>
                  <span
                    className="mt-0.5 rounded-full px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide"
                    style={{ color: st.color, background: st.bg }}
                  >
                    {st.label}
                  </span>
                </li>
              );
            })}
          </ul>

          {block.consensus && (
            <p className="text-[12px] leading-snug text-[var(--color-muted)]">
              <span className="font-semibold text-[var(--color-fg)]">Agree: </span>
              {block.consensus}
            </p>
          )}
          {block.conflict && (
            <p className="text-[12px] leading-snug text-[var(--color-muted)]">
              <span className="font-semibold text-[var(--color-warn)]">Disagree: </span>
              {block.conflict}
            </p>
          )}
          <p className="border-t border-[var(--color-border)] pt-2 text-[12px] leading-snug text-[var(--color-muted)]">
            <span className="font-semibold text-[var(--color-fg)]">Evidence: </span>
            {block.evidence}
          </p>
        </div>
      )}
    </section>
  );
}
