/**
 * Decision-time desk snapshots.
 *
 * The journal records WHAT was traded. This records WHAT THE DESK LOOKED LIKE
 * at the moment of the decision — HTF bias both sides, killzone, news verdict,
 * data quality, the whole candidate set with its present/missing confluences.
 *
 * Why it matters: reviewing a loss three weeks later, "why did I take this?"
 * is unanswerable from price alone. Without the snapshot you re-derive the
 * setup from a chart that now includes the outcome, which is hindsight, not
 * review. With it, you can separate "good decision, bad outcome" from "bad
 * decision" — the only distinction that improves a trader.
 *
 * Snapshots are capped and pruned: this is a review aid, not an audit log,
 * and an unbounded jsonb table on every 30s poll would be a cost bug.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import type { JsonValue } from "./server";

/** Keep the most recent N snapshots per user. Older ones are pruned on write. */
export const SNAPSHOT_RETENTION = 500;

export interface DeskSnapshotSummary {
  id: string;
  ts: string;
  tradeId: string | null;
  symbol: string | null;
  killzone: string | null;
  htfLeft: string | null;
  htfRight: string | null;
  newsVerdict: string | null;
  dataQualityOk: boolean;
  bestPrescore: number | null;
  actionableCount: number;
}

const captureInput = z.object({
  /** Link to the trade this justified. Null for a periodic capture. */
  tradeId: z.string().max(64).nullable().optional(),
  symbol: z.string().max(16).nullable().optional(),
  killzone: z.string().max(32).nullable().optional(),
  htfLeft: z.string().max(16).nullable().optional(),
  htfRight: z.string().max(16).nullable().optional(),
  newsVerdict: z.string().max(32).nullable().optional(),
  dataQualityOk: z.boolean().default(true),
  bestPrescore: z.number().min(0).max(1).nullable().optional(),
  actionableCount: z.number().int().min(0).max(100).default(0),
  /** Trimmed DeskPayload — the caller decides how much context to keep. */
  payload: z.record(z.string(), z.unknown()),
});

export const captureSnapshot = createServerFn({ method: "POST" })
  .validator((input: unknown) => captureInput.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const sql = await getSql();
    const id = crypto.randomUUID();
    const now = new Date();

    await sql.query(
      `insert into desk_snapshots
         (id, user_id, ts, trade_id, symbol, killzone, htf_left, htf_right,
          news_verdict, data_quality_ok, best_prescore, actionable_count, payload)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)`,
      [
        id,
        context.userId,
        now,
        data.tradeId ?? null,
        data.symbol ?? null,
        data.killzone ?? null,
        data.htfLeft ?? null,
        data.htfRight ?? null,
        data.newsVerdict ?? null,
        data.dataQualityOk,
        data.bestPrescore ?? null,
        data.actionableCount,
        JSON.stringify(data.payload),
      ],
    );

    // Prune to the retention window. Keeps the table bounded without a cron:
    // deletes anything outside the newest N for THIS user only.
    await sql.query(
      `delete from desk_snapshots
        where user_id = $1
          and id not in (
            select id from desk_snapshots
             where user_id = $1
             order by ts desc
             limit $2
          )`,
      [context.userId, SNAPSHOT_RETENTION],
    );

    return { id };
  });

const listInput = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  tradeId: z.string().max(64).nullable().optional(),
});

type SnapRow = {
  id: string;
  ts: string | Date;
  trade_id: string | null;
  symbol: string | null;
  killzone: string | null;
  htf_left: string | null;
  htf_right: string | null;
  news_verdict: string | null;
  data_quality_ok: boolean;
  best_prescore: number | null;
  actionable_count: number;
};

const toSummary = (r: SnapRow): DeskSnapshotSummary => ({
  id: r.id,
  ts: (r.ts instanceof Date ? r.ts : new Date(r.ts)).toISOString(),
  tradeId: r.trade_id,
  symbol: r.symbol,
  killzone: r.killzone,
  htfLeft: r.htf_left,
  htfRight: r.htf_right,
  newsVerdict: r.news_verdict,
  dataQualityOk: r.data_quality_ok,
  bestPrescore: r.best_prescore,
  actionableCount: r.actionable_count,
});

export const listSnapshots = createServerFn({ method: "GET" })
  .validator((input: unknown) => listInput.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<DeskSnapshotSummary[]> => {
    const sql = await getSql();
    const cols = `id, ts, trade_id, symbol, killzone, htf_left, htf_right,
                  news_verdict, data_quality_ok, best_prescore, actionable_count`;
    const rows = data.tradeId
      ? await sql.query<SnapRow>(
          `select ${cols} from desk_snapshots
            where user_id = $1 and trade_id = $2
            order by ts desc limit $3`,
          [context.userId, data.tradeId, data.limit],
        )
      : await sql.query<SnapRow>(
          `select ${cols} from desk_snapshots
            where user_id = $1
            order by ts desc limit $2`,
          [context.userId, data.limit],
        );
    return rows.map(toSummary);
  });

/** Full stored context for one snapshot — the deep-review path. */
export const getSnapshot = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ id: z.string().min(1).max(64) }).parse(input),
  )
  .middleware([authMiddleware])
  .handler(
    async ({
      data,
      context,
    }): Promise<{ summary: DeskSnapshotSummary; payload: JsonValue } | null> => {
      const sql = await getSql();
      const rows = await sql.query<SnapRow & { payload: unknown }>(
        `select id, ts, trade_id, symbol, killzone, htf_left, htf_right,
                news_verdict, data_quality_ok, best_prescore, actionable_count,
                payload
           from desk_snapshots
          where user_id = $1 and id = $2`,
        [context.userId, data.id],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        summary: toSummary(row),
        payload: (row.payload ?? null) as JsonValue,
      };
    },
  );
