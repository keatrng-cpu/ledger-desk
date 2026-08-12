/**
 * Analytics server functions.
 *
 * Live and paper are computed as SEPARATE reports and returned as separate
 * fields — never summed, never averaged together. The client renders one at a
 * time behind an explicit mode switch, so there is no view in the product
 * where a paper result can be mistaken for a live one.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { getSql, type Sql } from "@/lib/db";
import { authMiddleware } from "@/lib/auth/middleware";
import { APLUS_RULES } from "@/lib/aplus/config";
import {
  buildAnalytics,
  type AnalyticsReport,
  type AnalyticsTrade,
} from "./analytics";

/**
 * Fallback starting equity when the user has no `desk_settings` row.
 *
 * MUST track APLUS_RULES.accountEquity (and PAPER_START_EQUITY, which is
 * APLUS_RULES.paperEquity). A hardcoded 10_000 here meant the equity curve,
 * return % and drawdown % in AnalyticsPanel were computed off a base 10x
 * smaller than the one the paper book and RiskPanel display, on the same tab.
 */
const DEFAULT_EQUITY = APLUS_RULES.accountEquity;

type Row = {
  id: string;
  symbol: string;
  side: "long" | "short";
  opened_at: string | Date;
  closed_at: string | Date;
  entry: number;
  exit: number | null;
  pnl: number | null;
  r: number | null;
  commission: number;
  slippage: number;
  reason: string | null;
  prescore: number | null;
  grade: string | null;
  killzone: string | null;
};

const iso = (v: string | Date): string =>
  (v instanceof Date ? v : new Date(v)).toISOString();

function toAnalyticsTrade(row: Row): AnalyticsTrade {
  return {
    id: row.id,
    symbol: row.symbol,
    side: row.side,
    opened: iso(row.opened_at),
    closed: iso(row.closed_at),
    entry: row.entry,
    exit: row.exit ?? 0,
    pnl: row.pnl ?? 0,
    // `r` is nullable in the DB (no stop = no defined 1R). NaN keeps it out of
    // every R aggregate via the Number.isFinite guards, without pretending it
    // was a 0R trade — a 0 would silently drag expectancy toward zero.
    r: row.r ?? Number.NaN,
    commission: row.commission,
    slippage: row.slippage,
    reason: row.reason ?? "",
    confluence: row.prescore ?? undefined,
    grade: row.grade,
    killzone: row.killzone,
  };
}

/** Closed trades for ONE mode, oldest-first. Never call without a mode. */
async function readClosed(
  sql: Sql,
  userId: string,
  mode: "live" | "paper",
  sinceIso: string | null,
): Promise<AnalyticsTrade[]> {
  const rows = sinceIso
    ? await sql.query<Row>(
        `select id, symbol, side, opened_at, closed_at, entry, exit, pnl, r,
                commission, slippage, reason, prescore, grade, killzone
           from desk_trades
          where user_id = $1 and mode = $2 and status = 'closed'
            and closed_at >= $3::timestamptz
          order by closed_at asc`,
        [userId, mode, sinceIso],
      )
    : await sql.query<Row>(
        `select id, symbol, side, opened_at, closed_at, entry, exit, pnl, r,
                commission, slippage, reason, prescore, grade, killzone
           from desk_trades
          where user_id = $1 and mode = $2 and status = 'closed'
          order by closed_at asc`,
        [userId, mode],
      );
  return rows.map(toAnalyticsTrade);
}

async function readEquity(sql: Sql, userId: string): Promise<number> {
  const rows = await sql<{ equity: number }>`
    select equity from desk_settings where user_id = ${userId}`;
  return rows[0]?.equity ?? DEFAULT_EQUITY;
}

export interface DisciplineStats {
  /** Desk events by type, current trading window — the "did I follow rules" tape. */
  candidates: number;
  skips: number;
  entries: number;
  exits: number;
  halts: number;
  /**
   * Skips ÷ (skips + entries). Selectivity is the edge this desk is built on;
   * a collapsing skip ratio is the earliest visible sign of over-trading.
   */
  skipRatio: number | null;
}

export interface AnalyticsPayload {
  live: AnalyticsReport;
  paper: AnalyticsReport;
  discipline: DisciplineStats;
  equity: number;
  generatedAt: string;
}

const analyticsInput = z.object({
  /** ISO date to start from. Omit for all time. */
  since: z.string().datetime().nullable().optional(),
});

export const getAnalytics = createServerFn({ method: "GET" })
  .validator((input: unknown) => analyticsInput.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<AnalyticsPayload> => {
    const sql = await getSql();
    const since = data.since ?? null;

    const [equity, liveTrades, paperTrades, events] = await Promise.all([
      readEquity(sql, context.userId),
      readClosed(sql, context.userId, "live", since),
      readClosed(sql, context.userId, "paper", since),
      sql.query<{ event: string; n: number }>(
        `select event, count(*)::int as n
           from desk_events
          where user_id = $1
          group by event`,
        [context.userId],
      ),
    ]);

    const byEvent = new Map(events.map((e) => [e.event, e.n]));
    const skips = byEvent.get("SKIP") ?? 0;
    const entries = byEvent.get("ENTRY") ?? 0;
    const decisions = skips + entries;

    return {
      // Two independent reports. Deliberately not merged.
      live: buildAnalytics(liveTrades, "live", equity),
      paper: buildAnalytics(paperTrades, "paper", equity),
      discipline: {
        candidates: byEvent.get("CANDIDATE") ?? 0,
        skips,
        entries,
        exits: byEvent.get("EXIT") ?? 0,
        halts: byEvent.get("HALT") ?? 0,
        skipRatio: decisions > 0 ? skips / decisions : null,
      },
      equity,
      generatedAt: new Date().toISOString(),
    };
  });

/* ------------------------------------------------------------------ */
/* Export                                                             */
/* ------------------------------------------------------------------ */

const CSV_COLUMNS = [
  "id",
  "mode",
  "source",
  "symbol",
  "side",
  "status",
  "opened_at",
  "closed_at",
  "entry",
  "stop",
  "target",
  "exit",
  "contracts",
  "pnl",
  "r",
  "commission",
  "slippage",
  "prescore",
  "grade",
  "killzone",
  "reason",
] as const;

/** RFC4180-ish escaping: quote anything containing a comma, quote, or newline. */
function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = v instanceof Date ? v.toISOString() : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const exportInput = z.object({
  mode: z.enum(["live", "paper", "all"]).default("all"),
});

/**
 * Full journal as CSV. Ownership of the record matters: this data is the
 * founder's own trading history and must be extractable without a database
 * client — for an accountant, a spreadsheet, or another analysis tool.
 * `mode` is a column in the output, so an "all" export stays separable.
 */
export const exportTradesCsv = createServerFn({ method: "GET" })
  .validator((input: unknown) => exportInput.parse(input ?? {}))
  .middleware([authMiddleware])
  .handler(async ({ data, context }): Promise<{ csv: string; rows: number }> => {
    const sql = await getSql();
    const cols = CSV_COLUMNS.join(", ");
    const rows =
      data.mode === "all"
        ? await sql.query<Record<string, unknown>>(
            `select ${cols} from desk_trades
              where user_id = $1 order by opened_at desc`,
            [context.userId],
          )
        : await sql.query<Record<string, unknown>>(
            `select ${cols} from desk_trades
              where user_id = $1 and mode = $2 order by opened_at desc`,
            [context.userId, data.mode],
          );

    const header = CSV_COLUMNS.join(",");
    const body = rows
      .map((r) => CSV_COLUMNS.map((c) => csvCell(r[c])).join(","))
      .join("\n");

    return { csv: rows.length ? `${header}\n${body}` : header, rows: rows.length };
  });

/** Re-export so UI can show the configured risk model alongside results. */
export const ANALYTICS_RISK_PCT = APLUS_RULES.riskPct;
