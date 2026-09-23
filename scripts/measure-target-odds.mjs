/**
 * How much does the desk's target probability overstate the tradable one?
 *
 * `draw.ts` answers "did price EVER travel this far from here" — maximum
 * favourable excursion. A trade asks "did it get there BEFORE my stop". This
 * measures the gap between those two numbers on the committed 15m history,
 * across the R-multiples the desk actually trades, so the size of the
 * overstatement is a fact rather than an argument.
 *
 * Deterministic: same committed bars in, same table out.
 *
 * Run: npx tsx scripts/measure-target-odds.mjs
 */
import { readFileSync } from "node:fs";

const { groupSessions } = await import("../src/lib/trading/draw.ts");
const { raceOdds } = await import("../src/lib/trading/target-odds.ts");

const hist = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
const symbols = Object.keys(hist.bars);

// Entry points through the session, and target distances in multiples of the
// stop — i.e. the R the plan would be quoting.
const ELAPSED = [0.15, 0.35, 0.55, 0.75];
const R_MULTIPLES = [1, 1.5, 2, 3];

console.log(`bars from ${hist.capturedAt ?? "committed history"} · ${symbols.join(", ")}\n`);

for (const sym of symbols) {
  const bars = hist.bars[sym];
  const sessions = groupSessions(bars);
  // Stop distance: a typical plan risk. Use a fraction of the median session
  // range so the test is on the desk's own scale rather than an invented one.
  const ranges = sessions
    .filter((s) => s.bars.length >= 6)
    .map((s) => Math.max(...s.bars.map((b) => b.h)) - Math.min(...s.bars.map((b) => b.l)))
    .sort((a, b) => a - b);
  const medianRange = ranges[Math.floor(ranges.length / 2)] ?? 0;
  const stopPts = medianRange * 0.2;

  console.log(`${sym} — ${sessions.length} sessions, median range ${medianRange.toFixed(1)}pts, stop ${stopPts.toFixed(1)}pts`);
  console.log(`  elapsed   R    touch%   first%   overstates by   stop-first%   n`);

  for (const elapsed of ELAPSED) {
    for (const r of R_MULTIPLES) {
      const res = raceOdds(sessions, elapsed, stopPts * r, stopPts, "long");
      if (res.pTargetFirst == null) continue;
      console.log(
        `  ${(elapsed * 100).toFixed(0).padStart(5)}%  ${String(r).padStart(4)}` +
          `  ${(res.pTouchIgnoringStop * 100).toFixed(0).padStart(6)}%` +
          `  ${(res.pTargetFirst * 100).toFixed(0).padStart(6)}%` +
          `  ${res.overstatementPts.toFixed(0).padStart(11)}pts` +
          `  ${(res.pStopFirst * 100).toFixed(0).padStart(10)}%` +
          `  ${String(res.n).padStart(3)}`,
      );
    }
  }
  console.log("");
}

console.log(
  [
    "READ: 'touch%' is what draw.ts reports today and what reachTier buckets.",
    "'first%' is what a trade actually gets, because the stop is in the race.",
    "The gap is the overstatement, and it is in the direction that costs money:",
    "a target labelled CLEAN on touch odds can be a coin flip once the stop is counted.",
  ].join("\n"),
);
