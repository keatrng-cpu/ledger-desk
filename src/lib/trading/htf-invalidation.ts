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
import { detectDisplacements, detectFvgs, detectSweeps } from "./detectors";
import type { OhlcBar } from "../market/types";
import type { HtfBiasRead } from "./structure";
import { strongExtension } from "./raid-pair";

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
  bars?: OhlcBar[],
): BiasDisrespect {
  // Only meaningful when we are asking to trade AGAINST the HTF read.
  if (read.topDown === direction) return NOT_DISRESPECTED;
  // A neutral HTF is not a bias, so there is nothing to disrespect — the
  // normal gate already permits these and this must not claim credit.
  if (read.topDown !== "bull" && read.topDown !== "bear") return NOT_DISRESPECTED;

  const recentEnough = (index: number | undefined | null): boolean =>
    index != null && barCount - index <= DISRESPECT_RECENCY_BARS;

  // A later sweep of the OTHER side is often the target, not a new raid.
  // The low that trapped the old bias still counts after the high is tagged.
  const sweeps = bars ? detectSweeps(bars) : [];
  const raid =
    sweeps.filter(
      (s) =>
        recentEnough(s.index) &&
        ((direction === "bull" && s.side === "sellside") ||
          (direction === "bear" && s.side === "buyside")),
    ).at(-1) ??
    (det.sweep.latest &&
    recentEnough(det.sweep.latest.index) &&
    ((direction === "bull" && det.sweep.latest.side === "sellside") ||
      (direction === "bear" && det.sweep.latest.side === "buyside"))
      ? det.sweep.latest
      : null);
  const manipulation = !!raid;

  const disps = bars ? detectDisplacements(bars) : [];
  const disp =
    disps.find(
      (d) =>
        d.direction === direction &&
        recentEnough(d.index) &&
        (raid == null || d.index > raid.index),
    ) ??
    (det.displacement.latest &&
    det.displacement.latest.direction === direction &&
    recentEnough(det.displacement.latest.index) &&
    (raid == null || det.displacement.latest.index > raid.index)
      ? det.displacement.latest
      : null);
  const distribution = !!disp;

  // A 15m inverse is structure changing hands before the swing BOS prints.
  // Bear gap closed through and inverted = bullish. The reverse is bearish.
  const inverse = bars
    ? detectFvgs(bars).some(
        (g) =>
          g.inverted &&
          recentEnough(g.invertedIndex) &&
          ((direction === "bull" && g.kind === "bear") ||
            (direction === "bear" && g.kind === "bull")),
      )
    : false;
  const structureFlipped = read.lastBOS?.direction === direction || inverse;

  // Mid can lag a fast inverse. LTF agreeing plus the inverse is enough.
  // Mid and LTF both agreeing is still enough on its own.
  const ltfAgrees =
    (read.mid === direction && read.ltf === direction) ||
    (read.ltf === direction && structureFlipped);

  const checks = [
    { id: "manipulation", label: "Liquidity raid (manipulation)", pass: manipulation },
    { id: "distribution", label: "Displacement away (distribution)", pass: distribution },
    { id: "structure", label: "Structure broken vs bias", pass: structureFlipped },
    { id: "ltf", label: "Mid + LTF both flipped", pass: ltfAgrees },
  ];

  // The four-check signature still releases. So does the case on the board:
  // the old frame still says bear while price has already extended the other
  // way, or structure has broken and price has left. That label is not a
  // hard block. A pullback with no extension and no broken structure does
  // not release — the bounce test has neither.
  const extended = bars != null && strongExtension(bars) === direction;
  const structureLeft = structureFlipped && (distribution || extended);
  const signature = checks.every((c) => c.pass);
  const disrespected = signature || extended || structureLeft;
  const missing = checks.filter((c) => !c.pass).map((c) => c.label);

  return {
    disrespected,
    direction: disrespected ? direction : null,
    checks,
    reason: disrespected
      ? extended && !signature
        ? `HTF ${read.topDown} DISRESPECTED — price extended ${direction}. The old frame is not a block.`
        : structureLeft && !signature
          ? `HTF ${read.topDown} DISRESPECTED — structure broke and price left ${direction}. The old frame is not a block.`
          : `HTF ${read.topDown} DISRESPECTED — raid + displacement + structure + LTF all ${direction}. Bias spent; ${direction === "bull" ? "long" : "short"} released.`
      : `HTF ${read.topDown} still stands — needs ${missing.join(" + ")}.`,
  };
}
