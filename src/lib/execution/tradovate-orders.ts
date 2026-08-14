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
import { readExecutionReadiness, executionEnv } from "./execution-gate";
import { tradovateRequest, tradovateToken } from "./tradovate-client";
import { insertShadowRow } from "./shadow";
import { getSql } from "@/lib/db";

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
  .handler(async (): Promise<{ ok: boolean; error: string | null }> => {
    const env = executionEnv();
    try {
      const token = await tradovateToken(env);
      if (token.accountId == null) {
        return { ok: false, error: "no account resolved" };
      }
      await tradovateRequest(
        "/order/liquidatePosition",
        {
          method: "POST",
          body: JSON.stringify({ accountId: token.accountId }),
        },
        env,
      );
      return { ok: true, error: null };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "flatten failed" };
    }
  });

/** Readiness for the UI — what is blocking, and how the manual call stands. */
export const getExecutionReadiness = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => readExecutionReadiness(context.userId));
