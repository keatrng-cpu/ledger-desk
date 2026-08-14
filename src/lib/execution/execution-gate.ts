/**
 * ROADMAP E2 — can this desk send a real order right now, and should it?
 *
 * TWO DIFFERENT QUESTIONS, DELIBERATELY SEPARATED.
 *
 * 1. READINESS (advisory). The ROADMAP's Phase E gate — >=100 mirrored paper
 *    trades, positive live expectancy, >=2 weeks of boring shadow diff — is
 *    computed here from real Postgres and REPORTED. On 2026-08-13 the owner
 *    made an explicit decision to take that judgement manually rather than
 *    have a trade counter make it, so these numbers inform the call instead
 *    of blocking it. They are still measured, because "I decided to go early"
 *    and "I had no idea where I stood" are very different things, and only
 *    the first one is a decision.
 *
 * 2. PERMISSION (blocking). What actually stops an order. These exist to
 *    prevent ACCIDENTS, not to second-guess the owner:
 *      - the kill switch is off, or credentials are absent
 *      - the environment is live but the live arm was never thrown
 *      - the adapter's own daily loss limit has tripped
 *
 * WHY THE SPLIT MATTERS. A gate that blocks on judgement gets bypassed, and
 * then the accident protections get bypassed with it because they lived in
 * the same switch. Keeping them apart means the owner can move the judgement
 * line whenever they like WITHOUT ever weakening the circuit breaker.
 *
 * WHAT IS NOT BYPASSABLE HERE: the daily loss limit. A circuit breaker is not
 * a gate — it fires after the decision has already been made and gone wrong,
 * which is exactly when discretion is worth least.
 */

import { getSql } from "@/lib/db";
import { APLUS_RULES } from "@/lib/aplus/config";
import { tradingDayStart } from "@/lib/journal/risk";

/** ROADMAP Phase E targets. Reported, not enforced — see the header. */
export const ROADMAP_PAPER_TARGET = 100;
export const ROADMAP_SHADOW_DAYS = 14;

/** Hard adapter-level stop. Not overridable from the UI, by design. */
export const ADAPTER_DAILY_LOSS_PCT = APLUS_RULES.dailyLossLimitPct;

export type ExecutionEnv = "demo" | "live";

export interface ExecutionReadiness {
  /* ---- advisory: informs the manual go-live decision ---- */
  paperTrades: number;
  paperTarget: number;
  /** Mean R over closed LIVE trades. Null when there are none. */
  liveExpectancyR: number | null;
  liveTrades: number;
  /** Days since the first shadow order was recorded. */
  shadowDays: number;
  /** True when the ROADMAP's original four-part gate would have passed. */
  roadmapReady: boolean;
  roadmapUnmet: string[];

  /* ---- blocking: what actually stops a send ---- */
  env: ExecutionEnv;
  /** TRADOVATE_ENABLED — the master kill switch. */
  enabled: boolean;
  /** TRADOVATE_LIVE_ARMED — the second, independent switch for live only. */
  liveArmed: boolean;
  credentialsPresent: boolean;
  /** Adapter circuit breaker: today's realized live loss vs the limit. */
  dayLossPct: number;
  dailyLossTripped: boolean;
  /** The answer. */
  canSend: boolean;
  blockers: string[];
}

function env(name: string): string | undefined {
  const v = typeof process !== "undefined" ? process.env[name] : undefined;
  return v && v.trim() ? v.trim() : undefined;
}

/** Live requires an EXPLICIT opt-in. Anything else — including junk — is demo. */
export function executionEnv(): ExecutionEnv {
  return env("TRADOVATE_ENV")?.toLowerCase() === "live" ? "live" : "demo";
}

/**
 * Every credential the adapter needs, by NAME only. Values are never read
 * into a return value, logged, or surfaced — this reports presence.
 */
export const REQUIRED_CREDENTIALS = [
  "TRADOVATE_USERNAME",
  "TRADOVATE_PASSWORD",
  "TRADOVATE_APP_ID",
  "TRADOVATE_CID",
  "TRADOVATE_SECRET",
] as const;

export function missingCredentials(): string[] {
  return REQUIRED_CREDENTIALS.filter((n) => !env(n));
}

/**
 * Today's realized LIVE loss as a fraction of equity, and whether that trips
 * the adapter breaker. Reads closed live trades since the CME 18:00 ET roll,
 * the same boundary the risk governor uses.
 */
async function dayLoss(userId: string): Promise<{ pct: number; tripped: boolean }> {
  try {
    const sql = await getSql();
    const since = tradingDayStart(new Date());
    const rows = await sql.query<{ pnl: number | null; equity: number | null }>(
      `select coalesce(sum(t.pnl), 0) as pnl,
              (select equity from desk_settings where user_id = $1) as equity
         from desk_trades t
        where t.user_id = $1 and t.mode = 'live' and t.status = 'closed'
          and t.closed_at >= $2::timestamptz`,
      [userId, since.toISOString()],
    );
    const pnl = Number(rows[0]?.pnl ?? 0);
    const equity = Number(rows[0]?.equity ?? APLUS_RULES.accountEquity);
    if (!(equity > 0)) return { pct: 0, tripped: false };
    const pct = pnl < 0 ? Math.abs(pnl) / equity : 0;
    return { pct, tripped: pct >= ADAPTER_DAILY_LOSS_PCT };
  } catch {
    // If the breaker cannot be evaluated, it is TRIPPED. An adapter that
    // sends orders when it cannot measure its own losses is the failure mode
    // this whole file exists to prevent.
    return { pct: 0, tripped: true };
  }
}

/* ------------------------------------------------------------------ */
/* Apex Trader Funding — per-account trailing-drawdown breaker         */
/* ------------------------------------------------------------------ */

/**
 * Apex's own rule, confirmed against their published docs (2026-08-14):
 * the funded/eval account phase gates whether automation is even LEGAL to
 * run, independent of anything technical. Full automation is explicitly
 * PROHIBITED on a funded Apex Performance Account — bots, algorithms and AI
 * trading are banned there; only human-supervised semi-automated trading is
 * allowed. It IS explicitly permitted during the evaluation phase.
 *
 * This is not a risk preference — it is set once, deliberately, outside the
 * app, by whoever knows which phase the account is actually in. Getting it
 * wrong risks the account being terminated for a rules violation, not just
 * losing money.
 */
export type ApexAccountPhase = "evaluation" | "funded" | "none";

export function apexAccountPhase(): ApexAccountPhase {
  const raw = env("APEX_ACCOUNT_PHASE")?.toLowerCase();
  if (raw === "evaluation" || raw === "funded") return raw;
  return "none"; // unset -> autofire refuses to run at all, see apex-autofire.ts
}

/**
 * $ trail per Apex product, confirmed for the 50K "Tradovate Intraday
 * Trail" evaluation (the product on APEX-644704-01..05): starting threshold
 * $47,500 on a $50,000 balance = a $2,500 trail. On Tradovate specifically,
 * this NEVER stops trailing during the eval (unlike Rithmic evals, which
 * lock at the profit target) — touching the threshold at any moment fails
 * the account immediately.
 *
 * This map only has the one confirmed size. An account whose size is not
 * in here fails closed (see accountTrailUsd below) rather than guess a
 * number for an unconfirmed product.
 */
const APEX_TRAIL_BY_SIZE_USD: Record<number, number> = {
  50_000: 2_500,
};

/**
 * Safety margin below the real published trail. This breaker is DEFENSE IN
 * DEPTH behind Tradovate/Apex's own platform-level risk engine (the same
 * one that, since March 2026, rejects any order without an attached
 * bracket) — it is not the only thing standing between a bug and a blown
 * account, but it must never be the LAST line either. Tripping at 90% of
 * the real trail means a modest error in this file's own equity math still
 * trips before the account's actual threshold, never after.
 */
const APEX_SAFETY_MARGIN = 0.9;

export interface ApexAccountRisk {
  accountId: number;
  accountName: string | null;
  /** Current equity: broker cash balance + mark-to-market on open positions. */
  equity: number | null;
  peakEquity: number | null;
  /** equity - (peak * APEX_SAFETY_MARGIN of the real trail). */
  threshold: number | null;
  tripped: boolean;
  reason: string | null;
}

function accountTrailUsd(startingBalanceUsd: number): number | null {
  return APEX_TRAIL_BY_SIZE_USD[startingBalanceUsd] ?? null;
}

/**
 * Per-account Apex trailing-drawdown check. Fails CLOSED on every ambiguity
 * — an unconfirmed cash-balance response shape, a network error, an unknown
 * account size — reads as tripped, never as healthy. This is the correct
 * default for a breaker: if it cannot prove the account is safe, it must
 * not certify it is.
 *
 * *** NOT YET VERIFIED AGAINST A REAL CONNECTION *** — same status as the
 * live-tick gateway. `/cashBalance/getCashBalanceSnapshot` is Tradovate's
 * documented-in-community-references endpoint for a real-time balance
 * snapshot; the exact response shape has not been confirmed against a live
 * account. Because this fails closed, a wrong shape means autofire simply
 * never sends (safe, if annoying) rather than wrongly certifying a tripped
 * account as healthy — verify this against Tradovate's API reference and a
 * real demo account before relying on it to actually gate anything.
 */
export async function apexAccountRisk(params: {
  env: ExecutionEnv;
  accountId: number;
  accountName: string | null;
  userId: string;
  startingBalanceUsd: number;
  /** Mark-to-market inputs for open positions on this account, if any. */
  openPositions: { symbol: string; netPos: number; pointValue: number; currentPrice: number; avgPrice: number }[];
}): Promise<ApexAccountRisk> {
  const base: Omit<ApexAccountRisk, "tripped" | "reason"> = {
    accountId: params.accountId,
    accountName: params.accountName,
    equity: null,
    peakEquity: null,
    threshold: null,
  };

  const trailUsd = accountTrailUsd(params.startingBalanceUsd);
  if (trailUsd == null) {
    return {
      ...base,
      tripped: true,
      reason: `no confirmed Apex trail amount for a $${params.startingBalanceUsd.toLocaleString()} account — refusing rather than guessing`,
    };
  }

  let cashBalance: number;
  try {
    const { tradovateRequest } = await import("./tradovate-client");
    const res = await tradovateRequest<{ cashBalance?: number; netLiqValue?: number }>(
      "/cashBalance/getCashBalanceSnapshot",
      { method: "POST", body: JSON.stringify({ accountId: params.accountId }) },
      params.env,
    );
    const value = res.netLiqValue ?? res.cashBalance;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      return { ...base, tripped: true, reason: "cash balance response had no usable numeric value" };
    }
    cashBalance = value;
  } catch (e) {
    return {
      ...base,
      tripped: true,
      reason: `could not read cash balance: ${e instanceof Error ? e.message : "unknown error"}`,
    };
  }

  /**
   * netPos is signed (positive = long, negative = short), so this one
   * expression is correct for both sides without a direction branch: a
   * short (negative netPos) priced against a rally (currentPrice >
   * avgPrice) multiplies negative x positive = a loss, correctly; the same
   * short against a selloff multiplies negative x negative = a gain,
   * correctly.
   */
  const unrealized = params.openPositions.reduce(
    (sum, p) => sum + p.netPos * p.pointValue * (p.currentPrice - p.avgPrice),
    0,
  );
  const equity = cashBalance + unrealized;

  let peakEquity = equity;
  try {
    const sql = await getSql();
    const rows = await sql.query<{ peak_equity: number | string }>(
      `select peak_equity from apex_account_peak where user_id = $1 and account_id = $2`,
      [params.userId, String(params.accountId)],
    );
    const stored = rows[0] ? Number(rows[0].peak_equity) : null;
    peakEquity = stored != null ? Math.max(stored, equity) : equity;
    await sql.query(
      `insert into apex_account_peak (user_id, account_id, account_name, peak_equity, updated_at)
       values ($1, $2, $3, $4, now())
       on conflict (user_id, account_id) do update
         set peak_equity = excluded.peak_equity, account_name = excluded.account_name, updated_at = now()`,
      [params.userId, String(params.accountId), params.accountName, peakEquity],
    );
  } catch {
    // Cannot persist/read the peak -> cannot prove the account is above its
    // trail. Fail closed rather than trade on an un-trackable peak.
    return { ...base, equity, tripped: true, reason: "could not read/update peak equity in Postgres" };
  }

  const threshold = peakEquity - trailUsd * APEX_SAFETY_MARGIN;
  const tripped = equity <= threshold;

  return {
    accountId: params.accountId,
    accountName: params.accountName,
    equity,
    peakEquity,
    threshold,
    tripped,
    reason: tripped
      ? `equity $${equity.toFixed(2)} <= threshold $${threshold.toFixed(2)} (peak $${peakEquity.toFixed(2)} - ${(trailUsd * APEX_SAFETY_MARGIN).toFixed(0)} margin-adjusted trail)`
      : null,
  };
}

export async function readExecutionReadiness(
  userId: string,
): Promise<ExecutionReadiness> {
  const environment = executionEnv();
  const enabled = env("TRADOVATE_ENABLED")?.toLowerCase() === "true";
  const liveArmed = env("TRADOVATE_LIVE_ARMED")?.toLowerCase() === "true";
  const missing = missingCredentials();
  const credentialsPresent = missing.length === 0;

  let paperTrades = 0;
  let liveTrades = 0;
  let liveExpectancyR: number | null = null;
  let shadowDays = 0;

  try {
    const sql = await getSql();
    const [counts, shadow] = await Promise.all([
      sql.query<{ mode: string; n: number; avg_r: number | null }>(
        `select mode, count(*)::int as n, avg(r) as avg_r
           from desk_trades
          where user_id = $1 and status = 'closed'
          group by mode`,
        [userId],
      ),
      sql.query<{ first_ts: string | Date | null }>(
        `select min(ts) as first_ts from shadow_orders where user_id = $1`,
        [userId],
      ),
    ]);
    for (const row of counts) {
      if (row.mode === "paper") paperTrades = Number(row.n);
      if (row.mode === "live") {
        liveTrades = Number(row.n);
        liveExpectancyR = row.avg_r == null ? null : Number(row.avg_r);
      }
    }
    const first = shadow[0]?.first_ts;
    if (first) {
      shadowDays = Math.floor(
        (Date.now() - new Date(first).getTime()) / 86_400_000,
      );
    }
  } catch {
    // Readiness is advisory; failing to read it must not imply readiness.
    paperTrades = 0;
  }

  const roadmapUnmet: string[] = [];
  if (paperTrades < ROADMAP_PAPER_TARGET) {
    roadmapUnmet.push(
      `${paperTrades}/${ROADMAP_PAPER_TARGET} mirrored paper trades`,
    );
  }
  if (liveExpectancyR == null || liveExpectancyR <= 0) {
    roadmapUnmet.push(
      liveTrades === 0
        ? "no closed live trades — live expectancy unmeasured"
        : `live expectancy ${liveExpectancyR?.toFixed(2)}R not positive`,
    );
  }
  if (shadowDays < ROADMAP_SHADOW_DAYS) {
    roadmapUnmet.push(`shadow mode ${shadowDays}/${ROADMAP_SHADOW_DAYS} days`);
  }

  const { pct: dayLossPct, tripped: dailyLossTripped } = await dayLoss(userId);

  const blockers: string[] = [];
  if (!enabled) blockers.push("TRADOVATE_ENABLED is not true (kill switch)");
  if (!credentialsPresent) {
    blockers.push(`missing credentials: ${missing.join(", ")}`);
  }
  if (environment === "live" && !liveArmed) {
    blockers.push("TRADOVATE_LIVE_ARMED is not true (live arm not thrown)");
  }
  if (dailyLossTripped) {
    blockers.push(
      `adapter daily loss breaker: ${(dayLossPct * 100).toFixed(2)}% >= ${(ADAPTER_DAILY_LOSS_PCT * 100).toFixed(2)}%`,
    );
  }

  return {
    paperTrades,
    paperTarget: ROADMAP_PAPER_TARGET,
    liveExpectancyR,
    liveTrades,
    shadowDays,
    roadmapReady: roadmapUnmet.length === 0,
    roadmapUnmet,
    env: environment,
    enabled,
    liveArmed,
    credentialsPresent,
    dayLossPct,
    dailyLossTripped,
    canSend: blockers.length === 0,
    blockers,
  };
}
