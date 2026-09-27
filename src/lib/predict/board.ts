/**
 * The Predict board — Kalshi game contracts next to independent references.
 *
 * Robinhood routes sports contracts to several exchanges — on 2026-09-27 its
 * NFL moneylines were listed on Rothera, with OG.com and Kalshi also in the
 * routing. Kalshi's public order book is the closest public proxy (within a
 * cent or two of Robinhood's quotes that morning); the fee model is chosen
 * per venue in math.ts. Each game gets:
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
import { devig } from "./devig";

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
  /** Contracts resting at the best bid / best ask — how much the quote is good for. */
  bidSize: number | null;
  askSize: number | null;
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
          bidSize: num(m.yes_bid_size_fp),
          askSize: num(m.yes_ask_size_fp),
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
  /** DraftKings' opening moneyline — the start of the line's movement. */
  moneylineOpen: number | null;
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
        moneylineOpen: parseAmerican(ml?.[ha]?.open?.odds),
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
  /** Stadium forecast (ESPN via AccuWeather): wind gusts in mph, precipitation figure, roof. */
  gust?: number | null;
  precip?: number | null;
  indoor?: boolean | null;
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
  const w = d.gameInfo?.weather;
  return {
    modelHome: pct(d.predictor?.homeTeam?.gameProjection),
    modelAway: pct(d.predictor?.awayTeam?.gameProjection),
    injuries,
    gust: num(w?.gust),
    precip: num(w?.precipitation),
    indoor: typeof d.gameInfo?.venue?.indoor === "boolean" ? d.gameInfo.venue.indoor : null,
  };
}

/** One Polymarket US moneyline: the listed ("long") team's best bid/ask. */
export interface PolyMarket {
  /** ESPN team code of the listed side. */
  longCode: string;
  bid: number | null;
  ask: number | null;
}

export interface PolyQuote {
  bid: number | null;
  ask: number | null;
}

/** Polymarket US writes Washington as "was"; every other NFL code matched ESPN's on 2026-09-27. */
const POLY_CODE: Record<string, string> = { WSH: "was" };
const POLY_BACK: Record<string, string> = { WAS: "WSH" };

/** The Polymarket US slug for an NFL game: away first, ET date. */
export function polySlug(league: League, g: EspnGame): string | null {
  if (league !== "nfl") return null;
  const code = (c: string) => POLY_CODE[c] ?? c.toLowerCase();
  return "aec-nfl-" + code(g.away.code) + "-" + code(g.home.code) + "-" + g.date;
}

/** Polymarket US GET /v1/markets?slug= -> the listed side and its quote. Pure. */
export function parsePolyMarket(json: unknown): PolyMarket | null {
  const m = (json as { markets?: Record<string, any>[] })?.markets?.[0];
  if (!m) return null;
  // A closed, inactive or halted market's last quote is not a price.
  if (m.closed === true || m.active === false || (typeof m.status === "string" && m.status !== "MARKET_STATUS_OPEN")) return null;
  const long = (Array.isArray(m.marketSides) ? m.marketSides : []).find((x: any) => x?.long === true);
  const abbr = String(long?.team?.abbreviation ?? "").toUpperCase();
  if (!abbr) return null;
  const bid = num(m.bestBidQuote?.value);
  const ask = num(m.bestAskQuote?.value);
  // One-sided or crossed books have no midpoint worth using.
  const sane = bid != null && ask != null && bid > 0 && ask < 1 && bid <= ask;
  return { longCode: POLY_BACK[abbr] ?? abbr, bid: sane ? bid : null, ask: sane ? ask : null };
}

/** The quote for either team: the listed side as quoted, the other as its complement. */
export function polyQuoteFor(pm: PolyMarket | undefined, code: string): PolyQuote | null {
  if (!pm) return null;
  if (pm.longCode === code) return { bid: pm.bid, ask: pm.ask };
  const r = (x: number | null) => (x == null ? null : Math.round((1 - x) * 10_000) / 10_000);
  return { bid: r(pm.ask), ask: r(pm.bid) };
}

export interface SideRead {
  side: KalshiSide | null;
  team: EspnTeam;
  /** DraftKings, margin removed (proportional). */
  book: number | null;
  /** The same book under three de-vig methods (proportional, power, Shin): [lowest, highest]. */
  bookRange: [number, number] | null;
  /** DraftKings at the OPEN, margin removed — book minus bookOpen is the line's move. */
  bookOpen: number | null;
  /** Polymarket US quote for this team, where listed. */
  poly: PolyQuote | null;
  /** ESPN's pregame matchup model for this team. */
  model: number | null;
  /** Kalshi's own implied probability: the bid/ask midpoint. */
  market: number | null;
  /** ESPN live win probability for this team (in-game only). */
  live: number | null;
  /**
   * The reference in use: ESPN live during the game; before it, the book's
   * LOWEST fair value across the three de-vig methods — the buyer's
   * conservative read, because the method alone moves it by about a cent.
   */
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
  /** Stadium forecast from the game summary (null until loaded). */
  wx: { gust: number | null; precip: number | null; indoor: boolean | null } | null;
}

function read(
  side: KalshiSide | null,
  team: EspnTeam,
  book: number | null,
  live: number | null,
  model: number | null,
  fees: FeeModel,
  bookRange: [number, number] | null = null,
  bookOpen: number | null = null,
  poly: PolyQuote | null = null,
): SideRead {
  const reference = live ?? (bookRange ? bookRange[0] : book);
  const refName = live != null ? "ESPN live" : book != null ? "DraftKings no-vig" : null;
  const ask = side?.ask ?? null;
  const e = ask != null && reference != null && ask > 0 && ask < 1 ? entryEdge(ask, reference, fees) : null;
  const market = side?.bid != null && side?.ask != null ? (side.bid + side.ask) / 2 : side?.last ?? null;
  return {
    side,
    team,
    book,
    bookRange,
    bookOpen,
    poly,
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
  poly: Record<string, PolyMarket> = {},
): BoardGame[] {
  return games.map((g) => {
    const ev =
      events.find((e) => e.date === g.date && e.sides.some((s) => s.code === g.home.code) && e.sides.some((s) => s.code === g.away.code)) ??
      events.find((e) => e.sides.some((s) => s.code === g.home.code) && e.sides.some((s) => s.code === g.away.code)) ??
      null;
    const pa = americanToProb(g.away.moneyline ?? NaN);
    const ph = americanToProb(g.home.moneyline ?? NaN);
    const nv = noVig(pa, ph);
    const dv = pa != null && ph != null ? devig(pa, ph) : null;
    const nvOpen = noVig(americanToProb(g.away.moneylineOpen ?? NaN), americanToProb(g.home.moneylineOpen ?? NaN));
    const homeLive = g.state === "in" ? (liveWp[g.id] ?? g.liveHomeWp) : null;
    const awayLive = homeLive != null ? Math.max(0, 1 - homeLive) : null;
    const sideFor = (code: string) => ev?.sides.find((s) => s.code === code) ?? null;
    const x = extras[g.id];
    const pm = poly[g.id];
    const rng = (i: 0 | 1): [number, number] | null => (dv ? [dv.lo[i], dv.hi[i]] : null);
    return {
      league,
      game: g,
      eventTicker: ev?.eventTicker ?? null,
      away: read(sideFor(g.away.code), g.away, nv?.a ?? null, awayLive, x?.modelAway ?? null, fees, rng(0), nvOpen?.a ?? null, polyQuoteFor(pm, g.away.code)),
      home: read(sideFor(g.home.code), g.home, nv?.b ?? null, homeLive, x?.modelHome ?? null, fees, rng(1), nvOpen?.b ?? null, polyQuoteFor(pm, g.home.code)),
      overround: nv?.overround ?? null,
      injuries: x?.injuries ?? {},
      wx: x ? { gust: x.gust ?? null, precip: x.precip ?? null, indoor: x.indoor ?? null } : null,
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

/** A side's value at the ask for a chosen venue's fees (the server computes the default venue). */
export function sideEdge(s: SideRead, fees: FeeModel = DEFAULT_FEES): number | null {
  const ask = s.side?.ask ?? null;
  if (ask == null || s.reference == null || !(ask > 0 && ask < 1)) return null;
  return Math.round(entryEdge(ask, s.reference, fees).edge * 1000) / 1000;
}

/**
 * Late-game underdog: a live side under 30¢ in the final period. The
 * evidence (Page 2012; Moshrefi 2026) is that these win less often than
 * their price — the opposite of what "buy the comeback" hopes.
 */
export function lateUnderdog(b: BoardGame, s: SideRead): boolean {
  if (b.game.state !== "in" || s.side?.ask == null || s.side.ask >= 0.3) return false;
  // ESPN writes "5:12 - 3rd" for hockey and "Bot 9th" for baseball; the old pattern missed hockey's 3rd.
  const late = b.league === "nhl" ? /\b(3rd|OT|SO)\b/i : b.league === "mlb" ? /\b(8th|9th|1\dth)\b/i : /\b(4th|OT)\b/i;
  return late.test(b.game.detail);
}

/** One sentence per game, for the top of the card. Mechanics, not a pick. */
export function gameLine(b: BoardGame, fees: FeeModel = DEFAULT_FEES): string {
  const sides = [b.away, b.home]
    .map((s) => ({ ...s, edge: sideEdge(s, fees) }))
    .filter((s) => s.edge != null && s.side);
  if (!sides.length) return b.eventTicker ? "No reference to compare against yet." : "No Kalshi contract found for this game.";
  const best = [...sides].sort((x, y) => (y.edge ?? -1) - (x.edge ?? -1))[0];
  const e = best.edge ?? 0;
  const ref = best.referenceName ?? "the reference";
  if (e > 0.005) {
    return `${best.team.code} at ${Math.round((best.side?.ask ?? 0) * 100)}¢ is ${(e * 100).toFixed(1)}¢ below ${ref} after fees — a gap, if ${ref} is right.`;
  }
  return `Both sides cost at least what ${ref} says they are worth once fees are paid — no gap to buy.`;
}


/** A quarterback on this team's injury report (Out / Doubtful / Questionable). */
export function qbFlag(b: BoardGame, code: string): string | null {
  return (b.injuries[code] ?? []).find((x) => x.startsWith("QB ")) ?? null;
}

/** Where the market, the book and ESPN's model disagree enough to look twice (pregame only). */
export function disagreement(b: BoardGame, s: SideRead): string | null {
  if (b.game.state !== "pre" || s.book == null) return null;
  const out: string[] = [];
  if (s.model != null && Math.abs(s.model - s.book) >= 0.06) out.push("ESPN model " + p0(s.model) + " vs book " + p0(s.book));
  if (s.market != null && Math.abs(s.market - s.book) >= 0.03) out.push("Kalshi " + p0(s.market) + " vs book " + p0(s.book));
  return out.length ? out.join(" · ") : null;
}

/** Wind or rain worth knowing about. The book has the same forecast — context, not an edge. */
export function weatherFlag(b: BoardGame): string | null {
  const w = b.wx;
  if (!w || w.indoor) return null;
  const parts: string[] = [];
  if (w.gust != null && w.gust >= 20) parts.push("gusts " + w.gust + " mph");
  // ESPN's precipitation figure is read as a percent chance; the 50 floor keeps any other unit from tripping it.
  if (w.precip != null && w.precip >= 50) parts.push("precipitation " + w.precip + "%");
  return parts.length ? parts.join(", ") + " — lower scoring, more variance; the book has the same forecast" : null;
}

/** NFL inactive lists are due 90 minutes before kickoff — the last big news before the price settles. */
export function inactivesLine(b: BoardGame, now = Date.now()): string | null {
  if (b.league !== "nfl" || b.game.state !== "pre") return null;
  const k = Date.parse(b.game.start);
  if (!Number.isFinite(k)) return null;
  const due = k - 90 * 60_000;
  const t = new Date(due).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit" });
  return now < due ? "inactives due ~" + t + " ET" : "inactives were due " + t + " ET — check them before buying";
}
