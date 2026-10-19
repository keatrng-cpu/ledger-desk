/**
 * Backtest engine (pure). Replays closed 1m bars through the SAME shared detectors and rules the live
 * desk/brain/Floor/watcher use: LTF kill (mtf-context), plan sanity (exec-context.sanePlan) and
 * shared/desk-rules.json. No network; callers pass bars.
 *
 *  - signal: a fresh LTF kill against side X → trade the opposite side (the desk's kill boost side)
 *  - entry: close of the signal bar; stop: nearest real 5m/15m fractal swing beyond entry, ≥ rules.minStopAtr×ATR15
 *  - target: nearest real 15m fractal level beyond entry giving ≥ rules.rrMin (never an invented level)
 *  - fills: EXACT 1m path — the first 1m bar that touches stop or target resolves; a bar touching both
 *    resolves to the stop (conservative) unless it opened through the target.
 *  - option model: delta × underlying move × ratio − theta × minutes − half-spread × 2.
 */
import RULES from "../../../shared/desk-rules.json";
import { mtfArrays } from "@/lib/smc/mtf-arrays";
import { ltfReversalsOf } from "@/lib/smc/mtf-context";
import { ltfArmOf, sessionPools } from "@/lib/smc/ltf-arm";
import { sanePlan } from "@/lib/smc/exec-context";
import { rollingAtr, fractalSwings } from "@/lib/trading/detectors";
import { et } from "@/lib/smc/day-context";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export interface OptModel {
  delta: number;
  thetaPerMin: number;
  spread: number;
  ratio: number;
  premium: number;
  /**
   * Gamma per 1.0 of the OPTION's underlying (QQQ/SPY point), i.e. the change
   * in delta per point. A long option is long gamma: the payoff is convex BOTH
   * ways — a favourable move earns more than delta·move (delta grows into it)
   * and an adverse move loses less than delta·move (delta bleeds away). The
   * old linear model (gamma 0) understated both the winners and the survival
   * of the losers; 0DTE ATM is where this is largest. Omit → 0 (linear, the
   * pre-2026-10-19 behaviour).
   */
  gamma?: number;
}
export const DEFAULT_OPT: Record<string, OptModel> = {
  // QQQ ≈ NQ/50, SPY ≈ ES/10; 0-1DTE ATM approximations (documented, not fitted).
  // gamma: ATM 0DTE convexity per QQQ/SPY point (QQQ richer gamma than SPY per the live IV spread, 20% vs 17%).
  MNQ: { delta: 0.5, gamma: 0.05, thetaPerMin: 0.0015, spread: 0.02, ratio: 1 / 50, premium: 1.2 },
  ES: { delta: 0.5, gamma: 0.04, thetaPerMin: 0.0015, spread: 0.02, ratio: 1 / 10, premium: 1.2 },
};
export interface Trade {
  symbol: string; side: "long" | "short"; t: number; entry: number; stop: number; target: number; rr: number;
  exitT: number | null; exitPx: number | null; outcome: "target" | "stop" | "time" | "open"; r: number | null;
  optPnlPct: number | null; minutes: number | null; why: string;
}
export interface Params { ifvg5MaxAge?: number; rejectWickFrac?: number; disp1Atr?: number; stepMin?: number; timeStopMin?: number }

export function resample(m1: Bar[], ms: number): Bar[] {
  const out: Bar[] = [];
  for (const b of m1) {
    const k = Math.floor(b.t / ms) * ms; const L = out[out.length - 1];
    if (L && L.t === k) { L.h = Math.max(L.h, b.h); L.l = Math.min(L.l, b.l); L.c = b.c; L.v += b.v; }
    else out.push({ t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
  }
  return out;
}

/** Exact 1m resolution of a plan from bar index i+1 on. */
export function resolve1m(m1: Bar[], i: number, side: "long" | "short", entry: number, stop: number, target: number, timeStopMin: number) {
  const L = side === "long";
  for (let j = i + 1; j < m1.length && j <= i + timeStopMin; j++) {
    const b = m1[j]!;
    const hitT = L ? b.h >= target : b.l <= target, hitS = L ? b.l <= stop : b.h >= stop;
    const openedThroughT = L ? b.o >= target : b.o <= target;
    if (hitT && (!hitS || openedThroughT)) return { outcome: "target" as const, j, px: target };
    if (hitS) return { outcome: "stop" as const, j, px: stop };
  }
  const j = Math.min(m1.length - 1, i + timeStopMin);
  return j > i ? { outcome: (j === i + timeStopMin ? "time" : "open") as "time" | "open", j, px: m1[j]!.c } : { outcome: "open" as const, j: i, px: entry };
}

/**
 * Long-option P&L as a fraction of the debit, over a holding window.
 *  - directional: delta·move + ½·gamma·move²  (move in the option's underlying
 *    points, favourable = +). The gamma term is +both ways: a long option is
 *    long gamma, so it is added for winners and subtracted-less for losers.
 *  - theta: when `minutesToExpiry` (minutes of option life left AT ENTRY) is
 *    given, extrinsic value decays like √(time left) — shallow early, brutal in
 *    the last hour, which is exactly the 0DTE curve the desk's own Knowledge
 *    panel describes. Cost = premium·(1 − √((T0−minutes)/T0)). Without it the
 *    model falls back to the old flat thetaPerMin·minutes (backward compatible).
 *  - spread: one round-trip (buy the ask, sell the bid), as before.
 * gamma omitted → 0 → the pre-2026-10-19 linear model exactly.
 */
export function optionPnlPct(
  o: OptModel,
  side: "long" | "short",
  entry: number,
  exit: number,
  minutes: number,
  minutesToExpiry?: number,
): number {
  const move = (side === "long" ? exit - entry : entry - exit) * o.ratio;
  const directional = o.delta * move + 0.5 * (o.gamma ?? 0) * move * move;
  const theta =
    minutesToExpiry != null && minutesToExpiry > 0
      ? o.premium * (1 - Math.sqrt(Math.max(0, minutesToExpiry - minutes) / minutesToExpiry))
      : o.thetaPerMin * minutes;
  const pnl = directional - theta - o.spread;
  // A long option cannot lose more than the debit.
  return +(Math.max(pnl / o.premium, -1)).toFixed(4);
}

/** Minutes of 0DTE option life left at a bar: entry ET → 16:00 ET, floored at 1. */
export function minutesToRthClose(tMs: number): number {
  const e = et(tMs);
  return Math.max(1, 16 * 60 - e.min);
}

export function replayDay(symbol: string, m1: Bar[], m15hist: Bar[], p: Params = {}): Trade[] {
  const step = p.stepMin ?? 5, tstop = p.timeStopMin ?? 90;
  const out: Trade[] = []; const seen = new Set<string>();
  let busyUntil = 0;
  for (let i = 60; i < m1.length; i += step) {
    const b = m1[i]!; const e = et(b.t);
    if (e.min < 9 * 60 + 35 || e.min > 15 * 60) continue;
    if (b.t < busyUntil) continue; // one position at a time (live rule)
    const win = m1.slice(Math.max(0, i - 400), i + 1);
    const closedWin = win.concat([{ ...b, t: b.t + 60_000 }]); // trailing forming bar the detector drops
    const b15 = [...m15hist, ...resample(m1.slice(0, i + 1), 900_000).slice(0, -1)].filter((x) => x.t + 900_000 <= b.t + 60_000);
    const a = rollingAtr(b15 as never); const atr = a[a.length - 1];
    if (!(atr > 0)) continue;
    const kills = ltfReversalsOf(mtfArrays(symbol, closedWin as never, []) as never, closedWin as never);
    for (const k of kills) {
      const key = `${k.against}:${k.killT}`; if (seen.has(key)) continue; seen.add(key);
      if (k.killT < b.t - step * 60_000) continue; // fresh only
      const side: "long" | "short" = k.against === "long" ? "short" : "long";
      const entry = b.c; const kind = side === "short" ? "high" : "low";
      const b5 = resample(win, 300_000).slice(0, -1);
      const swings = [...fractalSwings(b5 as never, 2), ...fractalSwings(b15.slice(-40) as never, 2)]
        .filter((x: { kind: string }) => x.kind === kind).map((x: { price: number }) => x.price);
      const levels = fractalSwings(b15.slice(-80) as never, 2).map((x: { price: number }) => x.price);
      const want = side === "long" ? levels.filter((l) => l > entry).sort((x, y) => x - y) : levels.filter((l) => l < entry).sort((x, y) => y - x);
      const floorStop = side === "short" ? entry + RULES.minStopAtr * atr : entry - RULES.minStopAtr * atr;
      const near = swings.filter((s) => (side === "short" ? s > entry : s < entry)).sort((x, y) => Math.abs(x - entry) - Math.abs(y - entry))[0];
      const stop0 = near ?? floorStop;
      const tgt = want.find((t) => sanePlan({ side, entry, stop: stop0, t1: t, t2: null }, atr, swings, levels).ok);
      if (tgt == null) continue;
      const sp = sanePlan({ side, entry, stop: stop0, t1: tgt, t2: null }, atr, swings, levels);
      const r = resolve1m(m1, i, side, entry, sp.stop, tgt, tstop);
      const risk = Math.abs(entry - sp.stop);
      const R = r.outcome === "open" ? null : +(((side === "long" ? r.px - entry : entry - r.px) / risk)).toFixed(2);
      const mins = r.j - i;
      out.push({ symbol, side, t: b.t, entry, stop: sp.stop, target: tgt, rr: sp.rr1!, exitT: m1[r.j]?.t ?? null, exitPx: r.px,
        outcome: r.outcome, r: R, minutes: mins, optPnlPct: DEFAULT_OPT[symbol] ? optionPnlPct(DEFAULT_OPT[symbol]!, side, entry, r.px, mins, minutesToRthClose(b.t)) : null,
        why: `kill against ${k.against}: ${k.why[0] ?? ""}` });
      busyUntil = m1[r.j]?.t ?? b.t;
      break;
    }
  }
  return out;
}

export interface Summary { trades: number; wins: number; losses: number; hit: number | null; avgR: number | null; sumR: number; avgOptPct: number | null }
export function summarize(ts: Trade[]): Summary {
  const done = ts.filter((t) => t.r != null);
  const wins = done.filter((t) => (t.r as number) > 0).length;
  const sumR = +done.reduce((a, t) => a + (t.r as number), 0).toFixed(2);
  const opt = done.filter((t) => t.optPnlPct != null);
  return { trades: ts.length, wins, losses: done.length - wins, hit: done.length ? +(wins / done.length).toFixed(3) : null,
    avgR: done.length ? +(sumR / done.length).toFixed(3) : null, sumR,
    avgOptPct: opt.length ? +(opt.reduce((a, t) => a + (t.optPnlPct as number), 0) / opt.length).toFixed(4) : null };
}

/** Walk-forward: tune on the first (1 − holdout) of days, report the untouched holdout separately. */
export function splitDays<T>(days: T[], holdoutFrac = 0.25): { train: T[]; holdout: T[] } {
  const k = Math.max(1, Math.round(days.length * holdoutFrac));
  return { train: days.slice(0, days.length - k), holdout: days.slice(days.length - k) };
}

export function diffSummaries(prev: Record<string, Summary> | null, cur: Record<string, Summary>): string[] {
  const lines: string[] = [];
  for (const [k, c] of Object.entries(cur)) {
    const p = prev?.[k];
    const f = (x: number | null) => (x == null ? "—" : String(x));
    lines.push(`${k}: trades ${p ? f(p.trades) + "→" : ""}${c.trades} · hit ${p ? f(p.hit) + "→" : ""}${f(c.hit)} · avgR ${p ? f(p.avgR) + "→" : ""}${f(c.avgR)} · ΣR ${p ? f(p.sumR) + "→" : ""}${c.sumR} · opt ${f(c.avgOptPct)}`);
  }
  return lines;
}

/**
 * ltfArm replay (shared rules ltfArm). Walks every CLOSED 1m bar inside the shared kill zones, asks
 * ltf-arm.ts for the best closed-rung (1m-4h) arm on each side, and trades it as the card would print:
 * LIMIT at the gap CE (filled only if a later 1m bar trades through it within kzDisp item 12 minutes,
 * cancelled if the stop prints first), stop one tick past the sweep wick, target the arm's T1 (a real
 * pool >= rrMin). Exact 1m resolution via resolve1m. One position at a time. Nothing invented: no T1,
 * no trade.
 */
export function replayDayLtfArm(symbol: string, day: Bar[], hist: Bar[], p: Params & { fillMin?: number } = {}): Trade[] {
  const tstop = p.timeStopMin ?? 90, fillMin = p.fillMin ?? (RULES as unknown as { kzDisp: { items: Record<string, { minutes?: number }> } }).kzDisp.items["12"]?.minutes ?? 20;
  const kz = Object.values((RULES as unknown as { kzDisp: { killzones: Record<string, [string, string]> } }).kzDisp.killzones)
    .map(([a, b]) => [Number(a.slice(0, 2)) * 60 + Number(a.slice(3)), Number(b.slice(0, 2)) * 60 + Number(b.slice(3))] as const);
  const all = [...hist, ...day];
  const out: Trade[] = []; const seen = new Set<string>(); let busyUntil = 0;
  const off = hist.length;
  for (let k = 0; k < day.length - 1; k++) {
    const i = off + k; const b = all[i]!; const e = et(b.t);
    if (!kz.some(([a, z]) => e.min >= a && e.min < z)) continue;
    if (b.t < busyUntil) continue;
    const nowMs = b.t + 60_000; // bar i just closed
    const minute = all.slice(Math.max(0, i - 600), i + 1);
    const closed15 = resample(all.slice(Math.max(0, i - 4 * 96 * 15), i + 1), 900_000).filter((x) => x.t + 900_000 <= nowMs);
    const sess = sessionPools(all.slice(Math.max(0, i - 2000), i + 1) as never, nowMs, 60_000);
    const sw = fractalSwings(closed15.slice(-80) as never, 2).map((s: { price: number; kind: string }) => ({ name: `15m swing ${s.kind}`, price: s.price }));
    for (const side of ["long", "short"] as const) {
      const a = ltfArmOf({ symbol: `${symbol}:bt`, side, minute: minute as never, closed15: closed15 as never, pools: [...sess, ...sw], targets: [...sess, ...sw], nowMs, inKillzone: true });
      if (!a || !a.t1) continue;
      const key = `${side}:${a.sweep.t}:${a.sweep.pool}`; if (seen.has(key)) continue; seen.add(key);
      // fill: a later closed 1m bar trades through the CE; stop first = cancelled
      let fill = -1;
      for (let j = i + 1; j < all.length && j <= i + fillMin; j++) {
        const x = all[j]!;
        if (side === "long" ? x.l <= a.stop : x.h >= a.stop) break;
        if (x.l <= a.entry && a.entry <= x.h) { fill = j; break; }
      }
      if (fill < 0) continue;
      const r = resolve1m(all, fill, side, a.entry, a.stop, a.t1.price, tstop);
      const risk = Math.abs(a.entry - a.stop);
      // the fill bar itself may print the stop (order unknown): count it as a stop (conservative)
      const fb = all[fill]!; const stopOnFill = side === "long" ? fb.l <= a.stop : fb.h >= a.stop;
      const px = stopOnFill ? a.stop : r.px; const outcome = stopOnFill ? "stop" as const : r.outcome;
      const R = outcome === "open" ? null : +(((side === "long" ? px - a.entry : a.entry - px) / risk)).toFixed(2);
      const mins = (stopOnFill ? fill : r.j) - fill;
      out.push({ symbol, side, t: all[fill]!.t, entry: a.entry, stop: a.stop, target: a.t1.price, rr: a.rr1 ?? 0, exitT: all[stopOnFill ? fill : r.j]?.t ?? null, exitPx: px,
        outcome, r: R, minutes: mins, optPnlPct: DEFAULT_OPT[symbol] ? optionPnlPct(DEFAULT_OPT[symbol]!, side, a.entry, px, mins, minutesToRthClose(all[fill]!.t)) : null, why: `ltfArm ${a.why}` });
      busyUntil = all[stopOnFill ? fill : r.j]?.t ?? b.t;
      break;
    }
  }
  return out;
}
