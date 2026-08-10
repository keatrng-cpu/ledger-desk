/**
 * Exact confluence weights from Trading-Automation `aplus/strategy/scanner.py`.
 * Score = sum(weight_i) for components that fire; already normalized to 1.0.
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
