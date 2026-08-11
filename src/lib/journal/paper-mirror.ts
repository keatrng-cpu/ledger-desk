/**
 * Mirror the localStorage paper book into `desk_trades` (mode='paper').
 *
 * WHY THIS EXISTS
 * Two paper mechanisms coexist after the profit-v3 merge:
 *   - `trading/paper-manager.ts` — localStorage, instant one-click, works
 *     signed-out, auto-manages exits against live prints. The WORKING book.
 *   - `desk_trades` rows with mode='paper' — durable, auth-scoped, and what
 *     analytics / CSV export / the Phase-4 unlock evidence actually read.
 *
 * Without this bridge the analytics paper tab reads an empty table forever no
 * matter how many paper trades get logged, because the click path never
 * touches Postgres. Mirroring keeps the instant UX and makes the record real.
 *
 * DESIGN RULES
 * - Fire-and-forget: a mirror failure must NEVER break or block the working
 *   book. Signed-out users simply get no durable copy.
 * - Idempotent: keyed on the client-generated trade id, so a retry, a double
 *   render, or a reconcile pass cannot double-insert.
 * - Money math goes through the SAME `computeTradePnl` as live, so paper and
 *   live remain comparable (they stay separately REPORTED — see analytics.ts).
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { computeTradePnl } from "./pnl";

const sideSchema = z.enum(["long", "short"]);

const openSchema = z.object({
  id: z.string().min(1).max(80),
  symbol: z.string().min(1).max(16),
  side: sideSchema,
  entry: z.number().finite().positive(),
  stop: z.number().finite().positive(),
  target: z.number().finite().positive().nullable().optional(),
  contracts: z.number().int().min(1).max(1000),
  openedAt: z.string().datetime(),
  prescore: z.number().min(0).max(1).nullable().optional(),
  grade: z.string().max(16).nullable().optional(),
  killzone: z.string().max(32).nullable().optional(),
  strategy: z.string().max(120).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

export type MirrorOpenInput = z.input<typeof openSchema>;

/**
 * Record a paper OPEN. `on conflict do nothing` makes this safe to call on
 * every reconcile pass — the first write wins and later ones are no-ops.
 */
export const mirrorPaperOpen = createServerFn({ method: "POST" })
  .validator((input: unknown) => openSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ mirrored: boolean }> => {
    const sql = await getSql();
    const rows = await sql.query<{ id: string }>(
      `insert into desk_trades (
         id, user_id, mode, source, symbol, side, status, opened_at,
         entry, stop, target, contracts, reason, prescore, grade, killzone
       ) values ($1, $2, 'paper', 'paper', $3, $4, 'open', $5::timestamptz,
                 $6, $7, $8, $9, $10, $11, $12, $13)
       on conflict do nothing
       returning id`,
      [
        data.id,
        context.userId,
        data.symbol,
        data.side,
        data.openedAt,
        data.entry,
        data.stop,
        data.target ?? null,
        data.contracts,
        data.reason ?? data.strategy ?? null,
        data.prescore ?? null,
        data.grade ?? null,
        data.killzone ?? null,
      ],
    );
    return { mirrored: rows.length > 0 };
  });

const closeSchema = z.object({
  id: z.string().min(1).max(80),
  exit: z.number().finite().positive(),
  closedAt: z.string().datetime(),
  /** Contracts actually closed; defaults to whatever the open row recorded. */
  contracts: z.number().int().min(1).max(1000).nullable().optional(),
  reason: z.string().max(500).nullable().optional(),
});

export type MirrorCloseInput = z.input<typeof closeSchema>;

/**
 * Record a paper CLOSE. PnL/R are recomputed SERVER-side from the stored open
 * row via the shared `computeTradePnl` — never trusted from the client — so a
 * mirrored paper trade is costed exactly like a live one.
 */
export const mirrorPaperClose = createServerFn({ method: "POST" })
  .validator((input: unknown) => closeSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ closed: boolean }> => {
    const sql = await getSql();
    const open = await sql.query<{
      symbol: string;
      side: "long" | "short";
      entry: number;
      stop: number | null;
      contracts: number;
    }>(
      `select symbol, side, entry, stop, contracts
         from desk_trades
        where id = $1 and user_id = $2 and mode = 'paper' and status = 'open'`,
      [data.id, context.userId],
    );
    const row = open[0];
    if (!row) return { closed: false }; // never mirrored, or already closed

    const contracts = data.contracts ?? row.contracts;
    const { pnl, commission, r } = computeTradePnl({
      symbol: row.symbol,
      side: row.side,
      entry: row.entry,
      exit: data.exit,
      stop: row.stop,
      contracts,
      slippage: 0, // paper fills are modeled at the level
    });

    const updated = await sql.query<{ id: string }>(
      `update desk_trades
          set status = 'closed', closed_at = $1::timestamptz, exit = $2,
              pnl = $3, r = $4, commission = $5, slippage = 0,
              contracts = $6, reason = coalesce($7, reason)
        where id = $8 and user_id = $9 and mode = 'paper' and status = 'open'
        returning id`,
      [
        data.closedAt,
        data.exit,
        pnl,
        r,
        commission,
        contracts,
        data.reason ?? null,
        data.id,
        context.userId,
      ],
    );
    if (!updated.length) return { closed: false };

    await sql`
      insert into desk_events (user_id, ts, event, symbol, reason, pnl, r, source, payload)
      values (${context.userId}, ${data.closedAt}, 'EXIT', ${row.symbol},
              ${data.reason ?? "paper exit"}, ${pnl}, ${r}, 'paper',
              ${JSON.stringify({ trade_id: data.id, mirrored: true })}::jsonb)`;

    return { closed: true };
  });
