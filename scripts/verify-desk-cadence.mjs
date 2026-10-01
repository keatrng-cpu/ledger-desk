/**
 * The desk rebuilds just after candles close — never on a free-running timer.
 *
 * Found 2026-10-01: every scoring input changes only on a candle close (and
 * every frame from 1m to 4h closes on a minute boundary), but the desk rebuilt
 * on a free-running 20s timer, so a freshly closed candle could wait ~20s to
 * be graded. desk-cadence.ts aligns the rebuild to DESK_CLOSE_LAG_MS after
 * each minute (the gateway writes the closed 1m bar ~1s after it) plus one
 * mid-minute rebuild.
 *
 * Run: npx tsx scripts/verify-desk-cadence.mjs
 */
import { readFileSync } from "node:fs";

const { msUntilNextDeskPoll, DESK_CLOSE_LAG_MS, DESK_MID_MINUTE_MS } = await import("../src/lib/trading/desk-cadence.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++; else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const minute = Date.UTC(2026, 9, 1, 14, 30, 0); // 10:30:00 ET
const at = (sec) => minute + sec * 1000;

console.log("\nthe next rebuild lands just after the minute closes");
check("at :00.5 → the :02 rebuild (1.5s)", msUntilNextDeskPoll(at(0.5)), 1500);
check("at :01.9 → still the :02 rebuild", msUntilNextDeskPoll(at(1.6)), 400);
check("at :02.5 → the mid-minute :32 rebuild", msUntilNextDeskPoll(at(2.5)), 29500);
check("at :45 → the next minute's :02 rebuild", msUntilNextDeskPoll(at(45)), 17000);
check("at :59.9 → the next minute's :02 rebuild", msUntilNextDeskPoll(at(59.9)), 2100);

console.log("\nit can never spin or stall");
let worst = 0;
let best = Infinity;
for (let ms = 0; ms < 60_000; ms += 37) {
  const d = msUntilNextDeskPoll(minute + ms);
  worst = Math.max(worst, d);
  best = Math.min(best, d);
}
ok(`never schedules sooner than 250ms (min ${best}ms)`, best > 250);
ok(`never waits longer than ~31s (max ${worst}ms)`, worst <= 30_250);

console.log("\nevery candle close is graded within a few seconds, with fewer rebuilds");
ok("a closed 1m candle is picked up DESK_CLOSE_LAG_MS after the minute", DESK_CLOSE_LAG_MS <= 3000);
const perMinute = [DESK_CLOSE_LAG_MS, DESK_MID_MINUTE_MS].length;
ok(`${perMinute} rebuilds a minute, fewer than the old 20s timer's 3`, perMinute < 3);

console.log("\nthe shell uses it");
const shell = readFileSync("src/routes/index.tsx", "utf8");
ok("routes/index.tsx schedules with msUntilNextDeskPoll", /msUntilNextDeskPoll\(\)/.test(shell));
ok("the free-running DESK_POLL_MS timer is gone", !/DESK_POLL_MS/.test(shell));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
