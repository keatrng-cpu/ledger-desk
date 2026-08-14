/** Bar shape aligned with ProFX Trading bars.js (`{t,o,h,l,c,v}`). */
export interface OhlcBar {
  t: number; // ms epoch
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export type IndexSymbol = "MNQ" | "ES" | "NQ";

/**
 * "live_gateway" = the Python Databento-Live process
 * (gateway/databento_live_gateway.py) via Postgres — see
 * market/live-gateway.ts. Sub-2s freshness when the gateway is running;
 * every consumer must check `lagSec` regardless of source, same as always.
 */
export type MarketSource = "databento" | "yahoo" | "live_gateway" | "synthetic";

/** Second-precision last print (Yahoo meta or last Databento bar). */
export interface LiveQuote {
  symbol: IndexSymbol;
  yahoo: string;
  price: number;
  /** Exchange / bar print time, ms epoch */
  marketTimeMs: number;
  marketTimeIso: string;
  previousClose: number;
  change: number;
  changePct: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  fetchedAtMs: number;
  fetchedAtIso: string;
  lagSec: number;
  timezone: string;
  source: MarketSource;
}

export interface SymbolSeries {
  symbol: IndexSymbol;
  yahoo: string;
  label: string;
  source: MarketSource;
  price: number;
  changePct: number;
  marketTimeMs: number | null;
  marketTimeIso: string | null;
  previousClose: number | null;
  first: string;
  last: string;
  interval: string;
  count: number;
  bars: OhlcBar[];
}

export interface DualIndexPayload {
  ok: true;
  range: string;
  interval: string;
  fetchedAt: string;
  fetchedAtMs: number;
  left: SymbolSeries;
  right: SymbolSeries;
  quotes: {
    left: LiveQuote;
    right: LiveQuote;
  };
  comparison: {
    corr: number | null;
    leftRet: number;
    rightRet: number;
    spreadRet: number;
    note: string;
  };
}

export interface DualIndexError {
  ok: false;
  error: string;
}

export interface LiveQuotesPayload {
  ok: true;
  fetchedAt: string;
  fetchedAtMs: number;
  left: LiveQuote;
  right: LiveQuote;
}
