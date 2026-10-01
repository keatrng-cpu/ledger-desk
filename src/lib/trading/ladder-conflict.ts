/**
 * When the ladder disagrees with the card — shown, never acted on.
 *
 * WHAT WAS MEASURED
 * 2026-09-22, shadow replay, NY AM only: agreeing cards +0.08R (n=30),
 * disagreeing −0.69R (n=13). That number drove a half-size suggestion.
 *
 * 2026-10-01, the four-year capture (scripts/measure-tf-tiers.mjs), with the
 * ladder rebuilt to the trader's tiers on CLOSED candles and read causally at
 * every card's decision bar, every card at or above 0.65, rule as coded:
 *
 *     Tier 1 with      −0.137R/card   n=1857   went the card's way 52.4%
 *     Tier 1 against   −0.139R/card   n=1617   went the card's way 45.5%
 *
 * The −0.69R did not replicate at 124 times the sample. Disagreeing cards
 * paid the same as agreeing ones, so the half size had no basis and is gone.
 * What DID hold is direction: four hours later, a card against Tier 1 had
 * moved its way 45.5% of the time vs 52.4% aligned — real, and the reason
 * this still warns. The desk's trade geometry (limit at CE, stop, T1/T2) just
 * does not turn that lean into R. Look again; the size is not changed.
 *
 * WHY THIS IS NOT A GATE
 * Under the decision rules fixed before that run, a veto needed "against" to
 * be NEGATIVE in both halves and worse than "with". It was neither. If that
 * ever changes, the route is scripts/sweep-gates.mjs, never an edit here.
 */

import type { TfLadder, LadderBias } from "./tf-ladder";

/** The measured split, kept next to the code that cites it. */
export const LADDER_EVIDENCE = {
  withR: -0.137,
  withN: 1857,
  againstR: -0.139,
  againstN: 1617,
  withDirHit: 52.4,
  againstDirHit: 45.5,
  window: "Four-year capture 2022-09 → 2026-08, every card ≥0.65 (scripts/measure-tf-tiers.mjs, 2026-10-01)",
  caveat:
    "Same R either way; only direction separated. Replaced the 2026-09-22 shadow read (−0.69R, n=13), which did not replicate.",
} as const;

/** Below this many losing-bucket observations, nothing here can gate. */
export const GATE_N_REQUIRED = 40;
/** How much worse (R/card) disagreeing cards must pay before a gate is arguable. */
export const SEPARATION_R = 0.1;

export type ConflictLevel = "agree" | "neutral" | "conflict";

export interface LadderConflict {
  level: ConflictLevel;
  /** Ladder direction as read from the top rung down. */
  ladderDirection: LadderBias;
  /** The rung that decided it — context for whether to care. */
  decidedBy: string | null;
  /** Suggested multiplier on normal risk. Never zero: this does not refuse. */
  sizeMult: number;
  /** True when the trade should simply be reconsidered by a human. */
  warn: boolean;
  /**
   * ONE line, for the card.
   *
   * `line` below is five sentences of reasoning, and the scanner printed it
   * in full on every card — the same paragraph twice when both books were
   * shorts against a bull ladder. A wall of identical red text is how a
   * warning gets tuned out. The short form is what the eye reads; the long
   * form stays one hover away.
   */
  headline: string;
  line: string;
}

/**
 * Does the ladder agree with the side being considered?
 *
 * Returns a warning, never a verdict, and no size change. A caller that
 * turns `conflict` into a refusal has overstepped what four years support.
 */
export function ladderConflict(
  ladder: TfLadder | null | undefined,
  side: "long" | "short",
): LadderConflict {
  if (!ladder) {
    return {
      level: "neutral",
      ladderDirection: "neutral",
      decidedBy: null,
      sizeMult: 1,
      warn: false,
      headline: "No ladder — no cross-check.",
      line: "No ladder available — no directional cross-check. Trade the engine's read.",
    };
  }

  const want: LadderBias = side === "long" ? "bull" : "bear";
  const dir = ladder.direction;
  const decidedBy = ladder.decidedBy ?? null;

  if (dir === "neutral") {
    return {
      level: "neutral",
      ladderDirection: dir,
      decidedBy,
      sizeMult: 1,
      warn: false,
      headline: `Ladder neutral from ${decidedBy ?? "the top"} — no cross-check.`,
      line: `Ladder is neutral from ${decidedBy ?? "the top"} down — it neither confirms nor contradicts this ${side}.`,
    };
  }

  if (dir === want) {
    return {
      level: "agree",
      ladderDirection: dir,
      decidedBy,
      sizeMult: 1,
      warn: false,
      headline: `Ladder agrees (${dir} from ${decidedBy ?? "the top"}).`,
      line: `Ladder agrees with this ${side} (${dir} from ${decidedBy ?? "the top"}). Over four years aligned cards moved their way ${LADDER_EVIDENCE.withDirHit}% of the time (n=${LADDER_EVIDENCE.withN}) but paid ${LADDER_EVIDENCE.withR}R/card, the same as disagreeing ones — not a reason to size up.`,
    };
  }

  return {
    level: "conflict",
    ladderDirection: dir,
    decidedBy,
    // No size change: over four years disagreeing cards paid the same R as
    // agreeing ones (see the file header). The warning is about direction.
    sizeMult: 1,
    warn: true,
    // The fact, the measurement, and the action. Everything else is in `line`.
    headline: `Ladder ${dir} from ${decidedBy ?? "the top"} vs this ${side}: went your way ${LADDER_EVIDENCE.againstDirHit}% vs ${LADDER_EVIDENCE.withDirHit}% aligned (n=${LADDER_EVIDENCE.againstN}). Look again.`,
    line:
      `LADDER DISAGREES. Read from ${decidedBy ?? "the top"} down Tier 1 is ${dir}, and this is a ${side}. ` +
      `The engine's HTF gate permitted this trade; the trader's top-down read does not. Over four years, cards against Tier 1 ` +
      `moved their way ${LADDER_EVIDENCE.againstDirHit}% of the time four hours later vs ${LADDER_EVIDENCE.withDirHit}% aligned (n=${LADDER_EVIDENCE.againstN}) — ` +
      `but paid ${LADDER_EVIDENCE.againstR}R/card vs ${LADDER_EVIDENCE.withR}R, the same. This is a WARNING to look again, NOT a refusal and not a size cut.`,
  };
}

export interface ConflictLedgerRow {
  /** Whether the ladder agreed at entry. */
  agreed: boolean;
  resultR: number;
}

export interface ConflictRead {
  withN: number;
  againstN: number;
  withExpR: number;
  againstExpR: number;
  /** How many more disagreeing observations before a gate could be argued. */
  needed: number;
  gateable: boolean;
  line: string;
}

/**
 * Accumulate live evidence toward the number that would justify a gate.
 * Seeded with the shadow measurement so the counter starts where the
 * knowledge does rather than at zero.
 */
export function conflictLedger(rows: ConflictLedgerRow[], seedWithShadow = true): ConflictRead {
  const withRows = rows.filter((r) => r.agreed);
  const againstRows = rows.filter((r) => !r.agreed);

  const withN = withRows.length + (seedWithShadow ? LADDER_EVIDENCE.withN : 0);
  const againstN = againstRows.length + (seedWithShadow ? LADDER_EVIDENCE.againstN : 0);

  const sum = (rs: ConflictLedgerRow[]) => rs.reduce((s, r) => s + r.resultR, 0);
  const withTotal = sum(withRows) + (seedWithShadow ? LADDER_EVIDENCE.withR * LADDER_EVIDENCE.withN : 0);
  const againstTotal =
    sum(againstRows) + (seedWithShadow ? LADDER_EVIDENCE.againstR * LADDER_EVIDENCE.againstN : 0);

  const withExpR = withN ? Math.round((withTotal / withN) * 100) / 100 : 0;
  const againstExpR = againstN ? Math.round((againstTotal / againstN) * 100) / 100 : 0;
  const needed = Math.max(0, GATE_N_REQUIRED - againstN);
  // Enough observations is not enough: the disagreeing side has to actually
  // pay worse. The four-year seed is past the floor and does not separate.
  const separates = againstExpR <= withExpR - SEPARATION_R;
  const gateable = againstN >= GATE_N_REQUIRED && separates;

  return {
    withN,
    againstN,
    withExpR,
    againstExpR,
    needed,
    gateable,
    line: gateable
      ? `${againstN} disagreeing observations at ${againstExpR}R against ${withN} agreeing at ${withExpR >= 0 ? "+" : ""}${withExpR}R — that now separates. Run scripts/sweep-gates.mjs to test it properly as a gate variant. Do not hand-edit a rule.`
      : needed > 0
        ? `${againstN} disagreeing observations (${againstExpR}R) vs ${withN} agreeing (${withExpR >= 0 ? "+" : ""}${withExpR}R). ${needed} more disagreements needed before this could be argued as a gate. Until then it warns, nothing more.`
        : `${againstN} disagreeing observations (${againstExpR}R) vs ${withN} agreeing (${withExpR >= 0 ? "+" : ""}${withExpR}R) — no separation in R. It warns on direction, nothing more.`,
  };
}
