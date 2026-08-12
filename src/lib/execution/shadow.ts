/**
 * ROADMAP E4 — SHADOW MODE. DELIBERATELY NON-SENDING.
 *
 * WHAT THIS FILE DOES: writes down the `OrderIntent` the desk WOULD have
 * placed, with the timestamp and the desk context it was computed from, so it
 * can later be diffed against what the human actually did.
 *
 * WHAT THIS FILE DOES NOT DO, BY DESIGN: it does not place, route, stage,
 * queue or transmit an order. There is no broker SDK, no HTTP client, no
 * socket, no credential and no environment variable read anywhere in
 * `src/lib/execution/`. The only side effect is one row in `shadow_orders`.
 * If you are here to add sending, you are in the wrong file — and it is not
 * yet time.
 *
 * A REAL ADAPTER IS GATED. ROADMAP Phase E unlocks on four conditions, no
 * exceptions:
 *   1. >= 100 mirrored paper trades,
 *   2. positive expectancy on the LIVE-mode analytics report,
 *   3. Phase A shipped — paper and live scored by one scorer,
 *   4. B1 shipped — the same rules enforced on both.
 * E4 adds a fifth in practice: >= 2 weeks where THIS log's diff against the
 * real book is boring. Auto-execution multiplies expectancy; the measured
 * expectancy today is unknown and the engine's own calibration cleared zero
 * trades, so multiplying it now would convert a slow manual loss into a fast
 * automatic one.
 *
 * IDEMPOTENT. The row id is the intent's `clientOrderId`, so the desk
 * re-computing the same armed setup on every 30s poll writes ONE row, not one
 * per poll — the same discipline the paper mirror uses.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { orderIntentSchema, type OrderIntent } from "./order-intent";

/** Who computed the intent. Mirrors `desk_events.source` vocabulary. */
export const SHADOW_SOURCES = ["desk", "scanner", "engine", "manual"] as const;
export type ShadowSource = (typeof SHADOW_SOURCES)[number];

/** Rows returned per `listShadowOrders` call (2 weeks of polling, bounded). */
export const SHADOW_PAGE_MAX = 500;

export interface ShadowOrder {
  id: string;
  ts: string;
  intent: OrderIntent;
  source: ShadowSource;
  notes: string | null;
}

const recordSchema = z.object({
  intent: orderIntentSchema,
  source: z.enum(SHADOW_SOURCES).default("desk"),
  /** Decision time. Defaults to the intent's own `createdAt`. */
  ts: z.string().datetime().nullable().optional(),
  notes: z.string().max(500).nullable().optional(),
});

export type RecordShadowOrderInput = z.input<typeof recordSchema>;
type RecordShadowOrderData = z.output<typeof recordSchema>;

/**
 * THE shadow write. One row per client order id; a repeat is a no-op.
 * Returns whether THIS call created the row.
 */
export async function insertShadowRow(
  sql: Sql,
  userId: string,
  data: RecordShadowOrderData,
): Promise<boolean> {
  const rows = await sql.query<{ id: string }>(
    `insert into shadow_orders (id, user_id, ts, intent, source, notes)
     values ($1, $2, $3::timestamptz, $4::jsonb, $5, $6)
     on conflict do nothing
     returning id`,
    [
      data.intent.clientOrderId,
      userId,
      data.ts ?? data.intent.createdAt,
      JSON.stringify(data.intent),
      data.source,
      data.notes ?? null,
    ],
  );
  return rows.length > 0;
}

/**
 * Record the order the desk WOULD have placed. Records only — see the header.
 * Safe to call on every poll: the client order id dedupes.
 */
export const recordShadowOrder = createServerFn({ method: "POST" })
  .validator((input: unknown) => recordSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ recorded: boolean }> => {
    const sql = await getSql();
    return { recorded: await insertShadowRow(sql, context.userId, data) };
  });

const listSchema = z.object({
  limit: z.number().int().min(1).max(SHADOW_PAGE_MAX).default(100),
  since: z.string().datetime().nullable().optional(),
  source: z.enum(SHADOW_SOURCES).nullable().optional(),
});

/** Read the shadow log for the diff review. Newest first. */
export const listShadowOrders = createServerFn({ method: "GET" })
  .validator((input: unknown) => listSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<ShadowOrder[]> => {
    const sql = await getSql();
    const where: string[] = ["user_id = $1"];
    const params: unknown[] = [context.userId];
    if (data.since) {
      params.push(data.since);
      where.push(`ts >= $${params.length}::timestamptz`);
    }
    if (data.source) {
      params.push(data.source);
      where.push(`source = $${params.length}`);
    }
    params.push(data.limit);

    const rows = await sql.query<{
      id: string;
      ts: string | Date;
      intent: unknown;
      source: ShadowSource;
      notes: string | null;
    }>(
      `select id, ts, intent, source, notes
         from shadow_orders
        where ${where.join(" and ")}
        order by ts desc
        limit $${params.length}`,
      params,
    );

    return rows.map((row) => ({
      id: row.id,
      ts: new Date(row.ts).toISOString(),
      // jsonb comes back parsed on both backends; a text column would not.
      intent: (typeof row.intent === "string"
        ? JSON.parse(row.intent)
        : row.intent) as OrderIntent,
      source: row.source,
      notes: row.notes,
    }));
  });
