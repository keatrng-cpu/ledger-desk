/**
 * PM SIGNAL ENGINE — per-market reads for The Mead Hall + Predict merger.
 *
 * READ-ONLY. Inputs are real Kalshi public rows (KalshiPublicMarket, as read
 * by the PredictionMarketFeed server path) plus, optionally, real hourly
 * candlesticks and real model inputs. Nothing here invents a price: a field
 * whose input is missing is `null` with a reason. There is NO order path —
 * no place / review / cancel, and nothing here imports a broker.
 *
 * Per market (MarketSignal):
 *   implied     fee-adjusted implied probability (ask + taker fee + slippage)
 *   spread      yes ask − yes bid (¢) and as a share of mid
 *   liquidity   0–100 depth score (spread · size at touch · 24h volume)
 *   move        price move since open + velocity (¢/h) from real trades only
 *   settlement  time to close / expected settlement
 *   freshness   fetch age + price basis (book vs last trade)
 *   edge        net-of-fees+slippage edge ONLY with a real model input,
 *               else { status: "no edge read", reason }
 *   grade       one A–F letter with plain-English reasons
 *
 * Grading (setup quality first; ai/research/2026-10-06-pm-signal.md):
 *   - every number is NET of fees + slippage
 *   - cheap YES grades DOWN by default (favorite–longshot bias by price bin)
 *   - long horizons grade slightly down (FLB worsens with time to expiry)
 *   - no model input → best possible grade is B ("no edge read")
 *   - NFL: +3 points, moderate, never lifts past a cap
 *   - price moves are SHOWN, never graded (no news-lag edge — no evidence)
 */

import {
  isNflMarket,
  isoOrNull,
  isStaleAsOf,
  unitPrice,
  PREDICTION_STALE_MS,
  KALSHI_SOURCE_LABEL,
  type KalshiPublicMarket,
  type PriceBasis,
  type StaleReason,
  type MarketSource,
} from "./prediction-market-feed";
import { feePerContract, VENUES, type FeeModel, type VenueId } from "./math";
import { LONG_HORIZON_MS, MAKER_TAKER, priceBinFor, type PriceBinId } from "./signal-evidence";
import type { ScanRow } from "./scanner";

export const SIGNAL_ENGINE_VERSION = "pm-signal/1";

/* ── Public types (Prototype Lab renders these) ─────────────────────────── */

export type SignalGrade = "A" | "B" | "C" | "D" | "F";
export const SIGNAL_GRADES: readonly SignalGrade[] = ["A", "B", "C", "D", "F"];
export const NO_EDGE_READ = "no edge read" as const;
export type Side = "yes" | "no";

export interface ImpliedProbability {
  /** Book mid (or last trade when no book) — the raw quoted probability. */
  mid: number | null;
  /** YES ask + taker fee + slippage: the win chance a YES buy must beat. */
  feeAdjustedYes: number | null;
  /** NO ask + taker fee + slippage: the chance of NO a NO buy must beat. */
  feeAdjustedNo: number | null;
  /** [1 − feeAdjustedNo, feeAdjustedYes] — inside this band neither side pays after costs. */
  noTradeBand: [number, number] | null;
  /** Per-contract taker fee at the YES / NO ask (100-contract order). */
  feeYes: number | null;
  feeNo: number | null;
  slippage: number;
  /** yes ask + no ask − 1: the book's own margin. */
  overround: number | null;
  basis: PriceBasis;
  feeModel: VenueId;
}

export interface SpreadRead {
  /** Dollars (0.02 = 2¢); null without both sides of the YES book. */
  dollars: number | null;
  cents: number | null;
  /** spread / mid. */
  pctOfMid: number | null;
}

export interface LiquidityRead {
  /** 0–100; weighted over the components that exist. */
  score: number;
  components: { spread: number | null; depth: number | null; volume: number | null };
  bidSize: number | null;
  askSize: number | null;
  volume24h: number | null;
  openInterest: number | null;
  /** Inputs that were absent (never filled in). */
  missing: string[];
  word: "deep" | "ok" | "thin" | "none";
}

export interface PricePoint {
  /** ISO time of the observation. */
  at: string;
  /** Real traded (or book-mid) price, 0–1. */
  price: number;
  kind: "trade" | "book_mid";
}

/** Real price history for one market: the open reference + recent points. */
export interface MoveHistory {
  /** First real trade after the market opened (openTradeFromCandles). */
  open: PricePoint | null;
  /** Real hourly trade closes, oldest first (parseKalshiCandles). */
  points: PricePoint[];
}

export type MoveBasis = "candles_open" | "previous_day" | "none";

export interface PriceMoveRead {
  /** Current mid − reference price, dollars. null when no real reference. */
  sinceOpen: number | null;
  /** Reference price used (first real trade after open, or previous-day last trade). */
  openPrice: number | null;
  openAt: string | null;
  basis: MoveBasis;
  /** ¢ per hour over the recent window (real points only), null if < 2 points. */
  velocityCentsPerHour: number | null;
  velocityWindowHours: number | null;
  points: number;
  reason: string | null;
}

export interface SettlementRead {
  /** Kalshi close_time — last moment the market can trade. */
  closeAt: string | null;
  /** expected_expiration_time ?? expiration_time ?? close_time. */
  settleAt: string | null;
  msToClose: number | null;
  msToSettle: number | null;
  words: string;
  phase: "open" | "closing_soon" | "closed" | "unknown";
}

export interface FreshnessRead {
  /** Fetch time of the read (never Kalshi updated_time). */
  asOf: string;
  ageMs: number | null;
  word: "live" | "recent" | "stale";
  stale: boolean;
  staleReason: StaleReason | null;
  priceBasis: PriceBasis;
}

/** A REAL model input for one market. Kalshi's own mid is never a model. */
export interface ModelInput {
  /** Model probability that YES resolves, 0–1. */
  prob: number;
  /** Plain name shown in reasons, e.g. "DraftKings no-vig (conservative)". */
  source: string;
  /** ISO time the model input was produced. */
  asOf?: string | null;
}

export type EdgeRead =
  | {
      status: "edge";
      /** Better side after costs. */
      side: Side;
      /** Dollars per contract, net of taker fee + slippage, held to settlement. */
      netPerContract: number;
      netYes: number | null;
      netNo: number | null;
      modelProb: number;
      modelSource: string;
      modelAsOf: string | null;
    }
  | { status: typeof NO_EDGE_READ; reason: string };

export interface SignalReason {
  text: string;
  effect: "up" | "down" | "cap" | "info";
  points: number;
}

export interface MarketSignal {
  id: string;
  event: string;
  outcome: string;
  series: string | null;
  source: MarketSource;
  nfl: boolean;
  prices: {
    yesBid: number | null;
    yesAsk: number | null;
    noBid: number | null;
    noAsk: number | null;
    last: number | null;
  };
  implied: ImpliedProbability;
  spread: SpreadRead;
  liquidity: LiquidityRead;
  move: PriceMoveRead;
  settlement: SettlementRead;
  freshness: FreshnessRead;
  edge: EdgeRead;
  /** Side the grade is for (YES unless a real edge favours NO). */
  gradedSide: Side;
  priceBin: PriceBinId | null;
  grade: SignalGrade;
  /** 0–100 setup score behind the letter. */
  score: number;
  /** Ordered: caps first, then biggest effects. */
  reasons: SignalReason[];
  /** One plain-English line for a badge. */
  headline: string;
}

export interface SignalBoard {
  signals: MarketSignal[];
  asOf: string;
  source: MarketSource;
  label: string;
  stale: boolean;
  deadlineExceeded?: boolean;
  skipped?: string[];
  reason?: string;
  engineVersion: string;
  feeModel: VenueId;
  slippage: number;
  counts: Record<SignalGrade, number>;
  /** Signals with status "no edge read". */
  noEdgeCount: number;
  /** Server only: candle reads attempted / succeeded for move-since-open (top of board). */
  candles?: { tried: number; read: number };
}

export interface CrowdRead {
  /** 0–1 crowd energy from REAL price velocity; null when no move data. */
  energy: number | null;
  mood: "surging" | "sliding" | "restless" | "quiet";
  /** Number of signals with real move data behind the read. */
  basedOn: number;
  reason: string;
}

/** Mead Hall layout: jumbotron = #1, rune board = next 5, crowd from real moves only. */
export interface HallLayout {
  jumbotron: MarketSignal | null;
  runeBoard: MarketSignal[];
  crowd: CrowdRead;
  asOf: string;
}

export interface SignalOptions {
  /** Fetch time of the raw rows (ISO). */
  asOf: string;
  now?: number;
  /** Default VENUES.kalshi (taker ceil(0.07·C·P·(1−P))). */
  fees?: FeeModel;
  /** Dollars per contract added on top of the fee. Default 0.01. */
  slippage?: number;
  /** Real model inputs by Kalshi ticker. */
  models?: Record<string, ModelInput> | Map<string, ModelInput>;
  /** Real price history by ticker (e.g. parseKalshiCandles output). */
  history?: Record<string, MoveHistory> | Map<string, MoveHistory>;
  /** A model input older than this is not read. Default 15 min. */
  maxModelAgeMs?: number;
}

export const DEFAULT_SIGNAL_FEES: FeeModel = VENUES.kalshi;
export const DEFAULT_SLIPPAGE = 0.01;
export const NFL_BOOST_POINTS = 3;
export const MAX_MODEL_AGE_MS = 15 * 60_000;
export const GRADE_CUTS: Record<Exclude<SignalGrade, "F">, number> = { A: 85, B: 70, C: 55, D: 40 };

/* ── helpers ────────────────────────────────────────────────────────────── */

const num = (v: unknown): number | null => {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : null;
};
const r4 = (x: number | null) =>
  x == null || !Number.isFinite(x) ? null : Math.round(x * 10_000) / 10_000;
const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const c = (x: number) => `${Math.round(x * 100)}¢`;
const sc = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}¢`;
const get = <T>(m: Record<string, T> | Map<string, T> | undefined, k: string): T | undefined =>
  m == null ? undefined : m instanceof Map ? m.get(k) : m[k];
const gradeIdx = (g: SignalGrade) => SIGNAL_GRADES.indexOf(g);
const better = (a: SignalGrade, b: SignalGrade) => gradeIdx(a) < gradeIdx(b);
const capTo = (g: SignalGrade, cap: SignalGrade) => (better(g, cap) ? cap : g);

export function letterFor(score: number): SignalGrade {
  if (score >= GRADE_CUTS.A) return "A";
  if (score >= GRADE_CUTS.B) return "B";
  if (score >= GRADE_CUTS.C) return "C";
  if (score >= GRADE_CUTS.D) return "D";
  return "F";
}

export function durationWords(ms: number | null): string {
  if (ms == null) return "unknown";
  if (ms <= 0) return "now / past";
  const m = ms / 60_000;
  if (m < 60) return `${Math.round(m)} min`;
  const h = m / 60;
  if (h < 48) return `${h.toFixed(h < 10 ? 1 : 0)} h`;
  return `${Math.round(h / 24)} days`;
}

/* ── components ─────────────────────────────────────────────────────────── */

export function impliedFor(
  yesAsk: number | null,
  noAsk: number | null,
  mid: number | null,
  basis: PriceBasis,
  fees: FeeModel = DEFAULT_SIGNAL_FEES,
  slippage = DEFAULT_SLIPPAGE,
): ImpliedProbability {
  const fee = (p: number | null) =>
    p == null || p >= 1 ? (p == null ? null : 0) : feePerContract(p, 100, fees);
  const feeYes = fee(yesAsk);
  const feeNo = fee(noAsk);
  const adjYes =
    yesAsk != null && feeYes != null ? r4(Math.min(1, yesAsk + feeYes + slippage)) : null;
  const adjNo = noAsk != null && feeNo != null ? r4(Math.min(1, noAsk + feeNo + slippage)) : null;
  return {
    mid: r4(mid),
    feeAdjustedYes: adjYes,
    feeAdjustedNo: adjNo,
    noTradeBand:
      adjYes != null && adjNo != null ? [r4(Math.max(0, 1 - adjNo)) as number, adjYes] : null,
    feeYes: r4(feeYes),
    feeNo: r4(feeNo),
    slippage,
    overround: yesAsk != null && noAsk != null ? r4(yesAsk + noAsk - 1) : null,
    basis,
    feeModel: fees.id,
  };
}

const logScore = (x: number | null, lo: number, hi: number) =>
  x == null || !(x > 0)
    ? x === 0
      ? 0
      : null
    : clamp(((Math.log10(x) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo))) * 100, 0, 100);

export function liquidityFor(raw: KalshiPublicMarket, spread: number | null): LiquidityRead {
  const bidSize = num(raw.yes_bid_size_fp);
  const askSize = num(raw.yes_ask_size_fp);
  const volume24h = num(raw.volume_24h_fp);
  const openInterest = num(raw.open_interest_fp);
  const missing: string[] = [];
  const spreadPts = spread == null ? null : clamp(((0.1 - spread) / 0.09) * 100, 0, 100);
  if (spreadPts == null) missing.push("two-sided YES book");
  const touch =
    bidSize != null && askSize != null ? Math.min(bidSize, askSize) : (bidSize ?? askSize);
  const depthPts = logScore(touch, 10, 1000);
  if (depthPts == null) missing.push("size at the touch");
  const volPts = logScore(volume24h, 10, 10_000);
  if (volPts == null) missing.push("24h volume");
  const parts: [number | null, number][] = [
    [spreadPts, 0.45],
    [depthPts, 0.35],
    [volPts, 0.2],
  ];
  const have = parts.filter((p): p is [number, number] => p[0] != null);
  const w = have.reduce((s, p) => s + p[1], 0);
  let score = w > 0 ? have.reduce((s, p) => s + p[0] * p[1], 0) / w : 0;
  if (spreadPts == null) score = Math.min(score, 20); // no live two-sided book → never more than thin
  score = Math.round(score);
  return {
    score,
    components: {
      spread: spreadPts == null ? null : Math.round(spreadPts),
      depth: depthPts == null ? null : Math.round(depthPts),
      volume: volPts == null ? null : Math.round(volPts),
    },
    bidSize,
    askSize,
    volume24h,
    openInterest,
    missing,
    word: score >= 70 ? "deep" : score >= 45 ? "ok" : score > 0 ? "thin" : "none",
  };
}

/**
 * Real hourly Kalshi candlesticks → price points. Uses the TRADE close of each
 * hour that had trades; hours without trades are skipped (never filled).
 * Shape: GET /series/{s}/markets/{t}/candlesticks?period_interval=60.
 */
export function parseKalshiCandles(json: unknown): PricePoint[] {
  const list = (json as { candlesticks?: unknown[] } | null)?.candlesticks;
  if (!Array.isArray(list)) return [];
  const out: PricePoint[] = [];
  for (const k of list) {
    const row = k as {
      end_period_ts?: number;
      price?: { close_dollars?: string | number; open_dollars?: string | number };
      volume_fp?: string | number;
    };
    const end = num(row.end_period_ts);
    const close = unitPrice(num(row.price?.close_dollars));
    const vol = num(row.volume_fp);
    if (end == null || close == null || !(vol != null && vol > 0)) continue;
    out.push({ at: new Date(end * 1000).toISOString(), price: close, kind: "trade" });
  }
  return out;
}

/** First real traded price in a candle series (the hour's OPEN trade), for "since open". */
export function openTradeFromCandles(json: unknown): PricePoint | null {
  const list = (json as { candlesticks?: unknown[] } | null)?.candlesticks;
  if (!Array.isArray(list)) return null;
  for (const k of list) {
    const row = k as {
      end_period_ts?: number;
      price?: { open_dollars?: string | number };
      volume_fp?: string | number;
    };
    const end = num(row.end_period_ts);
    const open = unitPrice(num(row.price?.open_dollars));
    const vol = num(row.volume_fp);
    if (end != null && open != null && vol != null && vol > 0)
      return { at: new Date((end - 3600) * 1000).toISOString(), price: open, kind: "trade" };
  }
  return null;
}

/** Candle JSON → MoveHistory (open trade + hourly trade closes). */
export function historyFromCandles(json: unknown): MoveHistory {
  return { open: openTradeFromCandles(json), points: parseKalshiCandles(json) };
}

/** Velocity window — recent real points only. */
export const VELOCITY_WINDOW_MS = 6 * 3600_000;

export function moveFor(
  raw: KalshiPublicMarket,
  mid: number | null,
  asOf: string,
  history: MoveHistory | undefined,
): PriceMoveRead {
  const pts = (history?.points ?? [])
    .filter((p) => isoOrNull(p.at) && unitPrice(p.price) != null)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const asOfMs = Date.parse(isoOrNull(asOf) ?? "");
  const none = (reason: string): PriceMoveRead => ({
    sinceOpen: null,
    openPrice: null,
    openAt: null,
    basis: "none",
    velocityCentsPerHour: null,
    velocityWindowHours: null,
    points: pts.length,
    reason,
  });
  // Reference: first real trade after open (candles), else previous-day last trade.
  let openPrice: number | null = null;
  let openAt: string | null = null;
  let basis: MoveBasis = "none";
  const open = history?.open;
  if (open && unitPrice(open.price) != null && isoOrNull(open.at)) {
    openPrice = open.price;
    openAt = isoOrNull(open.at);
    basis = "candles_open";
  } else {
    const prev = unitPrice(num(raw.previous_price_dollars));
    if (prev != null) {
      openPrice = prev;
      basis = "previous_day";
    }
  }
  if (mid == null) return none("no current price to measure a move");
  if (openPrice == null)
    return none("no real open reference (no candles read, no previous-day trade)");
  // Velocity: least-squares slope over real points within the window, plus the current mid.
  const series = [
    ...pts.map((p) => ({ t: Date.parse(p.at), p: p.price })),
    ...(Number.isFinite(asOfMs) ? [{ t: asOfMs, p: mid }] : []),
  ].filter((x) => !Number.isFinite(asOfMs) || asOfMs - x.t <= VELOCITY_WINDOW_MS);
  let vel: number | null = null;
  let win: number | null = null;
  if (series.length >= 2) {
    const span = series[series.length - 1].t - series[0].t;
    if (span >= 30 * 60_000) {
      const mt = series.reduce((s, x) => s + x.t, 0) / series.length;
      const mp = series.reduce((s, x) => s + x.p, 0) / series.length;
      const cov = series.reduce((s, x) => s + (x.t - mt) * (x.p - mp), 0);
      const vt = series.reduce((s, x) => s + (x.t - mt) ** 2, 0);
      vel = vt > 0 ? Math.round((cov / vt) * 3600_000 * 100 * 100) / 100 : null;
      win = Math.round((span / 3600_000) * 10) / 10;
    }
  }
  return {
    sinceOpen: r4(mid - openPrice),
    openPrice,
    openAt,
    basis,
    velocityCentsPerHour: vel,
    velocityWindowHours: win,
    points: pts.length,
    reason: vel == null ? "velocity needs ≥2 real points spanning ≥30 min" : null,
  };
}

export function settlementFor(
  raw: KalshiPublicMarket,
  now: number,
  trading: boolean,
): SettlementRead {
  const closeAt = isoOrNull(raw.close_time);
  const settleAt =
    isoOrNull(raw.expected_expiration_time) ?? isoOrNull(raw.expiration_time) ?? closeAt;
  const msToClose = closeAt ? Date.parse(closeAt) - now : null;
  const msToSettle = settleAt ? Date.parse(settleAt) - now : null;
  const phase: SettlementRead["phase"] =
    !trading || (msToClose != null && msToClose <= 0)
      ? "closed"
      : msToSettle == null
        ? "unknown"
        : msToSettle < 15 * 60_000
          ? "closing_soon"
          : "open";
  return { closeAt, settleAt, msToClose, msToSettle, words: durationWords(msToSettle), phase };
}

export function freshnessFor(asOf: string, now: number, basis: PriceBasis): FreshnessRead {
  const iso = isoOrNull(asOf);
  const ageMs = iso ? Math.max(0, now - Date.parse(iso)) : null;
  const staleReason: StaleReason | null = !iso
    ? "invalid_fetch_time"
    : (ageMs as number) > PREDICTION_STALE_MS
      ? "fetch_age"
      : basis === "last_trade"
        ? "last_trade_only"
        : null;
  return {
    asOf: iso ?? new Date(now).toISOString(),
    ageMs,
    word: staleReason ? "stale" : (ageMs as number) <= 15_000 ? "live" : "recent",
    stale: staleReason != null,
    staleReason,
    priceBasis: basis,
  };
}

export function edgeFor(
  model: ModelInput | undefined,
  implied: ImpliedProbability,
  now: number,
  maxAgeMs = MAX_MODEL_AGE_MS,
): EdgeRead {
  if (!model)
    return {
      status: NO_EDGE_READ,
      reason: "no independent model input for this market (Kalshi's own price is not a model)",
    };
  if (!(Number.isFinite(model.prob) && model.prob > 0 && model.prob < 1))
    return {
      status: NO_EDGE_READ,
      reason: `model input from ${model.source} is not a usable probability`,
    };
  const at = isoOrNull(model.asOf ?? null);
  if (model.asOf != null && !at)
    return { status: NO_EDGE_READ, reason: `model input from ${model.source} has no valid time` };
  if (at && now - Date.parse(at) > maxAgeMs)
    return {
      status: NO_EDGE_READ,
      reason: `model input from ${model.source} is older than ${Math.round(maxAgeMs / 60_000)} min`,
    };
  const netYes = implied.feeAdjustedYes != null ? r4(model.prob - implied.feeAdjustedYes) : null;
  const netNo = implied.feeAdjustedNo != null ? r4(1 - model.prob - implied.feeAdjustedNo) : null;
  if (netYes == null && netNo == null)
    return { status: NO_EDGE_READ, reason: "no ask on either side to price an entry" };
  const side: Side = netNo != null && (netYes == null || netNo > netYes) ? "no" : "yes";
  return {
    status: "edge",
    side,
    netPerContract: (side === "yes" ? netYes : netNo) as number,
    netYes,
    netNo,
    modelProb: model.prob,
    modelSource: model.source,
    modelAsOf: at,
  };
}

/* ── one market ─────────────────────────────────────────────────────────── */

function labels(raw: KalshiPublicMarket, ticker: string) {
  const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  return {
    event: s(raw.event_ticker) ?? s(raw.title) ?? ticker,
    outcome: s(raw.yes_sub_title) ?? s(raw.title) ?? ticker.split("-").at(-1) ?? ticker,
  };
}

export function computeSignal(raw: KalshiPublicMarket, opts: SignalOptions): MarketSignal | null {
  const ticker = typeof raw.ticker === "string" ? raw.ticker : "";
  if (!ticker) return null;
  const now = opts.now ?? Date.now();
  const fees = opts.fees ?? DEFAULT_SIGNAL_FEES;
  const slippage = opts.slippage ?? DEFAULT_SLIPPAGE;
  const yesAsk = unitPrice(num(raw.yes_ask_dollars));
  const yesBid = unitPrice(num(raw.yes_bid_dollars));
  const noAsk = unitPrice(num(raw.no_ask_dollars));
  const noBid = unitPrice(num(raw.no_bid_dollars));
  const last = unitPrice(num(raw.last_price_dollars));
  if (yesAsk == null && yesBid == null && last == null) return null; // nothing real to read
  const basis: PriceBasis =
    yesAsk != null || yesBid != null ? "book" : last != null ? "last_trade" : "none";
  const mid = yesAsk != null && yesBid != null ? (yesAsk + yesBid) / 2 : (yesAsk ?? yesBid ?? last);
  const spreadD = yesAsk != null && yesBid != null ? r4(yesAsk - yesBid) : null;
  const trading = !raw.status || /^(active|open)$/i.test(String(raw.status));

  const implied = impliedFor(yesAsk, noAsk, mid, basis, fees, slippage);
  const spread: SpreadRead = {
    dollars: spreadD,
    cents: spreadD == null ? null : Math.round(spreadD * 100),
    pctOfMid: spreadD != null && mid ? r4(spreadD / mid) : null,
  };
  const liquidity = liquidityFor(raw, spreadD);
  const move = moveFor(raw, mid, opts.asOf, get(opts.history, ticker));
  const settlement = settlementFor(raw, now, trading);
  const freshness = freshnessFor(opts.asOf, now, basis);
  const edge = edgeFor(get(opts.models, ticker), implied, now, opts.maxModelAgeMs);
  const nfl = isNflMarket(raw);
  const gradedSide: Side =
    edge.status === "edge" && edge.side === "no" && edge.netPerContract > 0 ? "no" : "yes";
  const sideAsk = gradedSide === "yes" ? yesAsk : noAsk;
  const sideFee = gradedSide === "yes" ? implied.feeYes : implied.feeNo;
  const bin = priceBinFor(sideAsk);

  /* score */
  const reasons: SignalReason[] = [];
  const caps: { cap: SignalGrade; text: string }[] = [];
  const add = (points: number, text: string, effect?: SignalReason["effect"]) =>
    reasons.push({
      text,
      points,
      effect: effect ?? (points > 0 ? "up" : points < 0 ? "down" : "info"),
    });
  let score = 30;
  const liqPts = Math.round(liquidity.score * 0.4);
  score += liqPts;
  add(
    liqPts - 20,
    liquidity.word === "none"
      ? "No live two-sided book to trade into"
      : `Liquidity is ${liquidity.word} (${liquidity.score}/100${spread.cents != null ? `, ${spread.cents}¢ spread` : ""}${liquidity.askSize != null ? `, ${Math.round(liquidity.askSize)} at the ask` : ""})`,
  );
  const freshPts = freshness.word === "live" ? 15 : freshness.word === "recent" ? 10 : 0;
  score += freshPts;
  if (freshness.stale) {
    caps.push({
      cap: "D",
      text:
        freshness.staleReason === "last_trade_only"
          ? "Price is the last trade only — no live book, time of trade unknown"
          : freshness.staleReason === "invalid_fetch_time"
            ? "Read time is unknown, so the price cannot be trusted as current"
            : `Quote is ${durationWords(freshness.ageMs)} old`,
    });
  }
  if (sideAsk == null) {
    caps.push({
      cap: "D",
      text: `No ${gradedSide.toUpperCase()} ask — nothing to buy at a known price`,
    });
  } else if (bin) {
    score += bin.gradePoints;
    if (bin.gradePoints !== 0)
      add(bin.gradePoints, `${gradedSide.toUpperCase()} at ${c(sideAsk)}: ${bin.evidence}`);
    if (bin.cap)
      caps.push({
        cap: bin.cap,
        text: `${bin.label} buys are capped at ${bin.cap} — documented losers on average, before and after fees`,
      });
    if (bin.id === "lt10" || bin.id === "10to20") add(0, MAKER_TAKER.note, "info");
  }
  if (sideAsk != null && sideFee != null && sideAsk > 0) {
    const drag = (sideFee + slippage) / sideAsk;
    const pts = drag > 0.1 ? -10 : drag > 0.05 ? -5 : 0;
    score += pts;
    if (pts)
      add(
        pts,
        `Fees + slippage are ${(drag * 100).toFixed(0)}% of the stake (${sc(sideFee + slippage).replace("+", "")} a contract)`,
      );
  }
  if (settlement.phase === "closed")
    caps.push({
      cap: "F",
      text: trading ? "Market has closed" : `Market is ${raw.status}, not trading`,
    });
  else if (settlement.msToClose != null && settlement.msToClose < 2 * 60_000)
    caps.push({ cap: "D", text: "Under 2 minutes left to trade" });
  if (settlement.msToSettle != null && settlement.msToSettle > LONG_HORIZON_MS) {
    score -= 5;
    add(
      -5,
      `Settles in ${settlement.words} — longer horizons are less well priced (favorite–longshot bias grows with time) and tie up money`,
    );
  }
  if (edge.status === "edge") {
    const e = edge.netPerContract;
    const pts = e >= 0.02 ? 15 : e > 0 ? 5 : -15;
    score += pts;
    const sideProb = edge.side === "yes" ? edge.modelProb : 1 - edge.modelProb;
    add(
      pts,
      `${edge.modelSource} puts ${edge.side.toUpperCase()} at ${(sideProb * 100).toFixed(1)}% — ${sc(e)} a contract after fees + slippage`,
    );
    if (e <= 0) caps.push({ cap: "C", text: "The model says neither side clears fees + slippage" });
  } else {
    caps.push({
      cap: "B",
      text: `No edge read: ${edge.reason} — best possible grade is B (setup only)`,
    });
  }
  if (nfl) {
    score += NFL_BOOST_POINTS;
    add(NFL_BOOST_POINTS, "NFL market — small preference, never past a cap");
  }
  if (move.sinceOpen != null) {
    add(
      0,
      `Moved ${sc(move.sinceOpen)} since ${move.basis === "previous_day" ? "the previous day's last trade" : "the first trade after open"}${move.velocityCentsPerHour != null ? ` (${move.velocityCentsPerHour >= 0 ? "+" : "−"}${Math.abs(move.velocityCentsPerHour).toFixed(1)}¢/h lately)` : ""} — shown, not graded`,
      "info",
    );
  }
  score = clamp(Math.round(score), 0, 100);
  let grade = letterFor(score);
  const capReasons: SignalReason[] = [];
  for (const k of caps) {
    if (better(grade, k.cap)) grade = capTo(grade, k.cap);
    capReasons.push({ text: k.text, effect: "cap", points: 0 });
  }
  const ordered = [
    ...capReasons.sort((a, b) => a.text.localeCompare(b.text)),
    ...reasons
      .filter((r) => r.effect !== "info")
      .sort((a, b) => Math.abs(b.points) - Math.abs(a.points)),
    ...reasons.filter((r) => r.effect === "info"),
  ];
  const { event, outcome } = labels(raw, ticker);
  const top =
    (
      capReasons.find((r) => !r.text.startsWith("No edge read")) ??
      ordered.find((r) => r.effect !== "cap" && r.effect !== "info")
    )?.text ?? "";
  return {
    id: ticker,
    event,
    outcome,
    series: typeof raw._series === "string" ? raw._series : null,
    source: "kalshi",
    nfl,
    prices: { yesBid, yesAsk, noBid, noAsk, last },
    implied,
    spread,
    liquidity,
    move,
    settlement,
    freshness,
    edge,
    gradedSide,
    priceBin: bin?.id ?? null,
    grade,
    score,
    reasons: ordered,
    headline: `${grade} · ${outcome}${implied.feeAdjustedYes != null ? ` · YES needs ${(implied.feeAdjustedYes * 100).toFixed(1)}% after costs` : ""} · ${
      edge.status === "edge"
        ? `${edge.side.toUpperCase()} ${sc(edge.netPerContract)} net`
        : NO_EDGE_READ
    }${top ? ` — ${top}` : ""}`,
  };
}

/* ── board / ranking / hall ─────────────────────────────────────────────── */

/** Grade first, then score (NFL's +3 lives inside score), then liquidity, then id. */
export function rankSignals(signals: MarketSignal[]): MarketSignal[] {
  return [...signals].sort(
    (a, b) =>
      gradeIdx(a.grade) - gradeIdx(b.grade) ||
      b.score - a.score ||
      b.liquidity.score - a.liquidity.score ||
      a.id.localeCompare(b.id),
  );
}

export interface RawFeedRead {
  raw: KalshiPublicMarket[];
  asOf: string;
  label?: string;
  reason?: string;
  deadlineExceeded?: boolean;
  skipped?: string[];
}

export function buildSignalBoard(
  read: RawFeedRead,
  opts: Omit<SignalOptions, "asOf"> = {},
): SignalBoard {
  const now = opts.now ?? Date.now();
  const fees = opts.fees ?? DEFAULT_SIGNAL_FEES;
  const slippage = opts.slippage ?? DEFAULT_SLIPPAGE;
  const signals = rankSignals(
    read.raw
      .map((r) => computeSignal(r, { ...opts, asOf: read.asOf, now, fees, slippage }))
      .filter((s): s is MarketSignal => s != null),
  );
  const counts = { A: 0, B: 0, C: 0, D: 0, F: 0 } as Record<SignalGrade, number>;
  for (const s of signals) counts[s.grade]++;
  const out: SignalBoard = {
    signals,
    asOf: isoOrNull(read.asOf) ?? new Date(now).toISOString(),
    source: "kalshi",
    label: read.label ?? KALSHI_SOURCE_LABEL,
    stale: isStaleAsOf(read.asOf, now),
    engineVersion: SIGNAL_ENGINE_VERSION,
    feeModel: fees.id,
    slippage,
    counts,
    noEdgeCount: signals.filter((s) => s.edge.status === NO_EDGE_READ).length,
  };
  if (read.deadlineExceeded) out.deadlineExceeded = true;
  if (read.skipped?.length) out.skipped = read.skipped;
  if (read.reason) out.reason = read.reason;
  else if (!signals.length) out.reason = "No priced Kalshi markets in this read.";
  return out;
}

/** Crowd energy from REAL velocity only: |¢/h| scaled so 10¢/h ≈ full roar. */
export function crowdFrom(signals: MarketSignal[]): CrowdRead {
  const moving = signals.filter((s) => s.move.velocityCentsPerHour != null);
  if (!moving.length)
    return {
      energy: null,
      mood: "quiet",
      basedOn: 0,
      reason: "no real price moves read — the crowd stays quiet",
    };
  const v = moving.map((s) => s.move.velocityCentsPerHour as number);
  const meanAbs = v.reduce((s, x) => s + Math.abs(x), 0) / v.length;
  const net = v.reduce((s, x) => s + x, 0) / v.length;
  const energy = Math.round(clamp(meanAbs / 10, 0, 1) * 100) / 100;
  const mood: CrowdRead["mood"] =
    energy < 0.1
      ? "quiet"
      : Math.abs(net) < meanAbs * 0.3
        ? "restless"
        : net > 0
          ? "surging"
          : "sliding";
  return {
    energy,
    mood,
    basedOn: moving.length,
    reason: `mean |velocity| ${meanAbs.toFixed(1)}¢/h across ${moving.length} market(s) with real trades`,
  };
}

export function hallLayout(board: SignalBoard): HallLayout {
  const ranked = rankSignals(board.signals);
  return {
    jumbotron: ranked[0] ?? null,
    runeBoard: ranked.slice(1, 6),
    crowd: crowdFrom(ranked),
    asOf: board.asOf,
  };
}

/**
 * Real model inputs from Predict board scan rows: the CONSERVATIVE reference
 * (fairLo — DraftKings no-vig lowest-of-three pregame / ESPN live in-game).
 * Never the consensus (it contains the Kalshi mid itself).
 */
export function modelInputsFromScanRows(rows: ScanRow[], asOf: string): Record<string, ModelInput> {
  const out: Record<string, ModelInput> = {};
  for (const r of rows) {
    if (r.fairLo == null || !(r.fairLo > 0 && r.fairLo < 1)) continue;
    out[r.key] = { prob: r.fairLo, source: r.refName ?? "board reference", asOf };
  }
  return out;
}
