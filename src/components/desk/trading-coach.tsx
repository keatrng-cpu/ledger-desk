import { useCallback, useMemo, useState } from "react";
import { Bot, Loader2, Sparkles } from "lucide-react";
import type { DeskPayload } from "@/lib/trading/build-desk";
import { askDeskCoach, type CoachNarration } from "@/lib/coach/claude-server";
import { buildClaudeHandoff } from "@/lib/trading/claude-handoff";
import { CopyClaudeHandoff } from "@/components/desk/copy-claude-handoff";
import { Button } from "@/components/ui/button";
import { sessionLive } from "@/lib/trading/sessions";

/** Local deterministic coach — explains computed structure only. */
function buildCoachNotes(desk: DeskPayload): {
  posture: string;
  bullets: string[];
  action: string;
} {
  const { clock, bias, scan, risk } = desk;
  const actionable = scan.candidates.filter((c) => c.actionable);
  const best = scan.candidates[0];
  // Posture comes from the SEQUENCE's word, not the scanner's `actionable`
  // flag: "Hunt" used to show on any actionable card while smc-master said
  // WAIT or STAND on the same book.
  const one = desk.smcMaster?.oneBook ?? null;

  let posture = "Stand down";
  if (one?.word === "TAKE") posture = "TAKE — rest the limit at CE";
  else if (one?.word === "WAIT") posture = `Wait — ${one.missing}`;
  else if (sessionLive(clock) && best && best.grade === "B")
    posture = "Watchlist only";
  else if (!sessionLive(clock)) posture = "Plan / journal";

  const bullets = [
    `Session: ${clock.killzoneLabel} — ${clock.sessionPhase}.`,
    `HTF: ${bias.left.symbol} ${bias.left.topDown} (${(bias.left.confidence * 100).toFixed(0)}%) · ${bias.right.symbol} ${bias.right.topDown} (${(bias.right.confidence * 100).toFixed(0)}%).`,
    scan.smt.note,
    best
      ? `Best raw idea: ${best.symbol} ${best.side} conf ${best.confluence} (${best.grade}). Missing: ${best.missing.slice(0, 3).join(", ") || "none"}.`
      : "No candidates scored.",
    `Risk slot: $${risk.riskDollars.toFixed(0)} (${(risk.riskPct * 100).toFixed(1)}%). At T1 (the draw) bank 50%, stop to BE, runner to T2 — never average losers; never widen stop.`,
    bias.left.dealing
      ? `${bias.left.symbol} dealing ${bias.left.dealing.zone} — longs prefer discount, shorts premium.`
      : "Mark dealing range on both charts.",
  ];

  const action = actionable[0]
    ? `Rest the limit at CE ${actionable[0].plan ? actionable[0].plan.entry.toFixed(2) : actionable[0].entryZone} — do not wait for "confirmation" and pay the print (1m confirmation entries measured and rejected). ${actionable[0].symbol} ${actionable[0].side}, stop ${actionable[0].invalidation}.`
    : "Do not force. Update levels, wait for HTF + killzone + sweep stack. Profitability is selectivity.";

  return { posture, bullets, action };
}

function VoiceCard({
  label,
  voice,
}: {
  label: string;
  voice: CoachNarration["voices"]["grok"];
}) {
  if (!voice) return null;
  return (
    <div className="min-w-0 flex-1 rounded-[var(--radius-sm)] border border-[color-mix(in_oklab,var(--color-primary)_30%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-primary)_6%,transparent)] px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-wider text-[var(--color-primary)]">
        {label} · narration only — not a signal
      </p>
      {voice.text ? (
        <p className="mt-1 whitespace-pre-wrap text-sm text-[var(--color-fg)]">
          {voice.text}
        </p>
      ) : (
        <p className="mt-1 text-xs text-[var(--color-warn)]">
          {voice.error ?? "No text."}
        </p>
      )}
    </div>
  );
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
        voices: { grok: null, claude: null },
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
            <p className="mt-0.5 text-[10px] uppercase tracking-wide text-[var(--color-muted)]">
              XAI {desk.coach?.xai ? "ACTIVE" : "MISSING"} · Anthropic{" "}
              {desk.coach?.anthropic ? "ACTIVE" : "MISSING"} · peers
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

      {/* Dual peer narration, on demand. Everything above this line is
          deterministic TypeScript and renders identically whether or not
          a model is configured. */}
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
                Both thinking…
              </>
            ) : (
              "Ask Grok + Claude"
            )}
          </Button>
          <CopyClaudeHandoff desk={desk} />
        </div>

        {(narration?.voices.grok || narration?.voices.claude) && (
          <div className="mt-2 flex flex-col gap-2 sm:flex-row">
            <VoiceCard label="Grok" voice={narration.voices.grok} />
            <VoiceCard label="Claude" voice={narration.voices.claude} />
          </div>
        )}
        {narration?.error && !narration.voices.grok && !narration.voices.claude && (
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
