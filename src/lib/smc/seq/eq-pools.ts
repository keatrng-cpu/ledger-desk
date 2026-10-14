/**
 * EQH/EQL audit fix (Keaton 10/14, shadow). Equal highs / lows on EVERY rung 1m–1D:
 *  - swing confirmation: fractal width 2, and both right-hand bars CLOSED before the cut (feed time);
 *  - tolerance: max(tolTicks × tick, eqTolAtr × ATR of that rung) — ticks floor, ATR scales per rung;
 *  - minTouches (2) swings within tol; the pool price is the EXTREME (where the stops rest), not the average;
 *  - age: a pool older than maxAgeSessions[tf] sessions is dropped;
 *  - swept vs unswept: the first later closed bar whose WICK trades beyond the pool marks it USED (sweptT kept).
 * Unswept pools are real liquidity (targets / draws / raidables); used pools stay listed as evidence only.
 */
import type { OhlcBar } from "@/lib/market/types";
import { fractalSwings, rollingAtr } from "@/lib/trading/detectors";
import { closedBuckets } from "./premarket-map";
import { r2, seqItem, seqNum } from "./rules";

export interface EqPool { tf: string; side: "buyside" | "sellside"; price: number; touches: number; firstT: number; lastT: number; tol: number; used: boolean; sweptT: number | null; name: string }
export const TICK: Record<string, number> = { MNQ: 0.25, NQ: 0.25, ES: 0.25, MES: 0.25 };
const TF_MIN: Record<string, number> = { "1m": 1, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240, "1D": 1440 };
const AGE_DEF: Record<string, number> = { "1m": 1, "5m": 2, "15m": 5, "30m": 8, "1h": 10, "4h": 20, "1D": 60 };

/** Pools on one rung from CLOSED bars (`bars` already closed by feed time). */
export function eqPoolsOn(bars: OhlcBar[], tf: string, tick: number, cutT: number): EqPool[] {
  if (bars.length < 7) return [];
  const atr = rollingAtr(bars).at(-1) ?? 0;
  const tol = Math.max(seqNum("eqPools", "tolTicks", 2) * tick, seqNum("eqPools", "eqTolAtr", 0.1) * atr);
  const minT = seqNum("eqPools", "minTouches", 2);
  const maxAge = (seqItem<Record<string, number>>("eqPools", "maxAgeSessions") ?? AGE_DEF)[tf] ?? 5;
  const oldest = cutT - maxAge * 86_400_000;
  const sw = fractalSwings(bars, 2).filter((s) => s.index + 2 < bars.length && s.t >= oldest);
  const out: EqPool[] = [];
  for (const kind of ["high", "low"] as const) {
    const xs = sw.filter((s) => s.kind === kind);
    const used = new Set<number>();
    for (let a = xs.length - 1; a >= 0; a--) {
      if (used.has(a)) continue;
      const grp = [a];
      for (let b = a - 1; b >= 0; b--) if (!used.has(b) && grp.every((g) => Math.abs(xs[b]!.price - xs[g]!.price) <= tol)) grp.push(b);
      if (grp.length < minT) continue;
      grp.forEach((g) => used.add(g));
      const hi = kind === "high";
      const px = hi ? Math.max(...grp.map((g) => xs[g]!.price)) : Math.min(...grp.map((g) => xs[g]!.price));
      const lastIdx = Math.max(...grp.map((g) => xs[g]!.index));
      // swept = a later bar (after the last touch's confirmation) trades beyond the extreme
      const sweepBar = bars.slice(lastIdx + 1).find((x) => (hi ? x.h > px : x.l < px));
      const ts = grp.map((g) => xs[g]!.t);
      out.push({ tf, side: hi ? "buyside" : "sellside", price: r2(px), touches: grp.length, firstT: Math.min(...ts), lastT: Math.max(...ts), tol: r2(tol), used: !!sweepBar, sweptT: sweepBar ? sweepBar.t : null, name: `EQ${hi ? "H" : "L"} ${tf} ×${grp.length}` });
    }
  }
  return out;
}

/** Every rung 1m–1D from closed 1m bars (+ optional daily). Deduped across rungs (highest tf keeps the label, touches summed). */
export function eqPools(symbol: string, m1: OhlcBar[], cutT: number, daily?: OhlcBar[]): EqPool[] {
  const tick = TICK[symbol] ?? 0.25;
  const closed = m1.filter((b) => b.t + 60_000 <= cutT);
  const all: EqPool[] = [];
  for (const tf of (seqItem<string[]>("eqPools", "tfs") ?? ["1m", "5m", "15m", "30m", "1h", "4h", "1D"])) {
    const bars = tf === "1m" ? closed.slice(-240) : tf === "1D" ? (daily ?? []).filter((d) => d.t + 86_400_000 <= cutT) : closedBuckets(closed, TF_MIN[tf]! * 60_000, cutT);
    all.push(...eqPoolsOn(bars, tf, tick, cutT));
  }
  const order = ["1D", "4h", "1h", "30m", "15m", "5m", "1m"];
  all.sort((a, b) => order.indexOf(a.tf) - order.indexOf(b.tf));
  const out: EqPool[] = [];
  for (const p of all) {
    const d = out.find((q) => q.side === p.side && Math.abs(q.price - p.price) <= Math.max(q.tol, p.tol) && q.used === p.used);
    if (d) { if (!d.name.split(/[ +]/).includes(p.tf)) d.name = `${d.name}+${p.tf}`; continue; }
    out.push({ ...p });
  }
  return out;
}
