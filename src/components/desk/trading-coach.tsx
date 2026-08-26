import { useCallback, useMemo, useState } from "react";
import { Bot, Loader2, Sparkles } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { askDeskCoach, type CoachNarration } from "@/lib/coach/claude-server";
import { buildClaudeHandoff } from "@/lib/trading/claude-handoff";
import { CopyClaudeHandoff } from "@/components/desk/copy-claude-handoff";
import { Button } from "@/components/ui/button";

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
  const [narration, setNarration] = useState<CoachNarration | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState("");

  /**
   * On demand only — this endpoint costs money per call, so it is never wired
   * to the 30s desk poll. Sends an explicit, bounded subset of desk state
   * (see claude-server.ts's contextSchema), never the whole payload.
   */
  const ask = useCallback(async () => {
    setAsking(true);
    try {
      const best = desk.scan.candidates[0];
      const res = await askDeskCoach({
        data: {
          question: question.trim() || undefined,
          killzone: desk.clock.killzoneLabel,
          sessionPhase: desk.clock.sessionPhase,
          htfLeft: `${desk.bias.left.symbol} ${desk.bias.left.topDown}`,
          htfRight: `${desk.bias.right.symbol} ${desk.bias.right.topDown}`,
          newsVerdict: desk.news.verdict,
          smtNote: desk.scan.smt.note,
          dealingZone: desk.bias.left.dealing?.zone ?? null,
          bestSymbol: best?.symbol ?? null,
          bestSide: best?.side ?? null,
          bestGrade: best?.grade ?? null,
          bestConfluence: best?.confluence ?? null,
          bestStrategy: best?.completeStrategy || best?.strategyPrimary || null,
          bestPresent: best?.reasons?.slice(0, 12),
          bestMissing: best?.missing?.slice(0, 12),
          actionableCount: desk.scan.candidates.filter((c) => c.actionable).length,
          blocked: desk.scan.blocked?.slice(0, 6),
          focus: desk.scan.focus ?? null,
          snapshot: buildClaudeHandoff(desk).slice(0, 8000),
        },
      });
      setNarration(res);
    } catch (e) {
      setNarration({
        configured: true,
        text: null,
        error: e instanceof Error ? e.message : "Narration failed",
        model: null,
      });
    } finally {
      setAsking(false);
    }
  }, [desk, question]);

  return (
    <section className="rounded-[var(--radius-md)] border border-[color-mix(in_oklab,var(--color-primary)_22%,var(--color-border))] bg-[var(--color-surface)] p-3 sm:p-4">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-[var(--radius-sm)] bg-[var(--color-primary-dim)] text-[var(--color-primary)]">
            <Bot className="h-4 w-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-fg)]">
              6 · Desk coach
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

      {/* Real Claude narration, on demand. Everything above this line is
          deterministic TypeScript and renders identically whether or not the
          model is configured. */}
      <div className="mt-3 border-t border-[var(--color-border)] pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !asking) void ask();
            }}
            placeholder="Ask about this setup (optional)…"
            className="min-w-0 flex-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-2)] px-2.5 py-1.5 text-xs text-[var(--color-fg)] focus:outline-none focus:ring-1 focus:ring-[var(--color-primary)]"
          />
          <Button size="sm" onClick={() => void ask()} disabled={asking}>
            {asking ? (
              <>
                <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                Thinking…
              </>
            ) : (
              "Ask Claude"
            )}
          </Button>
          <CopyClaudeHandoff desk={desk} />
        </div>

        {narration?.text && (
          <div className="mt-2 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-primary)_30%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] px-3 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-primary)]">
              Claude · narration only — not a signal
            </p>
            <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-fg)]">
              {narration.text}
            </p>
          </div>
        )}
        {narration?.error && (
          <p className="mt-2 text-xs text-[var(--color-warn)]">
            {narration.error}
          </p>
        )}
      </div>

      <p className="mt-3 text-[11px] text-[var(--color-subtle)]">
        Structure scores stay ground truth — narration explains them, never
        overrides them.
      </p>
    </section>
  );
}
