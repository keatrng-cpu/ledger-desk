// /api/desk/fills core: idempotent room_orders by signal, desk_trades via recordRealFillFor/closeTradeFor, card signal stamp.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const w = await import("../src/lib/desk/watcher-fills.ts");
const h = await import("../src/lib/desk/rules-hash.ts");

const base = { signal: "sig-85e8feddd99efe46", orderId: "6ad1151c-8bc9-4446-a02f-9223be78a8f9", atMs: Date.parse("2026-10-15T18:02:10Z"), symbol: "ES", side: "long", band: "B+",
  plan: { entry: 7782.63, stop: 7775, t1: 7792.25 }, option: { underlier: "SPY", right: "call", strike: 770, expiry: "2026-10-16", limit: 2.98 }, qty: 1 };

function fakeDb() {
  const orders = new Map(); const trades = []; const cards = [{ id: "c1", signal: null, day_key: "2026-10-15", symbol: "ES", side: "long", entry: 7782.5, opened_ms: base.atMs - 60_000 }];
  const log = [];
  const sql = { async query(text, p = []) {
    log.push(text.trim().split(/\s+/).slice(0, 3).join(" "));
    if (/^select status from room_orders/.test(text.trim())) { const o = orders.get(p[1]); return o ? [{ status: o.status }] : []; }
    if (/^insert into room_orders/.test(text.trim())) { if (orders.has(p[1])) return []; orders.set(p[1], { status: p[6], broker_order_id: p[9], filled_qty: p[10], filled_avg_px: p[11], reasons: JSON.parse(p[8]) }); return [{ id: "1" }]; }
    if (/^update room_orders/.test(text.trim())) { const o = orders.get(p[1]); o.status = p[2]; o.broker_order_id ??= p[5]; if (p[3] === "filled") { o.filled_qty = p[6]; o.filled_avg_px = p[7]; } if (p[8]) o.reasons.push(p[8]); return []; }
    if (/^select id, status from desk_trades/.test(text.trim())) return trades.filter((t) => t.reason.startsWith(p[1].replace("%", ""))).slice(-1);
    if (/^update desk_card_journal/.test(text.trim())) { const c = cards.find((x) => x.signal == null && x.day_key === p[1] && x.symbol === p[2] && x.side === p[3] && Math.abs(x.entry - p[4]) <= p[5]); if (!c) return []; c.signal = p[0]; return [{ id: c.id }]; }
    throw new Error("unexpected sql: " + text.slice(0, 60));
  } };
  const deps = {
    recordRealFillFor: async (_s, uid, d) => { const t = { id: `t${trades.length + 1}`, status: "open", uid, ...d }; trades.push(t); return t; },
    closeTradeFor: async (_s, _u, d) => { const t = trades.find((x) => x.id === d.id); t.status = "closed"; t.exit = d.exit; return t; },
  };
  return { sql, deps, orders, trades, cards, log };
}

test("order status only moves forward", () => {
  assert.equal(w.nextOrderStatus(null, "placed"), "placed");
  assert.equal(w.nextOrderStatus("placed", "filled"), "filled");
  assert.equal(w.nextOrderStatus("filled", "placed"), "filled");
  assert.equal(w.nextOrderStatus("filled", "exit"), "closed");
  assert.equal(w.nextOrderStatus("closed", "filled"), "closed");
});

test("schema: valid payload parses; bad signal / symbol refused", () => {
  assert.ok(w.watcherFillSchema.safeParse({ ...base, event: "filled", fillPx: 2.96 }).success);
  assert.equal(w.watcherFillSchema.safeParse({ ...base, event: "filled", signal: "x" }).success, false);
  assert.equal(w.watcherFillSchema.safeParse({ ...base, event: "filled", symbol: "SPY" }).success, false);
});

test("placed → filled → replay → exit: one order row, one trade, closed once, card stamped", async () => {
  const db = fakeDb();
  const parse = (x) => w.watcherFillSchema.parse(x);
  let r = await w.applyWatcherFill(db.sql, "u1", parse({ ...base, event: "placed" }), db.deps);
  assert.equal(r.order, "inserted"); assert.equal(r.trade, "none");
  r = await w.applyWatcherFill(db.sql, "u1", parse({ ...base, event: "filled", fillPx: 2.96 }), db.deps);
  assert.equal(r.order, "updated"); assert.equal(r.trade, "opened"); assert.equal(r.cardStamped, 1);
  r = await w.applyWatcherFill(db.sql, "u1", parse({ ...base, event: "filled", fillPx: 2.96 }), db.deps); // replay
  assert.equal(r.order, "unchanged"); assert.equal(r.trade, "exists");
  assert.equal(db.trades.length, 1);
  const o = db.orders.get(base.signal);
  assert.deepEqual([o.status, o.broker_order_id, o.filled_qty, o.filled_avg_px], ["filled", base.orderId, 1, 2.96]);
  assert.equal(db.trades[0].reason, `watcher ${base.signal} rh ${base.orderId}`);
  assert.equal(db.trades[0].entry, 7782.63); assert.equal(db.trades[0].stop, 7775); assert.match(db.trades[0].why, /SPY 2026-10-16 770C @ 2.96/);
  r = await w.applyWatcherFill(db.sql, "u1", parse({ ...base, event: "exit", orderId: "6ad115c6-72e9-4303-ad11-ab83fd3726ba", exitPx: 2.6, exitUnderlierPx: 7775, optionPnl: -36, reason: "ticket stop" }), db.deps);
  assert.equal(r.trade, "closed"); assert.equal(db.trades[0].status, "closed"); assert.equal(db.trades[0].exit, 7775);
  assert.equal(o.status, "closed"); assert.equal(o.broker_order_id, base.orderId, "exit's closing order id never replaces the entry order id");
  assert.ok(o.reasons.some((x) => /optionPnl -36/.test(x)));
  r = await w.applyWatcherFill(db.sql, "u1", parse({ ...base, event: "exit", exitUnderlierPx: 7775 }), db.deps); // replayed exit
  assert.equal(r.trade, "none");
  assert.equal(db.cards[0].signal, base.signal);
});

test("filled first (placed lost) still records once", async () => {
  const db = fakeDb();
  const r = await w.applyWatcherFill(db.sql, "u1", w.watcherFillSchema.parse({ ...base, event: "filled", fillPx: 2.96 }), db.deps);
  assert.equal(r.order, "inserted"); assert.equal(r.trade, "opened");
  assert.equal(db.orders.get(base.signal).filled_qty, 1);
});

test("rejected never opens a trade", async () => {
  const db = fakeDb();
  const r = await w.applyWatcherFill(db.sql, "u1", w.watcherFillSchema.parse({ ...base, event: "rejected", reason: "BP" }), db.deps);
  assert.equal(r.trade, "none"); assert.equal(db.orders.get(base.signal).status, "rejected");
});

test("migration 0027 is additive only", () => {
  const m = readFileSync("migrations/0027_card_signal.sql", "utf8").replace(/--.*$/gm, "");
  assert.match(m, /add column if not exists signal text/);
  assert.doesNotMatch(m, /\b(drop|delete|truncate|update|alter column)\b/i);
});

test("route refuses shadow / dry-run and requires the watcher token", () => {
  const src = readFileSync("src/routes/api/desk/fills.ts", "utf8");
  assert.match(src, /watcherAuthorized\(/); assert.match(src, /shadow \|\| p\.data\.dryRun/);
});

test("desk-rules hash unchanged", () => assert.equal(h.RULES_HASH, "a4bfcb65c88badcd"));

test("backfill builds placed/filled/exit for sig-85e8feddd99efe46 that the endpoint schema accepts", async () => {
  const b = await import("./backfill/fill-sig-85e8feddd99efe46.mts");
  const L = [
    { ts: "2026-10-15T14:02:04-04:00", kind: "alert", text: "PLACED 1x SPY 2026-10-16 770.0C @ 2.98 (mid (walk 0)) key=sig-85e8feddd99efe46 stop=7775.0 (x)", result: { id: "6ad1151c-8bc9-4446-a02f-9223be78a8f9" } },
    { ts: "2026-10-15T14:02:04-04:00", kind: "alert", text: "FIRE B+ ES long q=0.6499 entry=7782.63 stop=7775.0 tgt=7792.25 rr=1.26", signal: "sig-85e8feddd99efe46" },
    { ts: "2026-10-15T14:02:10-04:00", kind: "alert", text: "FILLED 1 @ 2.96 (filled)" },
    { ts: "2026-10-15T14:04:55-04:00", kind: "alert", text: "EXIT 1 @ 2.6: ticket stop 7775.0 hit (px 7775.0)", result: { id: "6ad115c6-72e9-4303-ad11-ab83fd3726ba" } },
  ].map((x) => JSON.stringify(x));
  const p = b.buildBackfill(L);
  assert.deepEqual(p.map((x) => x.event), ["placed", "filled", "exit"]);
  for (const x of p) assert.ok(w.watcherFillSchema.safeParse(x).success, x.event);
  assert.equal(p[1].orderId, "6ad1151c-8bc9-4446-a02f-9223be78a8f9"); assert.equal(p[2].optionPnl, -36); assert.equal(p[2].exitUnderlierPx, 7775);
});
