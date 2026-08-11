/**
 * Persistence for the paper-trade loop. The decision logic is pure and lives in
 * `@/lib/trading/paper`; this file only writes what that function decided.
 *
 * Every row is labelled PAPER in the data itself:
 *   desk_trades.mode   = 'paper'
 *   desk_trades.source = 'paper'
 *   desk_events.source = 'paper'
 * so a metrics query can include or exclude the paper sample by column, never
 * by guessing from the reason text.
 *
 * `desk_trades` / `desk_events` come from migrations/0002_journal.sql (Phase 1).
 * `engine_status` (paper toggle) comes from migrations/0004_bridge.sql.
 */

import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import { getSql } from "@/lib/db";
import { computeTradePnl } from "@/lib/journal/pnl";
import type { PaperExitEvent, PaperIntent, OpenPaperTrade } from "@/lib/trading/paper";
import {
  countEngineEventsToday,
  readEngineStatus,
  setPaperEnabled,
} from "./ingest-server";

export const PAPER_MODE = "paper" as const;
export const PAPER_SOURCE = "paper" as const;

/**
 * Net paper PnL — delegates to the SHARED money math in `@/lib/journal/pnl`,
 * the same function live `closeTrade` uses.
 *
 * Paper and live stay separate everywhere that matters (separate rows via
 * mode='paper', separate analytics, and the live risk governor ignores paper
 * entirely) — but they must be COMPUTED identically, or the paper track
 * record isn't evidence for anything. This previously double-charged
 * commission and stored a price-ratio `r` that ignored costs, so paper R was
 * always exactly -1.00/+2.00 while the same live trade booked -1.05.
 *
 * `stop` is required here (not the PaperExitEvent's price-based `r`) so the
 * persisted `r` is NET, matching live.
 */
export function paperPnl(
  exit: PaperExitEvent,
  contracts: number,
  stop: number,
): { pnl: number; commission: number; r: number | null } {
  const { pnl, commission, r } = computeTradePnl({
    symbol: exit.symbol,
    side: exit.side,
    entry: exit.entry,
    exit: exit.exit,
    stop,
    contracts,
    slippage: 0, // paper fills are modeled at the exact level, no slippage
  });
  return { pnl, commission, r };
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

/** Open paper positions for the caller — feeds `evaluatePaperCycle`. */
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

export interface PaperCommitResult {
  opened: number;
  closed: number;
  skippedDisabled: boolean;
}

/**
 * Persist one cycle. No-op (skippedDisabled) when the paper loop is toggled OFF
 * — the flag is checked HERE, server-side, so a stale client cannot write paper
 * trades after the toggle was turned off.
 */
export const commitPaperCycle = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { entries?: PaperIntent[]; exits?: PaperExitEvent[] }) => ({
    entries: Array.isArray(input?.entries) ? input.entries.slice(0, 20) : [],
    exits: Array.isArray(input?.exits) ? input.exits.slice(0, 50) : [],
  }))
  .handler(async ({ data, context }): Promise<PaperCommitResult> => {
    const status = await readEngineStatus(context.userId);
    if (!status?.paper_enabled) {
      return { opened: 0, closed: 0, skippedDisabled: true };
    }

    const sql = await getSql();
    const now = new Date().toISOString();
    let opened = 0;
    let closed = 0;

    for (const intent of data.entries) {
      const id = `paper-${intent.symbol}-${intent.side}-${Date.parse(now)}-${opened}`;
      // Bare `on conflict do nothing` (not `on conflict (id)`) so the partial
      // unique index from migrations/0005 — one OPEN position per
      // mode+symbol+side — also resolves to a silent skip. Two racing cycles
      // can no longer both open the same position: the loser inserts nothing
      // and `returning` comes back empty.
      const inserted = await sql.query<{ id: string }>(
        `insert into desk_trades
           (id, user_id, mode, source, symbol, side, status, opened_at,
            entry, stop, target, contracts, reason, prescore, grade,
            components_present, components_missing)
         values ($1, $2, $3, $4, $5, $6, 'open', $7::timestamptz,
                 $8, $9, $10, $11, $12, $13, $14, $15::jsonb, $16::jsonb)
         on conflict do nothing
         returning id`,
        [
          id,
          context.userId,
          PAPER_MODE,
          PAPER_SOURCE,
          intent.symbol,
          intent.side,
          now,
          intent.entry,
          intent.stop,
          intent.target,
          intent.contracts,
          intent.reason,
          intent.prescore,
          intent.grade,
          JSON.stringify([]),
          JSON.stringify([]),
        ],
      );
      // Lost the race (or a position was already open) — no row, no event.
      if (!inserted.length) continue;
      await sql.query(
        `insert into desk_events
           (user_id, ts, event, symbol, prescore, reason, source, payload)
         values ($1, $2::timestamptz, 'ENTRY', $3, $4, $5, $6, $7::jsonb)`,
        [
          context.userId,
          now,
          intent.symbol,
          intent.prescore,
          intent.reason,
          PAPER_SOURCE,
          JSON.stringify({ trade_id: id, paper: true, intent }),
        ],
      );
      opened += 1;
    }

    for (const exit of data.exits) {
      // Read the stop too: the persisted `r` must be NET (computed from the
      // planned 1R), not the price-ratio `r` the client sent.
      const rows = await sql.query<{ contracts: number; stop: string | number }>(
        `select contracts, stop from desk_trades
          where id = $1 and user_id = $2 and mode = $3 and status = 'open'`,
        [exit.tradeId, context.userId, PAPER_MODE],
      );
      const row = rows[0];
      if (row?.contracts == null) continue; // already closed, or not ours
      const contracts = row.contracts;
      const { pnl, commission, r } = paperPnl(exit, contracts, num(row.stop));
      const updated = await sql.query<{ id: string }>(
        `update desk_trades
            set status = 'closed', closed_at = $1::timestamptz, exit = $2,
                pnl = $3, r = $4, commission = $5, slippage = 0, reason = $6
          where id = $7 and user_id = $8 and status = 'open'
          returning id`,
        [
          now,
          exit.exit,
          pnl,
          r,
          commission,
          exit.reason,
          exit.tradeId,
          context.userId,
        ],
      );
      // Only log the EXIT event if THIS call actually closed the row. Two
      // racing cycles would otherwise each append an EXIT for one close,
      // double-counting exits in the audit tape.
      if (!updated.length) continue;
      await sql.query(
        `insert into desk_events
           (user_id, ts, event, symbol, reason, pnl, r, source, payload)
         values ($1, $2::timestamptz, 'EXIT', $3, $4, $5, $6, $7, $8::jsonb)`,
        [
          context.userId,
          now,
          exit.symbol,
          exit.reason,
          pnl,
          r,
          PAPER_SOURCE,
          JSON.stringify({ trade_id: exit.tradeId, paper: true, outcome: exit.outcome }),
        ],
      );
      closed += 1;
    }

    return { opened, closed, skippedDisabled: false };
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
