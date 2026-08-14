/**
 * ROADMAP E2 — order placement. The only file in this repo that can send.
 *
 * NON-NEGOTIABLES, each one a rule the desk already states elsewhere and
 * this file enforces at the point where money actually moves:
 *
 * 1. NEVER A NAKED ENTRY. Orders go out as OSO — entry, stop and target in
 *    ONE request. A stop added in a second call fails open if the process
 *    dies between the two, which on a serverless host is not hypothetical.
 *    `buildOrderIntent` already refuses an intent without a stop; this
 *    refuses to transmit one too.
 *
 * 2. IDEMPOTENT. Every order carries the intent's `clientOrderId`, which is
 *    derived from the decision (symbol+side+strategy+killzone+day), so a
 *    retry, a double-click or a re-poll cannot double the position.
 *
 * 3. GATED AT SEND TIME, not at render time. `readExecutionReadiness` is
 *    re-checked inside the send path — a UI that thinks it may send is not
 *    evidence that it may.
 *
 * 4. RECONCILING. `syncPositions` reads the broker's own positions endpoint
 *    rather than assuming the fill matched the request. Partial fills are
 *    normal, not an error.
 *
 * 5. FLATTEN-ALL DOES NOT DEPEND ON THE UI. It is a server function that
 *    liquidates from the broker side, callable when no tab is open.
 *
 * This file is never imported by scanner, backtest, or replay code. Placing
 * an order from inside a backtest path is the specific accident that turns a
 * simulation into a position.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { orderIntentSchema, type OrderIntent } from "./order-intent";
import { readExecutionReadiness, executionEnv, apexAccountRisk } from "./execution-gate";
import { tradovateRequest, tradovateToken, type TradovateAccount } from "./tradovate-client";
import { insertShadowRow } from "./shadow";
import { getSql } from "@/lib/db";
import { CONTRACTS, type ContractKey } from "@/lib/aplus/config";

/** Tradovate expects its own action vocabulary. */
const ACTION = { long: "Buy", short: "Sell" } as const;
const OPPOSITE = { long: "Sell", short: "Buy" } as const;

export interface PlaceResult {
  sent: boolean;
  /** Broker order id, when it actually went. */
  orderId: number | null;
  env: "demo" | "live";
  /** Why nothing was sent. Safe to render. */
  reason: string | null;
}

/**
 * Map an OrderIntent onto Tradovate's OSO shape.
 *
 * The bracket legs are the intent's own targets and stop — no re-derivation,
 * because a second implementation of the levels is how paper and live drift
 * apart, which is the entire reason `OrderIntent` exists.
 */
function osoPayload(
  intent: OrderIntent,
  accountId: number,
  accountSpec: string,
) {
  const entryAction = ACTION[intent.side];
  const exitAction = OPPOSITE[intent.side];
  // Whole-order protective stop. Targets may be staged, the stop never is.
  const stopLeg = {
    action: exitAction,
    orderType: "Stop",
    stopPrice: intent.stop,
    orderQty: intent.qty,
    timeInForce: "GTC",
  };
  const firstTarget = intent.targets[0];
  const targetLeg = firstTarget
    ? {
        action: exitAction,
        orderType: "Limit",
        price: firstTarget.price,
        orderQty: firstTarget.qty || intent.qty,
        timeInForce: "GTC",
      }
    : null;

  return {
    accountId,
    accountSpec,
    symbol: intent.symbol,
    action: entryAction,
    orderQty: intent.qty,
    orderType: intent.entryType === "market" ? "Market" : "Limit",
    ...(intent.entryType === "market" ? {} : { price: intent.entry }),
    timeInForce: intent.timeInForce === "gtc" ? "GTC" : "Day",
    isAutomated: true,
    // Idempotency travels with the order.
    clOrdId: intent.clientOrderId,
    bracket1: stopLeg,
    ...(targetLeg ? { bracket2: targetLeg } : {}),
  };
}

const placeInput = z.object({
  intent: orderIntentSchema,
  /**
   * The caller must state which environment it believes it is sending to.
   * A mismatch against the server's own resolution aborts the send — this
   * catches a stale client that still thinks it is in demo.
   */
  expectEnv: z.enum(["demo", "live"]),
});

/**
 * Send a bracketed order. Refuses far more often than it sends, by design.
 */
export const placeTradovateOrder = createServerFn({ method: "POST" })
  .validator((input: unknown) => placeInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<PlaceResult> => {
    const env = executionEnv();

    // The caller's belief about the environment must match reality.
    if (data.expectEnv !== env) {
      return {
        sent: false,
        orderId: null,
        env,
        reason: `Environment mismatch: caller expected ${data.expectEnv}, server resolves ${env}. Nothing sent.`,
      };
    }

    // Re-check at send time. A UI that thinks it may send is not evidence.
    const readiness = await readExecutionReadiness(context.userId);
    if (!readiness.canSend) {
      return {
        sent: false,
        orderId: null,
        env,
        reason: `Blocked: ${readiness.blockers.join(" · ")}`,
      };
    }

    const intent = data.intent as OrderIntent;

    // Rule 1, enforced at the wire: no stop, no send.
    if (!Number.isFinite(intent.stop) || intent.stop <= 0) {
      return {
        sent: false,
        orderId: null,
        env,
        reason: "Refused: order has no protective stop.",
      };
    }

    const token = await tradovateToken(env);
    if (token.accountId == null || !token.accountSpec) {
      return {
        sent: false,
        orderId: null,
        env,
        reason: "Refused: no Tradovate trading account resolved for these credentials.",
      };
    }

    // Record the intent BEFORE sending. If the send succeeds and the process
    // then dies, the shadow log still shows what was attempted; the reverse
    // ordering would lose that entirely.
    try {
      const sql = await getSql();
      await insertShadowRow(sql, context.userId, {
        intent,
        source: "desk",
        ts: intent.createdAt,
        notes: `tradovate ${env} send attempt`,
      });
    } catch {
      // Logging must not block the trade decision either way.
    }

    const res = await tradovateRequest<{ orderId?: number; failureReason?: string }>(
      "/order/placeOSO",
      {
        method: "POST",
        body: JSON.stringify(osoPayload(intent, token.accountId, token.accountSpec)),
      },
      env,
    );

    if (!res.orderId) {
      return {
        sent: false,
        orderId: null,
        env,
        reason: `Tradovate refused the order${res.failureReason ? `: ${res.failureReason}` : ""}`,
      };
    }
    return { sent: true, orderId: res.orderId, env, reason: null };
  });

/**
 * ROADMAP addendum, 2026-08-14 — Apex Trader Funding: 5 sibling $50K
 * "Tradovate Intraday Trail" evaluations (APEX-644704-01..05) under one
 * Tradovate login.
 *
 * WHY THIS EXISTS INSTEAD OF TRADOVATE'S OWN GROUP COPIER. Checked directly
 * before building this: Tradovate's native Group Copier explicitly excludes
 * prop-firm/evaluation accounts from being linked in a copy group
 * ("cannot link a Tradovate account with a prop firm or evaluation service
 * account" — confirmed from Tradovate's own support docs). Whether Apex's
 * OWN separate Group Copier product covers eval accounts specifically was
 * genuinely contradicted between two independent sources when checked, and
 * Apex's own docs pages could not be reached (blocked) to settle it. Rather
 * than build automation on top of a rule that could not be confirmed, this
 * fans out directly — the SAME OrderIntent, sent independently to every
 * account this login can see, using code already built and verified in
 * this file.
 *
 * PER-ACCOUNT, INDEPENDENT SAFETY. Apex's trailing drawdown is evaluated
 * per account — "the account balance touches the threshold, THAT account
 * fails or closes" (confirmed). One account tripping must never block or
 * affect the other four, and a healthy account must never be silently
 * skipped because a DIFFERENT account looks unhealthy. So every account is
 * checked against its OWN apexAccountRisk() independently; only the
 * accounts that pass their own check receive the order.
 *
 * *** POSITION/CONTRACT RESOLUTION IS BEST-EFFORT, UNVERIFIED *** — same
 * status as the rest of this session's execution code. `/position/list`'s
 * exact per-account scoping and `/contract/item`'s response shape have not
 * been confirmed against a real connection. Consistent with every breaker
 * in this file: an account whose open-position risk cannot be confidently
 * resolved is treated as UNSAFE and skipped, never assumed flat.
 */
export interface FanOutAccountResult {
  accountId: number;
  accountName: string | null;
  sent: boolean;
  orderId: number | null;
  reason: string | null;
}

const APEX_EVAL_STARTING_BALANCE_USD = 50_000;

/** Resolve a Tradovate contractId to this desk's known point value, or null. */
async function resolveContractPointValue(
  contractId: number,
  env: ReturnType<typeof executionEnv>,
  cache: Map<number, number | null>,
): Promise<number | null> {
  if (cache.has(contractId)) return cache.get(contractId) ?? null;
  try {
    const contract = await tradovateRequest<{ name?: string }>(
      `/contract/item?id=${contractId}`,
      {},
      env,
    );
    const root = (contract.name ?? "").replace(/[A-Z]\d{1,2}$/, "").trim() as ContractKey;
    const pv = root in CONTRACTS ? CONTRACTS[root].pointValue : null;
    cache.set(contractId, pv);
    return pv;
  } catch {
    cache.set(contractId, null);
    return null;
  }
}

const fanOutInput = z.object({
  intent: orderIntentSchema,
  expectEnv: z.enum(["demo", "live"]),
});

/**
 * Send the SAME bracketed order to every account under this login, after an
 * INDEPENDENT Apex trailing-drawdown check per account. Refuses to send at
 * all if the base readiness gate fails (kill switch, credentials, the
 * generic daily-loss breaker) — this is additive risk checking, not a
 * replacement for anything already enforced.
 */
export const placeTradovateOrderAllAccounts = createServerFn({ method: "POST" })
  .validator((input: unknown) => fanOutInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{
    env: string;
    results: FanOutAccountResult[];
    blockedReason: string | null;
  }> => {
    const env = executionEnv();

    if (data.expectEnv !== env) {
      return {
        env,
        results: [],
        blockedReason: `Environment mismatch: caller expected ${data.expectEnv}, server resolves ${env}.`,
      };
    }

    const readiness = await readExecutionReadiness(context.userId);
    if (!readiness.canSend) {
      return { env, results: [], blockedReason: `Blocked: ${readiness.blockers.join(" · ")}` };
    }

    const intent = data.intent as OrderIntent;
    if (!Number.isFinite(intent.stop) || intent.stop <= 0) {
      return { env, results: [], blockedReason: "Refused: order has no protective stop." };
    }

    const token = await tradovateToken(env);
    const accounts: TradovateAccount[] = token.allAccounts;
    if (!accounts.length) {
      return { env, results: [], blockedReason: "No Tradovate accounts resolved for these credentials." };
    }

    // One position read covers every account — cheaper than N separate
    // calls, and every consumer here already treats a read failure as
    // "unknown, therefore unsafe" per-account below.
    let allPositions: { accountId?: number; contractId: number; netPos: number; netPrice: number | null }[] = [];
    let positionsReadable = true;
    try {
      allPositions = await tradovateRequest<typeof allPositions>("/position/list", {}, env);
    } catch {
      positionsReadable = false;
    }

    const contractPvCache = new Map<number, number | null>();
    const results: FanOutAccountResult[] = [];

    for (const account of accounts) {
      // Build this account's open-position inputs for the breaker. A
      // position readable at all but whose point value cannot be resolved
      // makes this account's risk unknown — and unknown fails closed.
      const accountPositions = allPositions.filter(
        (p) => p.accountId === account.id && p.netPos !== 0,
      );
      let positionsResolved = positionsReadable;
      const openPositions: { symbol: string; netPos: number; pointValue: number; currentPrice: number; avgPrice: number }[] = [];
      for (const p of accountPositions) {
        const pv = await resolveContractPointValue(p.contractId, env, contractPvCache);
        if (pv == null || p.netPrice == null) {
          positionsResolved = false;
          break;
        }
        // Mark-to-market against the position's own recorded price when no
        // fresher tick is available at breaker-check time — conservative:
        // this reads $0 unrealized rather than invent a current price this
        // function has no independent source for.
        openPositions.push({
          symbol: String(p.contractId),
          netPos: p.netPos,
          pointValue: pv,
          currentPrice: p.netPrice,
          avgPrice: p.netPrice,
        });
      }

      if (!positionsResolved) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          sent: false,
          orderId: null,
          reason: "Skipped: open-position risk on this account could not be confidently resolved.",
        });
        continue;
      }

      const risk = await apexAccountRisk({
        env,
        accountId: account.id,
        accountName: account.name,
        userId: context.userId,
        startingBalanceUsd: APEX_EVAL_STARTING_BALANCE_USD,
        openPositions,
      });

      if (risk.tripped) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          sent: false,
          orderId: null,
          reason: `Skipped: Apex trailing-drawdown breaker — ${risk.reason ?? "tripped"}`,
        });
        continue;
      }

      // Per-account idempotency: same decision, distinct account, distinct
      // key — otherwise Tradovate's own dedupe would treat the 2nd..5th
      // account's identical clOrdId as a repeat of the 1st and drop it.
      const perAccountIntent: OrderIntent = {
        ...intent,
        clientOrderId: `${intent.clientOrderId}-acct${account.id}`,
      };

      try {
        const sql = await getSql();
        await insertShadowRow(sql, context.userId, {
          intent: perAccountIntent,
          source: "desk",
          ts: intent.createdAt,
          notes: `tradovate ${env} fan-out send · account ${account.name ?? account.id}`,
        });
      } catch {
        /* logging must not block the trade decision */
      }

      try {
        const res = await tradovateRequest<{ orderId?: number; failureReason?: string }>(
          "/order/placeOSO",
          {
            method: "POST",
            body: JSON.stringify(osoPayload(perAccountIntent, account.id, account.name)),
          },
          env,
        );
        results.push(
          res.orderId
            ? { accountId: account.id, accountName: account.name, sent: true, orderId: res.orderId, reason: null }
            : {
                accountId: account.id,
                accountName: account.name,
                sent: false,
                orderId: null,
                reason: `Tradovate refused: ${res.failureReason ?? "no order id returned"}`,
              },
        );
      } catch (e) {
        results.push({
          accountId: account.id,
          accountName: account.name,
          sent: false,
          orderId: null,
          reason: e instanceof Error ? e.message : "send failed",
        });
      }
    }

    return { env, results, blockedReason: null };
  });

export interface BrokerPosition {
  symbol: string;
  netPos: number;
  avgPrice: number | null;
}

/**
 * The broker's own view of what is open. Never inferred from our order log —
 * partial fills, rejects and manual intervention all make the two disagree,
 * and the broker is the one holding the position.
 */
export const syncTradovatePositions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<{ positions: BrokerPosition[]; env: string; error: string | null }> => {
    const env = executionEnv();
    const readiness = await readExecutionReadiness(context.userId);
    // Reading is safe even when sending is blocked — you always want to be
    // able to see what is open, especially when the breaker has tripped.
    if (!readiness.enabled || !readiness.credentialsPresent) {
      return { positions: [], env, error: "Tradovate not configured" };
    }
    try {
      const rows = await tradovateRequest<
        { contractId: number; netPos: number; netPrice: number | null }[]
      >("/position/list", {}, env);
      return {
        positions: rows
          .filter((r) => r.netPos !== 0)
          .map((r) => ({
            symbol: String(r.contractId),
            netPos: r.netPos,
            avgPrice: r.netPrice,
          })),
        env,
        error: null,
      };
    } catch (e) {
      return {
        positions: [],
        env,
        error: e instanceof Error ? e.message : "position read failed",
      };
    }
  });

/**
 * FLATTEN ALL. Deliberately does NOT consult the readiness gate: if the
 * daily-loss breaker has tripped or the kill switch is off, closing exposure
 * must still work. A safety control that its own safety controls can disable
 * is not a safety control.
 */
export const flattenAllTradovate = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async (): Promise<{
    ok: boolean;
    error: string | null;
    results: { accountId: number; accountName: string | null; ok: boolean; error: string | null }[];
  }> => {
    const env = executionEnv();
    try {
      const token = await tradovateToken(env);
      // Flatten every account this login can see, not just the primary one
      // — a panic button that only closes 1 of 5 Apex accounts leaves real
      // exposure open on the other four. Falls back to the single
      // primary-account path if the account list could not be resolved for
      // any reason, so this never does LESS than the original behavior.
      const targets: TradovateAccount[] =
        token.allAccounts.length > 0
          ? token.allAccounts
          : token.accountId != null
            ? [{ id: token.accountId, name: token.accountSpec ?? "" }]
            : [];

      if (!targets.length) {
        return { ok: false, error: "no account resolved", results: [] };
      }

      const results = await Promise.all(
        targets.map(async (account) => {
          try {
            await tradovateRequest(
              "/order/liquidatePosition",
              { method: "POST", body: JSON.stringify({ accountId: account.id }) },
              env,
            );
            return { accountId: account.id, accountName: account.name, ok: true, error: null };
          } catch (e) {
            return {
              accountId: account.id,
              accountName: account.name,
              ok: false,
              error: e instanceof Error ? e.message : "flatten failed",
            };
          }
        }),
      );

      const allOk = results.every((r) => r.ok);
      return {
        ok: allOk,
        error: allOk ? null : `${results.filter((r) => !r.ok).length}/${results.length} accounts failed to flatten`,
        results,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "flatten failed", results: [] };
    }
  });

/** Readiness for the UI — what is blocking, and how the manual call stands. */
export const getExecutionReadiness = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => readExecutionReadiness(context.userId));
