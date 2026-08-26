/**
 * Always pick the newest print. Databento historical last-bar as "live quote"
 * was the desk's biggest self-inflicted lag: a 10h-old CME window beat Yahoo's
 * ~10 min delayed last trade, so NY AM looked frozen.
 */
import type { LiveQuote, OhlcBar, SymbolSeries } from "./types";

export function pickFreshestQuote(
  ...quotes: Array<LiveQuote | null | undefined>
): LiveQuote | null {
  const ok = quotes.filter((q): q is LiveQuote => {
    if (!q) return false;
    if (q.source === "synthetic") return false;
    return Number.isFinite(q.price) && q.price > 0 && Number.isFinite(q.marketTimeMs);
  });
  if (!ok.length) return quotes.find((q) => q != null) ?? null;

  const gw = ok.find((q) => q.source === "live_gateway" && q.lagSec <= 5);
  if (gw) return gw;

  ok.sort((a, b) => {
    if (a.lagSec !== b.lagSec) return a.lagSec - b.lagSec;
    return b.marketTimeMs - a.marketTimeMs;
  });
  return ok[0] ?? null;
}

/** Append/replace overlay bars that are at or after the base last timestamp. */
export function mergeNewerBars(base: OhlcBar[], overlay: OhlcBar[]): OhlcBar[] {
  if (!overlay.length) return base;
  if (!base.length) return overlay.slice();
  const lastBaseT = base[base.length - 1]!.t;
  const map = new Map<number, OhlcBar>();
  for (const b of base) map.set(b.t, b);
  for (const b of overlay) {
    if (b.t >= lastBaseT) map.set(b.t, b);
  }
  return [...map.values()].sort((a, b) => a.t - b.t);
}

/** Patch the forming bar so last H/L/C tracks the latest print. */
export function applyQuoteToLastBar(bars: OhlcBar[], quote: LiveQuote): OhlcBar[] {
  if (!bars.length) return bars;
  const last = bars[bars.length - 1]!;
  if (quote.marketTimeMs + 1000 < last.t) return bars;
  const price = quote.price;
  if (!Number.isFinite(price) || price <= 0) return bars;
  const patched: OhlcBar = {
    ...last,
    c: price,
    h: Math.max(last.h, price),
    l: Math.min(last.l, price),
  };
  if (patched.c === last.c && patched.h === last.h && patched.l === last.l) {
    return bars;
  }
  return bars.slice(0, -1).concat(patched);
}

export function stampSeriesFromBars(
  series: SymbolSeries,
  bars: OhlcBar[],
): SymbolSeries {
  if (!bars.length) return series;
  const last = bars[bars.length - 1]!;
  const first = bars[0]!;
  return {
    ...series,
    bars,
    count: bars.length,
    price: last.c,
    marketTimeMs: last.t,
    marketTimeIso: new Date(last.t).toISOString(),
    first: new Date(first.t).toISOString(),
    last: new Date(last.t).toISOString(),
  };
}

/** Yahoo recent bars onto a lagged Databento history — fills the license gap. */
export function stitchLiveSession(
  historical: SymbolSeries | null,
  live: SymbolSeries | null,
): SymbolSeries | null {
  if (!historical && !live) return null;
  if (!historical) return live;
  if (!live?.bars.length) return historical;
  const merged = mergeNewerBars(historical.bars, live.bars);
  const newer = live.bars[live.bars.length - 1]!.t > historical.bars[historical.bars.length - 1]!.t;
  return stampSeriesFromBars(
    {
      ...historical,
      source: newer ? live.source : historical.source,
      previousClose: live.previousClose ?? historical.previousClose,
      changePct: newer ? live.changePct : historical.changePct,
      label: historical.label,
    },
    merged,
  );
}
