/**
 * PM signal engine + paper scorer — fixture checks, optional live Kalshi read.
 *
 * Run:  npx tsx scripts/verify-pm-signal-engine.mjs
 * Live: npx tsx scripts/verify-pm-signal-engine.mjs --live   (public Kalshi, no key, read-only)
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
const near = (a, b, eps = 1e-4) => a != null && b != null && Math.abs(a - b) <= eps;

const E = await import("../src/lib/predict/signals.ts");
const M = await import("../src/lib/predict/math.ts");
const S = await import("../src/lib/predict/predict-server.ts");

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "../src/lib/predict/fixtures/kalshi-markets.sample.json"), "utf8"));
const asOf = fixture.asOf;
const now = Date.parse(asOf) + 5_000;
const gi = (g) => E.SIGNAL_GRADES.indexOf(g);

console.log("\nBoard from the Kalshi fixture (no model, no candles)");
const board = E.buildSignalBoard({ raw: fixture.markets, asOf }, { now });
ok("signals built", board.signals.length > 0);
ok("never more signals than raw rows", board.signals.length <= fixture.markets.length);
check("engine version", board.engineVersion, "pm-signal/1");
check("default fee model is Kalshi taker", board.feeModel, "kalshi");
ok("every signal has the Prototype Lab fields", board.signals.every((s) =>
  s.id && s.grade && Array.isArray(s.reasons) && s.reasons.length > 0 && s.headline &&
  "feeAdjustedYes" in s.implied && "cents" in s.spread && typeof s.liquidity.score === "number" &&
  "sinceOpen" in s.move && "velocityCentsPerHour" in s.move && "msToSettle" in s.settlement && s.freshness.asOf));
ok("no model → every edge is 'no edge read'", board.signals.every((s) => s.edge.status === "no edge read" && s.edge.reason));
check("noEdgeCount = all", board.noEdgeCount, board.signals.length);
ok("no model → no grade better than B", board.signals.every((s) => gi(s.grade) >= gi("B")));
ok("prices are the raw prices (not invented)", board.signals.every((s) => {
  const r = fixture.markets.find((m) => m.ticker === s.id);
  const p = (v) => (v == null ? null : Number(v) > 0 && Number(v) <= 1 ? Number(v) : null);
  return r && s.prices.yesAsk === p(r.yes_ask_dollars) && s.prices.yesBid === p(r.yes_bid_dollars);
}));
ok("ranked: grade non-decreasing", board.signals.every((s, i, a) => i === 0 || gi(a[i - 1].grade) <= gi(s.grade)));

console.log("\nFee-adjusted implied probability (net of fees + slippage)");
const base = {
  ticker: "KXMLBGAME-TEST-AAA", event_ticker: "KXMLBGAME-TEST", yes_sub_title: "AAA", title: "AAA wins",
  yes_bid_dollars: "0.5400", yes_ask_dollars: "0.5600", no_bid_dollars: "0.4400", no_ask_dollars: "0.4600",
  last_price_dollars: "0.5500", yes_bid_size_fp: "800", yes_ask_size_fp: "900", volume_24h_fp: "5000",
  close_time: "2026-10-06T08:00:00Z", expected_expiration_time: "2026-10-06T06:00:00Z", status: "active", _series: "KXMLBGAME",
};
const s0 = E.computeSignal(base, { asOf, now });
const feeY = M.feePerContract(0.56, 100, M.VENUES.kalshi);
check("Kalshi taker fee at 56¢ = ceil(0.07·100·.56·.44)/100", feeY, 0.0173);
ok("feeAdjustedYes = ask + fee + 1¢", near(s0.implied.feeAdjustedYes, 0.56 + 0.0173 + 0.01));
ok("feeAdjustedNo = no ask + fee + 1¢", near(s0.implied.feeAdjustedNo, 0.46 + M.feePerContract(0.46, 100, M.VENUES.kalshi) + 0.01));
ok("no-trade band brackets the mid", s0.implied.noTradeBand[0] < 0.55 && s0.implied.noTradeBand[1] > 0.55);
check("spread 2¢", s0.spread.cents, 2);
check("overround", s0.implied.overround, 0.02);
check("time to settle in words", s0.settlement.words, "4.0 h");
check("freshness live", s0.freshness.word, "live");
check("coin-flip, no model → B (setup only)", s0.grade, "B");
ok("reasons say why it is capped", s0.reasons.some((r) => r.effect === "cap" && /No edge read/.test(r.text)));

console.log("\nFavorite–longshot: cheap YES grades down by default");
const cheap = E.computeSignal({ ...base, ticker: "KXMLBGAME-TEST-CHEAP", yes_bid_dollars: "0.0600", yes_ask_dollars: "0.0700", no_bid_dollars: "0.9300", no_ask_dollars: "0.9400" }, { asOf, now });
check("≤10¢ YES capped at D", gi(cheap.grade) >= gi("D"), true);
check("price bin lt10", cheap.priceBin, "lt10");
ok("reason cites Kalshi evidence", cheap.reasons.some((r) => /60%/.test(r.text)));
ok("maker vs taker note shown", cheap.reasons.some((r) => /Takers lost about 31%/.test(r.text)));
const lng = E.computeSignal({ ...base, ticker: "KXMLBGAME-TEST-LS", yes_bid_dollars: "0.1400", yes_ask_dollars: "0.1500", no_bid_dollars: "0.8500", no_ask_dollars: "0.8600" }, { asOf, now });
ok("10–20¢ YES capped at C", gi(lng.grade) >= gi("C"));
ok("cheap scores below coin flip", cheap.score < s0.score && lng.score < s0.score);

console.log("\nEdge only with a real model input");
const withModel = E.computeSignal(base, { asOf, now, models: { [base.ticker]: { prob: 0.64, source: "DraftKings no-vig (conservative)", asOf } } });
check("edge status", withModel.edge.status, "edge");
ok("netYes = model − fee-adjusted yes", near(withModel.edge.netYes, 0.64 - s0.implied.feeAdjustedYes));
check("side yes", withModel.edge.side, "yes");
ok("+edge ≥2¢ can reach A", withModel.grade === "A");
const badModel = E.computeSignal(base, { asOf, now, models: { [base.ticker]: { prob: 0.55, source: "ref", asOf } } });
ok("edge negative after costs → capped at C", badModel.edge.status === "edge" && badModel.edge.netPerContract < 0 && gi(badModel.grade) >= gi("C"));
const oldModel = E.computeSignal(base, { asOf, now, models: { [base.ticker]: { prob: 0.7, source: "ref", asOf: "2026-10-06T00:00:00Z" } } });
check("stale model input → no edge read", oldModel.edge.status, "no edge read");
const noSide = E.computeSignal(base, { asOf, now, models: { [base.ticker]: { prob: 0.3, source: "ref", asOf } } });
check("model favouring NO grades the NO side", [noSide.edge.side, noSide.gradedSide], ["no", "no"]);

console.log("\nCaps: stale / last-trade / closed");
const stale = E.computeSignal(base, { asOf, now: Date.parse(asOf) + 120_000 });
ok("stale fetch → D or worse", gi(stale.grade) >= gi("D") && stale.freshness.staleReason === "fetch_age");
const lastOnly = E.computeSignal({ ...base, ticker: "X-LT", yes_bid_dollars: "0", yes_ask_dollars: "0", no_ask_dollars: "0", no_bid_dollars: "0" }, { asOf, now });
ok("last trade only → D or worse, liquidity none", gi(lastOnly.grade) >= gi("D") && lastOnly.freshness.priceBasis === "last_trade" && lastOnly.liquidity.score <= 20);
const closed = E.computeSignal({ ...base, ticker: "X-CL", status: "closed" }, { asOf, now });
check("closed → F", closed.grade, "F");
check("nothing real → null", E.computeSignal({ ticker: "X-NONE" }, { asOf, now }), null);
const far = E.computeSignal({ ...base, ticker: "X-FAR", expected_expiration_time: "2026-11-30T00:00:00Z", close_time: "2026-11-30T00:00:00Z" }, { asOf, now });
ok("long horizon grades slightly down", far.score === s0.score - 5);

console.log("\nNFL boost is moderate");
const nfl = E.computeSignal({ ...base, ticker: "KXNFLGAME-TEST-MIN", event_ticker: "KXNFLGAME-TEST", _series: "KXNFLGAME" }, { asOf, now });
check("NFL score = non-NFL + 3", nfl.score - s0.score, 3);
check("NFL never passes the no-model cap", nfl.grade, "B");
const nflCheap = E.computeSignal({ ...cheap, ...{ ticker: "KXNFLGAME-TEST-CH", event_ticker: "KXNFLGAME-TEST", _series: "KXNFLGAME" }, yes_bid_dollars: "0.0600", yes_ask_dollars: "0.0700", no_ask_dollars: "0.9400", no_bid_dollars: "0.9300", yes_bid_size_fp: "800", yes_ask_size_fp: "900", volume_24h_fp: "5000", close_time: base.close_time, expected_expiration_time: base.expected_expiration_time, status: "active" }, { asOf, now });
ok("NFL longshot still capped at D", gi(nflCheap.grade) >= gi("D"));

console.log("\nMove since open + velocity (real candles only)");
const t0 = Date.parse("2026-10-05T22:00:00Z") / 1000;
const candles = { candlesticks: [
  { end_period_ts: t0, volume_fp: "0.00", price: {}, yes_ask: { close_dollars: "0.99" } },
  { end_period_ts: t0 + 3600, volume_fp: "33", price: { open_dollars: "0.4200", close_dollars: "0.5000" } },
  { end_period_ts: t0 + 7200, volume_fp: "0", price: {} },
  { end_period_ts: t0 + 10800, volume_fp: "12", price: { open_dollars: "0.5000", close_dollars: "0.5300" } },
] };
const h = E.historyFromCandles(candles);
check("open = first real trade (empty hours skipped)", [h.open.price, h.open.at], [0.42, new Date(t0 * 1000).toISOString()]);
check("points = hours with trades only", h.points.length, 2);
const mv = E.computeSignal(base, { asOf, now, history: { [base.ticker]: h } });
ok("sinceOpen = mid − open", near(mv.move.sinceOpen, 0.55 - 0.42) && mv.move.basis === "candles_open");
ok("velocity is positive ¢/h", mv.move.velocityCentsPerHour > 0);
ok("move is shown, not graded", mv.score === s0.score && mv.reasons.some((r) => /shown, not graded/.test(r.text)));
check("no candles + previous_price 0 → no move", [s0.move.sinceOpen, s0.move.basis], [null, "none"]);
const prev = E.computeSignal({ ...base, previous_price_dollars: "0.5000" }, { asOf, now });
ok("previous-day last trade is a labelled fallback", prev.move.basis === "previous_day" && near(prev.move.sinceOpen, 0.05) && prev.move.velocityCentsPerHour == null);

console.log("\nHall layout");
const hb = E.buildSignalBoard({ raw: [base, cheap && { ...base, ticker: "KXMLBGAME-TEST-CHEAP", yes_bid_dollars: "0.0600", yes_ask_dollars: "0.0700" }, { ...base, ticker: "KXNFLGAME-T-1", _series: "KXNFLGAME" }, ...fixture.markets], asOf }, { now });
const hall = E.hallLayout(hb);
check("jumbotron = #1", hall.jumbotron.id, hb.signals[0].id);
check("rune board = next 5", hall.runeBoard.map((s) => s.id), hb.signals.slice(1, 6).map((s) => s.id));
check("crowd quiet with no real moves", [hall.crowd.energy, hall.crowd.mood], [null, "quiet"]);
const hb2 = E.buildSignalBoard({ raw: [base], asOf }, { now, history: { [base.ticker]: h } });
const crowd2 = E.hallLayout(hb2).crowd;
ok("crowd energy from real velocity", crowd2.energy != null && crowd2.basedOn === 1);
check("empty board", E.hallLayout(E.buildSignalBoard({ raw: [], asOf }, { now })).jumbotron, null);

console.log("\nPaper scorer");
const tk = (i, f, o, extra = {}) => ({
  id: `t${i}`, marketId: `m${i}`, side: f >= 0.5 ? "yes" : "no", forecast: f, forecastSource: "market",
  entryPrice: f >= 0.5 ? f : 1 - f, snapshotAt: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 3600_000).toISOString(),
  closeAt: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 3600_000 + 3 * 3600_000).toISOString(),
  resolvedAt: new Date(Date.parse("2026-09-01T00:00:00Z") + i * 3600_000 + 4 * 3600_000).toISOString(),
  outcome: o, ...extra,
});
const few = E.scorePaper([tk(1, 0.7, 1), tk(2, 0.3, 0)]);
check("below 30 → too few to read", few.overall.read, "too few to read");
ok("verdict says measure first", /too few to read/.test(few.verdict));
const pts = [];
for (let i = 0; i < 40; i++) pts.push(tk(i, i % 2 ? 0.75 : 0.25, i % 4 === 1 || i % 4 === 2 ? 1 : 0, { grade: i < 20 ? "B" : "C" }));
const sc = E.scorePaper(pts);
check("40 scored", sc.overall.n, 40);
const brier = pts.reduce((s, t) => s + (t.forecast - t.outcome) ** 2, 0) / 40;
ok("Brier exact", near(sc.overall.brier, brier));
ok("MAE exact", near(sc.overall.mae, pts.reduce((s, t) => s + Math.abs(t.forecast - t.outcome), 0) / 40));
ok("Murphy REL − RES + UNC = Brier (constant forecasts per bin)", near(sc.overall.murphy.reconstructed, sc.overall.brier) && near(sc.overall.murphy.residual, 0));
ok("uncertainty = base(1 − base)", near(sc.overall.murphy.uncertainty, sc.overall.baseRate * (1 - sc.overall.baseRate)));
ok("hit rate in [0,1]", sc.overall.hitRate >= 0 && sc.overall.hitRate <= 1);
ok("net per contract is after fees (≤ gross)", sc.overall.netPerContract < sc.overall.hitRate - pts.reduce((s, t) => s + t.entryPrice, 0) / 40 + 1e-9);
check("calibration buckets = 10", sc.calibration.length, 10);
ok("calibration buckets show n + too-few", sc.calibration.every((b) => typeof b.n === "number" && (b.n >= 10 ? b.read === "ok" : b.read === "too few to read")));
check("by-grade groups", sc.byGrade.map((g) => [g.key, g.score.read]), [["B", "ok"], ["C", "ok"]]);
const h13 = sc.byTimeToClose.find((x) => x.label === "1–6h");
check("time-to-close bucket (3h) holds all", h13.score.n ?? h13.score.read, 40);
ok("price-bin (FLB) groups exist", sc.byPriceBin.length > 0);
const post = E.scorePaper([...pts, tk(99, 0.9, 1, { snapshotAt: "2026-09-10T00:00:00Z", resolvedAt: "2026-09-09T00:00:00Z" }), tk(98, 0.9, 1, { resolvedAt: null, closeAt: null })]);
check("post-outcome + undated snapshots excluded and counted", [post.excludedPostOutcome, post.overall.n], [2, 40]);

console.log("\nWalk-forward (no look-ahead)");
const wf = E.walkForward([...pts, ...pts.map((t, i) => tk(100 + i, t.forecast, t.outcome))], { folds: 4 });
ok("folds after the first", wf.folds.length === 3);
ok("each fold trains only on earlier resolutions", wf.folds.every((f) => f.trainN < 80 && f.trainN >= 0));
ok("readable folds report raw vs recalibrated Brier", wf.folds.some((f) => f.score.read === "ok" && "brierRecalibrated" in f.score) || wf.folds.every((f) => f.score.read === "too few to read"));
const wfFew = E.walkForward(pts.slice(0, 10));
check("tiny sample → pooled too few", wfFew.pooled.read, "too few to read");

console.log("\nPaper ticket from a signal (no order path)");
const ticket = E.paperTicketFromSignal(withModel);
ok("ticket uses model forecast + real ask", ticket.forecast === 0.64 && ticket.entryPrice === 0.56 && ticket.forecastSource === "model" && ticket.outcome === null);
const mkt = E.paperTicketFromSignal(s0);
check("no model → market forecast", [mkt.forecastSource, mkt.forecast], ["market", 0.55]);

console.log("\nServer: cache + deadline");
check("partial (deadline) cached short", S.feedCacheTtl({ markets: [1], deadlineExceeded: true }), S.FEED_PARTIAL_CACHE_MS);
check("partial (skipped) cached short", S.feedCacheTtl({ markets: [1], skipped: ["KXGDP"] }), S.FEED_PARTIAL_CACHE_MS);
check("full read cached 12s", S.feedCacheTtl({ markets: [1] }), 12_000);
check("empty not cached", S.feedCacheTtl({ markets: [] }), 0);
ok("partial TTL far below full window", S.FEED_PARTIAL_CACHE_MS < 12_000 / 4);
ok("feed deadline ≤ 8.5s < Netlify 10s", S.KALSHI_FEED_DEADLINE_MS <= 8_500 && S.KALSHI_FEED_DEADLINE_MS < S.NETLIFY_SYNC_TIMEOUT_MS);
ok("signal wall ≤ 8.5s", S.SIGNAL_WALL_DEADLINE_MS <= 8_500);
const fake = await S.fetchKalshiFeedRaw(["A", "B"], 5, { gapMs: 0, fetchSeries: async (s) => (s === "A" ? fixture.markets.slice(0, 2) : []) });
check("fetchKalshiFeedRaw returns raw + result", [fake.raw.length, fake.result.source], [2, "kalshi"]);

console.log("\nRead-only: no order path in the signal API");
for (const f of ["signal-engine.ts", "paper-scorer.ts", "signal-evidence.ts", "signals.ts"]) {
  const src = readFileSync(join(here, "../src/lib/predict", f), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
  ok(`${f}: no place/review/cancel/order calls`, !/\b(place|review|cancel)\w*\s*\(|placeOrder|place_option_order|place_equity_order|submitOrder/i.test(src));
  ok(`${f}: no broker imports`, !/from\s+["'][^"']*(robinhood|rh-|execution|broker)/i.test(src));
}

if (process.argv.includes("--live")) {
  console.log("\nLIVE Kalshi public read (no key)");
  const t = Date.now();
  const { result, raw } = await S.fetchKalshiFeedRaw(["KXMLBGAME", "KXNFLGAME", "KXBTCD"], 15, { deadlineMs: 6_700 });
  const b0 = E.buildSignalBoard({ raw, asOf: result.asOf, deadlineExceeded: result.deadlineExceeded, skipped: result.skipped, reason: result.reason });
  const history = {};
  for (const s of b0.signals.slice(0, 3)) {
    const m = raw.find((r) => r.ticker === s.id);
    await new Promise((r) => setTimeout(r, 250));
    const hh = m ? await S.fetchKalshiCandles(m, Date.now()) : null;
    if (hh) history[s.id] = hh;
  }
  const b1 = E.buildSignalBoard({ raw, asOf: result.asOf }, { history });
  const hl = E.hallLayout(b1);
  console.log(`  ${raw.length} raw → ${b1.signals.length} signals in ${Date.now() - t}ms · counts ${JSON.stringify(b1.counts)} · no-edge ${b1.noEdgeCount}`);
  for (const s of [hl.jumbotron, ...hl.runeBoard].filter(Boolean)) {
    console.log(`  ${s.grade} ${String(s.score).padStart(3)} ${s.id} ask ${s.prices.yesAsk} adj ${s.implied.feeAdjustedYes} spr ${s.spread.cents}¢ liq ${s.liquidity.score} move ${s.move.sinceOpen} (${s.move.basis}) vel ${s.move.velocityCentsPerHour} tte ${s.settlement.words} ${s.freshness.word}`);
  }
  console.log(`  crowd: ${JSON.stringify(hl.crowd)}`);
  ok("live: signals are kalshi rows", b1.signals.every((s) => s.source === "kalshi"));
  ok("live: no model → all no edge read", b1.noEdgeCount === b1.signals.length);
  console.log(`  candles read for ${Object.keys(history).length}/3 top markets`);
} else {
  console.log("\n(live fetch skipped — pass --live to hit Kalshi public API)");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
