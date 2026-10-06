/**
 * PAPER-TRADE SCORER — measure a signal before trusting it.
 *
 * Pure functions over paper tickets (no storage, no broker, no order path).
 * Ai/research/2026-10-06-pm-signal.md §3:
 *   - Brier + MAE (+ log loss), on PRE-OUTCOME snapshots only — a ticket whose
 *     snapshot is at/after resolution is excluded and counted, never scored
 *   - Murphy decomposition: Brier ≈ reliability − resolution + uncertainty
 *   - calibration (reliability) buckets, Brier/MAE by time-to-close
 *   - hit rate + net P/L per contract AFTER fees + slippage, by grade, price
 *     bin (favorite–longshot monitor) and maker vs taker
 *   - walk-forward: recalibrate on past resolutions only, score the next fold
 * Every bucket shows n; below the threshold it reads "too few to read".
 */

import { feePerContract, type FeeModel } from "./math";
import { isoOrNull } from "./prediction-market-feed";
import {
  MIN_SAMPLE_BUCKET,
  MIN_SAMPLE_OVERALL,
  PRICE_BINS,
  TOO_FEW,
  priceBinFor,
  type TooFew,
} from "./signal-evidence";
import {
  DEFAULT_SIGNAL_FEES,
  DEFAULT_SLIPPAGE,
  type MarketSignal,
  type Side,
  type SignalGrade,
} from "./signal-engine";

export interface PaperTicket {
  id: string;
  marketId: string;
  side: Side;
  /** Forecast probability that YES resolves, at the snapshot. */
  forecast: number;
  forecastSource: "model" | "market";
  /** Price paid for `side` (its ask), 0–1. */
  entryPrice: number;
  /** Per-contract fee at entry; computed from the fee model when absent. */
  fee?: number;
  slippage?: number;
  role?: "taker" | "maker";
  grade?: SignalGrade;
  /** ISO time the forecast/price was snapshotted. */
  snapshotAt: string;
  /** ISO expected settlement / close (for time-to-close buckets). */
  closeAt?: string | null;
  /** 1 = YES resolved, 0 = NO; null/undefined = open. */
  outcome?: 0 | 1 | null;
  /** ISO time the outcome became known. */
  resolvedAt?: string | null;
}

export type Readable<T> = ({ read: "ok" } & T) | { read: TooFew; n: number; need: number };

export interface CalibrationBucket {
  lo: number;
  hi: number;
  n: number;
  meanForecast: number | null;
  observed: number | null;
  /** observed − meanForecast. */
  gap: number | null;
  read: "ok" | TooFew;
}

export interface MurphyDecomposition {
  reliability: number;
  resolution: number;
  uncertainty: number;
  /** reliability − resolution + uncertainty (≈ brier; exact when forecasts are constant within a bin). */
  reconstructed: number;
  /** brier − reconstructed (within-bin variance term). */
  residual: number;
}

export interface ScoreCore {
  n: number;
  hitRate: number;
  brier: number;
  /** 95% CI half-width on Brier (normal approx.). */
  brierCi95: number;
  mae: number;
  logLoss: number;
  /** Mean net dollars per contract after fee + slippage, held to settlement. */
  netPerContract: number;
  /** Net / dollars staked. */
  netReturn: number;
}

export interface HorizonBucket {
  label: string;
  loMs: number;
  hiMs: number;
  score: Readable<{ n: number; brier: number; mae: number }>;
}

export interface GroupScore {
  key: string;
  score: Readable<ScoreCore>;
}

export interface PaperScore {
  tickets: number;
  open: number;
  settled: number;
  /** Settled tickets NOT scored because the snapshot was not before the outcome (or no time). */
  excludedPostOutcome: number;
  excludedReasons: string[];
  overall: Readable<ScoreCore & { murphy: MurphyDecomposition; baseRate: number }>;
  calibration: CalibrationBucket[];
  byTimeToClose: HorizonBucket[];
  byGrade: GroupScore[];
  byPriceBin: GroupScore[];
  byRole: GroupScore[];
  byForecastSource: GroupScore[];
  minSample: { overall: number; bucket: number };
  verdict: string;
}

export interface ScorerOptions {
  fees?: FeeModel;
  slippage?: number;
  bins?: number;
  minOverall?: number;
  minBucket?: number;
}

const r4 = (x: number) => Math.round(x * 10_000) / 10_000;
const EPS = 1e-6;

export const HORIZONS: readonly { label: string; loMs: number; hiMs: number }[] = [
  { label: "under 1h", loMs: 0, hiMs: 3600_000 },
  { label: "1–6h", loMs: 3600_000, hiMs: 6 * 3600_000 },
  { label: "6–24h", loMs: 6 * 3600_000, hiMs: 24 * 3600_000 },
  { label: "1–3 days", loMs: 24 * 3600_000, hiMs: 72 * 3600_000 },
  { label: "3–10 days", loMs: 72 * 3600_000, hiMs: 240 * 3600_000 },
  { label: "over 10 days", loMs: 240 * 3600_000, hiMs: Infinity },
];

/** Pre-outcome gate: settled tickets are scored only if snapshotAt < resolvedAt (fallback closeAt). */
export function preOutcome(t: PaperTicket): { ok: boolean; why: string | null } {
  if (t.outcome !== 0 && t.outcome !== 1) return { ok: false, why: "open" };
  const snap = isoOrNull(t.snapshotAt);
  const res = isoOrNull(t.resolvedAt ?? null) ?? isoOrNull(t.closeAt ?? null);
  if (!snap) return { ok: false, why: `${t.id}: snapshot time invalid` };
  if (!res)
    return {
      ok: false,
      why: `${t.id}: no resolution/close time — cannot prove the snapshot was pre-outcome`,
    };
  if (Date.parse(snap) >= Date.parse(res))
    return { ok: false, why: `${t.id}: snapshot at/after resolution` };
  return { ok: true, why: null };
}

const won = (t: PaperTicket) => (t.side === "yes" ? t.outcome === 1 : t.outcome === 0);

function netOf(t: PaperTicket, fees: FeeModel, slip: number): number {
  const fee =
    t.fee ?? (t.entryPrice > 0 && t.entryPrice < 1 ? feePerContract(t.entryPrice, 100, fees) : 0);
  return (won(t) ? 1 : 0) - t.entryPrice - fee - (t.slippage ?? slip);
}

function core(ts: PaperTicket[], fees: FeeModel, slip: number): ScoreCore {
  const n = ts.length;
  const sq = ts.map((t) => (t.forecast - (t.outcome as number)) ** 2);
  const brier = sq.reduce((s, x) => s + x, 0) / n;
  const sd = Math.sqrt(sq.reduce((s, x) => s + (x - brier) ** 2, 0) / Math.max(1, n - 1));
  const mae = ts.reduce((s, t) => s + Math.abs(t.forecast - (t.outcome as number)), 0) / n;
  const ll =
    ts.reduce((s, t) => {
      const p = Math.min(1 - EPS, Math.max(EPS, t.forecast));
      return (
        s - ((t.outcome as number) * Math.log(p) + (1 - (t.outcome as number)) * Math.log(1 - p))
      );
    }, 0) / n;
  const nets = ts.map((t) => netOf(t, fees, slip));
  const staked = ts.reduce((s, t) => s + t.entryPrice, 0);
  return {
    n,
    hitRate: r4(ts.filter(won).length / n),
    brier: r4(brier),
    brierCi95: r4((1.96 * sd) / Math.sqrt(n)),
    mae: r4(mae),
    logLoss: r4(ll),
    netPerContract: r4(nets.reduce((s, x) => s + x, 0) / n),
    netReturn: staked > 0 ? r4(nets.reduce((s, x) => s + x, 0) / staked) : 0,
  };
}

const gate = <T extends object>(n: number, need: number, f: () => T): Readable<T> =>
  n >= need ? ({ read: "ok", ...f() } as Readable<T>) : { read: TOO_FEW, n, need };

const binIndex = (p: number, bins: number) => Math.min(bins - 1, Math.max(0, Math.floor(p * bins)));

export function murphy(
  ts: PaperTicket[],
  bins = 10,
): MurphyDecomposition & { brier: number; baseRate: number } {
  const n = ts.length;
  const base = ts.reduce((s, t) => s + (t.outcome as number), 0) / n;
  const groups = Array.from({ length: bins }, () => ({ n: 0, f: 0, o: 0 }));
  for (const t of ts) {
    const g = groups[binIndex(t.forecast, bins)];
    g.n++;
    g.f += t.forecast;
    g.o += t.outcome as number;
  }
  let rel = 0;
  let res = 0;
  for (const g of groups) {
    if (!g.n) continue;
    const fk = g.f / g.n;
    const ok = g.o / g.n;
    rel += g.n * (fk - ok) ** 2;
    res += g.n * (ok - base) ** 2;
  }
  rel /= n;
  res /= n;
  const unc = base * (1 - base);
  const brier = ts.reduce((s, t) => s + (t.forecast - (t.outcome as number)) ** 2, 0) / n;
  const recon = rel - res + unc;
  return {
    reliability: r4(rel),
    resolution: r4(res),
    uncertainty: r4(unc),
    reconstructed: r4(recon),
    residual: r4(brier - recon),
    brier: r4(brier),
    baseRate: r4(base),
  };
}

export function calibrationBuckets(
  ts: PaperTicket[],
  bins = 10,
  minBucket = MIN_SAMPLE_BUCKET,
): CalibrationBucket[] {
  const out: CalibrationBucket[] = Array.from({ length: bins }, (_, i) => ({
    lo: r4(i / bins),
    hi: r4((i + 1) / bins),
    n: 0,
    meanForecast: null,
    observed: null,
    gap: null,
    read: TOO_FEW,
  }));
  const acc = out.map(() => ({ f: 0, o: 0 }));
  for (const t of ts) {
    const k = binIndex(t.forecast, bins);
    out[k].n++;
    acc[k].f += t.forecast;
    acc[k].o += t.outcome as number;
  }
  return out.map((b, k) =>
    b.n
      ? {
          ...b,
          meanForecast: r4(acc[k].f / b.n),
          observed: r4(acc[k].o / b.n),
          gap: r4(acc[k].o / b.n - acc[k].f / b.n),
          read: b.n >= minBucket ? "ok" : TOO_FEW,
        }
      : b,
  );
}

function groupBy(
  ts: PaperTicket[],
  key: (t: PaperTicket) => string | null,
  order: string[],
  fees: FeeModel,
  slip: number,
  need: number,
): GroupScore[] {
  const m = new Map<string, PaperTicket[]>();
  for (const t of ts) {
    const k = key(t);
    if (k == null) continue;
    m.set(k, [...(m.get(k) ?? []), t]);
  }
  const keys = [
    ...order.filter((k) => m.has(k)),
    ...[...m.keys()].filter((k) => !order.includes(k)).sort(),
  ];
  return keys.map((k) => {
    const g = m.get(k) as PaperTicket[];
    return { key: k, score: gate(g.length, need, () => core(g, fees, slip)) };
  });
}

export function scorePaper(tickets: PaperTicket[], opts: ScorerOptions = {}): PaperScore {
  const fees = opts.fees ?? DEFAULT_SIGNAL_FEES;
  const slip = opts.slippage ?? DEFAULT_SLIPPAGE;
  const bins = opts.bins ?? 10;
  const minO = opts.minOverall ?? MIN_SAMPLE_OVERALL;
  const minB = opts.minBucket ?? MIN_SAMPLE_BUCKET;
  const valid = tickets.filter(
    (t) =>
      Number.isFinite(t.forecast) &&
      t.forecast >= 0 &&
      t.forecast <= 1 &&
      Number.isFinite(t.entryPrice),
  );
  const open = valid.filter((t) => t.outcome !== 0 && t.outcome !== 1);
  const settled = valid.filter((t) => t.outcome === 0 || t.outcome === 1);
  const excludedReasons: string[] = [];
  const scored: PaperTicket[] = [];
  for (const t of settled) {
    const g = preOutcome(t);
    if (g.ok) scored.push(t);
    else if (g.why) excludedReasons.push(g.why);
  }
  const overall = gate(scored.length, minO, () => {
    const m = murphy(scored, bins);
    const { brier: _b, baseRate, ...dec } = m;
    return { ...core(scored, fees, slip), murphy: dec, baseRate };
  });
  const byTimeToClose: HorizonBucket[] = HORIZONS.map((h) => {
    const g = scored.filter((t) => {
      const close = isoOrNull(t.closeAt ?? null) ?? isoOrNull(t.resolvedAt ?? null);
      if (!close) return false;
      const ms = Date.parse(close) - Date.parse(t.snapshotAt);
      return ms >= h.loMs && ms < h.hiMs;
    });
    return {
      ...h,
      score: gate(g.length, minB, () => {
        const c = core(g, fees, slip);
        return { n: c.n, brier: c.brier, mae: c.mae };
      }),
    };
  });
  const verdict =
    overall.read !== "ok"
      ? `${scored.length} pre-outcome settled ticket(s) — ${TOO_FEW} (need ${minO}). Measure before trusting.`
      : `${overall.n} scored · hit ${(overall.hitRate * 100).toFixed(1)}% · Brier ${overall.brier} ±${overall.brierCi95} · net ${overall.netPerContract >= 0 ? "+" : "−"}${Math.abs(overall.netPerContract * 100).toFixed(1)}¢/contract after fees + slippage.`;
  return {
    tickets: tickets.length,
    open: open.length,
    settled: settled.length,
    excludedPostOutcome: excludedReasons.length,
    excludedReasons,
    overall,
    calibration: calibrationBuckets(scored, bins, minB),
    byTimeToClose,
    byGrade: groupBy(scored, (t) => t.grade ?? null, ["A", "B", "C", "D", "F"], fees, slip, minB),
    byPriceBin: groupBy(
      scored,
      (t) => priceBinFor(t.entryPrice)?.id ?? null,
      PRICE_BINS.map((b) => b.id),
      fees,
      slip,
      minB,
    ),
    byRole: groupBy(scored, (t) => t.role ?? "taker", ["taker", "maker"], fees, slip, minB),
    byForecastSource: groupBy(
      scored,
      (t) => t.forecastSource,
      ["model", "market"],
      fees,
      slip,
      minB,
    ),
    minSample: { overall: minO, bucket: minB },
    verdict,
  };
}

/* ── walk-forward ───────────────────────────────────────────────────────── */

export interface WalkForwardFold {
  fold: number;
  trainN: number;
  testN: number;
  /** Test window: first/last snapshot. */
  testFrom: string;
  testTo: string;
  score: Readable<{
    brierRaw: number;
    brierRecalibrated: number;
    delta: number;
    hitRate: number;
    netPerContract: number;
  }>;
}

export interface WalkForwardResult {
  folds: WalkForwardFold[];
  /** Pooled across readable folds. */
  pooled: Readable<{ n: number; brierRaw: number; brierRecalibrated: number; delta: number }>;
  method: string;
}

export interface WalkForwardOptions extends ScorerOptions {
  folds?: number;
  /** Pseudo-count shrinking a bin's observed rate toward its mean forecast. */
  shrink?: number;
}

/** Learn a binned recalibration map from training tickets (outcomes known). */
export function fitRecalibration(
  train: PaperTicket[],
  bins = 10,
  shrink = 5,
): (p: number) => number {
  const acc = Array.from({ length: bins }, () => ({ n: 0, f: 0, o: 0 }));
  for (const t of train) {
    const a = acc[binIndex(t.forecast, bins)];
    a.n++;
    a.f += t.forecast;
    a.o += t.outcome as number;
  }
  return (p: number) => {
    const a = acc[binIndex(p, bins)];
    if (!a.n) return p;
    const shift = (a.o - a.f) / (a.n + shrink); // shrunk mean (observed − forecast)
    return Math.min(1 - EPS, Math.max(EPS, p + shift));
  };
}

/**
 * Walk-forward: tickets ordered by snapshot; split into `folds` sequential
 * test windows. For each window, train ONLY on tickets resolved strictly
 * before the window's first snapshot (no look-ahead), then score the window
 * raw vs recalibrated.
 */
export function walkForward(
  tickets: PaperTicket[],
  opts: WalkForwardOptions = {},
): WalkForwardResult {
  const fees = opts.fees ?? DEFAULT_SIGNAL_FEES;
  const slip = opts.slippage ?? DEFAULT_SLIPPAGE;
  const bins = opts.bins ?? 10;
  const k = Math.max(2, opts.folds ?? 5);
  const minO = opts.minOverall ?? MIN_SAMPLE_OVERALL;
  const minB = opts.minBucket ?? MIN_SAMPLE_BUCKET;
  const shrink = opts.shrink ?? 5;
  const scored = tickets
    .filter((t) => preOutcome(t).ok)
    .sort((a, b) => Date.parse(a.snapshotAt) - Date.parse(b.snapshotAt));
  const resolvedAt = (t: PaperTicket) =>
    Date.parse(isoOrNull(t.resolvedAt ?? null) ?? isoOrNull(t.closeAt ?? null) ?? "");
  const size = Math.ceil(scored.length / k);
  const folds: WalkForwardFold[] = [];
  let poolN = 0;
  let poolRaw = 0;
  let poolRec = 0;
  for (let i = 1; i < k; i++) {
    const test = scored.slice(i * size, (i + 1) * size);
    if (!test.length) continue;
    const start = Date.parse(test[0].snapshotAt);
    const train = scored.filter((t) => resolvedAt(t) < start);
    const map = fitRecalibration(train, bins, shrink);
    const score =
      train.length >= minO && test.length >= minB
        ? (() => {
            const raw =
              test.reduce((s, t) => s + (t.forecast - (t.outcome as number)) ** 2, 0) / test.length;
            const rec =
              test.reduce((s, t) => s + (map(t.forecast) - (t.outcome as number)) ** 2, 0) /
              test.length;
            const c = core(test, fees, slip);
            poolN += test.length;
            poolRaw += raw * test.length;
            poolRec += rec * test.length;
            return {
              read: "ok" as const,
              brierRaw: r4(raw),
              brierRecalibrated: r4(rec),
              delta: r4(rec - raw),
              hitRate: c.hitRate,
              netPerContract: c.netPerContract,
            };
          })()
        : {
            read: TOO_FEW,
            n: Math.min(train.length, test.length),
            need: train.length < minO ? minO : minB,
          };
    folds.push({
      fold: i,
      trainN: train.length,
      testN: test.length,
      testFrom: test[0].snapshotAt,
      testTo: test[test.length - 1].snapshotAt,
      score,
    });
  }
  return {
    folds,
    pooled: gate(poolN, minO, () => ({
      n: poolN,
      brierRaw: r4(poolRaw / poolN),
      brierRecalibrated: r4(poolRec / poolN),
      delta: r4((poolRec - poolRaw) / poolN),
    })),
    method: `${k} sequential folds by snapshot time; each trains a ${bins}-bin recalibration (shrink ${shrink}) on tickets resolved before the fold starts.`,
  };
}

/* ── tickets from signals (paper only) ──────────────────────────────────── */

/**
 * A PAPER ticket from a live signal — what the scorer measures. Forecast is
 * the real model probability when there is an edge read, else the market mid
 * (scoring the market itself). Returns null when the side has no ask.
 */
export function paperTicketFromSignal(
  s: MarketSignal,
  opts: { side?: Side; at?: string; id?: string } = {},
): PaperTicket | null {
  const side = opts.side ?? s.gradedSide;
  const ask = side === "yes" ? s.prices.yesAsk : s.prices.noAsk;
  const fee = side === "yes" ? s.implied.feeYes : s.implied.feeNo;
  const forecast = s.edge.status === "edge" ? s.edge.modelProb : s.implied.mid;
  if (ask == null || forecast == null) return null;
  const at = isoOrNull(opts.at ?? null) ?? s.freshness.asOf;
  return {
    id: opts.id ?? `${s.id}@${at}`,
    marketId: s.id,
    side,
    forecast,
    forecastSource: s.edge.status === "edge" ? "model" : "market",
    entryPrice: ask,
    fee: fee ?? undefined,
    slippage: s.implied.slippage,
    role: "taker",
    grade: s.grade,
    snapshotAt: at,
    closeAt: s.settlement.settleAt,
    outcome: null,
    resolvedAt: null,
  };
}
