/**
 * Execution context shared by scanner, brain, Floor and the Master seat:
 * displacement strength (fix 20), ranked draws (fix 7/8), exit plan (16–18).
 * Every number is read from bars the desk already loaded. No bars → null.
 */
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
    if (!best || score > best.score) best = { score, bodyAtr: +bodyAtr.toFixed(2), leftFvg, closeFrac: +closeFrac.toFixed(2), tf: "5m", ageBars: b5.length - 1 - i };
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
export const CONT_MIN_STOP_ATR = 0.5;

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
