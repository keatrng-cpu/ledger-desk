/**
 * Authenticated step for the desk's own Robinhood sender.
 * The handler loads the ledger (node:fs) only on the server.
 * The browser can ask. It cannot arm, and it cannot skip review.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { authMiddleware } from "@/lib/auth/middleware";
import type { Sql } from "@/lib/db";
import type { RhDispatchResult } from "./rh-dispatch";
import type { RhCycleDesk } from "../room/manager-live-loop";
import type { ManagerRoomState } from "../room/manager-feed";

function asDesk(raw: unknown): RhCycleDesk | null {
  if (!raw || typeof raw !== "object") return null;
  const d = raw as RhCycleDesk;
  if (typeof d.fetchedAt !== "string") return null;
  return d;
}

function asManager(raw: unknown): ManagerRoomState | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as ManagerRoomState;
  if (m.version !== 1 || !m.arms || !m.floor || !m.account) return null;
  return m;
}

export const stepRhDesk = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator(
    z.object({
      flatten: z.boolean().optional(),
      desk: z.unknown().nullable().optional(),
      manager: z.unknown().nullable().optional(),
    }),
  )
  .handler(async ({ data, context }): Promise<RhDispatchResult> => {
    const { runRhDesk } = await import("./rh-dispatch");
    const { sqlLedger } = await import("./rh-ledger");
    const { toolingFromEnv } = await import("./rh-http");
    let sql: Sql | null = null;
    try {
      const { getSql } = await import("@/lib/db");
      sql = await getSql();
    } catch {
      const why = "The desk book could not be read. Nothing was sent.";
      return { cycle: { phase: "look", reason: why, order: null }, sent: false, why, orderId: null };
    }
    if (!sql) {
      const why = "The desk book could not be read. Nothing was sent.";
      return { cycle: { phase: "look", reason: why, order: null }, sent: false, why, orderId: null };
    }
    let blockNewEntries = false;
    try {
      const { PgExecStore } = await import("@/lib/room/exec/exec-sql");
      const store = new PgExecStore((text, params) => sql.query(text, params), context.userId);
      blockNewEntries = (await store.state()).killed === true;
    } catch {
      // The kill switch could not be read. No new entry until it can. A close still can.
      blockNewEntries = true;
    }
    return runRhDesk({
      desk: asDesk(data.desk),
      manager: asManager(data.manager),
      nowMs: Date.now(),
      tooling: toolingFromEnv(),
      ledger: sqlLedger(sql),
      flatten: data.flatten === true,
      blockNewEntries,
    });
  });
