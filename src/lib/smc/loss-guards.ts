/**
 * Loss-pattern guards (Keaton 2026-10-13; audit of the 83-trade / 9-session backtest).
 * Pure functions, every number from shared/desk-rules.json `loss.*`. The desk build applies them to
 * candidates (q / band / plan / watch row), the brain and Floor read the resulting card, and the
 * watcher mirrors the same rules in watcher/gates.py (loss_* functions; parity test both sides).
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";

type Side = "long" | "short";
type Bias = string | null | undefined;
export const LOSS = RULES.loss;
const BANDS = ["A+", "A", "A-", "B+", "B", "C"] as const;
const rank = (b: string | null | undefined) => { const i = BANDS.indexOf(String(b) as never); return i < 0 ? 99 : i; };

/** 1) 1h AND 4h both against the side. */
export function htfGuard(side: Side, bias1h: Bias, bias4h: Bias, band: string | null | undefined, sweep: boolean, displacement: boolean) {
  const want = side === "long" ? "bull" : "bear";
  const opp = (b: Bias) => b === "bull" || b === "bear" ? b !== want : false;
  const both = opp(bias1h) && opp(bias4h);
  if (!both) return { bothOppose: false, block: false, sizeMult: 1, capBand: null as string | null, why: null as string | null };
  if (rank(band) > rank(LOSS.htf.minBand))
    return { bothOppose: true, block: true, sizeMult: 0, capBand: null, why: `1h ${bias1h} + 4h ${bias4h} oppose the ${side}: band ${band} under ${LOSS.htf.minBand} — blocked` };
  if (band === "A+" && LOSS.htf.aPlusNeedsSweepDisp && !(sweep && displacement))
    return { bothOppose: true, block: false, sizeMult: LOSS.htf.sizeMult, capBand: "A", why: `1h+4h oppose: A+ needs sweep+displacement (sweep=${sweep} disp=${displacement}) — capped A, size ×${LOSS.htf.sizeMult}` };
  // Accuracy ac6c36ee: both against is a CUT on every band that is not blocked, A+ with sweep+displacement included
  // (was full size). The safer side of the desk/watcher parity gap; the watcher's loss_htf matches.
  return { bothOppose: true, block: false, sizeMult: LOSS.htf.sizeMult, capBand: null,
    why: band === "A+" ? `1h+4h oppose: A+ with sweep+displacement — size ×${LOSS.htf.sizeMult} (cut, not full)` : `1h+4h oppose: ${band} size ×${LOSS.htf.sizeMult}` };
}

/** 2a) early exit: no minR favourable within `minutes` of the fill. mfePts = best favourable excursion so far. */
export function earlyExit(elapsedMin: number, mfePts: number, riskPts: number) {
  const r = riskPts > 0 ? mfePts / riskPts : 0;
  const cut = elapsedMin >= LOSS.early.minutes && r < LOSS.early.minR;
  return { cut, mfeR: +r.toFixed(2), why: cut ? `no ${LOSS.early.minR}R in ${LOSS.early.minutes}m (best ${r.toFixed(2)}R) — cut` : null };
}

/** 2b) expected velocity: minutes to T1 at the last-hour pace. */
export function velocityRead(m1closed: OhlcBar[], entry: number, t1: number | null) {
  const w = m1closed.slice(-LOSS.velocity.lookbackMin);
  if (t1 == null || w.length < 10) return { expMin: null as number | null, penalty: 0, why: null as string | null };
  const rng = Math.max(...w.map((b) => b.h)) - Math.min(...w.map((b) => b.l));
  const pace = rng / w.length;
  const expMin = pace > 0 ? +(Math.abs(t1 - entry) / pace).toFixed(1) : Infinity;
  const slow = expMin > LOSS.velocity.maxMin;
  return { expMin, penalty: slow ? LOSS.velocity.qPenalty : 0, why: slow ? `T1 ~${expMin}m away at the last-hour pace (> ${LOSS.velocity.maxMin}m): −${LOSS.velocity.qPenalty} q` : null };
}

/** 3) stop beyond the structural swing / sweep wick + buffer; |entry-stop| never under the floor. */
export function bufferedStop(side: Side, entry: number, structural: number | null, atr: number, tick = 0.25) {
  const buf = Math.max(LOSS.stop.bufferAtr * atr, 0);
  const floorDist = Math.max(RULES.minStopAtr, LOSS.stop.maePctAtr) * atr;
  const s = side === "long" ? -1 : 1;
  let stop = structural != null && (side === "long" ? structural < entry : structural > entry) ? structural + s * buf : entry + s * floorDist;
  if (Math.abs(stop - entry) < floorDist) stop = entry + s * floorDist;
  stop = Math.round(stop / tick) * tick;
  return +stop.toFixed(2);
}

/** 4) late entry vs the trigger level. */
export function lateGuard(price: number | null, level: number | null, atr: number | null, fullLateRulePasses: boolean) {
  if (price == null || level == null || !(atr! > 0)) return { late: false, block: false, distAtr: null as number | null, why: null as string | null };
  const d = Math.abs(price - level) / atr!;
  const late = d > LOSS.late.maxAtr;
  return { late, block: late && !fullLateRulePasses, distAtr: +d.toFixed(2),
    why: late ? `price ${d.toFixed(2)}×ATR past the level (> ${LOSS.late.maxAtr})${fullLateRulePasses ? " — full late-entry rule passes" : " — late, blocked"}` : null };
}

/**
 * 4b) the option leg of the full late-entry rule (lateEntry.pnlMinPct), same formula as the watcher's
 * entry_distance_check: |delta| x |T1 - px| x spot/px x 100 >= pnlMinPct x ask x 100 (per contract).
 * Missing inputs fail closed. The Floor applies it; ARMED is the Floor verdict the watcher also requires.
 */
export function latePnlCheck(o: { px: number | null; t1: number | null; spot: number | null; delta: number | null; askEach: number | null }) {
  const min = (RULES as { lateEntry: { pnlMinPct: number } }).lateEntry.pnlMinPct;
  const { px, t1, spot, delta, askEach } = o;
  if (px == null || !(px > 0) || t1 == null || spot == null || !(spot > 0) || delta == null || !(askEach! > 0)) {
    return { ok: false, pnl: null as number | null, why: `late entry: option PnL at T1 unknown (px=${px} t1=${t1} spot=${spot} delta=${delta} ask=${askEach})` };
  }
  const pnl = +(Math.abs(delta) * Math.abs(t1 - px) * spot / px * 100).toFixed(2);
  const need = +(min * askEach! * 100).toFixed(2);
  return { ok: pnl >= need, pnl, why: `late entry: option PnL@T1 $${pnl}/ct ${pnl >= need ? ">=" : "<"} ${Math.round(min * 100)}% of $${need / min}` };
}

/**
 * lateEntry.modelPricePending: a latePnlCheck miss is deferred to the watcher (ticket kept ARMED with
 * latePnlPending=true) only when the check could be computed (pnl != null) and the price is model-based
 * (no live chain quote). A miss on a live quote, or missing inputs, still drops the ticket.
 */
export function latePnlPendingOk(lp: { ok: boolean; pnl: number | null }, modelPriced: boolean): boolean {
  const on = (RULES as { lateEntry: { modelPricePending?: boolean } }).lateEntry.modelPricePending === true;
  return on && !lp.ok && lp.pnl != null && modelPriced;
}

/** 5) chop: range, 5m overlap and failed breaks of the prior range. */
export function chopRead(m1closed: OhlcBar[], atr: number | null) {
  const w = m1closed.slice(-LOSS.chop.lookbackMin);
  if (w.length < 30 || !(atr! > 0)) return { chop: false, score: 0, rangeAtr: null as number | null, overlap: null as number | null, failedBreaks: 0, why: null as string | null };
  const hi = Math.max(...w.map((b) => b.h)), lo = Math.min(...w.map((b) => b.l));
  const rangeAtr = (hi - lo) / atr!;
  const b5: OhlcBar[] = [];
  for (const b of w) { const k = Math.floor(b.t / 300_000); const L = b5[b5.length - 1]; if (L && Math.floor(L.t / 300_000) === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; } else b5.push({ ...b }); }
  let ov = 0, n = 0, fb = 0;
  for (let i = 1; i < b5.length; i++) {
    const a = b5[i - 1]!, b = b5[i]!;
    const inter = Math.min(a.h, b.h) - Math.max(a.l, b.l), uni = Math.max(a.h, b.h) - Math.min(a.l, b.l);
    if (uni > 0) { ov += Math.max(0, inter) / uni; n++; }
    const pH = Math.max(...b5.slice(0, i).map((x) => x.h)), pL = Math.min(...b5.slice(0, i).map((x) => x.l));
    if ((b.h > pH && b.c <= pH) || (b.l < pL && b.c >= pL)) fb++;
  }
  const overlap = n ? ov / n : 0;
  const score = Number(rangeAtr < LOSS.chop.rangeAtr) + Number(overlap > LOSS.chop.overlap) + Number(fb >= LOSS.chop.failedBreaks);
  const chop = score >= LOSS.chop.needScore;
  return { chop, score, rangeAtr: +rangeAtr.toFixed(2), overlap: +overlap.toFixed(2), failedBreaks: fb,
    why: chop ? `chop ${score}/3: 60m range ${rangeAtr.toFixed(2)}×ATR, 5m overlap ${overlap.toFixed(2)}, failed breaks ${fb} — band capped ${LOSS.chop.capBand}` : null };
}

/** 6a) T1 must be a ranked liquidity draw. 6b) breakeven at beFrac of the way. */
export function rankedT1(t1: number | null, t2: number | null, ranked: { price: number; rank: number; swept?: boolean }[], tick = 0.25) {
  const is = (p: number | null) => p != null && ranked.some((d) => !d.swept && d.rank >= LOSS.target.minRank && Math.abs(d.price - p) <= tick + 1e-9);
  if (is(t1)) return { ok: true, t1, t2, promoted: false, why: null as string | null };
  if (is(t2)) return { ok: true, t1: t2, t2: null, promoted: true, why: `T1 ${t1} is not a ranked draw — T2 ${t2} promoted` };
  return { ok: false, t1, t2, promoted: false, why: `T1 ${t1} is not a ranked liquidity draw — watch` };
}
export function breakevenDue(side: Side, entry: number, t1: number, bestPx: number) {
  const prog = (side === "long" ? bestPx - entry : entry - bestPx) / Math.abs(t1 - entry);
  return prog >= LOSS.target.beFrac;
}

/** 7) projected option net at T1, $ per share of premium. */
export function optionNetAtT1(symbol: string, entry: number, t1: number, expMin: number | null, o?: { delta?: number; thetaPerMin?: number; spread?: number; ratio?: number }) {
  const ratio = o?.ratio ?? (LOSS.option.ratio as Record<string, number>)[symbol] ?? null;
  if (ratio == null || expMin == null || !Number.isFinite(expMin)) return { net: null as number | null, ok: false, why: `option net unknown (ratio=${ratio} expMin=${expMin})` };
  const gross = Math.abs(o?.delta ?? LOSS.option.delta) * Math.abs(t1 - entry) * ratio;
  const net = +(gross - (o?.thetaPerMin ?? LOSS.option.thetaPerMin) * expMin - (o?.spread ?? LOSS.option.spread)).toFixed(4);
  return { net, ok: net > LOSS.option.minNet, why: `option net at T1 ${net} (gross ${gross.toFixed(3)}, ${expMin}m theta, spread)` };
}
