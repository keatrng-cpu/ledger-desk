/**
 * What this shape of setup has done before, and why it worked or did not.
 *
 * THE ASK, AND THE TRAP INSIDE IT
 * "Remember these setups and whether they profited, with reasoning of why."
 * The first two thirds are bookkeeping. The last third is where these systems
 * usually go wrong, because the obvious implementation is to let someone
 * write a sentence after the trade closes — and a reason written after the
 * outcome is known is not a reason, it is a story about a result. Winners
 * collect flattering explanations, losers collect "good trade, bad luck", and
 * after fifty trades the memory is a mood board.
 *
 * SO THE WHY IS DERIVED, NOT WRITTEN
 * Every setup is recorded with what the desk EXPECTED before the click — the
 * entry it named, the invalidation, T1, T2, and the reach odds it quoted —
 * and then with what the tape actually PRINTED. The attribution falls out of
 * the difference between those two, mechanically:
 *
 *   never_filled       price never reached the entry. Nothing is known about
 *                      whether the read was right; what is known is the ENTRY
 *                      was too far from the tape.
 *   stopped            filled, then the invalidation printed. The read or the
 *                      stop placement was wrong — and which one is answerable
 *                      by whether the draw eventually traded.
 *   target_missed      filled, went the right way, never reached T1, closed
 *                      out on time or session end. The TARGET was too far.
 *   t1_only            T1 printed, the runner died before T2. T2 was too far,
 *                      and runnerWorthIt (target-odds.ts) says whether holding
 *                      it was even the right call on the odds.
 *   full               T2 printed. The whole plan was right.
 *
 * Those five are different failures with different fixes, and none of them
 * requires anyone to be honest with themselves at the moment of maximum
 * incentive not to be. A free-text note is still accepted, but it is stored
 * beside the derived attribution rather than instead of it, and the store
 * records whether it was written BEFORE the outcome was known.
 *
 * WHAT A "SHAPE" IS
 * Setups are grouped by fingerprint — the model, the side, the killzone, the
 * draw kind, which must-layers were missing, and the reach tier. Two trades
 * with the same fingerprint are the same KIND of trade even at different
 * prices on different days, which is what makes the memory able to say "this
 * shape has run 11 times and lost on 8 of them".
 *
 * AND IT REFUSES TO CONCLUDE EARLY
 * Same standard as everywhere else on this desk: below MIN_N a shape reports
 * its record and explicitly declines to draw a lesson from it. The trader has
 * four live trades. Four is not a pattern.
 */

import type { SmcMasterBook } from "./smc-master";
import type { TradePlan } from "./trade-plan";

/** Occurrences of one shape before its record means anything. */
export const MIN_N_FOR_LESSON = 8;

export type Attribution = "never_filled" | "stopped" | "target_missed" | "t1_only" | "full";

export interface SetupExpectation {
  /** Everything the desk claimed BEFORE the click. */
  entry: number;
  stop: number;
  t1: number | null;
  t2: number | null;
  rr1: number | null;
  /** Reach odds quoted at the time, so a bad call can be traced to bad odds. */
  reachT1: number | null;
  reachT2: number | null;
  /** Expected R the desk printed, if target-odds had priced it. */
  expR: number | null;
}

export interface SetupOutcome {
  filled: boolean;
  /** Furthest favourable and adverse excursion, in points from entry. */
  mfePts: number;
  maePts: number;
  hitT1: boolean;
  hitT2: boolean;
  hitStop: boolean;
  resultR: number;
  /** Did the named draw eventually trade, even after the stop? */
  drawTradedLater: boolean | null;
}

export interface SetupRecord {
  id: string;
  at: string;
  symbol: string;
  side: "long" | "short";
  /** The shape key. Two records with the same one are the same kind of trade. */
  fingerprint: string;
  /** Human-readable version of the fingerprint, for the panel. */
  shape: string;
  model: string | null;
  killzone: string | null;
  word: SmcMasterBook["word"];
  missingAtEntry: string[];
  expectation: SetupExpectation;
  outcome: SetupOutcome | null;
  /** Free text. Stored, never trusted over the derived attribution. */
  note: string | null;
  /** True only when the note was captured before the outcome was known. */
  notePreRegistered: boolean;
}

/**
 * The shape key. Deliberately coarse: price, date and exact levels are
 * excluded so that the same KIND of trade groups together across sessions.
 */
export function fingerprint(input: {
  model: string | null;
  side: "long" | "short";
  killzone: string | null;
  drawKind: string | null;
  missing: string[];
  reachTier: string | null;
}): string {
  const missing = [...input.missing].sort().join("+") || "none";
  return [
    input.model ?? "nomodel",
    input.side,
    input.killzone ?? "nokz",
    input.drawKind ?? "nodraw",
    input.reachTier ?? "noreach",
    `miss:${missing}`,
  ].join("|");
}

export function shapeLabel(input: {
  model: string | null;
  side: "long" | "short";
  killzone: string | null;
  drawKind: string | null;
  missing: string[];
}): string {
  const miss = input.missing.length ? `missing ${input.missing.join(", ")}` : "sequence complete";
  return `${input.model ?? "no model"} ${input.side} in ${input.killzone ?? "no killzone"} to ${input.drawKind ?? "no draw"}, ${miss}`;
}

export interface Attributed {
  attribution: Attribution;
  /** The derived lesson — what to change, not how it felt. */
  lesson: string;
}

/**
 * The mechanical why. Takes what was expected and what printed; returns the
 * bucket and the specific thing that was wrong.
 */
export function attribute(exp: SetupExpectation, out: SetupOutcome, side: "long" | "short"): Attributed {
  if (!out.filled) {
    return {
      attribution: "never_filled",
      lesson:
        "Never filled. This says nothing about whether the read was right — it says the ENTRY was further from the tape than the tape was willing to travel. If this shape keeps not filling, the array is being priced too deep into the retrace, not the direction being wrong.",
    };
  }

  if (out.hitT2) {
    return {
      attribution: "full",
      lesson: "Reached T2. Entry, invalidation and both targets were all priced correctly.",
    };
  }

  if (out.hitT1) {
    return {
      attribution: "t1_only",
      lesson:
        exp.t2 != null
          ? `T1 printed, T2 did not. The runner was worth ${exp.reachT2 != null ? `${Math.round(exp.reachT2 * 100)}% at the time` : "unpriced odds"} — check runnerWorthIt before assuming holding it was the mistake. If p(T2|T1) x rr2 was below rr1, taking it all at T1 was the correct call and the runner was the error, not the target.`
          : "T1 printed with no T2 named. Nothing to learn about the runner.",
    };
  }

  if (out.hitStop) {
    return {
      attribution: "stopped",
      lesson:
        out.drawTradedLater === true
          ? "Stopped out, and then the draw traded anyway. The DIRECTION was right and the invalidation was too tight, or the entry was too early in the retrace. This is the expensive failure to fix because the read was already correct."
          : out.drawTradedLater === false
            ? "Stopped out and the draw never traded. The READ was wrong — the stop did its job. Nothing to fix in the entry or the target; the setup should not have been taken."
            : "Stopped out; whether the draw traded later was not recorded. Record it — it is the only thing that separates a wrong read from a tight stop.",
    };
  }

  return {
    attribution: "target_missed",
    lesson: `Filled, went the right way by ${out.mfePts.toFixed(1)} points, never reached T1${
      exp.rr1 != null ? ` at ${exp.rr1.toFixed(2)}R` : ""
    }, and closed without the stop. The TARGET was too far for the session. This is the failure that target-odds.ts exists to predict — check what reach the desk quoted against what it actually got.`,
  };
}

export interface ShapeRecord {
  fingerprint: string;
  shape: string;
  n: number;
  wins: number;
  wr: number;
  expR: number;
  /** How the failures break down — the useful part. */
  byAttribution: Record<Attribution, number>;
  /** Only set once n clears the floor. */
  lesson: string | null;
  line: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Group closed records by shape and report each one's record. */
export function recallShapes(records: SetupRecord[]): ShapeRecord[] {
  const closed = records.filter((r) => r.outcome != null);
  const byFp = new Map<string, SetupRecord[]>();
  for (const r of closed) {
    if (!byFp.has(r.fingerprint)) byFp.set(r.fingerprint, []);
    byFp.get(r.fingerprint)!.push(r);
  }

  return [...byFp.entries()]
    .map(([fp, rs]) => {
      const n = rs.length;
      const wins = rs.filter((r) => (r.outcome?.resultR ?? 0) > 0).length;
      const expR = round2(rs.reduce((s, r) => s + (r.outcome?.resultR ?? 0), 0) / n);
      const wr = round2(wins / n);

      const byAttribution = {
        never_filled: 0,
        stopped: 0,
        target_missed: 0,
        t1_only: 0,
        full: 0,
      } as Record<Attribution, number>;
      for (const r of rs) {
        if (!r.outcome) continue;
        byAttribution[attribute(r.expectation, r.outcome, r.side).attribution]++;
      }

      const dominant = (Object.entries(byAttribution) as [Attribution, number][])
        .filter(([, c]) => c > 0)
        .sort((a, b) => b[1] - a[1])[0];

      const lesson =
        n < MIN_N_FOR_LESSON
          ? null
          : dominant && dominant[1] / n >= 0.5
            ? `${Math.round((dominant[1] / n) * 100)}% of this shape ends in ${dominant[0].replace("_", " ")} — that is the thing to fix, not the direction.`
            : "No single failure mode dominates this shape.";

      return {
        fingerprint: fp,
        shape: rs[0]!.shape,
        n,
        wins,
        wr,
        expR,
        byAttribution,
        lesson,
        line:
          n < MIN_N_FOR_LESSON
            ? `${n}x, ${wins} winner${wins === 1 ? "" : "s"}, ${expR >= 0 ? "+" : ""}${expR}R each. Below the ${MIN_N_FOR_LESSON} needed to call this a pattern — it is a record, not a lesson.`
            : `${n}x at ${Math.round(wr * 100)}% WR and ${expR >= 0 ? "+" : ""}${expR}R each. ${lesson}`,
      };
    })
    .sort((a, b) => b.n - a.n);
}

/**
 * What the desk should say when THIS setup appears and the shape has history.
 * Returns null when there is nothing honest to say, which is most of the time
 * early on and is the correct output rather than an encouraging one.
 */
export function recallFor(records: SetupRecord[], fp: string): string | null {
  const shape = recallShapes(records).find((s) => s.fingerprint === fp);
  if (!shape) return null;
  if (shape.n < MIN_N_FOR_LESSON) {
    return `This shape has run ${shape.n}x before (${shape.expR >= 0 ? "+" : ""}${shape.expR}R each). Too few to mean anything — shown so you know it is being counted.`;
  }
  return `SEEN BEFORE: ${shape.line}`;
}

/**
 * Build the expectation block from a live plan, so what gets remembered is
 * exactly what the desk claimed rather than a reconstruction.
 */
export function expectationFrom(
  plan: TradePlan,
  odds?: { reachT1: number | null; reachT2: number | null; expR: number | null },
): SetupExpectation {
  return {
    entry: plan.entry,
    stop: plan.stop,
    t1: plan.t1,
    t2: plan.t2,
    rr1: plan.rr1,
    reachT1: odds?.reachT1 ?? null,
    reachT2: odds?.reachT2 ?? null,
    expR: odds?.expR ?? null,
  };
}
