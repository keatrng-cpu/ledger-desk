/**
 * Watcher → Supabase fill record (POST /api/desk/fills).
 *
 * The desk-watcher places and manages the live Robinhood option orders but has no database credentials (and must
 * not get any). It reports each order event here with the WATCHER_STATUS_TOKEN bearer; this module writes:
 *   - room_orders: one row per entry order, keyed (user_id, client_order_id = signal). Replays are no-ops on insert
 *     and monotonic on update (placed → filled → closed; a terminal row never goes back).
 *   - desk_trades: on `filled`, recordRealFillFor (the same path as a hand-logged real fill: records the gates it
 *     WOULD have tripped, never refuses). entry/stop/exit are in UNDERLIER terms (ES/MNQ plan, so R is the plan R),
 *     but `pnl` is the REAL option-premium P&L ((exit - fill) premium x qty x 100), because pnl feeds the live
 *     daily/weekly halt (computeLiveRiskState) and cron-stats live_net. On `exit`, closeTradeFor.
 *   - Out of order: an exit that arrives before its fill is stored on the order (intent.exit) and opens nothing; the
 *     late fill then records the trade opened AND closed in one insert, so it never leaves an open row behind.
 *   - Every input is validated through the journal's own zod schemas (fill-schemas.ts) BEFORE any write; a payload
 *     they refuse (e.g. stop on the wrong side of the plan entry) is a 422 and writes nothing.
 *   - desk_card_journal.signal (migration 0027): stamped on the matching card (same ET day/symbol/side, entry within
 *     tolerance, opened <= 4 h before the fill) when it has none.
 * Shadow / dry-run events are refused (422): this table is the record of what reached the broker.
 * Nothing here places, cancels or gates an order.
 */
import { z } from "zod";
import type { Sql } from "@/lib/db";
import { closeTradeSchema, realFillSchema } from "@/lib/journal/fill-schemas";
import type { ExitReason } from "@/lib/journal/discipline";

const sig = z.string().regex(/^sig-[0-9a-f]{16}$/);
const px = z.number().finite();

export const watcherFillSchema = z.object({
  event: z.enum(["placed", "filled", "rejected", "exit"]),
  signal: sig,
  orderId: z.string().max(64).optional(),           // RH order id (entry order for placed/filled, closing order for exit)
  atMs: z.number().int().positive(),
  symbol: z.enum(["ES", "MNQ"]),                     // the card (underlier future)
  side: z.enum(["long", "short"]),
  band: z.string().max(4).optional(),
  plan: z.object({ entry: px, stop: px, t1: px.optional() }),
  option: z.object({ underlier: z.string().max(8), right: z.enum(["call", "put"]), strike: px, expiry: z.string().max(10), limit: px.optional() }).optional(),
  qty: z.number().int().min(1).max(50),
  fillPx: px.optional(),                             // option premium
  exitPx: px.optional(),                             // option premium at exit
  exitUnderlierPx: px.optional(),                    // underlier price that triggered the exit (desk_trades exit, underlier terms)
  optionPnl: px.optional(),
  reason: z.string().max(300).optional(),
  shadow: z.boolean().optional(),
  dryRun: z.boolean().optional(),
}).superRefine((v, ctx) => {
  if (v.event === "filled" && v.fillPx == null) ctx.addIssue({ code: "custom", path: ["fillPx"], message: "filled needs fillPx" });
  if (v.event === "exit" && v.exitPx == null) ctx.addIssue({ code: "custom", path: ["exitPx"], message: "exit needs exitPx" });
});
export type WatcherFill = z.output<typeof watcherFillSchema>;

const ORDER_RANK: Record<string, number> = { placed: 1, rejected: 2, filled: 2, closed: 3 };
export function nextOrderStatus(current: string | null, event: WatcherFill["event"]): string {
  const want = event === "exit" ? "closed" : event;
  if (!current) return want;
  return (ORDER_RANK[want] ?? 0) > (ORDER_RANK[current] ?? 0) ? want : current;
}

/** Free-text watcher exit reason -> journal EXIT_REASON_IDS (the enum closeTrade/recordRealFill accept). */
export function exitReasonId(text: string | undefined): ExitReason {
  const t = (text ?? "").toLowerCase();
  if (/break ?even|\bbe\b/.test(t)) return "be";
  if (/\bt2\b/.test(t)) return "t2";
  if (/\bt1\b|target/.test(t)) return "t1_runner";
  if (/stop/.test(t)) return "stop";
  if (/time|eod|session|close/.test(t)) return "time";
  return "discretionary";
}

/** Option-premium P&L in dollars: the watcher's own number, else (exit - fill) premium x qty x 100. */
export function optionPnl(exit: { exitPx?: number; optionPnl?: number; qty: number }, fillPx: number | null | undefined): number | null {
  if (exit.exitPx != null && fillPx != null) return Math.round((exit.exitPx - fillPx) * exit.qty * 100 * 100) / 100;
  return exit.optionPnl ?? null;
}

export class WatcherFillRefused extends Error {}

export function realFillInput(f: WatcherFill) {
  const opt = f.option ? `${f.qty}x ${f.option.underlier} ${f.option.expiry} ${f.option.strike}${f.option.right === "call" ? "C" : "P"} @ ${f.fillPx ?? "?"}` : `${f.qty}x @ ${f.fillPx ?? "?"}`;
  return {
    symbol: f.symbol, side: f.side, entry: f.plan.entry, stop: f.plan.stop, target: f.plan.t1, contracts: f.qty,
    filledAt: new Date(f.atMs).toISOString(), planEntry: f.plan.entry, planStop: f.plan.stop,
    pathBand: f.band && ["A+", "A", "A-", "B+", "B", "C"].includes(f.band) ? (f.band as "A+" | "A" | "A-" | "B+" | "B" | "C") : undefined,
    reason: `watcher ${f.signal}${f.orderId ? ` rh ${f.orderId}` : ""}`,
    why: `desk-watcher live fill: ${opt}`.slice(0, 500),
  };
}

/** Parse through a journal schema; a refusal is a 422 (permanent), never a 503. */
function journalParse<S extends typeof realFillSchema | typeof closeTradeSchema>(schema: S, input: unknown, what: string): ReturnType<S["parse"]> {
  const p = schema.safeParse(input);
  if (!p.success) throw new WatcherFillRefused(`${what}: ${p.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  return p.data as ReturnType<S["parse"]>;
}

type StoredExit = { atMs: number; qty: number; exitPx?: number; exitUnderlierPx?: number; optionPnl?: number; reason?: string; orderId?: string };
type OrderRow = { id: string; status: string; filled_avg_px: number | string | null; exit: StoredExit | null; inserted: boolean };

export type ApplyResult = { ok: true; order: "inserted" | "updated" | "unchanged"; trade?: "opened" | "closed" | "opened_closed" | "exists" | "none"; cardStamped?: number };

export type WatcherFillDeps = {
  recordRealFillFor: (sql: Sql, userId: string, data: ReturnType<typeof realFillSchema.parse>, opts?: { realizedPnl?: number }) => Promise<{ id: string }>;
  closeTradeFor: (sql: Sql, userId: string, data: ReturnType<typeof closeTradeSchema.parse>, opts?: { realizedPnl?: number }) => Promise<unknown>;
};

/** Watcher rows live in room_orders with phase 'watcher' so the room executor's audit/evidence reads never see them. */
export const WATCHER_PHASE = "watcher";

const RANK_SQL = `(case room_orders.status when 'placed' then 1 when 'rejected' then 2 when 'filled' then 2 when 'closed' then 3 else 0 end)`;

/**
 * ONE statement: insert, or forward-only update with the rank check in the WHERE (no read-modify-write window).
 * A late `filled` on an already-closed row only back-fills the fill price/qty (status stays closed).
 * The reason is appended only if it is not already in the array, so a replayed exit cannot duplicate it.
 */
const UPSERT_SQL = `
insert into room_orders (user_id, client_order_id, phase, role, symbol, side, qty, limit_px, status, broker_status, reasons, broker_order_id, filled_qty, filled_avg_px, intent, at_ms, updated_ms)
values ($1, $2, '${WATCHER_PHASE}', 'watcher', $3, $4, $5, $6, $7, $8,
        case when $9::text is null then '[]'::jsonb else jsonb_build_array($9::text) end,
        $10, case when $8 = 'filled' then $11::int else 0 end, case when $8 = 'filled' then $12::numeric else null end,
        $13::jsonb || case when $14::jsonb is null then '{}'::jsonb else jsonb_build_object('exit', $14::jsonb) end, $15, $16)
on conflict (user_id, client_order_id) do update set
  status = case when ${RANK_SQL} < $17 then excluded.status else room_orders.status end,
  broker_status = case when ${RANK_SQL} < $17 then excluded.broker_status else room_orders.broker_status end,
  updated_ms = excluded.updated_ms,
  broker_order_id = coalesce(room_orders.broker_order_id, excluded.broker_order_id),
  filled_qty = case when $8 = 'filled' and room_orders.filled_avg_px is null then $11::int else room_orders.filled_qty end,
  filled_avg_px = case when $8 = 'filled' and room_orders.filled_avg_px is null then $12::numeric else room_orders.filled_avg_px end,
  reasons = case when $9::text is null or room_orders.reasons @> jsonb_build_array($9::text) then room_orders.reasons
                 else room_orders.reasons || jsonb_build_array($9::text) end,
  intent = case when $14::jsonb is null or (room_orders.intent -> 'exit') is not null then room_orders.intent
                else room_orders.intent || jsonb_build_object('exit', $14::jsonb) end
where ${RANK_SQL} < $17 or ($8 = 'filled' and room_orders.filled_avg_px is null)
returning id, status, filled_avg_px, intent->'exit' as exit, (xmax = 0) as inserted`;

export async function applyWatcherFill(sql: Sql, userId: string, f: WatcherFill, deps: WatcherFillDeps): Promise<ApplyResult> {
  // 1. Validate through the journal schemas BEFORE any write (422 on refusal, nothing stored).
  const fillInput = journalParse(realFillSchema, realFillInput(f), "journal refused the fill");
  const exitReason = exitReasonId(f.reason);
  if (f.event === "exit" && f.exitUnderlierPx != null) journalParse(closeTradeSchema, { id: "probe", exit: f.exitUnderlierPx, exitReason }, "journal refused the exit");

  // 2. room_orders, atomically.
  const now = Date.now();
  const exitInfo: StoredExit | null = f.event === "exit"
    ? { atMs: f.atMs, qty: f.qty, exitPx: f.exitPx, exitUnderlierPx: f.exitUnderlierPx, optionPnl: f.optionPnl, reason: f.reason, orderId: f.orderId }
    : null;
  const reasonText = f.event === "exit"
    ? `exit ${f.exitPx ?? "?"}${f.orderId ? ` rh ${f.orderId}` : ""}${f.optionPnl != null ? ` optionPnl ${f.optionPnl}` : ""}`
    : (f.reason ?? null);
  const want = nextOrderStatus(null, f.event);
  const up = await sql.query<OrderRow>(UPSERT_SQL, [
    userId, f.signal, f.option?.underlier ?? f.symbol, f.side, f.qty, f.option?.limit ?? null, want, f.event,
    reasonText, f.event === "exit" ? null : (f.orderId ?? null), f.qty, f.fillPx ?? null,
    JSON.stringify({ card: { symbol: f.symbol, side: f.side, band: f.band ?? null, plan: f.plan }, option: f.option ?? null }),
    exitInfo ? JSON.stringify(exitInfo) : null, f.atMs, now, ORDER_RANK[want] ?? 0,
  ]);
  const order: ApplyResult["order"] = up.length ? (up[0]!.inserted ? "inserted" : "updated") : "unchanged";
  const row: OrderRow | undefined = up[0] ?? (await sql.query<OrderRow>(
    `select id, status, filled_avg_px, intent->'exit' as exit, false as inserted from room_orders where user_id = $1 and client_order_id = $2`, [userId, f.signal]))[0];
  const fillPx = row?.filled_avg_px != null ? Number(row.filled_avg_px) : null;

  // 3. desk_trades.
  let trade: ApplyResult["trade"] = "none";
  const open = await sql.query<{ id: string; status: string }>(`select id, status from desk_trades where user_id = $1 and mode = 'live' and reason like $2 order by opened_at desc limit 1`, [userId, `watcher ${f.signal}%`]);
  if (f.event === "filled") {
    if (open.length) trade = "exists";
    else if (row?.status === "closed") {
      // Late fill: the exit already arrived. Open-and-close in ONE insert (never an open row), or record nothing.
      const x = row.exit;
      const pnl = x ? optionPnl(x, f.fillPx) : null;
      if (x && x.exitUnderlierPx != null && pnl != null) {
        const data = journalParse(realFillSchema, { ...realFillInput(f), exit: x.exitUnderlierPx, exitedAt: new Date(x.atMs).toISOString(), exitReason: exitReasonId(x.reason) }, "journal refused the late fill");
        await deps.recordRealFillFor(sql, userId, data, { realizedPnl: pnl });
        trade = "opened_closed";
      }
    } else { await deps.recordRealFillFor(sql, userId, fillInput); trade = "opened"; }
  } else if (f.event === "exit" && open[0]?.status === "open" && f.exitUnderlierPx != null) {
    const pnl = optionPnl(f, fillPx);
    const data = journalParse(closeTradeSchema, { id: open[0].id, exit: f.exitUnderlierPx, slippage: 0, exitReason, reason: (f.reason ?? "watcher exit").slice(0, 200) }, "journal refused the exit");
    await deps.closeTradeFor(sql, userId, data, pnl != null ? { realizedPnl: pnl } : {});
    trade = "closed";
  }

  let cardStamped = 0;
  if (f.event === "filled") {
    try {
      const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(f.atMs));
      const tol = Math.max(0.5, Math.abs(f.plan.entry) * 0.0005);
      const r = await sql.query<{ id: string }>(
        `update desk_card_journal set signal = $1 where id = (
           select id from desk_card_journal where signal is null and day_key = $2 and symbol = $3 and side = $4
             and abs(entry - $5::float8) <= $6::float8 and opened_ms <= $7::bigint + 300000 and $7::bigint - opened_ms <= 14400000
           order by abs(entry - $5) limit 1) returning id`,
        [f.signal, day, f.symbol, f.side, f.plan.entry, tol, f.atMs]);
      cardStamped = r.length;
    } catch { /* migration 0027 not applied yet: the fill record still stands */ }
  }
  return { ok: true, order, trade, cardStamped };
}
