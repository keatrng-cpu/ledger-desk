import { useMemo } from "react";
import { Bot, Sparkles } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";

/** Local deterministic coach — explains computed structure only. */
function buildCoachNotes(desk: DeskPayload): {
  posture: string;
  bullets: string[];
  action: string;
} {
  const { clock, bias, scan, risk } = desk;
  const actionable = scan.candidates.filter((c) => c.actionable);
  const best = scan.candidates[0];

  let posture = "Stand down";
  if (actionable.length) posture = "Hunt (selective)";
  else if (clock.inTradeWindow && best && best.grade === "B")
    posture = "Watchlist only";
  else if (!clock.inTradeWindow) posture = "Plan / journal";

  const bullets = [
    `Session: ${clock.killzoneLabel} — ${clock.sessionPhase}.`,
    `HTF: ${bias.left.symbol} ${bias.left.topDown} (${(bias.left.confidence * 100).toFixed(0)}%) · ${bias.right.symbol} ${bias.right.topDown} (${(bias.right.confidence * 100).toFixed(0)}%).`,
    scan.smt.note,
    best
      ? `Best raw idea: ${best.symbol} ${best.side} conf ${best.confluence} (${best.grade}). Missing: ${best.missing.slice(0, 3).join(", ") || "none"}.`
      : "No candidates scored.",
    `Risk slot: $${risk.riskDollars.toFixed(0)} (${(risk.riskPct * 100).toFixed(1)}%). At +1R bank 50% and BE stop — never average losers; never widen stop.`,
    bias.left.dealing
      ? `${bias.left.symbol} dealing ${bias.left.dealing.zone} — longs prefer discount, shorts premium.`
      : "Mark dealing range on both charts.",
  ];

  const action = actionable[0]
    ? `If price tags ${actionable[0].entryZone} with confirmation, plan ${actionable[0].symbol} ${actionable[0].side} risk $${risk.riskDollars.toFixed(0)}. Invalidate: ${actionable[0].invalidation}.`
    : "Do not force. Update levels, wait for HTF + killzone + sweep stack. Profitability is selectivity.";

  return { posture, bullets, action };
}

export function TradingCoach({ desk }: { desk: DeskPayload }) {
  const notes = useMemo(() => buildCoachNotes(desk), [desk]);

  return (
    <section className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_22%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              6 · Desk coach (Grok + Claude ready)
            </h2>
            <p className="text-xs text-[var(--color-subtle)]">
              Explains numbers already computed — never gates or invents fills
            </p>
          </div>
        </div>
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-[var(--color-primary)]">
          <Sparkles className="h-3 w-3" />
          {notes.posture}
        </span>
      </header>

      <ul className="mb-3 space-y-1.5 text-sm text-[var(--color-muted)]">
        {notes.bullets.map((b) => (
          <li key={b} className="flex gap-2">
            <span className="text-[var(--color-primary)]">•</span>
            {b}
          </li>
        ))}
      </ul>

      <div className="rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-3 py-2.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-subtle)]">
          Focus action
        </p>
        <p className="mt-1 text-sm text-[var(--color-fg)]">{notes.action}</p>
      </div>

      <p className="mt-3 text-[11px] text-[var(--color-subtle)]">
        Point Claude at keatrng-cpu/ledger-desk + Trading-Automation. Ask Grok
        here for debriefs — structure scores stay ground truth.
      </p>
    </section>
  );
}
