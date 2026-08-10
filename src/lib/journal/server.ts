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
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { APLUS_RULES, CONTRACTS, type ContractKey } from "@/lib/aplus/config";
import { getSessionClock } from "@/lib/trading/sessions";
import {
  computeRiskFlags,
  currentKillzoneWindow,
  tradingDayStart,
  tradingWeekStart,
  type RiskState,
} from "./risk";

export type { RiskState };

/* ------------------------------------------------------------------ */
/* Shared shapes                                                      */
/* ------------------------------------------------------------------ */

const SYMBOLS = Object.keys(CONTRACTS) as [ContractKey, ...ContractKey[]];

const symbolSchema = z.enum(SYMBOLS);
const sideSchema = z.enum(["long", "short"]);
const modeSchema = z.enum(["live", "paper"]);
const sourceSchema = z.enum(["desk", "engine", "paper"]);
const eventSchema = z.enum(["CANDIDATE", "SKIP", "ENTRY", "EXIT", "HALT"]);

const price = z.number().finite().positive();

export interface JournalTrade {
  id: string;
  mode: "live" | "paper";
  source: "desk" | "engine" | "paper";
  symbol: string;
  side: "long" | "short";
  status: "open" | "closed";
  openedAt: string;
  closedAt: string | null;
  entry: number;
  stop: number | null;
  target: number | null;
  exit: number | null;
  contracts: number;
  pnl: number | null;
  r: number | null;
  commission: number;
  slippage: number;
  reason: string | null;
  prescore: number | null;
  grade: string | null;
  killzone: string | null;
  componentsPresent: string[] | null;
  componentsMissing: string[] | null;
}

/** JSON-safe value — matches what jsonb can hold and what server fns may return. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface DeskEvent {
  id: number;
  ts: string;
  event: "CANDIDATE" | "SKIP" | "ENTRY" | "EXIT" | "HALT";
  symbol: string | null;
  prescore: number | null;
  reason: string | null;
  pnl: number | null;
  r: number | null;
  source: "desk" | "engine" | "paper";
  payload: Record<string, JsonValue> | null;
}

export interface DeskSettings {
  equity: number;
  updatedAt: string | null;
}

type TradeRow = {
  id: string;
  mode: JournalTrade["mode"];
  source: JournalTrade["source"];
  symbol: string;
  side: JournalTrade["side"];
  status: JournalTrade["status"];
  opened_at: string | Date;
  closed_at: string | Date | null;
  entry: number;
  stop: number | null;
  target: number | null;
  exit: number | null;
  contracts: number;
  pnl: number | null;
  r: number | null;
  commission: number;
  slippage: number;
  reason: string | null;
  prescore: number | null;
  grade: string | null;
  killzone: string | null;
  components_present: unknown;
  components_missing: unknown;
};

function iso(v: string | Date): string {
  return (v instanceof Date ? v : new Date(v)).toISOString();
}

function stringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string");
}

function mapTrade(row: TradeRow): JournalTrade {
  return {
    id: row.id,
    mode: row.mode,
    source: row.source,
    symbol: row.symbol,
    side: row.side,
    status: row.status,
    openedAt: iso(row.opened_at),
    closedAt: row.closed_at == null ? null : iso(row.closed_at),
    entry: row.entry,
    stop: row.stop,
    target: row.target,
    exit: row.exit,
    contracts: row.contracts,
    pnl: row.pnl,
    r: row.r,
    commission: row.commission,
    slippage: row.slippage,
    reason: row.reason,
    prescore: row.prescore,
    grade: row.grade,
    killzone: row.killzone,
    componentsPresent: stringArray(row.components_present),
    componentsMissing: stringArray(row.components_missing),
  };
}

const TRADE_COLUMNS = `id, mode, source, symbol, side, status, opened_at,
  closed_at, entry, stop, target, exit, contracts, pnl, r, commission,
  slippage, reason, prescore, grade, killzone, components_present,
  components_missing`;

/* ------------------------------------------------------------------ */
/* Settings                                                           */
/* ------------------------------------------------------------------ */

const DEFAULT_EQUITY = 10_000;

async function readEquity(sql: Sql, userId: string): Promise<number> {
  const rows = await sql<{ equity: number }>`
    select equity from desk_settings where user_id = ${userId}`;
  return rows[0]?.equity ?? DEFAULT_EQUITY;
}

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

/* ------------------------------------------------------------------ */
/* Risk governor (shared — computed here so openTrade can enforce it,   */
/* not just getRiskState display it)                                   */
/* ------------------------------------------------------------------ */

/**
 * Realized PnL / entry counts scoped to `mode = 'live'` ONLY. Paper trades
 * must never move the live halt: a paper loss can't falsely trip the live
 * daily/weekly halt, and a paper win can't falsely clear one that should be
 * active. (Was previously unscoped — both aggregates summed live+paper
 * together, which could both mask a real halt and fire a false one.)
 */
async function computeLiveRiskState(
  sql: Sql,
  userId: string,
): Promise<RiskState> {
  const now = new Date();
  const clock = getSessionClock(now);
  const dayStart = tradingDayStart(now);
  const weekStart = tradingWeekStart(now);
  const kz = currentKillzoneWindow(clock.killzone, now);

  const [equity, aggregates] = await Promise.all([
    readEquity(sql, userId),
    sql<{
      day_pnl: number;
      week_pnl: number;
      kz_entries: number;
      open_trades: number;
    }>`
      select
        coalesce(sum(pnl) filter (
          where status = 'closed' and mode = 'live' and closed_at >= ${dayStart}
        ), 0)::double precision as day_pnl,
        coalesce(sum(pnl) filter (
          where status = 'closed' and mode = 'live' and closed_at >= ${weekStart}
        ), 0)::double precision as week_pnl,
        count(*) filter (
          where mode = 'live' and opened_at >= ${kz.startUtc} and opened_at < ${kz.endUtc}
        ) as kz_entries,
        count(*) filter (where mode = 'live' and status = 'open') as open_trades
      from desk_trades
      where user_id = ${userId}`,
  ]);

  const agg = aggregates[0] ?? {
    day_pnl: 0,
    week_pnl: 0,
    kz_entries: 0,
    open_trades: 0,
  };

  return computeRiskFlags({
    equity,
    dayPnl: Number(agg.day_pnl),
    weekPnl: Number(agg.week_pnl),
    entriesThisKillzone: Number(agg.kz_entries),
    openTrades: Number(agg.open_trades),
    clock,
    dayStart,
    weekStart,
  });
}

/* ------------------------------------------------------------------ */
/* Open / close trades                                                */
/* ------------------------------------------------------------------ */

const openTradeSchema = z
  .object({
    symbol: symbolSchema,
    side: sideSchema,
    entry: price,
    stop: price.optional(),
    target: price.optional(),
    contracts: z.number().int().min(1).max(1000),
    mode: modeSchema.default("live"),
    source: sourceSchema.default("desk"),
    prescore: z.number().min(0).max(1).optional(),
    grade: z.enum(["A+", "A-", "B", "skip"]).optional(),
    killzone: z.string().max(32).optional(),
    componentsPresent: z.array(z.string().max(200)).max(30).optional(),
    componentsMissing: z.array(z.string().max(200)).max(30).optional(),
    reason: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    // Stop must sit on the loss side of entry; target on the profit side.
    if (v.stop != null) {
      const ok = v.side === "long" ? v.stop < v.entry : v.stop > v.entry;
      if (!ok)
        ctx.addIssue({
          code: "custom",
          path: ["stop"],
          message: `Stop must be ${v.side === "long" ? "below" : "above"} entry for a ${v.side}`,
        });
    }
    if (v.target != null) {
      const ok = v.side === "long" ? v.target > v.entry : v.target < v.entry;
      if (!ok)
        ctx.addIssue({
          code: "custom",
          path: ["target"],
          message: `Target must be ${v.side === "long" ? "above" : "below"} entry for a ${v.side}`,
        });
    }
  });

export type OpenTradeInput = z.input<typeof openTradeSchema>;

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
        throw new Error(
          `Daily halt active: day PnL ${risk.dayPnl.toFixed(2)} <= -${risk.dailyLimit.toFixed(2)}. No new live entries today.`,
        );
      }
      if (risk.weeklyHaltHit) {
        throw new Error(
          `Weekly halt active: week PnL ${risk.weekPnl.toFixed(2)} <= -${risk.weeklyLimit.toFixed(2)}. No new live entries this week.`,
        );
      }
      if (risk.killzoneCapHit) {
        throw new Error(
          `Killzone cap reached (${risk.entriesThisKillzone}/${risk.killzoneCap} in ${risk.killzoneLabel}). No new live entries this window.`,
        );
      }
    }

    const now = new Date();
    const id = crypto.randomUUID();
    const present = data.componentsPresent
      ? JSON.stringify(data.componentsPresent)
      : null;
    const missing = data.componentsMissing
      ? JSON.stringify(data.componentsMissing)
      : null;

    const rows = await sql.query<TradeRow>(
      `insert into desk_trades (
         id, user_id, mode, source, symbol, side, status, opened_at, entry,
         stop, target, contracts, reason, prescore, grade, killzone,
         components_present, components_missing
       ) values (
         $1, $2, $3, $4, $5, $6, 'open', $7, $8, $9, $10, $11, $12, $13,
         $14, $15, $16::jsonb, $17::jsonb
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
      ],
    );

    await sql`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, source, payload)
      values (${context.userId}, ${now}, 'ENTRY', ${data.symbol},
              ${data.prescore ?? null},
              ${data.reason ?? `${data.side} ${data.contracts}x @ ${data.entry}`},
              ${data.source},
              ${JSON.stringify({ tradeId: id, side: data.side, entry: data.entry, stop: data.stop ?? null, target: data.target ?? null, contracts: data.contracts, grade: data.grade ?? null, killzone: data.killzone ?? null })}::jsonb)`;

    return mapTrade(rows[0]!);
  });

const closeTradeSchema = z.object({
  id: z.string().min(1).max(64),
  exit: price,
  slippage: z.number().finite().min(0).max(100_000).default(0),
  reason: z.string().max(500).optional(),
});

export type CloseTradeInput = z.input<typeof closeTradeSchema>;

export const closeTrade = createServerFn({ method: "POST" })
  .validator((input: unknown) => closeTradeSchema.parse(input))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade> => {
    const sql = await getSql();
    const open = await sql.query<TradeRow>(
      `select ${TRADE_COLUMNS} from desk_trades
       where id = $1 and user_id = $2 and status = 'open'`,
      [data.id, context.userId],
    );
    const trade = open[0];
    if (!trade) throw new Error("Open trade not found");

    const contract = CONTRACTS[trade.symbol as ContractKey];
    if (!contract) throw new Error(`Unknown contract symbol: ${trade.symbol}`);

    const dir = trade.side === "long" ? 1 : -1;
    const commission = contract.commission * trade.contracts;
    const gross =
      (data.exit - trade.entry) * contract.pointValue * trade.contracts * dir;
    const pnl = gross - commission - data.slippage;
    // 1R = planned dollar risk (|entry - stop| * pointValue * contracts).
    const riskDollars =
      trade.stop != null
        ? Math.abs(trade.entry - trade.stop) *
          contract.pointValue *
          trade.contracts
        : 0;
    const r = riskDollars > 0 ? pnl / riskDollars : null;

    const now = new Date();
    const rows = await sql.query<TradeRow>(
      `update desk_trades
       set status = 'closed', closed_at = $1, exit = $2, pnl = $3, r = $4,
           commission = $5, slippage = $6,
           reason = coalesce($7, reason)
       where id = $8 and user_id = $9 and status = 'open'
       returning ${TRADE_COLUMNS}`,
      [
        now,
        data.exit,
        pnl,
        r,
        commission,
        data.slippage,
        data.reason ?? null,
        data.id,
        context.userId,
      ],
    );
    if (!rows[0]) throw new Error("Open trade not found");

    await sql`
      insert into desk_events (user_id, ts, event, symbol, prescore, reason, pnl, r, source, payload)
      values (${context.userId}, ${now}, 'EXIT', ${trade.symbol},
              ${trade.prescore}, ${data.reason ?? `exit @ ${data.exit}`},
              ${pnl}, ${r}, ${trade.source},
              ${JSON.stringify({ tradeId: trade.id, exit: data.exit, slippage: data.slippage })}::jsonb)`;

    return mapTrade(rows[0]);
  });

/* ------------------------------------------------------------------ */
/* Listing                                                            */
/* ------------------------------------------------------------------ */

const listTradesSchema = z.object({
  status: z.enum(["open", "closed"]).optional(),
  limit: z.number().int().min(1).max(500).default(200),
  offset: z.number().int().min(0).default(0),
});

export const listTrades = createServerFn({ method: "GET" })
  .validator((input: unknown) => listTradesSchema.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<JournalTrade[]> => {
    const sql = await getSql();
    const rows = data.status
      ? await sql.query<TradeRow>(
          `select ${TRADE_COLUMNS} from desk_trades
           where user_id = $1 and status = $2
           order by opened_at desc limit $3 offset $4`,
          [context.userId, data.status, data.limit, data.offset],
        )
      : await sql.query<TradeRow>(
          `select ${TRADE_COLUMNS} from desk_trades
           where user_id = $1
           order by opened_at desc limit $2 offset $3`,
          [context.userId, data.limit, data.offset],
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
