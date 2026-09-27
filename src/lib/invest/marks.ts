/**
 * Pure half of the book's marks: types and the Yahoo chart parser.
 *
 * Split from marks-server.ts so the verifier (and the panel) can import it
 * without pulling the server-function runtime in with it.
 */

export const MARKS_MAX_TICKERS = 12;

export interface TickerMarks {
  ticker: string;
  /** Latest price Yahoo reports and its time (intraday while the session is open). */
  last: { price: number; at: string } | null;
  /** Daily closes, [YYYY-MM-DD, close], oldest first. Only for `historyFor` tickers. */
  closes: [string, number][];
  error?: string;
}

export interface InvestMarks {
  fetchedAt: string;
  source: string;
  note: string;
  marks: TickerMarks[];
}

export type Range = "1y" | "2y" | "5y" | "10y" | "max";

/** The shortest Yahoo range that reaches back to `since` (and never under a year). */
export function rangeFor(since: string | undefined, today: string): Range {
  if (!since) return "1y";
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86_400_000;
  if (!Number.isFinite(days) || days <= 360) return "1y";
  if (days <= 725) return "2y";
  if (days <= 1820) return "5y";
  if (days <= 3640) return "10y";
  return "max";
}

export interface ChartJson {
  chart?: {
    result?: Array<{
      meta?: { regularMarketPrice?: number; regularMarketTime?: number; gmtoffset?: number };
      timestamp?: number[];
      indicators?: { quote?: Array<{ close?: (number | null)[] }> };
    }>;
    error?: { description?: string } | null;
  };
}

/** Pure, exported for the verifier: Yahoo chart JSON → last + dated closes. */
export function parseDailyChart(json: ChartJson, keepHistory: boolean): Pick<TickerMarks, "last" | "closes"> {
  const r = json.chart?.result?.[0];
  if (!r) return { last: null, closes: [] };
  const off = Number.isFinite(r.meta?.gmtoffset) ? (r.meta?.gmtoffset as number) : 0;
  const ts = r.timestamp ?? [];
  const cl = r.indicators?.quote?.[0]?.close ?? [];
  const closes: [string, number][] = [];
  for (let i = 0; i < ts.length; i++) {
    const c = cl[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    const day = new Date((ts[i] + off) * 1000).toISOString().slice(0, 10);
    // Yahoo can repeat the last day (a live bar beside a settled one); keep the later value.
    if (closes.length && closes[closes.length - 1][0] === day) closes[closes.length - 1] = [day, c];
    else closes.push([day, c]);
  }
  const price = r.meta?.regularMarketPrice;
  const at = r.meta?.regularMarketTime;
  const last =
    price != null && Number.isFinite(price) && price > 0 && at != null
      ? { price, at: new Date(at * 1000).toISOString() }
      : closes.length
        ? { price: closes[closes.length - 1][1], at: `${closes[closes.length - 1][0]}T20:00:00.000Z` }
        : null;
  return { last, closes: keepHistory ? closes : [] };
}
