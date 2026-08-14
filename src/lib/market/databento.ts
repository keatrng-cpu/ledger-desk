/**
 * Databento Historical — CME Globex (GLBX.MDP3) continuous front month.
 * Same contract as Trading-Automation `aplus/data/databento_source.py` and
 * profxtrader `bars.js`: HTTP Basic auth, ohlcv-1m, NQ.c.0 / ES.c.0.
 *
 * Set DATABENTO_API_KEY in the environment. Never commit the key.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { IndexSymbol, LiveQuote, OhlcBar, SymbolSeries } from "./types";

const DATABENTO_URL = "https://hist.databento.com/v0/timeseries.get_range";
const DEFAULT_DATASET = process.env.DATABENTO_DATASET || "GLBX.MDP3";
const MAX_BARS = 6000;
/** Full month backtests need more than a few sessions of 1m bars. */
const MAX_BARS_BACKTEST = 80_000;

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

/** Read key from process.env or workspace .env (dev sandbox). Never log the value. */
function readApiKey(): string {
  const fromEnv = process.env.DATABENTO_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  try {
    const envPath = join(process.cwd(), ".env");
    if (existsSync(envPath)) {
      const text = readFileSync(envPath, "utf8");
      const m = text.match(/^DATABENTO_API_KEY=(.+)$/m);
      if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ignore */
  }
  return "";
}

export function hasDatabentoKey(): boolean {
  return Boolean(readApiKey());
}

function authHeader(key: string): string {
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function continuous(symbol: IndexSymbol): string {
  return `${ROOT[symbol]}.c.0`;
}

/**
 * How far behind "now" to end the request window, in minutes.
 *
 * WHY THIS IS A DIAL AND NOT A CONSTANT. A Databento account WITHOUT a live
 * CME entitlement can only read historical windows, which lag real time by
 * hours — so this defaulted to 600 (10h) to avoid 422s on every call. The
 * moment a real entitlement is purchased, that same 600 becomes actively
 * harmful: it would keep serving ten-hour-old bars from a feed that is now
 * capable of near-real-time, and the desk's own lag gate would keep reporting
 * a stale feed you are paying not to have.
 *
 * So: buy the entitlement, set DATABENTO_DELAY_MINUTES to a small value
 * (0-2), redeploy. No code change. Lower it too far without the entitlement
 * and the API answers 422 with the maximum end time it will serve, which
 * `fetchDatabentoBars` already parses and retries against — so a wrong value
 * degrades to the old behaviour instead of breaking the feed.
 */
const DEFAULT_DELAY_MINUTES = 600;

function delayMinutes(): number {
  const raw = process.env.DATABENTO_DELAY_MINUTES?.trim();
  if (!raw) return DEFAULT_DELAY_MINUTES;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_DELAY_MINUTES;
}

function rangeIso(days: number, endMs?: number): { start: string; end: string } {
  const end = new Date(endMs ?? Date.now() - delayMinutes() * 60 * 1000);
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

/** Parse Databento 422 "end time before <iso>" hint. */
function parseMaxEnd(body: string): number | null {
  const m = body.match(/before\s+(\d{4}-\d{2}-\d{2}T[0-9:.]+Z?)/i);
  if (!m?.[1]) return null;
  let iso = m[1];
  if (!iso.endsWith("Z") && !iso.includes("+")) iso += "Z";
  // strip excess fractional digits
  iso = iso.replace(/(\.\d{3})\d+/, "$1");
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms - 60_000 : null;
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

function parseCsv(text: string, maxBars: number = MAX_BARS): OhlcBar[] {
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
  return bars.length > maxBars ? bars.slice(-maxBars) : bars;
}

async function getRangeOnce(
  key: string,
  symbol: IndexSymbol,
  start: string,
  end: string,
): Promise<{ ok: true; text: string } | { ok: false; status: number; body: string }> {
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
  try {
    const res = await fetch(`${DATABENTO_URL}?${params}`, {
      headers: { Authorization: authHeader(key) },
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text };
    return { ok: true, text };
  } catch {
    return { ok: false, status: 0, body: "network" };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDatabentoBars(
  symbol: IndexSymbol,
  range: "1d" | "5d" | "1mo" | "3mo" = "1mo",
  intervalMinutes: number = 15,
): Promise<SymbolSeries | null> {
  const key = readApiKey();
  if (!key) return null;

  let { start, end } = rangeIso(daysFor(range));
  let result = await getRangeOnce(key, symbol, start, end);

  if (!result.ok && result.status === 422) {
    const maxEnd = parseMaxEnd(result.body);
    if (maxEnd) {
      ({ start, end } = rangeIso(daysFor(range), maxEnd));
      result = await getRangeOnce(key, symbol, start, end);
    }
  }

  if (!result.ok) {
    console.warn(`[databento] ${symbol} HTTP ${result.status}`);
    return null;
  }

  const text = result.text;
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



/**
 * Absolute window fetch (session / week backtests).
 * start/end are ISO or ms; pulls 1m then optionally aggregates.
 */
export async function fetchDatabentoAbsoluteRange(
  symbol: IndexSymbol,
  startMs: number,
  endMs: number,
  intervalMinutes: number = 1,
): Promise<SymbolSeries | null> {
  const key = readApiKey();
  if (!key) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  // Chunk long windows so we never silently keep only the LAST N bars
  // (that was truncating early sessions out of month backtests).
  const CHUNK_MS = 5 * 24 * 3600 * 1000; // 5 days of 1m ≈ ~7k bars RTH+ETH
  const all: OhlcBar[] = [];
  let cursor = startMs;
  let lastError = "";

  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + CHUNK_MS, endMs);
    const start = new Date(cursor).toISOString();
    let end = new Date(chunkEnd).toISOString();
    let result = await getRangeOnce(key, symbol, start, end);

    if (!result.ok && result.status === 422) {
      const maxEnd = parseMaxEnd(result.body);
      if (maxEnd && maxEnd > cursor) {
        end = new Date(Math.min(chunkEnd, maxEnd)).toISOString();
        result = await getRangeOnce(key, symbol, start, end);
        // if license ends mid-window, still take what we can then stop
        if (result.ok) {
          const part = parseCsv(result.text, MAX_BARS_BACKTEST);
          all.push(...part);
          break;
        }
      }
      lastError = `HTTP ${result.status}`;
      // skip dead chunk, advance
      cursor = chunkEnd;
      continue;
    }

    if (!result.ok) {
      lastError = `HTTP ${result.status}`;
      console.warn(`[databento] abs chunk ${symbol} ${start} ${lastError}`);
      cursor = chunkEnd;
      continue;
    }

    const part = parseCsv(result.text, MAX_BARS_BACKTEST);
    all.push(...part);
    cursor = chunkEnd;
  }

  if (all.length < 10) {
    console.warn(`[databento] abs ${symbol} empty (${lastError || "no rows"})`);
    return null;
  }

  // Dedupe by timestamp, sort
  const byT = new Map<number, OhlcBar>();
  for (const b of all) byT.set(b.t, b);
  let bars = [...byT.values()].sort((a, b) => a.t - b.t);
  // Clip soft to window (±2m)
  bars = bars.filter((b) => b.t >= startMs - 120_000 && b.t <= endMs + 120_000);

  if (intervalMinutes > 1) {
    bars = aggregateBars(bars, intervalMinutes);
  }
  if (bars.length < 10) return null;

  const first = bars[0]!;
  const last = bars[bars.length - 1]!;
  const prev = bars.length > 2 ? bars[bars.length - 2]!.c : first.o;

  return {
    symbol,
    yahoo: continuous(symbol),
    label: LABEL[symbol],
    source: "databento",
    price: last.c,
    changePct: prev ? ((last.c - prev) / prev) * 100 : 0,
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



export interface BacktestLayers {
  symbol: IndexSymbol;
  source: "databento";
  /** 1h OHLC for HTF / multi-day structure (sparse). */
  htf1h: OhlcBar[];
  /** 4h OHLC for weekly-ish structure (very sparse). */
  htf4h: OhlcBar[];
  /** NY 08:30–11:00 ET 1m only — entry / detectors. */
  ltf1m: OhlcBar[];
  /** RTH 09:30–16:00 ET 1m — post-entry P&L walk (not used for HTF bias). */
  rth1m: OhlcBar[];
  raw1mCount: number;
  first: string;
  last: string;
}

function etMinutes(ms: number): { weekday: number; minutes: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  const wdMap: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const hour = Number(get("hour") === "24" ? "0" : get("hour"));
  const minute = Number(get("minute"));
  return { weekday: wdMap[get("weekday")] ?? 0, minutes: hour * 60 + minute };
}

/** Keep RTH-ish 1m for HTF aggregation only (09:30–16:00 ET) — denser swings than full ETH. */
function rthBars(bars: OhlcBar[]): OhlcBar[] {
  return bars.filter((b) => {
    const { weekday, minutes } = etMinutes(b.t);
    if (weekday === 0 || weekday === 6) return false;
    return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
  });
}

/** NY killzone 08:30–11:00 ET 1m. */
function nyAmBars(bars: OhlcBar[]): OhlcBar[] {
  return bars.filter((b) => {
    const { weekday, minutes } = etMinutes(b.t);
    if (weekday === 0 || weekday === 6) return false;
    return minutes >= 8 * 60 + 30 && minutes < 11 * 60;
  });
}

/**
 * Dual-layer historical load for backtests:
 * - HTF: 1h + 4h from RTH 1m (low bar count, multi-week structure)
 * - LTF: NY 08:30–11:00 1m only (entry model)
 * Raw 1m is discarded after each chunk → no 38k-bar memory spike.
 */
export async function fetchBacktestLayers(
  symbol: IndexSymbol,
  startMs: number,
  endMs: number,
): Promise<BacktestLayers | null> {
  const key = readApiKey();
  if (!key) return null;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
    return null;
  }

  const CHUNK_MS = 7 * 24 * 3600 * 1000;
  const ranges: { start: number; end: number }[] = [];
  for (let c = startMs; c < endMs; c += CHUNK_MS) {
    ranges.push({ start: c, end: Math.min(c + CHUNK_MS, endMs) });
  }

  async function loadChunk(
    rs: number,
    re: number,
  ): Promise<{ h1: OhlcBar[]; h4: OhlcBar[]; ltf: OhlcBar[]; rth: OhlcBar[]; raw: number }> {
    const start = new Date(rs).toISOString();
    let end = new Date(re).toISOString();
    let result = await getRangeOnce(key, symbol, start, end);
    if (!result.ok && result.status === 422) {
      const maxEnd = parseMaxEnd(result.body);
      if (maxEnd && maxEnd > rs) {
        end = new Date(Math.min(re, maxEnd)).toISOString();
        result = await getRangeOnce(key, symbol, start, end);
      }
    }
    if (!result.ok) {
      console.warn(`[databento] layers ${symbol} chunk HTTP ${result.status}`);
      return { h1: [], h4: [], ltf: [], rth: [], raw: 0 };
    }
    const one = parseCsv(result.text, MAX_BARS_BACKTEST);
    const rth = rthBars(one);
    return {
      h1: aggregateBars(rth, 60),
      h4: aggregateBars(rth, 240),
      ltf: nyAmBars(one),
      rth,
      raw: one.length,
    };
  }

  // Parallelism 3 — faster month loads without hammering API
  const htf1hParts: OhlcBar[] = [];
  const htf4hParts: OhlcBar[] = [];
  const ltfParts: OhlcBar[] = [];
  const rthParts: OhlcBar[] = [];
  let raw1mCount = 0;
  for (let i = 0; i < ranges.length; i += 3) {
    const batch = ranges.slice(i, i + 3);
    const parts = await Promise.all(batch.map((r) => loadChunk(r.start, r.end)));
    for (const p of parts) {
      raw1mCount += p.raw;
      htf1hParts.push(...p.h1);
      htf4hParts.push(...p.h4);
      ltfParts.push(...p.ltf);
      rthParts.push(...p.rth);
    }
  }

  const dedupe = (bars: OhlcBar[]) => {
    const m = new Map<number, OhlcBar>();
    for (const b of bars) m.set(b.t, b);
    return [...m.values()].sort((a, b) => a.t - b.t);
  };

  const htf1h = dedupe(htf1hParts);
  const htf4h = dedupe(htf4hParts);
  const ltf1m = dedupe(ltfParts);
  const rth1m = dedupe(rthParts);

  if (htf1h.length < 20 && ltf1m.length < 30) return null;

  const firstT = Math.min(
    htf1h[0]?.t ?? Infinity,
    ltf1m[0]?.t ?? Infinity,
    rth1m[0]?.t ?? Infinity,
  );
  const lastT = Math.max(
    htf1h[htf1h.length - 1]?.t ?? 0,
    ltf1m[ltf1m.length - 1]?.t ?? 0,
    rth1m[rth1m.length - 1]?.t ?? 0,
  );

  return {
    symbol,
    source: "databento",
    htf1h,
    htf4h,
    ltf1m,
    rth1m,
    raw1mCount,
    first: new Date(firstT).toISOString(),
    last: new Date(lastT).toISOString(),
  };
}

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
