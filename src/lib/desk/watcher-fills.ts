/**
 * Watcher → Supabase fill record (POST /api/desk/fills).
 *
 * The desk-watcher places and manages the live Robinhood option orders but has no database credentials (and must
 * not get any). It reports each order event here with the WATCHER_STATUS_TOKEN bearer; this module writes:
 *   - room_orders: one row per entry order, keyed (user_id, client_order_id = signal). Replays are no-ops on insert
 *     and monotonic on update (placed → filled → closed; a terminal row never goes back).
 *   - desk_trades: on `filled`, recordRealFillFor (the same path as a hand-logged real fill: records the gates it
 *     WOULD have tripped, never refuses). Rows are in UNDERLIER terms (ES/MNQ plan entry/stop/T1, contracts = qty);
 *     the option premium, contract and option P&L ride in room_orders and in `why`. On `exit`, closeTradeFor.
 *   - desk_card_journal.signal (migration 0027): stamped on the matching card (same ET day/symbol/side, entry within
 *     tolerance, opened <= 4 h before the fill) when it has none.
 * Shadow / dry-run events are refused (422): this table is the record of what reached the broker.
 * Nothing here places, cancels or gates an order.
 */
import { z } from "zod";
import type { Sql } from "@/lib/db";

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
});
export type WatcherFill = z.output<typeof watcherFillSchema>;

const ORDER_RANK: Record<string, number> = { placed: 1, rejected: 2, filled: 2, closed: 3 };
export function nextOrderStatus(current: string | null, event: WatcherFill["event"]): string {
  const want = event === "exit" ? "closed" : event;
  if (!current) return want;
  return (ORDER_RANK[want] ?? 0) > (ORDER_RANK[current] ?? 0) ? want : current;
}

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

export type ApplyResult = { ok: true; order: "inserted" | "updated" | "unchanged"; trade?: "opened" | "closed" | "exists" | "none"; cardStamped?: number };

export async function applyWatcherFill(sql: Sql, userId: string, f: WatcherFill, deps: {
  recordRealFillFor: (sql: Sql, userId: string, data: never) => Promise<{ id: string }>;
  closeTradeFor: (sql: Sql, userId: string, data: never) => Promise<unknown>;
}): Promise<ApplyResult> {
  const now = Date.now();
  const cur = (await sql.query<{ status: string }>(`select status from room_orders where user_id = $1 and client_order_id = $2`, [userId, f.signal]))[0];
  let order: ApplyResult["order"] = "unchanged";
  if (!cur) {
    const ins = await sql.query<{ id: string }>(
      `insert into room_orders (user_id, client_order_id, phase, role, symbol, side, qty, limit_px, status, broker_status, reasons, broker_order_id, filled_qty, filled_avg_px, intent, at_ms, updated_ms)
       values ($1,$2,'live','watcher',$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13::jsonb,$14,$15) on conflict (user_id, client_order_id) do nothing returning id`,
      [userId, f.signal, f.option?.underlier ?? f.symbol, f.side, f.qty, f.option?.limit ?? null, nextOrderStatus(null, f.event), f.event,
       JSON.stringify(f.reason ? [f.reason] : []), f.event === "exit" ? null : (f.orderId ?? null), f.event === "filled" ? f.qty : 0, f.event === "filled" ? (f.fillPx ?? null) : null,
       JSON.stringify({ card: { symbol: f.symbol, side: f.side, band: f.band ?? null, plan: f.plan }, option: f.option ?? null }), f.atMs, now]);
    order = ins.length ? "inserted" : "unchanged";
  } else {
    const next = nextOrderStatus(cur.status, f.event);
    if (next !== cur.status || f.event === "exit") {
      await sql.query(
        `update room_orders set status = $3, broker_status = $4, updated_ms = $5,
           broker_order_id = coalesce(broker_order_id, $6),
           filled_qty = case when $4 = 'filled' then $7 else filled_qty end,
           filled_avg_px = case when $4 = 'filled' then $8 else filled_avg_px end,
           reasons = case when $9::text is null then reasons else reasons || to_jsonb($9::text) end
         where user_id = $1 and client_order_id = $2`,
        [userId, f.signal, next, f.event, now, f.event === "exit" ? null : (f.orderId ?? null), f.qty, f.fillPx ?? null,
         f.event === "exit" ? `exit ${f.exitPx ?? "?"}${f.orderId ? ` rh ${f.orderId}` : ""}${f.optionPnl != null ? ` optionPnl ${f.optionPnl}` : ""}` : (f.reason ?? null)]);
      order = "updated";
    }
  }

  let trade: ApplyResult["trade"] = "none";
  const open = await sql.query<{ id: string; status: string }>(`select id, status from desk_trades where user_id = $1 and mode = 'live' and reason like $2 order by opened_at desc limit 1`, [userId, `watcher ${f.signal}%`]);
  if (f.event === "filled") {
    if (open.length) trade = "exists";
    else { await deps.recordRealFillFor(sql, userId, realFillInput(f) as never); trade = "opened"; }
  } else if (f.event === "exit" && open[0]?.status === "open" && f.exitUnderlierPx != null) {
    await deps.closeTradeFor(sql, userId, { id: open[0].id, exit: f.exitUnderlierPx, slippage: 0, exitReason: (f.reason ?? "watcher exit").slice(0, 200) } as never);
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
             and abs(entry - $5) <= $6 and opened_ms <= $7 + 300000 and $7 - opened_ms <= 14400000
           order by abs(entry - $5) limit 1) returning id`,
        [f.signal, day, f.symbol, f.side, f.plan.entry, tol, f.atMs]);
      cardStamped = r.length;
    } catch { /* migration 0027 not applied yet: the fill record still stands */ }
  }
  return { ok: true, order, trade, cardStamped };
}
