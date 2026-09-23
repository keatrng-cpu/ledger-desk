/**
 * What the trader took that the desk refused — and who turned out to be right.
 *
 * THE FACT THIS FILE EXISTS TO CONFRONT
 * The SMC sequence fires almost never. Eighteen gate variants were swept on
 * a month of closed bars and produced ZERO takes (gate-tuning.ts), with
 * pd_half failing 75–80% of the time and ltf waiting 74%. In the same period
 * the trader placed four live trades and won all four.
 *
 * Both of those are true at once, and together they mean something the desk
 * has never written down: THE TRADER IS NOT TRADING THE SEQUENCE. They are
 * trading the direction board — draw, HTF, dealing range — and the sequence
 * is a quality filter currently tuned so tight it refuses everything,
 * including the winners.
 *
 * That is not necessarily wrong. A gate that refuses everything is correct
 * if everything it refuses loses, and the shadow book says that is broadly
 * what happens in NY AM (refused cards ran −0.181R resting, −0.040R chasing,
 * n=53). But four wins is four wins, and the desk currently has no way to
 * tell the difference between "the trader is overriding a good gate and got
 * lucky" and "the gate is mis-tuned and the trader is reading the tape
 * better than it does". This file is how that question becomes answerable.
 *
 * HOW IT IS DIFFERENT FROM THE SHADOW BOOK
 *   shadow-book.ts   — refusals PAPER-traded. Counterfactual. Large n, cheap,
 *                      but nobody actually took those trades.
 *   override-log.ts  — refusals REALLY traded. Tiny n, expensive, and the only
 *                      evidence that includes the trader's own judgement.
 *
 * They answer the same question from opposite directions, so `crossCheck`
 * reports when they DISAGREE — a layer the shadows call costing but the live
 * overrides call earning is the most informative row the desk can produce.
 *
 * WHAT IT WILL NOT DO
 * It does not open, size, or gate anything, and it never edits a rule. At
 * n=4 it refuses to draw a conclusion at all and says so — the same standard
 * applied to every other number here. Recording an override is not permission
 * to take one; it is the price of being allowed to learn from it.
 */

import { APLUS_FULL_SIZE_MIN_N } from "./profit-rules";

/** Minimum overrides on one layer before its row means anything. */
export const MIN_N_FOR_READ = 12;
/** The desk's own unlock bar, reused so one standard governs both. */
export const STRONG_N = APLUS_FULL_SIZE_MIN_N;

/** The sequence layers that can refuse a card. Mirrors smc-master. */
export type RefusingLayer =
  | "dol"
  | "sweep"
  | "pd_half"
  | "ltf"
  | "target"
  | "retrace"
  | "htf"
  | "judas"
  | "news"
  | "one_book";

export interface OverrideRecord {
  id: string;
  /** When the trade was taken. */
  at: string;
  symbol: string;
  side: "long" | "short";
  /** MNQ/ES futures, or the RH options sleeve. */
  book: "futures" | "options";
  /** Layers the sequence was missing at the moment of entry. The whole point. */
  missing: RefusingLayer[];
  /** What the desk said. Recorded so a later change of copy cannot rewrite it. */
  deskWord: "TAKE" | "STAND" | "WAIT" | "MANAGE";
  /** PATH grade at the time, if any. */
  grade: string | null;
  /** Realised result in R. Null while the trade is open. */
  resultR: number | null;
  /** Realised dollars, for the sleeve. */
  resultUsd: number | null;
  /** The trader's own reason, in their words, written BEFORE the outcome. */
  reason: string;
  /** Ladder direction agreed with the trade? From tf-ladder. */
  ladderAgreed: boolean | null;
}

export interface LayerRow {
  layer: RefusingLayer;
  n: number;
  wins: number;
  wr: number;
  /** Mean R across closed overrides on this layer. */
  expR: number;
  totalR: number;
  /** Only ever set once n clears the floor. */
  verdict: "override-pays" | "gate-was-right" | "neutral" | "too-early";
  line: string;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Per-layer scorecard. A layer appears once for every override in which it
 * was the (or a) missing must — so one trade that skipped two layers counts
 * toward both, which is correct: it is evidence about each.
 */
export function overrideScorecard(rows: OverrideRecord[]): LayerRow[] {
  const closed = rows.filter((r) => r.resultR != null);
  const byLayer = new Map<RefusingLayer, OverrideRecord[]>();
  for (const r of closed) {
    for (const l of r.missing) {
      if (!byLayer.has(l)) byLayer.set(l, []);
      byLayer.get(l)!.push(r);
    }
  }

  return [...byLayer.entries()]
    .map(([layer, rs]) => {
      const n = rs.length;
      const wins = rs.filter((r) => (r.resultR ?? 0) > 0).length;
      const totalR = round2(rs.reduce((s, r) => s + (r.resultR ?? 0), 0));
      const expR = round2(totalR / n);
      const wr = round2(wins / n);

      let verdict: LayerRow["verdict"];
      if (n < MIN_N_FOR_READ) verdict = "too-early";
      else if (expR > 0.15) verdict = "override-pays";
      else if (expR < -0.15) verdict = "gate-was-right";
      else verdict = "neutral";

      const line =
        verdict === "too-early"
          ? `${n} override${n === 1 ? "" : "s"} on ${layer} — below the ${MIN_N_FOR_READ} needed to read anything. Running ${expR >= 0 ? "+" : ""}${expR}R so far, which is a number, not evidence.`
          : verdict === "override-pays"
            ? `${n} overrides on ${layer} at ${Math.round(wr * 100)}% WR and ${expR >= 0 ? "+" : ""}${expR}R each. The gate refused these and the trader was right. Candidate for re-tuning via scripts/sweep-gates.mjs — never by hand.`
            : verdict === "gate-was-right"
              ? `${n} overrides on ${layer} at ${Math.round(wr * 100)}% WR and ${expR}R each. The gate was right and the override cost money. This layer should be obeyed.`
              : `${n} overrides on ${layer}, ${expR >= 0 ? "+" : ""}${expR}R each — indistinguishable from zero. No case either way yet.`;

      return { layer, n, wins, wr, expR, totalR, verdict, line };
    })
    .sort((a, b) => b.n - a.n);
}

export interface CrossCheck {
  layer: RefusingLayer;
  liveVerdict: LayerRow["verdict"];
  shadowVerdict: string;
  agree: boolean;
  line: string;
}

/**
 * Compare the live override read against the shadow book's read of the same
 * layer. Agreement is reassuring; DISAGREEMENT is the interesting case and
 * the reason both books exist.
 *
 * The shadow verdicts come from discretion-memory.ts, which speaks in
 * earning / costing / neutral / early. They are passed in rather than
 * imported so this file stays pure and testable.
 */
export function crossCheck(
  live: LayerRow[],
  shadow: Record<string, string>,
): CrossCheck[] {
  return live
    .filter((r) => r.verdict !== "too-early")
    .map((r) => {
      const s = shadow[r.layer] ?? "unknown";
      // The shadow book says "costing" when refusing the card cost money —
      // i.e. the trade would have worked. That is the same claim as
      // "override-pays" from the live side.
      const sameClaim =
        (r.verdict === "override-pays" && s === "costing") ||
        (r.verdict === "gate-was-right" && s === "earning") ||
        (r.verdict === "neutral" && s === "neutral");
      return {
        layer: r.layer,
        liveVerdict: r.verdict,
        shadowVerdict: s,
        agree: sameClaim,
        line: sameClaim
          ? `${r.layer}: live overrides and the shadow book agree (${r.verdict} / ${s}). Two independent reads, same answer — this is as close to evidence as the desk gets.`
          : `${r.layer}: live says ${r.verdict}, shadows say ${s}. THEY DISAGREE. The shadow book is bigger but counterfactual; the live log is real but tiny and contains the trader's judgement. Do not change a gate on this row — go look at the individual trades.`,
      };
    });
}

export interface OverrideSummary {
  total: number;
  closed: number;
  open: number;
  wins: number;
  totalR: number;
  /** The headline sentence for the Book tab. */
  line: string;
}

export function summarise(rows: OverrideRecord[]): OverrideSummary {
  const closed = rows.filter((r) => r.resultR != null);
  const wins = closed.filter((r) => (r.resultR ?? 0) > 0).length;
  const totalR = round2(closed.reduce((s, r) => s + (r.resultR ?? 0), 0));
  const line =
    closed.length === 0
      ? "No overrides logged. Every trade taken against a STAND should be recorded here with its missing layer and the reason, written before the outcome is known — otherwise the desk can never learn which of its gates are wrong."
      : closed.length < MIN_N_FOR_READ
        ? `${closed.length} closed override${closed.length === 1 ? "" : "s"}, ${wins} winner${wins === 1 ? "" : "s"}, ${totalR >= 0 ? "+" : ""}${totalR}R total. Far below the ${MIN_N_FOR_READ} needed to say anything about any layer. Four wins is four coin flips landing heads; keep logging.`
        : `${closed.length} closed overrides, ${Math.round((wins / closed.length) * 100)}% WR, ${totalR >= 0 ? "+" : ""}${totalR}R. Read the per-layer rows, not this number — the interesting question is WHICH gate was wrong, not whether overriding works on average.`;
  return { total: rows.length, closed: closed.length, open: rows.length - closed.length, wins, totalR, line };
}

/**
 * The prompt shown when the trader takes a trade the desk refused. The reason
 * is captured BEFORE the outcome on purpose: a reason written afterwards is a
 * story about a result, and stories about results are how a losing override
 * becomes "a good trade that didn't work out".
 */
export function overridePrompt(missing: RefusingLayer[], deskWord: string): string {
  if (!missing.length) return "";
  return [
    `The desk says ${deskWord}. You are taking it anyway.`,
    `Missing: ${missing.join(", ")}.`,
    `Write why NOW, in one line, before you know how it ends. This is logged either way and it is the only`,
    `input the desk has for telling a mis-tuned gate apart from a lucky streak.`,
  ].join(" ");
}
