/**
 * Word hysteresis (word-hysteresis.ts) against synthetic desk payloads.
 *
 * A printed TAKE must survive the print stepping just outside the array, and
 * must NOT survive a must-layer failing, a different plan, a print far from
 * the array, or the hold ageing out.
 *
 * Run: npx tsx scripts/verify-word-hold.mjs
 */
const { applyWordHysteresis, createHysteresisState, HOLD_MS } = await import("../src/lib/trading/word-hysteresis.ts");

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

function book(over) {
  return {
    symbol: "MNQ",
    side: "long",
    word: "WAIT",
    missing: "Retrace into array",
    missingDetail: "IFVG 100–104 is 1.5pt above price — wait for it",
    layers: [
      { id: "dol", label: "Draw", must: true, state: "pass", detail: "" },
      { id: "sweep", label: "Sweep", must: true, state: "pass", detail: "" },
      { id: "target", label: "Target", must: true, state: "pass", detail: "" },
      { id: "retrace", label: "Retrace", must: true, state: "wait", detail: "" },
      { id: "clean", label: "Judas", must: true, state: "pass", detail: "" },
    ],
    mustPass: 4,
    mustNeed: 5,
    plan: { entry: 102, stop: 96, entryZone: { top: 104, bottom: 100 }, t1: 112, t2: 120 },
    ...over,
  };
}
function desk(left, price) {
  return {
    quotes: { left: { price }, right: { price: 5000 } },
    smcMaster: { left, right: book({ symbol: "ES", side: "short", plan: null, word: "STAND" }), oneBook: left, thesis: "t" },
  };
}

console.log("word hold");
{
  const st = createHysteresisState();
  const t0 = 1_000_000;
  // 1. genuine TAKE at 103 (inside) starts the hold
  let d = applyWordHysteresis(desk(book({ word: "TAKE", layers: book().layers.map((l) => ({ ...l, state: "pass" })) }), 103), st, t0);
  check("genuine TAKE passes through", d.smcMaster.left.word, "TAKE");
  // 2. next poll: price 105 (1pt above the top = 25% of height), engine says WAIT → held
  d = applyWordHysteresis(desk(book(), 105), st, t0 + 20_000);
  check("held through the edge", [d.smcMaster.left.word, d.smcMaster.left.missing], ["TAKE", "TAKE held — limit at CE"]);
  check("retrace layer state untouched (auto-paper still waits)", d.smcMaster.left.layers.find((l) => l.id === "retrace").state, "wait");
  check("oneBook re-linked to the held book", d.smcMaster.oneBook.word, "TAKE");
  // 3. price 107 (3pt above = 75% of height) → beyond the band → WAIT
  d = applyWordHysteresis(desk(book(), 107), st, t0 + 40_000);
  check("beyond half an array height releases the hold", d.smcMaster.left.word, "WAIT");
  // 4. once released, a WAIT at 105 stays WAIT (no hold to resume)
  d = applyWordHysteresis(desk(book(), 105), st, t0 + 60_000);
  check("no hold after release", d.smcMaster.left.word, "WAIT");
}
{
  const st = createHysteresisState();
  const t0 = 2_000_000;
  applyWordHysteresis(desk(book({ word: "TAKE" }), 103), st, t0);
  // a must-layer FAILS → STAND immediately, hold dropped
  const failed = book({ word: "STAND", layers: book().layers.map((l) => (l.id === "clean" ? { ...l, state: "fail" } : l)) });
  const d = applyWordHysteresis(desk(failed, 105), st, t0 + 20_000);
  check("a failing must-layer ends the hold", d.smcMaster.left.word, "STAND");
}
{
  const st = createHysteresisState();
  const t0 = 3_000_000;
  applyWordHysteresis(desk(book({ word: "TAKE" }), 103), st, t0);
  const other = book({ plan: { entry: 90, stop: 84, entryZone: { top: 92, bottom: 88 }, t1: 100, t2: 110 } });
  const d = applyWordHysteresis(desk(other, 93), st, t0 + 20_000);
  check("a different plan (new array) is not held", d.smcMaster.left.word, "WAIT");
}
{
  const st = createHysteresisState();
  const t0 = 4_000_000;
  applyWordHysteresis(desk(book({ word: "TAKE" }), 103), st, t0);
  const d = applyWordHysteresis(desk(book(), 105), st, t0 + HOLD_MS + 1);
  check("the hold ages out", d.smcMaster.left.word, "WAIT");
}
{
  const st = createHysteresisState();
  const t0 = 5_000_000;
  applyWordHysteresis(desk(book({ word: "TAKE" }), 103), st, t0);
  const two = book({ layers: book().layers.map((l) => (l.id === "target" ? { ...l, state: "wait" } : l)) });
  const d = applyWordHysteresis(desk(two, 105), st, t0 + 20_000);
  check("a second waiting must-layer (target lost) ends the hold", d.smcMaster.left.word, "WAIT");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
