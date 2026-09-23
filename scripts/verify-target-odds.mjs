/**
 * Target odds — the race, the conditional runner, and the expectancy.
 *
 * The thing being pinned is that the stop is IN the probability. Measured on
 * the committed 15m history, the touch-based number the desk quotes today
 * overstates the tradable one by up to 25 percentage points early in the
 * session, which is precisely the window the trader trades. Expressed as
 * expectancy on an ES 2R target 15% into the session: touch odds imply
 * +0.83R, the actual race gives +0.08R. A tenfold overstatement of what the
 * trade is worth is worth a test.
 *
 * Run: npx tsx scripts/verify-target-odds.mjs
 */
import { readFileSync } from "node:fs";
const { groupSessions } = await import("../src/lib/trading/draw.ts");
const { raceOdds, targetOdds, expectedR, runnerWorthIt, MIN_SESSIONS_FOR_ODDS } = await import(
  "../src/lib/trading/target-odds.ts"
);

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

// A hand-built session where the path is known exactly.
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1 });
const DAY = 86_400_000;
/** Ten bars: drifts up to +10, never down more than −2. */
const up = (day) =>
  Array.from({ length: 10 }, (_, i) => bar(day * DAY + i * 900_000, 100 + i, 100 + i + 1, 100 + i - 2, 100 + i));
/** Ten bars: drifts down to −10, never up more than +2. */
const down = (day) =>
  Array.from({ length: 10 }, (_, i) => bar(day * DAY + i * 900_000, 100 - i, 100 - i + 2, 100 - i - 1, 100 - i));

console.log("\nthe race — a known path resolves the right way");
const allUp = Array.from({ length: 20 }, (_, d) => ({ key: `u${d}`, bars: up(d) }));
// From bar 0 (elapsed 0), price only rises: a +3 target beats a −3 stop.
const r1 = raceOdds(allUp, 0, 3, 3, "long");
check("a rising path reaches a long target first every time", r1.pTargetFirst, 1);
check("and never stops out", r1.pStopFirst, 0);
// The same path is a disaster for a short — the stop is above.
const r2 = raceOdds(allUp, 0, 3, 3, "short");
check("the same path stops a short out every time", r2.pStopFirst, 1);
check("and never reaches the short's target", r2.pTargetFirst, 0);

const allDown = Array.from({ length: 20 }, (_, d) => ({ key: `d${d}`, bars: down(d) }));
check("a falling path pays a short", raceOdds(allDown, 0, 3, 3, "short").pTargetFirst, 1);
check("and punishes a long", raceOdds(allDown, 0, 3, 3, "long").pStopFirst, 1);

// Unreachable in either direction inside the session = the flat outcome.
const flat = raceOdds(allUp, 0, 500, 500, "long");
check("a target nothing reaches is neither", flat.pNeither, 1);
check("and pays nothing", flat.pTargetFirst, 0);

console.log("\nthe stop is genuinely in the probability");
// A path that dips below the stop BEFORE running to the target: touch says
// yes, the race says no. This is the whole point of the file.
const trap = Array.from({ length: 20 }, (_, d) => ({
  key: `t${d}`,
  bars: [
    bar(d * DAY, 100, 100.5, 100, 100),
    bar(d * DAY + 1, 100, 100.5, 94, 95), // stop at -3 prints first
    bar(d * DAY + 2, 95, 110, 95, 109), // target at +3 prints later
    bar(d * DAY + 3, 109, 110, 108, 109),
    bar(d * DAY + 4, 109, 110, 108, 109),
    bar(d * DAY + 5, 109, 110, 108, 109),
    bar(d * DAY + 6, 109, 110, 108, 109),
  ],
}));
const t = raceOdds(trap, 0, 3, 3, "long");
check("touch says the target was reached", t.pTouchIgnoringStop, 1);
check("the race says the stop got there first", t.pTargetFirst, 0);
check("overstatement is the full 100 points", Math.round(t.overstatementPts), 100);

// A bar containing BOTH levels must resolve against the trade.
const tie = Array.from({ length: 20 }, (_, d) => ({
  key: `x${d}`,
  bars: [
    bar(d * DAY, 100, 100.2, 99.8, 100),
    bar(d * DAY + 1, 100, 110, 90, 105),
    bar(d * DAY + 2, 105, 106, 104, 105),
    bar(d * DAY + 3, 105, 106, 104, 105),
    bar(d * DAY + 4, 105, 106, 104, 105),
    bar(d * DAY + 5, 105, 106, 104, 105),
  ],
}));
check("an intrabar tie resolves against the trade", raceOdds(tie, 0, 3, 3, "long").pStopFirst, 1);

console.log("\nreliability is never hidden");
const few = raceOdds(allUp.slice(0, 4), 0, 3, 3, "long");
ok("four sessions is not reliable", !few.reliable);
ok("and the note says it is below the floor", few.note.includes(String(MIN_SESSIONS_FOR_ODDS)));
ok("twenty sessions is reliable", raceOdds(allUp, 0, 3, 3, "long").reliable);
check("zero distance yields nothing", raceOdds(allUp, 0, 0, 3, "long").pTargetFirst, null);
check("no sessions yields nothing", raceOdds([], 0, 3, 3, "long").pTargetFirst, null);

console.log("\nT2 is a SECOND race, from T1, against breakeven");
const odds = targetOdds(allUp, 0, { side: "long", entry: 100, stop: 97, t1: 103, t2: 107 });
ok("T1 gets odds", odds.t1?.pTargetFirst != null);
ok("T2 gets its own odds — it used to have none at all", odds.t2GivenT1?.pTargetFirst != null);
const noT2 = targetOdds(allUp, 0, { side: "long", entry: 100, stop: 97, t1: 103, t2: null });
check("no T2 means no second race", noT2.t2GivenT1, null);
const noT1 = targetOdds(allUp, 0, { side: "long", entry: 100, stop: 97, t1: null, t2: null });
check("no T1 means no odds at all", noT1.t1, null);

console.log("\nexpectancy — odds multiplied by reward, at last");
// The ES case from the measurement: 36% to reach a 2R target before the stop.
const es = { t1: { pTargetFirst: 0.36, n: 44, reliable: true }, t2GivenT1: null, n: 44 };
const e = expectedR(es, 2, null);
// All-out: 0.36*2 + 0.64*(-1) = +0.08
check("all-out at a 2R target on 36% odds is +0.08R", e.expRAllOutT1, 0.08);
ok("and the scale rule is priced too", e.expR != null);

// The same target priced on TOUCH odds (61%) — the overstatement, in R.
const touch = expectedR({ t1: { pTargetFirst: 0.61, n: 44, reliable: true }, t2GivenT1: null, n: 44 }, 2, null);
check("touch odds imply +0.83R for the same trade", touch.expRAllOutT1, 0.83);
ok("which is over ten times the real figure", touch.expRAllOutT1 / e.expRAllOutT1 > 10);

// Negative expectancy must be called that, loudly.
const bad = expectedR({ t1: { pTargetFirst: 0.2, n: 44, reliable: true }, t2GivenT1: null, n: 44 }, 1.5, null);
ok("a 20%/1.5R target is negative expectancy", bad.negative);
ok("and says so in those words", /NEGATIVE EXPECTANCY/.test(bad.line));

// The runner must add value when T2 odds are real.
const withRunner = expectedR(
  { t1: { pTargetFirst: 0.5, n: 44, reliable: true }, t2GivenT1: { pTargetFirst: 0.5, n: 44, reliable: true }, n: 44 },
  2,
  6,
);
ok("a rich runner beats all-out at T1", withRunner.expR > withRunner.expRAllOutT1);
// p2 x rr2 == rr1 is the exact indifference point, and it must tie.
const tied = expectedR(
  { t1: { pTargetFirst: 0.5, n: 44, reliable: true }, t2GivenT1: { pTargetFirst: 0.5, n: 44, reliable: true }, n: 44 },
  2,
  4,
);
check("at p2 x rr2 == rr1 the two structures tie exactly", tied.expR, tied.expRAllOutT1);

console.log("\nwhen the runner is worth keeping");
check("50% at 6R beats giving up 2R", runnerWorthIt(0.5, 2, 6).worth, true);
check("50% at 4R exactly ties", runnerWorthIt(0.5, 2, 4).edge, 0);
check("50% at 3R does not", runnerWorthIt(0.5, 2, 3).worth, false);
ok("and it says to take it all at T1 on that trade", /Take it all at T1/.test(runnerWorthIt(0.5, 2, 3).line));
ok("and admits the rule is still right on average", /average does not apply/.test(runnerWorthIt(0.5, 2, 3).line));
check("missing inputs refuse", runnerWorthIt(null, 2, 4).worth, null);

// Missing inputs must refuse rather than guess.
const none = expectedR({ t1: null, t2GivenT1: null, n: 0 }, null, null);
check("no odds means no expectancy", none.expR, null);
ok("and it refuses rather than substituting a feeling", /do not substitute a feeling/i.test(none.line));

// Unreliable samples must be labelled inside the line itself.
const thin = expectedR({ t1: { pTargetFirst: 0.6, n: 5, reliable: false }, t2GivenT1: null, n: 5 }, 2, null);
ok("a thin sample is flagged in the sentence", /shape rather than a number/.test(thin.line));

console.log("\nagainst the real committed bars");
const hist = JSON.parse(readFileSync("src/data/learn-history.json", "utf8"));
for (const sym of Object.keys(hist.bars)) {
  const sessions = groupSessions(hist.bars[sym]);
  const ranges = sessions
    .filter((s) => s.bars.length >= 6)
    .map((s) => Math.max(...s.bars.map((b) => b.h)) - Math.min(...s.bars.map((b) => b.l)))
    .sort((a, b) => a - b);
  const stop = (ranges[Math.floor(ranges.length / 2)] ?? 0) * 0.2;
  const early = raceOdds(sessions, 0.15, stop * 2, stop, "long");
  ok(`${sym}: a 2R target early in the session is under 45% to pay`, early.pTargetFirst < 0.45);
  ok(`${sym}: and touch odds overstate it`, early.overstatementPts > 0);
  ok(`${sym}: sample is reliable`, early.reliable);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
