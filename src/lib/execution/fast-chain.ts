/**
 * FAST-SETUPS-ONLY fire chain (shared rules `fastChain`; Python twin watcher/fastchain.py; parity in scripts/fast-chain.test.mjs).
 * The watcher fires from it; the desk uses the same pure checks so the Floor / Watcher tab say the same thing.
 */
import RULES from "../../../shared/desk-rules.json";

export const FC = RULES.fastChain;
const BANDS = ["C", "B", "B+", "A-", "A", "A+"];
const rank = (b: string | null | undefined) => BANDS.indexOf(String(b ?? ""));
export interface FastSnap {
  band?: string | null; symbol?: string | null; side?: string | null; entry?: number | null; stop_px?: number | null; first_target?: number | null;
  px?: number | null; atr?: number | null; brain_symbol?: string | null; brain_side?: string | null; bias1h?: string | null; bias4h?: string | null; expMin?: number | null;
  t2?: number | null; desk_ticket_side?: string | null;
}
/** [name, ok] in the watcher's order (persistence needs the clock and is checked by the watcher). */
export function fastSetupRows(s: FastSnap): [string, boolean][] {
  const r: [string, boolean][] = [];
  r.push(["band", rank(s.band) >= rank(FC.minBand) && rank(s.band) >= 0]);
  const { entry: e, stop_px: st, first_target: t1, side } = s;
  const sides = e != null && st != null && t1 != null && ((side === "long" && st < e && e < t1) || (side === "short" && t1 < e && e < st));
  const rr = sides ? Math.abs(t1! - e!) / Math.abs(e! - st!) : null;
  r.push(["fast:plan", Boolean(sides && rr! >= FC.rrMin)]);
  const okE = s.px != null && e != null && !!s.atr && Math.abs(s.px - e) <= FC.entryAtr * s.atr && (st == null || (side === "short" ? s.px < st : s.px > st));
  r.push(["fast:entry", Boolean(okE)]);
  const opposite = s.brain_symbol === s.symbol && (s.brain_side === "long" || s.brain_side === "short") && s.brain_side !== side;
  const want = side === "long" ? "bull" : "bear";
  const both = s.bias1h != null && s.bias4h != null && s.bias1h !== want && s.bias4h !== want;
  r.push(["fast:agree", !opposite && !both]);
  // fast:geometry (twin of watcher geometry_row; Floor review 2026-10-13 19:28 ET): long stop<entry<T1(<T2) / short reversed, desk ticket side = card side.
  const L = side === "long";
  const ord = (side === "long" || side === "short") && e != null && st != null && t1 != null && (L ? st < e && e < t1 : st > e && e > t1);
  const t2ok = s.t2 == null || t1 == null || (L ? s.t2 > t1 : s.t2 < t1);
  const dsOk = s.desk_ticket_side == null || s.desk_ticket_side === (L ? "call" : "put");
  r.push(["fast:geometry", Boolean(ord && t2ok && dsOk)]);
  r.push(["fast:velocity", s.expMin != null && s.expMin <= FC.maxMinutesToT1]);
  return r;
}
