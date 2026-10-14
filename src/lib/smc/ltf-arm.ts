/**
 * LTF ARM (Keaton 2026-10-14, shared rules `ltfArm`).
 *
 * The scanner grades the CLOSED 15m series, so a kill-zone open that sweeps,
 * flips a 5m gap and displaces inside one forming 15m bar was visible only to
 * `ltfReversals`, which can kill a side but never arm the other one. This is
 * the arming twin: on every CLOSED rung (1m 2m 3m 4m 5m from the 1m tape via
 * `rung()`, plus the closed 15m series) it looks for, in order,
 *
 *   1. a sweep — a closed bar whose wick takes a real pool (a confirmed
 *      fractal swing on that rung, or a named session level passed in) and a
 *      closed bar back inside within `closeBackBars`;
 *   2. displacement — a leg of ≤ `dispLegBars` same-direction bodies, net
 *      ≥ `dispAtr` × ATR(rung), starting within `dispWithinBars` of the sweep;
 *   3. the array — an opposite-side FVG CLOSED through (IFVG flip) or a
 *      same-side FVG left by the leg, not since closed through its far side;
 *   4. CISD (close through the opposing run) and/or MSS (close through the
 *      swing the raid leaned on).
 *
 * The best rung's evidence wins (most parts, then larger displacement, then
 * the higher timeframe). Entry is the gap CE (edge kept), stop one tick past
 * the sweep wick, T1/T2 the next real pools beyond the entry. Nothing is
 * invented: no pool, no gap or no wick → null. Never reads a forming bar.
 */
import RULES from "../../../shared/desk-rules.json";
import type { OhlcBar } from "@/lib/market/types";
import { detectFvgs, fractalSwings, rollingAtr } from "@/lib/trading/detectors";
import { cisdThroughSeries } from "@/lib/trading/raid-pair";
import { rung, type ArrayTf } from "./mtf-arrays";

export const LTF_ARM = (RULES as unknown as { ltfArm: LtfArmRules }).ltfArm;
export interface LtfArmRules {
  mode: "shadow" | "live";
  tfs: ArrayTf[];
  lookbackMin: number;
  closeBackBars: number;
  dispAtr: number;
  dispLegBars: number;
  dispWithinBars: number;
  requireCisdOrMss: boolean;
  killzoneOnly: boolean;
  capBand: "B+" | "B" | "A-";
  t1FallbackNextPool: boolean;
  watcherMinKzBars: number;
}
export const ltfArmLive = (): boolean => LTF_ARM.mode === "live";

export type Side = "long" | "short";
export interface Pool { name: string; price: number }
export interface LtfArm {
  side: Side;
  tf: ArrayTf;
  sweep: { t: number; pool: string; level: number; wick: number };
  disp: { t: number; atrMult: number };
  gap: { kind: "ifvg" | "fvg"; lo: number; hi: number; ce: number; t: number };
  cisd: boolean;
  mss: boolean;
  entry: number;
  entryEdge: number;
  stop: number;
  t1: Pool | null;
  t2: Pool | null;
  rr1: number | null;
  /** parts present: sweep, disp, gap (+1 each for cisd, mss). */
  parts: number;
  why: string;
}

const TF_MIN: Record<string, number> = { "1m": 1, "2m": 2, "3m": 3, "4m": 4, "5m": 5, "15m": 15, "30m": 30, "1h": 60, "4h": 240 };
const HTF = new Set(["15m", "30m", "1h", "4h"]);
const TICK = 0.25;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** One rung. `bars` must already be CLOSED bars only. */
export function armOnBars(
  bars: OhlcBar[], side: Side, tf: ArrayTf, pools: Pool[], nowMs: number, rules: LtfArmRules = LTF_ARM, targets: Pool[] = pools,
): LtfArm | null {
  const n = bars.length;
  if (n < 20) return null;
  const bull = side === "long";
  const tfMs = (TF_MIN[tf] ?? 1) * 60_000;
  const since = nowMs - rules.lookbackMin * 60_000;
  const atrs = rollingAtr(bars);
  // Candidate pools: named levels plus confirmed fractal swings (confirmed = 2 bars after).
  const sw = fractalSwings(bars, 2).filter((s) => s.kind === (bull ? "low" : "high"));
  let best: LtfArm | null = null;
  // lookback is wall-clock but never less than 3 bars of this rung, so 1h/4h are not starved
  const since2 = Math.min(since, nowMs - 3 * tfMs);
  for (let i = n - 1; i >= 2; i--) {
    const b = bars[i]!;
    if (b.t < since2) break;
    const cand: Pool[] = [
      ...pools.filter((p) => Number.isFinite(p.price)),
      ...sw.filter((s) => s.index + 2 < i).slice(-3).map((s) => ({ name: `${tf} swing ${s.kind}`, price: s.price })),
    ];
    // the pool the wick took: a level the bar traded through that the prior bar had NOT
    const prev = bars[i - 1]!;
    const taken = cand.filter((p) => (bull ? b.l < p.price && prev.l >= p.price - 1e-9 : b.h > p.price && prev.h <= p.price + 1e-9));
    if (!taken.length) continue;
    const pool = taken.sort((a, c) => (bull ? a.price - c.price : c.price - a.price))[0]!; // deepest pool taken
    const backAt = (() => {
      for (let j = i; j < Math.min(n, i + rules.closeBackBars); j++) if (bull ? bars[j]!.c > pool.price : bars[j]!.c < pool.price) return j;
      return -1;
    })();
    if (backAt < 0) continue;
    const wickBars = bars.slice(i, Math.min(n, backAt + rules.dispWithinBars + rules.dispLegBars));
    // displacement leg
    let disp: { idx: number; t: number; mult: number; startOpen: number } | null = null;
    for (let s0 = i; s0 < Math.min(n, i + 1 + rules.dispWithinBars) && !disp; s0++) {
      for (let j = s0; j < Math.min(n, s0 + rules.dispLegBars); j++) {
        const d = bars[j]!;
        if (bull ? !(d.c > d.o) : !(d.c < d.o)) break;
        const atr = atrs[j]!;
        if (!(atr > 0)) break;
        const net = bull ? d.c - bars[s0]!.o : bars[s0]!.o - d.c;
        if (net >= rules.dispAtr * atr) { disp = { idx: j, t: d.t, mult: r2(net / atr), startOpen: bars[s0]!.o }; break; }
      }
    }
    if (!disp) continue;
    const wick = bull ? Math.min(...bars.slice(i, disp.idx + 1).map((x) => x.l)) : Math.max(...bars.slice(i, disp.idx + 1).map((x) => x.h));
    void wickBars;
    // the array
    const gaps = detectFvgs(bars);
    const dir = bull ? "bull" : "bear";
    const flip = gaps.filter((g) => g.kind !== dir && g.inverted && g.invertedIndex != null && g.invertedIndex >= i && g.invertedIndex <= disp!.idx + 2).pop();
    const born = gaps.filter((g) => g.kind === dir && g.createdIndex >= i && g.createdIndex <= disp!.idx + 2 && g.fill !== "full").pop();
    const g = flip ?? born;
    if (!g) continue;
    const kind: "ifvg" | "fvg" = flip ? "ifvg" : "fvg";
    const lo = g.bottom, hi = g.top, ce = r2((lo + hi) / 2);
    const gT = flip ? g.invertedT ?? g.createdT : g.createdT;
    const gIdx = flip ? g.invertedIndex! : g.createdIndex;
    // voided: a closed bar since has closed through the gap's far side, or beyond the wick
    const after = bars.slice(gIdx + 1);
    if (after.some((x) => (bull ? x.c < lo || x.c < wick : x.c > hi || x.c > wick))) continue;
    const cisd = cisdThroughSeries(bars.slice(0, Math.min(n, disp.idx + 3)), dir, i);
    const leaned = bars.slice(Math.max(0, i - 8), i + 1);
    const lean = bull ? Math.max(...leaned.map((x) => x.h)) : Math.min(...leaned.map((x) => x.l));
    const mss = bars.slice(i + 1).some((x) => (bull ? x.c > lean : x.c < lean));
    if (rules.requireCisdOrMss && !cisd && !mss) continue;
    const entry = ce;
    const entryEdge = bull ? hi : lo;
    const stop = r2(bull ? wick - TICK : wick + TICK);
    const risk = Math.abs(entry - stop);
    if (!(risk > 0)) continue;
    const ahead = targets
      .filter((p) => Number.isFinite(p.price) && (bull ? p.price > entry : p.price < entry))
      .sort((a, c) => Math.abs(a.price - entry) - Math.abs(c.price - entry));
    const rr = (p: Pool) => r2(Math.abs(p.price - entry) / risk);
    const t1 = ahead.find((p) => rr(p) >= RULES.rrMin) ?? null;
    const t2 = t1 ? ahead.find((p) => (bull ? p.price > t1.price : p.price < t1.price)) ?? null : null;
    const parts = 3 + (cisd ? 1 : 0) + (mss ? 1 : 0);
    const arm: LtfArm = {
      side, tf,
      sweep: { t: b.t, pool: pool.name, level: pool.price, wick },
      disp: { t: disp.t, atrMult: disp.mult },
      gap: { kind, lo: r2(lo), hi: r2(hi), ce, t: gT },
      cisd, mss, entry, entryEdge: r2(entryEdge), stop, t1, t2, rr1: t1 ? rr(t1) : null, parts,
      why: `${tf} ${bull ? "SSL" : "BSL"} sweep of ${pool.name} ${pool.price} (wick ${wick}) → ${disp.mult}×ATR ${bull ? "up" : "down"} displacement → ${tf} ${kind} ${r2(lo)}–${r2(hi)}${cisd ? " · CISD" : ""}${mss ? " · MSS" : ""}`,
    };
    if (!best || better(arm, best)) best = arm;
  }
  return best;
}

function better(a: LtfArm, b: LtfArm): boolean {
  if (a.parts !== b.parts) return a.parts > b.parts;
  if (a.sweep.t !== b.sweep.t) return a.sweep.t > b.sweep.t; // the newest raid names the trade
  return a.disp.atrMult > b.disp.atrMult;
}

/** Best rung's evidence for one side. `minute` may include the forming bar — `rung()` drops it. */
export function ltfArmOf(i: {
  symbol: string; side: Side; minute: OhlcBar[] | null | undefined; closed15: OhlcBar[];
  pools: Pool[]; targets?: Pool[]; nowMs: number; inKillzone: boolean; rules?: LtfArmRules;
}): LtfArm | null {
  const rules = i.rules ?? LTF_ARM;
  if (rules.killzoneOnly && !i.inKillzone) return null;
  let best: LtfArm | null = null;
  for (const tf of rules.tfs) {
    // 1m-5m from the 1m tape, 15m-4h from the 15m series; `rung()` drops every forming bucket.
    const bars = HTF.has(tf)
      ? rung(i.symbol, i.closed15, tf, i.nowMs).bars
      : i.minute?.length ? rung(i.symbol, i.minute, tf, i.nowMs).bars : [];
    const a = armOnBars(bars, i.side, tf, i.pools, i.nowMs, rules, i.targets ?? i.pools);
    if (!a) continue;
    if (!best || a.parts > best.parts || (a.parts === best.parts && (TF_MIN[a.tf]! > TF_MIN[best.tf]! || a.disp.atrMult > best.disp.atrMult))) best = a;
  }
  return best;
}

/** Closed-bar LTF reversal for the extension guard: any rung armed this side. */
export function ltfReversalInside(i: Parameters<typeof ltfArmOf>[0]): boolean {
  return ltfArmOf(i) != null;
}

/** Cap order for bands; cap only lowers, never raises. */
const ORDER = ["A+", "A", "A-", "B+", "B", "C", "skip"];
export function capBandAt<T extends string | null | undefined>(band: T, cap: string): T {
  if (band == null) return band;
  const bi = ORDER.indexOf(band), ci = ORDER.indexOf(cap);
  if (bi < 0 || ci < 0) return band;
  return (bi < ci ? cap : band) as T;
}

/**
 * Session pools, same windows as the watcher's killzone.pools (item 1), from CLOSED bars:
 * Asia 20:00-24:00 ET, London 02:00-05:00 ET, overnight 18:00-09:30 ET, previous RTH 09:30-16:00.
 * Real highs/lows only; a window with no bars yields nothing.
 */
export function sessionPools(bars: OhlcBar[], nowMs: number, spanMs = 60_000): Pool[] {
  const closed = bars.filter((b) => b.t + spanMs <= nowMs);
  if (!closed.length) return [];
  const etParts = (t: number) => {
    const f = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date(t));
    const g = (k: string) => Number(f.find((p) => p.type === k)!.value);
    return { day: `${g("year")}-${g("month")}-${g("day")}`, min: (g("hour") % 24) * 60 + g("minute") };
  };
  const now = etParts(nowMs);
  // ET midnight of today, in ms: walk back from now by minutes-of-day
  const mid = nowMs - now.min * 60_000 - (nowMs % 60_000);
  const win = (a: number, b: number) => closed.filter((x) => x.t >= mid + a * 60_000 && x.t < mid + b * 60_000);
  const out: Pool[] = [];
  const hl = (name: string, xs: OhlcBar[]) => {
    if (!xs.length) return;
    out.push({ name: `${name} high`, price: Math.max(...xs.map((x) => x.h)) }, { name: `${name} low`, price: Math.min(...xs.map((x) => x.l)) });
  };
  hl("Asia", win(-240, 0));
  hl("London", win(120, 300));
  hl("Overnight", win(-360, 570));
  for (let back = 1; back <= 4; back++) {
    const xs = win(-back * 1440 + 570, -back * 1440 + 960);
    if (xs.length) { hl("Prior RTH", xs); break; }
  }
  return out;
}
