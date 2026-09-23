/**
 * Spent cards, stale draws, and what to look at next.
 *
 * Reproduces the exact 2026-09-23 board: MNQ at 30,838.25 with a draw of
 * 30,860.75 labelled "below, 100% base rate" and an entry of
 * 30,870.75-30,901.75 — every number above the price, on a short whose
 * target had already printed. The cause was `structure.ts` handing
 * `drawOnLiquidity` the close of the last CLOSED bar while the UI rendered
 * the live quote. These tests pin both the detection and the fix.
 *
 * Run: npx tsx scripts/verify-card-freshness.mjs
 */
const { cardFreshness, drawSideStale, nextLook } = await import("../src/lib/trading/card-freshness.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

// The real card from the screenshot.
const mnq = {
  side: "short",
  entry: 30886.25,
  entryZone: { top: 30901.75, bottom: 30870.75 },
  stop: 30930.0,
  t1: 30860.75,
};

console.log("\nthe real 2026-09-23 card is spent, and the board said it was live");
const spent = cardFreshness(mnq, 30838.25, 30886.0);
check("target already printed", spent.state, "target_hit");
check("reach is meaningless now", spent.reachStillMeaningful, false);
ok("it says do not enter late", /Do not enter it late/.test(spent.line));
ok("and tells you to re-scan both ways", /continuation/.test(spent.line) && /reversal/.test(spent.line));
ok("and demands a NEW entry and stop", /NEW entry and stop/.test(spent.line));
ok("drift from the stale bar is reported", spent.driftPts > 40);

console.log("\na card with everything still ahead is live");
const live = cardFreshness(mnq, 30895.0);
check("live", live.state, "live");
ok("reach still means something", live.reachStillMeaningful);

console.log("\nthe other ways a card dies");
// Price fell past the entry without the retrace ever coming.
const gone = cardFreshness({ ...mnq, t1: 30700 }, 30840.0);
check("entry gone", gone.state, "entry_gone");
ok("and a return is a DIFFERENT trade", /different trade/.test(gone.line));
// Invalidation already traded.
const dead = cardFreshness({ ...mnq, t1: 30700 }, 30935.0);
check("stop already tagged", dead.state, "entry_gone");
ok("dead, not waiting", /dead, not waiting/.test(dead.line));
// A long is judged the mirror way round.
const longCard = { side: "long", entry: 100, entryZone: { top: 102, bottom: 98 }, stop: 95, t1: 110 };
check("a long past its target", cardFreshness(longCard, 111).state, "target_hit");
check("a long still building", cardFreshness(longCard, 101).state, "live");
check("a long stopped out", cardFreshness(longCard, 94).state, "entry_gone");
// No price is unverified, never "valid".
ok("no live price refuses to bless the card", /unverified, not as valid/.test(cardFreshness(mnq, 0).line));

console.log("\nthe stale-side check — the exact label that was wrong");
const staleDraw = drawSideStale({ price: 30860.75, side: "below" }, 30838.25);
ok("a draw labelled below that is above is stale", staleDraw.stale);
ok("and it says the reach is meaningless", /no longer exists/.test(staleDraw.line));
check("a correctly labelled draw is not stale", drawSideStale({ price: 30900, side: "above" }, 30838.25).stale, false);

console.log("\nwhat to look at next — candidates, never a plan");
const T = (name, price, reach, side) => ({
  name, price, reachProbability: reach, side, kind: "pool",
  distancePoints: 0, distanceAtr: 0, liquidityWeight: 1, swept: false, score: 0.5, why: [],
});
const draw = {
  primary: T("Range low", 30860.75, 1, "below"),
  above: T("PDH", 30950, 0.4, "above"),
  below: T("PWL", 30700, 0.6, "below"),
  alternates: [T("EQ", 30890, 0.5, "above")],
  atr: 50, medianSessionRange: 400, sessionRangeUsedPct: 0.5,
  sessionsSampled: 20, baseRateReliable: true, note: "",
};
const look = nextLook(draw, "short", 30838.25);
ok("a continuation target further down is offered", look.continuation?.price < 30838.25);
ok("and a reversal target above", look.reversal?.price > 30838.25);
ok("both are called candidates, not plans", /CANDIDATES, not plans/.test(look.line));
ok("and reusing the spent levels is named as the mistake", /late entry that just cost you/.test(look.line));

console.log("\nthe root-cause fix — the draw now honours a live price");
const bar = (t, c) => ({ t, o: c, h: c + 5, l: c - 5, c, v: 1 });
const bars = Array.from({ length: 120 }, (_, i) => bar(i * 900_000, 30900 + (i % 7) * 3));
const read = {
  symbol: "MNQ", last: 30900, topDown: "bear",
  pdh: 30990, pdl: 30810, pwh: 31100, pwl: 30650,
  midnightOpen: 30880, nyOpen830: 30870, nyOpen930: 30895,
  dealing: { high: 30990, low: 30750, eq: 30870 },
  liquidity: [],
};
const stale = drawOnLiquidity(read, bars);
const fresh = drawOnLiquidity(read, bars, 30700);
ok("passing a live price changes the read", JSON.stringify(stale.primary) !== JSON.stringify(fresh.primary));
ok("a zero live price falls back to the bar close", JSON.stringify(drawOnLiquidity(read, bars, 0)) === JSON.stringify(stale));
ok("an absent live price is unchanged behaviour", JSON.stringify(drawOnLiquidity(read, bars, undefined)) === JSON.stringify(stale));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
