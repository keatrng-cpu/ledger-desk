/**
 * Confluence weights, ported from Trading-Automation `aplus/strategy/scanner.py`.
 *
 * NOT a byte-exact mirror any more, and deliberately so — see `ote` below,
 * which the Python engine specifies in its model and has never implemented
 * (its own CLAUDE.md lists OTE under "NOT implemented, need fib.py").
 *
 * WHERE THESE ACTUALLY GET USED: `structureLayerScore` (strategy-grade.ts)
 * sums these over SMC_STRUCTURE_KEYS and divides by that same subset's
 * total, so it is a RATIO — adding a key here scales numerator and
 * denominator identically and does not silently move existing scores. The
 * old header claimed "Score = sum(weight_i)" for the whole table; that has
 * not been the scoring path since strategy-grade.ts took over, and the
 * claim is corrected here rather than left to mislead.
 */

export const RAW_WEIGHTS = {
  mechanical_model: 8,
  structure: 8,
  mid_bias: 8,
  ifvg: 8,
  smt: 6,
  sweep_significant: 4,
  htf2_bias: 4,
  weekly_pd: 4,
  order_block: 4,
  /**
   * Optimal Trade Entry — price retraced into 61.8%-79% of the post-sweep
   * impulse leg (trading/fib.ts). Weighted alongside order_block because it
   * is the same KIND of fact: a refinement of WHERE inside a POI to enter,
   * not a structural read. Not in SMC_STRUCTURE_KEYS for that reason.
   */
  ote: 4,
  cisd: 4,
  displacement: 4,
  mss: 4,
  opening_bias: 4,
  pd: 3,
  sponsored: 3,
  breaker: 3,
  mitigation: 3,
  rejection: 3,
  propulsion: 3,
  daily_bias: 3,
} as const;

export type ComponentKey = keyof typeof RAW_WEIGHTS;

const TOTAL = (Object.values(RAW_WEIGHTS) as number[]).reduce((a, b) => a + b, 0);

export const WEIGHTS: Record<ComponentKey, number> = Object.fromEntries(
  (Object.entries(RAW_WEIGHTS) as [ComponentKey, number][]).map(([k, v]) => [
    k,
    v / TOTAL,
  ]),
) as Record<ComponentKey, number>;

export const COMPONENT_KEYS = Object.keys(RAW_WEIGHTS) as ComponentKey[];

export const SCORE_KEYS = new Set<string>(COMPONENT_KEYS);
