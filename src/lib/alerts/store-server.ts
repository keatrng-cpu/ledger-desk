/**
 * Alert persistence. Plain async functions taking an explicit `userId` — NOT
 * server functions — because both callers need them: the browser-facing
 * `createServerFn`s in ./server.ts (userId from authMiddleware) and the cron
 * endpoints in src/routes/api/cron/* (userId from the cron config, no session).
 *
 * Every statement is parameterized and scoped by user_id. Tables live in
 * migrations/0007_alerts.sql.
 */

import { getSql } from "@/lib/db";
import type { AlertKind, AlertRecord } from "./types";
import type { PushTarget } from "./push-server";

/* ------------------------------------------------------------------ */
/* Subscriptions                                                      */
/* ------------------------------------------------------------------ */

export interface StoredSubscription extends PushTarget {
  id: string;
}

type SubRow = {
  id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
};

/**
 * Upsert a browser subscription.
 *
 * Conflict target is `endpoint`, not `(user_id, endpoint)`: an endpoint IS a
 * browser, so the same endpoint arriving under a different user id means the
 * device changed hands, not that a second subscription exists. Re-attributing
 * it is the only correct outcome — leaving the old row would keep pushing this
 * user's halts to whoever signs in next.
 */
export async function saveSubscription(
  userId: string,
  input: { endpoint: string; p256dh: string; auth: string; userAgent?: string | null },
): Promise<{ id: string }> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `insert into push_subscriptions
       (id, user_id, endpoint, p256dh, auth, user_agent)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (endpoint) do update
       set user_id = excluded.user_id,
           p256dh = excluded.p256dh,
           auth = excluded.auth,
           user_agent = excluded.user_agent,
           failure_count = 0,
           last_error = null
     returning id`,
    [
      crypto.randomUUID(),
      userId,
      input.endpoint,
      input.p256dh,
      input.auth,
      input.userAgent ?? null,
    ],
  );
  return { id: rows[0]!.id };
}

/** Remove one endpoint for this user. Returns how many rows went. */
export async function deleteSubscription(
  userId: string,
  endpoint: string,
): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ id: string }>(
    `delete from push_subscriptions
      where user_id = $1 and endpoint = $2
      returning id`,
    [userId, endpoint],
  );
  return rows.length;
}

/**
 * Drop a dead endpoint regardless of owner. Called only after a push service
 * answered 404/410 for it, which is authoritative: that subscription cannot
 * receive anything ever again.
 */
export async function deleteDeadEndpoint(endpoint: string): Promise<void> {
  const sql = await getSql();
  await sql.query(`delete from push_subscriptions where endpoint = $1`, [endpoint]);
}

export async function listSubscriptions(
  userId: string,
): Promise<StoredSubscription[]> {
  const sql = await getSql();
  const rows = await sql.query<SubRow>(
    `select id, endpoint, p256dh, auth
       from push_subscriptions
      where user_id = $1
      order by created_at`,
    [userId],
  );
  return rows;
}

export async function countSubscriptions(userId: string): Promise<number> {
  const sql = await getSql();
  const rows = await sql.query<{ n: number }>(
    `select count(*)::int as n from push_subscriptions where user_id = $1`,
    [userId],
  );
  return rows[0]?.n ?? 0;
}

/** Record the outcome of a delivery attempt (diagnostics only). */
export async function recordDeliveryOutcome(
  id: string,
  ok: boolean,
  reason?: string,
): Promise<void> {
  const sql = await getSql();
  if (ok) {
    await sql.query(
      `update push_subscriptions
          set last_success_at = now(), failure_count = 0, last_error = null
        where id = $1`,
      [id],
    );
    return;
  }
  await sql.query(
    `update push_subscriptions
        set failure_count = failure_count + 1, last_error = $2
      where id = $1`,
    [id, (reason ?? "unknown").slice(0, 200)],
  );
}

/* ------------------------------------------------------------------ */
/* alert_log — the idempotency ledger                                 */
/* ------------------------------------------------------------------ */

/**
 * Claim an alert. Returns the new row id, or `null` when this
 * `(user, kind, dedupe_key)` was already claimed.
 *
 * This is the entire "never send the same alert twice" mechanism, and it is one
 * statement on purpose. A read-then-write ("select ... if none then insert")
 * has a window between the two in which a second poll, a second tab, or a cron
 * retry passes the same check — precisely the case that produces two 03:00
 * notifications for one halt.
 */
export async function claimAlert(
  userId: string,
  input: {
    kind: AlertKind;
    dedupeKey: string;
    title: string;
    body?: string | null;
    payload?: Record<string, unknown> | null;
  },
): Promise<number | null> {
  const sql = await getSql();
  const rows = await sql.query<{ id: number }>(
    `insert into alert_log (user_id, kind, dedupe_key, title, body, payload)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (user_id, kind, dedupe_key) do nothing
     returning id`,
    [
      userId,
      input.kind,
      input.dedupeKey,
      input.title,
      input.body ?? null,
      input.payload ? JSON.stringify(input.payload) : null,
    ],
  );
  return rows[0]?.id ?? null;
}

/** Stamp how many endpoints accepted the notification. */
export async function markDelivered(
  userId: string,
  alertId: number,
  delivered: number,
): Promise<void> {
  const sql = await getSql();
  await sql.query(
    `update alert_log set delivered = $3 where id = $2 and user_id = $1`,
    [userId, alertId, delivered],
  );
}

type AlertRow = {
  id: number;
  kind: AlertKind;
  dedupe_key: string;
  title: string;
  body: string | null;
  delivered: number;
  created_at: string | Date;
};

export async function listAlerts(
  userId: string,
  limit = 50,
): Promise<AlertRecord[]> {
  const sql = await getSql();
  const rows = await sql.query<AlertRow>(
    `select id, kind, dedupe_key, title, body, delivered, created_at
       from alert_log
      where user_id = $1
      order by created_at desc, id desc
      limit $2`,
    [userId, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    dedupeKey: r.dedupe_key,
    title: r.title,
    body: r.body,
    delivered: r.delivered,
    createdAt: (r.created_at instanceof Date
      ? r.created_at
      : new Date(r.created_at)
    ).toISOString(),
  }));
}
