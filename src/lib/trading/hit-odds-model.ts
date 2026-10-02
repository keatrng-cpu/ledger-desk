/**
 * The fitted P(T1) model, bound once. Data lives in src/data/hit-odds-model.json
 * (written by scripts/build-hit-odds.mjs); the arithmetic lives in hit-odds.ts.
 */
import model from "@/data/hit-odds-model.json";
import { GEOMETRY_FEATURES, hitOdds, type HitOdds, type OddsModelFile } from "./hit-odds";

export const HIT_ODDS_MODEL = model as unknown as OddsModelFile;

/** True while the shipped model reads nothing but the plan's geometry. */
export const MODEL_IS_GEOMETRY_ONLY = HIT_ODDS_MODEL.features.every((k) => GEOMETRY_FEATURES.includes(k));

/**
 * P(T1) for a bare plan — for readers (the sequence's target layer) that have
 * the geometry but not the ladder / pattern / SMT reads. Returns null when
 * the shipped model needs more than geometry, so a partial input can never
 * print a different number than the card does.
 */
export function planHitOdds(plan: {
  side: "long" | "short";
  symbol: string;
  entry: number;
  stop: number;
  t1: number | null;
  /** The series ATR (TradePlan.riskAtr holds it). */
  atr: number | null;
  price: number | null;
}): HitOdds | null {
  if (!MODEL_IS_GEOMETRY_ONLY) return null;
  return hitOdds({ ...plan }, HIT_ODDS_MODEL);
}
