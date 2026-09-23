/**
 * When the ladder disagrees with the engine — the loudest thing the desk
 * knows that it is not yet allowed to act on.
 *
 * WHAT WAS MEASURED (2026-09-22, seed rebuilt with the ladder stamped)
 * Splitting NY AM shadow cards on whether the timeframe ladder AGREED with
 * the trade's direction:
 *
 *     tf_dir = with      +0.08R per card   n=30
 *     tf_dir = against   −0.69R per card   n=13
 *
 * And the thing that makes it interesting: the GRADED alignment percentage
 * did not separate the same way (>=75% aligned ran −0.12R, 50–75% ran
 * +0.16R). So what carries information is the BINARY disagreement, not how
 * many rungs happen to agree. Degree is noise; direction is signal.
 *
 * WHY THIS IS NOT A GATE, AND MUST NOT BECOME ONE BY DRIFT
 * n=13 in the losing bucket. One in-sample pass, on a seed the same session
 * built. That is nowhere near enough to refuse a trade on, and the desk has
 * been burned by exactly this shape of number before — the "+0.35R resting
 * at CE" figure was real, pooled, and 58% London, and it took a killzone
 * split to catch it. So this file WARNS and SIZES DOWN. It never refuses.
 *
 * Note carefully what tf_dir=against even means: the engine's own HTF gate
 * PERMITTED the trade while the ladder, read from the year downward,
 * disagreed with it. Those are two different reads of direction disagreeing,
 * and the desk currently resolves that silently in the engine's favour. The
 * least this file can do is make the disagreement visible at the moment it
 * matters.
 *
 * THE COUNTER IS THE POINT
 * `conflictLedger` exists so the losing bucket grows from 13 toward a number
 * that could justify a gate. Until then the honest output is a warning, a
 * suggested smaller size, and an accurate statement of how thin the evidence
 * is. If someone later wants to gate on this, the route is
 * scripts/sweep-gates.mjs, never an edit here.
 */

import type { TfLadder, LadderBias } from "./tf-ladder";

/** The measured split, kept next to the code that cites it. */
export const LADDER_EVIDENCE = {
  withR: 0.08,
  withN: 30,
  againstR: -0.69,
  againstN: 13,
  window: "NY AM limit cards, shadow replay Jul–Aug 2026",
  caveat:
    "One in-sample pass on a seed built the same day. The losing bucket is n=13. Degree of alignment did NOT separate — only the binary disagreement did.",
} as const;

/** Below this many losing-bucket observations, nothing here can gate. */
export const GATE_N_REQUIRED = 40;

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
  line: string;
}

/**
 * Does the ladder agree with the side being considered?
 *
 * Returns a size SUGGESTION and a warning, never a verdict. A caller that
 * turns `conflict` into a refusal has overstepped what n=13 supports.
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
      line: `Ladder agrees with this ${side} (${dir} from ${decidedBy ?? "the top"}). Measured +${LADDER_EVIDENCE.withR}R/card on agreeing NY AM cards, n=${LADDER_EVIDENCE.withN} — a small positive, not a reason to size up.`,
    };
  }

  return {
    level: "conflict",
    ladderDirection: dir,
    decidedBy,
    // Half size. Chosen as the smallest meaningful reduction, because the
    // evidence supports "be careful" and nothing stronger.
    sizeMult: 0.5,
    warn: true,
    line:
      `LADDER DISAGREES. Read from ${decidedBy ?? "the top"} down the ladder is ${dir}, and this is a ${side}. ` +
      `The engine's HTF gate permitted this trade; the ladder does not. On NY AM shadow cards that disagreement ran ` +
      `${LADDER_EVIDENCE.againstR}R per card against +${LADDER_EVIDENCE.withR}R when they agreed — but n=${LADDER_EVIDENCE.againstN} in the losing bucket, ` +
      `one in-sample pass, so this is a WARNING and a suggested half size, NOT a refusal. Look again before you click.`,
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
  const gateable = againstN >= GATE_N_REQUIRED;

  return {
    withN,
    againstN,
    withExpR,
    againstExpR,
    needed,
    gateable,
    line: gateable
      ? `${againstN} disagreeing observations at ${againstExpR}R against ${withN} agreeing at ${withExpR >= 0 ? "+" : ""}${withExpR}R. This now clears the ${GATE_N_REQUIRED} floor — run scripts/sweep-gates.mjs to test it properly as a gate variant. Do not hand-edit a rule.`
      : `${againstN} disagreeing observations (${againstExpR}R) vs ${withN} agreeing (${withExpR >= 0 ? "+" : ""}${withExpR}R). ${needed} more disagreements needed before this could be argued as a gate. Until then it warns and halves size, nothing more.`,
  };
}
