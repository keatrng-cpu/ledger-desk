/**
 * Lightweight structure / HTF bias / liquidity from OHLC.
 * Deterministic — AI never overrides these numbers.
 *
 * Sessions: PDH/PDL are computed on true CME futures sessions — a trading
 * day runs 18:00 ET → 17:00 ET next day (prior session, 18:00 ET roll),
 * NOT UTC calendar dates. Weekly PWH/PWL use Sun 18:00 ET → Fri 17:00 ET.
 * SMT: swing-divergence engine (smtDivergence) aligns two series by exact
 * timestamp and flags higher-high / lower-low failures between them.
 *
 * Liquidity: internal + external SSL/BSL (not session-only).
 */

import type { OhlcBar } from "@/lib/market/types";
import { etWallParts, etWallToEpochMs } from "./sessions";

export type Bias = "bull" | "bear" | "neutral";

export interface Swing {
  t: number;
  price: number;
  kind: "high" | "low";
}

export interface LiquidityPool {
  price: number;
  side: "buyside" | "sellside";
  /** internal = inside dealing range; external = PDH/PDL/PWH/PWL or outside range */
  scope: "internal" | "external";
  label: string;
  strength: number;
  swept: boolean;
  t?: number;
  tf?: "15m" | "1h" | "4h" | "session" | "daily" | "weekly";
}

export interface DealingRange {
  high: number;
  low: number;
  eq: number;
  zone: "premium" | "discount" | "equilibrium";
  position: number;
}

export interface HtfBiasRead {
  symbol: string;
  topDown: Bias;
  daily: Bias;
  mid: Bias;
  ltf: Bias;
  confidence: number;
  summary: string;
  swings: Swing[];
  lastBOS: { direction: Bias; level: number; t: number } | null;
  dealing: DealingRange | null;
  liquidity: LiquidityPool[];
  pdh: number | null;
  pdl: number | null;
  dayOpen: number | null;
  pwh: number | null;
  pwl: number | null;
  midnightOpen: number | null;
  nyOpen830: number | null;
  nyOpen930: number | null;
  changePct: number;
  last: number;
  /** Live session delivery (last ~12 bars). Day-trades ride this — do not fade it. */
  sessionStance: Bias;
  sessionStrength: number;
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

function liveStructureShift(
  bars: OhlcBar[],
  swings: Swing[],
): { direction: Bias; level: number; t: number } | null {
  if (!bars.length) return null;
  const last = bars[bars.length - 1]!;
  const lastHigh = [...swings].reverse().find((s) => s.kind === "high");
  const lastLow = [...swings].reverse().find((s) => s.kind === "low");
  if (lastLow && last.c < lastLow.price && last.l < lastLow.price) {
    return { direction: "bear", level: lastLow.price, t: last.t };
  }
  if (lastHigh && last.c > lastHigh.price && last.h > lastHigh.price) {
    return { direction: "bull", level: lastHigh.price, t: last.t };
  }
  return lastBos(swings);
}

function sessionImpulse(
  bars: OhlcBar[],
  n = 12,
): { bias: Bias; strength: number } {
  if (bars.length < n + 2) return { bias: "neutral", strength: 0 };
  const slice = bars.slice(-n);
  const net = slice[slice.length - 1]!.c - slice[0]!.c;
  let path = 0;
  let range = 0;
  for (let i = 1; i < slice.length; i++) {
    path += Math.abs(slice[i]!.c - slice[i - 1]!.c);
    range += slice[i]!.h - slice[i]!.l;
  }
  const atr = range / Math.max(1, slice.length - 1);
  const er = path > 0 ? Math.abs(net) / path : 0;
  const ext = atr > 0 ? Math.abs(net) / (atr * 2.2) : 0;
  const strength = Math.min(1, Math.max(er, ext * 0.7));
  if (atr <= 0) return { bias: "neutral", strength: 0 };
  if (net > atr * 0.55 && strength >= 0.22) return { bias: "bull", strength };
  if (net < -atr * 0.55 && strength >= 0.22) return { bias: "bear", strength };
  return { bias: "neutral", strength };
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

/**
 * Map internal + external liquidity — not session extremes alone.
 * Sellside (SSL): PDL/PWL external, EQL/range/swings internal, Asia/London/NY SSL.
 */
function liquidityPools(
  bars: OhlcBar[],
  swings: Swing[],
  dealing: DealingRange | null,
  levels: {
    pdh: number | null;
    pdl: number | null;
    pwh: number | null;
    pwl: number | null;
  },
): LiquidityPool[] {
  const pools: LiquidityPool[] = [];
  const tol = (() => {
    if (bars.length < 20) return 1;
    const recent = bars.slice(-40);
    const atr = recent.reduce((a, b) => a + (b.h - b.l), 0) / recent.length;
    return Math.max(atr * 0.12, 0.25);
  })();
  const last = bars[bars.length - 1]!;
  const rangeHi = dealing?.high ?? null;
  const rangeLo = dealing?.low ?? null;

  const scopeOf = (price: number): "internal" | "external" => {
    if (rangeHi == null || rangeLo == null) return "external";
    if (price >= rangeLo - tol && price <= rangeHi + tol) return "internal";
    return "external";
  };

  const push = (
    price: number | null | undefined,
    side: "buyside" | "sellside",
    label: string,
    strength: number,
    scopeOverride?: "internal" | "external",
    extra?: { t?: number; tf?: LiquidityPool["tf"] },
  ) => {
    if (price == null || !Number.isFinite(price)) return;
    const scope = scopeOverride ?? scopeOf(price);
    const swept =
      side === "buyside"
        ? last.h > price + tol * 0.05
        : last.l < price - tol * 0.05;
    const dup = pools.find(
      (p) =>
        p.side === side &&
        p.scope === scope &&
        Math.abs(p.price - price) <= tol,
    );
    if (dup) {
      if (strength > dup.strength) {
        dup.price = price;
        dup.label = label;
        dup.strength = strength;
        dup.swept = swept;
        if (extra?.t) dup.t = extra.t;
        if (extra?.tf) dup.tf = extra.tf;
      }
      return;
    }
    pools.push({
      price,
      side,
      scope,
      label,
      strength,
      swept,
      t: extra?.t,
      tf: extra?.tf,
    });
  };

  push(levels.pdl, "sellside", "PDL (external SSL)", 5, "external", { tf: "daily" });
  push(levels.pwl, "sellside", "PWL (external SSL)", 6, "external", { tf: "weekly" });
  push(levels.pdh, "buyside", "PDH (external BSL)", 5, "external", { tf: "daily" });
  push(levels.pwh, "buyside", "PWH (external BSL)", 6, "external", { tf: "weekly" });

  if (dealing) {
    push(dealing.low, "sellside", "Range low (internal SSL)", 4, "internal", { tf: "15m" });
    push(dealing.high, "buyside", "Range high (internal BSL)", 4, "internal", { tf: "15m" });
  }

  const highs = swings.filter((s) => s.kind === "high").slice(-24);
  const lows = swings.filter((s) => s.kind === "low").slice(-24);

  const cluster = (
    pts: Swing[],
    side: "buyside" | "sellside",
    baseLabel: string,
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
        const price = group.reduce((a, g) => a + g.price, 0) / group.length;
        const scope = scopeOf(price);
        push(
          price,
          side,
          `${baseLabel} ×${group.length} (${scope})`,
          3 + group.length,
          scope,
          { t: group[group.length - 1]!.t, tf: "15m" },
        );
      }
    }
  };

  cluster(highs, "buyside", "EQH");
  cluster(lows, "sellside", "EQL");

  for (const s of lows.slice(-10)) {
    const scope = scopeOf(s.price);
    push(
      s.price,
      "sellside",
      scope === "external"
        ? "Swing low (external SSL)"
        : "Swing low (internal SSL)",
      scope === "external" ? 3.5 : 2.5,
      scope,
      { t: s.t, tf: "15m" },
    );
  }
  for (const s of highs.slice(-10)) {
    const scope = scopeOf(s.price);
    push(
      s.price,
      "buyside",
      scope === "external"
        ? "Swing high (external BSL)"
        : "Swing high (internal BSL)",
      scope === "external" ? 3.5 : 2.5,
      scope,
      { t: s.t, tf: "15m" },
    );
  }

  type SessBucket = { hi: number; lo: number; n: number; hiT: number; loT: number };
  const asia: SessBucket = { hi: -Infinity, lo: Infinity, n: 0, hiT: 0, loT: 0 };
  const london: SessBucket = { hi: -Infinity, lo: Infinity, n: 0, hiT: 0, loT: 0 };
  const ny: SessBucket = { hi: -Infinity, lo: Infinity, n: 0, hiT: 0, loT: 0 };
  const day: SessBucket = { hi: -Infinity, lo: Infinity, n: 0, hiT: 0, loT: 0 };
  const lookback = bars.slice(-Math.min(bars.length, 200));
  for (const b of lookback) {
    const p = etWallParts(b.t);
    const h = p.hour + p.minute / 60;
    const hit = (s: SessBucket) => {
      if (b.h >= s.hi) {
        s.hi = b.h;
        s.hiT = b.t;
      }
      if (b.l <= s.lo) {
        s.lo = b.l;
        s.loT = b.t;
      }
      s.n++;
    };
    if (h >= 18 || h < 2) hit(asia);
    if (h >= 2 && h < 8) hit(london);
    if (h >= 8 && h < 17) hit(ny);
    hit(day);
  }
  if (asia.n > 0) {
    push(asia.lo, "sellside", "Asia low (SSL)", 3.2, scopeOf(asia.lo), { t: asia.loT, tf: "session" });
    push(asia.hi, "buyside", "Asia high (BSL)", 3.0, scopeOf(asia.hi), { t: asia.hiT, tf: "session" });
  }
  if (london.n > 0) {
    push(london.lo, "sellside", "London low (SSL)", 3.2, scopeOf(london.lo), { t: london.loT, tf: "session" });
    push(london.hi, "buyside", "London high (BSL)", 3.0, scopeOf(london.hi), { t: london.hiT, tf: "session" });
  }
  if (ny.n > 0) {
    push(ny.lo, "sellside", "NY low (SSL)", 3.0, scopeOf(ny.lo), { t: ny.loT, tf: "session" });
    push(ny.hi, "buyside", "NY high (BSL)", 2.8, scopeOf(ny.hi), { t: ny.hiT, tf: "session" });
  }
  if (day.n > 0) {
    push(day.lo, "sellside", "Session low (SSL)", 2.5, scopeOf(day.lo), { t: day.loT, tf: "session" });
    push(day.hi, "buyside", "Session high (BSL)", 2.5, scopeOf(day.hi), { t: day.hiT, tf: "session" });
  }

  return pools
    .sort((a, b) => {
      if (a.scope !== b.scope) return a.scope === "external" ? -1 : 1;
      return b.strength - a.strength;
    })
    .slice(0, 20);
}

const pad2 = (n: number) => String(n).padStart(2, "0");

export function etSessionKey(tMs: number): string {
  const p = etWallParts(tMs);
  if (p.hour >= 18) {
    const next = new Date(Date.UTC(p.year, p.month - 1, p.day + 1));
    return next.toISOString().slice(0, 10);
  }
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

function etWeekKey(sessionKey: string): string {
  const [y, m, d] = sessionKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  const dow = dt.getUTCDay();
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

  let pdh: number | null = null;
  let pdl: number | null = null;
  if (sessions.length >= 2) {
    const prev = extremes(bySession.get(sessions[sessions.length - 2]!)!);
    pdh = prev?.hi ?? null;
    pdl = prev?.lo ?? null;
  }

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

  const openAt = (hh: number, mm: number): number | null => {
    const target = hh * 60 + mm;
    for (const b of curBars) {
      const p = etWallParts(b.t);
      const dk = `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
      if (dk !== curKey) continue;
      const min = p.hour * 60 + p.minute;
      if (min >= target && min < target + 45) return b.o;
      if (min >= target + 45) return null;
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
      pwh: null,
      pwl: null,
      midnightOpen: null,
      nyOpen830: null,
      nyOpen930: null,
      changePct,
      last: bars[bars.length - 1]?.c ?? 0,
      sessionStance: "neutral",
      sessionStrength: 0,
    };
  }

  const swingsAll = swingPoints(bars, 4, 4);
  const midBars = bars.slice(-Math.min(bars.length, 120));
  const ltfBars = bars.slice(-Math.min(bars.length, 48));
  const swingsMid = swingPoints(midBars, 3, 3);
  const swingsLtf = swingPoints(ltfBars, 2, 2);

  const daily = trendFromSwings(swingsAll);
  const mid = trendFromSwings(swingsMid);
  let ltf = trendFromSwings(swingsLtf);
  const impulse = sessionImpulse(bars, 12);
  const live = liveStructureShift(bars, swingsLtf.length ? swingsLtf : swingsMid);
  const bos = live ?? lastBos(swingsMid);
  if (impulse.bias !== "neutral" && impulse.strength >= 0.32) {
    ltf = impulse.bias;
  }
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
  const confidence =
    topDown === "neutral" ? 0.35 : Math.min(0.95, 0.4 + aligned * 0.15);

  const last = bars[bars.length - 1]!.c;
  const sessionStance = impulse.bias;
  const sessionStrength = +impulse.strength.toFixed(3);
  const summary =
    topDown === "neutral"
      ? `${symbol}: mixed structure — no absolute HTF edge. Wait for alignment.`
      : `${symbol}: HTF ${topDown.toUpperCase()} (conf ${(confidence * 100).toFixed(0)}%). Daily ${daily} · mid ${mid} · LTF ${ltf}${dealing ? ` · price in ${dealing.zone}` : ""} · session ${sessionStance}${sessionStrength ? ` ${Math.round(sessionStrength * 100)}%` : ""}.`;

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
    liquidity: liquidityPools(bars, swingsMid, dealing, {
      pdh,
      pdl,
      pwh,
      pwl,
    }),
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
    sessionStance,
    sessionStrength,
  };
}

export type SmtTimeframe = "15m" | "1h" | "4h";

export interface SmtDivergenceRead {
  active: boolean;
  kind: "bullish" | "bearish" | null;
  leader: "left" | "right" | null;
  refHigh: { left: number | null; right: number | null };
  refLow: { left: number | null; right: number | null };
  note: string;
  timeframe?: SmtTimeframe;
  sweepPrice?: number | null;
  holdPrice?: number | null;
  sweepAtEt?: string;
}

export interface SmtStack {
  ltf: SmtDivergenceRead;
  h1: SmtDivergenceRead;
  h4: SmtDivergenceRead;
  /** Highest-TF active crack wins — 4H > 1H > 15m. */
  primary: SmtDivergenceRead;
}

const NO_DIVERGENCE: Omit<SmtDivergenceRead, "note"> = {
  active: false,
  kind: null,
  leader: null,
  refHigh: { left: null, right: null },
  refLow: { left: null, right: null },
};

function etStampShort(t: number): string {
  const p = etWallParts(t);
  return `${pad2(p.hour)}:${pad2(p.minute)} ET`;
}

/**
 * Session-aligned resample. 4H buckets from the 18:00 ET CME open
 * (18 / 22 / 02 / 06 / 10 / 14 ET) so Robinhood/TV 4H SMT matches the desk.
 */
export function resampleSessionBars(bars: OhlcBar[], hours: 1 | 4): OhlcBar[] {
  const buckets = new Map<number, OhlcBar>();
  for (const b of bars) {
    const p = etWallParts(b.t);
    let h = p.hour;
    if (hours === 4) {
      const fromOpen = (h - 18 + 24) % 24;
      h = (18 + Math.floor(fromOpen / 4) * 4) % 24;
    }
    const key = etWallToEpochMs(
      `${p.year}-${pad2(p.month)}-${pad2(p.day)}`,
      `${pad2(h)}:00`,
    );
    const cur = buckets.get(key);
    if (!cur) {
      buckets.set(key, { t: key, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v });
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  return [...buckets.values()].sort((a, b) => a.t - b.t);
}

export function smtDivergence(
  leftBars: OhlcBar[],
  rightBars: OhlcBar[],
  opts: { window?: number; recentBars?: number; timeframe?: SmtTimeframe } = {},
): SmtDivergenceRead {
  const window = opts.window ?? 48;
  const recentBars = opts.recentBars ?? 12;
  const timeframe = opts.timeframe ?? "15m";

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
  if (alignedL.length < (timeframe === "4h" ? 6 : 12)) {
    return { ...NO_DIVERGENCE, timeframe, note: `Too few aligned ${timeframe} bars for SMT.` };
  }

  const winL = alignedL.slice(-window);
  const winR = alignedR.slice(-window);
  const n = winL.length;

  const tolOf = (bars: OhlcBar[]) => {
    const atr = bars.reduce((a, b) => a + (b.h - b.l), 0) / bars.length;
    return atr * 0.1;
  };
  const tolL = tolOf(winL);
  const tolR = tolOf(winR);

  const swingsL = swingPoints(winL, timeframe === "4h" ? 1 : 2, timeframe === "4h" ? 1 : 2);
  const swingsR = swingPoints(winR, timeframe === "4h" ? 1 : 2, timeframe === "4h" ? 1 : 2);
  const idxOf = (bars: OhlcBar[], t: number) =>
    bars.findIndex((b) => b.t === t);

  const lastTwo = (
    swings: Swing[],
    bars: OhlcBar[],
    kind: "high" | "low",
  ) => {
    const of = swings.filter((s) => s.kind === kind);
    const lastBar = bars[bars.length - 1];
    if (!lastBar) {
      return of.length >= 2
        ? { prev: of[of.length - 2]!, last: of[of.length - 1]! }
        : null;
    }

    // HTF: current swing = extreme of the last two 4H/1H bars (live + prior)
    // vs the last confirmed swing before that. Stops a fresh down-bar from
    // hiding the HH/LH crack that just printed (Aug 14 MNQ 30287 vs ES 7831).
    if (timeframe === "4h" || timeframe === "1h") {
      const look = bars.slice(-2);
      if (!look.length) return null;
      let peak = look[0]!;
      for (const b of look) {
        if (kind === "high" ? b.h >= peak.h : b.l <= peak.l) peak = b;
      }
      const currentPrice = kind === "high" ? peak.h : peak.l;
      const prior =
        [...of].reverse().find((s) => s.t < peak.t) ??
        of.filter((s) => s.t < peak.t).at(-1);
      if (!prior) return null;
      return {
        prev: prior,
        last: { t: peak.t, price: currentPrice, kind },
      };
    }

    const lastConfirmed = of[of.length - 1];
    const livePrice = kind === "high" ? lastBar.h : lastBar.l;
    const liveMoreExtreme =
      !lastConfirmed ||
      (kind === "high"
        ? livePrice > lastConfirmed.price
        : livePrice < lastConfirmed.price);
    const last: Swing = liveMoreExtreme
      ? { t: lastBar.t, price: livePrice, kind }
      : lastConfirmed!;
    const prev =
      lastConfirmed && lastConfirmed.t !== last.t
        ? lastConfirmed
        : of.length >= 2
          ? of[of.length - 2]!
          : of[0];
    if (!prev || prev.t === last.t) return null;
    return { prev, last };
  };

  const hL = lastTwo(swingsL, winL, "high");
  const hR = lastTwo(swingsR, winR, "high");
  const lL = lastTwo(swingsL, winL, "low");
  const lR = lastTwo(swingsR, winR, "low");

  interface Candidate {
    kind: "bullish" | "bearish";
    leader: "left" | "right";
    at: number;
    refHigh: SmtDivergenceRead["refHigh"];
    refLow: SmtDivergenceRead["refLow"];
  }
  const candidates: Candidate[] = [];

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

  candidates.sort((a, b) => b.at - a.at);
  const best = candidates[0];
  if (!best || best.at < 0 || n - 1 - best.at > recentBars) {
    return {
      ...NO_DIVERGENCE,
      timeframe,
      note: best
        ? `${timeframe} SMT found but stale (outside last ${recentBars} bars).`
        : `No ${timeframe} swing divergence — highs and lows moving together.`,
    };
  }

  const sweepPrice =
    best.kind === "bearish"
      ? best.leader === "left"
        ? best.refHigh.left
        : best.refHigh.right
      : best.leader === "left"
        ? best.refLow.left
        : best.refLow.right;
  const holdPrice =
    best.kind === "bearish"
      ? best.leader === "left"
        ? best.refHigh.right
        : best.refHigh.left
      : best.leader === "left"
        ? best.refLow.right
        : best.refLow.left;
  const atBar = winL[best.at] ?? winR[best.at];
  const sweepAtEt = atBar ? etStampShort(atBar.t) : undefined;
  const px = (n: number | null | undefined) =>
    n != null ? n.toFixed(2) : "—";
  const note =
    best.kind === "bearish"
      ? `${timeframe} bearish SMT: sweeper HH ${px(sweepPrice)} vs holder ${px(holdPrice)} failed${sweepAtEt ? ` · ${sweepAtEt}` : ""} — short the holder.`
      : `${timeframe} bullish SMT: sweeper LL ${px(sweepPrice)} vs holder ${px(holdPrice)} held${sweepAtEt ? ` · ${sweepAtEt}` : ""} — long the holder.`;

  return {
    active: true,
    kind: best.kind,
    leader: best.leader,
    refHigh: best.refHigh,
    refLow: best.refLow,
    note,
    timeframe,
    sweepPrice: sweepPrice ?? null,
    holdPrice: holdPrice ?? null,
    sweepAtEt,
  };
}

export function smtDivergenceStack(
  leftBars: OhlcBar[],
  rightBars: OhlcBar[],
): SmtStack {
  const ltf = smtDivergence(leftBars, rightBars, {
    window: 48,
    recentBars: 16,
    timeframe: "15m",
  });
  const left1 = resampleSessionBars(leftBars, 1);
  const right1 = resampleSessionBars(rightBars, 1);
  const h1 = smtDivergence(left1, right1, {
    window: 48,
    recentBars: 18,
    timeframe: "1h",
  });
  const left4 = resampleSessionBars(leftBars, 4);
  const right4 = resampleSessionBars(rightBars, 4);
  const h4 = smtDivergence(left4, right4, {
    window: 36,
    recentBars: 8,
    timeframe: "4h",
  });
  const primary = h4.active ? h4 : h1.active ? h1 : ltf;
  return { ltf, h1, h4, primary };
}

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
  for (const l of read.liquidity.slice(0, 8)) {
    items.push({
      name: l.label,
      price: l.price,
      kind: `${l.side}:${l.scope}`,
    });
  }
  return items.sort((a, b) => b.price - a.price);
}

export function smtRead(
  left: HtfBiasRead,
  right: HtfBiasRead,
  divergence?: SmtDivergenceRead,
): { state: string; note: string; edge: "none" | "left" | "right" } {
  const l = left.changePct;
  const r = right.changePct;
  const spread = l - r;

  if (divergence?.active && divergence.kind) {
    const edge: "left" | "right" =
      divergence.leader === "left" ? "right" : "left";
    const sweepSym =
      divergence.leader === "left" ? left.symbol : right.symbol;
    const holdSym = edge === "left" ? left.symbol : right.symbol;
    const color = ` Spread ${spread >= 0 ? "+" : ""}${spread.toFixed(2)}pp (${left.symbol}−${right.symbol}).`;
    if (divergence.kind === "bearish") {
      const px =
        divergence.sweepPrice != null && divergence.holdPrice != null
          ? ` ${sweepSym} ${divergence.sweepPrice.toFixed(2)} HH vs ${holdSym} ${divergence.holdPrice.toFixed(2)} failed${divergence.sweepAtEt ? ` · ${divergence.sweepAtEt}` : ""}.`
          : "";
      return {
        state: "bearish_smt",
        edge,
        note: `${(divergence.timeframe ?? "swing").toUpperCase()} SMT:${px} Bearish — short lean on ${holdSym}.${color}`,
      };
    }
    const px =
      divergence.sweepPrice != null && divergence.holdPrice != null
        ? ` ${sweepSym} ${divergence.sweepPrice.toFixed(2)} LL vs ${holdSym} ${divergence.holdPrice.toFixed(2)} held${divergence.sweepAtEt ? ` · ${divergence.sweepAtEt}` : ""}.`
        : "";
    return {
      state: "bullish_smt",
      edge,
      note: `${(divergence.timeframe ?? "swing").toUpperCase()} SMT:${px} Bullish — long lean on ${holdSym}.${color}`,
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
