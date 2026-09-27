/**
 * Marks for the share book — real closes, fetched on demand, labelled.
 *
 * WHY THIS EXISTS
 * The book was valued at COST because the tab had no quotes, and the panel
 * said so rather than inventing a mark. That was the honest answer to not
 * having a price; it is not the honest answer to HAVING one. A daily close
 * from Yahoo is a real print with a date on it, so the book now values at
 * that close and prints where it came from and when. Where a close cannot
 * be fetched the position still values at cost and says so.
 *
 * WHAT IT IS NOT
 * Not a poll and not a signal. The panel calls it once per visit (and on a
 * button), because a years-horizon book refreshed every few seconds turns
 * into a screen — the same reasoning as the weekly kill-rule floor. Nothing
 * here reaches a verdict, a weight cap or the sweep.
 *
 * BUDGET
 * Every server fn on this deploy must answer inside ~20s or the streaming
 * edge cuts it. Each ticker races both Yahoo hosts with a 7s timeout, six at
 * a time, twelve tickers max per call: two waves, ~14s worst case.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  MARKS_MAX_TICKERS,
  parseDailyChart,
  rangeFor,
  type ChartJson,
  type InvestMarks,
  type Range,
  type TickerMarks,
} from "./marks";

export type { InvestMarks, TickerMarks };
export { MARKS_MAX_TICKERS };

const HOSTS = ["query1.finance.yahoo.com", "query2.finance.yahoo.com"] as const;
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "application/json",
} as const;
const PER_TICKER_MS = 7_000;
const CONCURRENCY = 6;

async function fetchChart(ticker: string, range: Range): Promise<ChartJson> {
  const qs = `interval=1d&range=${range}&_=${Date.now()}`;
  const one = async (host: (typeof HOSTS)[number]) => {
    const res = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(ticker)}?${qs}`, {
      headers: HEADERS,
      signal: AbortSignal.timeout(PER_TICKER_MS),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`yahoo ${res.status}`);
    const json = (await res.json()) as ChartJson;
    if (json.chart?.error) throw new Error(json.chart.error.description ?? "chart error");
    if (!json.chart?.result?.[0]) throw new Error("empty");
    return json;
  };
  return Promise.any(HOSTS.map(one));
}

/**
 * Public, like the desk's quote calls: Yahoo closes, no user data. Cached per
 * request shape for a minute so repeated opens do not re-fetch.
 */
const MARKS_CACHE_MS = 60_000;
const marksCache = new Map<string, { at: number; data: InvestMarks }>();

export const getInvestMarks = createServerFn({ method: "POST" })
  .validator(
    z.object({
      tickers: z.array(z.string().regex(/^[A-Z][A-Z.-]{0,9}$/)).min(1).max(MARKS_MAX_TICKERS),
      historyFor: z.array(z.string().regex(/^[A-Z][A-Z.-]{0,9}$/)).max(4).optional(),
      since: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }),
  )
  .handler(async ({ data }): Promise<InvestMarks> => {
    const key = JSON.stringify(data);
    const hit = marksCache.get(key);
    if (hit && Date.now() - hit.at < MARKS_CACHE_MS) return hit.data;
    const today = new Date().toISOString().slice(0, 10);
    const history = new Set(data.historyFor ?? []);
    const tickers = [...new Set([...data.tickers, ...history])].slice(0, MARKS_MAX_TICKERS);
    const out: TickerMarks[] = [];
    for (let i = 0; i < tickers.length; i += CONCURRENCY) {
      const wave = tickers.slice(i, i + CONCURRENCY);
      const done = await Promise.all(
        wave.map(async (t): Promise<TickerMarks> => {
          const keep = history.has(t);
          try {
            const json = await fetchChart(t, keep ? rangeFor(data.since, today) : "1y");
            return { ticker: t, ...parseDailyChart(json, keep) };
          } catch (e) {
            const msg = e instanceof AggregateError ? e.errors.map((x) => String(x).slice(0, 60)).join(" / ") : String(e);
            return { ticker: t, last: null, closes: [], error: msg.slice(0, 160) };
          }
        }),
      );
      out.push(...done);
    }
    const result: InvestMarks = {
      fetchedAt: new Date().toISOString(),
      source: "Yahoo Finance daily chart",
      note: "Daily closes; the latest price is intraday while the session is open and may lag. Fetched on request, never polled.",
      marks: out,
    };
    marksCache.set(key, { at: Date.now(), data: result });
    return result;
  });
