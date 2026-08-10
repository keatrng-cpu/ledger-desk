/**
 * Lightweight structure / HTF bias / liquidity from OHLC.
 * Deterministic — AI never overrides these numbers.
 */

import type { OhlcBar } from "@/lib/market/types";

export type Bias = "bull" | "bear" | "neutral";

export interface Swing {
  t: number;
  price: number;
  kind: "high" | "low";
}

export interface LiquidityPool {
  price: number;
  side: "buyside" | "sellside";
  label: string;
  strength: number; // equal-high/low count proxy
  swept: boolean;
}

export interface DealingRange {
  high: number;
  low: number;
  eq: number;
  zone: "premium" | "discount" | "equilibrium";
  position: number; // 0 low → 1 high
}

export interface HtfBiasRead {
  symbol: string;
  topDown: Bias;
  daily: Bias;
  mid: Bias;
  ltf: Bias;
  confidence: number; // 0-1
  summary: string;
  swings: Swing[];
  lastBOS: { direction: Bias; level: number; t: number } | null;
  dealing: DealingRange | null;
  liquidity: LiquidityPool[];
  pdh: number | null;
  pdl: number | null;
  dayOpen: number | null;
  changePct: number;
  last: number;
}

function swingPoints(bars: OhlcBar[], left = 3, right = 3): Swing[] {
  const out: Swing[] = [];
  for (let i = left; i < bars.length - right; i++) {
    const b = bars[i]!;
    let isH = true;
    let isL = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (bars[j]!.h >= b.h) isH = false;
      if (bars[j]!.l <= b.l) isL = false;
    }
    if (isH) out.push({ t: b.t, price: b.h, kind: "high" });
    if (isL) out.push({ t: b.t, price: b.l, kind: "low" });
  }
  return out;
}

function trendFromSwings(swings: Swing[]): Bias {
  const highs = swings.filter((s) => s.kind === "high").slice(-4);
  const lows = swings.filter((s) => s.kind === "low").slice(-4);
  if (highs.length < 2 || lows.length < 2) return "neutral";
  const hh = highs[highs.length - 1]!.price > highs[highs.length - 2]!.price;
  const hl = lows[lows.length - 1]!.price > lows[lows.length - 2]!.price;
  const lh = highs[highs.length - 1]!.price < highs[highs.length - 2]!.price;
  const ll = lows[lows.length - 1]!.price < lows[lows.length - 2]!.price;
  if (hh && hl) return "bull";
  if (lh && ll) return "bear";
  return "neutral";
}

function lastBos(
  swings: Swing[],
): { direction: Bias; level: number; t: number } | null {
  if (swings.length < 3) return null;
  const recent = swings.slice(-8);
  for (let i = recent.length - 1; i >= 1; i--) {
    const cur = recent[i]!;
    const prev = recent[i - 1]!;
    if (cur.kind === "high" && prev.kind === "high" && cur.price > prev.price) {
      return { direction: "bull", level: prev.price, t: cur.t };
    }
    if (cur.kind === "low" && prev.kind === "low" && cur.price < prev.price) {
      return { direction: "bear", level: prev.price, t: cur.t };
    }
  }
  return null;
}

function dealingRange(bars: OhlcBar[], lookback = 80): DealingRange | null {
  if (bars.length < 10) return null;
  const slice = bars.slice(-lookback);
  let high = -Infinity;
  let low = Infinity;
  for (const b of slice) {
    high = Math.max(high, b.h);
    low = Math.min(low, b.l);
  }
  if (!Number.isFinite(high) || !Number.isFinite(low) || high <= low) return null;
  const eq = (high + low) / 2;
  const last = slice[slice.length - 1]!.c;
  const position = (last - low) / (high - low);
  let zone: DealingRange["zone"] = "equilibrium";
  if (position >= 0.55) zone = "premium";
  else if (position <= 0.45) zone = "discount";
  return { high, low, eq, zone, position };
}

function liquidityPools(bars: OhlcBar[], swings: Swing[]): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  const tol = (() => {
    if (bars.length < 20) return 1;
    const recent = bars.slice(-40);
    const atr =
      recent.reduce((a, b) => a + (b.h - b.l), 0) / recent.length;
    return atr * 0.15;
  })();

  // Cluster equal highs / lows
  const highs = swings.filter((s) => s.kind === "high").slice(-12);
  const lows = swings.filter((s) => s.kind === "low").slice(-12);

  const cluster = (
    pts: Swing[],
    side: "buyside" | "sellside",
    label: string,
  ) => {
    const used = new Set<number>();
    for (let i = 0; i < pts.length; i++) {
      if (used.has(i)) continue;
      const group = [pts[i]!];
      used.add(i);
      for (let j = i + 1; j < pts.length; j++) {
        if (Math.abs(pts[j]!.price - pts[i]!.price) <= tol) {
          group.push(pts[j]!);
          used.add(j);
        }
      }
      if (group.length >= 2) {
        const price =
          group.reduce((a, g) => a + g.price, 0) / group.length;
        const last = bars[bars.length - 1]!;
        const swept =
          side === "buyside" ? last.h > price : last.l < price;
        pools.push({
          price,
          side,
          label: `${label} ×${group.length}`,
          strength: group.length,
          swept,
        });
      }
    }
  };

  cluster(highs, "buyside", "EQH");
  cluster(lows, "sellside", "EQL");

  // Session extremes (last ~1 session of bars)
  const dayBars = bars.slice(-Math.min(bars.length, 96));
  if (dayBars.length) {
    let sh = -Infinity;
    let sl = Infinity;
    for (const b of dayBars) {
      sh = Math.max(sh, b.h);
      sl = Math.min(sl, b.l);
    }
    const last = bars[bars.length - 1]!;
    pools.push({
      price: sh,
      side: "buyside",
      label: "Session high",
      strength: 3,
      swept: last.h >= sh - tol * 0.1,
    });
    pools.push({
      price: sl,
      side: "sellside",
      label: "Session low",
      strength: 3,
      swept: last.l <= sl + tol * 0.1,
    });
  }

  return pools
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 8);
}

function priorDayHl(bars: OhlcBar[]): {
  pdh: number | null;
  pdl: number | null;
  dayOpen: number | null;
} {
  if (bars.length < 10) return { pdh: null, pdl: null, dayOpen: null };
  // Group by UTC date of bar (approx ET for continuous)
  const byDay = new Map<string, OhlcBar[]>();
  for (const b of bars) {
    const key = new Date(b.t).toISOString().slice(0, 10);
    const arr = byDay.get(key) ?? [];
    arr.push(b);
    byDay.set(key, arr);
  }
  const days = [...byDay.keys()].sort();
  if (days.length < 2) {
    const today = byDay.get(days[0]!)!;
    return {
      pdh: null,
      pdl: null,
      dayOpen: today[0]?.o ?? null,
    };
  }
  const prev = byDay.get(days[days.length - 2]!)!;
  const today = byDay.get(days[days.length - 1]!)!;
  let pdh = -Infinity;
  let pdl = Infinity;
  for (const b of prev) {
    pdh = Math.max(pdh, b.h);
    pdl = Math.min(pdl, b.l);
  }
  return {
    pdh: Number.isFinite(pdh) ? pdh : null,
    pdl: Number.isFinite(pdl) ? pdl : null,
    dayOpen: today[0]?.o ?? null,
  };
}

/** Plain majority vote: more bulls → bull, more bears → bear, tie → neutral. */
function voteBias(...votes: Bias[]): Bias {
  let bulls = 0;
  let bears = 0;
  for (const v of votes) {
    if (v === "bull") bulls++;
    if (v === "bear") bears++;
  }
  if (bulls > bears) return "bull";
  if (bears > bulls) return "bear";
  return "neutral";
}

export function analyzeStructure(
  symbol: string,
  bars: OhlcBar[],
  changePct: number,
): HtfBiasRead {
  if (bars.length < 30) {
    return {
      symbol,
      topDown: "neutral",
      daily: "neutral",
      mid: "neutral",
      ltf: "neutral",
      confidence: 0,
      summary: "Insufficient bars for structure.",
      swings: [],
      lastBOS: null,
      dealing: null,
      liquidity: [],
      pdh: null,
      pdl: null,
      dayOpen: null,
      changePct,
      last: bars[bars.length - 1]?.c ?? 0,
    };
  }

  const swingsAll = swingPoints(bars, 4, 4);
  const midBars = bars.slice(-Math.min(bars.length, 120));
  const ltfBars = bars.slice(-Math.min(bars.length, 48));
  const swingsMid = swingPoints(midBars, 3, 3);
  const swingsLtf = swingPoints(ltfBars, 2, 2);

  const daily = trendFromSwings(swingsAll);
  const mid = trendFromSwings(swingsMid);
  const ltf = trendFromSwings(swingsLtf);
  const bos = lastBos(swingsMid);
  const dealing = dealingRange(bars);
  const { pdh, pdl, dayOpen } = priorDayHl(bars);

  // Premium + bull LTF fighting top-down = weaker
  let topDown = voteBias(daily, mid, bos?.direction ?? "neutral");
  if (dealing?.zone === "premium" && topDown === "bull" && mid === "bear") {
    topDown = "neutral";
  }
  if (dealing?.zone === "discount" && topDown === "bear" && mid === "bull") {
    topDown = "neutral";
  }

  let aligned = 0;
  for (const x of [daily, mid, ltf, bos?.direction ?? "neutral"]) {
    if (x === topDown && topDown !== "neutral") aligned++;
  }
  const confidence = topDown === "neutral" ? 0.35 : Math.min(0.95, 0.4 + aligned * 0.15);

  const last = bars[bars.length - 1]!.c;
  const summary =
    topDown === "neutral"
      ? `${symbol}: mixed structure — no absolute HTF edge. Wait for alignment.`
      : `${symbol}: HTF ${topDown.toUpperCase()} (conf ${(confidence * 100).toFixed(0)}%). Daily ${daily} · mid ${mid} · LTF ${ltf}${dealing ? ` · price in ${dealing.zone}` : ""}.`;

  return {
    symbol,
    topDown,
    daily,
    mid,
    ltf,
    confidence,
    summary,
    swings: swingsMid.slice(-10),
    lastBOS: bos,
    dealing,
    liquidity: liquidityPools(bars, swingsMid),
    pdh,
    pdl,
    dayOpen,
    changePct,
    last,
  };
}

export function smtRead(
  left: HtfBiasRead,
  right: HtfBiasRead,
): { state: string; note: string; edge: "none" | "left" | "right" } {
  const l = left.changePct;
  const r = right.changePct;
  const spread = l - r;
  if (Math.abs(spread) < 0.12) {
    return {
      state: "locked",
      edge: "none",
      note: "Indexes tracking — no SMT crack. Wait for divergence at liquidity.",
    };
  }
  if (left.topDown === "bull" && right.ltf === "bear" && l > r) {
    return {
      state: "bullish_smt",
      edge: "left",
      note: `${left.symbol} holding strength vs ${right.symbol} weakness — bullish SMT candidate on ${left.symbol}.`,
    };
  }
  if (left.topDown === "bear" && right.ltf === "bull" && l < r) {
    return {
      state: "bearish_smt",
      edge: "left",
      note: `${left.symbol} lagging while ${right.symbol} holds — bearish SMT lean on ${left.symbol}.`,
    };
  }
  if (spread > 0.12) {
    return {
      state: "relative_strength",
      edge: "left",
      note: `${left.symbol} leading by ${spread.toFixed(2)}pp — prefer long ideas in leader if HTF agrees.`,
    };
  }
  return {
    state: "relative_weakness",
    edge: "right",
    note: `${right.symbol} leading by ${(-spread).toFixed(2)}pp — strength sits with ${right.symbol}.`,
  };
}
