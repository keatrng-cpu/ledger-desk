/**
 * Apex evaluation Monte Carlo — how often the desk's own measured cards pass,
 * bust, or run out the 30-day clock on an Apex account, and how much of that
 * is variance.
 *
 * WHAT IT RESAMPLES. `src/data/evidence-dist.json`: every filled card whose
 * stop sat inside 0.5–1.5 ATR — the policy the desk's ticket actually sizes —
 * simulated under the rule as coded over four years (limit at CE, 50% at T1,
 * stop to breakeven, runner to T2, ties against). Per trade it carries the
 * realised R and the open-equity PEAK and TROUGH in R, because an
 * intraday-trailing account trails the peak, not the exit.
 *
 * WHAT IT IS NOT. That distribution's mean is about +0.03R per card and its
 * day-clustered 95% interval straddles zero (the evidence pack's in-band
 * bucket, verdict MIXED). A pass rate computed from it is arithmetic on a
 * roughly breakeven distribution — the shape of the variance under Apex's
 * rules — not a forecast of this trader passing. So every run is paired with
 * a ZERO-EDGE CONTROL: the same trades with the mean shifted to exactly 0R,
 * driven by the SAME random draws (each path has its own seeded stream, so an
 * early pass or bust in one arm cannot desynchronise the other). Whatever the
 * control also does, the edge did not do.
 *
 * MODELLING DECISIONS, each one measured on the committed evidence before it
 * was chosen (prototype runs, 50K, 2 MNQ at 40pt = $160/R, 5,000 paths):
 *
 *   1. DAY BLOCKS. Cards on one day share a tape and are not independent, so
 *      the bootstrap draws whole trading days — the CME day that rolls at
 *      18:00 ET, which is also the session boundary that resets Apex's daily
 *      loss limit. Empty weekdays stay in the pool: 555 of 1,036 sessions had
 *      no card, and dropping them would inflate the rate.
 *
 *   2. THINNING TO THE CADENCE. Each drawn card is taken with probability p,
 *      calibrated analytically so the expected rate equals the trades/week
 *      asked for. Uniform thinning assumes no selection skill — the only
 *      assumption the evidence supports.
 *
 *   3. A DAILY CAP, defaulting to the desk's own `maxSetupsPerSession` (2).
 *      The evidence holds days with up to 22 cards; thinned without a cap, a
 *      3/week trader would take ten of them in one session, which the desk's
 *      2-per-killzone rule never allows. It is not a detail: at 3/week the
 *      uncapped EOD bust rate measured 7.5% against 1.6% capped, Intraday
 *      12.7% against 3.4%. Under the cap the policy supplies at most ~3.75
 *      cards a week (cards exist on only 46% of sessions), so a higher request
 *      is simulated at that ceiling and the result says so instead of
 *      inventing cards the policy never produced.
 *
 *   4. ORDER INSIDE A TRADE. The evidence stores the extremes, not their
 *      sequence — but the management rule implies it. After T1 the stop sits
 *      at breakeven, so a trade that CLOSED GREEN took any negative excursion
 *      before it ran; a trade that closed flat or red peaked before the stop
 *      took it. So: green trades check the trough, then the peak, then the
 *      give-back to the exit; red trades check the peak, then the trough.
 *      Always peak-first would book busts the rule makes impossible (3/week
 *      Intraday, uncapped: 15.4% peak-first vs 12.7% rule-ordered). Only
 *      time-exits are genuinely ambiguous, and they are the minority.
 *
 *   5. PASS ON TOUCH. The trader rests a take-profit at the pass level, so an
 *      open peak that reaches the target (after the round-turn commission)
 *      passes the account there.
 *
 *   6. COSTS. The evidence is "before commission". Each trade is charged the
 *      desk's round-turn commission per contract (`CONTRACTS[..].commission`,
 *      the pnl.ts convention) — the desk's number, not Apex's fee schedule.
 *
 *   7. WHOLE CONTRACTS. contracts = floor(risk$ / (stop pts × point value)),
 *      refused above the account's cap or below one, and 1R in dollars is
 *      what one full stop actually costs at that size — not the figure typed.
 *
 * HORIZON: 30 calendar days = round(30 × 5/7) = 21 sessions. A holiday is
 * just another no-card day in the pool, so it is not removed twice.
 *
 * NOT MODELLED, and stated on the panel: same-day positions run one after
 * another (the evidence has overlapping MNQ and ES cards whose open P&L would
 * sum — the daily cap and one-book-a-day keep this small); cards held across
 * 4:59 PM ET keep their measured exit although Apex would flatten them; the
 * evaluation's trailing threshold is assumed never to lock (unconfirmed).
 *
 * PURE and deterministic: seeded mulberry32, never Math.random, no I/O except
 * `loadEvidenceDist`, which is a dynamic import so the 53KB of paths ships in
 * its own chunk instead of the page bundle (the reason the evidence builder
 * split them from the pack in the first place).
 */

import { APLUS_RULES, CONTRACTS, type ContractKey } from "@/lib/aplus/config";
import { etWallParts } from "@/lib/trading/sessions";
import { EVIDENCE } from "@/lib/trading/evidence";
import { rulesFor } from "./rules";
import { MAX_ROOM_FRACTION_PER_TRADE } from "./score";

/* ═════════════════════════════════════════════════════════════════════════
 * The rules — Apex, accounts bought on/after 2026-03-01, researched 2026-09-25
 * ═════════════════════════════════════════════════════════════════════════ */

/**
 * WHY THIS TABLE IS NOT IN rules.ts. rules.ts feeds `scorePropTrade`, which
 * sizes a live trade, so it only admits figures confirmed on Apex's own pages
 * and refuses every size it has no cited row for (pinned by
 * verify-propfirm-score.mjs). This table feeds a what-if simulation and a
 * calculator, so it may carry secondary-source figures — but every figure
 * says which it is, and the panel prints "unconfirmed" beside each one that
 * is not Apex's own text. None of these numbers can reach `scorePropTrade`.
 * The 50K rows are cross-checked against rules.ts by verify-apex-sim.mjs, so
 * the two tables cannot drift apart silently.
 */
export const APEX_RULES_AS_OF = "2026-09-25";
export const APEX_RULES_APPLY_TO = "accounts bought on/after 2026-03-01";

/**
 * apex     — Apex's own help-center text.
 * secondary — third-party sources; not confirmed on Apex's pages.
 * assumed  — neither; the model's conservative choice, stated.
 */
export type RuleConfidence = "apex" | "secondary" | "assumed";

export const CONFIDENCE_LABEL: Record<RuleConfidence, string> = {
  apex: "Apex text",
  secondary: "unconfirmed",
  assumed: "unconfirmed · assumed",
};

export interface RuleFigure {
  value: number;
  confidence: RuleConfidence;
}

export type ApexSize = 25_000 | 50_000 | 100_000 | 150_000;
export type DrawdownType = "EOD" | "Intraday";

export interface ApexSizeRules {
  size: ApexSize;
  label: string;
  /** Profit above the starting balance that passes the evaluation. */
  profitTarget: RuleFigure;
  /** Maximum trailing drawdown — the same figure for EOD and Intraday. */
  drawdown: RuleFigure;
  /** Evaluation position cap, full-size contracts. 10 micros = 1 mini. */
  maxMinis: RuleFigure;
  maxMicros: RuleFigure;
  /** EOD evaluations only; Intraday evaluations have none. */
  eodDailyLossLimit: RuleFigure;
}

const A = (value: number): RuleFigure => ({ value, confidence: "apex" });
const S = (value: number): RuleFigure => ({ value, confidence: "secondary" });

export const APEX_EVAL_RULES: readonly ApexSizeRules[] = [
  {
    size: 25_000,
    label: "25K",
    profitTarget: S(1_500),
    drawdown: S(1_000),
    maxMinis: S(4),
    maxMicros: S(40),
    eodDailyLossLimit: S(500),
  },
  {
    size: 50_000,
    label: "50K",
    profitTarget: A(3_000),
    drawdown: A(2_000),
    maxMinis: A(6),
    maxMicros: A(60),
    eodDailyLossLimit: A(1_000),
  },
  {
    size: 100_000,
    label: "100K",
    profitTarget: S(6_000),
    drawdown: S(3_000),
    maxMinis: S(8),
    maxMicros: S(80),
    eodDailyLossLimit: S(1_500),
  },
  {
    size: 150_000,
    label: "150K",
    profitTarget: S(9_000),
    drawdown: S(4_000),
    maxMinis: S(12),
    maxMicros: S(120),
    eodDailyLossLimit: S(2_000),
  },
];

export const APEX_SIZES: readonly ApexSize[] = APEX_EVAL_RULES.map((r) => r.size);

export function apexRulesFor(size: number): ApexSizeRules | null {
  return APEX_EVAL_RULES.find((r) => r.size === size) ?? null;
}

/** Calendar days an evaluation has to pass. Apex text. */
export const APEX_EVAL_DAYS = 30;

/** A PA's threshold locks at start + this, once the peak reaches start + drawdown + this. */
export const PA_LOCK_OFFSET_USD = 100;

export interface ApexMechanic {
  key: string;
  rule: string;
  confidence: RuleConfidence;
}

/** The rules that are not per-size numbers. Each one is modelled or printed. */
export const APEX_MECHANICS: readonly ApexMechanic[] = [
  {
    key: "eod-trail",
    rule: "EOD trailing: the threshold is recalculated once a day at 4:59:59 PM ET from the closing balance, enforced intraday next session including open P&L, and never moves down.",
    confidence: "apex",
  },
  {
    key: "intraday-trail",
    rule: "Intraday trailing: the threshold follows the peak balance INCLUDING open P&L, in real time.",
    confidence: "apex",
  },
  {
    key: "touch",
    rule: "Touching the threshold fails an evaluation and closes a PA.",
    confidence: "apex",
  },
  {
    key: "eod-dll",
    rule: "EOD evaluations carry a daily loss limit (per size above). Hitting it liquidates and locks trading until the 6 PM ET session; the account survives.",
    confidence: "apex",
  },
  {
    key: "intraday-no-dll",
    rule: "Intraday evaluations have no daily loss limit.",
    confidence: "apex",
  },
  {
    key: "pa-lock",
    rule: "PA: the trailing threshold stops at start + $100 once the peak (Intraday) or the highest EOD balance reaches start + drawdown + $100.",
    confidence: "apex",
  },
  {
    key: "eval-lock",
    rule: "Evaluation: whether the threshold ever locks is unconfirmed — modelled here as trailing indefinitely, the conservative case.",
    confidence: "assumed",
  },
  {
    key: "eval-free",
    rule: "Evaluation: no consistency rule and no minimum trading days.",
    confidence: "apex",
  },
  {
    key: "eval-30d",
    rule: `Evaluation: ${APEX_EVAL_DAYS} calendar days to pass.`,
    confidence: "apex",
  },
  {
    key: "pa-consistency",
    rule: "PA: the largest profitable day must be under 50% of net profit since the last payout — it blocks the payout, not the account.",
    confidence: "apex",
  },
  {
    key: "pa-days",
    rule: "PA: 5 qualifying days per payout.",
    confidence: "apex",
  },
  {
    key: "pa-qualifying-min",
    rule: "PA qualifying-day minimum profit (50K): $250 on EOD, $200 on Intraday.",
    confidence: "secondary",
  },
  {
    key: "pa-inactivity",
    rule: "PA inactivity: at least 2 days of $50+ net profit in every rolling 30 days.",
    confidence: "apex",
  },
  {
    key: "flat",
    rule: "Be flat before 4:59 PM ET.",
    confidence: "apex",
  },
];

/* ═════════════════════════════════════════════════════════════════════════
 * Whole contracts at the trader's stop
 * ═════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_STOP_PTS: Record<ContractKey, number> = {
  MNQ: 40,
  NQ: 40,
  MES: 8,
  ES: 8,
};

export interface ApexContractSizing {
  ok: boolean;
  symbol: ContractKey;
  contracts: number;
  /** One contract's full stop-out, in dollars. */
  perContractUsd: number;
  /** What one full stop-out costs at `contracts` — the simulator's 1R. */
  riskUsd: number;
  /** Round-turn commission for the whole position (desk convention, pnl.ts). */
  commissionUsd: number;
  capContracts: number;
  capUnit: "micros" | "minis";
  refusal: string | null;
}

function isMicro(symbol: ContractKey): boolean {
  return CONTRACTS[symbol].micro === symbol;
}

/**
 * contracts = floor(risk$ / (stop × point value)). Refuses rather than rounds:
 * zero contracts is not "one, slightly over", and above the account's cap is
 * not "the cap, silently" — both change the trade the trader thinks they are
 * taking.
 */
export function apexContracts(
  rules: ApexSizeRules,
  symbol: ContractKey,
  riskUsd: number,
  stopPts: number,
): ApexContractSizing {
  const spec = CONTRACTS[symbol];
  const micro = isMicro(symbol);
  const cap = micro ? rules.maxMicros : rules.maxMinis;
  const capContracts = cap.value;
  const capUnit = micro ? "micros" : "minis";
  const perContractUsd = stopPts * spec.pointValue;
  const base = {
    symbol,
    perContractUsd,
    capContracts,
    capUnit,
  } as const;
  const refuse = (refusal: string): ApexContractSizing => ({
    ...base,
    ok: false,
    contracts: 0,
    riskUsd: 0,
    commissionUsd: 0,
    refusal,
  });

  if (!(stopPts > 0) || !Number.isFinite(stopPts)) {
    return refuse("The stop has to be a positive number of points.");
  }
  if (!(riskUsd > 0) || !Number.isFinite(riskUsd)) {
    return refuse("Risk per trade has to be a positive dollar amount.");
  }
  const contracts = Math.floor(riskUsd / perContractUsd + 1e-9);
  if (contracts < 1) {
    const smaller = micro ? "" : ` — ${spec.micro} is a tenth of the size`;
    return refuse(
      `$${fmtUsd(riskUsd)} buys no ${symbol}: one contract at ${stopPts} pt risks $${fmtUsd(perContractUsd)}${smaller}.`,
    );
  }
  if (contracts > capContracts) {
    return refuse(
      `${contracts} × ${symbol} is over the ${rules.label} evaluation cap of ${capContracts} ${capUnit}${cap.confidence === "apex" ? "" : " (unconfirmed figure)"}.`,
    );
  }
  return {
    ...base,
    ok: true,
    contracts,
    riskUsd: contracts * perContractUsd,
    commissionUsd: contracts * spec.commission,
    refusal: null,
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * The evidence, as trading days
 * ═════════════════════════════════════════════════════════════════════════ */

export interface EvidenceDist {
  n: number;
  perWeek: number | null;
  /** Entry-decision epoch ms, time-ordered. */
  t: number[];
  /** Realised R. */
  r: number[];
  /** Open-equity extremes during the trade, in R (peak >= 0 >= trough). */
  peak: number[];
  trough: number[];
  riskAtr?: number[];
  sym?: string[];
  policy?: string;
  builtAt?: string;
  rules?: Record<string, string>;
}

/** The three arrays the account needs; the zero-edge control is one of these. */
export interface TradeArrays {
  r: number[];
  peak: number[];
  trough: number[];
}

/**
 * The committed distribution, loaded on demand. A dynamic import, so the
 * paths ship in their own chunk and only the tab that simulates pays for them.
 */
export async function loadEvidenceDist(): Promise<EvidenceDist> {
  const mod = (await import("../../data/evidence-dist.json")) as unknown as {
    default: EvidenceDist;
  };
  return mod.default;
}

const DAY_MS = 86_400_000;

/** 1970-01-01 was a Thursday; 0 = Sunday … 6 = Saturday. */
function weekdayOfOrdinal(ord: number): number {
  return (((ord + 4) % 7) + 7) % 7;
}

/**
 * The trading day a card belongs to, as days since 1970-01-01 of its ET date,
 * rolled forward at 18:00 ET — the CME session open that also resets Apex's
 * daily loss limit. CME is shut from Friday 17:00 to Sunday 18:00, so a
 * weekend key should never occur; if one did, it rolls to Monday rather than
 * vanishing from the sample.
 */
export function tradingDayOrdinal(tMs: number): number {
  const p = etWallParts(tMs);
  let ord = Math.floor(Date.UTC(p.year, p.month - 1, p.day) / DAY_MS);
  if (p.hour >= 18) ord += 1;
  const wd = weekdayOfOrdinal(ord);
  if (wd === 6) ord += 2;
  else if (wd === 0) ord += 1;
  return ord;
}

export interface DayPool {
  /**
   * One entry per weekday session from the first card's day to the last
   * card's day, each holding that session's card indices in time order.
   * Empty sessions are real: no card qualified that day.
   */
  sessions: number[][];
  trades: number;
  /** Cards per week the pool supplies if every card is taken. */
  perWeek: number;
  /** Share of sessions with at least one card. */
  activeShare: number;
  maxPerDay: number;
  /** Mean R over every card in the pool — what uniform thinning would take. */
  meanR: number;
  /** Share of cards decided before 09:00 ET — London and overnight. */
  preNyShare: number;
  /** posCount[m] = sessions holding more than m cards (the thinning maths). */
  posCount: number[];
}

const POOLS = new WeakMap<object, DayPool>();

export function buildDayPool(dist: EvidenceDist): DayPool {
  const cached = POOLS.get(dist);
  if (cached) return cached;

  const n = Math.min(dist.t.length, dist.r.length, dist.peak.length, dist.trough.length);
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => dist.t[a] - dist.t[b]);
  const byDay = new Map<number, number[]>();
  let first = Infinity;
  let last = -Infinity;
  let preNy = 0;
  for (const i of order) {
    const ord = tradingDayOrdinal(dist.t[i]);
    const list = byDay.get(ord);
    if (list) list.push(i);
    else byDay.set(ord, [i]);
    if (ord < first) first = ord;
    if (ord > last) last = ord;
    if (etWallParts(dist.t[i]).hour < 9) preNy++;
  }

  const sessions: number[][] = [];
  if (n > 0) {
    for (let ord = first; ord <= last; ord++) {
      const wd = weekdayOfOrdinal(ord);
      if (wd === 0 || wd === 6) continue;
      sessions.push(byDay.get(ord) ?? []);
    }
  }
  const maxPerDay = sessions.reduce((m, s) => Math.max(m, s.length), 0);
  const posCount: number[] = [];
  for (let m = 0; m < maxPerDay; m++) posCount.push(sessions.filter((s) => s.length > m).length);

  const pool: DayPool = {
    sessions,
    trades: n,
    perWeek: sessions.length ? (n / sessions.length) * 5 : 0,
    activeShare: sessions.length ? sessions.filter((s) => s.length > 0).length / sessions.length : 0,
    maxPerDay,
    meanR: n ? order.reduce((sum, i) => sum + dist.r[i], 0) / n : 0,
    preNyShare: n ? preNy / n : 0,
    posCount,
  };
  POOLS.set(dist, pool);
  return pool;
}

/* ═════════════════════════════════════════════════════════════════════════
 * Thinning to the cadence, under the daily cap
 * ═════════════════════════════════════════════════════════════════════════ */

/** P(Binomial(m, p) <= k). */
function binomCdf(m: number, p: number, k: number): number {
  if (k < 0) return 0;
  if (k >= m) return 1;
  if (p <= 0) return 1;
  if (p >= 1) return 0;
  const q = 1 - p;
  const ratio = p / q;
  let pmf = Math.pow(q, m);
  let cdf = pmf;
  for (let j = 1; j <= k; j++) {
    pmf *= ((m - j + 1) / j) * ratio;
    cdf += pmf;
  }
  return Math.min(1, cdf);
}

/**
 * P(the card at 0-based position m of its session is taken): it has to be
 * drawn (p) AND fewer than `cap` of the m cards before it have been.
 */
export function inclusionProbability(m: number, p: number, cap: number | null): number {
  const q = Math.min(1, Math.max(0, p));
  if (q === 0) return 0;
  if (cap == null) return q;
  return q * binomCdf(m, q, cap - 1);
}

function expectedPerSession(pool: DayPool, p: number, cap: number | null): number {
  if (!pool.sessions.length) return 0;
  let sum = 0;
  for (let m = 0; m < pool.posCount.length; m++) {
    sum += pool.posCount[m] * inclusionProbability(m, p, cap);
  }
  return sum / pool.sessions.length;
}

export interface Thinning {
  /** Probability each drawn card is taken. */
  p: number;
  /** Most cards taken in one session; null = no cap. */
  cap: number | null;
  requestedPerWeek: number;
  /** Expected cards per week actually simulated. */
  realizedPerWeek: number;
  /** The most this pool supplies under this cap (p = 1). */
  maxPerWeek: number;
  /** True when the request exceeded what the pool supplies. */
  rateLimited: boolean;
}

export function normalizeCap(cap: number | null | undefined): number | null {
  if (cap == null || !Number.isFinite(cap)) return null;
  return Math.max(1, Math.floor(cap));
}

/**
 * Solve for p so the EXPECTED cards per week equals the request, analytically
 * (the rate is monotone in p, so bisection converges to machine precision in
 * 60 steps). A request the pool cannot meet runs at p = 1 and says so.
 */
export function calibrateThinning(pool: DayPool, perWeek: number, capIn: number | null): Thinning {
  const cap = normalizeCap(capIn);
  const rate = (p: number) => 5 * expectedPerSession(pool, p, cap);
  const maxPerWeek = rate(1);
  const requested = Math.max(0, perWeek);
  if (requested >= maxPerWeek) {
    return {
      p: 1,
      cap,
      requestedPerWeek: requested,
      realizedPerWeek: maxPerWeek,
      maxPerWeek,
      rateLimited: requested > maxPerWeek + 1e-9,
    };
  }
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (rate(mid) < requested) lo = mid;
    else hi = mid;
  }
  const p = (lo + hi) / 2;
  return { p, cap, requestedPerWeek: requested, realizedPerWeek: rate(p), maxPerWeek, rateLimited: false };
}

/**
 * The mean R of the cards this cadence actually takes. Uniform thinning keeps
 * the pool mean; a daily cap does not (it drops the later cards of busy
 * days), so the control is centred on THIS number, not on the pool's.
 */
export function effectiveMeanR(r: ArrayLike<number>, pool: DayPool, p: number, capIn: number | null): number {
  const cap = normalizeCap(capIn);
  const inc: number[] = [];
  for (let m = 0; m < pool.maxPerDay; m++) inc.push(inclusionProbability(m, p, cap));
  let w = 0;
  let wr = 0;
  for (const s of pool.sessions) {
    for (let m = 0; m < s.length; m++) {
      w += inc[m];
      wr += inc[m] * r[s[m]];
    }
  }
  return w > 0 ? wr / w : 0;
}

/**
 * The same trades with the mean moved by `shift` R. The path extremes are
 * kept consistent with the new exit (peak >= exit >= trough) — a trade cannot
 * close below its own low.
 */
export function zeroEdgeControl(dist: TradeArrays, shift: number): TradeArrays {
  const r = dist.r.map((x) => x - shift);
  return {
    r,
    peak: dist.peak.map((x, i) => Math.max(x, r[i], 0)),
    trough: dist.trough.map((x, i) => Math.min(x, r[i], 0)),
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * One evaluation account, trade by trade
 * ═════════════════════════════════════════════════════════════════════════ */

export interface EvalAccountParams {
  drawdown: DrawdownType;
  startUsd: number;
  trailUsd: number;
  /** Profit above the start that passes. */
  targetUsd: number;
  /** EOD evaluations only; null = none (Intraday). */
  dailyLossLimitUsd: number | null;
  /** Dollars per 1R: what one full stop-out costs at the position size. */
  dollarsPerR: number;
  /** Round-turn commission for the whole position, charged at the exit. */
  commissionUsd: number;
}

export interface EvalAccountState {
  params: EvalAccountParams;
  /** Closed balance. */
  balance: number;
  /** Touching this ends the evaluation. Never moves down. */
  threshold: number;
  /** Intraday: the highest equity including open P&L. */
  peakEquity: number;
  /** EOD: the highest end-of-day closing balance. */
  eodHigh: number;
  /** Closed balance at the session open — the daily loss limit's anchor. */
  dayStart: number;
  /** The daily loss limit fired; nothing more is taken until the next session. */
  dayLocked: boolean;
  outcome: "pass" | "bust" | null;
  /** Highest mark-to-market equity seen, for the drawdown statistic. */
  maxEquity: number;
  maxDrawdownUsd: number;
  trades: number;
  dllDays: number;
}

export type TradeEvent = "open" | "pass" | "bust" | "dll" | "skipped";

export function createEvalAccount(params: EvalAccountParams): EvalAccountState {
  return {
    params,
    balance: params.startUsd,
    threshold: params.startUsd - params.trailUsd,
    peakEquity: params.startUsd,
    eodHigh: params.startUsd,
    dayStart: params.startUsd,
    dayLocked: false,
    outcome: null,
    maxEquity: params.startUsd,
    maxDrawdownUsd: 0,
    trades: 0,
    dllDays: 0,
  };
}

export function accountOpenDay(a: EvalAccountState): void {
  a.dayStart = a.balance;
  a.dayLocked = false;
}

/**
 * 4:59:59 PM ET. Only the EOD product moves here: the closing balance can
 * lift the threshold, which then holds through the whole next session.
 */
export function accountCloseDay(a: EvalAccountState): void {
  if (a.outcome) return;
  const p = a.params;
  if (p.drawdown === "EOD" && a.balance > a.eodHigh) {
    a.eodHigh = a.balance;
    a.threshold = Math.max(a.threshold, a.eodHigh - p.trailUsd);
  }
}

function markBust(a: EvalAccountState): TradeEvent {
  // Liquidated at the touch: the drawdown that ended it is peak-to-threshold.
  a.maxDrawdownUsd = Math.max(a.maxDrawdownUsd, a.maxEquity - a.threshold);
  a.balance = a.threshold;
  a.outcome = "bust";
  return "bust";
}

/** The open peak: passes on touch; on Intraday it drags the threshold up. */
function touchPeak(a: EvalAccountState, peakR: number, passLevel: number): boolean {
  const p = a.params;
  const eq = a.balance + peakR * p.dollarsPerR;
  if (eq > a.maxEquity) a.maxEquity = eq;
  if (eq - p.commissionUsd >= passLevel) {
    a.balance = passLevel;
    a.outcome = "pass";
    return true;
  }
  if (p.drawdown === "Intraday" && eq > a.peakEquity) {
    a.peakEquity = eq;
    a.threshold = Math.max(a.threshold, eq - p.trailUsd);
  }
  return false;
}

/**
 * The open low, against whichever floor price reaches FIRST on the way down:
 * the threshold (the evaluation ends) or, on EOD, today's loss limit (the
 * position is liquidated there, trading stops until the next session, and the
 * account survives). When the two coincide the touch is a bust — the
 * threshold is the rule that cannot be survived.
 */
function touchTrough(a: EvalAccountState, troughR: number, dllLevel: number): TradeEvent | null {
  const eq = a.balance + troughR * a.params.dollarsPerR;
  const trigger = Math.max(a.threshold, dllLevel);
  if (eq > trigger) {
    a.maxDrawdownUsd = Math.max(a.maxDrawdownUsd, a.maxEquity - eq);
    return null;
  }
  if (a.threshold >= dllLevel) return markBust(a);
  a.maxDrawdownUsd = Math.max(a.maxDrawdownUsd, a.maxEquity - dllLevel);
  a.balance = dllLevel;
  a.dayLocked = true;
  a.dllDays++;
  return "dll";
}

/**
 * One trade, as the account sees it. The ORDER of the extremes follows the
 * management rule (header, decision 4): a trade that closed green took its
 * low before it ran; one that closed flat or red peaked before its low.
 */
export function accountTrade(a: EvalAccountState, r: number, peak: number, trough: number): TradeEvent {
  if (a.outcome) return a.outcome;
  if (a.dayLocked) return "skipped";
  const p = a.params;
  const pk = Math.max(peak, r, 0);
  const tr = Math.min(trough, r, 0);
  const passLevel = p.startUsd + p.targetUsd;
  const dllLevel = p.dailyLossLimitUsd != null ? a.dayStart - p.dailyLossLimitUsd : -Infinity;
  a.trades++;

  if (r > 0) {
    const low = touchTrough(a, tr, dllLevel);
    if (low) return low;
    if (touchPeak(a, pk, passLevel)) return "pass";
    // The give-back from the peak to the exit, against the threshold that
    // peak may just have raised. This is where an intraday trail charges for
    // a runner that round-trips.
    const exitEq = a.balance + r * p.dollarsPerR;
    if (exitEq <= a.threshold) return markBust(a);
    a.maxDrawdownUsd = Math.max(a.maxDrawdownUsd, a.maxEquity - exitEq);
  } else {
    if (touchPeak(a, pk, passLevel)) return "pass";
    const low = touchTrough(a, tr, dllLevel);
    if (low) return low;
  }

  a.balance += r * p.dollarsPerR - p.commissionUsd;
  if (a.balance <= a.threshold) return markBust(a);
  if (a.balance >= passLevel) {
    a.outcome = "pass";
    return "pass";
  }
  if (a.balance <= dllLevel) {
    a.dayLocked = true;
    a.dllDays++;
    return "dll";
  }
  return "open";
}

/* ═════════════════════════════════════════════════════════════════════════
 * Seeded randomness
 * ═════════════════════════════════════════════════════════════════════════ */

/** mulberry32: 32-bit state, deterministic by seed. Never Math.random. */
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Each path gets its own stream (murmur3's finaliser over seed and index), so
 * the strategy and the control see the same days and the same thinning draws
 * even after one of them has ended a path early.
 */
function pathSeed(seed: number, k: number): number {
  let h = (seed ^ Math.imul(k + 1, 0x9e3779b1)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/* ═════════════════════════════════════════════════════════════════════════
 * The simulation
 * ═════════════════════════════════════════════════════════════════════════ */

export const SIM_DEFAULT_PATHS = 5_000;
export const SIM_MIN_PATHS = 100;
export const SIM_MAX_PATHS = 20_000;
export const TRADES_PER_WEEK_MIN = 2;
export const TRADES_PER_WEEK_MAX = 6;
export const DEFAULT_RISK_USD = 200;

export function clampTradesPerWeek(x: number | null | undefined): number {
  if (x == null || !Number.isFinite(x)) return TRADES_PER_WEEK_MAX;
  return Math.min(TRADES_PER_WEEK_MAX, Math.max(TRADES_PER_WEEK_MIN, x));
}

export function sessionsInHorizon(calendarDays: number): number {
  return Math.max(1, Math.round((calendarDays * 5) / 7));
}

export interface ApexSimInput {
  size: ApexSize;
  drawdown: DrawdownType;
  /** Dollars the trader wants at risk per trade; sizing floors it to whole contracts. */
  riskUsd: number;
  tradesPerWeek: number;
  /** Most trades in one session; null = no cap. */
  maxTradesPerDay: number | null;
  symbol: ContractKey;
  stopPts: number;
  horizonDays: number;
  paths: number;
  seed: number;
}

/**
 * The defaults. Trades/week is the evidence's own rate clamped into the
 * trader's stated 2–6 (the committed pack's 6.4 lands on 6); the daily cap is
 * the desk's per-killzone maximum; Intraday because the live evaluations
 * (APEX-644704-01..05) are the Intraday product.
 */
export function defaultSimInput(perWeek?: number | null): ApexSimInput {
  return {
    size: 50_000,
    drawdown: "Intraday",
    riskUsd: DEFAULT_RISK_USD,
    tradesPerWeek: clampTradesPerWeek(perWeek),
    maxTradesPerDay: APLUS_RULES.maxSetupsPerSession,
    symbol: "MNQ",
    stopPts: DEFAULT_STOP_PTS.MNQ,
    horizonDays: APEX_EVAL_DAYS,
    paths: SIM_DEFAULT_PATHS,
    seed: 1,
  };
}

export interface ApexSimArmStats {
  pass: number;
  bust: number;
  timeout: number;
  /** Trading days to pass, over passing paths only; nearest-rank quantiles. */
  daysToPass: { p25: number | null; median: number | null; p75: number | null };
  /** Median over ALL paths of the worst peak-to-trough on open equity, $. */
  medianMaxDrawdownUsd: number;
  tradesPerPath: number;
  /** Mean sessions per path the daily loss limit ended early (EOD only). */
  dllDaysPerPath: number;
  /** Expected R per trade taken, before and after the round-turn commission. */
  meanGrossR: number;
  meanNetR: number;
}

export interface ApexSimOk {
  ok: true;
  input: ApexSimInput;
  rules: ApexSizeRules;
  sizing: ApexContractSizing;
  sessions: number;
  paths: number;
  thinning: Thinning;
  pool: Omit<DayPool, "sessions" | "posCount">;
  strategy: ApexSimArmStats;
  control: ApexSimArmStats;
  warnings: string[];
}

export interface ApexSimRefused {
  ok: false;
  input: ApexSimInput;
  refusal: string;
  sizing: ApexContractSizing | null;
}

export type ApexSimResult = ApexSimOk | ApexSimRefused;

function nearestRank(sorted: number[], q: number): number | null {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[idx];
}

function runArm(
  arm: TradeArrays,
  pool: DayPool,
  thin: Thinning,
  params: EvalAccountParams,
  sessions: number,
  paths: number,
  seed: number,
  meanGrossR: number,
): ApexSimArmStats {
  const N = pool.sessions.length;
  let pass = 0;
  let bust = 0;
  let trades = 0;
  let dllDays = 0;
  const passDays: number[] = [];
  const maxDd: number[] = [];

  for (let k = 0; k < paths; k++) {
    const rng = mulberry32(pathSeed(seed, k));
    const a = createEvalAccount(params);
    for (let s = 0; s < sessions && !a.outcome; s++) {
      const day = pool.sessions[(rng() * N) | 0];
      accountOpenDay(a);
      let taken = 0;
      for (let m = 0; m < day.length; m++) {
        // One draw per card, always — the streams stay aligned between arms.
        const drawn = rng() < thin.p;
        if (!drawn || a.dayLocked) continue;
        if (thin.cap != null && taken >= thin.cap) continue;
        taken++;
        const i = day[m];
        const ev = accountTrade(a, arm.r[i], arm.peak[i], arm.trough[i]);
        if (ev === "pass" || ev === "bust") break;
      }
      if (a.outcome === "pass") passDays.push(s + 1);
      if (!a.outcome) accountCloseDay(a);
    }
    if (a.outcome === "pass") pass++;
    else if (a.outcome === "bust") bust++;
    trades += a.trades;
    dllDays += a.dllDays;
    maxDd.push(a.maxDrawdownUsd);
  }

  passDays.sort((x, y) => x - y);
  maxDd.sort((x, y) => x - y);
  return {
    pass: pass / paths,
    bust: bust / paths,
    timeout: (paths - pass - bust) / paths,
    daysToPass: {
      p25: nearestRank(passDays, 0.25),
      median: nearestRank(passDays, 0.5),
      p75: nearestRank(passDays, 0.75),
    },
    medianMaxDrawdownUsd: nearestRank(maxDd, 0.5) ?? 0,
    tradesPerPath: trades / paths,
    dllDaysPerPath: dllDays / paths,
    meanGrossR,
    meanNetR: meanGrossR - (params.dollarsPerR > 0 ? params.commissionUsd / params.dollarsPerR : 0),
  };
}

/**
 * Run the strategy and its zero-edge control. Pure and synchronous: the same
 * input and distribution always return the same numbers.
 */
export function runApexSim(inputIn: ApexSimInput, dist: EvidenceDist): ApexSimResult {
  const input: ApexSimInput = {
    ...inputIn,
    maxTradesPerDay: normalizeCap(inputIn.maxTradesPerDay),
    paths: Math.round(Math.min(SIM_MAX_PATHS, Math.max(SIM_MIN_PATHS, inputIn.paths || SIM_DEFAULT_PATHS))),
    seed: Number.isFinite(inputIn.seed) ? Math.trunc(inputIn.seed) : 1,
    horizonDays: Math.min(365, Math.max(1, inputIn.horizonDays || APEX_EVAL_DAYS)),
  };
  const refuse = (refusal: string, sizing: ApexContractSizing | null = null): ApexSimRefused => ({
    ok: false,
    input,
    refusal,
    sizing,
  });

  const rules = apexRulesFor(input.size);
  if (!rules) return refuse(`No Apex rule row for a $${fmtUsd(input.size)} account.`);
  if (!(input.symbol in CONTRACTS)) return refuse(`Unknown contract ${String(input.symbol)}.`);
  const sizing = apexContracts(rules, input.symbol, input.riskUsd, input.stopPts);
  if (!sizing.ok) return refuse(sizing.refusal ?? "Cannot size this trade.", sizing);
  if (!(input.tradesPerWeek > 0)) return refuse("Trades per week has to be above zero.", sizing);

  const pool = buildDayPool(dist);
  if (!pool.trades || !pool.sessions.length) {
    return refuse("The evidence distribution is empty — nothing to resample.", sizing);
  }

  const thin = calibrateThinning(pool, input.tradesPerWeek, input.maxTradesPerDay);
  const mean = effectiveMeanR(dist.r, pool, thin.p, thin.cap);
  const control = zeroEdgeControl(dist, mean);
  const sessions = sessionsInHorizon(input.horizonDays);
  const params: EvalAccountParams = {
    drawdown: input.drawdown,
    startUsd: rules.size,
    trailUsd: rules.drawdown.value,
    targetUsd: rules.profitTarget.value,
    dailyLossLimitUsd: input.drawdown === "EOD" ? rules.eodDailyLossLimit.value : null,
    dollarsPerR: sizing.riskUsd,
    commissionUsd: sizing.commissionUsd,
  };

  const strategy = runArm(dist, pool, thin, params, sessions, input.paths, input.seed, mean);
  const ctrl = runArm(control, pool, thin, params, sessions, input.paths, input.seed, 0);

  const warnings: string[] = [];
  if (thin.rateLimited) {
    warnings.push(
      `Asked for ${fmtNum(thin.requestedPerWeek, 1)} trades/week; the policy only has cards on ${fmtPct(pool.activeShare)} of sessions, so ${
        thin.cap != null ? `under a ${thin.cap}/day cap ` : ""
      }the most it supplies is ${fmtNum(thin.maxPerWeek, 2)}/week — simulated at that. More would need cards the measured policy never produced.`,
    );
  }
  const unconfirmed = [rules.profitTarget, rules.drawdown, rules.maxMicros, rules.eodDailyLossLimit].some(
    (f) => f.confidence !== "apex",
  );
  if (unconfirmed) {
    warnings.push(
      `The ${rules.label} target, drawdown, caps and DLL are secondary-source figures, unconfirmed on Apex's own pages — the arithmetic is only as good as they are.`,
    );
  }
  const riskShare = sizing.riskUsd / rules.drawdown.value;
  if (riskShare >= 0.25) {
    warnings.push(
      `One full stop-out ($${fmtUsd(sizing.riskUsd)}) is ${fmtPct(riskShare)} of the $${fmtUsd(rules.drawdown.value)} drawdown — ${Math.floor(1 / riskShare)} straight losses end it.`,
    );
  }
  if (params.dailyLossLimitUsd != null && sizing.riskUsd > params.dailyLossLimitUsd) {
    warnings.push(
      `A single full stop-out ($${fmtUsd(sizing.riskUsd)}) is larger than the $${fmtUsd(params.dailyLossLimitUsd)} daily loss limit — the DLL would liquidate the trade before its own stop.`,
    );
  }

  const { sessions: _s, posCount: _p, ...poolSummary } = pool;
  return {
    ok: true,
    input,
    rules,
    sizing,
    sessions,
    paths: input.paths,
    thinning: thin,
    pool: poolSummary,
    strategy,
    control: ctrl,
    warnings,
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 * What the panel must say about all of the above
 * ═════════════════════════════════════════════════════════════════════════ */

const signedR = (x: number) => `${x >= 0 ? "+" : "−"}${Math.abs(x).toFixed(2)}R`;

/**
 * The honesty line, worded by the evidence's own verdict rather than fixed
 * copy — if a rebuilt pack ever measures the band as a real edge (or a real
 * loss), this sentence changes with it instead of going stale.
 */
export function simHonestyLine(): string {
  const b = EVIDENCE.inBand.find((x) => x.key === "in") ?? null;
  if (!b || b.exp == null) {
    return "The in-band evidence bucket is missing from evidence-pack.json, so there is no measured distribution behind these numbers — treat every rate here as untested.";
  }
  const ci = b.lo != null && b.hi != null ? `day-clustered 95% interval ${signedR(b.lo)} to ${signedR(b.hi)}` : "no interval";
  const head = `Inside the stop band the measured mean is ${signedR(b.exp)} per card over ${b.n.toLocaleString("en-US")} fills (${ci}; ${b.verdict.toUpperCase()})`;
  if (b.verdict === "positive") {
    return `${head} — positive in both halves, but still a backtest: these rates are what that distribution does under Apex's rules, not a forecast of you passing. The zero-edge control shows how much of each rate is variance.`;
  }
  if (b.verdict === "negative") {
    return `${head} — it LOSES in both halves. These rates are arithmetic on a losing distribution; the control shows what breakeven would do instead.`;
  }
  return `${head} — not distinguishable from zero. Every rate here is arithmetic on a roughly breakeven distribution, not a forecast; the zero-edge control shows how much of it is variance.`;
}

/** The limits of the model, always printed with the numbers. */
export function simCaveats(res: ApexSimOk): string[] {
  const out = [
    `Before commission in the evidence; each trade here is charged the desk's round-turn ($${fmtUsd(res.sizing.commissionUsd)} for ${res.sizing.contracts} × ${res.sizing.symbol}, config.ts) — the desk's figure, not Apex's fee schedule.`,
    `${fmtPct(res.pool.preNyShare)} of these cards were decided before 09:00 ET (London / overnight). If you only sit NY AM you are sampling hours you do not trade.`,
    "Same-day trades run one after another; the evidence has overlapping MNQ and ES cards whose open P&L would add up. The daily cap and one-book-a-day keep this small, not zero.",
    "Cards held past 4:59 PM ET keep their measured exit; Apex would have flattened them at the close.",
    "Peak and trough order inside a trade follows the management rule (green trades dipped before they ran; red ones peaked before the stop). Only time-exits are ambiguous.",
    `A take-profit rests at the pass level, so an open peak that touches the target passes. ${res.sessions} sessions = ${res.input.horizonDays} calendar days.`,
    "The evaluation's threshold is assumed to trail forever (whether it locks is unconfirmed) — the conservative case.",
  ];
  // A daily cap keeps each day's FIRST cards, and those need not average what
  // every in-band card does. Printed when the gap is visible, because a
  // better-looking mean produced by the cap is a cut nobody has tested.
  if (res.thinning.cap != null && Math.abs(res.strategy.meanGrossR - res.pool.meanR) >= 0.005) {
    out.unshift(
      `Under the ${res.thinning.cap}/day cap the trades taken are each day's first ${res.thinning.cap}; they average ${signedR(res.strategy.meanGrossR)} against ${signedR(res.pool.meanR)} for every in-band card. Nothing has tested that cut for significance — read the gap as noise until something does.`,
    );
  }
  return out;
}

/* ═════════════════════════════════════════════════════════════════════════
 * Room to liquidation
 * ═════════════════════════════════════════════════════════════════════════ */

export type AccountPhase = "evaluation" | "pa";

/** A full stop-out must leave at least this share of the DRAWDOWN above the threshold. */
export const DEFAULT_ROOM_BUFFER = 0.25;

export interface RoomInput {
  phase: AccountPhase;
  drawdown: DrawdownType;
  size: ApexSize;
  /** Defaults to the account size. */
  startUsd?: number;
  /** Current balance, INCLUDING open P&L if a position is on. */
  balanceUsd: number;
  /** The liquidation threshold as the dashboard shows it. Wins when given. */
  thresholdUsd?: number | null;
  /** Intraday: the highest balance incl. open P&L. EOD: the highest end-of-day balance. */
  peakUsd?: number | null;
  symbol: ContractKey;
  stopPts: number;
  /** Fraction of the drawdown to keep between a full stop-out and the threshold. */
  bufferFrac?: number;
}

export interface DllInfo {
  /** null = not covered by the rules this module knows. */
  applies: boolean | null;
  amountUsd: number | null;
  confidence: RuleConfidence;
  note: string;
}

export interface RoomResult {
  rules: ApexSizeRules | null;
  thresholdUsd: number | null;
  thresholdSource: "entered" | "peak" | "start";
  /** PA only: the threshold has stopped at start + $100. */
  locked: boolean;
  roomUsd: number | null;
  bufferUsd: number;
  /** Room minus the buffer: the most one full stop-out may cost. */
  riskableUsd: number;
  perContractUsd: number;
  capContracts: number;
  capUnit: "micros" | "minis";
  /** Most contracts whose full stop-out keeps the buffer, within the account cap. */
  maxContracts: number;
  boundBy: "buffer" | "account-cap" | "none";
  /**
   * What the desk's own house rule would size (score.ts: at most 20% of the
   * remaining room on one trade). The buffer figure is a liquidation line,
   * not a recommendation — this is printed beside it so it never reads as one.
   */
  houseContracts: number;
  dll: DllInfo;
  refusal: string | null;
}

export function dllFor(phase: AccountPhase, drawdown: DrawdownType, size: ApexSize): DllInfo {
  const rules = apexRulesFor(size);
  if (phase === "evaluation") {
    if (drawdown === "Intraday") {
      return { applies: false, amountUsd: null, confidence: "apex", note: "Intraday evaluations have no daily loss limit." };
    }
    if (!rules) {
      return { applies: null, amountUsd: null, confidence: "assumed", note: "No rule row for this size." };
    }
    return {
      applies: true,
      amountUsd: rules.eodDailyLossLimit.value,
      confidence: rules.eodDailyLossLimit.confidence,
      note: "Hitting it liquidates and locks trading until 6 PM ET; the account survives. It also counts open P&L.",
    };
  }
  // The PA: the only confirmed row is rules.ts's 50K Intraday PA, whose DLL
  // is tier-based with the lowest tier encoded.
  const pa = drawdown === "Intraday" ? rulesFor("Apex", "funded", size) : null;
  if (pa && pa.dailyLossLimitUsd != null) {
    return {
      applies: true,
      amountUsd: pa.dailyLossLimitUsd,
      confidence: "apex",
      note: `Tier-based and rising with profit; the lowest tier is shown (propfirm/rules.ts, confirmed ${pa.confirmedOn}).`,
    };
  }
  return {
    applies: null,
    amountUsd: null,
    confidence: "assumed",
    note: "Not covered by the rules on file for this PA — read it off the Apex dashboard.",
  };
}

export function roomToLiquidation(input: RoomInput): RoomResult {
  const rules = apexRulesFor(input.size);
  const spec = CONTRACTS[input.symbol] ?? CONTRACTS.MNQ;
  const micro = input.symbol in CONTRACTS ? isMicro(input.symbol) : true;
  const perContractUsd = Math.max(0, input.stopPts) * spec.pointValue;
  const capContracts = rules ? (micro ? rules.maxMicros.value : rules.maxMinis.value) : 0;
  const capUnit = micro ? "micros" : "minis";
  const bufferFrac = Math.min(0.9, Math.max(0, input.bufferFrac ?? DEFAULT_ROOM_BUFFER));
  const dll = dllFor(input.phase, input.drawdown, input.size);
  const empty: RoomResult = {
    rules,
    thresholdUsd: null,
    thresholdSource: "start",
    locked: false,
    roomUsd: null,
    bufferUsd: 0,
    riskableUsd: 0,
    perContractUsd,
    capContracts,
    capUnit,
    maxContracts: 0,
    boundBy: "none",
    houseContracts: 0,
    dll,
    refusal: null,
  };
  if (!rules) return { ...empty, refusal: `No Apex rule row for a $${fmtUsd(input.size)} account.` };
  if (!(input.balanceUsd > 0)) return { ...empty, refusal: "Enter the current balance from the dashboard." };
  if (!(perContractUsd > 0)) return { ...empty, refusal: "The stop has to be a positive number of points." };

  const trail = rules.drawdown.value;
  const start = input.startUsd ?? rules.size;
  const bufferUsd = bufferFrac * trail;

  let thresholdUsd: number;
  let thresholdSource: RoomResult["thresholdSource"];
  let locked = false;
  if (input.thresholdUsd != null && Number.isFinite(input.thresholdUsd) && input.thresholdUsd > 0) {
    thresholdUsd = input.thresholdUsd;
    thresholdSource = "entered";
  } else if (input.peakUsd != null && Number.isFinite(input.peakUsd) && input.peakUsd > 0) {
    if (input.drawdown === "Intraday" && input.peakUsd < input.balanceUsd) {
      return {
        ...empty,
        bufferUsd,
        refusal:
          "The Intraday peak includes open P&L, so it cannot sit below the current balance — one of the two is mistyped.",
      };
    }
    const high = Math.max(start, input.peakUsd);
    if (input.phase === "pa" && high >= start + trail + PA_LOCK_OFFSET_USD) {
      thresholdUsd = start + PA_LOCK_OFFSET_USD;
      locked = true;
    } else {
      thresholdUsd = high - trail;
    }
    thresholdSource = "peak";
  } else {
    thresholdUsd = start - trail;
    thresholdSource = "start";
  }

  const roomUsd = input.balanceUsd - thresholdUsd;
  const base = { ...empty, thresholdUsd, thresholdSource, locked, roomUsd, bufferUsd };
  if (roomUsd <= 0) {
    return { ...base, refusal: `The balance is at or below the $${fmtUsd(thresholdUsd)} threshold — the account is already on the line.` };
  }

  const riskableUsd = Math.max(0, roomUsd - bufferUsd);
  const byBuffer = Math.floor(riskableUsd / perContractUsd + 1e-9);
  const maxContracts = Math.max(0, Math.min(byBuffer, capContracts));
  const boundBy: RoomResult["boundBy"] = maxContracts < 1 ? "none" : byBuffer > capContracts ? "account-cap" : "buffer";
  const houseContracts = Math.max(
    0,
    Math.min(capContracts, Math.floor((roomUsd * MAX_ROOM_FRACTION_PER_TRADE) / perContractUsd + 1e-9)),
  );
  const refusal =
    maxContracts < 1
      ? `One ${input.symbol} at ${input.stopPts} pt risks $${fmtUsd(perContractUsd)}, but only $${fmtUsd(riskableUsd)} of the $${fmtUsd(roomUsd)} room sits above the $${fmtUsd(bufferUsd)} buffer.`
      : null;

  return { ...base, riskableUsd, maxContracts, boundBy, houseContracts, refusal };
}

/* ─── formatting (plain ASCII digits; the panel adds colour) ─────────────── */

function fmtUsd(x: number): string {
  return Math.round(x).toLocaleString("en-US");
}

function fmtNum(x: number, dp: number): string {
  return x.toFixed(dp);
}

function fmtPct(x: number): string {
  return `${Math.round(x * 100)}%`;
}
