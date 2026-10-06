/**
 * Server side of the Predict board: Kalshi's public order book + ESPN.
 *
 * Kalshi's market data endpoints are public (no key); ESPN's site API is the
 * scoreboard the ESPN app uses (public, unofficial — the site.api host 403s
 * from some networks, site.web.api does not). Everything is fetched in
 * parallel with short timeouts so the call answers well inside the edge's
 * ~30s cut, and it is refreshed by the tab on a timer ONLY while the tab is
 * open — this is a data read, never a model, never on the trading poll.
 *
 * Also hosts getPredictionMarketFeed — broad Kalshi public markets (sports /
 * economics / politics) for The Mead Hall / Prototype Lab. READ-ONLY.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  buildBoard,
  LEAGUES,
  parseEspnScoreboard,
  parseKalshiEvents,
  parseSummaryExtras,
  parsePolyMarket,
  polySlug,
  type BoardGame,
  type PolyMarket,
  type GameExtras,
  type League,
} from "./board";
import {
  kalshiAdapterResult,
  rhMcpUnavailableAdapter,
  type KalshiPublicMarket,
  type PredictionMarketFeedResult,
  KALSHI_SOURCE_LABEL,
  RH_MCP_EMPTY_LABEL,
} from "./prediction-market-feed";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports";
const POLY_US = "https://gateway.polymarket.us/v1/markets";
const T_MS = 8_000;

/** Non-2xx upstream response. Message stays `HTTP <status>` for existing callers. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    /** Raw Retry-After header (only read on 429 / 503). */
    readonly retryAfter: string | null = null,
  ) {
    super(`HTTP ${status}`);
    this.name = "HttpError";
  }
}

/** Abort when ANY input aborts (AbortSignal.any where available, manual otherwise). */
function anySignal(signals: (AbortSignal | undefined)[]): AbortSignal {
  const list = signals.filter((x): x is AbortSignal => !!x);
  if (list.length === 1) return list[0];
  const anyFn = (AbortSignal as unknown as { any?: (s: AbortSignal[]) => AbortSignal }).any;
  if (typeof anyFn === "function") return anyFn.call(AbortSignal, list);
  const ctl = new AbortController();
  for (const s of list) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: anySignal([AbortSignal.timeout(T_MS), signal]),
    cache: "no-store",
  });
  if (!res.ok) {
    const ra = res.status === 429 || res.status === 503 ? res.headers.get("retry-after") : null;
    throw new HttpError(res.status, ra);
  }
  return res.json();
}

/** The latest live win probability for one game — two small calls. */
async function liveHomeWp(league: League, id: string): Promise<number | null> {
  const [sport, lg] = LEAGUES[league].espn.split("/");
  const base = `${ESPN_CORE}/${sport}/leagues/${lg}/events/${id}/competitions/${id}/probabilities`;
  try {
    const head = (await getJson(`${base}?limit=1`)) as { pageCount?: number };
    const last = head.pageCount && head.pageCount > 1 ? head.pageCount : 1;
    const page = (await getJson(`${base}?limit=1&page=${last}`)) as { items?: { homeWinPercentage?: number }[] };
    const v = page.items?.[0]?.homeWinPercentage;
    return typeof v === "number" && Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/** ESPN game summaries are large; the extras change slowly — 10-minute cache. */
const EXTRAS_MS = 10 * 60_000;
const extrasCache = new Map<string, { at: number; data: GameExtras }>();

async function extrasFor(league: League, id: string): Promise<GameExtras | null> {
  const hit = extrasCache.get(id);
  if (hit && Date.now() - hit.at < EXTRAS_MS) return hit.data;
  try {
    const json = await getJson(`${ESPN}/${LEAGUES[league].espn}/summary?event=${encodeURIComponent(id)}`);
    const data = parseSummaryExtras(json);
    extrasCache.set(id, { at: Date.now(), data });
    return data;
  } catch {
    return hit?.data ?? null;
  }
}

export interface PredictBoard {
  league: League;
  fetchedAt: string;
  games: BoardGame[];
  failed: string[];
  note: string;
}

/**
 * PUBLIC, like the desk's own quote calls (fetchLiveQuotes, fetchTradingDesk):
 * it reads public order books and scoreboards and touches no user data. It
 * was behind the sign-in middleware on first ship and returned
 * "Unauthorized" to a trader using the desk signed out. A short per-league
 * cache means any number of open tabs cost the upstreams one fetch per 8s.
 */
const BOARD_CACHE_MS = 8_000;
const boardCache = new Map<League, { at: number; data: PredictBoard }>();

export const getPredictBoard = createServerFn({ method: "POST" })
  .validator(z.object({ league: z.enum(["nfl", "ncaaf", "mlb", "nhl", "nba", "wnba"]) }))
  .handler(async ({ data }): Promise<PredictBoard> => {
    const hit = boardCache.get(data.league);
    if (hit && Date.now() - hit.at < BOARD_CACHE_MS) return hit.data;
    const L = LEAGUES[data.league];
    const failed: string[] = [];
    const [k, e] = await Promise.all([
      getJson(`${KALSHI}/events?series_ticker=${L.series}&status=open&limit=200&with_nested_markets=true`).catch((err) => {
        failed.push(`Kalshi: ${String(err instanceof Error ? err.message : err)}`);
        return null;
      }),
      getJson(`${ESPN}/${L.espn}/scoreboard`).catch((err) => {
        failed.push(`ESPN: ${String(err instanceof Error ? err.message : err)}`);
        return null;
      }),
    ]);
    const events = parseKalshiEvents(k);
    const games = parseEspnScoreboard(e).filter((g) => g.state !== "post" || Date.now() - Date.parse(g.start) < 8 * 3600_000);
    // Live probability for games in progress that the scoreboard did not carry.
    const live: Record<string, number | null> = {};
    const need = games.filter((g) => g.state === "in" && g.liveHomeWp == null).slice(0, 10);
    const extras: Record<string, GameExtras> = {};
    const upcoming = games.filter((g) => g.state !== "post").slice(0, 20);
    const poly: Record<string, PolyMarket> = {};
    await Promise.all([
      ...upcoming.map(async (g) => {
        const slug = polySlug(data.league, g);
        if (!slug) return;
        const pm = parsePolyMarket(await getJson(`${POLY_US}?slug=${encodeURIComponent(slug)}`).catch(() => null));
        if (pm) poly[g.id] = pm;
      }),
      ...need.map(async (g) => (live[g.id] = await liveHomeWp(data.league, g.id))),
      ...upcoming.map(async (g) => {
        const x = await extrasFor(data.league, g.id);
        if (x) extras[g.id] = x;
      }),
    ]);
    const board = buildBoard(data.league, games, events, live, undefined, extras, poly);
    const out: PredictBoard = {
      league: data.league,
      fetchedAt: new Date().toISOString(),
      games: board.sort((a, b) => {
        const rank = (x: BoardGame) => (x.game.state === "in" ? 0 : x.game.state === "pre" ? 1 : 2);
        return rank(a) !== rank(b) ? rank(a) - rank(b) : a.game.start.localeCompare(b.game.start);
      }),
      failed,
      note: "Prices: Kalshi public order book (the closest public proxy for Robinhood's quote) and, for the NFL, Polymarket US. References: DraftKings moneyline with the margin removed — the LOWEST of three de-vig methods, the buyer's conservative read (pregame, via ESPN) — and ESPN's live win probability (in-game). Both references are estimates, not the truth.",
    };
    if (!failed.length) boardCache.set(data.league, { at: Date.now(), data: out });
    return out;
  });

/* ── Broad PredictionMarketFeed (Mead Hall / Prototype Lab) ─────────────── */

/**
 * Series tickers pulled for the hall — sports + economics + politics.
 * NFL is included but ranking (not this list) decides order; Vikings get no
 * special series.
 */
export const KALSHI_FEED_SERIES = [
  "KXNFLGAME",
  "KXNBAGAME",
  "KXMLBGAME",
  "KXNHLGAME",
  "KXHIGHNY",
  "KXGDP",
  "KXBTCD",
  "KXCPIYOY",
] as const;

const FEED_CACHE_MS = 12_000;
let feedCache: { at: number; data: PredictionMarketFeedResult } | null = null;

const RH_MCP_NOTE =
  `RH MCP empty stub (${RH_MCP_EMPTY_LABEL}) — no event-contract tools; Kalshi public is the quote source.`;

/** Gap between series fetches to avoid Kalshi public 429s when many series fire at once. */
export const KALSHI_SERIES_GAP_MS = 175;
/** Max in-flight series requests (1 = fully sequential; 2 = small pool). */
export const KALSHI_SERIES_CONCURRENCY = 1;
const KALSHI_429_RETRIES = 3;
const KALSHI_429_BACKOFF_MS = 400;
const KALSHI_429_BACKOFF_MAX_MS = 2_500;
/**
 * Longest Retry-After we will honor on a 429. A server ask ≤ this is waited
 * out exactly; a longer ask is NOT retried early (that only earns another
 * 429) — the series fails with the Retry-After in its reason.
 */
export const KALSHI_RETRY_AFTER_CAP_MS = 3_000;
/**
 * Total wall-clock budget for one serial Kalshi feed pass (all series, gaps,
 * retries). Well inside the edge's ~30s cut. When it runs out, the in-flight
 * request is aborted, remaining series are skipped, and the feed returns what
 * it has (or empty) with `deadlineExceeded: true` and a reason.
 */
export const KALSHI_FEED_DEADLINE_MS = 12_000;

/** Thrown / used as the abort reason when the feed's total budget runs out. */
export class FeedDeadlineError extends Error {
  constructor(readonly budgetMs: number) {
    super(`feed deadline ${budgetMs}ms exceeded`);
    this.name = "FeedDeadlineError";
  }
}

/** Sleep that rejects with the signal's reason when aborted. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Settle with `p`, or reject with the signal's reason as soon as it aborts —
 * so a fetch that does not honor abort (e.g. stuck in DNS/TLS) cannot hold
 * the feed past its deadline.
 */
function raceAbort<T>(p: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener("abort", onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener("abort", onAbort);
        reject(e);
      },
    );
  });
}

/**
 * Parse an HTTP Retry-After value → milliseconds to wait (≥ 0), or null if
 * absent/unparseable. Accepts delta-seconds ("2", "1.5") or an HTTP-date.
 */
export function parseRetryAfterMs(value: string | null | undefined, nowMs = Date.now()): number | null {
  if (value == null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000);
  if (/^\d/.test(v) || v.startsWith("-")) return null; // not a valid delta, not a date
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, at - nowMs) : null;
}

/**
 * Map items with small concurrency + inter-batch delay. Exported for verify.
 * With `opts.signal`, no new batch starts after it aborts; unstarted slots
 * stay `undefined` in the output.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  gapMs: number,
  fn: (item: T, index: number) => Promise<R>,
  opts: { signal?: AbortSignal } = {},
): Promise<(R | undefined)[]> {
  const out: (R | undefined)[] = new Array(items.length).fill(undefined);
  const n = Math.max(1, Math.floor(concurrency));
  for (let i = 0; i < items.length; i += n) {
    if (opts.signal?.aborted) break;
    if (i > 0 && gapMs > 0) {
      try {
        await sleep(gapMs, opts.signal);
      } catch {
        break;
      }
    }
    const slice = items.slice(i, i + n);
    await Promise.all(
      slice.map(async (item, j) => {
        out[i + j] = await fn(item, i + j);
      }),
    );
  }
  return out;
}

export interface SeriesFetchCtx {
  signal?: AbortSignal;
  /** Epoch ms after which no retry wait may start. */
  deadlineAt?: number;
}

async function fetchKalshiSeriesOnce(series: string, limit: number, ctx: SeriesFetchCtx = {}): Promise<KalshiPublicMarket[]> {
  const url = `${KALSHI}/markets?limit=${limit}&status=open&series_ticker=${encodeURIComponent(series)}`;
  const json = (await getJson(url, ctx.signal)) as { markets?: KalshiPublicMarket[] };
  const markets = Array.isArray(json.markets) ? json.markets : [];
  return markets.map((m) => ({ ...m, _series: series }));
}

export interface FetchSeriesOptions extends SeriesFetchCtx {
  /** Injection points for verify — default to the real fetch / timer / clock. */
  fetchOnce?: (series: string, limit: number, ctx: SeriesFetchCtx) => Promise<KalshiPublicMarket[]>;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

const is429 = (err: unknown) =>
  err instanceof HttpError ? err.status === 429 : /HTTP 429/.test(String(err instanceof Error ? err.message : err));

/**
 * One series with retry on HTTP 429:
 *   - Retry-After present and ≤ KALSHI_RETRY_AFTER_CAP_MS → wait exactly that.
 *   - Retry-After present and > cap → give up on this series (no early retry).
 *   - No / unparseable Retry-After → exponential backoff (400ms → 2.5s max).
 * A wait that would cross `deadlineAt` is not started (fails fast instead).
 */
export async function fetchKalshiSeries(series: string, limit = 40, opts: FetchSeriesOptions = {}): Promise<KalshiPublicMarket[]> {
  const once = opts.fetchOnce ?? fetchKalshiSeriesOnce;
  const nap = opts.sleepFn ?? sleep;
  const now = opts.now ?? Date.now;
  let backoff = KALSHI_429_BACKOFF_MS;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= KALSHI_429_RETRIES; attempt++) {
    try {
      return await once(series, limit, { signal: opts.signal, deadlineAt: opts.deadlineAt });
    } catch (err) {
      lastErr = err;
      if (opts.signal?.aborted || !is429(err) || attempt === KALSHI_429_RETRIES) throw err;
      const ra = parseRetryAfterMs(err instanceof HttpError ? err.retryAfter : null, now());
      if (ra != null && ra > KALSHI_RETRY_AFTER_CAP_MS) {
        throw new Error(`HTTP 429 — Retry-After ${ra}ms exceeds cap ${KALSHI_RETRY_AFTER_CAP_MS}ms; not retried`);
      }
      const wait = ra ?? backoff;
      if (opts.deadlineAt != null && now() + wait >= opts.deadlineAt) {
        throw new Error(`HTTP 429 — retry wait ${wait}ms would pass the feed deadline; not retried`);
      }
      await nap(wait, opts.signal);
      backoff = Math.min(backoff * 2, KALSHI_429_BACKOFF_MAX_MS);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export interface KalshiFeedOptions {
  /** Total wall-clock budget (default KALSHI_FEED_DEADLINE_MS). */
  deadlineMs?: number;
  gapMs?: number;
  concurrency?: number;
  /** Injection point for verify — defaults to fetchKalshiSeries. */
  fetchSeries?: (series: string, limit: number, ctx: SeriesFetchCtx) => Promise<KalshiPublicMarket[]>;
}

/**
 * Serial Kalshi feed pass under ONE total deadline. Never throws: returns the
 * markets it got, plus `skipped` / `deadlineExceeded` / `reason` when short.
 * Exported (not a server fn) so verify can drive it with a fake fetcher.
 */
export async function fetchKalshiFeed(
  series: readonly string[],
  limit: number,
  opts: KalshiFeedOptions = {},
): Promise<PredictionMarketFeedResult> {
  const budget = Math.max(1, opts.deadlineMs ?? KALSHI_FEED_DEADLINE_MS);
  const deadlineAt = Date.now() + budget;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new FeedDeadlineError(budget)), budget);
  const fetchSeries = opts.fetchSeries ?? ((s: string, n: number, ctx: SeriesFetchCtx) => fetchKalshiSeries(s, n, ctx));
  const failed: string[] = [];
  const cutByDeadline: string[] = [];
  let chunks: (KalshiPublicMarket[] | undefined)[] = [];
  try {
    chunks = await mapWithConcurrency(
      series,
      opts.concurrency ?? KALSHI_SERIES_CONCURRENCY,
      opts.gapMs ?? KALSHI_SERIES_GAP_MS,
      async (s) => {
        try {
          const rows = await raceAbort(fetchSeries(s, limit, { signal: ctl.signal, deadlineAt }), ctl.signal);
          // A fetcher that ignored the signal and answered late is still over budget.
          if (ctl.signal.aborted) {
            cutByDeadline.push(s);
            return undefined;
          }
          return rows;
        } catch (err) {
          if (ctl.signal.aborted || err instanceof FeedDeadlineError) cutByDeadline.push(s);
          else failed.push(`${s}: ${String(err instanceof Error ? err.message : err)}`);
          return undefined;
        }
      },
      { signal: ctl.signal },
    );
  } finally {
    clearTimeout(timer);
  }
  const deadlineExceeded = ctl.signal.aborted;
  const notStarted = series.filter((s, i) => chunks[i] === undefined && !cutByDeadline.includes(s) && !failed.some((f) => f.startsWith(`${s}:`)));
  const deadlineSkipped = [...cutByDeadline, ...notStarted];
  const skipped = series.filter((s, i) => chunks[i] === undefined);
  const raw = chunks.flatMap((c) => c ?? []);
  const asOf = new Date().toISOString();
  const deadlineNote = deadlineExceeded
    ? `Kalshi feed deadline ${budget}ms exceeded — not read: ${deadlineSkipped.join(", ") || "(none)"}`
    : "";
  const failNote = failed.length ? `failed: ${failed.join(" · ")}` : "";
  const out = kalshiAdapterResult(raw, asOf);
  if (deadlineExceeded) out.deadlineExceeded = true;
  if (skipped.length) out.skipped = skipped;
  if (!raw.length) {
    out.reason = deadlineExceeded
      ? `${deadlineNote}${failNote ? `; ${failNote}` : ""}. ${RH_MCP_NOTE}`
      : failed.length
        ? `Kalshi public read failed (${failed.join(" · ")}). ${RH_MCP_NOTE}`
        : `Kalshi returned no open markets for ${series.join(", ")}. ${RH_MCP_NOTE}`;
  } else if (deadlineExceeded || failed.length) {
    out.reason = `Partial Kalshi read — ${[deadlineNote, failNote].filter(Boolean).join("; ")}`;
  }
  return out;
}

/**
 * PUBLIC read-only PredictionMarketFeed from Kalshi trade-api/v2 (no API key).
 * Server function avoids browser CORS. Paper/UI only — never places orders.
 * Series fetches are serialized (low concurrency + gap), 429s honor a capped
 * Retry-After, and the whole pass runs under KALSHI_FEED_DEADLINE_MS.
 */
export const getPredictionMarketFeed = createServerFn({ method: "POST" })
  .validator(
    z
      .object({
        series: z.array(z.string().min(2).max(64)).max(20).optional(),
        limitPerSeries: z.number().int().min(1).max(100).optional(),
      })
      .optional(),
  )
  .handler(async ({ data }): Promise<PredictionMarketFeedResult> => {
    if (feedCache && Date.now() - feedCache.at < FEED_CACHE_MS) return feedCache.data;
    const series = data?.series?.length ? data.series : [...KALSHI_FEED_SERIES];
    const limit = data?.limitPerSeries ?? 30;
    const out = await fetchKalshiFeed(series, limit);
    // Cache only results that carry rows (full or partial) — empties re-try next call.
    if (out.markets.length) feedCache = { at: Date.now(), data: out };
    return out;
  });

/** Explicit empty stub for callers that asked RH MCP for event contracts. */
export function getRhMcpUnavailableFeed(): PredictionMarketFeedResult {
  return rhMcpUnavailableAdapter();
}

export { KALSHI_SOURCE_LABEL };
