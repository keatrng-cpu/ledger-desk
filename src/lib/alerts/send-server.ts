/**
 * The send path: claim the alert, then fan it out to every browser this user
 * has subscribed.
 *
 * Two properties matter more than delivery itself:
 *
 * 1. **Idempotent.** The claim (`alert_log` unique index) happens BEFORE any
 *    push. A duplicate claim short-circuits with `sent: false, duplicate: true`
 *    and sends nothing. So calling `sendAlert` on every 30s desk poll while a
 *    halt is active produces exactly one notification, not 780 a day.
 *
 * 2. **Non-throwing.** Alerting is a side effect of a trading decision, never a
 *    precondition for one. Every failure — VAPID unconfigured, push service
 *    down, endpoint dead — is captured in the result, not raised. A caller in
 *    `openTrade` or a flatten routine can `void sendAlert(...)` safely.
 *
 * Recording still happens when nothing is subscribed and even when VAPID is
 * unset: the row in `alert_log` is the durable fact ("the desk decided to warn
 * you at 09:47"), and the notification is only its transport.
 */

import type { AlertKind, AlertNotification } from "./types";
import { ALERT_URGENCY } from "./types";
import { pushConfig, sendPush } from "./push-server";
import {
  claimAlert,
  deleteDeadEndpoint,
  listSubscriptions,
  markDelivered,
  recordDeliveryOutcome,
} from "./store-server";

export interface AlertSpec {
  kind: AlertKind;
  /** Idempotency key. Encode the granularity you want (see 0007_alerts.sql). */
  dedupeKey: string;
  title: string;
  body: string;
  /** Same-origin deep link opened on notification click. */
  url?: string;
  payload?: Record<string, unknown>;
}

export interface AlertResult {
  /** A new row was claimed (this is the first time this fact was raised). */
  recorded: boolean;
  /** The claim lost — the alert had already been raised. Nothing was sent. */
  duplicate: boolean;
  alertId: number | null;
  /** Endpoints that accepted the push. 0 with `recorded: true` is normal. */
  delivered: number;
  /** Endpoints that failed. Dead ones are pruned automatically. */
  failed: number;
  /** Set when push is not configured — the row is still written. */
  pushDisabledReason?: string;
}

/**
 * Raise an alert. Safe to call repeatedly with the same `dedupeKey`.
 */
export async function sendAlert(
  userId: string,
  spec: AlertSpec,
): Promise<AlertResult> {
  const alertId = await claimAlert(userId, {
    kind: spec.kind,
    dedupeKey: spec.dedupeKey,
    title: spec.title,
    body: spec.body,
    payload: spec.payload ?? null,
  });

  if (alertId == null) {
    return { recorded: false, duplicate: true, alertId: null, delivered: 0, failed: 0 };
  }

  const cfg = pushConfig();
  if (!cfg.configured) {
    return {
      recorded: true,
      duplicate: false,
      alertId,
      delivered: 0,
      failed: 0,
      // Names the missing variables, never their values.
      pushDisabledReason: `push not configured (${cfg.missing.join(", ")})`,
    };
  }

  const subs = await listSubscriptions(userId);
  if (subs.length === 0) {
    return { recorded: true, duplicate: false, alertId, delivered: 0, failed: 0 };
  }

  const notification: AlertNotification = {
    kind: spec.kind,
    title: spec.title,
    body: spec.body,
    // Same-origin only: a notification must never be a redirect primitive.
    url: spec.url && spec.url.startsWith("/") ? spec.url : "/",
    // Same tag => a re-fire replaces the old notification instead of stacking.
    tag: `${spec.kind}:${spec.dedupeKey}`,
    ts: new Date().toISOString(),
  };

  const results = await Promise.all(
    subs.map(async (sub) => {
      const res = await sendPush(sub, notification, {
        urgency: ALERT_URGENCY[spec.kind],
      });
      if (res.gone) {
        await deleteDeadEndpoint(sub.endpoint).catch(() => undefined);
      } else {
        await recordDeliveryOutcome(sub.id, res.ok, res.reason).catch(
          () => undefined,
        );
      }
      return res.ok;
    }),
  );

  const delivered = results.filter(Boolean).length;
  await markDelivered(userId, alertId, delivered).catch(() => undefined);

  return {
    recorded: true,
    duplicate: false,
    alertId,
    delivered,
    failed: results.length - delivered,
  };
}

/* ------------------------------------------------------------------ */
/* The four ROADMAP B4 alerts                                          */
/* ------------------------------------------------------------------ */

/**
 * Builders rather than free-form calls, so the dedupe key for a given fact is
 * defined in exactly one place. Getting the key wrong is the only way to break
 * idempotency, and it is not something a call site should be inventing.
 */

/** ET calendar date (YYYY-MM-DD) — the natural "once today" dedupe grain. */
function etDay(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/** Setup armed: sweep -> displace -> MSS -> retest complete. */
export function setupArmedAlert(input: {
  symbol: string;
  side: string;
  candidateId: string;
  grade?: string | null;
  confluence?: number | null;
  killzone?: string | null;
}): AlertSpec {
  const score =
    input.confluence != null ? ` · ${input.confluence.toFixed(2)}` : "";
  return {
    kind: "setup_armed",
    // Per candidate: the scanner re-emits the same id every poll while armed.
    dedupeKey: `armed:${input.symbol}:${input.side}:${input.candidateId}`,
    title: `${input.symbol} ${input.side.toUpperCase()} armed`,
    body: `${input.grade ?? "setup"}${score}${input.killzone ? ` · ${input.killzone}` : ""} — sequence complete, check the desk.`,
    url: "/",
    payload: { ...input },
  };
}

/** Halt hit — daily / weekly / killzone cap. One per scope per trading day. */
export function haltHitAlert(input: {
  scope: "daily" | "weekly" | "killzone";
  detail: string;
  at?: Date;
}): AlertSpec {
  const at = input.at ?? new Date();
  return {
    kind: "halt_hit",
    dedupeKey: `halt:${input.scope}:${etDay(at)}`,
    title: `${input.scope === "killzone" ? "Killzone cap" : `${input.scope} halt`} hit`,
    body: `${input.detail} No new live entries.`,
    url: "/",
    payload: { scope: input.scope, detail: input.detail },
  };
}

/** Position auto-flattened by a time / context stop (ROADMAP B2). */
export function positionFlattenedAlert(input: {
  tradeId: string;
  symbol: string;
  side: string;
  reason: string;
  r?: number | null;
}): AlertSpec {
  const r = input.r != null ? ` · ${input.r >= 0 ? "+" : ""}${input.r.toFixed(2)}R` : "";
  return {
    kind: "position_flattened",
    // Per trade: a position can only be flattened once.
    dedupeKey: `flat:${input.tradeId}`,
    title: `${input.symbol} ${input.side.toUpperCase()} flattened`,
    body: `${input.reason}${r}`,
    url: "/",
    payload: { ...input },
  };
}

/** News blackout starting in ~15 minutes. One per scheduled news instant. */
export function newsBlackoutAlert(input: {
  /** ISO instant the blackout window opens — also the dedupe grain. */
  startsAt: string;
  event: string;
  impact?: string | null;
}): AlertSpec {
  return {
    kind: "news_blackout_15m",
    dedupeKey: `blackout:${input.startsAt}`,
    title: "News blackout in 15 min",
    body: `${input.event}${input.impact ? ` (${input.impact})` : ""} — flat before the window.`,
    url: "/",
    payload: { ...input },
  };
}
