/**
 * Server side of the Predict board: Kalshi's public order book + ESPN.
 *
 * Kalshi's market data endpoints are public (no key); ESPN's site API is the
 * scoreboard the ESPN app uses (public, unofficial — the site.api host 403s
 * from some networks, site.web.api does not). Everything is fetched in
 * parallel with short timeouts so the call answers well inside the edge's
 * ~30s cut, and it is refreshed by the tab on a timer ONLY while the tab is
 * open — this is a data read, never a model, never on the trading poll.
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

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
const KALSHI = "https://api.elections.kalshi.com/trade-api/v2";
const ESPN = "https://site.web.api.espn.com/apis/site/v2/sports";
const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports";
const POLY_US = "https://gateway.polymarket.us/v1/markets";
const T_MS = 8_000;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(T_MS),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
