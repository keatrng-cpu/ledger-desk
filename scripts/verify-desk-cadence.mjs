/**
 * The desk rebuilds just after candles close — never on a free-running timer.
 *
 * Found 2026-10-01: every scoring input changes only on a candle close (and
 * every frame from 1m to 4h closes on a minute boundary), but the desk rebuilt
 * on a free-running 20s timer, so a freshly closed candle could wait ~20s to
 * be graded. The close is still graded DESK_CLOSE_LAG_MS after the minute.
 * Between closes the board rebuilds every DESK_POLL_GAP_MS so a new score
 * is not held for the rest of the minute.
 *
 * Run: npx tsx scripts/verify-desk-cadence.mjs
 */
import { readFileSync } from "node:fs";

const { msUntilNextDeskPoll, DESK_CLOSE_LAG_MS, DESK_POLL_GAP_MS } = await import("../src/lib/trading/desk-cadence.ts");

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
check("at :02.5 → the next gap, not the rest of the minute", msUntilNextDeskPoll(at(2.5)), DESK_POLL_GAP_MS);
check("at :45 → the next gap", msUntilNextDeskPoll(at(45)), DESK_POLL_GAP_MS);
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
ok(`never waits longer than one gap (max ${worst}ms)`, worst <= DESK_POLL_GAP_MS + 50);

console.log("\na new score is graded on the close and again within one gap");
ok("a closed 1m candle is picked up DESK_CLOSE_LAG_MS after the minute", DESK_CLOSE_LAG_MS <= 3000);
ok("the gap is a few seconds, not half a minute", DESK_POLL_GAP_MS <= 5_000);

console.log("\nthe shell uses it");
const shell = readFileSync("src/routes/index.tsx", "utf8");
ok("routes/index.tsx schedules with msUntilNextDeskPoll", /msUntilNextDeskPoll\(\)/.test(shell));
ok("the free-running DESK_POLL_MS timer is gone", !/DESK_POLL_MS/.test(shell));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
