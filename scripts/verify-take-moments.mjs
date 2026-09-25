/**
 * The hesitation ledger's arithmetic — pinned.
 *
 * resolveMoment must be the rule as coded (limit at the entry, ties against,
 * the fill bar can stop out but never score T1, 50% at T1 then BE), and it
 * must never resolve a plan on bars from BEFORE the moment.
 *
 * Run: npx tsx scripts/verify-take-moments.mjs
 */

const { resolveMoment, summarizeMoments, momentFor } = await import("../src/lib/trading/take-moments.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const T0 = Date.UTC(2026, 8, 25, 14, 0); // 10:00 ET
const M = 60_000;
const bar = (min, o, h, l, c) => ({ t: T0 + min * M, o, h, l, c, v: 1 });
// A short: entry 100, stop 102, T1 96 (2R), T2 92 (4R).
const short = { key: "k", kind: "TAKE", at: T0, day: "d", symbol: "MNQ", side: "short", band: "A", entry: 100, stop: 102, t1: 96, t2: 92 };

console.log("the plan resolves on bars AFTER the moment only");
{
  const before = [bar(-5, 99, 101, 95, 96)];
  check("a T1 print before the moment is not a result", resolveMoment(short, before, T0 + 10 * M), null);
}

console.log("\nthe rule as coded");
{
  const stopped = [bar(1, 99, 100.5, 98, 99.5), bar(2, 99.5, 102.5, 99, 102)];
  check("fill then the stop → -1R", resolveMoment(short, stopped, T0 + 3 * M), { outcome: "stop", r: -1 });

  const tie = [bar(1, 99, 100.5, 98, 99.5), bar(2, 99, 102.5, 95, 97)];
  check("stop and T1 on one bar → the stop (ties against)", resolveMoment(short, tie, T0 + 3 * M), { outcome: "stop", r: -1 });

  const fillBarT1 = [bar(1, 98, 100.2, 95, 96), bar(2, 96, 99, 95, 98)];
  check("the fill bar can never score T1", resolveMoment(short, fillBarT1, T0 + 3 * M), null);

  const scaleBe = [bar(1, 99, 100.2, 99, 99.5), bar(2, 99, 99.5, 95.5, 96), bar(3, 96, 100.5, 96, 100.2)];
  check("T1 then runner stopped at BE → +1R (half of 2R)", resolveMoment(short, scaleBe, T0 + 4 * M), { outcome: "be", r: 1 });

  const t2 = [bar(1, 99, 100.2, 99, 99.5), bar(2, 99, 99.5, 95.5, 96), bar(3, 96, 96.5, 91, 92)];
  check("T1 then T2 → 1R + 2R = +3R", resolveMoment(short, t2, T0 + 4 * M), { outcome: "t2", r: 3 });

  const never = [bar(1, 98, 99, 97, 98), bar(2, 98, 99.5, 96, 97)];
  check("no touch inside 3h and still early → unresolved", resolveMoment(short, never, T0 + 60 * M), null);
  check("no touch and 3h gone → unfilled, 0R", resolveMoment(short, never, T0 + 200 * M), { outcome: "unfilled", r: 0 });
}

console.log("\nthe summary");
{
  const rows = [
    { ...short, key: "a", action: "rested", latencySec: 40, outcome: "t1", r: 2 },
    { ...short, key: "b", outcome: "stop", r: -1 },
    { ...short, key: "c", outcome: "unfilled", r: 0 },
    { ...short, key: "d", action: "logged_live", latencySec: 300 },
  ];
  const s = summarizeMoments(rows);
  check("four moments", s.moments, 4);
  check("two acted on", s.acted, 2);
  check("median latency picks the middle", s.medianLatencySec, 300);
  check("skipped = resolved with no action", s.skipped.n, 2);
  check("of which one would have filled", s.skipped.filled, 1);
  check("and their R", s.skipped.sumR, -1);
  check("small samples say so", /too few/.test(s.line), true);
  check("an empty ledger says what it will do", /logged the instant it prints/.test(summarizeMoments([]).line), true);
}

console.log("\nwhat counts as a moment");
{
  const plan = { entry: 100, stop: 102, t1: 96, t2: 92, entryZone: { top: 101, bottom: 99 } };
  const pass = (id) => ({ id, must: true, state: "pass" });
  const take = { symbol: "MNQ", side: "short", word: "TAKE", pathBand: "A", plan, layers: [pass("dol")] };
  check("a TAKE on a PATH band is a moment", momentFor(take, 150), "TAKE");
  check("a TAKE on B+ is not", momentFor({ ...take, pathBand: "B+" }, 150), null);
  check("no plan, no moment", momentFor({ ...take, plan: null }, 100), null);
  const wait = { ...take, word: "WAIT", layers: [pass("dol"), { id: "retrace", must: true, state: "wait" }] };
  check("a watchable WAIT in the zone is a TOUCH", momentFor(wait, 100), "TOUCH");
  check("the same WAIT away from the zone is nothing", momentFor(wait, 150), null);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
