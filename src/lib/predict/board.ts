/**
 * The Predict board — Kalshi game contracts next to independent references.
 *
 * Robinhood's sports event contracts are listed on Kalshi, so Kalshi's public
 * order book is the price the trader sees (Robinhood adds its own commission;
 * math.ts carries both). Each game gets:
 *   - the contract's bid / ask / last / volume for both teams (Kalshi API);
 *   - DraftKings' moneyline with the bookmaker margin removed (via ESPN's
 *     scoreboard) — the sportsbook consensus, pregame;
 *   - ESPN's live win probability during the game (ESPN's model).
 * The board prints, per side, what a buy at the ask is worth IF the reference
 * were the truth, after fees. That is a comparison, not a prediction: the
 * sportsbook and ESPN can both be wrong, and the tab says which it is using.
 *
 * Pure: parsing and matching only. Fetching lives in predict-server.ts.
 */

import { americanToProb, entryEdge, noVig, parseAmerican, LONGSHOT_BELOW, type FeeModel, DEFAULT_FEES } from "./math";

export type League = "nfl" | "ncaaf" | "mlb" | "nhl" | "nba" | "wnba";

export const LEAGUES: Record<League, { label: string; series: string; espn: string }> = {
  nfl: { label: "NFL", series: "KXNFLGAME", espn: "football/nfl" },
  ncaaf: { label: "College football", series: "KXNCAAFGAME", espn: "football/college-football" },
  mlb: { label: "MLB", series: "KXMLBGAME", espn: "baseball/mlb" },
  nhl: { label: "NHL", series: "KXNHLGAME", espn: "hockey/nhl" },
  nba: { label: "NBA", series: "KXNBAGAME", espn: "basketball/nba" },
  wnba: { label: "WNBA", series: "KXWNBAGAME", espn: "basketball/wnba" },
};

/** Where Kalshi's team code differs from ESPN's. Checked 2026-09-27. */
const CODE_FIX: Record<string, string> = { JAC: "JAX", WAS: "WSH" };

export interface KalshiSide {
  ticker: string;
  code: string;
  label: string;
  bid: number | null;
  ask: number | null;
  last: number | null;
  prev: number | null;
  volume: number | null;
  volume24h: number | null;
  openInterest: number | null;
  status: string;
}

export interface KalshiEvent {
  eventTicker: string;
  title: string;
  /** "YYYY-MM-DD" parsed from the ticker (e.g. 26SEP27 → 2026-09-27). */
  date: string | null;
  sides: KalshiSide[];
}

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

const MONTHS: Record<string, string> = { JAN: "01", FEB: "02", MAR: "03", APR: "04", MAY: "05", JUN: "06", JUL: "07", AUG: "08", SEP: "09", OCT: "10", NOV: "11", DEC: "12" };

export function dateFromTicker(eventTicker: string): string | null {
  const m = /-(\d{2})([A-Z]{3})(\d{2})/.exec(eventTicker);
  if (!m || !MONTHS[m[2]]) return null;
  return `20${m[1]}-${MONTHS[m[2]]}-${m[3]}`;
}

/** Kalshi /events?with_nested_markets=true → events with both sides priced. */
export function parseKalshiEvents(json: unknown): KalshiEvent[] {
  const events = (json as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: KalshiEvent[] = [];
  for (const raw of events) {
    const e = raw as Record<string, unknown>;
    const markets = Array.isArray(e.markets) ? (e.markets as Record<string, unknown>[]) : [];
    const sides: KalshiSide[] = markets
      .filter((m) => typeof m.ticker === "string")
      .map((m) => {
        const code = String(m.ticker).split("-").at(-1) ?? "";
        return {
          ticker: String(m.ticker),
          code: CODE_FIX[code] ?? code,
          label: String(m.yes_sub_title ?? code),
          bid: num(m.yes_bid_dollars),
          ask: num(m.yes_ask_dollars),
          last: num(m.last_price_dollars),
          prev: num(m.previous_price_dollars),
          volume: num(m.volume_fp),
          volume24h: num(m.volume_24h_fp),
          openInterest: num(m.open_interest_fp),
          status: String(m.status ?? ""),
        };
      });
    const eventTicker = String(e.event_ticker ?? "");
    out.push({ eventTicker, title: String(e.title ?? ""), date: dateFromTicker(eventTicker), sides });
  }
  return out;
}

export interface EspnTeam {
  code: string;
  name: string;
  homeAway: "home" | "away";
  score: number | null;
  record: string | null;
  moneyline: number | null;
}

export interface EspnGame {
  id: string;
  /** Kickoff ISO. */
  start: string;
  /** ET calendar date of kickoff. */
  date: string;
  state: "pre" | "in" | "post";
  detail: string;
  home: EspnTeam;
  away: EspnTeam;
  spreadLine: string | null;
  overUnder: number | null;
  /** Live home win probability if the scoreboard carries it. */
  liveHomeWp: number | null;
  possession: string | null;
  downDistance: string | null;
  weather: string | null;
}

function etDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** ESPN site scoreboard → games with DraftKings moneylines. */
export function parseEspnScoreboard(json: unknown): EspnGame[] {
  const events = (json as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: EspnGame[] = [];
  for (const raw of events) {
    const e = raw as Record<string, any>;
    const c = e.competitions?.[0];
    if (!c) continue;
    const odds = c.odds?.[0] ?? {};
    const ml = odds.moneyline ?? {};
    const team = (ha: "home" | "away"): EspnTeam | null => {
      const t = (c.competitors ?? []).find((x: any) => x.homeAway === ha);
      if (!t) return null;
      const line = parseAmerican(ml?.[ha]?.close?.odds ?? ml?.[ha]?.current?.odds ?? ml?.[ha]?.open?.odds ?? odds?.[`${ha}TeamOdds`]?.moneyLine);
      return {
        code: String(t.team?.abbreviation ?? ""),
        name: String(t.team?.displayName ?? t.team?.abbreviation ?? ""),
        homeAway: ha,
        score: num(t.score),
        record: t.records?.[0]?.summary ?? null,
        moneyline: line,
      };
    };
    const home = team("home");
    const away = team("away");
    if (!home || !away) continue;
    const st = e.status?.type ?? {};
    const sit = c.situation ?? {};
    const lp = sit.lastPlay?.probability;
    out.push({
      id: String(e.id),
      start: String(e.date),
      date: etDate(String(e.date)),
      state: st.state === "in" ? "in" : st.state === "post" ? "post" : "pre",
      detail: String(st.shortDetail ?? ""),
      home,
      away,
      spreadLine: odds.details ?? null,
      overUnder: num(odds.overUnder),
      liveHomeWp: num(lp?.homeWinPercentage),
      possession: sit.possession ? String(sit.possession) : null,
      downDistance: sit.downDistanceText ? String(sit.downDistanceText) : null,
      // ESPN sometimes puts a bare condition code in displayValue; only words are shown.
      weather:
        e.weather?.temperature != null || /[a-z]/i.test(String(e.weather?.displayValue ?? ""))
          ? [/[a-z]/i.test(String(e.weather?.displayValue ?? "")) ? String(e.weather.displayValue) : null, e.weather?.temperature != null ? `${e.weather.temperature}°` : null]
              .filter(Boolean)
              .join(", ") || null
          : null,
    });
  }
  return out;
}

/** Per-game extras from ESPN's game summary (cached server-side). */
export interface GameExtras {
  /** ESPN's matchup predictor (FPI), pregame, 0–1. */
  modelHome: number | null;
  modelAway: number | null;
  /** Key injuries by team code: "QB Name (Out)". Injured reserve left out. */
  injuries: Record<string, string[]>;
}

/** ESPN summary JSON → the extras. Pure. */
export function parseSummaryExtras(json: unknown): GameExtras {
  const d = (json ?? {}) as Record<string, any>;
  const pct = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n > 0 && n < 100 ? Math.round(n * 100) / 10_000 : null;
  };
  const injuries: Record<string, string[]> = {};
  const RANK: Record<string, number> = { QB: 0, RB: 1, WR: 1, TE: 1, P: 5, K: 4 };
  for (const t of Array.isArray(d.injuries) ? d.injuries : []) {
    const code = String(t?.team?.abbreviation ?? "");
    if (!code) continue;
    const rows = (Array.isArray(t.injuries) ? t.injuries : [])
      .filter((i: any) => /^(out|doubtful|questionable)$/i.test(String(i?.status ?? "")))
      .map((i: any) => ({
        pos: String(i?.athlete?.position?.abbreviation ?? ""),
        name: String(i?.athlete?.displayName ?? ""),
        status: String(i?.status ?? ""),
      }))
      .sort((a: { pos: string }, b: { pos: string }) => (RANK[a.pos] ?? 3) - (RANK[b.pos] ?? 3));
    injuries[CODE_FIX[code] ?? code] = rows.slice(0, 4).map((r: { pos: string; name: string; status: string }) => `${r.pos} ${r.name} (${r.status})`);
  }
  return {
    modelHome: pct(d.predictor?.homeTeam?.gameProjection),
    modelAway: pct(d.predictor?.awayTeam?.gameProjection),
    injuries,
  };
}

export interface SideRead {
  side: KalshiSide | null;
  team: EspnTeam;
  /** DraftKings, margin removed. */
  book: number | null;
  /** ESPN's pregame matchup model for this team. */
  model: number | null;
  /** Kalshi's own implied probability: the bid/ask midpoint. */
  market: number | null;
  /** ESPN live win probability for this team (in-game only). */
  live: number | null;
  /** The reference in use: live during the game, the book before it. */
  reference: number | null;
  referenceName: "ESPN live" | "DraftKings no-vig" | null;
  /** Dollars per contract if bought at the ask and the reference is true, after fees. */
  edge: number | null;
  spread: number | null;
  longshot: boolean;
}

export interface BoardGame {
  league: League;
  game: EspnGame;
  eventTicker: string | null;
  away: SideRead;
  home: SideRead;
  overround: number | null;
  injuries: Record<string, string[]>;
}

function read(
  side: KalshiSide | null,
  team: EspnTeam,
  book: number | null,
  live: number | null,
  model: number | null,
  fees: FeeModel,
): SideRead {
  const reference = live ?? book;
  const refName = live != null ? "ESPN live" : book != null ? "DraftKings no-vig" : null;
  const ask = side?.ask ?? null;
  const e = ask != null && reference != null && ask > 0 && ask < 1 ? entryEdge(ask, reference, fees) : null;
  const market = side?.bid != null && side?.ask != null ? (side.bid + side.ask) / 2 : side?.last ?? null;
  return {
    side,
    team,
    book,
    model,
    market,
    live,
    reference,
    referenceName: refName,
    edge: e ? Math.round(e.edge * 1000) / 1000 : null,
    spread: side?.ask != null && side?.bid != null ? Math.round((side.ask - side.bid) * 100) / 100 : null,
    longshot: ask != null && ask < LONGSHOT_BELOW,
  };
}

/**
 * Pair each ESPN game with its Kalshi event by date and both team codes. A
 * game with no Kalshi event still shows (references only); a Kalshi event
 * with no ESPN game is dropped — the board is organised around real games.
 */
export function buildBoard(
  league: League,
  games: EspnGame[],
  events: KalshiEvent[],
  liveWp: Record<string, number | null> = {},
  fees: FeeModel = DEFAULT_FEES,
  extras: Record<string, GameExtras> = {},
): BoardGame[] {
  return games.map((g) => {
    const ev =
      events.find((e) => e.date === g.date && e.sides.some((s) => s.code === g.home.code) && e.sides.some((s) => s.code === g.away.code)) ??
      events.find((e) => e.sides.some((s) => s.code === g.home.code) && e.sides.some((s) => s.code === g.away.code)) ??
      null;
    const pa = americanToProb(g.away.moneyline ?? NaN);
    const ph = americanToProb(g.home.moneyline ?? NaN);
    const nv = noVig(pa, ph);
    const homeLive = g.state === "in" ? (liveWp[g.id] ?? g.liveHomeWp) : null;
    const awayLive = homeLive != null ? Math.max(0, 1 - homeLive) : null;
    const sideFor = (code: string) => ev?.sides.find((s) => s.code === code) ?? null;
    const x = extras[g.id];
    return {
      league,
      game: g,
      eventTicker: ev?.eventTicker ?? null,
      away: read(sideFor(g.away.code), g.away, nv?.a ?? null, awayLive, x?.modelAway ?? null, fees),
      home: read(sideFor(g.home.code), g.home, nv?.b ?? null, homeLive, x?.modelHome ?? null, fees),
      overround: nv?.overround ?? null,
      injuries: x?.injuries ?? {},
    };
  });
}

const p0 = (x: number | null | undefined) => (x == null ? "—" : `${(x * 100).toFixed(1)}%`);

/**
 * The three estimates side by side for one team — the market (Kalshi's
 * midpoint), the book (DraftKings without its margin) and the model (ESPN,
 * pregame matchup or live win probability). Where they disagree is the
 * useful part; the tab never averages them into one "true" number.
 */
export function threeWay(s: SideRead): string {
  const model = s.live ?? s.model;
  return `${s.team.code}: market ${p0(s.market)} · book ${p0(s.book)} · ESPN ${s.live != null ? "live" : "model"} ${p0(model)}`;
}

/** One sentence per game, for the top of the card. Mechanics, not a pick. */
export function gameLine(b: BoardGame): string {
  const sides = [b.away, b.home].filter((s) => s.edge != null && s.side);
  if (!sides.length) return b.eventTicker ? "No reference to compare against yet." : "No Kalshi contract found for this game.";
  const best = [...sides].sort((x, y) => (y.edge ?? -1) - (x.edge ?? -1))[0];
  const e = best.edge ?? 0;
  const ref = best.referenceName ?? "the reference";
  if (e > 0.005) {
    return `${best.team.code} at ${Math.round((best.side?.ask ?? 0) * 100)}¢ is ${(e * 100).toFixed(1)}¢ below ${ref} after fees — a gap, if ${ref} is right.`;
  }
  return `Both sides cost at least what ${ref} says they are worth once fees are paid — no gap to buy.`;
}
