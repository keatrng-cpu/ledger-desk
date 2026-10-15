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
  t2?: number | null; desk_ticket_side?: string | null; plan_fvg_failed?: boolean | null; strategy_invalidated?: boolean | null;
}
/** [name, ok] in the watcher's order (persistence needs the clock and is checked by the watcher). */
export function fastSetupRows(s: FastSnap): [string, boolean][] {
  const r: [string, boolean][] = [];
  r.push(["band", rank(s.band) >= rank(FC.minBand) && rank(s.band) >= 0]);
  const { entry: e, stop_px: st, side } = s;
  const t1 = gateTarget(s).target;
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
  const ft = s.first_target; // geometry is on the card's own T1 (the first scale-out), not the ladder target
  const ord = (side === "long" || side === "short") && e != null && st != null && ft != null && (L ? st < e && e < ft : st > e && e > ft);
  const t2ok = s.t2 == null || ft == null || (L ? s.t2 > ft : s.t2 < ft);
  const dsOk = s.desk_ticket_side == null || s.desk_ticket_side === (L ? "call" : "put");
  r.push(["fast:geometry", Boolean(ord && t2ok && dsOk)]);
  // fire-unblock 10/15: a plan sitting on an FVG the desk marks failed is dropped (finding #30).
  if ((FC as { planHysteresis?: { dropFailedFvg?: boolean } }).planHysteresis?.dropFailedFvg && s.plan_fvg_failed) r[1] = ["fast:plan", false];
  // fire-unblock 10/15: velocity is soft (one-step size cut, see velocitySoftRow), not a block.
  if (!velocitySoft()) r.push(["fast:velocity", velocityOk(s)]);
  return r;
}

/**
 * Target ladder (fire-unblock 10/15, Keaton 09:59 CT ES long 7757.13/7743.25: T1 7772.75 at R:R 1.13 read "too close"
 * while T2 7780.25 was there; price ran 7775.5+). When T1 R:R < t1RrBelow and the next ranked target (T2) gives
 * R:R >= nextRrMin (and T1 R:R >= t1RrMin), the R:R / velocity / chase gates use T2; option EV stays on T1; T1 stays the
 * first scale-out. Desk-wide (build-desk loss guards, watcher gate_tgt) only when fastChain.mode is live. Twin: watcher fastchain.gate_target.
 */
export function gateTarget(s: { entry?: number | null; stop_px?: number | null; first_target?: number | null; t2?: number | null; side?: string | null }): { target: number | null; which: "t1" | "t2"; rr: number | null } {
  const L = (FC as { targetLadder?: { t1RrMin?: number; t1RrBelow: number; nextRrMin: number } }).targetLadder;
  const { entry: e, stop_px: st, first_target: t1, t2, side } = s;
  const rrOf = (t: number | null | undefined) => (e == null || st == null || t == null || e === st ? null : (side === "short" ? e - t : t - e) / Math.abs(e - st));
  const r1 = rrOf(t1);
  if (L && r1 != null && r1 >= (L.t1RrMin ?? 0.6) && r1 < L.t1RrBelow && t2 != null && t1 != null && (side === "short" ? t2 < t1 : t2 > t1)) {
    const r2 = rrOf(t2);
    if (r2 != null && r2 >= L.nextRrMin) return { target: t2, which: "t2", rr: r2 };
  }
  return { target: t1 ?? null, which: "t1", rr: r1 };
}

export const fastLive = () => (FC as { mode?: string }).mode === "live";
export const velocitySoft = () => (FC as { velocityMode?: string }).velocityMode === "soft";
export const velocityOk = (s: FastSnap) => s.expMin != null && s.expMin <= FC.maxMinutesToT1;
/** Soft velocity row (ok always true) + whether it asks for the one-step size cut. */
export function velocitySoftRow(s: FastSnap): { row: [string, boolean]; sizeCut: boolean } {
  return { row: ["soft:fast:velocity", true], sizeCut: !velocityOk(s) };
}

/** Persist invalidation (twin of watcher fastchain.invalidated): price through the stop, or T1 already traded. */
export function invalidated(s: FastSnap): boolean {
  const { px, stop_px: st, first_target: t1, side } = s;
  if (px == null || (side !== "long" && side !== "short")) return false;
  if (st != null && (side === "short" ? px >= st : px <= st)) return true;
  if (t1 != null && (side === "short" ? px <= t1 : px >= t1)) return true;
  return false;
}

export const START_EXEMPT = ["fast:entry", "fast:velocity"];
export interface FastStreak { key: string | null; sinceMs: number | null; cards: number; lastAt: string | null; dips: number; lastGoodMs: number | null }
const DIP = (FC as { persistDip?: { maxCards?: number; maxS?: number } }).persistDip ?? {};
/**
 * Hold keyed per symbol:side (twin of watcher fastchain.streak_next; review F1). The qualifying conditions (band, plan,
 * agree, geometry) must hold CONTINUOUSLY for minHoldS: a dip is tolerated only for <= persistDip.maxCards consecutive
 * cards AND <= persistDip.maxS since the last qualifying card; longer resets. Also resets on symbol/side change,
 * invalidation (through the stop / T1 traded) and the desk's strategy.invalidated (PR #19).
 * Root cause of the live "held None over 0 cards": the old hold only started when every row passed at once (fast:entry
 * fails on nearly every poll once price displaces) and any failed row reset it. Replaces fireFix.persistGrace.
 */
export function streakNext(prev: FastStreak | null, s: FastSnap & { at?: string | null; strategy_invalidated?: boolean | null }, nowMs: number): FastStreak {
  const empty: FastStreak = { key: null, sinceMs: null, cards: 0, lastAt: null, dips: 0, lastGoodMs: null };
  const key = `${s.symbol}:${s.side}`;
  if (s.strategy_invalidated === true || invalidated(s)) return empty;
  const good = fastSetupRows(s).every(([n, ok]) => ok || START_EXEMPT.includes(n));
  if (prev && prev.key === key && prev.sinceMs != null) {
    const cards = prev.cards + (s.at !== prev.lastAt ? 1 : 0);
    if (good) return { key, sinceMs: prev.sinceMs, cards, lastAt: s.at ?? null, dips: 0, lastGoodMs: nowMs };
    const dips = (prev.dips ?? 0) + 1;
    const lg = prev.lastGoodMs ?? prev.sinceMs;
    if (dips <= (DIP.maxCards ?? 1) && (nowMs - lg) / 1000 <= (DIP.maxS ?? 5)) return { key, sinceMs: prev.sinceMs, cards, lastAt: s.at ?? null, dips, lastGoodMs: lg };
    return empty;
  }
  if (!good) return empty;
  return { key, sinceMs: nowMs, cards: 1, lastAt: s.at ?? null, dips: 0, lastGoodMs: nowMs };
}
/** Seconds held, counted to the last qualifying card (a tolerated dip adds no hold time). */
export const heldS = (st: FastStreak | null, nowMs: number) => (st?.sinceMs == null ? null : (Math.min(nowMs, st.lastGoodMs ?? nowMs) - st.sinceMs) / 1000);
export const persistOk = (st: FastStreak | null, nowMs: number) => { const h = heldS(st, nowMs); return h != null && h >= FC.minHoldS; };
