/**
 * Browser-facing alert server functions.
 *
 * Order in every handler (repo rule): authenticate (authMiddleware) ->
 * authorize (scope by context.userId) -> validate (zod). No call site passes a
 * user id; there is no parameter for one.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import { pushConfig } from "./push-server";
import {
  countSubscriptions,
  deleteSubscription,
  listAlerts,
  saveSubscription,
} from "./store-server";
import type { AlertRecord } from "./types";

/**
 * A PushSubscription as the browser serializes it. Lengths are bounded so a
 * malicious client cannot use this table as free storage; the key lengths are
 * additionally checked byte-exactly at encryption time (push-server.ts).
 */
const subscriptionSchema = z.object({
  endpoint: z.string().url().max(2000),
  p256dh: z.string().min(1).max(200),
  auth: z.string().min(1).max(100),
  userAgent: z.string().max(300).nullable().optional(),
});

export interface AlertStatus {
  /** VAPID present server-side. False => subscribing is pointless. */
  configured: boolean;
  /** The VAPID public key, needed by pushManager.subscribe(). Public by design. */
  publicKey: string | null;
  /** Which env vars are missing (names only). Empty when configured. */
  missing: string[];
  /** How many browsers this user currently has registered. */
  subscriptions: number;
}

/** Everything the client needs to decide what to render. No secrets. */
export const getAlertStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<AlertStatus> => {
    const cfg = pushConfig();
    return {
      configured: cfg.configured,
      publicKey: cfg.publicKey,
      missing: cfg.missing,
      subscriptions: await countSubscriptions(context.userId),
    };
  });

export const subscribeToAlerts = createServerFn({ method: "POST" })
  .validator((input: unknown) => subscriptionSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    // The endpoint must be a real push service URL, not an arbitrary host we
    // would then POST to on a schedule (SSRF via a stored subscription).
    const url = new URL(data.endpoint);
    if (url.protocol !== "https:") {
      throw new Error("Push endpoint must be https");
    }
    return saveSubscription(context.userId, {
      endpoint: data.endpoint,
      p256dh: data.p256dh,
      auth: data.auth,
      userAgent: data.userAgent ?? null,
    });
  });

export const unsubscribeFromAlerts = createServerFn({ method: "POST" })
  .validator((input: unknown) =>
    z.object({ endpoint: z.string().url().max(2000) }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ removed: number }> => {
    return { removed: await deleteSubscription(context.userId, data.endpoint) };
  });

/** Recent alert_log rows — "what did the desk decide to tell me, and when". */
export const listRecentAlerts = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ limit: z.number().int().min(1).max(200).default(50) }).parse(
      input ?? {},
    ),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<AlertRecord[]> => {
    return listAlerts(context.userId, data.limit);
  });
