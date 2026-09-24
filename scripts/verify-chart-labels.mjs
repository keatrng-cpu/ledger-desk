/**
 * The array labels on the big chart — the ink the trader reads at the moment
 * a limit is about to fill.
 *
 *   npx tsx scripts/verify-chart-labels.mjs
 *
 * WHY THIS EXISTS
 * The live chart printed "15M REJ ⊃ 15M REJ" across the LIVE price. Three
 * separate faults in one label:
 *
 *   1. A group whose inner arrays share the outer's name repeated it, so the
 *      label spent pixels saying a thing twice and told the trader nothing.
 *   2. Set-theory glyphs (⊃, ⊂) at 7.5px over candles are noise, not notation.
 *   3. Nothing clamped the plate, so a long name ran off the plot and printed
 *      through the price rail — unreadable exactly where the numbers matter.
 *
 * (3) is geometry inside the component and is asserted in the browser; (1)
 * and (2) are pure and are asserted here, because a label that lies about
 * what is on the chart is a correctness bug wearing a cosmetic costume.
 */

import { groupName, groupNestedArrays } from "../src/components/desk/setup-chart.tsx";

let pass = 0;
let fail = 0;
const fails = [];
const ok = (c, l) => (c ? pass++ : (fail++, fails.push(l)));

/** A minimal SmcArray: only the fields the label and grouping read. */
const arr = (kind, tf, top, bottom, t = 1) => ({
  kind,
  tf,
  top,
  bottom,
  t,
  side: "bear",
  state: "fresh",
});

// ── 1. The exact string from the screenshot can never be produced ─────────
{
  const outer = arr("rejection", "15m", 100, 90);
  const inner = arr("rejection", "15m", 98, 92);
  const name = groupName({ outer, inner: [inner] }, null);

  ok(!name.includes("⊃"), `no set-theory glyph in "${name}"`);
  ok(!name.includes("⊂"), `no subset glyph in "${name}"`);

  // The specific regression: a name containing itself.
  const head = name.split(/[·×]/)[0].trim();
  const repeats = name.split(head).length - 1;
  ok(repeats === 1, `"${name}" does not repeat its own head`);
  ok(/×2/.test(name), `same-name group counts instead of repeating (got "${name}")`);
}

// ── 2. Distinct inner names still say what is inside ──────────────────────
{
  const outer = arr("orderblock", "1h", 100, 90);
  const inner = arr("fvg", "15m", 98, 94);
  const name = groupName({ outer, inner: [inner] }, null);
  ok(/inside/.test(name), `a distinct inner is named (got "${name}")`);
  ok(!name.includes("⊃"), "and still without a glyph");
}

// ── 3. Several inners count rather than list ──────────────────────────────
{
  const outer = arr("orderblock", "1h", 100, 80);
  const inners = [arr("fvg", "15m", 98, 96), arr("rejection", "15m", 94, 92), arr("breaker", "15m", 90, 88)];
  const name = groupName({ outer, inner: inners }, null);
  ok(/3 inside/.test(name), `three inners count (got "${name}")`);
  ok(name.length < 34, `and the label stays short enough to draw (${name.length} chars)`);
}

// ── 4. The ENTRY always owns the name ─────────────────────────────────────
{
  const outer = arr("orderblock", "1h", 100, 90);
  const entry = arr("fvg", "15m", 98, 94);
  const name = groupName({ outer, inner: [entry] }, entry);
  ok(name.startsWith("ENTRY "), `the entry leads the label (got "${name}")`);
  ok(/ in /.test(name), "and says plainly which zone holds it");
  ok(!name.includes("⊂"), "without a subset glyph");

  // Entry IS the outer — no "in" clause to invent.
  const solo = groupName({ outer: entry, inner: [] }, entry);
  ok(solo.startsWith("ENTRY "), "a lone entry is still named ENTRY");
  ok(!/ in /.test(solo), "and claims no container it does not have");
}

// ── 5. Every label is short enough to fit the plot ────────────────────────
//
// The plate is name.length * 4.7 + 6 px against a ~600px plot. Anything past
// ~40 chars cannot be clamped into view without covering the tape.
{
  const kinds = ["orderblock", "fvg", "ifvg", "rejection", "breaker", "mitigation"];
  const tfs = ["15m", "1h", "4h"];
  let worst = "";
  for (const ok1 of kinds) {
    for (const tf1 of tfs) {
      for (const ok2 of kinds) {
        for (const tf2 of tfs) {
          const outer = arr(ok1, tf1, 100, 80);
          const inner = arr(ok2, tf2, 98, 90);
          for (const entry of [null, inner]) {
            const n = groupName({ outer, inner: [inner] }, entry);
            if (n.length > worst.length) worst = n;
          }
        }
      }
    }
  }
  ok(worst.length <= 40, `widest label is ${worst.length} chars: "${worst}"`);
  ok(worst.length * 4.7 + 6 < 400, "and its plate fits well inside the plot");
}

// ── 6. Grouping still collapses containment (the label's precondition) ────
{
  const big = arr("orderblock", "1h", 100, 80);
  const mid = arr("fvg", "15m", 96, 88);
  const small = arr("rejection", "15m", 94, 92);
  const groups = groupNestedArrays([small, big, mid]);
  ok(groups.length === 1, `three nested arrays are ONE group (got ${groups.length})`);
  ok(groups[0].outer === big, "the widest is the outer");
  ok(groups[0].inner.length === 2, "and holds the other two");

  // Two disjoint zones stay two groups — collapsing them would hide one.
  const far = arr("fvg", "15m", 60, 50);
  ok(groupNestedArrays([big, far]).length === 2, "disjoint zones remain separate");
}

console.log(`\nchart-labels: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
