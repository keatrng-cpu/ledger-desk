/**
 * One ladder for the desk and the quote poll.
 * Structure: Databento history. A fresh gateway 1m series overlays only a 1m
 * book. Yahoo bars are fetched only when Databento is missing or short.
 * Quote: gateway tick, then gateway 1m bar, then a session-fresh Databento
 * bar, then Yahoo. Synthetic is the last resort and is not a fill.
 */
import {
  fetchDatabentoBars,
  hasDatabentoKey,
  quoteFromDatabentoSeries,
} from "./databento";
import { DATABENTO_QUOTE_FRESH_SEC, mergeNewerBars, pickFreshestQuote, stampSeriesFromBars, stitchLiveSession } from "./freshest";
import {
  quoteFromLiveBar,
  quoteFromLiveTick,
  readLiveBars,
  readLiveTickFresh,
} from "./live-gateway";
import type { IndexSymbol, LiveQuote, OhlcBar, SymbolSeries } from "./types";
import {
  YAHOO_MAP,
  fetchYahooBars,
  fetchYahooLiveQuote,
  syntheticBars,
  syntheticQuote,
  type YahooInterval,
  type YahooRange,
} from "./yahoo";

function dbRange(range: YahooRange): "1d" | "5d" | "1mo" | "3mo" {
  if (range === "1d" || range === "5d" || range === "1mo" || range === "3mo") return range;
  return "3mo";
}

function minutesOf(interval: YahooInterval): number {
  if (interval === "1m") return 1;
  if (interval === "5m") return 5;
  if (interval === "15m") return 15;
  if (interval === "30m") return 30;
  if (interval === "60m") return 60;
  return 15;
}

function within<T>(p: Promise<T>, fallback: T, ms: number): Promise<T> {
  return Promise.race([
    p.catch(() => fallback),
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

/** Databento structure. Yahoo bars only if that history is missing or short. */
export async function loadStructureSeries(
  symbol: IndexSymbol,
  range: YahooRange,
  interval: YahooInterval,
  minBars: number,
): Promise<SymbolSeries> {
  let historical: SymbolSeries | null = null;
  if (hasDatabentoKey()) {
    try {
      const minutes = minutesOf(interval);
      const db = await fetchDatabentoBars(
        symbol,
        dbRange(range),
        minutes >= 1440 ? 60 : minutes,
      );
      if (db && db.bars.length >= minBars) historical = db;
    } catch {
      /* fall through */
    }
  }

  if (historical && interval === "1m") {
    const gw = await within<OhlcBar[]>(readLiveBars(symbol), [], 200);
    if (gw.length) {
      return stampSeriesFromBars(
        { ...historical, source: "databento" },
        mergeNewerBars(historical.bars, gw),
      );
    }
  }
  if (historical) return historical;

  let yahoo: SymbolSeries | null = null;
  try {
    yahoo = await fetchYahooBars(symbol, range, interval);
  } catch {
    /* fall through */
  }
  return stitchLiveSession(null, yahoo) ?? syntheticBars(symbol);
}

/**
 * The price the desk, the brain, and the floor read.
 * Yahoo is not called when a live source already answered.
 */
export async function loadLiveQuote(
  symbol: IndexSymbol,
  series?: SymbolSeries | null,
): Promise<LiveQuote> {
  const previousClose = series?.previousClose ?? series?.bars.at(-1)?.c ?? 0;
  const yahooSym = series?.yahoo ?? YAHOO_MAP[symbol].yahoo;
  const prev = previousClose || 0;

  const tick = await readLiveTickFresh(symbol);
  if (tick) return quoteFromLiveTick(tick, yahooSym, prev || tick.price);

  const bars = await within<OhlcBar[]>(readLiveBars(symbol, 3), [], 200);
  const last = bars[bars.length - 1];
  if (last) {
    const q = quoteFromLiveBar(symbol, last, yahooSym, prev || last.c);
    if (q.lagSec <= 90) return q;
  }

  const db =
    series?.source === "databento" && series.bars.length
      ? quoteFromDatabentoSeries(series)
      : null;
  if (db && db.lagSec <= DATABENTO_QUOTE_FRESH_SEC) return db;

  const yahoo = await fetchYahooLiveQuote(symbol).catch(() => null);
  return pickFreshestQuote(yahoo, db) ?? syntheticQuote(symbol);
}
