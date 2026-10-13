import RULES from "../../../shared/desk-rules.json";
/**
 * Tunables the learning loop may recalibrate (versioned in desk_calibration).
 * Baselines are constants; the applied values live in TUNABLES.
 */
/** Opposite-side boost when an LTF kill fires (Keaton 2026-10-13: 0.05–0.08 → 0.02; kill precision ≈ 0.50 on 5 sessions). */
export const KILL_BOOST_BASE = RULES.kill.boost;
export const KILL_BOOST_BOUNDS = [0, RULES.kill.boostMax] as const;
/** DXY/10y context risk flag nudge (inside the ±0.06 day-context cap). */
export const MACRO_NUDGE = 0.01;
export const TUNABLES = { killBoost: KILL_BOOST_BASE };
export function setKillBoostScale(scale: number | null | undefined) {
  const s = scale != null && Number.isFinite(scale) ? scale : 1;
  TUNABLES.killBoost = +Math.max(KILL_BOOST_BOUNDS[0], Math.min(KILL_BOOST_BOUNDS[1], KILL_BOOST_BASE * s)).toFixed(4);
}
