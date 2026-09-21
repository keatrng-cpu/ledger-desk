/**
 * Server functions for the shadow book (shadow_trades).
 *
 * The client owns the state machine (shadow-book.ts runs on every poll and
 * every quote tick, because the fills and exits depend on prints the server
 * never sees between polls); the server is the durable ledger. Writes are
 * upserts keyed on the deterministic id, in small batches, fire-and-forget
 * from the poll loop — a slow database must never hold the desk.
 *
 * Scoped to `context.userId` like every per-user read. A shadow is evidence
 * about the trader's own gates; nobody else's refusals belong in their
 * scorecard.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import type { ShadowTrade } from "./shadow-book";

const MAX_BATCH = 60;

const shadowSchema = z.object({
  id: z.string().min(8).max(200),
  dayKey: z.string().min(10).max(10),
  symbol: z.string().min(1).max(10),
  side: z.enum(["long", "short"]),
  leg: z.enum(["limit", "chase"]),
  kind: z.string().max(20),
  reasonId: z.string().max(40),
  status: z.string().max(20),
  openedAt: z.number().finite(),
  exitAt: z.number().finite().optional(),
  r: z.number().finite().optional(),
  pnl: z.number().finite().optional(),
  source: z.enum(["live", "replay"]),
});

const upsertSchema = z.object({
  rows: z.array(z.unknown()).min(1).max(MAX_BATCH),
});

/** Upsert a batch of shadows. Returns how many rows were written. */
export const upsertShadowTrades = createServerFn({ method: "POST" })
  .validator((input: unknown) => upsertSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ written: number }> => {
    const sql = await getSql();
    let written = 0;
    for (const raw of data.rows) {
      const parsed = shadowSchema.safeParse(raw);
      if (!parsed.success) continue;
      const s = parsed.data;
      await sql.query(
        `insert into shadow_trades
           (id, user_id, day_key, symbol, side, leg, kind, reason_id, status, opened_at, closed_at, r, pnl, source, body, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, to_timestamp($10 / 1000.0), $11, $12, $13, $14, $15::jsonb, now())
         on conflict (id) do update set
           status = excluded.status,
           closed_at = excluded.closed_at,
           r = excluded.r,
           pnl = excluded.pnl,
           body = excluded.body,
           updated_at = now()
         where shadow_trades.user_id = excluded.user_id`,
        [
          s.id,
          context.userId,
          s.dayKey,
          s.symbol,
          s.side,
          s.leg,
          s.kind,
          s.reasonId,
          s.status,
          s.openedAt,
          s.exitAt != null ? new Date(s.exitAt).toISOString() : null,
          s.r ?? null,
          s.pnl ?? null,
          s.source,
          JSON.stringify(raw),
        ],
      );
      written++;
    }
    return { written };
  });

const listSchema = z.object({
  days: z.number().int().min(1).max(400).default(90),
  limit: z.number().int().min(1).max(2000).default(800),
});

/** The trader's shadows, newest first. */
export const listShadowTrades = createServerFn({ method: "GET" })
  .validator((input: unknown) => listSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<ShadowTrade[]> => {
    const sql = await getSql();
    const rows = await sql.query<{ body: unknown }>(
      `select body from shadow_trades
        where user_id = $1 and opened_at >= now() - ($2::int * interval '1 day')
        order by opened_at desc
        limit $3`,
      [context.userId, data.days, data.limit],
    );
    const out: ShadowTrade[] = [];
    for (const r of rows) {
      const b = typeof r.body === "string" ? (JSON.parse(r.body) as ShadowTrade) : (r.body as ShadowTrade);
      if (b && typeof b === "object" && typeof b.id === "string") out.push(b);
    }
    return out;
  });
