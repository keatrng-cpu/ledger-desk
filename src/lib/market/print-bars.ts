/**
 * Bars built from the prints the browser has seen.
 *
 * The 30-second rung of the timeframe ladder has no server-side series: the
 * gateway aggregates to 1m and Yahoo's finest interval is 1m. The quote
 * poll, though, runs every 1–2s inside the live window, and that stream is
 * enough to build honest 30s candles from — for the tab that watched them.
 * They are labelled "prints" everywhere they appear, live for this session
 * only, and never persisted; a bar built from prints is a real bar, but it
 * is only as complete as the poll cadence was.
 */

import type { OhlcBar } from "./types";

const MAX_PRINTS = 4_000; // ~1h at 1s, ~2h at 2s
const prints = new Map<string, { t: number; p: number }[]>();

/** Record one print for a symbol. Ignores stale, duplicate and bad prints. */
export function recordPrint(symbol: string, price: number, marketTimeMs: number | null | undefined): void {
  if (!Number.isFinite(price) || price <= 0) return;
  const t = marketTimeMs != null && Number.isFinite(marketTimeMs) && marketTimeMs > 0 ? marketTimeMs : Date.now();
  let arr = prints.get(symbol);
  if (!arr) {
    arr = [];
    prints.set(symbol, arr);
  }
  const last = arr[arr.length - 1];
  if (last && last.t === t && last.p === price) return;
  if (last && t < last.t) return;
  arr.push({ t, p: price });
  if (arr.length > MAX_PRINTS) arr.splice(0, arr.length - MAX_PRINTS);
}

/** OHLC bars of `ms` width from the recorded prints (volume = print count). */
export function barsFromPrints(symbol: string, ms: number): OhlcBar[] {
  const arr = prints.get(symbol);
  if (!arr?.length) return [];
  const out: OhlcBar[] = [];
  for (const { t, p } of arr) {
    const bt = Math.floor(t / ms) * ms;
    const last = out[out.length - 1];
    if (last && last.t === bt) {
      last.h = Math.max(last.h, p);
      last.l = Math.min(last.l, p);
      last.c = p;
      last.v = (last.v ?? 0) + 1;
    } else out.push({ t: bt, o: p, h: p, l: p, c: p, v: 1 });
  }
  return out;
}

export function printCount(symbol: string): number {
  return prints.get(symbol)?.length ?? 0;
}
