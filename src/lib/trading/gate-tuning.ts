/**
 * Sequence-gate tuning — the knobs that decide how often the desk fires.
 *
 * WHY THIS FILE EXISTS
 * On 2026-09-19 a causal replay of two months of real 15m tape found the
 * SMC sequence printed TAKE zero times on either book. Since auto-paper
 * fires only on TAKE, that gate was the reason the paper book had never
 * filled, independent of the auth bug. The trader's call on 2026-09-21 was
 * to loosen it for probability/profitability. These are the knobs, and
 * scripts/sweep-gates.mjs is how each candidate value was measured — the
 * live engine over the same tape (Databento ESU6/NQU6 15m, Jun 30 – Sep 1
 * 2026, NY AM, causal, limit at CE, ties against the trade).
 *
 * WHAT THE SWEEP FOUND (2026-09-21, 18 rule sets, both books)
 *
 *   v0  original                                      0 takes
 *   v1  same-bar displacement                         0
 *   v2  armed-is-take                                 0
 *   v3  v1 + v2                                       0
 *   v4  v3 + retrace pad 0.50                         0
 *   v5  v3 + raid recency 32 / displacement 16        0
 *   v6  v3 + displacement 1.25 ATR                    0
 *   v7  v4 + v5                                       0
 *   v8  v7 + v6 (loosest)                             0
 *   v9  impulse-leg dealing range                     1 (unfilled)
 *   v10 v3 + impulse                                  1 (unfilled)
 *   v11 v7 + impulse                                  1 (unfilled)
 *   v12 v8 + impulse                                  1 (unfilled)
 *   v13 raid picks the side                           0
 *   v14 v13 + same-bar                                0
 *   v15 v14 + armed                                   0
 *   v16 v15 + pad 0.50 + recency 32/16                0
 *   v17 v16 + displacement 1.25 ATR                   0
 *
 * None of the retrace/shift knobs matter because the sequence dies EARLIER.
 * scripts/diagnose-path.mjs (stride-4 sample of every NY AM bar outside
 * Judas, loosest knobs) names the layers, per book MNQ / ES:
 *
 *   pd_half  (POI in the correct half of the range)  fails on 80% / 75%
 *   ltf      (shift + displacement printed)           waits on 73% / 74%
 *   sweep    (raid of the trade's polarity)           fails on 76% / 63%
 *   dol      (draw agrees with the side)              fails on 24% / 26%
 *   htf                                               fails on 17% / 17%
 *   PATH (A+/A/A−, ≥0.65, actionable) is NOT the blocker: ok on 52% / 50%
 *
 * Bars with every must-layer passing except the retrace: 2 / 1 per month.
 * Ignoring any ONE layer entirely (leave-one-out) arms at most 18 / 30
 * sampled bars — pd_half is that layer on both books — i.e. ~5-8 setups a
 * month per book, and only by removing the premium/discount rule.
 *
 * The impulse-leg range (v9-v12) is ICT's own dealing range for an entry and
 * it is STRICTER, not looser: it wants a >55% retrace of the displacement
 * leg, and pd_half failed on 84% / 82% under it. Letting the raid pick the
 * side (v13-v17) removes the sweep-polarity failure as designed, and the
 * remaining AND of pd_half + ltf + dol + retrace still never completes.
 *
 * WHAT IS LIVE (2026-10-10 — trader ordered the frequency pass)
 * The 2026-09-21 sweep died on pd_half before these knobs could matter.
 * They are on now because they correct the model, not because a new edge
 * was measured:
 *   - sameBarDisplacement: a candle that sweeps and closes back through the
 *     pool IS the displacement. ICT states no separate-bar rule.
 *   - armedIsTake: the sequence is complete and the limit rests at the array.
 *     auto-paper still waits for the touch before it books.
 *   - dealingRange "hybrid": pd_half passes when EITHER the impulse leg OR
 *     the 80-bar window is the correct half. Impulse-only was stricter than
 *     the window and failed ~80% of NY AM bars. A fighting half is still a
 *     note in smc-master once the raid and the displacement have named the
 *     side; equilibrium still waits.
 *   - displacementK 1.25 (was 1.5) and displacement recency 20 bars / ~5h
 *     (was 12 / ~3h). Sweep recency 32 bars / ~8h (was 24 / ~6h). These
 *     widen the window a raid can still be answered inside. They are NOT a
 *     measured expectancy claim — Claude should re-run scripts/sweep-gates.mjs
 *     before treating the new take-rate as an edge.
 * sideFromRaid stays on. retracePad stays 0.25. Nothing writes GATE at runtime.
 */

export interface GateTuning {
  /**
   * Whether a displacement printed on the SAME bar as the raid confirms the
   * shift. `false` was the original rule (index must be strictly greater).
   * ICT's own description of displacement — "energetic … preferably close
   * below" — carries no separate-bar requirement, and a single 15m candle
   * that sweeps the pool and closes far back through it is the most common
   * shape a real raid takes.
   */
  sameBarDisplacement: boolean;
  /**
   * Whether a sequence that is complete except for price being inside the
   * array is TAKE (a limit rests at consequent encroachment) rather than
   * WAIT. The live desk polls every 20s against the live print and sees the
   * intrabar touch; at 15m-close granularity a resting limit is that trade.
   * The retrace layer still names the array and the plan still carries the
   * limit price; this only changes the word.
   */
  armedIsTake: boolean;
  /** Retrace tolerance as a fraction of the array's height. Original 0.25. */
  retracePad: number;
  /** Bars a raid stays "recent". Original 24 (6h on 15m). */
  recentSweepBars: number;
  /** Bars a displacement stays "recent". Original 12 (3h on 15m). */
  recentDisplacementBars: number;
  /** Displacement body as a multiple of ATR(14). Original 1.5. */
  displacementK: number;
  /**
   * What "premium / discount" is measured against for the pd_half layer.
   *
   * "window": the high/low of the last 80 bars (structure.ts dealingRange),
   * the original rule. In a trend this puts every pullback in the wrong
   * half — an uptrend's retrace is still the upper half of a 20-hour box —
   * and the 2026-09-21 diagnosis (scripts/diagnose-path.mjs) found pd_half
   * failing on 75-80% of trade-window bars for exactly that reason.
   *
   * "impulse": the leg from the raid's wick extreme to the displacement
   * extreme after it — ICT's own dealing range for the entry ("buy the
   * discount of the leg that displaced away from the sweep"). Requires a
   * raid of the correct polarity; otherwise falls back to the window.
   *
   * "hybrid": pass when either range is the correct half (preferZone).
   */
  dealingRange: "window" | "impulse" | "hybrid";
  /**
   * Whether the last raid's polarity picks the side the sequence grades.
   *
   * Original: the scanner's best candidate (PATH grade, then HTF-aligned,
   * then confluence) is graded, and the sweep layer then FAILS when the raid
   * armed the other side. The 2026-09-21 replay found that the first
   * blocker on 42-52% of trade-window bars — the desk was grading a long
   * while the tape had just raided buyside, so the sequence could never
   * complete on that bar. In SMC the raid defines the trade: SSL taken arms
   * a long, BSL taken arms a short. With this on, the raid's side is graded
   * whenever HTF permits it (the absolute gate is untouched — a raid against
   * a bear HTF still grades the short, and still stands).
   */
  sideFromRaid: boolean;
}

/** The rule set as it stood before 2026-09-21, for A/B in the sweep. */
export const ORIGINAL_GATE: Readonly<GateTuning> = Object.freeze({
  sameBarDisplacement: false,
  armedIsTake: false,
  retracePad: 0.25,
  recentSweepBars: 24,
  recentDisplacementBars: 12,
  displacementK: 1.5,
  dealingRange: "window",
  sideFromRaid: false,
});

/**
 * Live rule set as of 2026-10-10. Numbers: sameBarDisplacement false→true,
 * armedIsTake false→true, recentSweepBars 24→32, recentDisplacementBars 12→20,
 * displacementK 1.5→1.25, dealingRange "impulse"→"hybrid". sideFromRaid stays true.
 */
export const GATE: GateTuning = {
  sameBarDisplacement: true,
  armedIsTake: true,
  retracePad: 0.25,
  recentSweepBars: 32,
  recentDisplacementBars: 20,
  displacementK: 1.25,
  dealingRange: "hybrid",
  sideFromRaid: true,
};

export type HalfZone = "premium" | "discount" | "equilibrium";

/** True when this half is the one the side is allowed to trade from. */
export function halfAgrees(side: "long" | "short", zone: HalfZone | null | undefined): boolean {
  if (!zone || zone === "equilibrium") return false;
  return side === "long" ? zone === "discount" : zone === "premium";
}

/**
 * Which premium/discount the pd_half layer grades.
 *
 * "window" — the 80-bar box only.
 * "impulse" — the post-raid leg, else the window.
 * "hybrid" — whichever of the two is the correct half. Impulse wins when
 * both agree, so the chart tints the leg ICT actually enters on. When
 * neither agrees, the impulse is still shown if it exists: the card should
 * name the tighter range that failed, not hide it.
 */
export function preferZone(
  side: "long" | "short",
  impulse: HalfZone | null,
  window: HalfZone | null,
): HalfZone | null {
  if (GATE.dealingRange === "window") return window;
  if (GATE.dealingRange === "impulse") return impulse ?? window;
  if (impulse && halfAgrees(side, impulse)) return impulse;
  if (window && halfAgrees(side, window)) return window;
  return impulse ?? window;
}

/** Replace every knob at once (sweep use). Returns the previous values. */
export function setGate(next: Partial<GateTuning>): GateTuning {
  const prev = { ...GATE };
  Object.assign(GATE, next);
  return prev;
}
