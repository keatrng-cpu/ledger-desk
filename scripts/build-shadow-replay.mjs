/**
 * Seed the shadow book from history: every PATH-grade card the live desk's
 * sequence REFUSED over the captured tape, paper-traded both ways (the
 * desk's own resting limit, and a chase at the close) and resolved on the
 * bars that followed — causally, closed bars only, ties against the trade.
 *
 * WHY
 * The live shadow book starts at n=0 on the day it ships. The discretion
 * memory needs a sample before it can say anything about a gate, and two
 * months of real refusals is the honest place to get one. Rows are tagged
 * source="replay" and shown as such; the live book accumulates beside them.
 *
 * Same assembly as build-learn-cases.mjs / diagnose-path.mjs: the live
 * engine over src/data/learn-history.json under the LIVE gate values
 * (gate-tuning.ts GATE — whatever is committed), at every 15m close inside
 * the NY AM window. Output: src/data/shadow-replay.json.
 *
 * Run: npx tsx scripts/build-shadow-replay.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";

const history = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const { GATE } = await import("../src/lib/trading/gate-tuning.ts");
const { getSessionClock } = await import("../src/lib/trading/sessions.ts");
const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { scanSetups } = await import("../src/lib/trading/scanner.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");
const { openShadows, tickShadow, analyzeShadow, isTerminal } = await import("../src/lib/trading/shadow-book.ts");
const { buildTfLadder } = await import("../src/lib/trading/tf-ladder.ts");
const { buildScorecard, discretionDigest } = await import("../src/lib/trading/discretion-memory.ts");

const BAR_MS = 15 * 60_000;
const WARMUP = 160;

function dayChangePct(slice) {
  const last = slice[slice.length - 1];
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
  const key = f.format(new Date(last.t));
  for (const b of slice) if (f.format(new Date(b.t)) === key) return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  return 0;
}

/** The desk at one historical close, in the shape shadow-book.ts reads. */
function deskAt(symbol, peer, slice, peerSlice) {
  const now = slice[slice.length - 1];
  const clock = getSessionClock(new Date(now.t + BAR_MS - 1));
  const biasL = analyzeStructure(symbol, slice, dayChangePct(slice));
  const biasR = analyzeStructure(peer, peerSlice, dayChangePct(peerSlice));
  const smtStack = smtDivergenceStack(slice, peerSlice);
  const smc = { left: buildSmcTape(slice), right: buildSmcTape(peerSlice) };
  const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peerSlice, smc);
  const detL = summarizeDetectors(slice);
  const detR = summarizeDetectors(peerSlice);
  const narrL = buildMarketNarrative(biasL, detL, clock, biasL.topDown === "bear" ? "bear" : "bull", slice);
  const narrR = buildMarketNarrative(biasR, detR, clock, biasR.topDown === "bear" ? "bear" : "bull", peerSlice);
  const draws = { left: drawOnLiquidity(biasL, slice), right: drawOnLiquidity(biasR, peerSlice) };
  const news = newsRead(new Date(now.t));
  const quotes = { left: { price: now.c }, right: { price: peerSlice[peerSlice.length - 1].c } };
  const smcMaster = gradeSmcMaster({
    clock, bias: { left: biasL, right: biasR }, scan, draws,
    narrative: { left: narrL, right: narrR }, news, smtStack, smc, quotes, shockFloorMs: null,
    left: { bars: slice }, right: { bars: peerSlice },
  });
  // The ladder's rungs are stamped onto every shadow's tags (shadowTags ->
  // ladderTags), which is how "did alignment matter" becomes answerable at
  // all. The seed built before 2026-09-22 has them all as n/a; rebuilding
  // fills them in. Daily bars are resampled from the 15m history — coarser
  // than the live desk's 2y daily feed, so the 1w/1M/1y rungs read from
  // fewer periods here and say so via their own `bars` count.
  const ladder = {
    left: buildTfLadder({ symbol, daily: [], m15: slice, m1: [], nowMs: now.t, engineTopDown: biasL.topDown }),
    right: buildTfLadder({ symbol: peer, daily: [], m15: peerSlice, m1: [], nowMs: now.t, engineTopDown: biasR.topDown }),
  };
  return {
    clock, bias: { left: biasL, right: biasR }, scan, smcMaster,
    narrative: { left: narrL, right: narrR }, draws, news, smtStack, ladder,
    left: { symbol, bars: slice }, right: { symbol: peer, bars: peerSlice }, quotes,
  };
}

const all = new Map();
const t0 = Date.now();
console.log(`gate: ${JSON.stringify(GATE)}`);
for (const [symbol, peer] of [["MNQ", "ES"], ["ES", "MNQ"]]) {
  const bars = history.bars[symbol];
  const peerBars = history.bars[peer];
  let peerIdx = 0;
  let opened = 0;
  const open = new Map();
  for (let i = WARMUP; i < bars.length - 1; i++) {
    const now = bars[i];
    while (peerIdx < peerBars.length && peerBars[peerIdx].t <= now.t) peerIdx++;
    const peerSlice = peerBars.slice(0, peerIdx);
    if (peerSlice.length < WARMUP) continue;
    const closeT = now.t + BAR_MS;
    // Tick what is open first (this bar just closed).
    for (const [id, s] of open) {
      let next = tickShadow(s, bars.slice(0, i + 1), null, closeT);
      if (isTerminal(next)) {
        next = { ...next, analysis: analyzeShadow(next) };
        open.delete(id);
      }
      all.set(id, next);
      if (!isTerminal(next)) open.set(id, next);
    }
    const clock = getSessionClock(new Date(now.t + BAR_MS - 1));
    if (!clock.isWeekday || !(clock.inTradeWindow || clock.killzone === "ny_am")) continue;
    const desk = deskAt(symbol, peer, bars.slice(0, i + 1), peerSlice);
    // Only this symbol's book opens here; the peer's is opened in its own pass.
    desk.smcMaster = { ...desk.smcMaster, right: { ...desk.smcMaster.right, plan: null } };
    for (const s of openShadows(desk, all, now.t + BAR_MS - 1, "replay")) {
      all.set(s.id, s);
      open.set(s.id, s);
      opened++;
    }
  }
  // Whatever is still open at the end of the tape closes at the last bar.
  for (const [id, s] of open) {
    let next = tickShadow(s, bars, null, bars[bars.length - 1].t + BAR_MS + 24 * 3600_000);
    if (isTerminal(next)) next = { ...next, analysis: analyzeShadow(next) };
    all.set(id, next);
  }
  console.log(`${symbol}: ${opened} shadows opened (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
}

const rows = [...all.values()].sort((a, b) => a.openedAt - b.openedAt);
writeFileSync("src/data/shadow-replay.json", JSON.stringify(rows));
const card = buildScorecard(rows);
console.log(`\nwrote src/data/shadow-replay.json — ${rows.length} rows (${(JSON.stringify(rows).length / 1024).toFixed(0)} KB)`);
console.log(discretionDigest(rows, 8));
console.log("\nby reason:");
for (const r of card.byReason) console.log("  " + r.line);
