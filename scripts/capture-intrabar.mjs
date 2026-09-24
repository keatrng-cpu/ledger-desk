/**
 * Capture 1m history for the same window the 15m replay tape covers.
 *
 *   npx tsx scripts/capture-intrabar.mjs
 *
 * WHY THIS IS NEEDED
 * `src/data/learn-history.json` holds 4,124 bars at 15m over 63 days and no
 * 1m at all — the capture pulls `ohlcv-1m` from Databento and throws the
 * minutes away after aggregating. So the question "would the sequence have
 * printed TAKE intrabar, where the closed bar refused?" cannot be answered
 * from anything the repo currently stores, however much 1m the live desk
 * carries (about eight hours).
 *
 * That correction matters: it was briefly claimed in-session that the
 * counterfactual was answerable from existing data. It is not. This is the
 * step that makes it so.
 *
 * COST
 * Databento live CME is a flat $199/mo (verified 2026-09-14, restated in
 * README), and historical is drawn against the same subscription. Pulling 63
 * days of 1m for two contracts is roughly 180k bars — a real request, but not
 * a metered one. It is a separate script rather than part of the desk poll
 * precisely so it is run deliberately.
 *
 * WHAT IT DOES NOT DO
 * It does not grade anything. It captures a tape and stops.
 * `measure-intrabar-take.mjs` is what reads it, and the decision rule those
 * numbers feed was fixed in `take-census.ts` before either script existed.
 */

import { readFileSync, writeFileSync } from "node:fs";

const { fetchDatabentoAbsoluteRange } = await import(
  "../src/lib/market/databento.ts"
);

const OUT = "src/data/intrabar-history.json";
const HIST = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));

const startMs = Date.parse(`${HIST.window.start}Z`);
const endMs = Date.parse(`${HIST.window.end}Z`);

if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
  console.error(`cannot parse window from learn-history.json: ${JSON.stringify(HIST.window)}`);
  process.exit(1);
}

const days = ((endMs - startMs) / 86_400_000).toFixed(1);
console.log(
  `window ${HIST.window.start} → ${HIST.window.end} (${days} days), contracts ${JSON.stringify(HIST.contracts)}`,
);
console.log("pulling 1m — this is a large historical request, one per symbol\n");

const bars = {};
let failed = false;

for (const sym of ["MNQ", "ES"]) {
  process.stdout.write(`  ${sym.padEnd(4)} `);
  const series = await fetchDatabentoAbsoluteRange(sym, startMs, endMs, 1);
  if (!series || !series.bars?.length) {
    // An empty pull is NOT written as an empty array: a zero-bar file that
    // parses is exactly the stub shape the repo guards were written for, and
    // the measurement would then report "no intrabar takes" from no data.
    console.log("FAILED — no bars returned (is DATABENTO_API_KEY set?)");
    failed = true;
    continue;
  }
  bars[sym] = series.bars;
  const spacing =
    series.bars.length > 1
      ? (series.bars[1].t - series.bars[0].t) / 60_000
      : null;
  console.log(
    `${series.bars.length.toLocaleString()} bars · ${spacing}m spacing · ${new Date(series.bars[0].t).toISOString().slice(0, 10)} → ${new Date(series.bars[series.bars.length - 1].t).toISOString().slice(0, 10)}`,
  );
}

if (failed || Object.keys(bars).length < 2) {
  console.error("\nincomplete capture — nothing written.");
  console.error("A half-captured tape would measure one book and read as both.");
  process.exit(1);
}

const out = {
  capturedAt: new Date().toISOString(),
  interval: "1m",
  source: "databento",
  dataset: HIST.dataset,
  contracts: HIST.contracts,
  window: HIST.window,
  note:
    "Real 1m bars over the same window as learn-history.json's 15m tape. " +
    "Captured to answer whether the sequence would print TAKE intrabar where " +
    "the closed 15m bar refused. Not live. Do not use for trading.",
  bars,
};

writeFileSync(OUT, JSON.stringify(out));
const mb = (JSON.stringify(out).length / 1e6).toFixed(1);
console.log(`\nwrote ${OUT} (${mb} MB)`);
console.log("next: npx tsx scripts/measure-intrabar-take.mjs");
