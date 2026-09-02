import type {
  IndexSymbol,
  LiveQuote,
  OhlcBar,
  SymbolSeries,
} from "./types";

/** Yahoo continuous futures — ProFX CATALOG intent (real CME symbols). */
export const YAHOO_MAP: Record<
  IndexSymbol,
  { yahoo: string; label: string; synthBase: number; tick: number }
> = {
  MNQ: {
    yahoo: "MNQ=F",
    label: "MNQ Micro Nasdaq (CME)",
    synthBase: 29_780,
    tick: 0.25,
  },
  ES: {
    yahoo: "ES=F",
    label: "ES E-mini S&P (CME)",
    synthBase: 7_770,
    tick: 0.25,
  },
  NQ: {
    yahoo: "NQ=F",
    label: "NQ E-mini Nasdaq (CME)",
    synthBase: 29_780,
    tick: 0.25,
  },
};

export type YahooRange = "1d" | "5d" | "1mo" | "3mo" | "6mo" | "1y";
export type YahooInterval =
  | "1m"
  | "5m"
  | "15m"
  | "30m"
  | "60m"
  | "1d";

interface YahooMeta {
  symbol?: string;
  regularMarketPrice?: number;
  previousClose?: number;
  chartPreviousClose?: number;
  regularMarketTime?: number;
  regularMarketDayHigh?: number;
  regularMarketDayLow?: number;
  regularMarketVolume?: number;
  timezone?: string;
  exchangeTimezoneName?: string;
  gmtoffset?: number;
}

interface YahooChartResult {
  chart?: {
    result?: Array<{
      meta?: YahooMeta;
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }>;
    error?: { description?: string } | null;
  };
}

const YAHOO_HOSTS = [
  "query1.finance.yahoo.com",
  "query2.finance.yahoo.com",
] as const;

const YAHOO_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
} as const;

async function yahooChart(
  yahoo: string,
  range: YahooRange,
  interval: YahooInterval,
): Promise<YahooChartResult | null> {
  const bust = Date.now();
  const qs =
    `interval=${interval}&range=${range}&includePrePost=true&_=${bust}`;
  const timeoutMs = interval === "1m" && range === "1d" ? 5_000 : 15_000;
  const fetchOne = async (host: (typeof YAHOO_HOSTS)[number]) => {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(yahoo)}?${qs}`;
    const res = await fetch(url, {
      headers: YAHOO_HEADERS,
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`yahoo ${res.status}`);
    const json = (await res.json()) as YahooChartResult;
    if (json.chart?.error) throw new Error(json.chart.error.description ?? "chart");
    if (!json.chart?.result?.[0]) throw new Error("empty");
    return json;
  };
  if (interval === "1m") {
    try {
      return await Promise.any(YAHOO_HOSTS.map(fetchOne));
    } catch {
      return null;
    }
  }
  for (const host of YAHOO_HOSTS) {
    try {
      return await fetchOne(host);
    } catch {
      /* next host */
    }
  }
  return null;
}



/**
 * Max single-bar close-to-close move accepted as a real print, not a bad
 * tick. Index futures circuit-breaker halts trip around 7-13%; 25% leaves
 * generous room for a real gap (weekend reopen, news) while still catching
 * the Yahoo failure modes this exists for: a stray 0, a decimal-place error,
 * a corrupted illiquid/after-hours print. Structure analysis treats HTF bias
 * as an ABSOLUTE gate on trades (CLAUDE.md) — one bad bar becoming a real
 * swing point can flip it, so bad prints are dropped here, not downstream.
 */
const MAX_BAR_MOVE_PCT = 0.25;

export function parseYahooChart(payload: YahooChartResult): OhlcBar[] {
  const result = payload.chart?.result?.[0];
  if (!result?.timestamp?.length) return [];
  const quote = result.indicators?.quote?.[0];
  if (!quote) return [];

  const bars: OhlcBar[] = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const o = quote.open?.[i];
    const h = quote.high?.[i];
    const l = quote.low?.[i];
    const c = quote.close?.[i];
    if (
      o == null ||
      h == null ||
      l == null ||
      c == null ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c) ||
      // Economic sanity, not just "is it a number": a zero/negative print is
      // never a real index-future price and must not become a swing point.
      o <= 0 ||
      h <= 0 ||
      l <= 0 ||
      c <= 0
    ) {
      continue;
    }
    const high = Math.max(h, o, c);
    const low = Math.min(l, o, c);
    const v = quote.volume?.[i];
    bars.push({
      t: result.timestamp[i]! * 1000,
      o,
      h: high,
      l: low,
      c,
      v: v != null && Number.isFinite(v) ? v : 0,
    });
  }
  bars.sort((a, b) => a.t - b.t);
  const dedup: OhlcBar[] = [];
  for (const b of bars) {
    if (dedup.length && dedup[dedup.length - 1]!.t === b.t) {
      dedup[dedup.length - 1] = b;
    } else {
      dedup.push(b);
    }
  }

  // Outlier pass, in time order: drop any bar whose close jumps > MAX_BAR_MOVE_PCT
  // from the last ACCEPTED close (so one bad tick can't also poison the bar
  // right after it by becoming the new reference point).
  const clean: OhlcBar[] = [];
  let prevClose: number | null = null;
  for (const b of dedup) {
    if (prevClose != null && Math.abs(b.c - prevClose) / prevClose > MAX_BAR_MOVE_PCT) {
      continue;
    }
    clean.push(b);
    prevClose = b.c;
  }
  return clean;
}

const MAX_BARS = 800;

/**
 * Live last print — uses 1m chart meta so we get regularMarketTime (unix seconds)
 * and regularMarketPrice without the blocked v7 quote API.
 */
export async function fetchYahooLiveQuote(
  symbol: IndexSymbol,
): Promise<LiveQuote | null> {
  const meta = YAHOO_MAP[symbol];
  const fetchedAtMs = Date.now();
  try {
    const json = await yahooChart(meta.yahoo, "1d", "1m");
    if (!json) return null;
    const m = json.chart?.result?.[0]?.meta;
    // `!m.regularMarketPrice` only rejects 0/undefined — `!(-5)` is `false`
    // in JS, so a negative print would otherwise pass straight through.
    if (
      !m?.regularMarketPrice ||
      m.regularMarketPrice <= 0 ||
      !m.regularMarketTime
    ) {
      return null;
    }

    const price = m.regularMarketPrice;
    const prev =
      m.chartPreviousClose ?? m.previousClose ?? price;
    const marketTimeMs = m.regularMarketTime * 1000;
    // Floor lag at 0 (clock skew)
    const lagSec = Math.max(0, Math.round((fetchedAtMs - marketTimeMs) / 1000));
    const change = price - prev;
    const changePct = prev > 0 ? (change / prev) * 100 : 0;

    // Optionally stitch the forming 1m bar onto quote path consumers
    return {
      symbol,
      yahoo: meta.yahoo,
      price,
      marketTimeMs,
      marketTimeIso: new Date(marketTimeMs).toISOString(),
      previousClose: prev,
      change,
      changePct,
      dayHigh: m.regularMarketDayHigh ?? null,
      dayLow: m.regularMarketDayLow ?? null,
      volume: m.regularMarketVolume ?? null,
      fetchedAtMs,
      fetchedAtIso: new Date(fetchedAtMs).toISOString(),
      lagSec,
      timezone: m.exchangeTimezoneName ?? m.timezone ?? "America/New_York",
      source: "yahoo",
    };
  } catch {
    return null;
  }
}

export function syntheticQuote(symbol: IndexSymbol): LiveQuote {
  const meta = YAHOO_MAP[symbol];
  const now = Date.now();
  // Align to whole second
  const marketTimeMs = now - (now % 1000);
  const price = meta.synthBase;
  return {
    symbol,
    yahoo: meta.yahoo,
    price,
    marketTimeMs,
    marketTimeIso: new Date(marketTimeMs).toISOString(),
    previousClose: price,
    change: 0,
    changePct: 0,
    dayHigh: price,
    dayLow: price,
    volume: 0,
    fetchedAtMs: now,
    fetchedAtIso: new Date(now).toISOString(),
    lagSec: 0,
    timezone: "America/New_York",
    source: "synthetic",
  };
}

export async function fetchYahooBars(
  symbol: IndexSymbol,
  range: YahooRange,
  interval: YahooInterval,
): Promise<SymbolSeries | null> {
  const meta = YAHOO_MAP[symbol];
  const json = await yahooChart(meta.yahoo, range, interval);
  if (!json) return null;
  let bars = parseYahooChart(json);
  if (bars.length < 10) return null;
  if (bars.length > MAX_BARS) bars = bars.slice(bars.length - MAX_BARS);

  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  const metaBlock = json.chart?.result?.[0]?.meta;
  const baseline =
    metaBlock?.chartPreviousClose ??
    metaBlock?.previousClose ??
    first.o;
  const price = metaBlock?.regularMarketPrice ?? last.c;
  const changePct = baseline > 0 ? ((price - baseline) / baseline) * 100 : 0;
  const marketTimeMs = metaBlock?.regularMarketTime
    ? metaBlock.regularMarketTime * 1000
    : last.t;

  // Keep last candle close in sync with last print when timestamps align
  // (forming bar) — price from meta is the authoritative last trade.
  if (bars.length && Math.abs(last.t - marketTimeMs) < 120_000) {
    const patched = { ...last, c: price, h: Math.max(last.h, price), l: Math.min(last.l, price) };
    bars = bars.slice(0, -1).concat(patched);
  }

  return {
    symbol,
    yahoo: meta.yahoo,
    label: meta.label,
    source: "yahoo",
    price,
    changePct,
    marketTimeMs,
    marketTimeIso: new Date(marketTimeMs).toISOString(),
    previousClose: baseline,
    first: new Date(first.t).toISOString(),
    last: new Date(last.t).toISOString(),
    interval,
    count: bars.length,
    bars,
  };
}

/** Deterministic synthetic OHLC when live feed is unavailable. */
export function syntheticBars(
  symbol: IndexSymbol,
  n = 200,
  seed = symbol === "ES" ? 7 : 13,
): SymbolSeries {
  const meta = YAHOO_MAP[symbol];
  let price = meta.synthBase;
  let s = seed * 9973 + 1;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const now = Date.now();
  const step = 15 * 60 * 1000;
  const volScale = symbol === "ES" ? 3.5 : 14;
  const bars: OhlcBar[] = [];
  for (let i = n; i >= 0; i--) {
    const drift = (rand() - 0.48) * volScale;
    const o = price;
    const c = price + drift;
    const h = Math.max(o, c) + rand() * volScale * 0.7;
    const l = Math.min(o, c) - rand() * volScale * 0.7;
    bars.push({
      t: now - i * step,
      o: +o.toFixed(2),
      h: +h.toFixed(2),
      l: +l.toFixed(2),
      c: +c.toFixed(2),
      v: Math.round(800 + rand() * 4000),
    });
    price = c;
  }
  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  const marketTimeMs = last.t;
  return {
    symbol,
    yahoo: meta.yahoo,
    label: meta.label + " (synthetic)",
    source: "synthetic",
    price: last.c,
    changePct: ((last.c - first.o) / first.o) * 100,
    marketTimeMs,
    marketTimeIso: new Date(marketTimeMs).toISOString(),
    previousClose: first.o,
    first: new Date(first.t).toISOString(),
    last: new Date(last.t).toISOString(),
    interval: "15m",
    count: bars.length,
    bars,
  };
}

export function pearsonCorr(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 8) return null;
  let sx = 0,
    sy = 0,
    sxx = 0,
    syy = 0,
    sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    sx += x;
    sy += y;
    sxx += x * x;
    syy += y * y;
    sxy += x * y;
  }
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  if (den === 0 || !Number.isFinite(den)) return null;
  const r = num / den;
  return Number.isFinite(r) ? r : null;
}

/** Align two series by exact bar timestamps, then compute returns. */
export function alignedReturnPairs(
  left: OhlcBar[],
  right: OhlcBar[],
): { left: number[]; right: number[] } {
  const mapR = new Map(right.map((b) => [b.t, b.c]));
  const paired: { lc: number; rc: number }[] = [];
  for (const b of left) {
    const rc = mapR.get(b.t);
    if (rc != null) paired.push({ lc: b.c, rc });
  }
  const lr: number[] = [];
  const rr: number[] = [];
  for (let i = 1; i < paired.length; i++) {
    const p = paired[i - 1]!;
    const c = paired[i]!;
    if (p.lc > 0 && p.rc > 0) {
      lr.push((c.lc - p.lc) / p.lc);
      rr.push((c.rc - p.rc) / p.rc);
    }
  }
  return { left: lr, right: rr };
}

export function seriesReturns(bars: OhlcBar[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1]!.c;
    const cur = bars[i]!.c;
    if (prev > 0) out.push((cur - prev) / prev);
  }
  return out;
}

/** Percent-from-open series for relative strength overlay. */
export function normalizedPct(bars: OhlcBar[]): { t: number; v: number }[] {
  if (!bars.length) return [];
  const base = bars[0]!.c;
  if (base <= 0) return [];
  return bars.map((b) => ({ t: b.t, v: ((b.c - base) / base) * 100 }));
}

export function buildComparisonNote(
  left: SymbolSeries,
  right: SymbolSeries,
  corr: number | null,
): string {
  const spread = left.changePct - right.changePct;
  const corrTxt =
    corr == null
      ? "correlation n/a"
      : `\u03c1=${corr.toFixed(2)} (${corr > 0.85 ? "tight" : corr > 0.5 ? "moderate" : "loose"} lock)`;
  if (Math.abs(spread) < 0.12) {
    return `Indexes tracking together (${corrTxt}). No clear SMT edge — wait for a crack.`;
  }
  if (left.changePct > right.changePct) {
    return `${left.symbol} leading ${right.symbol} by ${spread.toFixed(2)}pp this window (${corrTxt}). Nasdaq relative strength vs S&P.`;
  }
  return `${right.symbol} leading ${left.symbol} by ${(-spread).toFixed(2)}pp this window (${corrTxt}). S&P holding up vs Nasdaq.`;
}

/** Format an epoch ms as exchange-local wall clock with seconds. */
export function formatExchangeClock(
  ms: number,
  timeZone = "America/New_York",
): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
      month: "short",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}

export function formatUtcClock(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace(/\.\d{3}Z$/, "Z");
}
