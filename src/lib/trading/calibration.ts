/**
 * Does a number the desk prints mean what it says?
 *
 * The desk shows probabilities — "76% reach", "Q 0.85" — and sizes and picks
 * targets off them. Nothing has ever checked them against what happened. This
 * is that check, and it is the cheapest real edge available: a target that is
 * quoted at 80% and delivers 40% is not a bad model, it is a bad DECISION
 * every time it is used, and the fix costs nothing once it is measured.
 *
 * WHAT IT FOUND ON DAY ONE (shadow replay, n=387 resolved)
 *   corr(confluence, T1 hit) = -0.031, t = -0.62 — no measurable relationship.
 *   Brier(confluence as P(T1)) = 0.437 against 0.239 for always saying the
 *   base rate of 39.5%. Read as a probability the engine score is far WORSE
 *   than a constant, because it lives at 0.65-0.99 while the thing it would
 *   be predicting happens 39.5% of the time.
 *
 * That is not a bug in the score. `confluence` is a FIT ratio — how well a
 * model matches the tape — and it was never a probability. The bug would be
 * reading it as one, and this module exists so that the difference is
 * measured rather than assumed.
 *
 * ── THE TWO TRAPS THIS IS BUILT TO REFUSE ──────────────────────────────────
 *
 * Both were hit within ten minutes of first looking at real data, and both
 * pointed at a confident wrong answer.
 *
 * 1. THE DENOMINATOR TRAP. The shadow book's limit leg reached T1 19% of the
 *    time against the chase leg's 61% — which reads as "chasing is three
 *    times better" and would argue for tearing up the desk's rest-at-CE rule.
 *    But a limit that never fills cannot hit T1, and 57 of 194 limit legs
 *    never filled. The two rates had different denominators and were never
 *    comparable. `rate()` therefore takes an explicit population and
 *    `compare()` refuses two samples whose denominators differ in kind.
 *
 * 2. THE UNIT TRAP. Conditioning on fills only, the gap survives: 26% vs 61%.
 *    It still means nothing, because the chase enters LATER — nearer to T1 and
 *    further from the stop — so it reaches the same target at a worse R. In
 *    the unit that pays, the ranking inverts: limit +0.173R/card, chase
 *    -0.050R/card. A hit RATE is not an edge. `expectancy()` is the primary
 *    measure here and `rate()` is explicitly labelled as not one.
 *
 * ── SHRINKAGE ─────────────────────────────────────────────────────────────
 *
 * Every bucket estimate is pulled toward the global base rate in proportion
 * to how little data it has (`PRIOR_STRENGTH` pseudo-observations). A bucket
 * with n=3 reports essentially the base rate; one with n=200 reports itself.
 * This is the correct tool for many-cells-few-samples and it degrades to
 * "I don't know" instead of to a confident number — which, on 405 NY AM bars,
 * is the difference between a measurement and a story.
 */

/** One prediction and what happened. */
export interface Sample {
  /** What the desk said, as a probability 0–1. */
  p: number;
  /** Did the predicted thing happen? */
  hit: boolean;
  /** Realised R. Optional, but it is the unit that actually decides. */
  r?: number | null;
  /** False when the plan never got filled — a different population. */
  filled?: boolean;
}

/**
 * Pseudo-observations of the base rate mixed into every bucket.
 *
 * 20 is deliberate: at n=20 a bucket is weighted half to itself and half to
 * the base rate, and 20 is roughly the smallest sample anyone should read at
 * all. It is a prior strength, not a tuning knob — moving it to make a result
 * look better is the thing this module exists to prevent.
 */
export const PRIOR_STRENGTH = 20;

/** Below this a bucket reports no rate at all. */
export const MIN_BUCKET_N = 12;

/** Wilson score interval — correct at small n, where normal approximation is not. */
export function wilson(hits: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 1];
  const p = hits / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface Bucket {
  /** Lower edge of the predicted-probability band. */
  from: number;
  to: number;
  n: number;
  hits: number;
  /** Mean of what was PREDICTED in this bucket. */
  predicted: number;
  /** Raw observed frequency. Null below the floor. */
  observed: number | null;
  /** Observed, pulled toward the base rate by sample size. */
  shrunk: number | null;
  ci: [number, number] | null;
  /** predicted − observed. Positive means the desk is over-promising. */
  gap: number | null;
}

export type CalibrationVerdict =
  /** The predictor beats a constant and tracks the outcome. */
  | "informative"
  /** No measurable relationship. The number is decoration. */
  | "flat"
  /** Ordered the wrong way — worse than useless. */
  | "inverted"
  /** Not enough resolved samples to say anything. */
  | "insufficient";

export interface Reliability {
  n: number;
  baseRate: number;
  buckets: Bucket[];
  /** Mean squared error of the prediction. Lower is better. */
  brier: number;
  /** Brier of always predicting the base rate. The bar to beat. */
  brierBase: number;
  /**
   * 1 − brier/brierBase. Above 0 the predictor adds information; at or below
   * 0 a constant is better, however confident the number looked.
   */
  skill: number;
  /** Point-biserial correlation between prediction and outcome. */
  corr: number;
  /** t on that correlation. |t| > 1.96 is the usual bar. */
  t: number;
  verdict: CalibrationVerdict;
  line: string;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0;
}

/**
 * Bucket the predictions and compare each band to what happened.
 *
 * `width` is the band size; 0.05 gives twenty bands, which on a few hundred
 * samples is already too many — it is widened automatically when the sample
 * cannot support it, because a reliability curve made of n=3 points is a
 * drawing, not a measurement.
 */
export function reliability(samples: Sample[], width = 0.05): Reliability {
  const usable = samples.filter((s) => Number.isFinite(s.p));
  const n = usable.length;
  const baseRate = n ? usable.filter((s) => s.hit).length / n : 0;

  const blank: Reliability = {
    n,
    baseRate,
    buckets: [],
    brier: 0,
    brierBase: 0,
    skill: 0,
    corr: 0,
    t: 0,
    verdict: "insufficient",
    line: `${n} resolved sample${n === 1 ? "" : "s"} — below the ${MIN_BUCKET_N * 2} needed to say whether the number means anything.`,
  };
  if (n < MIN_BUCKET_N * 2) return blank;

  // Widen the bands until the average one could clear the floor.
  let w = width;
  while (1 / w > n / MIN_BUCKET_N && w < 0.5) w *= 2;

  const map = new Map<number, Sample[]>();
  for (const s of usable) {
    const key = Math.min(1 - w, Math.floor(s.p / w) * w);
    (map.get(key) ?? map.set(key, []).get(key)!).push(s);
  }

  const buckets: Bucket[] = [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([from, xs]) => {
      const hits = xs.filter((s) => s.hit).length;
      const enough = xs.length >= MIN_BUCKET_N;
      const observed = enough ? hits / xs.length : null;
      // Shrinkage: the bucket speaks in proportion to its own sample.
      const shrunk = enough
        ? (hits + PRIOR_STRENGTH * baseRate) / (xs.length + PRIOR_STRENGTH)
        : null;
      const predicted = mean(xs.map((s) => s.p));
      return {
        from: +from.toFixed(4),
        to: +(from + w).toFixed(4),
        n: xs.length,
        hits,
        predicted,
        observed,
        shrunk,
        ci: enough ? wilson(hits, xs.length) : null,
        gap: observed == null ? null : +(predicted - observed).toFixed(4),
      };
    });

  const brier = mean(usable.map((s) => (s.p - (s.hit ? 1 : 0)) ** 2));
  const brierBase = mean(usable.map((s) => (baseRate - (s.hit ? 1 : 0)) ** 2));
  const skill = brierBase > 0 ? 1 - brier / brierBase : 0;

  const xs = usable.map((s) => s.p);
  const ys: number[] = usable.map((s) => (s.hit ? 1 : 0));
  const mx = mean(xs);
  const my = mean(ys);
  const cov = xs.reduce((s, v, i) => s + (v - mx) * (ys[i]! - my), 0);
  const sx = Math.sqrt(xs.reduce((s, v) => s + (v - mx) ** 2, 0));
  const sy = Math.sqrt(ys.reduce((s, v) => s + (v - my) ** 2, 0));
  const corr = sx > 0 && sy > 0 ? cov / (sx * sy) : 0;
  const t = Math.abs(corr) < 1 ? corr * Math.sqrt((n - 2) / (1 - corr * corr)) : 0;

  const verdict: CalibrationVerdict =
    Math.abs(t) < 1.96 ? "flat" : corr > 0 ? "informative" : "inverted";

  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const line =
    verdict === "flat"
      ? `No measurable relationship over ${n} samples (r=${corr.toFixed(3)}, t=${t.toFixed(2)}). ` +
        (skill <= 0
          ? `Read as a probability it scores WORSE than always saying ${pct(baseRate)} (Brier ${brier.toFixed(3)} vs ${brierBase.toFixed(3)}). It is a fit score, not a probability — do not size off it as one.`
          : `It adds a little information but does not order the outcome.`)
      : verdict === "inverted"
        ? `ORDERED THE WRONG WAY over ${n} samples (r=${corr.toFixed(3)}, t=${t.toFixed(2)}). Higher predictions did WORSE. Worse than useless until this is explained.`
        : `Tracks the outcome over ${n} samples (r=${corr.toFixed(3)}, t=${t.toFixed(2)}), skill ${skill.toFixed(3)} against the base rate ${pct(baseRate)}.`;

  return { n, baseRate, buckets, brier, brierBase, skill, corr, t, verdict, line };
}

/* ── THE UNIT THAT ACTUALLY PAYS ──────────────────────────────────────────── */

export interface Expectancy {
  n: number;
  meanR: number;
  sd: number;
  se: number;
  /** meanR / se. Above ~2 is a result; below is a direction. */
  t: number;
  significant: boolean;
  line: string;
}

/**
 * Mean R per opportunity — counting the ones that never filled as 0R.
 *
 * Excluding unfilled plans measures a population the trader cannot trade: you
 * do not get to keep only the limits that filled. A rule that fills 71% of the
 * time at +0.6R is worth less than one that fills always at +0.5R, and only
 * this denominator can see that.
 */
export function expectancy(samples: Sample[]): Expectancy {
  const rs = samples
    .map((s) => (s.filled === false ? 0 : (s.r ?? null)))
    .filter((v): v is number => v != null && Number.isFinite(v));
  const n = rs.length;
  if (n < 2) {
    return { n, meanR: 0, sd: 0, se: 0, t: 0, significant: false, line: `${n} sample(s) — nothing to measure.` };
  }
  const m = mean(rs);
  const sd = Math.sqrt(mean(rs.map((v) => (v - m) ** 2)));
  const se = sd / Math.sqrt(n);
  const t = se > 0 ? m / se : 0;
  const significant = Math.abs(t) >= 1.96;
  return {
    n,
    meanR: +m.toFixed(4),
    sd: +sd.toFixed(3),
    se: +se.toFixed(4),
    t: +t.toFixed(2),
    significant,
    line:
      `${m >= 0 ? "+" : ""}${m.toFixed(3)}R per opportunity over ${n} (se ${se.toFixed(3)}, t ${t.toFixed(2)})` +
      (significant ? " — distinguishable from zero." : " — NOT distinguishable from zero; a direction, not a result."),
  };
}

/* ── CONDITIONING: how, why, when, where ──────────────────────────────────── */

export interface Slice {
  key: string;
  n: number;
  /** Fill rate, reported SEPARATELY so it can never hide inside a hit rate. */
  fillRate: number | null;
  rate: number | null;
  ci: [number, number] | null;
  shrunk: number | null;
  expectancy: Expectancy;
  enough: boolean;
}

/**
 * Split the record by any context and measure each slice honestly.
 *
 * This is the "how / why / when / where" the desk is supposed to learn:
 *   WHEN   killzone, session phase
 *   WHY    the layer that refused it
 *   WHERE  side, dealing-range half, distance to the draw
 *   HOW    limit versus chase, which shape the move took
 *
 * The fill rate is returned beside the hit rate rather than folded into it,
 * because folding them is exactly the denominator trap: a slice can look
 * terrible purely because it rarely fills, and the fix for that is a different
 * fix entirely.
 */
export function conditional(
  samples: Sample[],
  key: (s: Sample) => string,
  minN = MIN_BUCKET_N,
): Slice[] {
  const base = samples.length ? samples.filter((s) => s.hit).length / samples.length : 0;
  const map = new Map<string, Sample[]>();
  for (const s of samples) {
    const k = key(s);
    (map.get(k) ?? map.set(k, []).get(k)!).push(s);
  }
  return [...map.entries()]
    .map(([k, xs]) => {
      const filledOnly = xs.filter((s) => s.filled !== false);
      const hits = filledOnly.filter((s) => s.hit).length;
      const enough = filledOnly.length >= minN;
      return {
        key: k,
        n: xs.length,
        fillRate: xs.length ? filledOnly.length / xs.length : null,
        rate: enough ? hits / filledOnly.length : null,
        ci: enough ? wilson(hits, filledOnly.length) : null,
        shrunk: enough
          ? (hits + PRIOR_STRENGTH * base) / (filledOnly.length + PRIOR_STRENGTH)
          : null,
        expectancy: expectancy(xs),
        enough,
      };
    })
    .sort((a, b) => b.n - a.n);
}

/**
 * Compare two slices — and REFUSE when the comparison is not available.
 *
 * Two rates are comparable only when they are rates of the same thing over
 * the same kind of population. The limit-versus-chase pair fails on both
 * counts: different fill rates (different denominators) and different entry
 * prices (so the same target is a different R). Rather than print a difference
 * that reads as a finding, this says which comparison IS available.
 */
export function compare(
  a: { label: string; samples: Sample[] },
  b: { label: string; samples: Sample[] },
): { comparable: boolean; on: "expectancy"; line: string } {
  const fa = a.samples.filter((s) => s.filled !== false).length / Math.max(1, a.samples.length);
  const fb = b.samples.filter((s) => s.filled !== false).length / Math.max(1, b.samples.length);
  const ea = expectancy(a.samples);
  const eb = expectancy(b.samples);
  const diff = ea.meanR - eb.meanR;
  const se = Math.sqrt(ea.se ** 2 + eb.se ** 2);
  const t = se > 0 ? diff / se : 0;

  const fillDiffers = Math.abs(fa - fb) > 0.05;
  return {
    comparable: false,
    on: "expectancy",
    line:
      (fillDiffers
        ? `Fill rates differ (${(fa * 100).toFixed(0)}% vs ${(fb * 100).toFixed(0)}%), so HIT RATES are not comparable — a plan that never fills cannot hit its target. `
        : "") +
      `On expectancy, which counts an unfilled plan as 0R: ${a.label} ${ea.meanR >= 0 ? "+" : ""}${ea.meanR.toFixed(3)}R vs ${b.label} ${eb.meanR >= 0 ? "+" : ""}${eb.meanR.toFixed(3)}R, ` +
      `difference ${diff >= 0 ? "+" : ""}${diff.toFixed(3)}R (t ${t.toFixed(2)})` +
      (Math.abs(t) >= 1.96
        ? "."
        : " — NOT distinguishable from zero. Consistent with, never proof of."),
  };
}
