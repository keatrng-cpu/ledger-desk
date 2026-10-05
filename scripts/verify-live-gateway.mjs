/**
 * The live-gateway read path and the gateway's liveness touch against their contract.
 *
 *   npx tsx scripts/verify-live-gateway.mjs
 *
 * WHY: on 2026-10-05 the desk showed "lag 620s" (Yahoo) for ES while the Databento gateway was connected and logging a bar a
 * minute. ohlcv-1s only emits for a second with a trade; in the thin overnight session ES went quiet for longer than the
 * reader's 5 s freshness window, so a healthy gateway read as dead. The fix has two halves, and this pins both:
 *
 *   - the gateway re-stamps `received_at` on every record that reaches its socket (a trade or a 5 s heartbeat), but only for a
 *     print that is itself recent, so a symbol that stopped trading — or a dead socket — still ages out;
 *   - the reader trusts a tick for 12 s (two missed heartbeats and a second), reports `lagSec` as the time since the gateway last
 *     confirmed the price (not since the last print), keeps the print's own time for bar placement, and still fails closed.
 *
 * The SQL under test is the statement in gateway/databento_live_gateway.py, extracted from the file and run on PGLite with the
 * real migration — not a copy of it.
 */
import { readFileSync } from "node:fs";

// live-gateway.ts imports the db module, which starts a Vite-only PGLite bootstrap when no DATABASE_URL is set. Nothing here queries
// through it (the SQL runs on a PGLite of our own below), so point it at a URL that is never opened.
process.env.DATABASE_URL ??= "postgres://127.0.0.1:1/unused";

const GW = await import("../src/lib/market/live-gateway.ts");
const { pickFreshestQuote } = await import("../src/lib/market/freshest.ts");
const { PGlite } = await import("@electric-sql/pglite");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const NOW = Date.UTC(2026, 9, 5, 23, 13, 0);
const row = (printAgoMs, confirmedAgoMs, price = 7832.75) => ({ price, bid: null, ask: null, ts: new Date(NOW - printAgoMs), received_at: new Date(NOW - confirmedAgoMs) });

console.log("the freshness window");
check("the window is 12 s: two missed 5 s heartbeats and a second", GW.TICK_FRESH_MS === 12_000);
check("a tick confirmed 11.9 s ago is live", "tick" in GW.tickFromRow("ES", row(20_000, 11_900), NOW));
check("a tick confirmed exactly 12 s ago is live; 12.001 s ago is not", "tick" in GW.tickFromRow("ES", row(0, 12_000), NOW) && "stale" in GW.tickFromRow("ES", row(0, 12_001), NOW));
check("a dead gateway (last confirmation a minute ago) reads as stale, with the age", (() => { const r = GW.tickFromRow("ES", row(60_000, 60_000), NOW); return "stale" in r && r.stale === 60_000; })());
check("a row from the future (clock skew) is refused, not trusted", "stale" in GW.tickFromRow("ES", { ...row(0, 0), received_at: new Date(NOW + 5_000) }, NOW));
check("a garbage timestamp is refused", "stale" in GW.tickFromRow("ES", { ...row(0, 0), received_at: "not a date" }, NOW));

console.log("a quiet tape");
{
  // The last ES print was 40 s ago; the gateway confirmed the socket 2 s ago.
  const r = GW.tickFromRow("ES", row(40_000, 2_000), NOW);
  check("a print 40 s old, confirmed 2 s ago, is a live tick", "tick" in r);
  const t = r.tick;
  check("…it keeps the print's own time for bar placement", t.marketTimeMs === NOW - 40_000 && t.receivedAtMs === NOW - 2_000);
  const q = GW.quoteFromLiveTick({ ...t }, "ES=F", 7800);
  const realNow = Date.now();
  check("…its source is the gateway, and lagSec is the time since confirmation, not since the print", q.source === "live_gateway" && q.lagSec >= 0 && q.lagSec <= Math.round((realNow - t.receivedAtMs) / 1000) + 1, `lagSec ${q.lagSec}`);
  const fixed = { ...t, receivedAtMs: Date.now() - 2_000, marketTimeMs: Date.now() - 40_000 };
  const q2 = GW.quoteFromLiveTick(fixed, "ES=F", 7800);
  check("…2 s after confirmation the HUD reads lag 2, not 40 (the old reading)", q2.lagSec === 2, `lagSec ${q2.lagSec}`);
  check("…and the quote's market time is still the print's (so the forming bar is placed by it)", Math.abs(q2.marketTimeMs - fixed.marketTimeMs) < 5);
  const yahoo = { ...q2, source: "yahoo", lagSec: 620, marketTimeMs: Date.now() - 620_000 };
  check("against a Yahoo quote 620 s late the gateway wins", pickFreshestQuote(yahoo, q2)?.source === "live_gateway");
  check("a gateway quote 8 s after confirmation still beats it (the old 5 s rule would have left it to the sort)", pickFreshestQuote(yahoo, { ...q2, lagSec: 8 })?.source === "live_gateway");
}

console.log("a slow or empty read (tickOrCached)");
{
  const mk = (confirmedAgoMs) => GW.tickFromRow("ES", row(30_000, confirmedAgoMs), NOW).tick ?? { symbol: "ES", price: 1, bid: null, ask: null, marketTimeMs: NOW - 30_000, receivedAtMs: NOW - confirmedAgoMs, ageMs: confirmedAgoMs };
  const fresh = mk(2_000);
  check("a tick that was read passes straight through", GW.tickOrCached(fresh, undefined, NOW) === fresh);
  check("a read that found nothing and has nothing cached is null", GW.tickOrCached(null, undefined, NOW) === null);
  const cached = { symbol: "ES", price: 7833.75, bid: null, ask: null, marketTimeMs: NOW - 30_000, receivedAtMs: NOW - 4_000, ageMs: 4_000 };
  const served = GW.tickOrCached(null, cached, NOW);
  check("a slow read falls back to the last tick while it is inside the window, with its age brought up to date", served && served.price === 7833.75 && served.ageMs === 4_000 && GW.tickOrCached(null, cached, NOW + 3_000)?.ageMs === 7_000);
  check("…the print's own time and confirmation time are untouched", served.marketTimeMs === cached.marketTimeMs && served.receivedAtMs === cached.receivedAtMs);
  check("…it stops at the edge of the window (12 s ok, 12.001 s not), counted from the gateway's confirmation", GW.tickOrCached(null, cached, NOW + 8_000) != null && GW.tickOrCached(null, cached, NOW + 8_001) === null);
  check("a cached tick from the future (clock skew) is refused", GW.tickOrCached(null, { ...cached, receivedAtMs: NOW + 1_000 }, NOW) === null);
  check("a cached tick can never make a dead gateway look live: a minute on it is gone", GW.tickOrCached(null, cached, NOW + 60_000) === null);
  check("the desk waits 750 ms for the database, not 150", GW.TICK_READ_WAIT_MS === 750);
  const q = GW.quoteFromLiveTick({ ...served, receivedAtMs: Date.now() - 6_000 }, "ES=F", 7800);
  check("a quote built from a cached tick reports its true confirmation age as lagSec", q.lagSec === 6, `lagSec ${q.lagSec}`);
}

console.log("the gateway's touch statement (the SQL in the Python file, on PGLite with migration 0011)");
{
  const py = readFileSync(new URL("../gateway/databento_live_gateway.py", import.meta.url), "utf8");
  const m = /update live_market_ticks[\s\S]*?(?="""\s*,)/.exec(py);
  check("the statement is in the gateway file", !!m);
  const sql = m[0].replace(/%s::double precision/g, "$1::double precision").replace(/%s/g, "$1");
  const db = new PGlite();
  await db.exec(readFileSync(new URL("../migrations/0011_live_gateway.sql", import.meta.url), "utf8"));
  const seed = async (sym, tsAgoSec, recvAgoSec, source = "databento_live") =>
    db.query(
      `insert into live_market_ticks (symbol, price, ts, received_at, source) values ($1, 100, now() - make_interval(secs => $2::double precision), now() - make_interval(secs => $3::double precision), $4)
       on conflict (symbol) do update set ts = excluded.ts, received_at = excluded.received_at, source = excluded.source`,
      [sym, tsAgoSec, recvAgoSec, source],
    );
  const ageOf = async (sym) => Number((await db.query(`select extract(epoch from (now() - received_at)) as a from live_market_ticks where symbol = $1`, [sym])).rows[0].a);
  const tsAgeOf = async (sym) => Number((await db.query(`select extract(epoch from (now() - ts)) as a from live_market_ticks where symbol = $1`, [sym])).rows[0].a);

  await seed("ES", 40, 40); // last print 40 s ago, last confirmed 40 s ago
  await seed("NQ", 660, 660); // no print for 11 minutes
  await db.query(sql, [600]);
  check("a print 40 s old is re-confirmed (received_at is now fresh)", (await ageOf("ES")) < 5, String(await ageOf("ES")));
  check("…and its print time is left alone", Math.abs((await tsAgeOf("ES")) - 40) < 5, String(await tsAgeOf("ES")));
  check("a symbol that has not printed for 11 minutes is NOT kept alive", (await ageOf("NQ")) > 600, String(await ageOf("NQ")));

  await seed("ES", 599, 599);
  await seed("NQ", 601, 601);
  await db.query(sql, [600]);
  check("the cut is ten minutes: 599 s is touched, 601 s is not", (await ageOf("ES")) < 5 && (await ageOf("NQ")) > 600);

  await seed("ES", 5, 300, "somewhere_else");
  await db.query(sql, [600]);
  check("a row the gateway did not write is never touched", (await ageOf("ES")) > 250, String(await ageOf("ES")));

  // Dead socket: nothing calls the statement, so nothing is kept alive and the reader fails closed.
  await seed("ES", 3, 3);
  const asRow = (await db.query(`select price, bid, ask, ts, received_at from live_market_ticks where symbol = 'ES'`)).rows[0];
  const later = new Date(asRow.received_at).getTime() + 13_000;
  check("with no touch for 13 s the reader calls the row stale", "stale" in GW.tickFromRow("ES", asRow, later));
  await db.close();
}

console.log("the gateway's stream loop");
{
  const py = readFileSync(new URL("../gateway/databento_live_gateway.py", import.meta.url), "utf8");
  check("it asks Databento for a heartbeat at the 5 s minimum", /HEARTBEAT_INTERVAL_S\s*=\s*5\b/.test(py) && /db\.Live\(key=self\._api_key,\s*heartbeat_interval_s=HEARTBEAT_INTERVAL_S\)/.test(py));
  check("the touch runs on any record, throttled to once a second", /TOUCH_MIN_SEC\s*=\s*1\.0/.test(py) && /now_m - self\._last_touch >= TOUCH_MIN_SEC/.test(py));
  check("a failed touch is logged and never takes the stream down", /try:\s*\n\s*self\.touch_ticks\(\)\s*\n\s*except Exception:[^\n]*\n\s*log\.exception\("liveness touch failed"\)/.test(py));
  check("the touch is capped at ten minutes of silence", /TOUCH_MAX_SILENCE_SEC\s*=\s*600/.test(py));
  check("the touch happens after the window check and before the price filter (so a heartbeat counts)", py.indexOf("self.touch_ticks()") > py.indexOf("NY AM window closed") && py.indexOf("self.touch_ticks()") < py.indexOf("isinstance(record, db.OHLCVMsg)"));
}

console.log(`\nlive-gateway: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
