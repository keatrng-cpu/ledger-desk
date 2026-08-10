/**
 * Databento Historical — CME Globex (GLBX.MDP3) continuous front month.
 * Same contract as Trading-Automation `aplus/data/databento_source.py` and
 * profxtrader `bars.js`: HTTP Basic auth, ohlcv-1m, NQ.c.0 / ES.c.0.
 *
 * Set DATABENTO_API_KEY in the environment. Never commit the key.
 */

import type { IndexSymbol, LiveQuote, OhlcBar, SymbolSeries } from "./types";

const DATABENTO_URL = "https://hist.databento.com/v0/timeseries.get_range";
const DEFAULT_DATASET = process.env.DATABENTO_DATASET || "GLBX.MDP3";
const MAX_BARS = 6000;

/** Map desk symbols → Databento continuous root (front month .c.0). */
const ROOT: Record<IndexSymbol, string> = {
  NQ: "NQ",
  MNQ: "MNQ",
  ES: "ES",
};

const LABEL: Record<IndexSymbol, string> = {
  NQ: "NQ E-mini Nasdaq (CME)",
  MNQ: "MNQ Micro Nasdaq (CME)",
  ES: "ES E-mini S&P (CME)",
};

export function hasDatabentoKey(): boolean {
  return Boolean(process.env.DATABENTO_API_KEY?.trim());
}

function authHeader(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function continuous(symbol: IndexSymbol): string {
  return `${ROOT[symbol]}.c.0`;
}

function rangeIso(days: number): { start: string; end: string } {
  // Historical endpoint often lags live by hours–a day depending on entitlement.
  // End slightly behind "now" to avoid empty trailing ranges.
  const end = new Date(Date.now() - 30 * 60 * 1000);
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

function daysFor(range: "1d" | "5d" | "1mo" | "3mo"): number {
  if (range === "1d") return 2;
  if (range === "5d") return 7;
  if (range === "1mo") return 35;
  return 95;
}

/** Aggregate 1m bars to N-minute OHLC. */
export function aggregateBars(bars: OhlcBar[], minutes: number): OhlcBar[] {
  if (minutes <= 1 || bars.length === 0) return bars;
  const ms = minutes * 60_000;
  const out: OhlcBar[] = [];
  let bucket = -1;
  let cur: OhlcBar | null = null;
  for (const b of bars) {
    const k = Math.floor(b.t / ms) * ms;
    if (k !== bucket || !cur) {
      if (cur) out.push(cur);
      bucket = k;
      cur = { t: k, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v };
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
    }
  }
  if (cur) out.push(cur);
  return out;
}

function parseCsv(text: string): OhlcBar[] {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length < 2) return [];
  const header = lines[0]!.split(",").map((h) => h.trim().toLowerCase());
  const idx: Record<string, number> = {};
  for (const name of [
    "ts_event",
    "ts_recv",
    "open",
    "high",
    "low",
    "close",
    "volume",
  ]) {
    const i = header.indexOf(name);
    if (i !== -1) idx[name] = i;
  }
  const tsCol = idx.ts_event ?? idx.ts_recv;
  if (tsCol === undefined || idx.open === undefined || idx.close === undefined) {
    return [];
  }

  const bars: OhlcBar[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i]!.split(",");
    // pretty_ts may be ISO; raw may be ns int
    let t = Date.parse(cells[tsCol]!);
    if (!Number.isFinite(t)) {
      const ns = Number(cells[tsCol]);
      if (Number.isFinite(ns)) t = ns > 1e15 ? ns / 1e6 : ns;
    }
    const o = parseFloat(cells[idx.open]!);
    const h = parseFloat(cells[idx.high ?? idx.open]!);
    const l = parseFloat(cells[idx.low ?? idx.open]!);
    const c = parseFloat(cells[idx.close]!);
    if (
      !Number.isFinite(t) ||
      !Number.isFinite(o) ||
      !Number.isFinite(h) ||
      !Number.isFinite(l) ||
      !Number.isFinite(c)
    ) {
      continue;
    }
    const v =
      idx.volume !== undefined ? parseFloat(cells[idx.volume]!) || 0 : 0;
    bars.push({ t, o, h, l, c, v });
  }
  bars.sort((a, b) => a.t - b.t);
  return bars.length > MAX_BARS ? bars.slice(-MAX_BARS) : bars;
}

export async function fetchDatabentoBars(
  symbol: IndexSymbol,
  range: "1d" | "5d" | "1mo" | "3mo" = "1mo",
  intervalMinutes: number = 15,
): Promise<SymbolSeries | null> {
  const key = process.env.DATABENTO_API_KEY?.trim();
  if (!key) return null;

  const { start, end } = rangeIso(daysFor(range));
  const params = new URLSearchParams({
    dataset: DEFAULT_DATASET,
    symbols: continuous(symbol),
    schema: "ohlcv-1m",
    stype_in: "continuous",
    start,
    end,
    encoding: "csv",
    pretty_px: "true",
    pretty_ts: "true",
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  let res: Response;
  try {
    res = await fetch(`${DATABENTO_URL}?${params}`, {
      headers: { Authorization: authHeader(key) },
      signal: controller.signal,
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    // 401/403/402 are configuration issues — surface via null → Yahoo fallback
    console.warn(
      `[databento] ${symbol} HTTP ${res.status} ${await res.text().catch(() => "")}`,
    );
    return null;
  }

  const text = await res.text();
  let bars = parseCsv(text);
  if (bars.length < 30) return null;

  if (intervalMinutes > 1) {
    bars = aggregateBars(bars, intervalMinutes);
  }

  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  const prev =
    bars.length > 2 ? bars[bars.length - 2]!.c : first.o;
  const changePct = prev ? ((last.c - prev) / prev) * 100 : 0;

  return {
    symbol,
    yahoo: continuous(symbol),
    label: LABEL[symbol],
    source: "databento",
    price: last.c,
    changePct,
    marketTimeMs: last.t,
    marketTimeIso: new Date(last.t).toISOString(),
    previousClose: prev,
    first: new Date(first.t).toISOString(),
    last: new Date(last.t).toISOString(),
    interval: `${intervalMinutes}m`,
    count: bars.length,
    bars,
  };
}

/** Last bar as LiveQuote — true exchange bar time, not Yahoo print lag. */
export function quoteFromDatabentoSeries(series: SymbolSeries): LiveQuote {
  const last = series.bars[series.bars.length - 1]!;
  const prev = series.previousClose ?? last.o;
  const fetchedAtMs = Date.now();
  const marketTimeMs = last.t;
  return {
    symbol: series.symbol,
    yahoo: series.yahoo,
    price: last.c,
    marketTimeMs,
    marketTimeIso: new Date(marketTimeMs).toISOString(),
    previousClose: prev,
    change: last.c - prev,
    changePct: prev ? ((last.c - prev) / prev) * 100 : 0,
    dayHigh: null,
    dayLow: null,
    volume: last.v,
    fetchedAtMs,
    fetchedAtIso: new Date(fetchedAtMs).toISOString(),
    lagSec: Math.max(0, Math.round((fetchedAtMs - marketTimeMs) / 1000)),
    timezone: "America/New_York",
    source: "databento",
  };
}
