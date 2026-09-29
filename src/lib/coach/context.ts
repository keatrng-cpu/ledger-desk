/**
 * The bounded desk context sent to any model narrator — the manual "Ask Grok
 * + Claude" button (trading-coach.tsx) and the automatic Discuss checkpoints
 * (discuss-tab.tsx) build the SAME shape, so both read the same three
 * surfaces every time: Now (the best PATH candidate), Options (the overnight
 * board, inside the handoff snapshot), and Charts (the timeframe ladder,
 * also inside the snapshot). One function, so a future field never drifts
 * between the two callers.
 */

import type { DeskPayload } from "@/lib/trading/build-desk";
import { buildClaudeHandoff } from "@/lib/trading/claude-handoff";

/** Matches contextSchema's per-string cap in claude-server.ts — truncate here too so a longer reason line fails soft (cut) instead of hard (the whole call rejected). */
const REASON_MAX = 160;
const clip = (s: string) => (s.length > REASON_MAX ? `${s.slice(0, REASON_MAX - 1)}…` : s);

export function buildCoachContext(desk: DeskPayload, question: string | undefined) {
  const best = desk.scan.candidates[0];
  return {
    question,
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
    bestPresent: best?.reasons?.slice(0, 12).map(clip),
    bestMissing: best?.missing?.slice(0, 12).map(clip),
    actionableCount: desk.scan.candidates.filter((c) => c.actionable).length,
    blocked: desk.scan.blocked?.slice(0, 6),
    focus: desk.scan.focus ?? null,
    // Includes the OVERNIGHT (Options tab) and LADDER (Charts tab) sections,
    // not just the Now-tab candidate — see claude-handoff.ts.
    snapshot: buildClaudeHandoff(desk).slice(0, 8000),
  };
}
