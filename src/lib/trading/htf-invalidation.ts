/**
 * HTF bias invalidation — "absolute until disrespected and distributed."
 *
 * THE RULE THIS ENCODES
 * The top-down HTF bias is an absolute gate. That is correct and it stays.
 * But it is not PERMANENT: a bias holds until price disrespects it and
 * distributes the other way. Once the market has swept liquidity, displaced
 * against the bias, and broken structure in the new direction, the old bias
 * is spent — continuing to gate on it is gating on a read the market has
 * already invalidated.
 *
 * WHAT WAS THERE BEFORE
 * `scanner.ts` applied the gate unconditionally and forever:
 *
 *     if (read.topDown !== need) { c.htfOk = false; c.actionable = false; }
 *
 * with no release path of any kind, and `MarketConditions` (conditions.ts)
 * measures only regime / volatility / tradeability — it has never detected
 * bias disrespect. So a genuine reversal was structurally uncatchable: the
 * lagging HTF read blocked the correct side precisely when it mattered.
 *
 * Observed cost, 2026-08-13: HTF read bear, the open swept sellside
 * liquidity into equilibrium and a gap, then distributed hard to the highs.
 * Every long was gated out for the whole move.
 *
 * WHY THIS IS DELIBERATELY STRICT
 * This releases the desk's single hardest gate, so a loose version would
 * turn a selective desk into one that counter-trends every pullback. It
 * therefore requires the FULL AMD signature — manipulation AND distribution
 * AND structural agreement — not any one of them. A pullback that merely
 * looks strong does not clear it. When in doubt this returns false and the
 * absolute gate stands.
 *
 * Deterministic TypeScript. No LLM, no probability, no tuning knob.
 */

import type { DetectorSummary } from "./detectors";
import type { HtfBiasRead } from "./structure";

/**
 * How recent the distribution evidence must be, in bars. Displacement from
 * 200 bars ago says nothing about whether the bias is spent NOW; the whole
 * claim is that the market is CURRENTLY distributing.
 */
export const DISRESPECT_RECENCY_BARS = 30;

export interface BiasDisrespect {
  /** True only on the full signature — this is what releases the gate. */
  disrespected: boolean;
  /** The direction that has EARNED the release (the counter-HTF side). */
  direction: "bull" | "bear" | null;
  /** Each requirement and whether it is met — rendered so the release is auditable. */
  checks: { id: string; label: string; pass: boolean }[];
  /** One sentence for the UI / journal. */
  reason: string;
}

const NOT_DISRESPECTED: BiasDisrespect = {
  disrespected: false,
  direction: null,
  checks: [],
  reason: "",
};

/**
 * Has the HTF bias been disrespected in favour of `direction`?
 *
 * Only ever answers true when `direction` OPPOSES `read.topDown` — this
 * function exists solely to decide whether a counter-bias trade has earned
 * its release. With-bias trades never need it and are never affected.
 *
 * @param barCount total bars in the series, for recency math.
 */
export function biasDisrespect(
  read: HtfBiasRead,
  det: DetectorSummary,
  direction: "bull" | "bear",
  barCount: number,
): BiasDisrespect {
  // Only meaningful when we are asking to trade AGAINST the HTF read.
  if (read.topDown === direction) return NOT_DISRESPECTED;
  // A neutral HTF is not a bias, so there is nothing to disrespect — the
  // normal gate already permits these and this must not claim credit.
  if (read.topDown !== "bull" && read.topDown !== "bear") return NOT_DISRESPECTED;

  const recentEnough = (index: number | undefined | null): boolean =>
    index != null && barCount - index <= DISRESPECT_RECENCY_BARS;

  // 1) MANIPULATION — liquidity was taken on the side that traps the old
  //    bias. A bull release needs sellside swept (shorts trapped at the low).
  const sweep = det.sweep.latest;
  const manipulation =
    !!sweep &&
    recentEnough(sweep.index) &&
    ((direction === "bull" && sweep.side === "sellside") ||
      (direction === "bear" && sweep.side === "buyside"));

  // 2) DISTRIBUTION — displacement in the new direction. This is the actual
  //    "distribute" step: institutional delivery away from the raid, not
  //    drift back into the range.
  const disp = det.displacement.latest;
  const distribution =
    !!disp && disp.direction === direction && recentEnough(disp.index);

  // 3) STRUCTURE BROKEN against the old bias — the market has printed a new
  //    structural leg in `direction`, not merely a strong candle.
  const structureFlipped = read.lastBOS?.direction === direction;

  // 4) LOWER TIMEFRAMES AGREE — both mid and ltf now read `direction`.
  //    Requiring BOTH is what separates a real regime change from one noisy
  //    timeframe disagreeing with the daily.
  const ltfAgrees = read.mid === direction && read.ltf === direction;

  const checks = [
    { id: "manipulation", label: "Liquidity raid (manipulation)", pass: manipulation },
    { id: "distribution", label: "Displacement away (distribution)", pass: distribution },
    { id: "structure", label: "Structure broken vs bias", pass: structureFlipped },
    { id: "ltf", label: "Mid + LTF both flipped", pass: ltfAgrees },
  ];

  const disrespected = checks.every((c) => c.pass);
  const missing = checks.filter((c) => !c.pass).map((c) => c.label);

  return {
    disrespected,
    direction: disrespected ? direction : null,
    checks,
    reason: disrespected
      ? `HTF ${read.topDown} DISRESPECTED — raid + displacement + structure + LTF all ${direction}. Bias spent; ${direction === "bull" ? "long" : "short"} released.`
      : `HTF ${read.topDown} still stands — needs ${missing.join(" + ")}.`,
  };
}
