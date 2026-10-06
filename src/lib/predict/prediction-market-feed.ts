/**
 * PredictionMarketFeed — read-only event-contract quotes for The Mead Hall /
 * Predict tab / Prototype Lab.
 *
 * PROTOTYPE LAB SHAPE (what screens consume):
 *   PredictionMarketFeedResult {
 *     markets: PredictionMarket[]  // ranked best-setup first
 *     asOf: string                 // ISO — FETCH time (when we read the book)
 *     source: MarketSource
 *     label: string                // UI badge
 *     reason?: string              // set on empty / partial / unavailable
 *     stale?: boolean              // see STALENESS below
 *     deadlineExceeded?: boolean   // server feed hit its wall-clock budget
 *     skipped?: string[]           // series not read (deadline / error)
 *   }
 *   PredictionMarket {
 *     id, event, outcome,
 *     yesPrice, noPrice,           // 0–1
 *     winChance, edge,             // 0–1 / $/contract after fees
 *     setupGrade,                  // A+ | A | B | C | D
 *     gates,                       // { word, passed, total, missing }
 *     source,
 *     asOf,                        // ISO — FETCH time of the quote (never updated_time)
 *     stale?, staleReason?,        // see STALENESS below
 *     updatedTime?,                // Kalshi `updated_time` (validated ISO | null) —
 *                                  //   market METADATA change time, not a trade/quote time
 *     priceBasis?,                 // "book" (bid/ask) | "last_trade" (no live book)
 *     labelFallback?,              // { event, outcome } — which raw field named the row
 *     volume?, expiry?             // optional Kalshi extras (expiry validated ISO | null)
 *   }
 *
 * STALENESS (Kalshi rows). A row is `stale: true` when ANY of:
 *   - "fetch_age":          now − asOf > PREDICTION_STALE_MS (60s) — the read is old
 *   - "invalid_fetch_time": the caller's fetch asOf was missing / not ISO (we stamp
 *                           now, but cannot vouch for when the book was read)
 *   - "last_trade_only":    no yes bid/ask on the book; the price is the last trade,
 *                           whose time Kalshi does not give us (missing quote time)
 * `updated_time` NEVER feeds asOf or staleness — it is non-trading metadata.
 * The result-level `stale` is true when the fetch itself is old/invalid.
 *
 * READ-ONLY. No place / review / cancel. Paper journal only (journal.ts).
 * Kalshi: public trade-api/v2 only — NO API key. RH MCP: no event-contract
 * tools → `rh_mcp_unavailable` empty stub (markets=[], reason set) — not a data fallback.
 *
 * Ranking: setup quality first (grade + gate readiness). Moderate NFL series
 * boost as a tie-break only — Vikings get no extra boost beyond being NFL.
 */

import type { PredictBoard } from "./predict-server";
import type { League } from "./board";
import { readiness, scanBoard, type ScanLayer, type ScanRow, type ScanWord, SCAN } from "./scanner";
import { DEFAULT_FEES, type FeeModel } from "./math";

/** UI label for the Kalshi public adapter. */
export const KALSHI_SOURCE_LABEL = "Kalshi (Robinhood's prediction-market exchange)";

export const RH_MCP_UNAVAILABLE_REASON =
  "Robinhood MCP exposes equity, option, and crypto tools but has no event-contract / prediction-market read or trade tools. Use the Kalshi public adapter (source: 'kalshi') for paper/UI quotes.";

/** UI badge for the empty RH MCP stub — not a quote source, only markets=[] + reason. */
export const RH_MCP_EMPTY_LABEL = "RH MCP empty (no event-contract tools)";

export type MarketSource = "kalshi" | "rh_mcp_unavailable" | "mock";
export type SetupGrade = "A+" | "A" | "B" | "C" | "D";

export interface MarketGates {
  /** Scanner word: GO / LIMIT / STAND — reused from Predict tab. */
  word: ScanWord;
  passed: number;
  total: number;
  missing: string | null;
}

export interface PredictionMarket {
  id: string;
  event: string;
  outcome: string;
  yesPrice: number | null;
  noPrice: number | null;
  winChance: number | null;
  edge: number | null;
  setupGrade: SetupGrade;
  gates: MarketGates;
  source: MarketSource;
  /** ISO fetch time of the quote. Kalshi rows: when we read the book — never `updated_time`. */
  asOf: string;
  /** See STALENESS in the header. */
  stale?: boolean;
  staleReason?: StaleReason | null;
  /** Kalshi `updated_time` (validated, normalised ISO) — market metadata, NOT a quote time. */
  updatedTime?: string | null;
  /** Where yes/winChance came from: live book (bid/ask) or last trade only. */
  priceBasis?: PriceBasis;
  /** Which raw Kalshi field supplied the event / outcome label (fallback chain made visible). */
  labelFallback?: LabelFallback;
  volume?: number | null;
  expiry?: string | null;
}

export type StaleReason = "fetch_age" | "invalid_fetch_time" | "last_trade_only";
export type PriceBasis = "book" | "last_trade" | "none";
export interface LabelFallback {
  /** "event_ticker" is the preferred source; anything else is a fallback. */
  event: "event_ticker" | "title" | "ticker";
  /** "yes_sub_title" is the preferred source; anything else is a fallback. */
  outcome: "yes_sub_title" | "title" | "ticker_suffix" | "ticker";
  /** True when either label came from a fallback field. */
  used: boolean;
}

/** A Kalshi row / result is stale when its fetch is older than this. */
export const PREDICTION_STALE_MS = 60_000;

/** Flat result Prototype Lab / Mead Hall expect from an adapter call. */
export interface PredictionMarketFeedResult {
  markets: PredictionMarket[];
  asOf: string;
  source: MarketSource;
  label: string;
  reason?: string;
  /** True when the fetch asOf is older than PREDICTION_STALE_MS or was invalid. */
  stale?: boolean;
  /** Server feed stopped early because its total wall-clock budget ran out. */
  deadlineExceeded?: boolean;
  /** Series not read this pass (deadline or error), in request order. */
  skipped?: string[];
}

export type FeedStatus = "idle" | "loading" | "live" | "empty" | "mock" | "error";

export interface PredictionMarketFeedState {
  markets: PredictionMarket[];
  featuredId: string | null;
  topIds: string[];
  status: FeedStatus;
  league: League;
  fetchedAt: string | null;
  note: string;
  /** Adapter that produced the latest markets (when live/empty). */
  source?: MarketSource;
  label?: string;
  reason?: string;
  /** Mirrors PredictionMarketFeedResult.stale when built from a Kalshi result. */
  stale?: boolean;
}

export interface PredictionMarketFeed {
  getState(): PredictionMarketFeedState;
  subscribe(fn: (s: PredictionMarketFeedState) => void): () => void;
  refresh(): void;
  setLeague(league: League): void;
  dispose(): void;
}

const r4 = (x: number | null | undefined) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10_000) / 10_000);
const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};

export const gradeRank = (g: SetupGrade) => ["A+", "A", "B", "C", "D"].indexOf(g);

/** A letter for the setup, from the scanner's own readiness — a view, never a gate. */
export function gradeFor(r: ScanRow): SetupGrade {
  if (r.word === "GO") return "A+";
  if (r.word === "LIMIT") return "A";
  const x = readiness(r);
  if (x.hard) return "D";
  const miss = x.total - x.passed;
  return miss <= 1 ? "B" : miss <= 2 ? "C" : "D";
}

/** Same letter rules from gate bars (for raw Kalshi quotes without a ScanRow). */
export function gradeFromGates(gates: MarketGates, hard: boolean): SetupGrade {
  if (gates.word === "GO") return "A+";
  if (gates.word === "LIMIT") return "A";
  if (hard) return "D";
  const miss = gates.total - gates.passed;
  return miss <= 1 ? "B" : miss <= 2 ? "C" : "D";
}

export function rowToMarket(r: ScanRow, asOf: string, source: MarketSource = "kalshi"): PredictionMarket {
  const x = readiness(r);
  return {
    id: r.key,
    event: r.game,
    outcome: r.team,
    yesPrice: r4(r.ask),
    noPrice: r.bid != null ? r4(1 - r.bid) : null,
    winChance: r4(r.consensus ?? r.fairLo),
    edge: r4(r.gap),
    setupGrade: gradeFor(r),
    gates: { word: r.word, passed: x.passed, total: x.total, missing: r.missing },
    source,
    asOf,
  };
}

export function rowsToMarkets(rows: ScanRow[], asOf: string): PredictionMarket[] {
  return rows.filter((r) => r.ask != null || r.consensus != null).map((r) => rowToMarket(r, asOf));
}

/* ── Raw Kalshi public market → PredictionMarket (Predict gate model) ───── */

/** Subset of Kalshi trade-api/v2 market fields we read (dollars_* / *_fp). */
export interface KalshiPublicMarket {
  ticker?: string;
  title?: string;
  event_ticker?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  yes_bid_dollars?: string | number;
  yes_ask_dollars?: string | number;
  no_bid_dollars?: string | number;
  no_ask_dollars?: string | number;
  last_price_dollars?: string | number;
  volume_fp?: string | number;
  volume_24h_fp?: string | number;
  yes_bid_size_fp?: string | number;
  yes_ask_size_fp?: string | number;
  close_time?: string;
  expiration_time?: string;
  expected_expiration_time?: string;
  /**
   * Kalshi market `updated_time` — metadata change time (rules, status, …),
   * NOT a trade or quote time. Exposed as `updatedTime`; never used for asOf.
   */
  updated_time?: string;
  status?: string;
  /** Optional tag from the fetcher (series ticker). */
  _series?: string;
}

const NFL_SERIES = /^(KXNFL|KXNFLEX|KXNFLGAME)/i;
const SOFT_GATE = new Set<ScanLayer["id"]>(["price", "held", "qb", "liquidity"]);

export function isNflMarket(m: { id?: string; event?: string; _series?: string } | KalshiPublicMarket): boolean {
  const series = "_series" in m && typeof m._series === "string" ? m._series : "";
  const ticker = "ticker" in m && typeof m.ticker === "string" ? m.ticker : "id" in m && typeof m.id === "string" ? m.id : "";
  const event = "event_ticker" in m && typeof m.event_ticker === "string" ? m.event_ticker : "event" in m && typeof m.event === "string" ? m.event : "";
  return NFL_SERIES.test(series) || NFL_SERIES.test(ticker) || /KXNFLGAME/i.test(event) || /^NFL\b/i.test(event);
}

/**
 * Grade a standalone Kalshi quote with the Predict tab's SCAN constants
 * (longshot / liquidity / trading). Without an independent reference the
 * price + held + second + qb layers cannot pass — that is intentional: raw
 * book quotes never flash GO on their own.
 */
/** Accept Kalshi dollar prices in (0, 1] — exactly 1.0 is a valid fully-priced ask. */
export function unitPrice(v: number | null): number | null {
  return v != null && v > 0 && v <= 1 ? v : null;
}

/** ISO-8601 date-time with an explicit zone (Z or ±hh:mm). Date-only / zone-less are rejected. */
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2})$/;

/** Validate + normalise an ISO timestamp → `toISOString()` form, or null when invalid. */
export function isoOrNull(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!ISO_DATETIME.test(s)) return null;
  const ms = Date.parse(s);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Fetch-age staleness only (true when asOf is invalid or older than maxAgeMs). */
export function isStaleAsOf(asOf: string | null | undefined, now = Date.now(), maxAgeMs = PREDICTION_STALE_MS): boolean {
  const iso = isoOrNull(asOf);
  if (!iso) return true;
  return now - Date.parse(iso) > maxAgeMs;
}

function labelsFor(raw: KalshiPublicMarket, ticker: string): { event: string; outcome: string; fb: LabelFallback } {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const evTicker = str(raw.event_ticker);
  const title = str(raw.title);
  const yesSub = str(raw.yes_sub_title);
  const suffix = ticker.includes("-") ? str(ticker.split("-").at(-1)) : null;
  const event = evTicker ?? title ?? ticker;
  const eventFrom: LabelFallback["event"] = evTicker ? "event_ticker" : title ? "title" : "ticker";
  const outcome = yesSub ?? title ?? suffix ?? ticker;
  const outcomeFrom: LabelFallback["outcome"] = yesSub ? "yes_sub_title" : title ? "title" : suffix ? "ticker_suffix" : "ticker";
  return {
    event,
    outcome,
    fb: { event: eventFrom, outcome: outcomeFrom, used: eventFrom !== "event_ticker" || outcomeFrom !== "yes_sub_title" },
  };
}

/**
 * `asOf` is the FETCH time (validated; invalid → now + stale "invalid_fetch_time").
 * `now` is only used for the fetch-age stale check.
 */
export function gradeKalshiPublicMarket(raw: KalshiPublicMarket, asOf: string, now = Date.now()): PredictionMarket | null {
  const ticker = typeof raw.ticker === "string" ? raw.ticker : "";
  if (!ticker) return null;
  const yesAsk = unitPrice(num(raw.yes_ask_dollars));
  const yesBid = unitPrice(num(raw.yes_bid_dollars));
  const noAsk = unitPrice(num(raw.no_ask_dollars));
  const spread = yesAsk != null && yesBid != null ? yesAsk - yesBid : null;
  const askSize = num(raw.yes_ask_size_fp);
  const trading = !raw.status || /^(active|open)$/i.test(String(raw.status));
  const last = unitPrice(num(raw.last_price_dollars));
  const mid = yesAsk != null && yesBid != null ? (yesAsk + yesBid) / 2 : yesAsk ?? yesBid ?? last;
  const priceBasis: PriceBasis = yesAsk != null || yesBid != null ? "book" : last != null ? "last_trade" : "none";
  const fetchIso = isoOrNull(asOf);
  const rowStamp = fetchIso ?? new Date(now).toISOString();
  const staleReason: StaleReason | null = !fetchIso
    ? "invalid_fetch_time"
    : now - Date.parse(fetchIso) > PREDICTION_STALE_MS
      ? "fetch_age"
      : priceBasis === "last_trade"
        ? "last_trade_only"
        : null;

  const layers: ScanLayer[] = [
    { id: "reference", ok: false, detail: "no independent reference (ESPN/book) on this raw Kalshi row" },
    { id: "price", ok: false, detail: "no fair-value limit without a reference" },
    { id: "longshot", ok: yesAsk == null || yesAsk >= SCAN.longshotBelow, detail: `ask ${yesAsk == null ? "—" : `${Math.round(yesAsk * 100)}¢`} is in the longshot zone (<20¢)` },
    { id: "late", ok: true, detail: "not a live late-game underdog check on raw quotes" },
    {
      id: "liquidity",
      ok: trading && (spread == null || spread <= SCAN.maxSpread + 1e-9) && (askSize == null || askSize >= SCAN.minDepth),
      detail: !trading
        ? `market is ${raw.status}, not trading`
        : spread != null && spread > SCAN.maxSpread + 1e-9
          ? `spread ${Math.round(spread * 100)}¢ is too wide`
          : `only ${Math.round(askSize ?? 0)} contracts at the ask`,
    },
    { id: "second", ok: false, detail: "raw Kalshi feed has no second-market confirm" },
    { id: "qb", ok: true, detail: "QB gate is sports-board only" },
    { id: "held", ok: false, detail: "gap must hold across refreshes (no prior gap on first read)" },
  ];
  const failing = layers.filter((l) => !l.ok);
  const hard = layers.some((l) => !l.ok && !SOFT_GATE.has(l.id));
  const gates: MarketGates = {
    word: "STAND",
    passed: layers.filter((l) => l.ok).length,
    total: layers.length,
    missing: failing[0]?.detail ?? null,
  };
  const { event, outcome, fb } = labelsFor(raw, ticker);
  const volume = num(raw.volume_fp) ?? num(raw.volume_24h_fp);
  const expiry = isoOrNull(raw.expected_expiration_time) ?? isoOrNull(raw.expiration_time) ?? isoOrNull(raw.close_time);

  return {
    id: ticker,
    event,
    outcome,
    yesPrice: r4(yesAsk),
    noPrice: noAsk != null ? r4(noAsk) : yesBid != null ? r4(1 - yesBid) : null,
    winChance: r4(mid != null && mid > 0 && mid <= 1 ? mid : null),
    edge: null,
    setupGrade: gradeFromGates(gates, hard),
    gates,
    source: "kalshi",
    asOf: rowStamp,
    stale: staleReason != null,
    staleReason,
    updatedTime: isoOrNull(raw.updated_time),
    priceBasis,
    labelFallback: fb,
    volume,
    expiry,
  };
}

/**
 * Rank primarily by setup quality. Moderate NFL boost (−0.35 on the sort
 * key) only as a tie-break after grade — Vikings get nothing beyond NFL.
 */
export function rankMarkets(markets: PredictionMarket[]): PredictionMarket[] {
  const key = (m: PredictionMarket): number[] => {
    const nfl = isNflMarket({ id: m.id, event: m.event }) ? 0 : 1;
    const miss = m.gates.total - m.gates.passed;
    const edge = m.edge == null ? 9 : -m.edge;
    const vol = m.volume == null ? 0 : -Math.min(m.volume, 1_000_000) / 1_000_000;
    // grade, then NFL mild preference, then fewer misses, then edge, then volume
    return [gradeRank(m.setupGrade), nfl, miss, edge, vol];
  };
  return [...markets].sort((a, b) => {
    const ka = key(a);
    const kb = key(b);
    for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
    return a.id.localeCompare(b.id);
  });
}

export function mapKalshiMarkets(raw: KalshiPublicMarket[], asOf: string, now = Date.now()): PredictionMarket[] {
  const out: PredictionMarket[] = [];
  for (const m of raw) {
    const row = gradeKalshiPublicMarket(m, asOf, now);
    if (row && (row.yesPrice != null || row.winChance != null)) out.push(row);
  }
  return rankMarkets(out);
}

/**
 * Kalshi public adapter — paper/UI only. `asOf` = fetch time (validated; an
 * invalid value is replaced by now and the result + rows are flagged stale).
 */
export function kalshiAdapterResult(
  raw: KalshiPublicMarket[],
  asOf = new Date().toISOString(),
  now = Date.now(),
): PredictionMarketFeedResult {
  const fetchIso = isoOrNull(asOf);
  return {
    markets: mapKalshiMarkets(raw, asOf, now),
    asOf: fetchIso ?? new Date(now).toISOString(),
    source: "kalshi",
    label: KALSHI_SOURCE_LABEL,
    stale: isStaleAsOf(asOf, now),
  };
}

/** Empty stub when a caller expected Robinhood event contracts via MCP (no quotes). */
export function rhMcpUnavailableAdapter(asOf = new Date().toISOString()): PredictionMarketFeedResult {
  return {
    markets: [],
    asOf: isoOrNull(asOf) ?? new Date().toISOString(),
    source: "rh_mcp_unavailable",
    label: RH_MCP_EMPTY_LABEL,
    reason: RH_MCP_UNAVAILABLE_REASON,
  };
}

/* ── Live client feed (Mead Hall subscribe loop) ────────────────────────── */

/**
 * DEV-only synthetic hall. Every row says `source: "mock"`.
 */
export function mockMarkets(now = Date.now()): PredictionMarket[] {
  const asOf = new Date(now).toISOString();
  const t = now / 60_000;
  const wob = (seed: number, amp = 0.03) => Math.sin(t * 0.9 + seed) * amp;
  const rows: [string, string, string, number, number, SetupGrade, ScanWord][] = [
    ["mock-min-gb-min", "GB @ MIN", "MIN", 0.62, 0.04, "A", "LIMIT"],
    ["mock-min-gb-gb", "GB @ MIN", "GB", 0.38, -0.03, "D", "STAND"],
    ["mock-det-chi-det", "CHI @ DET", "DET", 0.54, 0.02, "B", "STAND"],
    ["mock-sf-sea-sea", "SF @ SEA", "SEA", 0.48, 0.06, "A+", "GO"],
    ["mock-kc-buf-buf", "KC @ BUF", "BUF", 0.57, 0.01, "B", "STAND"],
    ["mock-phi-dal-dal", "PHI @ DAL", "DAL", 0.37, -0.01, "C", "STAND"],
    ["mock-gdp-q3", "GDP Q3 ≥2%", "Yes", 0.63, 0.0, "B", "STAND"],
    ["mock-senate-dem", "Senate control 2026", "Democrats", 0.42, 0.0, "C", "STAND"],
  ];
  return rows.map(([id, event, outcome, base, edge, grade, word], i) => {
    const yes = Math.min(0.97, Math.max(0.03, Math.round((base + wob(i)) * 100) / 100));
    return {
      id,
      event,
      outcome,
      yesPrice: yes,
      noPrice: Math.round((1 - yes + 0.01) * 100) / 100,
      winChance: r4(yes + edge * 0.5),
      edge: r4(edge + wob(i + 3, 0.01)),
      setupGrade: grade,
      gates: { word, passed: word === "GO" ? 8 : word === "LIMIT" ? 7 : 5, total: 8, missing: word === "GO" ? null : "MOCK — synthetic row, not a market" },
      source: "mock" as const,
      asOf,
    };
  });
}

function defaultAllowMock(): boolean {
  try {
    return import.meta.env?.DEV === true;
  } catch {
    return false;
  }
}

export function pickFeatured(markets: PredictionMarket[], topIds: string[]): string | null {
  const byId = new Map(markets.map((m) => [m.id, m]));
  for (const id of topIds) if (byId.get(id)?.yesPrice != null) return id;
  return markets.find((m) => m.yesPrice != null)?.id ?? markets[0]?.id ?? null;
}

export function topIdsFrom(markets: PredictionMarket[], n = 6): string[] {
  return rankMarkets(markets)
    .slice(0, n)
    .map((m) => m.id);
}

export interface FeedOptions {
  league?: League;
  /** Board loader — Predict tab server fn in the app; stub in tests. */
  load: (league: League) => Promise<PredictBoard>;
  every?: number;
  fees?: FeeModel;
  allowMock?: boolean;
}

export function stateFromBoard(
  board: PredictBoard | null,
  league: League,
  opts: { fees?: FeeModel; allowMock?: boolean; prevGaps?: Map<string, number>; now?: number } = {},
): PredictionMarketFeedState {
  const now = opts.now ?? Date.now();
  const rows = board ? scanBoard(board.games, opts.fees ?? DEFAULT_FEES, opts.prevGaps ?? new Map(), now) : [];
  const asOf = board?.fetchedAt ?? new Date(now).toISOString();
  const markets = rankMarkets(rowsToMarkets(rows, asOf));
  const topIds = topIdsFrom(markets, 6);
  if (markets.length) {
    return {
      markets,
      topIds,
      featuredId: pickFeatured(markets, topIds),
      status: "live",
      league,
      fetchedAt: asOf,
      note: `${KALSHI_SOURCE_LABEL} via the Predict board — closest public proxy for Robinhood's quote.`,
      source: "kalshi",
      label: KALSHI_SOURCE_LABEL,
    };
  }
  if (opts.allowMock) {
    const m = mockMarkets(now);
    const top = topIdsFrom(m, 6);
    return {
      markets: m,
      topIds: top,
      featuredId: m[0]?.id ?? null,
      status: "mock",
      league,
      fetchedAt: asOf,
      note: "MOCK — the live board is empty; synthetic rows shown in DEV only.",
      source: "mock",
      label: "MOCK",
    };
  }
  const unavailable = rhMcpUnavailableAdapter(asOf);
  return {
    markets: [],
    topIds: [],
    featuredId: null,
    status: "empty",
    league,
    fetchedAt: asOf,
    note: board?.failed.length ? `Board read failed: ${board.failed.join(" · ")}` : unavailable.reason ?? "No priced markets.",
    source: board?.failed.length ? "kalshi" : "rh_mcp_unavailable",
    label: board?.failed.length ? KALSHI_SOURCE_LABEL : unavailable.label,
    reason: board?.failed.length ? board.failed.join(" · ") : unavailable.reason,
  };
}

/** Build feed state from a Kalshi adapter result (broad sports/econ/politics). */
export function stateFromKalshiResult(
  result: PredictionMarketFeedResult,
  league: League = "nfl",
): PredictionMarketFeedState {
  const markets = result.markets;
  const topIds = topIdsFrom(markets, 6);
  return {
    markets,
    topIds,
    featuredId: pickFeatured(markets, topIds),
    status: markets.length ? "live" : "empty",
    league,
    fetchedAt: result.asOf,
    note: result.reason ?? `${result.label} — ranked by setup quality (moderate NFL boost only).`,
    source: result.source,
    label: result.label,
    reason: result.reason,
    stale: result.stale,
  };
}

export function createPredictionMarketFeed(opts: FeedOptions): PredictionMarketFeed {
  let league: League = opts.league ?? "nfl";
  const allowMock = opts.allowMock ?? defaultAllowMock();
  const every = opts.every ?? 15_000;
  let state: PredictionMarketFeedState = { markets: [], topIds: [], featuredId: null, status: "idle", league, fetchedAt: null, note: "" };
  const subs = new Set<(s: PredictionMarketFeedState) => void>();
  let timer: ReturnType<typeof setInterval> | null = null;
  let seq = 0;
  let disposed = false;
  let prevGaps = new Map<string, number>();
  let lastGaps = new Map<string, number>();
  let lastStamp: string | null = null;

  const emit = (next: PredictionMarketFeedState) => {
    state = next;
    for (const fn of subs) fn(state);
  };

  const refresh = () => {
    if (disposed) return;
    const my = ++seq;
    if (state.status === "idle") emit({ ...state, status: "loading" });
    opts
      .load(league)
      .then((board) => {
        if (disposed || my !== seq) return;
        if (board.fetchedAt !== lastStamp) {
          prevGaps = lastGaps;
          lastStamp = board.fetchedAt;
        }
        const next = stateFromBoard(board, league, { fees: opts.fees, allowMock, prevGaps });
        lastGaps = new Map(next.markets.filter((m) => m.edge != null && m.source !== "mock").map((m) => [m.id, m.edge as number]));
        emit(next);
      })
      .catch((e: unknown) => {
        if (disposed || my !== seq) return;
        const fallback = stateFromBoard(null, league, { allowMock });
        emit({
          ...fallback,
          status: fallback.status === "mock" ? "mock" : "error",
          note: `${e instanceof Error ? e.message : String(e)}${fallback.status === "mock" ? " — MOCK rows shown (DEV)." : ""}`,
        });
      });
  };

  const start = () => {
    if (timer || disposed) return;
    refresh();
    timer = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState === "visible") refresh();
    }, every);
  };
  const stop = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  return {
    getState: () => state,
    subscribe(fn) {
      subs.add(fn);
      if (subs.size === 1) start();
      return () => {
        subs.delete(fn);
        if (!subs.size) stop();
      };
    },
    refresh,
    setLeague(lg) {
      if (lg === league) return;
      league = lg;
      prevGaps = new Map();
      lastGaps = new Map();
      lastStamp = null;
      emit({ ...state, league, status: "loading" });
      refresh();
    },
    dispose() {
      disposed = true;
      stop();
      subs.clear();
    },
  };
}
