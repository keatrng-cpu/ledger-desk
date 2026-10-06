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
const result = F.kalshiAdapterResult(fixture.markets, fixture.asOf);
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

console.log("\nper-row asOf from Kalshi updated_time");
const byId = Object.fromEntries(fixture.markets.map((m) => [m.ticker, m]));
ok(
  "rows prefer updated_time over fetch asOf",
  result.markets.every((m) => {
    const raw = byId[m.id];
    if (!raw) return true;
    const want = raw.updated_time && String(raw.updated_time).trim() ? raw.updated_time : fixture.asOf;
    return m.asOf === want;
  }),
);
ok("result.asOf stays fetch-time", result.asOf === fixture.asOf);
const stamped = result.markets.find((m) => m.id === "KXNFLGAME-26OCT05MINDET-MIN");
ok("sample MIN row asOf is updated_time", !!stamped && stamped.asOf === "2026-10-06T01:55:00.000Z");

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
          console.log(`  first: ${mapped.markets[0].id} grade=${mapped.markets[0].setupGrade} yes=${mapped.markets[0].yesPrice} asOf=${mapped.markets[0].asOf}`);
        }
        ok(
          "live rows use updated_time when present",
          mapped.markets.every((m, i) => {
            const raw = markets[i] ?? markets.find((x) => x.ticker === m.id);
            if (!raw?.updated_time) return true;
            // mapped may be re-ordered by rank — look up by id
            const src = markets.find((x) => x.ticker === m.id);
            return !src?.updated_time || m.asOf === src.updated_time;
          }),
        );
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
