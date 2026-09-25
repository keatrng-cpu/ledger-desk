/**
 * Which card the trader's eye lands on first.
 *
 * FIXTURED ON THE LIVE BOARD OF 2026-09-25 09:35 ET, inside the Judas window.
 * The desk showed, on one screen:
 *
 *   header      HTF BULL · draw 30,869 Asia high 8pt above price at 90% reach
 *               "SMT MNQ leading by 0.13pp — prefer long ideas in leader"
 *   headline    PATH short B Q 0.83 — blocked on HTF bias conflict, 2/4 on
 *               counter-bias, LADDER 0.5x, and an INVERTED invalidation
 *   below it    MNQ long A+ Q 0.78 — HTF aligned
 *
 * Every gate refused the short and the board put it first anyway, because the
 * sort was `b.confluence - a.confluence` and confluence answers "how much
 * structure is present", not "what can be traded". The trader reported exactly
 * this as the desk conflicting with itself, and they were right.
 *
 * These tests pin the ordering contract so that cannot come back.
 *
 * Run: npx tsx scripts/verify-board-rank.mjs
 */

const { boardRank, compareForBoard } = await import("../src/lib/trading/scanner.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const card = (id, htfOk, actionable, confluence) => ({ id, htfOk, actionable, confluence });
const order = (cards) => [...cards].sort(compareForBoard).map((c) => c.id);

console.log("the live board that caused this");
{
  // The exact pair, with their real numbers.
  const shortCounterHtf = card("MNQ short Q0.83", false, false, 0.83);
  const longAligned = card("MNQ long Q0.78", true, true, 0.78);
  check(
    "the HTF-aligned long outranks the higher-scoring counter-trend short",
    order([shortCounterHtf, longAligned]),
    ["MNQ long Q0.78", "MNQ short Q0.83"],
  );
  check("and it is not a tie broken by input order", order([longAligned, shortCounterHtf]), [
    "MNQ long Q0.78",
    "MNQ short Q0.83",
  ]);
}

console.log("\nHTF is an absolute gate, so it leads");
{
  // No score gap is large enough to promote a card the HTF gate refuses.
  check(
    "even a 0.99 counter-HTF card loses to a 0.66 aligned one",
    order([card("counter 0.99", false, true, 0.99), card("aligned 0.66", true, false, 0.66)]),
    ["aligned 0.66", "counter 0.99"],
  );
  check("htfOk is worth more than actionable", boardRank({ htfOk: true, actionable: false }) > boardRank({ htfOk: false, actionable: true }), true);
}

console.log("\nactionable breaks ties within the aligned set");
{
  check(
    "an aligned actionable card beats an aligned blocked one",
    order([card("aligned blocked 0.90", true, false, 0.9), card("aligned live 0.70", true, true, 0.7)]),
    ["aligned live 0.70", "aligned blocked 0.90"],
  );
}

console.log("\nscore still decides among equals");
{
  // The fix must NOT reorder cards that are equally takeable — otherwise it
  // would be substituting one arbitrary ranking for another.
  check(
    "two aligned actionable cards sort by confluence",
    order([card("low 0.70", true, true, 0.7), card("high 0.90", true, true, 0.9)]),
    ["high 0.90", "low 0.70"],
  );
  check(
    "two equally-refused cards also sort by confluence",
    order([card("low 0.70", false, false, 0.7), card("high 0.90", false, false, 0.9)]),
    ["high 0.90", "low 0.70"],
  );
}

console.log("\nthe full four-way ordering");
{
  check(
    "aligned+live, aligned, counter+live, counter",
    order([
      card("counter", false, false, 0.95),
      card("counter+live", false, true, 0.94),
      card("aligned", true, false, 0.66),
      card("aligned+live", true, true, 0.65),
    ]),
    ["aligned+live", "aligned", "counter+live", "counter"],
  );
  check("ranks are 3/2/1/0", [
    boardRank({ htfOk: true, actionable: true }),
    boardRank({ htfOk: true, actionable: false }),
    boardRank({ htfOk: false, actionable: true }),
    boardRank({ htfOk: false, actionable: false }),
  ], [3, 2, 1, 0]);
}

console.log("\nit never invents an order it cannot justify");
{
  const one = [card("only", false, false, 0.5)];
  check("a single card is unchanged", order(one), ["only"]);
  check("an empty board does not throw", order([]), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
