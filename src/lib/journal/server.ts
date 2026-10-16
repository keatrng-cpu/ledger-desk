/**
 * Journal + risk-governor server functions (Phase 1).
 *
 * Every fn: authenticate (authMiddleware) -> authorize (scope by
 * context.userId) -> validate (zod). All SQL is parameterized via the shared
 * `Sql` surface (tagged template / $n placeholders) — never string
 * interpolation. PnL is NET of commission + slippage, using CONTRACTS point
 * values from src/lib/aplus/config.ts. The governor (getRiskState) is pure
 * SQL aggregates + deterministic math from src/lib/journal/risk.ts.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { APLUS_RULES } from "@/lib/aplus/config";
import { appendAttestation } from "./attest-server";
import { closeTradeSchema, realFillSchema } from "./fill-schemas";

export { closeTradeSchema, realFillSchema };
import { sendAlert, haltHitAlert } from "@/lib/alerts/send-server";
import { PATH_MONTH_CAP, aPlusFullSizeUnlocked } from "@/lib/trading/profit-rules";
import type { RiskState } from "./risk";

export type { RiskState };

import {
  symbolSchema,
  sourceSchema,
  eventSchema,
  iso,
  mapTrade,
  TRADE_COLUMNS,
  DEFAULT_EQUITY,
  computeLiveRiskState,
  strategyFromReason,
  readBookCounters,
  assertOpenAllowed,
  openTradeSchema,
  withRealizedPnl,
  closeTradeFor,
  recordRealFillFor,
  type JournalTrade,
  type JsonValue,
  type DeskEvent,
  type DeskSettings,
  type TradeRow,
  type OpenGateInput,
  type OpenTradeInput,
  type LiveFillOpts,
  type CloseTradeInput,
  type RealFillInput,
} from "./server-core";
export {
  computeLiveRiskState,
  assertOpenAllowed,
  withRealizedPnl,
  closeTradeFor,
  recordRealFillFor,
};
export type {
  JournalTrade,
  JsonValue,
  DeskEvent,
  DeskSettings,
  OpenGateInput,
  OpenTradeInput,
  LiveFillOpts,
  CloseTradeInput,
  RealFillInput,
};


export const getSettings = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<DeskSettings> => {
    const sql = await getSql();
    const rows = await sql<{ equity: number; updated_at: string | Date }>`
      select equity, updated_at from desk_settings
      where user_id = ${context.userId}`;
    if (!rows[0]) return { equity: DEFAULT_EQUITY, updatedAt: null };
    return { equity: rows[0].equity, updatedAt: iso(rows[0].updated_at) };
  });

const updateEquitySchema = z.object({
  equity: z.number().finite().min(100).max(100_000_000),
});

export const updateEquity = createServerFn({ method: "POST" })
  .validator((input: unknown) => updateEquitySchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<DeskSettings> => {
    const sql = await getSql();
    const rows = await sql<{ equity: number; updated_at: string | Date }>`
      insert into desk_settings (user_id, equity, updated_at)
      values (${context.userId}, ${data.equity}, now())
      on conflict (user_id)
      do update set equity = excluded.equity, updated_at = now()
      returning equity, updated_at`;
    return { equity: rows[0]!.equity, updatedAt: iso(rows[0]!.updated_at) };
  });

export const openTrade = createServerFn({ method: "POST" })
  .validator((input: unknown) => openTradeSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade> => {
    const sql = await getSql();

    // Server-side halt enforcement. The governor was previously advisory-only
    // (UI hid the Log button off a client poll that can be up to 30s stale) —
    // nothing stopped a direct call to this function from opening a live
    // trade past a halt. Paper trades are exempt: they exist specifically to
    // keep building the sample while live is halted (ROADMAP Phase 4).
    if (data.mode === "live") {
      const risk = await computeLiveRiskState(sql, context.userId);
      if (risk.dailyHaltHit) {
        const detail = `Day PnL ${risk.dayPnl.toFixed(2)} <= -${risk.dailyLimit.toFixed(2)}.`;
        void sendAlert(context.userId, haltHitAlert({ scope: "daily", detail })).catch(
          () => undefined,
        );
        throw new Error(`Daily halt active: ${detail} No new live entries today.`);
      }
      if (risk.weeklyHaltHit) {
        const detail = `Week PnL ${risk.weekPnl.toFixed(2)} <= -${risk.weeklyLimit.toFixed(2)}.`;
        void sendAlert(context.userId, haltHitAlert({ scope: "weekly", detail })).catch(
          () => undefined,
        );
        throw new Error(`Weekly halt active: ${detail} No new live entries this week.`);
      }
    }

    // Profit-rule gate (ROADMAP B1) — same pathTakeGate the backtest runs.
    // Live gets the whole gate; paper gets one-book-per-day only. The why is
    // documented on assertOpenAllowed above.
    await assertOpenAllowed(sql, context.userId, data);

    const now = new Date();
    const id = crypto.randomUUID();
    const present = data.componentsPresent
      ? JSON.stringify(data.componentsPresent)
      : null;
    const missing = data.componentsMissing
      ? JSON.stringify(data.componentsMissing)
      : null;

    // A partial unique index (migrations/0005) allows only ONE open position
    // per mode+symbol+side. Surface that as a readable message instead of a
    // raw Postgres constraint error — and note it is per MODE, so an open
    // paper position never blocks the equivalent live entry.
    const existing = await sql.query<{ id: string }>(
      `select id from desk_trades
        where user_id = $1 and mode = $2 and symbol = $3 and side = $4
          and status = 'open'`,
      [context.userId, data.mode, data.symbol, data.side],
    );
    if (existing.length) {
      throw new Error(
        `Already holding an open ${data.mode} ${data.side} in ${data.symbol}. Close it before adding another — one idea per instrument.`,
      );
    }

    const rows = await sql.query<TradeRow>(
      `insert into desk_trades (
         id, user_id, mode, source, symbol, side, status, opened_at, entry,
         stop, target, contracts, reason, prescore, grade, killzone,
         components_present, components_missing, strategy, regime
       ) values (
         $1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16::jsonb, $17::jsonb, $18, $19
       )
       returning ${TRADE_COLUMNS}`,
      [
        id,
        context.userId,
        data.mode,
        data.source,
        data.symbol,
        data.side,
        now,
        data.entry,
        data.stop ?? null,
        data.target ?? null,
        data.contracts,
        data.reason ?? null,
        data.prescore ?? null,
        data.grade ?? null,
        data.killzone ?? null,
        present,
        missing,
        // Attribution for the Phase C scoreboard / regime matrix: the explicit
        // field, else the `strategy:x` the log dialog already writes into
        // reason. NULL stays NULL — never guess a model; an unattributed trade
        // is reported as unattributed rather than assigned to something.
        data.strategyPrimary?.toLowerCase() ??
          strategyFromReason(data.reason) ??
          null,
        data.regime ?? null,
      ],
    );

    await sql`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, source, payload)
      values (${context.userId}, ${now}, 'ENTRY', ${data.symbol},
              ${data.prescore ?? null},
              ${data.reason ?? `${data.side} ${data.contracts}x @ ${data.entry}`},
              ${data.source},
              ${JSON.stringify({ tradeId: id, side: data.side, entry: data.entry, stop: data.stop ?? null, target: data.target ?? null, contracts: data.contracts, grade: data.grade ?? null, killzone: data.killzone ?? null })}::jsonb)`;

    // Seal the entry into the tamper-evident chain. Never throws — a fill that
    // happened is recorded either way, and a gap is reported by
    // findUnattestedTrades() rather than papered over. See attest-server.ts.
    await appendAttestation(sql, { ...rows[0]!, user_id: context.userId }, "open");

    return mapTrade(rows[0]!);
  });


export const closeTrade = createServerFn({ method: "POST" })
  .validator((input: unknown) => closeTradeSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade> => closeTradeFor(await getSql(), context.userId, data));

/* ------------------------------------------------------------------ */
/* Book counters — the profit-rule state, visible                      */
/* ------------------------------------------------------------------ */

export interface BookCountersView {
  mode: "live" | "paper";
  pathThisMonth: number;
  pathCap: number;
  aPlusTaken: number;
  aPlusWins: number;
  /** n >= 20 closed A+ at WR >= 65% — rule 5's unlock. */
  aPlusUnlocked: boolean;
  consecLosses: number;
  bookTakenToday: string | null;
}

/**
 * The counters the open gate reads — PATH this month against the cap, the
 * A+ unlock sample, the loss streak, today's book — which were computed on
 * every open and shown nowhere. A cap you cannot see is a cap you hit by
 * surprise.
 */
export const getBookCounters = createServerFn({ method: "GET" })
  .validator((input: unknown) =>
    z.object({ mode: z.enum(["live", "paper"]).default("live") }).parse(input ?? {}),
  )
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<BookCountersView> => {
    const sql = await getSql();
    const { counters, bookTakenToday } = await readBookCounters(sql, context.userId, data.mode, new Date());
    return {
      mode: data.mode,
      pathThisMonth: counters.pathThisMonth,
      pathCap: PATH_MONTH_CAP,
      aPlusTaken: counters.aPlusTaken,
      aPlusWins: counters.aPlusWins,
      aPlusUnlocked: aPlusFullSizeUnlocked(counters),
      consecLosses: counters.consecLosses,
      bookTakenToday: bookTakenToday ?? null,
    };
  });

/* ------------------------------------------------------------------ */
/* Real fills — recorded, never refused                                */
/* ------------------------------------------------------------------ */


export const recordRealFill = createServerFn({ method: "POST" })
  .validator((input: unknown) => realFillSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade> => recordRealFillFor(await getSql(), context.userId, data));

/* ------------------------------------------------------------------ */
/* Listing                                                            */
/* ------------------------------------------------------------------ */

const listTradesSchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  /**
   * REQUIRED in spirit: live and paper must never be summed into one metric.
   * Defaults to 'live' rather than "all" so that a caller which forgets to
   * specify cannot silently blend a clean paper sample into the live record.
   * Pass 'all' only for a view that visibly separates them by the `mode` field.
   *
   * This defaulted to everything until paper rows started landing in
   * desk_trades (paper-mirror.ts), at which point Path win rate — the metric
   * the whole unlock ladder gates on — began quietly averaging paper in.
   */
  mode: z.enum(["live", "paper", "all"]).default("live"),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
});

export const listTrades = createServerFn({ method: "GET" })
  .validator((input: unknown) => listTradesSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade[]> => {
    const sql = await getSql();
    const where: string[] = ["user_id = $1"];
    const params: unknown[] = [context.userId];
    if (data.status) {
      params.push(data.status);
      where.push(`status = $${params.length}`);
    }
    if (data.mode !== "all") {
      params.push(data.mode);
      where.push(`mode = $${params.length}`);
    }
    params.push(data.limit, data.offset);
    const rows = await sql.query<TradeRow>(
      `select ${TRADE_COLUMNS} from desk_trades
        where ${where.join(" and ")}
        order by opened_at desc
        limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return rows.map(mapTrade);
  });

/* ------------------------------------------------------------------ */
/* Events                                                             */
/* ------------------------------------------------------------------ */

const logEventSchema = z.object({
  event: eventSchema,
  symbol: symbolSchema.optional(),
  prescore: z.number().min(0).max(1).optional(),
  reason: z.string().max(500).optional(),
  pnl: z.number().finite().optional(),
  r: z.number().finite().optional(),
  source: sourceSchema.default("desk"),
  payload: z.record(z.string(), z.unknown()).optional(),
});

export type LogEventInput = z.input<typeof logEventSchema>;

export const logEvent = createServerFn({ method: "POST" })
  .validator((input: unknown) => logEventSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ id: number }> => {
    const sql = await getSql();
    const rows = await sql<{ id: number }>`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
      values (${context.userId}, ${new Date()}, ${data.event},
              ${data.symbol ?? null}, ${data.prescore ?? null},
              ${data.reason ?? null}, ${data.pnl ?? null}, ${data.r ?? null},
              ${data.source},
              ${data.payload ? JSON.stringify(data.payload) : null}::jsonb)
      returning id`;
    return { id: rows[0]!.id };
  });

const listEventsSchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
  event: eventSchema.optional(),
});

type EventRow = {
  id: number;
  ts: string | Date;
  event: DeskEvent["event"];
  symbol: string | null;
  prescore: number | null;
  reason: string | null;
  pnl: number | null;
  r: number | null;
  source: DeskEvent["source"];
  payload: unknown;
};

export const listEvents = createServerFn({ method: "GET" })
  .validator((input: unknown) => listEventsSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<DeskEvent[]> => {
    const sql = await getSql();
    const rows = data.event
      ? await sql.query<EventRow>(
          `select id, ts, event, symbol, prescore, reason, pnl, r, source, payload
           from desk_events where user_id = $1 and event = $2
           order by ts desc, id desc limit $3 offset $4`,
          [context.userId, data.event, data.limit, data.offset],
        )
      : await sql.query<EventRow>(
          `select id, ts, event, symbol, prescore, reason, pnl, r, source, payload
           from desk_events where user_id = $1
           order by ts desc, id desc limit $2 offset $3`,
          [context.userId, data.limit, data.offset],
        );
    return rows.map((row) => ({
      id: row.id,
      ts: iso(row.ts),
      event: row.event,
      symbol: row.symbol,
      prescore: row.prescore,
      reason: row.reason,
      pnl: row.pnl,
      r: row.r,
      source: row.source,
      payload:
        row.payload && typeof row.payload === "object"
          ? (row.payload as Record<string, JsonValue>)
          : null,
    }));
  });

/* ------------------------------------------------------------------ */
/* Risk governor                                                      */
/* ------------------------------------------------------------------ */

export const getRiskState = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }): Promise<RiskState> => {
    const sql = await getSql();
    return computeLiveRiskState(sql, context.userId);
  });

/** Re-export for UI risk-sizing display (equity * riskPct). */
export const RISK_PCT = APLUS_RULES.riskPct;
