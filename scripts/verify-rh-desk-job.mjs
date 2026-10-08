/**
 * The desk job that closes with nobody watching (ITEM 19).
 *
 * The close used to be a passenger: it rode the browser poll, or the tail of
 * /api/cron/room-step's paper-book pipeline, or the 15:30 flatten. This checks
 * the dedicated route — that it is off by default, that it only runs in the
 * session, that it refuses to read a level off a stale or synthetic feed, that
 * it CANNOT open (the same configuration that opens in verify-rh-dispatch must
 * not open here), and that one wick cannot send two closes.
 *
 *   npx tsx scripts/verify-rh-desk-job.mjs
 */
import { readFileSync } from "node:fs";

const job = await import("../src/routes/api/cron/rh-manage.ts");
const { runRhDesk } = await import("../src/lib/execution/rh-dispatch.ts");
const { memoryLedger, refIdFor } = await import("../src/lib/execution/rh-tools.ts");
const room = await import("../src/lib/room/manager-room-feed.ts");

const { RH_DESK_JOB_CONFIRMED_IN_WRITING, RH_MANAGE_MAX_LAG_SEC, CLOSE_ONLY_REFUSAL } = job;
const { rhManageArmed, rhManageDue, deskTrusted, isCloseOnlyOrder, closeOnlyTooling } = job;

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

/* 2026-10-07 is a Wednesday. 14:00 UTC = 10:00 ET (EDT). */
const TEN = Date.UTC(2026, 9, 7, 14, 0, 0);
const MIN = (h, m) => h * 60 + m;

/* ------------------------------------------------------------------ */
console.log("off by default");
{
  check("the human switch ships false", RH_DESK_JOB_CONFIRMED_IN_WRITING === false, String(RH_DESK_JOB_CONFIRMED_IN_WRITING));
  const a = rhManageArmed({ RH_DESK_JOB_ENABLED: "true" });
  check("the env flag alone does not arm it", a.ok === false && /CONFIRMED_IN_WRITING/.test(a.why), JSON.stringify(a));
  const b = rhManageArmed({});
  check("no env flag does not arm it", b.ok === false);
  const src = read("src/routes/api/cron/rh-manage.ts");
  check(
    "the constant is pinned false in source, so flipping it is a deliberate edit",
    /export const RH_DESK_JOB_CONFIRMED_IN_WRITING = false;/.test(src),
  );
  check("the kill switch is read per request, not at module load", /env\.RH_DESK_JOB_ENABLED/.test(src) && !/^const .*RH_DESK_JOB_ENABLED/m.test(src));
}

/* ------------------------------------------------------------------ */
console.log("the timer runs inside the session");
{
  const wed = 3;
  check("09:29 ET is too early", rhManageDue({ etMin: MIN(9, 29), weekday: wed, forced: false }).ok === false);
  check("09:30 ET is due", rhManageDue({ etMin: MIN(9, 30), weekday: wed, forced: false }).ok === true);
  check("10:05 ET is due — the wick does not wait for 15:30", rhManageDue({ etMin: MIN(10, 5), weekday: wed, forced: false }).ok === true);
  check("15:30 ET is still inside the window", rhManageDue({ etMin: MIN(15, 30), weekday: wed, forced: false }).ok === true);
  check("16:00 ET is over", rhManageDue({ etMin: MIN(16, 0), weekday: wed, forced: false }).ok === false);
  check("Saturday never runs", rhManageDue({ etMin: MIN(10, 0), weekday: 6, forced: false }).ok === false);
  check("Sunday never runs, forced or not", rhManageDue({ etMin: MIN(10, 0), weekday: 0, forced: true }).ok === false);
  check("force skips the clock and nothing else", rhManageDue({ etMin: MIN(3, 0), weekday: wed, forced: true }).ok === true);
}

/* ------------------------------------------------------------------ */
console.log("a stale or synthetic feed does not price a level");
{
  check("synthetic is refused", deskTrusted({ feed: "synthetic", lagSec: 0 }).ok === false);
  check("no feed is refused", deskTrusted({ feed: null, lagSec: 0 }).ok === false);
  check("unknown tape age is refused", deskTrusted({ feed: "databento", lagSec: null }).ok === false);
  check(
    `${RH_MANAGE_MAX_LAG_SEC + 1}s of lag is refused`,
    deskTrusted({ feed: "yahoo", lagSec: RH_MANAGE_MAX_LAG_SEC + 1 }).ok === false,
  );
  check(`${RH_MANAGE_MAX_LAG_SEC}s of lag is accepted`, deskTrusted({ feed: "databento", lagSec: RH_MANAGE_MAX_LAG_SEC }).ok === true);
  const gates = await import("../src/lib/execution/rh-autofire-gates.ts");
  check(
    "the job's lag bound is the entry gate's own number, not a second opinion",
    RH_MANAGE_MAX_LAG_SEC === gates.RH_MAX_TAPE_AGE_SEC,
    `${RH_MANAGE_MAX_LAG_SEC} vs ${gates.RH_MAX_TAPE_AGE_SEC}`,
  );
}

/* ------------------------------------------------------------------ */
console.log("the send boundary only closes");
const openOrder = {
  account_number: "995386158",
  legs: [{ option_id: "o1", side: "buy", position_effect: "open", ratio_quantity: 1 }],
  type: "limit",
  quantity: "1",
  price: "1.00",
  time_in_force: "gfd",
  market_hours: "regular_hours",
  chain_symbol: "QQQ",
  underlying_type: "equity",
  refKey: "open:k1",
};
const sellCloseOrder = { ...openOrder, legs: [{ option_id: "o1", side: "sell", position_effect: "close", ratio_quantity: 1 }], refKey: "close:k1" };
{
  check("a buy-to-open is not a close", isCloseOnlyOrder(openOrder) === false);
  check("a sell-to-close is a close", isCloseOnlyOrder(sellCloseOrder) === true);
  check("a sell-to-OPEN is not a close", isCloseOnlyOrder({ legs: [{ side: "sell", position_effect: "open" }] }) === false);
  check("a buy-to-close is not a close", isCloseOnlyOrder({ legs: [{ side: "buy", position_effect: "close" }] }) === false);
  check("a mixed multi-leg order is not a close", isCloseOnlyOrder({ legs: [sellCloseOrder.legs[0], openOrder.legs[0]] }) === false);
  check("an order with no legs is not a close", isCloseOnlyOrder({ legs: [] }) === false);

  const seen = [];
  const inner = {
    async readAccount() { seen.push("account"); return null; },
    async dayPnlPct() { return 0; },
    async positions() { seen.push("positions"); return []; },
    async quote() { seen.push("quote"); return { bid: 1, ask: 1.1, asOfMs: TEN }; },
    async findOption() { seen.push("find"); return "o1"; },
    async review(o) { seen.push(["review", o.legs[0].position_effect]); return { ok: true, blocking: false, alerts: [] }; },
    async place(o) { seen.push(["place", o.legs[0].position_effect]); return { id: "ord-x" }; },
  };
  const guarded = closeOnlyTooling(inner);
  const rev = await guarded.review(openOrder);
  check("review refuses an opening order with a blocking alert", rev.ok === false && rev.blocking === true && rev.alerts[0] === CLOSE_ONLY_REFUSAL, JSON.stringify(rev));
  check("the refused review never reaches the broker", !seen.some((s) => Array.isArray(s) && s[0] === "review"), JSON.stringify(seen));
  let threw = null;
  await guarded.place(openOrder, "ref").catch((e) => { threw = e.message; });
  check("place THROWS on an opening order", threw === CLOSE_ONLY_REFUSAL, String(threw));
  check("the refused place never reaches the broker", !seen.some((s) => Array.isArray(s) && s[0] === "place"), JSON.stringify(seen));
  const okRev = await guarded.review(sellCloseOrder);
  const okPlace = await guarded.place(sellCloseOrder, "ref");
  check("a close passes straight through", okRev.ok === true && okPlace.id === "ord-x");
  await guarded.readAccount();
  await guarded.positions();
  await guarded.quote("o1");
  await guarded.findOption({ underlier: "QQQ", expiry: "2026-10-08", type: "put", strike: 600 });
  check("every read passes through untouched", ["account", "positions", "quote", "find"].every((k) => seen.includes(k)), JSON.stringify(seen));
}

/* ------------------------------------------------------------------ */
/* The real sender, exactly as the route calls it.                     */
const card = (o = {}) => ({
  card: "path_continuation", name: "PATH continuation", verdict: "ARMED", blocks: [], underlier: "QQQ", type: "PUT", dte: 0,
  band: "A", confluence: 0.7, futSymbol: "MNQ", futSide: "short", smcWord: "TAKE", smcMissing: "", deskContracts: 2,
  sizedFrom: "level", deltaMin: 0.3, deltaMax: 0.6, plan: { entry: 21000, stop: 21030, t1: 20950, t2: null, rr1: 1.6 },
  tier: "live", awayPts: 0, pT1: 0.6, expR: 0.3, pFill: 1, patterns: null, strategy: "TJR sweep", ...o,
});

function manager(nowMs) {
  const c = card();
  const plan = { entry: c, exp: "2026-10-07", offset: "ATM", quote: { ask: 1.2, strike: 600, delta: -0.5, iv: 0.2, bid: 1.17, mid: 1.18, thetaDay: 0 }, qty: 2, capUsd: 600, debitUsd: 240 };
  const feed = room.createRoomManagerFeed();
  feed.pushRoom(
    {
      id: 7,
      nowMs: nowMs - 3_000,
      output: { broker_action: { execute_trade: true, action_type: "BUY_OPEN", underlying: "QQQ", option_type: "PUT", strike_offset: "ATM", contracts_quantity: 2, target_position_id: null } },
      trace: {
        beat: "fill",
        gates: [{ id: "market", ok: true, label: "open" }, { id: "desk_word", ok: true, label: "ARMED" }, { id: "trigger", ok: true, label: "CE touched" }],
        refusal: null, refusalGate: null, entry: plan, optionsOpen: true, meeting: null,
      },
      roomP: 0.61,
      lenses: { Gemma: { p: 0.6 }, Jax: { p: 0.58 }, Nova: { p: 0.66 }, Sterling: { p: 0.55 }, Vince: { p: 0.62 } },
    },
    { card: c, newsBlackout: false, synthetic: false },
  );
  return feed.getState();
}

function desk(markPrice, nowMs = TEN) {
  return {
    fetchedAt: new Date(nowMs - 3_000).toISOString(),
    feed: "databento",
    left: { symbol: "MNQ", bars: [{ t: nowMs - 20 * 60_000, c: markPrice }] },
    right: { symbol: "ES", bars: [{ t: nowMs - 20 * 60_000, c: 5800 }] },
    quotes: { left: { price: markPrice }, right: { price: 5800 } },
    scan: { candidates: [{ symbol: "MNQ", side: "short", pathBand: "A", grade: "A", confluence: 0.7, actionable: true, strategyPrimary: "TJR" }] },
    smcMaster: {
      left: { symbol: "MNQ", side: "short", plan: { symbol: "MNQ", side: "short", entry: 21000, stop: 21030, entryZone: { top: 21010, bottom: 20990 } } },
      right: { symbol: "ES", side: null, plan: null },
    },
  };
}

function tooling(over = {}) {
  const calls = [];
  return {
    calls,
    async readAccount() {
      return {
        account: { account_number: "995386158", brokerage_account_type: "agentic", agentic_allowed: true, option_level: "option_level_2" },
        portfolio: { cash: "1000", buying_power: { buying_power: "1000" } },
      };
    },
    async dayPnlPct() { return over.dayPnlPct === undefined ? 0 : over.dayPnlPct; },
    async positions() { return over.positions ?? []; },
    async quote() { return over.quote === undefined ? { bid: 1.9, ask: 1.95, asOfMs: TEN - 1_000 } : over.quote; },
    async findOption() { calls.push("find"); return "opt-live"; },
    async review(o) { calls.push(["review", o.legs[0].side, o.legs[0].position_effect]); return over.review ?? { ok: true, blocking: false, alerts: [] }; },
    async place(o, ref) { calls.push(["place", o.legs[0].side, o.legs[0].position_effect, ref, o.refKey]); return { id: "ord-1" }; },
  };
}

const row = (over = {}) => ({
  optionId: "opt-1", decisionKey: "k1", underlier: "QQQ", optionType: "put", quantity: 2,
  avgDebit: 2, entry: 21000, stop: 21030, side: "short", refId: "abc", openedAt: TEN - 120_000, ...over,
});
const livePos = [{ optionId: "opt-1", quantity: 2, averagePrice: 2, chainSymbol: "QQQ", optionType: "put" }];

/** The route's call: no manager, entries blocked, the guard on the tooling. */
const asJob = (args) => runRhDesk({ manager: null, blockNewEntries: true, ...args, tooling: closeOnlyTooling(args.tooling) });

/* ------------------------------------------------------------------ */
console.log("a wick through the level closes with no chat open");
{
  const t = tooling({ positions: livePos });
  const ledger = memoryLedger([row()]);
  const out = await asJob({ desk: desk(21040), nowMs: TEN, tooling: t, ledger });
  const place = t.calls.find((c) => Array.isArray(c) && c[0] === "place");
  check("the close is sent", out.sent === true && out.cycle.phase === "close", `${out.cycle.phase} ${out.why}`);
  check("it reviewed then placed a sell-to-close", JSON.stringify(t.calls.filter((c) => Array.isArray(c)).map((c) => c.slice(0, 3))) === JSON.stringify([["review", "sell", "close"], ["place", "sell", "close"]]), JSON.stringify(t.calls));
  check("the reason names the futures invalidation", /invalidation/i.test(out.cycle.reason), out.cycle.reason);
  check("the close carries the stable ref id for this position", place && place[3] === refIdFor("close:k1"), String(place));
  check("the desk book no longer holds the row", (await ledger.list()).length === 0);
}

console.log("one wick, one close");
{
  const t = tooling({ positions: livePos });
  const ledger = memoryLedger([row()]);
  await asJob({ desk: desk(21040), nowMs: TEN, tooling: t, ledger });
  const t2 = tooling({ positions: livePos });
  const out2 = await asJob({ desk: desk(21045), nowMs: TEN + 60_000, tooling: t2, ledger });
  check("the next run does not send a second close", out2.sent === false && !t2.calls.some((c) => Array.isArray(c) && c[0] === "place"), `${out2.cycle.phase} ${out2.why}`);
  check("a resend of the same close would carry the same broker ref id", refIdFor("close:k1") === refIdFor("close:k1") && refIdFor("close:k1") !== refIdFor("close:k2"));
  const mcp = read("src/lib/execution/rh-mcp.ts");
  check("the sender passes that ref id to place_option_order as ref_id", /args\.ref_id = refId/.test(mcp) && /place_option_order"?,\s*orderArgs\(order, refId/.test(mcp));
}

console.log("only what this desk opened");
{
  const t = tooling({ positions: livePos });
  const out = await asJob({ desk: desk(21040), nowMs: TEN, tooling: t, ledger: memoryLedger() });
  check("a Robinhood position with no desk row is not closed", out.sent === false && !t.calls.some((c) => Array.isArray(c) && c[0] === "place"), out.cycle.reason);
  check("and it says so", /did not open/i.test(out.cycle.reason), out.cycle.reason);
}

console.log("with no trusted desk the broker-priced exits still fire");
{
  const t = tooling({ positions: livePos, quote: { bid: 1.4, ask: 1.45, asOfMs: TEN - 1_000 } });
  const out = await asJob({ desk: null, nowMs: TEN, tooling: t, ledger: memoryLedger([row()]) });
  check("the 25% premium backstop closes without a desk", out.sent === true && /backstop/i.test(out.cycle.reason), `${out.cycle.phase} ${out.cycle.reason}`);

  const t2 = tooling({ positions: livePos });
  const out2 = await asJob({ desk: null, nowMs: TEN, tooling: t2, ledger: memoryLedger([row()]) });
  check("but a level is never read off a feed that was refused", out2.sent === false && out2.cycle.phase === "manage", `${out2.cycle.phase} ${out2.cycle.reason}`);

  const t3 = tooling({ positions: livePos });
  const at1530 = Date.UTC(2026, 9, 7, 19, 31, 0);
  const out3 = await asJob({ desk: null, nowMs: at1530, tooling: t3, ledger: memoryLedger([row({ openedAt: at1530 - 120_000 })]) });
  check("15:30 ET still comes off without a desk", out3.sent === true && /15:30/.test(out3.cycle.reason), `${out3.cycle.phase} ${out3.cycle.reason}`);
}

/* ------------------------------------------------------------------ */
console.log("it cannot open");
{
  // The exact configuration verify-rh-dispatch uses to SEND an open.
  const opens = tooling();
  const sanity = await runRhDesk({ desk: desk(21000), manager: manager(TEN), nowMs: TEN, tooling: opens, ledger: memoryLedger() });
  check(
    "control: this configuration does open when the sender is called normally",
    sanity.cycle.phase === "place",
    `${sanity.cycle.phase} ${sanity.why}`,
  );

  const t1 = tooling();
  const o1 = await runRhDesk({ desk: desk(21000), manager: null, nowMs: TEN, tooling: closeOnlyTooling(t1), ledger: memoryLedger(), blockNewEntries: true });
  check("layer 1+2+3 together: the job never places", o1.sent === false && !t1.calls.some((c) => Array.isArray(c) && c[0] === "place"), `${o1.cycle.phase} ${o1.why}`);

  const t2 = tooling();
  const o2 = await runRhDesk({ desk: desk(21000), manager: manager(TEN), nowMs: TEN, tooling: t2, ledger: memoryLedger(), blockNewEntries: true });
  check("layer 2 alone (blockNewEntries) stops it", o2.sent === false && !t2.calls.some((c) => Array.isArray(c) && c[0] === "place"), `${o2.cycle.phase} ${o2.why}`);

  const t3 = tooling();
  const o3 = await runRhDesk({ desk: desk(21000), manager: manager(TEN), nowMs: TEN, tooling: closeOnlyTooling(t3), ledger: memoryLedger() });
  check("layer 3 alone (the guard) stops it even with entries unblocked", o3.sent === false && !t3.calls.some((c) => Array.isArray(c) && c[0] === "place"), `${o3.cycle.phase} ${o3.why}`);
  check("and the refusal is the guard's own words", o3.why === CLOSE_ONLY_REFUSAL, o3.why);

  const t4 = tooling();
  const o4 = await runRhDesk({ desk: desk(21000), manager: null, nowMs: TEN, tooling: closeOnlyTooling(t4), ledger: memoryLedger() });
  check("layer 1 alone (no manager) stops it", o4.sent === false && !t4.calls.some((c) => Array.isArray(c) && c[0] === "place"), `${o4.cycle.phase} ${o4.why}`);
}

/* ------------------------------------------------------------------ */
console.log("two instances cannot both close");
if (!process.env.DATABASE_URL) {
  const { PGlite } = await import("@electric-sql/pglite");
  const { sqlLedger } = await import("../src/lib/execution/rh-ledger.ts");
  const pg = new PGlite();
  await pg.exec(readFileSync(new URL("../migrations/0020_rh_desk_book.sql", import.meta.url), "utf8"));
  const sql = { query: async (text, params) => (await pg.query(text, params)).rows };
  const a = sqlLedger(sql);
  await a.put(row());
  check("the slot is claimed once across two instances", (await a.claim(TEN)) === true && (await sqlLedger(sql).claim(TEN + 1_000)) === false);
  check("the second instance still sees the position", (await sqlLedger(sql).list()).length === 1);
  check("a minute later the next run may close again", (await sqlLedger(sql).claim(TEN + 61_000)) === true);
  await pg.close();
} else {
  console.log("  .. skipped (DATABASE_URL is set; this runs on PGLite)");
}

/* ------------------------------------------------------------------ */
console.log("posture");
{
  const src = read("src/routes/api/cron/rh-manage.ts");
  // Every behavioural posture check runs on the CODE. A prose promise in the
  // header comment must not be able to satisfy one.
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
  check("auth is the house cron contract", /authorizeCronRequest\(request\)/.test(code) && /if \(!auth\.ok\) return auth\.response/.test(code));
  check("the route calls the one sender", /runRhDesk\(\{/.test(code));
  const call = /runRhDesk\(\{[\s\S]*?\n {4}\}\)/.exec(code)?.[0] ?? "";
  check("the sender is called with no manager", /manager: null,/.test(call), call);
  check("the sender is called with entries blocked", /blockNewEntries: true,/.test(call), call);
  check("the sender is called with the close-only guard on the tooling", /tooling: closeOnlyTooling\(inner\),/.test(call), call);
  check("it never flattens — that is exec-flatten's job", /flatten/.test(code) === false);
  check("it shares the database desk book", /sqlLedger\(sql\)/.test(code));
  check("it claims the placement slot before sending", /ledger\.claim\(nowMs\)/.test(code) && code.indexOf("ledger.claim(nowMs)") < code.indexOf("runRhDesk({"));
  check("it skips without claiming when nothing this desk opened is on", /if \(!rows\.length\)/.test(code) && code.indexOf("if (!rows.length)") < code.indexOf("ledger.claim(nowMs)"));
  check("it guards against the same instance being rung twice", /let inFlight/.test(code));
  check("no token, access token or refresh token is ever put in the response or a log", /refreshToken|accessToken|RH_ACCESS_TOKEN/.test(src) === false);
  check("errors are generic to the caller and detailed server-side", /jsonResponse\(\{ ok: false, error: "Desk job failed" \}, 500\)/.test(code) && /console\.error\("\[cron\] rh-manage failed:"/.test(code));
  check("the response says which user id was used, so a wrong CRON_USER_ID is visible", /userId: auth\.userId/.test(code) && /linked,/.test(code));

  const tree = read("src/routeTree.gen.ts");
  check("the route is wired into the generated tree", /'\/api\/cron\/rh-manage'/.test(tree) && /ApiCronRhManageRoute: ApiCronRhManageRoute,/.test(tree));

  const doc = read("docs/RH_LIVE_ROUTINE.md");
  check("the routine names the route", /\/api\/cron\/rh-manage/.test(doc));
  check("the routine lists the preconditions before it is switched on", /## Before it is switched on/.test(doc));
  check("the routine says where the refresh token lives", /rh_oauth/.test(doc) && /CRON_USER_ID/.test(doc));
  check("the routine says what is still missing", /## Still missing/.test(doc));
}

console.log(`\nrh-desk-job: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
