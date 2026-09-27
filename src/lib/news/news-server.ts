/**
 * The News tab's server side: headline feeds, a market pulse, and (when the
 * deploy is configured for it) SEC filings for the researched companies.
 *
 * BUDGET AND CADENCE
 * Every call must answer well inside the ~30s edge cut. Feeds are fetched in
 * parallel with a 6s timeout each; a feed that fails is reported by name and
 * the rest still render. Results are cached per server instance for five
 * minutes — the tab refreshes on open and on a button, never in a loop, and
 * nothing here is on the trading poll.
 *
 * SEC FILINGS NEED A CONTACT
 * SEC's fair-access policy requires a User-Agent naming a contact email and
 * refuses anonymous requests (403). This file will not invent one or use the
 * trader's address without being told to: set SEC_USER_AGENT on the deploy
 * (e.g. "Ledger Desk you@example.com") and the filings card turns on.
 */

import { createServerFn } from "@tanstack/react-start";
import { FEEDS, parseFeed, type FeedItem } from "./feed";
import { ALL_DOSSIERS } from "@/lib/invest/dossiers";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const FEED_TIMEOUT_MS = 6_000;
const CACHE_MS = 5 * 60_000;
const MAX_ITEMS = 220;

export interface PulseQuote {
  symbol: string;
  label: string;
  last: number | null;
  prevClose: number | null;
  at: string | null;
}

export interface NewsPayload {
  fetchedAt: string;
  items: FeedItem[];
  failed: { source: string; why: string }[];
  pulse: PulseQuote[];
  cached: boolean;
}

let cache: { at: number; data: NewsPayload } | null = null;

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/rss+xml, application/xml, text/xml, */*" },
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

const PULSE: { symbol: string; label: string }[] = [
  { symbol: "^VIX", label: "VIX" },
  { symbol: "^TNX", label: "10y yield" },
  { symbol: "QQQ", label: "QQQ" },
  { symbol: "SPY", label: "SPY" },
];

async function pulseQuote(symbol: string, label: string): Promise<PulseQuote> {
  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
      { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(FEED_TIMEOUT_MS), cache: "no-store" },
    );
    if (!res.ok) throw new Error(String(res.status));
    const json = (await res.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number; chartPreviousClose?: number; previousClose?: number; regularMarketTime?: number } }[] };
    };
    const m = json.chart?.result?.[0]?.meta;
    return {
      symbol,
      label,
      last: m?.regularMarketPrice ?? null,
      prevClose: m?.previousClose ?? m?.chartPreviousClose ?? null,
      at: m?.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    };
  } catch {
    return { symbol, label, last: null, prevClose: null, at: null };
  }
}

/** Public, like the desk's quote calls: public feeds, no user data, 5-min cache. */
export async function loadNews(): Promise<NewsPayload> {
    if (cache && Date.now() - cache.at < CACHE_MS) return { ...cache.data, cached: true };
    const failed: NewsPayload["failed"] = [];
    const [feeds, pulse] = await Promise.all([
      Promise.all(
        FEEDS.map(async (f) => {
          try {
            return parseFeed(await fetchText(f.url), f);
          } catch (e) {
            failed.push({ source: f.name, why: String(e instanceof Error ? e.message : e).slice(0, 80) });
            return [] as FeedItem[];
          }
        }),
      ),
      Promise.all(PULSE.map((p) => pulseQuote(p.symbol, p.label))),
    ]);
    const cutoff = Date.now() - 7 * 86_400_000;
    const items = feeds
      .flat()
      .filter((i) => !i.published || Date.parse(i.published) >= cutoff)
      .sort((a, b) => (b.published ?? "").localeCompare(a.published ?? ""))
      .slice(0, MAX_ITEMS);
    const data: NewsPayload = { fetchedAt: new Date().toISOString(), items, failed, pulse, cached: false };
    cache = { at: Date.now(), data };
    return data;
}

/** The feed loader as a public server function (the thesis reuses the loader and its cache). */
export const getNewsFeed = createServerFn({ method: "GET" }).handler(loadNews);

/* ------------------------------------------------------------------ */
/* SEC filings                                                         */
/* ------------------------------------------------------------------ */

/** CIKs of the researched companies (from the SEC URLs in evidence.ts). */
export const CIK: Record<string, string> = {
  MSFT: "789019",
  GOOGL: "1652044",
  AAPL: "320193",
  NVDA: "1045810",
  V: "1403161",
  COST: "909832",
  LLY: "59478",
  ETN: "1551182",
  CEG: "1868275",
};

export interface Filing {
  ticker: string;
  form: string;
  filed: string;
  description: string;
  items: string | null;
  url: string;
  /** 8-K Item 5.02 — a director or officer changed. Re-verify the operator. */
  officerChange: boolean;
}

export interface FilingsPayload {
  configured: boolean;
  fetchedAt: string;
  filings: Filing[];
  failed: string[];
  note: string;
}

let filingsCache: { at: number; data: FilingsPayload } | null = null;
const FORMS = new Set(["8-K", "10-Q", "10-K", "DEF 14A", "6-K", "20-F", "S-1", "424B4"]);

export const getFilings = createServerFn({ method: "GET" }).handler(async (): Promise<FilingsPayload> => {
    const ua = process.env.SEC_USER_AGENT?.trim();
    const fetchedAt = new Date().toISOString();
    if (!ua || !/@/.test(ua)) {
      return {
        configured: false,
        fetchedAt,
        filings: [],
        failed: [],
        note: 'SEC requires a contact email in the User-Agent and refuses anonymous requests. Set SEC_USER_AGENT on the deploy (e.g. "Ledger Desk you@example.com") to turn on filings for the researched companies.',
      };
    }
    if (filingsCache && Date.now() - filingsCache.at < CACHE_MS) return filingsCache.data;
    const since = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
    const failed: string[] = [];
    const tickers = ALL_DOSSIERS.filter((d) => d.kind === "company" && CIK[d.ticker]).map((d) => d.ticker);
    const lists = await Promise.all(
      tickers.map(async (t) => {
        const cik = CIK[t];
        try {
          const res = await fetch(`https://data.sec.gov/submissions/CIK${cik.padStart(10, "0")}.json`, {
            headers: { "User-Agent": ua, Accept: "application/json" },
            signal: AbortSignal.timeout(8_000),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const json = (await res.json()) as {
            filings?: {
              recent?: {
                form: string[];
                filingDate: string[];
                accessionNumber: string[];
                primaryDocument: string[];
                primaryDocDescription: string[];
                items: string[];
              };
            };
          };
          const r = json.filings?.recent;
          if (!r) return [] as Filing[];
          const out: Filing[] = [];
          for (let i = 0; i < r.form.length; i++) {
            if (r.filingDate[i] < since) break;
            if (!FORMS.has(r.form[i])) continue;
            const acc = r.accessionNumber[i].replace(/-/g, "");
            out.push({
              ticker: t,
              form: r.form[i],
              filed: r.filingDate[i],
              description: r.primaryDocDescription[i] || r.form[i],
              items: r.items?.[i] || null,
              url: `https://www.sec.gov/Archives/edgar/data/${cik}/${acc}/${r.primaryDocument[i]}`,
              officerChange: r.form[i] === "8-K" && /\b5\.02\b/.test(r.items?.[i] ?? ""),
            });
          }
          return out;
        } catch (e) {
          failed.push(`${t}: ${String(e instanceof Error ? e.message : e).slice(0, 60)}`);
          return [] as Filing[];
        }
      }),
    );
    const data: FilingsPayload = {
      configured: true,
      fetchedAt,
      filings: lists.flat().sort((a, b) => (a.filed < b.filed ? 1 : -1)),
      failed,
      note: "Primary documents from SEC EDGAR, last 45 days. An 8-K Item 5.02 means a director or officer changed — re-verify the operator on the Invest tab.",
    };
    filingsCache = { at: Date.now(), data };
    return data;
  });
