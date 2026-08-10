/**
 * Lightweight structure / HTF bias / liquidity from OHLC.
 * Deterministic — AI never overrides these numbers.
 *
 * Sessions: PDH/PDL are computed on true CME futures sessions — a trading
 * day runs 18:00 ET → 17:00 ET next day (prior session, 18:00 ET roll),
 * NOT UTC calendar dates. Weekly PWH/PWL use Sun 18:00 ET → Fri 17:00 ET.
 * SMT: swing-divergence engine (smtDivergence) aligns two series by exact
 * timestamp and flags higher-high / lower-low failures between them.
 */

import type { OhlcBar } from "@/lib/market/types";
import { etWallParts } from "./sessions";

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
  /** Prior completed session high (session = 18:00 ET → 17:00 ET roll). */
  pdh: number | null;
  /** Prior completed session low (session = 18:00 ET → 17:00 ET roll). */
  pdl: number | null;
  /** Current session open (first bar after the 18:00 ET roll). */
  dayOpen: number | null;
  /** Prior completed week high (week = Sun 18:00 ET → Fri 17:00 ET). */
  pwh: number | null;
  /** Prior completed week low (week = Sun 18:00 ET → Fri 17:00 ET). */
  pwl: number | null;
  /** 0:00 ET open of the current session's calendar day. */
  midnightOpen: number | null;
  /** 8:30 ET open of the current session's calendar day. */
  nyOpen830: number | null;
  /** 9:30 ET open of the current session's calendar day. */
  nyOpen930: number | null;
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

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * CME futures session key for a timestamp: a trading day runs
 * 18:00 ET → 17:00 ET next day, so bars at/after 18:00 ET belong to the
 * NEXT calendar day's session. Key = "YYYY-MM-DD" of the session's close day.
 * DST-correct by construction (Intl-based ET wall clock).
 */
export function etSessionKey(tMs: number): string {
  const p = etWallParts(tMs);
  if (p.hour >= 18) {
    const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    return next.toISOString().slice(0, 10);
  }
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/**
 * Trading-week key for a session key: week = Sun 18:00 ET → Fri 17:00 ET,
 * so session dates Mon–Fri map to the Monday of their week.
 */
function etWeekKey(sessionKey: string): string {
  const [y, m, d] = sessionKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const dow = dt.getUTCDay(); // 0=Sun … 6=Sat
  const backToMonday = dow === 0 ? 6 : dow - 1;
  dt.setUTCDate(dt.getUTCDate() - backToMonday);
  return dt.toISOString().slice(0, 10);
}

interface SessionLevels {
  pdh: number | null;
  pdl: number | null;
  dayOpen: number | null;
  pwh: number | null;
  pwl: number | null;
  midnightOpen: number | null;
  nyOpen830: number | null;
  nyOpen930: number | null;
}

const EMPTY_SESSION_LEVELS: SessionLevels = {
  pdh: null,
  pdl: null,
  dayOpen: null,
  pwh: null,
  pwl: null,
  midnightOpen: null,
  nyOpen830: null,
  nyOpen930: null,
};

function extremes(bars: OhlcBar[]): { hi: number; lo: number } | null {
  let hi = -Infinity;
  let lo = Infinity;
  for (const b of bars) {
    hi = Math.max(hi, b.h);
    lo = Math.min(lo, b.l);
  }
  return Number.isFinite(hi) && Number.isFinite(lo) ? { hi, lo } : null;
}

/**
 * Session-correct levels: PDH/PDL from the prior completed CME session
 * (18:00 ET roll), PWH/PWL from the prior completed trading week
 * (Sun 18:00 ET → Fri 17:00 ET; partial if data doesn't span the week),
 * plus the 0:00 / 8:30 / 9:30 ET opens of the current session's day.
 */
function sessionLevels(bars: OhlcBar[]): SessionLevels {
  if (bars.length < 10) return { ...EMPTY_SESSION_LEVELS };

  const bySession = new Map<string, OhlcBar[]>();
  for (const b of bars) {
    const key = etSessionKey(b.t);
    const arr = bySession.get(key) ?? [];
    arr.push(b);
    bySession.set(key, arr);
  }
  const sessions = [...bySession.keys()].sort();
  const curKey = sessions[sessions.length - 1]!;
  const curBars = bySession.get(curKey)!;

  // Prior completed session extremes
  let pdh: number | null = null;
  let pdl: number | null = null;
  if (sessions.length >= 2) {
    const prev = extremes(bySession.get(sessions[sessions.length - 2]!)!);
    pdh = prev?.hi ?? null;
    pdl = prev?.lo ?? null;
  }

  // Prior completed week extremes (week = Mon-keyed sessions)
  const curWeek = etWeekKey(curKey);
  const priorWeeks = sessions
    .map(etWeekKey)
    .filter((w) => w < curWeek)
    .sort();
  let pwh: number | null = null;
  let pwl: number | null = null;
  if (priorWeeks.length) {
    const targetWeek = priorWeeks[priorWeeks.length - 1]!;
    const weekBars: OhlcBar[] = [];
    for (const s of sessions) {
      if (etWeekKey(s) === targetWeek) weekBars.push(...bySession.get(s)!);
    }
    const wk = extremes(weekBars);
    pwh = wk?.hi ?? null;
    pwl = wk?.lo ?? null;
  }

  // Opens on the current session's calendar day (ET wall clock)
  const openAt = (hh: number, mm: number): number | null => {
    const target = hh * 60 + mm;
    for (const b of curBars) {
      const p = etWallParts(b.t);
      const dk = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
      if (dk !== curKey) continue; // skip prior-evening bars (18:00–23:59)
      const min = p.hour * 60 + p.minute;
      if (min >= target && min < target + 45) return b.o;
      if (min >= target + 45) return null; // sorted — passed the slot
    }
    return null;
  };

  return {
    pdh,
    pdl,
    dayOpen: curBars[0]?.o ?? null,
    pwh,
    pwl,
    midnightOpen: openAt(0, 0),
    nyOpen830: openAt(8, 30),
    nyOpen930: openAt(9, 30),
  };
}

function voteBias(...votes: Bias[]): Bias {
  let b = 0;
  let r = 0;
  for (const v of votes) {
    if (v === "bull") b++;
    if (v === "bear") r++;
  }
  if (b > r + 0) return b >= 2 ? "bull" : b > r ? "bull" : "neutral";
  if (r > b) return r >= 2 ? "bear" : "bear";
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
      pwh: null,
      pwl: null,
      midnightOpen: null,
      nyOpen830: null,
      nyOpen930: null,
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
  const {
    pdh,
    pdl,
    dayOpen,
    pwh,
    pwl,
    midnightOpen,
    nyOpen830,
    nyOpen930,
  } = sessionLevels(bars);

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
    pwh,
    pwl,
    midnightOpen,
    nyOpen830,
    nyOpen930,
    changePct,
    last,
  };
}

/* ------------------------------------------------------------------ */
/* SMT — swing divergence between two correlated series               */
/* ------------------------------------------------------------------ */

export interface SmtDivergenceRead {
  active: boolean;
  kind: "bullish" | "bearish" | null;
  /** Side that printed the new extreme (the sweep side). */
  leader: "left" | "right" | null;
  /** Reference swing-high prices used for the higher-high comparison. */
  refHigh: { left: number | null; right: number | null };
  /** Reference swing-low prices used for the lower-low comparison. */
  refLow: { left: number | null; right: number | null };
  note: string;
}

const NO_DIVERGENCE: Omit<SmtDivergenceRead, "note"> = {
  active: false,
  kind: null,
  leader: null,
  refHigh: { left: null, right: null },
  refLow: { left: null, right: null },
};

/**
 * Real SMT: align two bar series by exact timestamp, find the most recent
 * significant swing high/low in each over a recent window, and flag
 * divergence — bearish when one side prints a higher high while the other
 * fails to (within tolerance), bullish when one prints a lower low while
 * the other holds. Divergence must have formed within the last
 * `recentBars` aligned bars to be active.
 */
export function smtDivergence(
  leftBars: OhlcBar[],
  rightBars: OhlcBar[],
  opts: { window?: number; recentBars?: number } = {},
): SmtDivergenceRead {
  const window = opts.window ?? 48;
  const recentBars = opts.recentBars ?? 12;

  // Align by exact timestamp
  const rightByT = new Map(rightBars.map((b) => [b.t, b]));
  const alignedL: OhlcBar[] = [];
  const alignedR: OhlcBar[] = [];
  for (const b of leftBars) {
    const r = rightByT.get(b.t);
    if (r) {
      alignedL.push(b);
      alignedR.push(r);
    }
  }
  if (alignedL.length < 12) {
    return { ...NO_DIVERGENCE, note: "Too few aligned bars for SMT." };
  }

  const winL = alignedL.slice(-window);
  const winR = alignedR.slice(-window);
  const n = winL.length;

  // Per-side tolerance — instruments trade at different price scales
  const tolOf = (bars: OhlcBar[]) => {
    const atr = bars.reduce((a, b) => a + (b.h - b.l), 0) / bars.length;
    return atr * 0.1;
  };
  const tolL = tolOf(winL);
  const tolR = tolOf(winR);

  // Swings inside the aligned window (indexes match across sides)
  const swingsL = swingPoints(winL, 2, 2);
  const swingsR = swingPoints(winR, 2, 2);
  const idxOf = (bars: OhlcBar[], t: number) =>
    bars.findIndex((b) => b.t === t);

  const lastTwo = (swings: Swing[], kind: "high" | "low") => {
    const of = swings.filter((s) => s.kind === kind);
    if (of.length < 2) return null;
    return { prev: of[of.length - 2]!, last: of[of.length - 1]! };
  };

  const hL = lastTwo(swingsL, "high");
  const hR = lastTwo(swingsR, "high");
  const lL = lastTwo(swingsL, "low");
  const lR = lastTwo(swingsR, "low");

  interface Candidate {
    kind: "bullish" | "bearish";
    leader: "left" | "right";
    at: number; // aligned index of the new extreme
    refHigh: SmtDivergenceRead["refHigh"];
    refLow: SmtDivergenceRead["refLow"];
  }
  const candidates: Candidate[] = [];

  // Bearish: one prints a higher high, the other fails (within tolerance)
  if (hL && hR) {
    const dL = hL.last.price - hL.prev.price;
    const dR = hR.last.price - hR.prev.price;
    const refHigh = { left: hL.last.price, right: hR.last.price };
    const refLow = {
      left: lL?.last.price ?? null,
      right: lR?.last.price ?? null,
    };
    if (dL > tolL && dR <= tolR) {
      candidates.push({
        kind: "bearish",
        leader: "left",
        at: idxOf(winL, hL.last.t),
        refHigh,
        refLow,
      });
    } else if (dR > tolR && dL <= tolL) {
      candidates.push({
        kind: "bearish",
        leader: "right",
        at: idxOf(winR, hR.last.t),
        refHigh,
        refLow,
      });
    }
  }

  // Bullish: one prints a lower low, the other holds (within tolerance)
  if (lL && lR) {
    const dL = lL.prev.price - lL.last.price;
    const dR = lR.prev.price - lR.last.price;
    const refHigh = {
      left: hL?.last.price ?? null,
      right: hR?.last.price ?? null,
    };
    const refLow = { left: lL.last.price, right: lR.last.price };
    if (dL > tolL && dR <= tolR) {
      candidates.push({
        kind: "bullish",
        leader: "left",
        at: idxOf(winL, lL.last.t),
        refHigh,
        refLow,
      });
    } else if (dR > tolR && dL <= tolL) {
      candidates.push({
        kind: "bullish",
        leader: "right",
        at: idxOf(winR, lR.last.t),
        refHigh,
        refLow,
      });
    }
  }

  // Most recent divergence wins; must sit inside the recency window
  candidates.sort((a, b) => b.at - a.at);
  const best = candidates[0];
  if (!best || best.at < 0 || n - 1 - best.at > recentBars) {
    return {
      ...NO_DIVERGENCE,
      note: best
        ? "Swing divergence found but stale (outside recent window)."
        : "No swing divergence — highs and lows moving together.",
    };
  }

  const sweep = best.leader === "left" ? "left" : "right";
  const holder = best.leader === "left" ? "right" : "left";
  const note =
    best.kind === "bearish"
      ? `Bearish SMT: ${sweep} printed a higher high while ${holder} failed — crack at the highs.`
      : `Bullish SMT: ${sweep} printed a lower low while ${holder} held — crack at the lows.`;

  return {
    active: true,
    kind: best.kind,
    leader: best.leader,
    refHigh: best.refHigh,
    refLow: best.refLow,
    note,
  };
}

/* ------------------------------------------------------------------ */
/* Reference-level ladder                                             */
/* ------------------------------------------------------------------ */

/**
 * Full reference ladder for a symbol: prior-session PDH/PDL (18:00 ET
 * roll), prior-week PWH/PWL, session + 0:00/8:30/9:30 ET opens, dealing
 * range, and top liquidity pools — sorted descending by price.
 * Intended replacement for build-desk's levelsFrom.
 */
export function referenceLevels(
  read: HtfBiasRead,
): { name: string; price: number; kind: string }[] {
  const items: { name: string; price: number; kind: string }[] = [];
  if (read.pdh != null) items.push({ name: "PDH", price: read.pdh, kind: "prior" });
  if (read.pdl != null) items.push({ name: "PDL", price: read.pdl, kind: "prior" });
  if (read.pwh != null) items.push({ name: "PWH", price: read.pwh, kind: "weekly" });
  if (read.pwl != null) items.push({ name: "PWL", price: read.pwl, kind: "weekly" });
  if (read.dayOpen != null)
    items.push({ name: "Session open (18:00)", price: read.dayOpen, kind: "open" });
  if (read.midnightOpen != null)
    items.push({ name: "Midnight open", price: read.midnightOpen, kind: "open" });
  if (read.nyOpen830 != null)
    items.push({ name: "NY 8:30 open", price: read.nyOpen830, kind: "open" });
  if (read.nyOpen930 != null)
    items.push({ name: "NY 9:30 open", price: read.nyOpen930, kind: "open" });
  if (read.dealing) {
    items.push({ name: "Range high", price: read.dealing.high, kind: "range" });
    items.push({ name: "EQ", price: read.dealing.eq, kind: "range" });
    items.push({ name: "Range low", price: read.dealing.low, kind: "range" });
  }
  for (const l of read.liquidity.slice(0, 4)) {
    items.push({ name: l.label, price: l.price, kind: l.side });
  }
  return items.sort((a, b) => b.price - a.price);
}

/**
 * SMT read. When a swing-divergence result (from smtDivergence) is
 * provided it is the PRIMARY signal — the changePct spread becomes
 * secondary color. Without it, behavior is unchanged (changePct proxy),
 * keeping scanner.ts's two-arg call fully backward compatible.
 */
export function smtRead(
  left: HtfBiasRead,
  right: HtfBiasRead,
  divergence?: SmtDivergenceRead,
): { state: string; note: string; edge: "none" | "left" | "right" } {
  const l = left.changePct;
  const r = right.changePct;
  const spread = l - r;

  if (divergence?.active && divergence.kind) {
    // Edge sits on the side that HELD (relative strength/weakness),
    // opposite the sweep leader.
    const edge: "left" | "right" =
      divergence.leader === "left" ? "right" : "left";
    const sweepSym =
      divergence.leader === "left" ? left.symbol : right.symbol;
    const holdSym = edge === "left" ? left.symbol : right.symbol;
    const color = ` Spread ${spread >= 0 ? "+" : ""}${spread.toFixed(2)}pp (${left.symbol}−${right.symbol}).`;
    if (divergence.kind === "bearish") {
      return {
        state: "bearish_smt",
        edge,
        note: `Swing SMT: ${sweepSym} higher high, ${holdSym} failed — bearish divergence, short lean on ${holdSym}.${color}`,
      };
    }
    return {
      state: "bullish_smt",
      edge,
      note: `Swing SMT: ${sweepSym} lower low, ${holdSym} held — bullish divergence, long lean on ${holdSym}.${color}`,
    };
  }

  const staleSuffix =
    divergence && !divergence.active ? " No active swing SMT." : "";
  if (Math.abs(spread) < 0.12) {
    return {
      state: "locked",
      edge: "none",
      note:
        "Indexes tracking — no SMT crack. Wait for divergence at liquidity." +
        staleSuffix,
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
