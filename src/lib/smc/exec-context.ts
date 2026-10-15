/**
 * Execution context shared by scanner, brain, Floor and the Master seat:
 * displacement strength (fix 20), ranked draws (fix 7/8), exit plan (16–18).
 * Every number is read from bars the desk already loaded. No bars → null.
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";
import { fractalSwings, rollingAtr } from "@/lib/trading/detectors";
import { resampleMs } from "@/lib/trading/tf-ladder";
import { mtfArrays } from "./mtf-arrays";
import type { DrawRead, LiquidityTarget } from "@/lib/trading/draw";

type Side = "long" | "short";

export interface DisplacementStrength {
  /** 0..1 */
  score: number;
  bodyAtr: number;
  leftFvg: boolean;
  closeFrac: number;
  tf: "5m";
  ageBars: number;
  /** SHADOW (rules fast.shadow): velocity = strongest 1m body inside the leg / ATR1m-equivalent; volBurst = leg volume
   *  / median of the prior 20 5m bars (null when the feed has no volume). shadowScore folds them in; NOT used for q. */
  velocity?: number | null; volBurst?: number | null; shadowScore?: number | null;
}

/**
 * Fix 20: the strongest 5m displacement in the side's direction over the last
 * 12 closed 5m bars. score = 0.5·min(body/ATR ÷ 2, 1) + 0.25·(left an FVG)
 * + 0.25·(closed in the outer 25% of its range).
 */
export function displacementStrength(minute: OhlcBar[] | null | undefined, side: Side): DisplacementStrength | null {
  const m = (minute ?? []).slice(0, -1);
  if (m.length < 60) return null;
  const b5 = resampleMs(m, 300_000).slice(0, -1);
  if (b5.length < 16) return null;
  const atr = rollingAtr(b5);
  let best: DisplacementStrength | null = null;
  for (let i = Math.max(2, b5.length - 12); i < b5.length; i++) {
    const b = b5[i]!;
    const a = atr[i];
    if (!(a! > 0)) continue;
    const body = side === "long" ? b.c - b.o : b.o - b.c;
    if (body <= 0) continue;
    const rng = b.h - b.l || 1e-9;
    const closeFrac = side === "long" ? (b.c - b.l) / rng : (b.h - b.c) / rng;
    const nx = b5[i + 1];
    const leftFvg = nx ? (side === "long" ? nx.l > b5[i - 1]!.h : nx.h < b5[i - 1]!.l) : false;
    const bodyAtr = body / a!;
    const score = +(0.5 * Math.min(bodyAtr / 2, 1) + (leftFvg ? 0.25 : 0) + (closeFrac >= 0.75 ? 0.25 : 0)).toFixed(2);
    const inLeg = m.filter((x) => x.t >= b.t && x.t < b.t + 300_000);
    const vel = inLeg.length ? Math.max(...inLeg.map((x) => (side === "long" ? x.c - x.o : x.o - x.c))) / (a! / Math.sqrt(5)) : null;
    const prior = b5.slice(Math.max(0, i - 20), i).map((x) => x.v ?? 0).filter((v) => v > 0).sort((p, q) => p - q);
    const med = prior.length ? prior[Math.floor(prior.length / 2)]! : 0;
    const volBurst = med > 0 && (b.v ?? 0) > 0 ? +((b.v ?? 0) / med).toFixed(2) : null;
    const shadowScore = +(score * (1 - RULES.fast.dispVelWeight - RULES.fast.dispVolWeight)
      + RULES.fast.dispVelWeight * Math.min(Math.max(vel ?? 0, 0), 1)
      + RULES.fast.dispVolWeight * (volBurst == null ? 0 : Math.min(Math.max((volBurst - 1) / 2, 0), 1))).toFixed(2);
    if (!best || score > best.score) best = { score, bodyAtr: +bodyAtr.toFixed(2), leftFvg, closeFrac: +closeFrac.toFixed(2), tf: "5m", ageBars: b5.length - 1 - i,
      velocity: vel == null ? null : +vel.toFixed(2), volBurst, shadowScore };
  }
  return best;
}

export interface RankedDraw {
  name: string;
  price: number;
  side: string;
  scope: "internal" | "external" | null;
  touches: number;
  ageBars: number | null;
  distanceAtr: number;
  swept: boolean;
  rank: number;
}

/**
 * Fix 7/8: every draw the desk priced, ranked. rank = draw score
 * + 0.1·min(touches−1, 3) (equal highs/lows rest more stops) − 0.002·age.
 * touches/age come off the 15m bars (wick within 0.1·ATR of the level).
 */
export function rankDraws(draw: DrawRead | null | undefined, bars15: OhlcBar[]): RankedDraw[] {
  if (!draw) return [];
  const pool = [draw.primary, draw.above, draw.below, ...draw.alternates].filter((x): x is LiquidityTarget => x != null);
  const seen = new Set<string>();
  const tol = (draw.atr || 1) * 0.1;
  const out: RankedDraw[] = [];
  for (const d of pool) {
    const k = `${d.name}@${d.price}`;
    if (seen.has(k)) continue;
    seen.add(k);
    // R3-d: touches = SWING highs/lows within tol over the last session
    // (TOUCH_WINDOW 15m bars), not every bar of the month that grazed it.
    const win = bars15.slice(-TOUCH_WINDOW);
    const sw = fractalSwings(win, 2).filter((p) => Math.abs(p.price - d.price) <= tol);
    const touches = sw.length;
    const first = sw.length ? sw[0]!.index : null;
    const ageBars = first == null ? null : win.length - 1 - first;
    const scope = /external/i.test(d.name) ? "external" : /internal/i.test(d.name) ? "internal" : null;
    const rank = +(d.score + 0.1 * Math.min(Math.max(touches - 1, 0), 3) - 0.002 * (ageBars ?? 0)).toFixed(3);
    out.push({ name: d.name, price: d.price, side: String(d.side), scope, touches, ageBars, distanceAtr: +d.distanceAtr.toFixed(2), swept: d.swept, rank });
  }
  return out.sort((a, b) => b.rank - a.rank);
}

export interface ExitPlan {
  trailRule: string;
  /** Live trail level: last 3m swing beyond price (null until one prints). */
  trailPx: number | null;
  /** Exit if T1 has not printed within this many trigger bars. */
  timeStopBars: number;
  timeStopTf: "5m";
  /** True when the LTF kill is live against this side: exit an open position. */
  killExit: boolean;
  killWhy: string | null;
}

export const TIME_STOP_BARS = 12;
/** One Globex session of 15m bars. */
export const TOUCH_WINDOW = 92;

/** Fix 16–18. */
export function exitPlanOf(minute: OhlcBar[] | null | undefined, side: Side, price: number | null, kill: { why: string[] } | null): ExitPlan {
  const m = (minute ?? []).slice(0, -1);
  let trailPx: number | null = null;
  if (m.length >= 30 && price != null) {
    const b3 = resampleMs(m, 180_000).slice(0, -1);
    const sw = fractalSwings(b3, 2).filter((s) => (side === "long" ? s.kind === "low" && s.price < price : s.kind === "high" && s.price > price));
    trailPx = sw.length ? sw[sw.length - 1]!.price : null;
  }
  return {
    trailRule: `After T1: stop to breakeven, then trail ${side === "long" ? "under" : "over"} the last 3m swing ${side === "long" ? "low" : "high"} (1m swing once within 0.5R of T2)`,
    trailPx,
    timeStopBars: TIME_STOP_BARS,
    timeStopTf: "5m",
    killExit: Boolean(kill),
    killWhy: kill?.why[0] ?? null,
  };
}

export const CONT_MIN_DISP = 0.6;
export const CONT_MIN_STOP_ATR = RULES.minStopAtr;

export interface ContinuationPlan {
  symbol: string;
  side: Side;
  entry: number;
  entryZone: { top: number; bottom: number };
  stop: number;
  stopWhy: string;
  riskPts: number;
  t1: number | null;
  t2: number | null;
  rr1: number | null;
  rr2: number | null;
  atr: number | null;
  resting: boolean;
  why: string;
}

/**
 * Fix 34. Needs: displacement ≥ 0.6, ≥ 2 live same-direction FVG/IFVG on
 * 1m/3m (stacked), a ranked draw beyond the entry. Else null — never a guess.
 */
export function continuationPlan(
  symbol: string,
  side: Side,
  minute: OhlcBar[] | null | undefined,
  bars15: OhlcBar[],
  price: number | null,
  draws: RankedDraw[],
  disp: number | null,
  extra: RankedDraw[] = [],
): ContinuationPlan | null {
  if (price == null || disp == null || disp < CONT_MIN_DISP || !minute?.length) return null;
  const dir = side === "long" ? "bull" : "bear";
  const rows = mtfArrays(symbol, minute, [])
    .filter((r) => (r.tf === "1m" || r.tf === "3m") && r.dir === dir && !r.mitigated)
    // a gap the price is still on the right side of (pullback INTO it is the entry)
    .filter((r) => (side === "short" ? r.lo >= price : r.hi <= price))
    .sort((a, b) => a.ageBars - b.ageBars);
  if (rows.length < 2) return null;
  const g = rows[0]!;
  const atrs = rollingAtr(bars15);
  const atr = atrs.length ? atrs[atrs.length - 1]! : null;
  if (!(atr != null && atr > 0)) return null;
  const entry = +g.ce.toFixed(2);
  const m = minute.slice(0, -1);
  const b3 = resampleMs(m, 180_000).slice(0, -1);
  const sw = fractalSwings(b3, 2).filter((s) => (side === "short" ? s.kind === "high" && s.price > g.hi : s.kind === "low" && s.price < g.lo));
  const swing = sw.length ? sw[sw.length - 1]!.price : null;
  const edge = side === "short" ? g.hi : g.lo;
  // Stop beyond the candle(s) that FORMED the newest gap (its 3-bar pattern on
  // the gap's own tf, read from closed 1m bars) — the tightest real structure.
  // Falls back to the 3m LH/HL, then the gap's far edge.
  const tfMs = g.tf === "3m" ? 180_000 : 60_000;
  const origin = m.filter((b) => b.t >= g.createdT - 2 * tfMs && b.t < g.createdT + tfMs);
  const originPx = origin.length
    ? side === "short" ? Math.max(...origin.map((b) => b.h)) : Math.min(...origin.map((b) => b.l))
    : null;
  const originOk = originPx != null && (side === "short" ? originPx > g.hi - 1e-9 : originPx < g.lo + 1e-9);
  const structural = originOk ? originPx! : swing ?? edge;
  const minStop = side === "short" ? entry + CONT_MIN_STOP_ATR * atr : entry - CONT_MIN_STOP_ATR * atr;
  const stop = +(side === "short" ? Math.max(structural + 0.25, minStop) : Math.min(structural - 0.25, minStop)).toFixed(2);
  const riskPts = +Math.abs(entry - stop).toFixed(2);
  const ahead = draws
    .filter((d) => (side === "short" ? d.price < entry : d.price > entry) && !d.swept)
    .sort((a, b) => b.rank - a.rank);
  const t1 = ahead[0]?.price ?? null;
  const t2 = ahead.find((d) => (side === "short" ? d.price < (t1 ?? entry) : d.price > (t1 ?? entry)))?.price ?? null;
  if (t1 == null) return null;
  const rr = (t: number | null) => (t == null ? null : +(Math.abs(t - entry) / riskPts).toFixed(2));
  const beyond = (d: RankedDraw, t: number) => (side === "short" ? d.price < t : d.price > t);
  const ext0 = extra.filter((d) => beyond(d, t1));
  // Both under 1R: step out to the next EXTERNAL ranked draw beyond them
  // (PDL/PWL/session low…). A real level from the ranked list, or nothing.
  let tA = t1, tB = t2;
  if ((rr(tA) ?? 0) < 1 && (rr(tB) ?? 0) < 1) {
    const far = side === "short" ? Math.min(tA, tB ?? tA) : Math.max(tA, tB ?? tA);
    const ext = [...ahead, ...ext0]
      .filter((d) => (side === "short" ? d.price < far : d.price > far))
      .filter((d) => d.scope === "external" || /\b(PDL|PDH|PWL|PWH|London|Asia|session|overnight)\b/i.test(d.name))
      .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0];
    if (ext) { tB = tA; tA = ext.price; }
  }
  if (tB == null && ext0.length) tB = [...ext0].sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0]!.price;
  const resting = Math.abs(price - entry) > CONT_MIN_STOP_ATR * atr;
  return {
    symbol, side, entry, entryZone: { top: g.hi, bottom: g.lo }, stop,
    stopWhy: originOk ? `the ${g.tf} candle that formed the gap ${originPx}` : swing != null ? `the last 3m swing ${side === "short" ? "high (LH)" : "low (HL)"} ${swing}` : `the ${g.tf} gap's far edge ${edge}`,
    riskPts, t1: tA, t2: tB === tA ? null : tB, rr1: rr(tA), rr2: rr(tB === tA ? null : tB), atr: +atr.toFixed(2), resting,
    why: `${rows.length} stacked ${dir} gaps on 1m/3m, newest ${g.tf} ${g.lo}–${g.hi} CE ${entry}; displacement ${disp}; T1 ${tA}${tA !== t1 ? ` (stepped out to external; ranked T1 ${t1} was < 1R)` : ""}`,
  };
}

/**
 * Fix 33: price a plan from an entry gap and a structural stop reference
 * (e.g. the swept high). Same stop floor (0.5×ATR) and target rules as the
 * continuation plan. Null without a ranked draw beyond the entry.
 */
export function planAt(
  symbol: string, side: Side, gap: { lo: number; hi: number; ce: number }, stopRef: number, stopWhy: string,
  price: number | null, draws: RankedDraw[], atr: number | null, why: string, extra: RankedDraw[] = [],
): ContinuationPlan | null {
  if (price == null || atr == null || !(atr > 0)) return null;
  const entry = +gap.ce.toFixed(2);
  const minStop = side === "short" ? entry + CONT_MIN_STOP_ATR * atr : entry - CONT_MIN_STOP_ATR * atr;
  const stop = +(side === "short" ? Math.max(stopRef + 0.25, minStop) : Math.min(stopRef - 0.25, minStop)).toFixed(2);
  const riskPts = +Math.abs(entry - stop).toFixed(2);
  if (!(riskPts > 0)) return null;
  const ahead = draws.filter((d) => (side === "short" ? d.price < entry : d.price > entry) && !d.swept).sort((a, b) => b.rank - a.rank);
  if (!ahead.length) return null;
  const rr = (t: number | null) => (t == null ? null : +(Math.abs(t - entry) / riskPts).toFixed(2));
  let t1 = ahead[0]!.price;
  let t2: number | null = ahead.find((d) => (side === "short" ? d.price < t1 : d.price > t1))?.price ?? null;
  const ext0 = extra.filter((d) => (side === "short" ? d.price < t1 : d.price > t1));
  if ((rr(t1) ?? 0) < 1 && (rr(t2) ?? 0) < 1) {
    const far = side === "short" ? Math.min(t1, t2 ?? t1) : Math.max(t1, t2 ?? t1);
    const ext = [...ahead, ...ext0]
      .filter((d) => (side === "short" ? d.price < far : d.price > far))
      .filter((d) => d.scope === "external" || /\b(PDL|PDH|PWL|PWH|London|Asia|session|overnight)\b/i.test(d.name))
      .sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0];
    if (ext) { t2 = t1; t1 = ext.price; }
  }
  if (t2 == null && ext0.length) t2 = [...ext0].sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0]!.price;
  return {
    symbol, side, entry, entryZone: { top: gap.hi, bottom: gap.lo }, stop, stopWhy, riskPts,
    t1, t2, rr1: rr(t1), rr2: rr(t2), atr: +atr.toFixed(2),
    resting: Math.abs(price - entry) > CONT_MIN_STOP_ATR * atr, why,
  };
}

/** Item 4: opening-range SD projections as EXTERNAL draws (used only beyond T1). */
export function sdDraws(sd: { up2: number; up25: number; dn2: number; dn25: number } | null | undefined, price: number | null): RankedDraw[] {
  if (!sd || price == null) return [];
  const mk = (name: string, p: number): RankedDraw => ({ name, price: p, side: p > price ? "above" : "below", scope: "external", touches: 0, ageBars: null, distanceAtr: null as never, swept: false, rank: 0.4 } as RankedDraw);
  return [mk("OR +2 SD", sd.up2), mk("OR +2.5 SD", sd.up25), mk("OR −2 SD", sd.dn2), mk("OR −2.5 SD", sd.dn25)];
}

/**
 * Keaton 2026-10-13: every displayed card carries a COMPLETE plan, or it is a
 * watch row. Fallback chain, each step a real level or nothing:
 *   entry  — nearest unfilled same-direction 1m–15m array (FVG/IFVG/sponsored
 *            CE, or OB/breaker CE) on the pullback side; else the 5m BOS
 *            retest level; else the opening-range edge on the pullback side.
 *   stop   — beyond the origin swing (the 1m extreme of the candles that
 *            formed the array / the nearest 5m swing beyond the level), ≥ 0.5×ATR15.
 *   target — best-ranked unswept draw beyond entry; else an OR SD projection;
 *            else the session (overnight + today) high/low.
 */
export interface CompleteInput {
  symbol: string; side: Side; price: number | null; atr: number | null;
  minute: OhlcBar[]; bars15: OhlcBar[]; draws: RankedDraw[]; sd: RankedDraw[];
  blocks: { kind: string; dir: string; lo: number; hi: number }[];
  bosLevel: number | null; orRange: { high: number; low: number } | null;
  sessionHL: { high: number; low: number } | null;
}
export interface CompletedPlan extends ContinuationPlan { entrySrc: string; targetSrc: string }

export function completePlan(i: CompleteInput): { plan: CompletedPlan | null; missing: string | null } {
  const { side, price, atr } = i;
  if (price == null) return { plan: null, missing: "no live price" };
  if (atr == null || !(atr > 0)) return { plan: null, missing: "no ATR15" };
  const dir = side === "long" ? "bull" : "bear";
  const pull = (lo: number, hi: number) => (side === "short" ? hi >= price : lo <= price); // zone at/above price for a short
  type Z = { lo: number; hi: number; ce: number; src: string; createdT?: number; tf?: string };
  const zones: Z[] = [];
  for (const r of mtfArrays(i.symbol, i.minute, i.bars15)) {
    if (r.dir !== dir || r.mitigated || !pull(r.lo, r.hi)) continue;
    if (!["1m", "2m", "3m", "4m", "5m", "15m"].includes(r.tf)) continue; // Keaton: 1m–15m
    zones.push({ lo: r.lo, hi: r.hi, ce: r.ce, src: `${r.tf} ${r.kind}`, createdT: r.createdT, tf: r.tf });
  }
  for (const b of i.blocks) {
    if ((b.kind !== "ob" && b.kind !== "breaker") || b.dir !== dir || !pull(b.lo, b.hi)) continue;
    zones.push({ lo: b.lo, hi: b.hi, ce: +((b.lo + b.hi) / 2).toFixed(2), src: `5m ${b.kind}` });
  }
  const dist = (z: Z) => Math.abs(z.ce - price);
  zones.sort((a, b) => dist(a) - dist(b));
  let z: Z | null = zones[0] ?? null;
  if (!z && i.bosLevel != null && pull(i.bosLevel, i.bosLevel)) z = { lo: i.bosLevel, hi: i.bosLevel, ce: i.bosLevel, src: "5m BOS retest" };
  if (!z && i.orRange) {
    const edge = side === "short" ? i.orRange.high : i.orRange.low;
    if (pull(edge, edge)) z = { lo: edge, hi: edge, ce: edge, src: `opening-range ${side === "short" ? "high" : "low"}` };
  }
  if (!z) return { plan: null, missing: "no entry level on the pullback side (no array, BOS retest or OR edge)" };
  const entry = +z.ce.toFixed(2);
  // origin swing
  const m = i.minute.slice(0, -1);
  let origin: number | null = null;
  if (z.createdT != null) {
    const tfMs = (Number(String(z.tf).replace(/[mh]/, "")) || 1) * (String(z.tf).endsWith("h") ? 3_600_000 : 60_000);
    const o = m.filter((b) => b.t >= z!.createdT! - 2 * tfMs && b.t < z!.createdT! + tfMs);
    if (o.length) origin = side === "short" ? Math.max(...o.map((b) => b.h)) : Math.min(...o.map((b) => b.l));
  }
  if (origin == null || (side === "short" ? origin < z.hi : origin > z.lo)) {
    const b5 = resampleMs(m, 300_000).slice(0, -1);
    const sw = fractalSwings(b5, 2).filter((s) => (side === "short" ? s.kind === "high" && s.price > z!.hi : s.kind === "low" && s.price < z!.lo));
    origin = sw.length ? sw.sort((a, b) => Math.abs(a.price - entry) - Math.abs(b.price - entry))[0]!.price : null;
  }
  const ref = origin ?? (side === "short" ? z.hi : z.lo);
  const stopWhy = origin != null ? `the origin swing ${origin}` : `the ${z.src} far edge`;
  const sess: RankedDraw[] = i.sessionHL
    ? [{ name: "Session high", price: i.sessionHL.high, side: "above", scope: "external", touches: 0, ageBars: null, distanceAtr: null as never, swept: false, rank: 0.3 } as RankedDraw,
       { name: "Session low", price: i.sessionHL.low, side: "below", scope: "external", touches: 0, ageBars: null, distanceAtr: null as never, swept: false, rank: 0.3 } as RankedDraw]
    : [];
  const beyond = (d: RankedDraw) => (side === "short" ? d.price < entry : d.price > entry) && !d.swept;
  let pool = i.draws.filter(beyond), targetSrc = "ranked draw";
  if (!pool.length) { pool = i.sd.filter(beyond); targetSrc = "OR SD projection"; }
  if (!pool.length) { pool = sess.filter(beyond); targetSrc = "session high/low"; }
  if (!pool.length) return { plan: null, missing: "no target beyond the entry (no ranked draw, SD projection or session extreme)" };
  const p = planAt(i.symbol, side, { lo: z.lo, hi: z.hi, ce: entry }, ref, stopWhy, price, pool, atr, `entry ${z.src} CE ${entry}; target from ${targetSrc}`, targetSrc === "ranked draw" ? i.sd.filter(beyond) : []);
  if (!p) return { plan: null, missing: "plan did not price" };
  return { plan: { ...p, entrySrc: z.src, targetSrc }, missing: null };
}

/**
 * Keaton 2026-10-13 (live 12:33 CT: MNQ short entry 30735.13, stop 30738.75
 * = 3.6 pt vs ATR15 45.9 → "rr 13.12"): no fake stops, targets or R:R.
 *  1. stop ≥ 0.5×ATR15 from entry; a tighter stop is widened to the nearest
 *     real 5m swing beyond entry (or the 0.5×ATR floor) and R:R recomputed;
 *  2. T1 must be a real level (ranked draw / SD projection / session H/L);
 *     recomputed rr1 < 1.0 or an unreal T1 → not a card (watch row);
 *  3. displayed R:R capped at RR_DISPLAY_MAX; above it the plan is flagged.
 */
export const RR_DISPLAY_MAX = RULES.rrDisplayMax;
export const MIN_STOP_ATR = RULES.minStopAtr;
export const RR_MIN = RULES.rrMin;
export interface SaneResult {
  ok: boolean; why: string | null; widened: boolean; flagged: boolean;
  stop: number; riskPts: number; rr1: number | null; rr2: number | null; rrShown: number | null;
  /** T2 promoted to T1 because T1 was under RR_MIN (t1/t2 are the plan's new targets) */
  promoted?: boolean; t1?: number | null; t2?: number | null;
}
export function sanePlan(
  p: { side: "long" | "short"; entry: number; stop: number; t1: number | null; t2: number | null },
  atr: number | null, swings: number[], levels: number[], tick = 0.25,
  /** ltfArm live + t1FallbackNextPool: an unreal/null T1 falls back to the nearest REAL level (from `levels`) >= RR_MIN ahead. */
  fallbackNextPool = false,
): SaneResult {
  const short = p.side === "short";
  let stop = p.stop, widened = false;
  const bad = (why: string): SaneResult => ({ ok: false, why, widened, flagged: false, stop, riskPts: Math.abs(p.entry - stop), rr1: null, rr2: null, rrShown: null });
  if (atr == null || !(atr > 0)) return bad("no ATR15 to check the stop");
  if (short ? stop <= p.entry : stop >= p.entry) return bad("stop on the wrong side of entry");
  const floor = short ? p.entry + MIN_STOP_ATR * atr : p.entry - MIN_STOP_ATR * atr;
  if (Math.abs(stop - p.entry) < MIN_STOP_ATR * atr - 1e-9) {
    const beyond = swings.filter((s) => (short ? s > p.entry : s < p.entry)).sort((a, b) => Math.abs(a - p.entry) - Math.abs(b - p.entry));
    const sw = beyond.find((s) => Math.abs(s - p.entry) >= MIN_STOP_ATR * atr) ?? null;
    stop = +(sw != null ? (short ? sw + tick : sw - tick) : floor).toFixed(2);
    widened = true;
  }
  const riskPts = +Math.abs(p.entry - stop).toFixed(2);
  const real = (t: number | null) => t != null && levels.some((l) => Math.abs(l - t) <= tick + 1e-9);
  const rr = (t: number | null) => (t == null ? null : +((short ? p.entry - t : t - p.entry) / riskPts).toFixed(2));
  if (!real(p.t1) && fallbackNextPool) {
    const next = levels
      .filter((l) => (short ? l < p.entry : l > p.entry) && (rr(l) ?? 0) >= RR_MIN)
      .sort((a, b) => Math.abs(a - p.entry) - Math.abs(b - p.entry))[0];
    if (next != null) {
      const t2n = levels.filter((l) => (short ? l < next : l > next)).sort((a, b) => Math.abs(a - next) - Math.abs(b - next))[0] ?? null;
      const r1 = rr(next)!, r2v = t2n != null ? rr(t2n) : null;
      return { ok: true, why: `T1 ${p.t1} was not a real level — fell back to the next real pool ${next} (${r1}R)`, widened, flagged: r1 > RR_DISPLAY_MAX, stop, riskPts,
        rr1: r1, rr2: r2v, rrShown: Math.min(r1, RR_DISPLAY_MAX), promoted: true, t1: next, t2: t2n };
    }
  }
  if (!real(p.t1)) return { ...bad(`T1 ${p.t1} is not a real ranked level`), stop, riskPts };
  const rr1 = rr(p.t1), rr2 = real(p.t2) ? rr(p.t2) : null;
  // 13:01 CT ES case: a T1 under 1R must never be the DISPLAYED target. Promote a real T2 that clears
  // RR_MIN to T1 (no new level is created); otherwise it's a watch row.
  // post-mortem 13:02 (F2): never promote a T2 above RR_DISPLAY_MAX (the 7874.25 / 12R card) - that is a watch row, not a target.
  if ((rr1 == null || rr1 < RR_MIN) && rr2 != null && rr2 >= RR_MIN && rr2 <= RR_DISPLAY_MAX) {
    return { ok: true, why: `T1 ${p.t1} was ${rr1}R (< ${RR_MIN}) — promoted T2 ${p.t2} (${rr2}R) to T1`, widened, flagged: rr2 > RR_DISPLAY_MAX, stop, riskPts,
      rr1: rr2, rr2: null, rrShown: Math.min(rr2, RR_DISPLAY_MAX), promoted: true, t1: p.t2, t2: null };
  }
  if (rr1 == null || rr1 < RR_MIN) return { ok: false, why: `R:R ${rr1} < ${RR_MIN.toFixed(1)} after the stop check (stop ${stop}${widened ? ", widened" : ""})`, widened, flagged: false, stop, riskPts, rr1, rr2, rrShown: rr1 };
  const flagged = rr1 > RR_DISPLAY_MAX;
  return { ok: true, why: flagged ? `R:R ${rr1} above ${RR_DISPLAY_MAX} — shown capped, check the stop` : null, widened, flagged, stop, riskPts, rr1, rr2, rrShown: Math.min(rr1, RR_DISPLAY_MAX) };
}
