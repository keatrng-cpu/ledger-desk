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
import { sanePlan } from "@/lib/smc/exec-context";
import { rollingAtr, fractalSwings } from "@/lib/trading/detectors";
import { et } from "@/lib/smc/day-context";

export type Bar = { t: number; o: number; h: number; l: number; c: number; v: number };
export interface OptModel { delta: number; thetaPerMin: number; spread: number; ratio: number; premium: number }
export const DEFAULT_OPT: Record<string, OptModel> = {
  // QQQ ≈ NQ/50, SPY ≈ ES/10; 0-1DTE ATM approximations (documented, not fitted)
  MNQ: { delta: 0.5, thetaPerMin: 0.0015, spread: 0.02, ratio: 1 / 50, premium: 1.2 },
  ES: { delta: 0.5, thetaPerMin: 0.0015, spread: 0.02, ratio: 1 / 10, premium: 1.2 },
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

export function optionPnlPct(o: OptModel, side: "long" | "short", entry: number, exit: number, minutes: number): number {
  const move = (side === "long" ? exit - entry : entry - exit) * o.ratio;
  const pnl = o.delta * move - o.thetaPerMin * minutes - o.spread;
  return +(pnl / o.premium).toFixed(4);
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
        outcome: r.outcome, r: R, minutes: mins, optPnlPct: DEFAULT_OPT[symbol] ? optionPnlPct(DEFAULT_OPT[symbol]!, side, entry, r.px, mins) : null,
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
