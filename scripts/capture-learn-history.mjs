/**
 * Capture real bars for the Learn tab's walkthroughs.
 *
 * WHY A COMMITTED SNAPSHOT
 * The walkthroughs teach from real tape: the desk's own engine run causally
 * over real history, with real entries and real losses. That only works as a
 * lesson if the tape is the SAME every time it is opened — a case that moves
 * because yesterday's bars arrived is not a case, it is a feed. So the bars
 * are captured once into src/data and committed, and the case builder runs
 * over the file rather than the network. Re-run this deliberately when the
 * curriculum should advance to newer tape; never on a schedule.
 *
 * Yahoo serves 15m history for roughly the trailing 60 days. That is the
 * structure interval the desk trades on, so it is the interval taught here.
 *
 * Named-month captures (August 2026 ESU6/NQU6) go through Databento:
 *   python3 scripts/build-learn-figures.py  # after history is written
 * The August 2026 file in src/data/learn-history.json was pulled as
 * GLBX.MDP3 ohlcv-1m → 15m, contracts ESU6/NQU6 (front quarterly for Aug).
 *
 * Run: npx tsx scripts/capture-learn-history.mjs
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

// Raw chart + parser rather than fetchYahooBars: the desk caps a live series
// at MAX_BARS (800 ≈ 9 trading days) because it only needs recent structure.
// A teaching snapshot wants the whole month Yahoo will serve at 15m.
const { yahooChart, parseYahooChart, YAHOO_MAP } = await import("../src/lib/market/yahoo.ts");

const OUT = "src/data/learn-history.json";
const SYMBOLS = ["MNQ", "ES"];

const out = {
  capturedAt: new Date().toISOString(),
  interval: "15m",
  source: "yahoo",
  note:
    "Real 15m bars, captured once for deterministic teaching cases. Not live. Do not use for trading.",
  bars: {},
};

for (const sym of SYMBOLS) {
  // Yahoo refuses 15m beyond ~60 days; "1mo" is the longest it honours.
  const json = await yahooChart(YAHOO_MAP[sym].yahoo, "1mo", "15m");
  const bars = json ? parseYahooChart(json) : [];
  if (bars.length < 100) {
    console.error(`no usable bars for ${sym} (${bars.length})`);
    process.exit(1);
  }
  // Only what the engine reads. Volume is kept because the detectors may use it.
  out.bars[sym] = bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v ?? 0 }));
  const first = new Date(bars[0].t).toISOString().slice(0, 10);
  const last = new Date(bars[bars.length - 1].t).toISOString().slice(0, 10);
  console.log(`${sym}: ${bars.length} bars, ${first} → ${last}`);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(out), "utf8");
console.log(`wrote ${OUT}`);
