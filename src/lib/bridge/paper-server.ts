/**
 * Server-side reads for the paper book plus the paper-mode arm switch.
 *
 * Phase A4: this file used to be the persistence half of a SECOND paper
 * engine whose pure half lived in `@/lib/trading/paper`. That engine was never
 * wired — `commitPaperCycle` had zero callers and `trading/paper.ts` was
 * reachable only through a type-only import from here. The live paper loop is
 * `@/lib/trading/paper-manager` (localStorage book + optional server journal),
 * used by `routes/index.tsx`, `veteran-brain.ts` and `paper-book-panel.tsx`.
 * Both halves of the dead engine are gone; what remains here is only what the
 * UI actually calls.
 *
 * Paper rows are labelled PAPER in the data itself (`desk_trades.mode =
 * 'paper'`) so a metrics query can include or exclude the paper sample by
 * column, never by guessing from the reason text.
 *
 * `desk_trades` comes from migrations/0002_journal.sql (Phase 1).
 * `engine_status` (paper toggle) comes from migrations/0004_bridge.sql.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import {
  countEngineEventsToday,
  readEngineStatus,
  setPaperEnabled,
} from "./ingest-server";

export const PAPER_MODE = "paper" as const;

/**
 * An open paper position as stored in `desk_trades` (mode = 'paper').
 * Previously imported from the deleted `@/lib/trading/paper`; inlined here
 * because `listOpenPaperTrades` is the only thing that still needs the shape.
 */
export interface OpenPaperTrade {
  id: string;
  symbol: string;
  side: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  contracts: number;
  openedAt: string;
}

interface PaperTradeRow {
  id: string;
  symbol: string;
  side: OpenPaperTrade["side"];
  entry: string | number;
  stop: string | number;
  target: string | number | null;
  contracts: number;
  opened_at: string;
}

const num = (v: string | number | null): number =>
  typeof v === "number" ? v : Number(v ?? 0);

/**
 * Open paper positions for the signed-in caller, straight from `desk_trades`.
 * NOTE: this is the SERVER book. The desk UI's `listOpenPaperTrades` is a
 * different, same-named function in `@/lib/trading/paper-manager` reading the
 * localStorage book — check the import path before assuming which one a call
 * site means.
 */
export const listOpenPaperTrades = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<OpenPaperTrade[]> => {
    const sql = await getSql();
    const rows = await sql.query<PaperTradeRow>(
      `select id, symbol, side, entry, stop, target, contracts, opened_at
         from desk_trades
        where user_id = $1 and mode = $2 and status = 'open'
        order by opened_at asc`,
      [context.userId, PAPER_MODE],
    );
    return rows.map((r) => ({
      id: r.id,
      symbol: r.symbol,
      side: r.side,
      entry: num(r.entry),
      stop: num(r.stop),
      target: num(r.target),
      contracts: r.contracts,
      openedAt:
        typeof r.opened_at === "string"
          ? r.opened_at
          : new Date(r.opened_at).toISOString(),
    }));
  });

export interface BridgeStatusPayload {
  ok: true;
  lastSeen: string | null;
  mode: string | null;
  note: string | null;
  symbol: string | null;
  paperEnabled: boolean;
  engineEventsToday: number;
  openPaperTrades: number;
  serverNow: string;
}

export interface BridgeStatusError {
  ok: false;
  error: string;
}

/** Everything the bridge status card renders, in one round trip. */
export const getBridgeStatus = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({
    context,
  }): Promise<BridgeStatusPayload | BridgeStatusError> => {
    try {
      const status = await readEngineStatus(context.userId);
      const [engineEventsToday, openRows] = await Promise.all([
        countEngineEventsToday(context.userId),
        (async () => {
          const sql = await getSql();
          return sql.query<{ n: number }>(
            `select count(*)::int as n from desk_trades
              where user_id = $1 and mode = $2 and status = 'open'`,
            [context.userId, PAPER_MODE],
          );
        })(),
      ]);
      return {
        ok: true,
        lastSeen: status?.last_seen ?? null,
        mode: status?.mode ?? null,
        note: status?.note ?? null,
        symbol: status?.symbol ?? null,
        paperEnabled: status?.paper_enabled ?? false,
        engineEventsToday,
        openPaperTrades: openRows[0]?.n ?? 0,
        serverNow: new Date().toISOString(),
      };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : "Bridge status unavailable",
      };
    }
  });

/** Arm / disarm the desk-side paper loop (persisted in engine_status). */
export const togglePaperMode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { enabled: boolean }) => ({ enabled: !!input?.enabled }))
  .handler(async ({ data, context }): Promise<{ paperEnabled: boolean }> => {
    const paperEnabled = await setPaperEnabled(context.userId, data.enabled);
    return { paperEnabled };
  });
