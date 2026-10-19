/**
 * Option-EV target selection (SHADOW / opt-in; builds on the convex option model).
 *
 * The desk picks a target by futures R — nearest real pool clearing rrMin, then
 * "step out to external" to synthesize >=1R. But the trade is expressed as a 0DTE
 * option, and the option's expected value is NOT monotone in futures R:
 *   - a farther target pays more (the payoff is convex — long gamma), BUT
 *   - it prints less often (lower pWin), AND
 *   - it takes longer, so theta eats more of the debit.
 * The target that maximizes futures R is therefore often NOT the target that
 * maximizes option EV. This module ranks candidate targets by the option EV a
 * long contract actually earns, using the same convex model the backtest prices
 * fills with (engine.optionPnlPct: delta·move + ½·gamma·move² − √theta − spread).
 *
 *   evOpt(T) = pWin(T)·optWin(T) + (1 − pWin(T))·optLoss
 *
 * where optWin/optLoss are the option returns if T (resp. the stop) prints. pWin
 * comes from the ladder's T1-before-stop calibration (same source as the shadow
 * grade). evR (futures expectancy) is returned alongside for the A/B comparison.
 *
 * SHADOW: nothing here is wired into the live plan or the backtest's default
 * target choice — it is the comparison layer an Accuracy Review run turns on to
 * decide whether option-EV selection beats futures-R selection. No desk-rules.json.
 */
import { optionPnlPct, minutesToRthClose, type OptModel } from "./engine";

export interface TargetCand {
  price: number;
  /** Futures R multiple of this target against the plan's risk. */
  rr: number;
  /** P(target prints before the stop | filled), 0..1, or null when uncalibrated. */
  pWin: number | null;
  /** Estimated minutes entry→target (farther ≈ longer). Optional. */
  minutesToTarget?: number;
}

export interface TargetEvInput {
  model: OptModel;
  side: "long" | "short";
  entry: number;
  stop: number;
  /** Entry bar time (ms) → minutes of 0DTE life left via minutesToRthClose. */
  entryTms?: number;
  /** Overrides entryTms when given. */
  minutesToExpiry?: number;
  /** Minutes held if the stop prints (stops tend to resolve faster). Default 10. */
  minutesToStop?: number;
  /** Fallback minutes→target when a candidate omits it. Default 15·rr. */
  defaultMinutesPerR?: number;
}

export interface TargetEv {
  price: number;
  rr: number;
  pWin: number | null;
  minutesToTarget: number;
  /** Option return if the target prints. */
  optWin: number | null;
  /** Option return if the stop prints (≤ 0, floored at −1). */
  optLoss: number;
  /** Option expected value: pWin·optWin + (1−pWin)·optLoss. Null when pWin null. */
  evOpt: number | null;
  /** Futures expected value in R: pWin·rr − (1−pWin). For comparison. */
  evR: number | null;
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;

export function targetEv(t: TargetCand, i: TargetEvInput): TargetEv {
  const mToExpiry = i.minutesToExpiry ?? (i.entryTms != null ? minutesToRthClose(i.entryTms) : undefined);
  const mToStop = i.minutesToStop ?? 10;
  const mToTarget = t.minutesToTarget ?? Math.max(1, Math.round((i.defaultMinutesPerR ?? 15) * Math.max(t.rr, 0.1)));
  const optWin = optionPnlPct(i.model, i.side, i.entry, t.price, mToTarget, mToExpiry);
  const optLoss = optionPnlPct(i.model, i.side, i.entry, i.stop, mToStop, mToExpiry); // ≤ 0
  const evOpt = t.pWin != null ? r4(t.pWin * optWin + (1 - t.pWin) * optLoss) : null;
  const evR = t.pWin != null ? r4(t.pWin * t.rr - (1 - t.pWin)) : null;
  return { price: t.price, rr: t.rr, pWin: t.pWin, minutesToTarget: mToTarget, optWin, optLoss, evOpt, evR };
}

/**
 * Rank candidate targets by option EV (descending); `best` is the max-EV target
 * with a calibrated pWin and a positive option EV, or null when none qualifies.
 * Candidates without a pWin are evaluated (optWin/optLoss shown) but never chosen.
 */
export function rankTargetsByOptionEv(
  cands: TargetCand[],
  i: TargetEvInput,
): { best: TargetEv | null; ranked: TargetEv[] } {
  const ranked = cands
    .map((t) => targetEv(t, i))
    .sort((a, b) => (b.evOpt ?? -Infinity) - (a.evOpt ?? -Infinity));
  const best = ranked.find((t) => t.evOpt != null && t.evOpt > 0) ?? null;
  return { best, ranked };
}
