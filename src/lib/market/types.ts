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

/** Second-precision last print from Yahoo chart meta. */
export interface LiveQuote {
  symbol: IndexSymbol;
  yahoo: string;
  price: number;
  /** Yahoo regularMarketTime — exchange print time, ms epoch (second precision). */
  marketTimeMs: number;
  /** ISO of marketTimeMs */
  marketTimeIso: string;
  previousClose: number;
  change: number;
  changePct: number;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  /** Server wall-clock when we received this payload, ms */
  fetchedAtMs: number;
  fetchedAtIso: string;
  /** How stale vs Yahoo's marketTime when we fetched: fetchedAtMs - marketTimeMs */
  lagSec: number;
  timezone: string;
  source: "yahoo" | "synthetic";
}

export interface SymbolSeries {
  symbol: IndexSymbol;
  yahoo: string;
  label: string;
  source: "yahoo" | "synthetic";
  price: number;
  changePct: number;
  /** Last trade print time from Yahoo (ms), if live */
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
