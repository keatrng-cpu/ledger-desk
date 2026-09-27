/**
 * Server side of the invest ledger mirror (migrations/0016_invest_ledger.sql).
 *
 * Two functions and no update path. `listInvestLedger` returns this user's
 * entries; `appendInvestLedger` inserts-or-ignores by (user_id, id) and
 * reports which ids already existed, so the client can tell "already synced"
 * from "another device logged this month first". Every entry is validated
 * with the same shape check the browser store uses before it touches SQL,
 * and every query is scoped to `context.userId`.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { isEntry } from "./store";
import type { InvestEntry } from "./ledger";

const MAX_BATCH = 200;
const MAX_ROWS = 5_000;

export interface LedgerPull {
  entries: InvestEntry[];
}

export const listInvestLedger = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<LedgerPull> => {
    const sql = await getSql();
    const rows = await sql.query<{ body: unknown }>(
      `select body from invest_ledger where user_id = $1 order by created_at asc limit $2`,
      [context.userId, MAX_ROWS],
    );
    const entries: InvestEntry[] = [];
    for (const r of rows) {
      const body = typeof r.body === "string" ? (JSON.parse(r.body) as unknown) : r.body;
      if (isEntry(body)) entries.push(body);
    }
    return { entries };
  });

export interface LedgerPush {
  written: number;
  /** Ids the server already held — unchanged by this call. */
  existed: string[];
  refused: number;
}

export const appendInvestLedger = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(z.object({ entries: z.array(z.unknown()).min(1).max(MAX_BATCH) }))
  .handler(async ({ data, context }): Promise<LedgerPush> => {
    const sql = await getSql();
    let written = 0;
    let refused = 0;
    const existed: string[] = [];
    for (const raw of data.entries) {
      if (!isEntry(raw)) {
        refused++;
        continue;
      }
      const e = raw;
      const res = await sql.query<{ id: string }>(
        `insert into invest_ledger (user_id, id, kind, entry_date, body)
         values ($1, $2, $3, $4, $5::jsonb)
         on conflict (user_id, id) do nothing
         returning id`,
        [context.userId, e.id, e.kind, e.date, JSON.stringify(e)],
      );
      if (res.length > 0) written++;
      else existed.push(e.id);
    }
    return { written, existed, refused };
  });
