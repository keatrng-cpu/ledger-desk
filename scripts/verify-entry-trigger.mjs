/**
 * The entry trigger and the resting limit, against hand-built cases.
 *
 * These two decide when the trader is called to the screen and at what price
 * the paper book fills. A wrong tier wastes the only scarce resource (two
 * trades a week of attention); a wrong fill price silently corrupts every R
 * the desk has ever measured. Both are worth pinning.
 *
 * Run: npx tsx scripts/verify-entry-trigger.mjs
 */
const { readEntry, isWatchable, touchKey, previewLoss, readRunner, reachTier, TIER_ARMED_ATR } =
  await import("../src/lib/trading/entry-trigger.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

// An MNQ long: array 100–104 (height 4), CE 102, stop 96, T1 112, T2 120.
const plan = {
  symbol: "MNQ",
  side: "long",
  price: 105,
  entry: 102,
  entryZone: { top: 104, bottom: 100 },
  stop: 96,
  riskPts: 6,
  riskOverCap: false,
  t1: 112,
  t2: 120,
  rr1: 1.67,
  rr2: 3,
  sweep: null,
  range: null,
  draw: { price: 112, name: "PDH", reachProbability: 0.88 },
  arrays: [],
  levels: [],
};
const ATR = 20;

console.log("tier");
{
  check("price inside the array is LIVE and in zone", (() => { const r = readEntry(plan, 102, ATR); return [r.tier, r.inZone, r.awayPts]; })(), ["live", true, 0]);
  // The retrace pad is 25% of the 4pt height = 1pt, so 105 is inside.
  check("price within the retrace pad is still in zone", readEntry(plan, 105, ATR).inZone, true);
  // 110 is 6pt above the top = 0.30 ATR -> armed.
  check("0.30 ATR away is ARMED", (() => { const r = readEntry(plan, 110, ATR); return [r.tier, Number(r.awayAtr.toFixed(2))]; })(), ["armed", 0.3]);
  // 129 is 25pt above = 1.25 ATR -> forming.
  check("1.25 ATR away is FORMING", readEntry(plan, 129, ATR).tier, "forming");
  // 170 is 66pt = 3.3 ATR -> gone.
  check("3.3 ATR away has WALKED OFF", readEntry(plan, 170, ATR).tier, "gone");
  check("the FORMING copy tells the trader to look away", /look away|plan for later/i.test(readEntry(plan, 129, ATR).action), true);
  check("the LIVE copy names the limit price", /102\.00/.test(readEntry(plan, 103, ATR).action), true);
  check("no ATR falls back to the array height", readEntry(plan, 110, null) != null, true);
  check("no plan is no read", readEntry(null, 100, ATR), null);
}

console.log("watchable");
{
  const musts = (over = {}) => [
    { id: "dol", must: true, state: "pass" },
    { id: "sweep", must: true, state: "pass" },
    { id: "target", must: true, state: "pass" },
    { id: "retrace", must: true, state: "wait" },
    { id: "clean", must: true, state: "pass" },
    ...(over.extra ?? []),
  ];
  const book = (over = {}) => ({ symbol: "MNQ", side: "long", word: "WAIT", plan, layers: musts(over), ...over });
  check("everything but the retrace passing is watchable", isWatchable(book()), true);
  check("a FAILED must-layer is never watchable", isWatchable(book({ extra: [{ id: "pd_half", must: true, state: "fail" }] })), false);
  check("a second WAITING must-layer is not watchable — the touch is not the last condition", isWatchable(book({ extra: [{ id: "ltf", must: true, state: "wait" }] })), false);
  check("no plan is not watchable", isWatchable({ ...book(), plan: null }), false);
  check("no priced target is not watchable", isWatchable({ ...book(), plan: { ...plan, t1: null } }), false);
  check("the touch key is stable for one plan and one day", touchKey(book(), "2026-09-22"), touchKey(book(), "2026-09-22"));
  check("a different entry price is a different key", touchKey(book(), "2026-09-22") !== touchKey({ ...book(), plan: { ...plan, entry: 101 } }, "2026-09-22"), true);
}

console.log("the cost of the click");
{
  const l = previewLoss({ sleeveRisk: 150, paperRisk: 2000, weekPnl: 113, rr1: 1.67, logged: 4 });
  check("the loss is priced on the SLEEVE, not the paper book", [l.risk, l.paperRisk, l.weekAfter], [150, 2000, -37]);
  check("and the win is priced too", Math.round(l.weekIfT1), 238);
  check("the line names the real money and the paper risk", /−\$150 on the sleeve/.test(l.line) && /paper book −\$2000/.test(l.line), true);
  const unlogged = previewLoss({ sleeveRisk: 150, paperRisk: 2000, weekPnl: 0, rr1: 1.67, logged: 0 });
  check("an unlogged week is unknown, not flat", [unlogged.weekAfter, unlogged.weekIfT1], [null, null]);
  check("and it says to log the fills instead of quoting +$0", /unlogged/.test(unlogged.line), true);
}

console.log("the runner");
{
  const before = readRunner(plan, false);
  check("before T1 it quotes the plan's own R", [Number(before.ifT2.toFixed(2))], [3]);
  const after = readRunner(plan, true);
  check("after T1 half is banked and cannot be lost", [Number(after.banked.toFixed(3)), Number(after.ifBe.toFixed(3))], [0.835, 0.835]);
  check("and it names the measured cost of closing early", /R\/trade/.test(after.line), true);
  check("no target, no runner read", readRunner({ ...plan, t1: null }, false), null);
}

console.log("target reach");
{
  check("88% reach is a clean target", reachTier(0.88).tier, "clean");
  check("70% reach is thin", reachTier(0.7).tier, "thin");
  check("45% reach is unlikely", reachTier(0.45).tier, "unlikely");
  check("unmeasured reach is not called clean", reachTier(null).tier, "thin");
  check("the unlikely note carries the measured numbers", /−0\.21R/.test(reachTier(0.45).note), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
