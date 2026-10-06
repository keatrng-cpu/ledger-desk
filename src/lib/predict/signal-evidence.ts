/**
 * Documented priors the signal engine grades against — favorite–longshot
 * bias (FLB) by price bin, maker vs taker, horizon. Source brief:
 * ai/research/2026-10-06-pm-signal.md. Effect sizes are ONLY as stated in
 * the cited sources; nothing here is fitted to this desk's data.
 *
 * What the grade uses these for: cheap YES contracts grade DOWN by default
 * (Kalshi ≤10¢ lose >60% on average; all-contract average −20% pre-fee /
 * −22% after; takers −31% vs makers −12% post-fee). Long horizons grade
 * slightly down (Page & Clemen: FLB worsens with time to expiry).
 *
 * NOT used: news-reaction lag. No systematic evidence of a lag edge on
 * Kalshi in the brief's sources, so price moves are SHOWN, never graded.
 */

export type PriceBinId = "lt10" | "10to20" | "20to40" | "40to60" | "60to90" | "gte90";

export interface PriceBin {
  id: PriceBinId;
  label: string;
  /** Inclusive lower bound, exclusive upper bound, in dollars (0–1). */
  lo: number;
  hi: number;
  /** Grade-score points (applied to a YES buy at this ask). Negative = grade down. */
  gradePoints: number;
  /** Hard grade ceiling for a YES buy in this bin (null = no cap). */
  cap: "C" | "D" | null;
  /** Plain-English evidence line for reasons. */
  evidence: string;
}

export const FLB_SOURCE = "Bürgi, Deng & Whelan (2025) UCD WP25/19 — Kalshi, >300k prices";

export const PRICE_BINS: readonly PriceBin[] = [
  {
    id: "lt10",
    label: "under 10¢ (deep longshot)",
    lo: 0,
    hi: 0.1,
    gradePoints: -25,
    cap: "D",
    evidence:
      "Kalshi contracts at 10¢ or less lose over 60% on average (Bürgi et al. 2025) — the fee is also a big share of the stake here",
  },
  {
    id: "10to20",
    label: "10–20¢ (longshot)",
    lo: 0.1,
    hi: 0.2,
    gradePoints: -12,
    cap: "C",
    evidence:
      "Cheap YES contracts win less often than their price implies (favorite–longshot bias, Bürgi et al. 2025)",
  },
  {
    id: "20to40",
    label: "20–40¢ (underdog)",
    lo: 0.2,
    hi: 0.4,
    gradePoints: -4,
    cap: null,
    evidence: "Underdog prices still lean slightly rich on average (favorite–longshot bias)",
  },
  {
    id: "40to60",
    label: "40–60¢ (coin flip)",
    lo: 0.4,
    hi: 0.6,
    gradePoints: 0,
    cap: null,
    evidence: "Near a coin flip — no documented bias either way",
  },
  {
    id: "60to90",
    label: "60–90¢ (favorite)",
    lo: 0.6,
    hi: 0.9,
    gradePoints: 3,
    cap: null,
    evidence:
      "Favorites win slightly more often than priced; makers at 50¢+ earned about +1.9% after fees (small, high variance)",
  },
  {
    id: "gte90",
    label: "90¢+ (heavy favorite)",
    lo: 0.9,
    hi: 1.0001,
    gradePoints: 0,
    cap: null,
    evidence:
      "Heavy favorites are roughly fair, but the most you can make is a few cents per contract",
  },
];

export function priceBinFor(price: number | null | undefined): PriceBin | null {
  if (price == null || !Number.isFinite(price) || price < 0 || price > 1) return null;
  return PRICE_BINS.find((b) => price >= b.lo && price < b.hi) ?? null;
}

/** Documented average post-fee returns by role (Kalshi, Bürgi et al. 2025). Display only. */
export const MAKER_TAKER = {
  allPreFee: -0.2,
  allPostFee: -0.22,
  makerPostFee: -0.1199,
  takerPostFee: -0.3146,
  makerGte50PostFee: 0.019,
  note: "Signals here price a TAKER (crossing the ask). Takers lost about 31% after fees on average vs makers about 12% (Bürgi et al. 2025).",
} as const;

/** Page & Clemen (2013): FLB worsens with time to expiry; short horizons are better calibrated. */
export const LONG_HORIZON_MS = 10 * 24 * 3600_000;

/** Minimum samples before a scorer bucket is read (below → "too few to read"). */
export const MIN_SAMPLE_OVERALL = 30;
export const MIN_SAMPLE_BUCKET = 10;
export const TOO_FEW = "too few to read" as const;
export type TooFew = typeof TOO_FEW;
