/**
 * PredictionMarketFeed — mapper + grading against the Kalshi fixture, plus
 * an optional live public fetch (no API key).
 *
 * Run: npx tsx scripts/verify-prediction-market-feed.mjs
 * Live: npx tsx scripts/verify-prediction-market-feed.mjs --live
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const F = await import("../src/lib/predict/prediction-market-feed.ts");

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "../src/lib/predict/fixtures/kalshi-markets.sample.json"), "utf8"));

console.log("\nKalshi fixture → PredictionMarket shape");
const result = F.kalshiAdapterResult(fixture.markets, fixture.asOf, Date.parse(fixture.asOf) + 5_000);
check("source is kalshi", result.source, "kalshi");
ok("label names Kalshi + Robinhood", /Kalshi.*Robinhood/i.test(result.label));
ok("maps at least 6 markets", result.markets.length >= 6);
ok("every row has required Prototype Lab fields", result.markets.every((m) =>
  m.id && m.event && m.outcome && "yesPrice" in m && "noPrice" in m &&
  "winChance" in m && "edge" in m && m.setupGrade && m.gates &&
  m.source === "kalshi" && typeof m.asOf === "string"
));
ok("gates carry word/passed/total", result.markets.every((m) =>
  typeof m.gates.word === "string" && typeof m.gates.passed === "number" && m.gates.total === 8
));
ok("volume/expiry preserved when present", result.markets.some((m) => m.volume != null && m.expiry != null));

console.log("\nprice asOf = FETCH time; updated_time is separate metadata (Accuracy revert)");
const byId = Object.fromEntries(fixture.markets.map((m) => [m.ticker, m]));
const fixtureNow = Date.parse(fixture.asOf) + 5_000; // read 5s after the fetch
const fresh = F.kalshiAdapterResult(fixture.markets, fixture.asOf, fixtureNow);
ok("every row asOf === fetch asOf (never updated_time)", fresh.markets.every((m) => m.asOf === fixture.asOf));
ok("result.asOf stays fetch-time", fresh.asOf === fixture.asOf);
const stamped = fresh.markets.find((m) => m.id === "KXNFLGAME-26OCT05MINDET-MIN");
ok("sample MIN row asOf is fetch time, not updated_time", !!stamped && stamped.asOf === fixture.asOf && stamped.asOf !== "2026-10-06T01:55:00.000Z");
check("sample MIN row exposes updatedTime separately", stamped?.updatedTime, "2026-10-06T01:55:00.000Z");
ok(
  "updatedTime mirrors raw updated_time (validated ISO) on every row",
  fresh.markets.every((m) => m.updatedTime === F.isoOrNull(byId[m.id]?.updated_time)),
);

console.log("\nISO timestamp validation");
check("isoOrNull Z", F.isoOrNull("2026-10-06T01:55:00Z"), "2026-10-06T01:55:00.000Z");
check("isoOrNull offset → UTC", F.isoOrNull("2026-10-05T21:55:00-04:00"), "2026-10-06T01:55:00.000Z");
check("isoOrNull microseconds", F.isoOrNull("2026-10-06T01:55:00.123456Z"), "2026-10-06T01:55:00.123Z");
check("isoOrNull rejects garbage", F.isoOrNull("not-a-date"), null);
check("isoOrNull rejects zone-less", F.isoOrNull("2026-10-06T01:55:00"), null);
check("isoOrNull rejects date-only", F.isoOrNull("2026-10-06"), null);
check("isoOrNull rejects impossible date", F.isoOrNull("2026-13-45T99:00:00Z"), null);
check("isoOrNull rejects non-string", F.isoOrNull(1791251700000), null);
{
  const bad = { ...byId["KXGDP-26Q3-T2"], ticker: "KXBADTS-1", updated_time: "yesterday", expected_expiration_time: "soon", expiration_time: "2026-10-31T00:00:00Z" };
  const row = F.gradeKalshiPublicMarket(bad, fixture.asOf, fixtureNow);
  check("invalid updated_time → updatedTime null", row?.updatedTime, null);
  check("invalid expected_expiration_time falls back to valid expiration_time", row?.expiry, "2026-10-31T00:00:00.000Z");
  const r2 = F.kalshiAdapterResult([bad], "garbage", fixtureNow);
  ok("invalid fetch asOf replaced by a valid ISO", F.isoOrNull(r2.asOf) === r2.asOf);
  ok("invalid fetch asOf → result stale", r2.stale === true);
  check("invalid fetch asOf → row staleReason", r2.markets[0]?.staleReason, "invalid_fetch_time");
}

console.log("\nstale flag (fetch age > PREDICTION_STALE_MS, invalid fetch time, last-trade-only)");
check("PREDICTION_STALE_MS is 60s", F.PREDICTION_STALE_MS, 60_000);
ok("fresh read: result not stale", fresh.stale === false);
ok("fresh read: book-priced rows not stale", fresh.markets.filter((m) => m.priceBasis === "book").every((m) => m.stale === false && m.staleReason === null));
const old = F.kalshiAdapterResult(fixture.markets, fixture.asOf, Date.parse(fixture.asOf) + 61_000);
ok("61s-old read: result stale", old.stale === true);
ok("61s-old read: every row stale with fetch_age", old.markets.every((m) => m.stale === true && m.staleReason === "fetch_age"));
ok("isStaleAsOf boundary: exactly 60s is fresh", F.isStaleAsOf(fixture.asOf, Date.parse(fixture.asOf) + 60_000) === false);
{
  const lastOnly = { ticker: "KXLAST-1", event_ticker: "KXLAST", yes_sub_title: "Yes", last_price_dollars: "0.4200", status: "active" };
  const row = F.gradeKalshiPublicMarket(lastOnly, fixture.asOf, fixtureNow);
  check("no book → priceBasis last_trade", row?.priceBasis, "last_trade");
  ok("last-trade-only row is stale (missing quote time)", row?.stale === true && row?.staleReason === "last_trade_only");
  check("last-trade-only row asOf still fetch time", row?.asOf, fixture.asOf);
}

console.log("\nlabel fallbacks are explicit");
ok("fixture rows use preferred labels (no fallback)", fresh.markets.every((m) => m.labelFallback && m.labelFallback.used === false));
{
  const t = F.gradeKalshiPublicMarket({ ticker: "KXFOO-26-BAR", title: "Foo wins", yes_ask_dollars: "0.5", yes_bid_dollars: "0.48" }, fixture.asOf, fixtureNow);
  check("no event_ticker → event from title", [t?.event, t?.labelFallback?.event], ["Foo wins", "title"]);
  check("no yes_sub_title → outcome from title", [t?.outcome, t?.labelFallback?.outcome], ["Foo wins", "title"]);
  ok("fallback used flag set", t?.labelFallback?.used === true);
  const u = F.gradeKalshiPublicMarket({ ticker: "KXFOO-26-BAR", yes_ask_dollars: "0.5", event_ticker: "  " }, fixture.asOf, fixtureNow);
  check("blank event_ticker + no title → ticker / ticker_suffix", [u?.event, u?.labelFallback?.event, u?.outcome, u?.labelFallback?.outcome], ["KXFOO-26-BAR", "ticker", "BAR", "ticker_suffix"]);
}

console.log("\nno_ask === 1.0 allowed (unitPrice <= 1)");
ok("unitPrice(1) keeps 1", F.unitPrice(1) === 1);
ok("unitPrice(0) rejects", F.unitPrice(0) === null);
ok("unitPrice(1.01) rejects", F.unitPrice(1.01) === null);
const noAsk1 = result.markets.find((m) => m.id === "KXNOASK1-DEMO-YES");
ok("no_ask=1.0 fixture mapped", !!noAsk1);
ok("noPrice preserves 1.0", !!noAsk1 && noAsk1.noPrice === 1);

const longshot = result.markets.find((m) => m.id.includes("LONGSHOT"));
ok("longshot fixture mapped", !!longshot);
ok("longshot ask is in <20¢ zone", !!longshot && longshot.yesPrice != null && longshot.yesPrice < 0.2);
ok("longshot is not A+/A (Predict longshot + hard refs)", !!longshot && longshot.setupGrade !== "A+" && longshot.setupGrade !== "A");
ok("longshot STAND word", !!longshot && longshot.gates.word === "STAND");

console.log("\nranking — setup quality first, moderate NFL boost only");
const ranked = result.markets;
ok("ranked list non-empty", ranked.length > 0);
// Equal-grade NFL should sort ahead of non-NFL when grades match.
const sameGrade = ranked.filter((m) => m.setupGrade === ranked[0]?.setupGrade);
if (sameGrade.length >= 2) {
  const firstNflIdx = sameGrade.findIndex((m) => F.isNflMarket({ id: m.id, event: m.event }));
  const firstNonIdx = sameGrade.findIndex((m) => !F.isNflMarket({ id: m.id, event: m.event }));
  if (firstNflIdx >= 0 && firstNonIdx >= 0) {
    ok("within same grade, NFL sorts before non-NFL", firstNflIdx < firstNonIdx);
  } else {
    ok("same-grade NFL/non-NFL pair not both present (skip tie-break assert)", true);
  }
} else {
  ok("single top grade cohort (skip NFL tie-break assert)", true);
}
ok("Vikings ticker gets no special boost beyond NFL", !ranked.some((m) => /VIKINGS|MIN\b/i.test(m.outcome) && m.setupGrade === "A+" && m.gates.word === "GO"));

console.log("\nrh_mcp_unavailable empty stub (not a quote fallback)");
const rh = F.rhMcpUnavailableAdapter(fixture.asOf);
check("RH empty stub source", rh.source, "rh_mcp_unavailable");
check("RH empty stub markets empty", rh.markets, []);
check("RH empty stub label", rh.label, F.RH_MCP_EMPTY_LABEL);
ok("RH empty stub label names empty + no event-contract tools", /empty/i.test(rh.label) && /event-contract/i.test(rh.label));
ok("RH empty stub reason documents no event-contract tools", /event-contract|prediction-market/i.test(rh.reason ?? ""));
ok("RH asOf set", typeof rh.asOf === "string" && rh.asOf.length > 10);

console.log("\ngradeFor / gradeFromGates reuse Predict model");
ok("gradeFromGates GO → A+", F.gradeFromGates({ word: "GO", passed: 8, total: 8, missing: null }, false) === "A+");
ok("gradeFromGates LIMIT → A", F.gradeFromGates({ word: "LIMIT", passed: 7, total: 8, missing: "ask above limit" }, false) === "A");
ok("gradeFromGates hard → D", F.gradeFromGates({ word: "STAND", passed: 3, total: 8, missing: "no ref" }, true) === "D");

console.log("\nseries fetch stagger helpers (predict-server)");
const S = await import("../src/lib/predict/predict-server.ts");
ok("KALSHI_SERIES_CONCURRENCY is 1 or 2", S.KALSHI_SERIES_CONCURRENCY === 1 || S.KALSHI_SERIES_CONCURRENCY === 2);
ok("KALSHI_SERIES_GAP_MS > 0", typeof S.KALSHI_SERIES_GAP_MS === "number" && S.KALSHI_SERIES_GAP_MS > 0);
{
  const order = [];
  const started = [];
  let maxInFlight = 0;
  let inFlight = 0;
  const t0 = Date.now();
  await S.mapWithConcurrency([1, 2, 3, 4], 1, 40, async (n) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    started.push({ n, at: Date.now() - t0 });
    await new Promise((r) => setTimeout(r, 10));
    order.push(n);
    inFlight--;
    return n;
  });
  ok("mapWithConcurrency concurrency=1 never overlaps", maxInFlight === 1);
  check("mapWithConcurrency preserves order", order, [1, 2, 3, 4]);
  ok(
    "mapWithConcurrency gaps between series",
    started.length === 4 && started[1].at - started[0].at >= 35 && started[2].at - started[1].at >= 35,
  );
}

console.log("\n429 Retry-After honored with a cap (predict-server)");
check("parseRetryAfterMs delta-seconds", S.parseRetryAfterMs("2"), 2000);
check("parseRetryAfterMs fractional", S.parseRetryAfterMs("0.25"), 250);
check("parseRetryAfterMs HTTP-date", S.parseRetryAfterMs("Wed, 21 Oct 2015 07:28:05 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT")), 5000);
check("parseRetryAfterMs past date → 0", S.parseRetryAfterMs("Wed, 21 Oct 2015 07:27:00 GMT", Date.parse("Wed, 21 Oct 2015 07:28:00 GMT")), 0);
check("parseRetryAfterMs missing → null", S.parseRetryAfterMs(null), null);
check("parseRetryAfterMs garbage → null", S.parseRetryAfterMs("soon"), null);
check("parseRetryAfterMs negative → null", S.parseRetryAfterMs("-3"), null);
ok("KALSHI_RETRY_AFTER_CAP_MS is a positive cap", S.KALSHI_RETRY_AFTER_CAP_MS > 0 && S.KALSHI_RETRY_AFTER_CAP_MS <= 10_000);
{
  const waits = [];
  let calls = 0;
  const rows = await S.fetchKalshiSeries("KXTEST", 5, {
    fetchOnce: async () => {
      calls++;
      if (calls === 1) throw new S.HttpError(429, "2");
      return [{ ticker: "KXTEST-1", _series: "KXTEST" }];
    },
    sleepFn: async (ms) => void waits.push(ms),
  });
  check("429 Retry-After: 2 → waits exactly 2000ms then retries", [waits, calls, rows.length], [[2000], 2, 1]);
}
{
  const waits = [];
  let calls = 0;
  let err = null;
  try {
    await S.fetchKalshiSeries("KXTEST", 5, {
      fetchOnce: async () => {
        calls++;
        throw new S.HttpError(429, String(Math.ceil(S.KALSHI_RETRY_AFTER_CAP_MS / 1000) + 30));
      },
      sleepFn: async (ms) => void waits.push(ms),
    });
  } catch (e) {
    err = e;
  }
  ok("Retry-After above cap → no early retry, no wait", calls === 1 && waits.length === 0);
  ok("Retry-After above cap → error names the cap", !!err && /exceeds cap/.test(err.message));
}
{
  const waits = [];
  let calls = 0;
  await S.fetchKalshiSeries("KXTEST", 5, {
    fetchOnce: async () => {
      calls++;
      if (calls < 3) throw new S.HttpError(429, null);
      return [];
    },
    sleepFn: async (ms) => void waits.push(ms),
  });
  check("429 without Retry-After → exponential backoff", waits, [400, 800]);
}
{
  const waits = [];
  let err = null;
  try {
    await S.fetchKalshiSeries("KXTEST", 5, {
      fetchOnce: async () => {
        throw new S.HttpError(429, "2");
      },
      sleepFn: async (ms) => void waits.push(ms),
      deadlineAt: Date.now() + 500,
    });
  } catch (e) {
    err = e;
  }
  ok("Retry-After wait that crosses the feed deadline is not started", waits.length === 0 && !!err && /deadline/.test(err.message));
}
{
  let calls = 0;
  let err = null;
  try {
    await S.fetchKalshiSeries("KXTEST", 5, {
      fetchOnce: async () => {
        calls++;
        throw new S.HttpError(500, null);
      },
      sleepFn: async () => {},
    });
  } catch (e) {
    err = e;
  }
  ok("non-429 errors are not retried", calls === 1 && err?.message === "HTTP 500");
}

console.log("\ntotal wall-clock deadline for the serial Kalshi feed");
ok("KALSHI_FEED_DEADLINE_MS well inside the ~30s edge cut", S.KALSHI_FEED_DEADLINE_MS > 0 && S.KALSHI_FEED_DEADLINE_MS < 25_000);
{
  // Each series takes 80ms; budget 200ms → the first 2 finish, the 3rd is aborted mid-flight, the rest never start.
  const startedSeries = [];
  const t0 = Date.now();
  const r = await S.fetchKalshiFeed(["KXA", "KXB", "KXC", "KXD", "KXE"], 5, {
    deadlineMs: 200,
    gapMs: 10,
    fetchSeries: (s, _n, ctx) =>
      new Promise((resolve, reject) => {
        startedSeries.push(s);
        const t = setTimeout(
          () => resolve([{ ticker: `${s}-26-YES`, event_ticker: s, yes_sub_title: "Yes", yes_ask_dollars: "0.5", yes_bid_dollars: "0.49", status: "active", _series: s }]),
          80,
        );
        ctx.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(ctx.signal.reason);
        });
      }),
  });
  const took = Date.now() - t0;
  ok(`deadline pass returns near budget (took ${took}ms)`, took < 400);
  ok("deadlineExceeded flagged", r.deadlineExceeded === true);
  check("partial: rows from series read before the deadline", r.markets.map((m) => m.id).sort(), ["KXA-26-YES", "KXB-26-YES"]);
  check("skipped lists unread series in order", r.skipped, ["KXC", "KXD", "KXE"]);
  ok("series after the deadline were never started", !startedSeries.includes("KXD") && !startedSeries.includes("KXE"));
  ok("partial reason names the deadline", /Partial Kalshi read/.test(r.reason ?? "") && /deadline 200ms exceeded/.test(r.reason ?? ""));
  ok("partial rows asOf is fetch time (valid ISO)", r.markets.every((m) => F.isoOrNull(m.asOf) === m.asOf && m.asOf === r.asOf));
}
{
  const r = await S.fetchKalshiFeed(["KXA", "KXB"], 5, {
    deadlineMs: 50,
    gapMs: 0,
    fetchSeries: (_s, _n, ctx) =>
      new Promise((_resolve, reject) => {
        ctx.signal?.addEventListener("abort", () => reject(ctx.signal.reason));
      }),
  });
  check("deadline before any series → empty markets", r.markets, []);
  ok("empty deadline result flagged + reason", r.deadlineExceeded === true && /deadline 50ms exceeded/.test(r.reason ?? ""));
  check("empty deadline result skipped all", r.skipped, ["KXA", "KXB"]);
  check("empty deadline result source/label stay Kalshi", [r.source, r.label], ["kalshi", F.KALSHI_SOURCE_LABEL]);
}
{
  // A fetcher that IGNORES the abort signal must still not hold the feed past its budget.
  const t0 = Date.now();
  const r = await S.fetchKalshiFeed(["KXSTUCK", "KXNEXT"], 5, {
    deadlineMs: 100,
    gapMs: 0,
    fetchSeries: () => new Promise((resolve) => setTimeout(() => resolve([]), 1_500)),
  });
  const took = Date.now() - t0;
  ok(`abort-ignoring fetch still returns at the deadline (took ${took}ms)`, took < 400 && r.deadlineExceeded === true);
  check("abort-ignoring fetch: all series skipped", r.skipped, ["KXSTUCK", "KXNEXT"]);
}
{
  const r = await S.fetchKalshiFeed(["KXA", "KXBAD"], 5, {
    deadlineMs: 2_000,
    gapMs: 0,
    fetchSeries: async (s) => {
      if (s === "KXBAD") throw new S.HttpError(500, null);
      return [{ ticker: "KXA-26-YES", event_ticker: "KXA", yes_sub_title: "Yes", yes_ask_dollars: "1.0", yes_bid_dollars: "0.99", status: "active", _series: "KXA" }];
    },
  });
  ok("within budget: no deadline flag", r.deadlineExceeded === undefined);
  check("within budget: failed series skipped", r.skipped, ["KXBAD"]);
  ok("within budget: partial reason names failure", /failed: KXBAD: HTTP 500/.test(r.reason ?? ""));
  check("yes ask of exactly 1.0 kept", r.markets[0]?.yesPrice, 1);
}

const live = process.argv.includes("--live");
if (live) {
  console.log("\nlive Kalshi public fetch (no API key)");
  const url = "https://api.elections.kalshi.com/trade-api/v2/markets?limit=15&status=open&series_ticker=KXMLBGAME";
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "ledger-desk-verify/1.0" },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.status === 429) {
      ok("live host reachable without API key (429 = public rate limit, not auth)", true);
      console.log("  note: rate-limited; earlier box probes returned 200 on this host with no credentials");
    } else {
      ok(`HTTP ${res.status} from elections host (no key)`, res.status === 200);
      if (res.ok) {
        const json = await res.json();
        const markets = json.markets ?? [];
        ok(`live markets count > 0 (got ${markets.length})`, markets.length > 0);
        const mapped = F.kalshiAdapterResult(markets.map((m) => ({ ...m, _series: "KXMLBGAME" })));
        ok("live mapper produced rows or empty without throw", Array.isArray(mapped.markets));
        console.log(`  live sample count: ${mapped.markets.length}`);
        if (mapped.markets[0]) {
          console.log(`  first: ${mapped.markets[0].id} grade=${mapped.markets[0].setupGrade} yes=${mapped.markets[0].yesPrice} asOf=${mapped.markets[0].asOf} updatedTime=${mapped.markets[0].updatedTime} stale=${mapped.markets[0].stale}`);
        }
        ok("live rows asOf = fetch time (never updated_time)", mapped.markets.every((m) => m.asOf === mapped.asOf));
        ok(
          "live rows expose updatedTime separately (validated ISO or null)",
          mapped.markets.every((m) => {
            const src = markets.find((x) => x.ticker === m.id);
            return m.updatedTime === F.isoOrNull(src?.updated_time);
          }),
        );
        ok("live result fresh (not stale)", mapped.stale === false);
      } else if (res.status === 401 || res.status === 403) {
        ok("UNEXPECTED auth required — STOP, do not invent credentials", false);
      }
    }
  } catch (e) {
    ok(`live fetch error (no credentials invented): ${e instanceof Error ? e.message : e}`, false);
  }
} else {
  console.log("\n(live fetch skipped — pass --live to hit Kalshi public API)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
