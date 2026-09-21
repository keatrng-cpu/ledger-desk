/**
 * Shadow-book resolver, checked against hand-built tape.
 *
 * The shadow book is evidence about the gates; if its fills or exits were
 * wrong the evidence would be wrong in a way nobody would notice for weeks.
 * These cases pin the mechanics: limit fill inside the window, unfilled past
 * it, chase fill at the print, T1 scale-out + break-even, T2 on the runner,
 * ties inside a closed bar going against the trade, the print resolving a
 * touch the bar cannot order, the time stop, and the flat at the cash close.
 *
 * Run: npx tsx scripts/verify-shadow-book.mjs
 */
const { tickShadow, analyzeShadow, FILL_WINDOW_BARS, MAX_HOLD_BARS } = await import("../src/lib/trading/shadow-book.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
}

const BAR = 15 * 60_000;
const DAY = "2026-09-21"; // a Monday
const T0 = etWallToEpochMs(DAY, "10:00"); // open bar 10:00
const bar = (i, o, h, l, c) => ({ t: T0 + i * BAR, o, h, l, c, v: 1 });

function make(over) {
  return {
    id: "t",
    dayKey: DAY,
    symbol: "MNQ",
    side: "long",
    leg: "limit",
    kind: "refusal",
    word: "STAND",
    reasonId: "pd_half",
    reason: "POI in correct half",
    reasonDetail: "premium fights long",
    grade: "A",
    confluence: 0.8,
    strategy: "model",
    openedAt: T0 + 7 * 60_000, // 10:07, inside the 10:00 bar
    killzone: "ny_am",
    entry: 100,
    stop: 90,
    t1: 110,
    t2: 120,
    riskPts: 10,
    riskDollars: 2000,
    status: "resting",
    seenHi: 104,
    seenLo: 104,
    banked: 0,
    remaining: 1,
    t1Hit: false,
    stopLevel: 90,
    lastBarT: T0,
    barsSinceOpen: 0,
    barsSinceFill: 0,
    path: [],
    layers: [],
    tags: {},
    source: "replay",
    updatedAt: 0,
    ...over,
  };
}

console.log("limit leg");
{
  // 10:15 bar dips to 99 → fills at 100; 10:30 bar runs to 111 → T1, BE; 10:45 runs to 121 → T2.
  const bars = [bar(0, 104, 105, 103, 104), bar(1, 104, 105, 99, 101), bar(2, 101, 111, 100.5, 110), bar(3, 110, 121, 109, 120)];
  let s = make();
  s = tickShadow(s, bars, null, T0 + 4 * BAR);
  check("filled at CE on the bar that touched it", [s.status, s.fillPrice], ["won", 100]);
  check("T1 banked half, T2 on the runner: R = 0.5*1 + 0.5*2", s.r, 1.5);
  check("$ at grade risk", s.pnl, 3000);
  check("path has fill, t1, t2", s.path.map((e) => e.kind), ["fill", "t1", "t2"]);
  check("analysis: gate cost", analyzeShadow(s).verdict, "gate-cost");
}
{
  // Never touches 100 in 12 bars → unfilled.
  const bars = [bar(0, 104, 105, 103, 104)];
  for (let i = 1; i <= FILL_WINDOW_BARS + 1; i++) bars.push(bar(i, 104, 106, 102, 104));
  const s = tickShadow(make(), bars, null, T0 + (FILL_WINDOW_BARS + 2) * BAR);
  check("unfilled after the fill window", [s.status, s.barsSinceOpen], ["unfilled", FILL_WINDOW_BARS]);
  check("analysis: unfilled", analyzeShadow(s).verdict, "unfilled");
}
{
  // Fill bar also runs through the stop → loss (tie against).
  const bars = [bar(0, 104, 105, 103, 104), bar(1, 104, 112, 89, 95)];
  const s = tickShadow(make(), bars, null, T0 + 2 * BAR);
  check("fill bar that also tags the stop is a −1R loss", [s.status, s.r], ["lost", -1]);
  check("tie text names it", /tie goes against/.test(s.exitReason), true);
  check("analysis: gate right", analyzeShadow(s).verdict, "gate-right");
}
{
  // Print fills the limit before any bar closes, then a later bar stops at BE after T1.
  let s = make();
  s = tickShadow(s, [bar(0, 104, 105, 103, 104)], 99.5, T0 + 9 * 60_000);
  check("print fills the resting limit", [s.status, s.fillPrice, s.path[0].kind], ["open", 100, "fill"]);
  s = tickShadow(s, [bar(0, 104, 105, 103, 104), bar(1, 100, 111, 99, 108)], null, T0 + 2 * BAR);
  check("T1 on the next bar, stop to BE", [s.status, s.t1Hit, s.stopLevel, s.banked], ["open", true, 100, 0.5]);
  s = tickShadow(s, [bar(0, 104, 105, 103, 104), bar(1, 100, 111, 99, 108), bar(2, 108, 109, 99.5, 101)], null, T0 + 3 * BAR);
  check("runner stopped at break-even keeps the banked half", [s.status, s.r, s.path[s.path.length - 1].kind], ["won", 0.5, "be"]);
}

console.log("chase leg");
{
  const chase = (over) => make({ leg: "chase", status: "open", fillAt: T0 + 7 * 60_000, fillPrice: 104, entry: 104, riskPts: 14, ...over });
  // Same-bar T1 and T2: T2 not credited on the closed bar (order unknown), credited on the next.
  let s = tickShadow(chase(), [bar(0, 104, 105, 103, 104), bar(1, 104, 121, 103, 120)], null, T0 + 2 * BAR);
  check("closed bar reaching T1 and T2 credits only T1", [s.status, s.t1Hit, s.remaining], ["open", true, 0.5]);
  s = tickShadow(s, [bar(0, 104, 105, 103, 104), bar(1, 104, 121, 103, 120), bar(2, 120, 121, 119, 120)], null, T0 + 3 * BAR);
  check("next bar at T2 closes the runner: R = 0.5*(6/14) + 0.5*(16/14)", [s.status, s.r], ["won", Math.round(((6 / 14) * 0.5 + (16 / 14) * 0.5) * 1000) / 1000]);
}
{
  // Time stop after MAX_HOLD bars, flat at the last close.
  const bars = [bar(0, 104, 105, 103, 104)];
  for (let i = 1; i <= MAX_HOLD_BARS; i++) bars.push(bar(i, 104, 106, 102, 105));
  let s = make({ leg: "chase", status: "open", fillAt: T0 + 7 * 60_000, fillPrice: 104, entry: 104, riskPts: 14, dayKey: "2026-09-19" });
  // Use a Friday and an open time whose 32 bars end before 16:00 — start at 06:00.
  const F0 = etWallToEpochMs("2026-09-18", "06:00");
  const fb = (i, o, h, l, c) => ({ t: F0 + i * BAR, o, h, l, c, v: 1 });
  const fbars = [fb(0, 104, 105, 103, 104)];
  for (let i = 1; i <= MAX_HOLD_BARS; i++) fbars.push(fb(i, 104, 106, 102, 105));
  s = make({ leg: "chase", status: "open", fillAt: F0 + 7 * 60_000, openedAt: F0 + 7 * 60_000, lastBarT: F0, fillPrice: 104, entry: 104, riskPts: 14, dayKey: "2026-09-18" });
  s = tickShadow(s, fbars, null, F0 + (MAX_HOLD_BARS + 1) * BAR);
  check("time stop after MAX_HOLD bars at the close (+0.07R is a win past the ±0.05 scratch band)", [s.status, s.r, s.path[s.path.length - 1].kind], ["won", Math.round((1 / 14) * 1000) / 1000, "time"]);
  void bars;
}
{
  // Flat at the cash close: open at 15:50, bars through 16:15; mark = last bar before 16:00.
  const C0 = etWallToEpochMs(DAY, "15:45");
  const cb = (i, o, h, l, c) => ({ t: C0 + i * BAR, o, h, l, c, v: 1 });
  let s = make({ leg: "chase", status: "open", openedAt: C0 + 5 * 60_000, fillAt: C0 + 5 * 60_000, lastBarT: C0, fillPrice: 104, entry: 104, riskPts: 14 });
  s = tickShadow(s, [cb(0, 104, 105, 103, 104), cb(1, 104, 106, 103, 105.5), cb(2, 105.5, 130, 100, 129)], null, C0 + 3 * BAR);
  check("flat at 16:00 on the last pre-close bar, not the overnight spike", [s.status, s.exitPrice, s.r], ["scratch", 104, 0]);
  const s2 = tickShadow(make({ openedAt: C0 + 5 * 60_000, lastBarT: C0 }), [cb(0, 104, 105, 103, 104), cb(1, 104, 106, 103, 105.5)], null, C0 + 2 * BAR);
  check("resting limit expires flat at the close", s2.status, "expired");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
