/**
 * The Mead Hall's data seams (presentation only):
 *   - mead-feed: Kalshi result → hall state; MOCK rows only when allowed AND Kalshi is empty
 *   - mead-screens: labels for broad markets (sports / econ / politics / weather), and
 *     the jumbotron hit-test that turns a YES / NO tap into a paper ticket request.
 *
 * Run: npm test  (node --test, TypeScript via tsx's loader)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { register } from "tsx/esm/api";

register();
const { meadStateFrom, createMeadFeed } = await import("../src/components/mead/mead-feed.ts");
const { categoryLabel, eventLabel, jumboHit, JUMBO_HITS, JUMBO_ROWS } = await import("../src/components/mead/mead-screens.ts");
const { kalshiAdapterResult, KALSHI_SOURCE_LABEL } = await import("../src/lib/predict/prediction-market-feed.ts");

const RAW = [
  { ticker: "KXNFLGAME-26OCT11GBMIN-MIN", event_ticker: "KXNFLGAME-26OCT11GBMIN", yes_sub_title: "Minnesota", yes_ask_dollars: "0.62", yes_bid_dollars: "0.61", no_ask_dollars: "0.39", yes_ask_size_fp: "500", status: "active" },
  { ticker: "KXCPIYOY-26OCT-T3.0", event_ticker: "KXCPIYOY-26OCT", yes_sub_title: "Above 3.0%", yes_ask_dollars: "0.41", yes_bid_dollars: "0.40", status: "active" },
  { ticker: "KXHIGHNY-26OCT06-T63", event_ticker: "KXHIGHNY-26OCT06", yes_sub_title: "62° or below", yes_ask_dollars: "0.65", yes_bid_dollars: "0.64", status: "active" },
];

test("a non-empty Kalshi result becomes live hall state with the Kalshi label", () => {
  const s = meadStateFrom(kalshiAdapterResult(RAW, "2026-10-06T12:00:00Z"), true);
  assert.equal(s.status, "live");
  assert.equal(s.label, KALSHI_SOURCE_LABEL);
  assert.equal(s.markets.length, 3);
  assert.ok(s.featuredId);
  assert.ok(s.markets.every((m) => m.source === "kalshi"));
});

test("empty Kalshi: MOCK rows only when allowed, and every row says mock", () => {
  const empty = kalshiAdapterResult([], "2026-10-06T12:00:00Z");
  const dev = meadStateFrom(empty, true);
  assert.equal(dev.status, "mock");
  assert.ok(dev.markets.length > 0);
  assert.ok(dev.markets.every((m) => m.source === "mock"));
  assert.match(dev.note, /MOCK/);
  const prod = meadStateFrom(empty, false);
  assert.equal(prod.status, "empty");
  assert.equal(prod.markets.length, 0);
});

test("a failed read never shows mock rows in production", () => {
  const s = meadStateFrom(null, false, "HTTP 503");
  assert.equal(s.status, "error");
  assert.equal(s.markets.length, 0);
});

test("broad markets get readable family tags and event lines", () => {
  const s = meadStateFrom(kalshiAdapterResult(RAW, "2026-10-06T12:00:00Z"), false);
  const by = Object.fromEntries(s.markets.map((m) => [m.id, m]));
  assert.equal(categoryLabel(by["KXNFLGAME-26OCT11GBMIN-MIN"]), "NFL");
  assert.equal(categoryLabel(by["KXCPIYOY-26OCT-T3.0"]), "ECON");
  assert.equal(categoryLabel(by["KXHIGHNY-26OCT06-T63"]), "WEATHER");
  assert.equal(eventLabel(by["KXHIGHNY-26OCT06-T63"]), "NYC high temp · Oct 6");
  assert.equal(eventLabel({ ...by["KXCPIYOY-26OCT-T3.0"], event: "Senate control 2026" }), "Senate control 2026");
});

test("jumbotron taps map to YES / NO on the featured market, rows to that market", () => {
  const s = meadStateFrom(kalshiAdapterResult(RAW, "2026-10-06T12:00:00Z"), false);
  const y = JUMBO_HITS.yes;
  const n = JUMBO_HITS.no;
  assert.deepEqual(jumboHit(y.x + 10, y.y + 10, s), { side: "YES", id: s.featuredId });
  assert.deepEqual(jumboHit(n.x + 10, n.y + 10, s), { side: "NO", id: s.featuredId });
  const others = s.markets.filter((m) => m.id !== s.featuredId);
  assert.deepEqual(jumboHit(200, JUMBO_ROWS.y0 + 14 + 10, s), { side: "YES", id: others[0].id });
  assert.equal(jumboHit(5, 5, s), null);
});

test("the feed loop polls only while subscribed and stops on dispose", async () => {
  let calls = 0;
  const feed = createMeadFeed({ load: async () => (calls++, kalshiAdapterResult(RAW)), every: 60_000, allowMock: false });
  const seen = [];
  const off = feed.subscribe((s) => seen.push(s.status));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(calls, 1);
  assert.ok(seen.includes("live"));
  off();
  feed.dispose();
  feed.refresh();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(calls, 1);
});

test("one failed poll after a live read keeps the live markets (stale), not mock", async () => {
  let n = 0;
  const feed = createMeadFeed({
    load: async () => {
      n++;
      if (n === 1) return kalshiAdapterResult(RAW);
      throw new Error("HTTP 429");
    },
    every: 60_000,
    allowMock: true,
  });
  let last = null;
  const off = feed.subscribe((s) => (last = s));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(last.status, "live");
  feed.refresh();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(last.status, "live");
  assert.ok(last.markets.every((m) => m.source === "kalshi"));
  assert.match(last.note, /STALE/);
  off();
  feed.dispose();
});
