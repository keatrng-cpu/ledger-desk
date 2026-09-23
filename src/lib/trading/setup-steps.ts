/**
 * The setup, step by step, in the order the sequence actually runs.
 *
 * THE PROBLEM ON THE SCREEN
 * During the workhorse window the desk shows two verdicts that disagree and
 * never reconciles them. The HUD says STAND and "3/9". The chip row shows a
 * flat unordered grid of ticks and crosses. Then further down the same page
 * a card says A+ · 0.87 with a green bar and a Log live button. A trader
 * reading top to bottom sees "do not trade" and "best possible grade" within
 * one screen and has to work out which one to believe, at 09:35, with money
 * on the clock.
 *
 * Both are correct and they measure DIFFERENT THINGS:
 *   0.87 A+   is `strategy-grade` — how well this MODEL fits the tape right
 *             now, graded alone. CLAUDE.md is explicit that models are graded
 *             independently and must not be stack-required.
 *   STAND 3/9 is `smc-master` — how much of the SEQUENCE has printed. TAKE
 *             needs every must-layer, and it is the sequence, not the school,
 *             that authorises a live trade.
 *
 * So a 0.87 A+ at 3/9 means: the model is a great description of what is
 * happening, and the trade has not set up yet. That is not a contradiction,
 * it is the desk working. This file makes it say so out loud, in order, with
 * the one thing that has to happen next.
 *
 * WHY ORDER MATTERS AND A GRID DOES NOT
 * The chips render as a flat row, so a missing DOL looks exactly as
 * important as a missing optional SMT. But the sequence is causal: there is
 * no point watching for an LTF shift before a sweep has happened, and a
 * retrace cannot be judged before an array exists. Numbering them tells the
 * trader where they are in a process rather than which boxes are unticked,
 * and — this is the part that matters at 09:35 — which ones are still
 * REACHABLE today versus which have already failed for the session.
 *
 * This file computes nothing new. It re-presents `SmcMasterBook.layers`,
 * which is already ordered and already graded, and adds the one sentence
 * the grid cannot: what happens next.
 */

import type { SmcLayer, SmcMasterBook } from "./smc-master";

export type StepStatus =
  /** Printed. Done, and it stays done. */
  | "done"
  /** Not yet, and it still can today. This is the thing to watch. */
  | "waiting"
  /** Failed in a way waiting cannot fix — the session has to change. */
  | "failed"
  /** Not required. Nice to have, never a blocker. */
  | "optional";

export interface SetupStep {
  n: number;
  id: string;
  label: string;
  status: StepStatus;
  must: boolean;
  detail: string;
  /** True for the single step the trader should actually be watching. */
  current: boolean;
  price?: number;
}

export interface SetupWalkthrough {
  symbol: string;
  side: "long" | "short" | null;
  word: SmcMasterBook["word"];
  steps: SetupStep[];
  mustPass: number;
  mustNeed: number;
  /** The one thing that has to happen next, in tape terms. */
  nextAction: string;
  /** Plain reconciliation of the engine grade against the sequence. */
  reconcile: string;
  /** How far through the musts, 0–1, for a progress bar that means something. */
  progress: number;
}

function statusFor(l: SmcLayer): StepStatus {
  if (!l.must) return l.state === "pass" ? "done" : "optional";
  if (l.state === "pass") return "done";
  if (l.state === "fail") return "failed";
  return "waiting";
}

/**
 * Turn the graded layers into a numbered walkthrough.
 *
 * `engineScore` and `engineGrade` are the per-model numbers from the scanner
 * card — passed in rather than imported so this file has no opinion about
 * which model won, and so the reconciliation sentence can name the real
 * figures the trader is looking at.
 */
export function walkthrough(
  book: SmcMasterBook,
  engine?: { score: number | null; grade: string | null; model: string | null },
): SetupWalkthrough {
  const steps: SetupStep[] = book.layers.map((l, i) => ({
    n: i + 1,
    id: l.id,
    label: l.label,
    status: statusFor(l),
    must: l.must,
    detail: l.detail,
    current: false,
    price: l.price,
  }));

  // The step to watch is the FIRST must that is not done. Not the first
  // failure — a failed earlier layer that the session cannot repair is
  // information, but the thing to actually watch is the next gate in line.
  const currentIdx = steps.findIndex((s) => s.must && s.status !== "done");
  if (currentIdx >= 0) steps[currentIdx]!.current = true;

  const progress = book.mustNeed > 0 ? book.mustPass / book.mustNeed : 0;
  const cur = currentIdx >= 0 ? steps[currentIdx]! : null;

  const nextAction =
    book.word === "TAKE"
      ? "Sequence complete. The next action is the entry, at the price already named — not a better one."
      : cur == null
        ? "No must-layer is outstanding, but the word is not TAKE. Read the layers directly rather than trusting this line."
        : cur.status === "failed"
          ? `Step ${cur.n} — ${cur.label} — has FAILED for this session: ${cur.detail} Waiting will not fix it. This setup needs the tape to change, not the clock.`
          : `Step ${cur.n} of ${steps.length} — ${cur.label}. ${cur.detail} Nothing before this matters; nothing after it can be judged yet.`;

  const failedMusts = steps.filter((s) => s.must && s.status === "failed").length;

  const reconcile =
    engine?.score == null
      ? `${book.mustPass} of ${book.mustNeed} must-layers printed.`
      : book.word === "TAKE"
        ? `Engine ${engine.grade ?? ""} ${engine.score.toFixed(2)} on ${engine.model ?? "the model"} AND the sequence is complete. Both agree.`
        : `Engine says ${engine.grade ?? ""} ${engine.score.toFixed(2)} — that is how well ${engine.model ?? "the model"} FITS the tape, graded alone. The sequence says ${book.word} at ${book.mustPass}/${book.mustNeed} — that is how much of the TRADE has printed. They are not in conflict: the model is a good description of what is happening and the trade has not set up yet. The sequence authorises the entry, never the grade.` +
          (failedMusts > 0
            ? ` ${failedMusts} must-layer${failedMusts === 1 ? " has" : "s have"} already failed for this session, so this one is unlikely to complete today.`
            : "");

  return {
    symbol: book.symbol,
    side: book.side,
    word: book.word,
    steps,
    mustPass: book.mustPass,
    mustNeed: book.mustNeed,
    nextAction,
    reconcile,
    progress,
  };
}

/**
 * Is this setup worth drawing on the chart?
 *
 * The trader asked for the TJR/PB-style markup to appear when a score is
 * really good. "Really good" has to mean something, and a high model grade
 * alone is the wrong trigger — that is exactly the number that reads A+ at
 * 3/9. The chart earns its ink when the SEQUENCE is close, because that is
 * when the drawing is about a trade rather than about a chart.
 */
export const MARKUP_MIN_PROGRESS = 0.7;

export function shouldMarkUp(
  w: SetupWalkthrough,
  engineScore: number | null,
): { mark: boolean; why: string } {
  if (w.word === "TAKE") {
    return { mark: true, why: "Sequence complete — draw it, this is the trade." };
  }
  const closeEnough = w.progress >= MARKUP_MIN_PROGRESS;
  const noDeadMust = !w.steps.some((s) => s.must && s.status === "failed");
  if (closeEnough && noDeadMust) {
    return {
      mark: true,
      why: `${w.mustPass}/${w.mustNeed} musts with none failed — close enough to be worth drawing while it builds.`,
    };
  }
  return {
    mark: false,
    why:
      engineScore != null && engineScore >= 0.75
        ? `Engine ${engineScore.toFixed(2)} is high but the sequence is ${w.mustPass}/${w.mustNeed}. Drawing it now would be drawing a model's opinion, not a trade.`
        : `${w.mustPass}/${w.mustNeed} musts — too early to be worth the ink.`,
  };
}
