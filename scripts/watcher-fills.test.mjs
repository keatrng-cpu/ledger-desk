// /api/desk/fills core: idempotent room_orders by signal, desk_trades via recordRealFillFor/closeTradeFor, card signal stamp.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { register } from "tsx/esm/api";
register();
const w = await import("../src/lib/desk/watcher-fills.ts");
const h = await import("../src/lib/desk/rules-hash.ts");

const base = { signal: "sig-85e8feddd99efe46", orderId: "6ad1151c-8bc9-4446-a02f-9223be78a8f9", atMs: Date.parse("2026-10-15T18:02:10Z"), symbol: "ES", side: "long", band: "B+",
  plan: { entry: 7782.63, stop: 7775, t1: 7792.25 }, option: { underlier: "SPY", right: "call", strike: 770, expiry: "2026-10-16", limit: 2.98 }, qty: 1 };

// Real PGLite with every migration applied, and the REAL journal bodies (recordRealFillFor / closeTradeFor /
// computeLiveRiskState): the SQL under test is the SQL that ships.
// journal/server-core.ts, NOT journal/server.ts: the core has no `@/lib/db` value import, so db.ts (whose import starts
// the PGLite bootstrap and its import.meta.glob migrate) is never loaded here. Asserted below.
const j = await import("../src/lib/journal/server-core.ts");
const ws = await import("../src/lib/desk/watcher-status.ts");
const { PGlite } = await import("@electric-sql/pglite");
const { readdirSync } = await import("node:fs");
const MIGS = readdirSync("migrations").filter((f) => f.endsWith(".sql")).sort().map((f) => readFileSync(`migrations/${f}`, "utf8"));
const FILL_ID = "6ad1151c-8bc9-4446-a02f-9223be78a8f9", EXIT_ID = "6ad115c6-72e9-4303-ad11-ab83fd3726ba";

const opened = [];
after(async () => { await Promise.all(opened.splice(0).map((pg) => pg.close())); });
async function realDb() {
  const pg = new PGlite(); opened.push(pg);
  for (const m of MIGS) await pg.exec(m);
  const norm = (r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]));
  const run = async (text, params = []) => (await pg.query(text, params)).rows.map(norm);
  const sql = (strings, ...values) => { let t = strings[0]; values.forEach((_, i) => { t += `$${i + 1}${strings[i + 1]}`; }); return run(t, values); };
  sql.query = run;
  const now = Date.now();
  await run(`insert into desk_card_journal (id, day_key, symbol, side, band, q, entry, stop, target, opened_ms) values ('c1', $1, 'ES', 'long', 'B+', 0.65, 7782.5, 7775, 7792.25, $2)`,
    [new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(now)), now - 60_000]);
  return { pg, sql, run, now };
}
const deps = { recordRealFillFor: j.recordRealFillFor, closeTradeFor: j.closeTradeFor };
const apply = (db, x) => w.applyWatcherFill(db.sql, "u1", w.watcherFillSchema.parse({ ...base, atMs: db.now, ...x }), deps);
const FILLED = { event: "filled", fillPx: 2.96 };
const EXIT = { event: "exit", orderId: EXIT_ID, exitPx: 2.6, exitUnderlierPx: 7775, optionPnl: -36, reason: "ticket stop 7775.0 hit" };
const trades = (db) => db.run(`select id, status, entry, stop, exit, pnl, commission, r, exit_reason, reason, why from desk_trades where user_id = 'u1' order by opened_at`);
const order = async (db) => (await db.run(`select * from room_orders where user_id = 'u1' and client_order_id = $1`, [base.signal]))[0];

test("the fill path never loads db.ts (no PGLite bootstrap / import.meta.glob in tests)", () => {
  assert.equal(globalThis.__pgBootstrapPromise__, undefined);
  assert.equal(globalThis.__pgliteInstance__, undefined);
  for (const f of ["src/lib/desk/watcher-fills.ts", "src/lib/journal/server-core.ts", "src/lib/journal/fill-schemas.ts", "src/lib/journal/attest-server.ts"])
    assert.doesNotMatch(readFileSync(f, "utf8"), /^import\s+\{[^}]*\bgetSql\b|^import\s+(?!type)[^;]*from\s+"@\/lib\/db"/m, f);
});

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

test("placed → filled → replay → exit → replayed exit: one order, one trade closed at the REAL option P&L (-36)", async () => {
  const db = await realDb();
  let r = await apply(db, { event: "placed" });
  assert.equal(r.order, "inserted"); assert.equal(r.trade, "none");
  r = await apply(db, FILLED);
  assert.equal(r.order, "updated"); assert.equal(r.trade, "opened"); assert.equal(r.cardStamped, 1);
  r = await apply(db, FILLED); // replay
  assert.equal(r.order, "unchanged"); assert.equal(r.trade, "exists");
  let t = await trades(db);
  assert.equal(t.length, 1); assert.equal(t[0].status, "open");
  assert.equal(t[0].reason, `watcher ${base.signal} rh ${FILL_ID}`); assert.equal(t[0].entry, 7782.63); assert.equal(t[0].stop, 7775);
  assert.match(t[0].why, /SPY 2026-10-16 770C @ 2.96/);
  r = await apply(db, EXIT);
  assert.equal(r.trade, "closed");
  r = await apply(db, EXIT); // replayed exit
  assert.equal(r.order, "unchanged"); assert.equal(r.trade, "none");
  t = await trades(db);
  assert.equal(t.length, 1); assert.equal(t[0].status, "closed"); assert.equal(t[0].exit, 7775);
  assert.equal(Number(t[0].pnl), -36, "desk_trades.pnl is the option premium P&L, not the ES-equivalent -381.50");
  assert.equal(Number(t[0].commission), 0); assert.equal(t[0].exit_reason, "stop");
  const o = await order(db);
  assert.deepEqual([o.phase, o.status, o.broker_order_id, o.filled_qty, Number(o.filled_avg_px)], ["watcher", "closed", FILL_ID, 1, 2.96]);
  assert.equal(o.reasons.filter((x) => /optionPnl -36/.test(x)).length, 1, "replayed exit must not append the reason twice");
  assert.equal((await db.run(`select signal from desk_card_journal where id = 'c1'`))[0].signal, base.signal);
});

test("sig-85e8feddd99efe46: live risk (day/week PnL) and live_net read -36", async () => {
  const db = await realDb();
  await apply(db, { event: "placed" }); await apply(db, FILLED); await apply(db, EXIT);
  const risk = await j.computeLiveRiskState(db.sql, "u1");
  assert.equal(risk.dayPnl, -36); assert.equal(risk.weekPnl, -36); assert.equal(risk.openTrades, 0);
  const [{ live_net }] = await db.run(`select coalesce(sum(pnl) filter (where mode = 'live' and status = 'closed'), 0)::double precision as live_net from desk_trades where user_id = 'u1'`);
  assert.equal(live_net, -36);
});

test("out of order: exit before fill → late fill opens AND closes in one insert; never leaves an open row", async () => {
  const db = await realDb();
  let r = await apply(db, EXIT);
  assert.equal(r.order, "inserted"); assert.equal(r.trade, "none");
  assert.equal((await trades(db)).length, 0);
  r = await apply(db, FILLED);
  assert.equal(r.order, "updated"); assert.equal(r.trade, "opened_closed");
  const t = await trades(db);
  assert.equal(t.length, 1); assert.equal(t[0].status, "closed"); assert.equal(Number(t[0].pnl), -36); assert.equal(t[0].exit_reason, "stop");
  const o = await order(db);
  assert.deepEqual([o.status, o.filled_qty, Number(o.filled_avg_px), o.broker_order_id], ["closed", 1, 2.96, FILL_ID]);
  r = await apply(db, FILLED); // replay of the late fill
  assert.equal(r.trade, "exists"); assert.equal((await trades(db)).length, 1);
  // a later ES long fill on another signal is NOT blocked by a stale open row
  r = await w.applyWatcherFill(db.sql, "u1", w.watcherFillSchema.parse({ ...base, signal: "sig-0000000000000001", atMs: db.now, ...FILLED }), deps);
  assert.equal(r.trade, "opened");
});

test("out of order without the underlier exit price: late fill opens nothing", async () => {
  const db = await realDb();
  await apply(db, { ...EXIT, exitUnderlierPx: undefined });
  const r = await apply(db, FILLED);
  assert.equal(r.trade, "none"); assert.equal((await trades(db)).length, 0);
  assert.equal((await order(db)).status, "closed");
});

test("journal schema refusals are 422-class and write nothing (stop on the wrong side of entry)", async () => {
  const db = await realDb();
  await assert.rejects(apply(db, { ...FILLED, plan: { entry: 7782.63, stop: 7790 } }), w.WatcherFillRefused);
  assert.equal((await db.run(`select count(*)::int as n from room_orders`))[0].n, 0);
  assert.equal((await trades(db)).length, 0);
  assert.equal(w.watcherFillSchema.safeParse({ ...base, event: "exit" }).success, false, "exit needs exitPx");
  assert.equal(w.watcherFillSchema.safeParse({ ...base, event: "filled" }).success, false, "filled needs fillPx");
});

test("exit reasons map to the journal enum", () => {
  assert.equal(w.exitReasonId("ticket stop 7775.0 hit"), "stop");
  assert.equal(w.exitReasonId("runner stopped at breakeven"), "be");
  assert.equal(w.exitReasonId("T1 hit"), "t1_runner");
  assert.equal(w.exitReasonId("T2"), "t2");
  assert.equal(w.exitReasonId("EOD flatten"), "time");
  assert.equal(w.exitReasonId(undefined), "discretionary");
});

test("filled first (placed lost) still records once; rejected never opens a trade", async () => {
  const db = await realDb();
  const r = await apply(db, FILLED);
  assert.equal(r.order, "inserted"); assert.equal(r.trade, "opened");
  assert.equal((await order(db)).filled_qty, 1);
  const db2 = await realDb();
  const r2 = await apply(db2, { event: "rejected", reason: "BP" });
  assert.equal(r2.trade, "none"); assert.equal((await order(db2)).status, "rejected");
});

test("/fills auth: WATCHER_STATUS_TOKEN only, CRON_SECRET refused", () => {
  const env = { WATCHER_STATUS_TOKEN: "wst-test-value", CRON_SECRET: "cron-test-value" };
  assert.equal(ws.watcherFillsAuthorized("Bearer wst-test-value", env), true);
  assert.equal(ws.watcherFillsAuthorized("Bearer cron-test-value", env), false);
  assert.equal(ws.watcherFillsAuthorized("Bearer x", {}), false);
  assert.equal(ws.watcherFillsAuthorized("Bearer ", env), false);
});

test("watcher rows stay out of the room executor audit list", () => {
  const src = readFileSync("src/lib/room/exec/exec-sql.ts", "utf8");
  assert.match(src, /async recent\(limit: number\)[\s\S]{0,200}phase <> 'watcher'/);
  assert.equal(w.WATCHER_PHASE, "watcher");
});

test("no 'as never' casts on the fill path", () => {
  for (const f of ["src/lib/desk/watcher-fills.ts", "src/routes/api/desk/fills.ts"]) assert.doesNotMatch(readFileSync(f, "utf8"), /as never/, f);
});

test("migration 0027 is additive only", () => {
  const m = readFileSync("migrations/0027_card_signal.sql", "utf8").replace(/--.*$/gm, "");
  assert.match(m, /add column if not exists signal text/);
  assert.doesNotMatch(m, /\b(drop|delete|truncate|update|alter column)\b/i);
});

test("route refuses shadow / dry-run and requires the watcher token", () => {
  const src = readFileSync("src/routes/api/desk/fills.ts", "utf8");
  assert.match(src, /watcherFillsAuthorized\(/); assert.match(src, /WatcherFillRefused\) return jsonResponse\(.*, 422\)/); assert.match(src, /shadow \|\| p\.data\.dryRun/);
});

test("desk-rules hash (fix1016 block added 10-16)", () => assert.equal(h.RULES_HASH, "5b73f1001c0cb23d"));

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
