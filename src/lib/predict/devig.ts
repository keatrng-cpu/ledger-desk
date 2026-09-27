/**
 * Removing the bookmaker's margin — three ways, because the answer depends on
 * the method and the difference is about the size of the edges being hunted.
 *
 * The research pass (2026-09-27) measured it on that morning's NFL slate:
 * switching de-vig method alone moved the "fair" price 0.6–0.9¢ on average
 * and up to ~2¢, while Kalshi and DraftKings differed by 1.19¢ on average.
 * A gap smaller than the method spread is not a gap. So the board prices
 * every side three ways and, for a BUY, uses the method least favorable to
 * the buyer.
 *
 *   proportional — scale both sides by the overround (simplest; leaves the
 *                  longshot relatively generous)
 *   power        — find k with Σ q^k = 1 (shifts more margin onto longshots)
 *   Shin (1993)  — assumes a share z of insider money; closed form per side
 *                  once z is found (also shifts margin onto longshots)
 */

export interface DevigRead {
  proportional: [number, number];
  power: [number, number];
  shin: [number, number];
  /** Per side, the lowest and highest fair value across the three methods. */
  lo: [number, number];
  hi: [number, number];
}

function bisect(f: (x: number) => number, lo: number, hi: number): number {
  let a = lo;
  let b = hi;
  for (let i = 0; i < 100; i++) {
    const m = (a + b) / 2;
    if (f(a) * f(m) <= 0) b = m;
    else a = m;
  }
  return (a + b) / 2;
}

/** Two implied probabilities that still contain the margin (sum > 1). */
export function devig(qA: number, qB: number): DevigRead | null {
  if (!(qA > 0 && qB > 0 && qA < 1 && qB < 1)) return null;
  const S = qA + qB;
  const prop: [number, number] = [qA / S, qB / S];
  // Power: Σ q^k = 1. With S > 1, k > 1; with S < 1 (a negative margin), k < 1.
  const k = bisect((x) => qA ** x + qB ** x - 1, 0.2, 5);
  const pow: [number, number] = [qA ** k, qB ** k];
  // Shin: p_i(z) = (sqrt(z² + 4(1−z)·q_i²/S) − z) / (2(1−z)); pick z with Σ p = 1.
  const shinP = (z: number, q: number) => (Math.sqrt(z * z + (4 * (1 - z) * q * q) / S) - z) / (2 * (1 - z));
  const z = S > 1 ? bisect((x) => shinP(x, qA) + shinP(x, qB) - 1, 0, 0.4) : 0;
  const shin: [number, number] = [shinP(z, qA), shinP(z, qB)];
  const lo: [number, number] = [Math.min(prop[0], pow[0], shin[0]), Math.min(prop[1], pow[1], shin[1])];
  const hi: [number, number] = [Math.max(prop[0], pow[0], shin[0]), Math.max(prop[1], pow[1], shin[1])];
  return { proportional: prop, power: pow, shin, lo, hi };
}
