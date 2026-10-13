/**
 * Execution context shared by scanner, brain, Floor and the Master seat:
 * displacement strength (fix 20), ranked draws (fix 7/8), exit plan (16–18).
 * Every number is read from bars the desk already loaded. No bars → null.
 */
import type { OhlcBar } from "@/lib/market/types";
import { fractalSwings, rollingAtr } from "@/lib/trading/detectors";
import { resampleMs } from "@/lib/trading/tf-ladder";
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
