/**
 * The driver figures are only worth drawing if they are TRUE — if removing a
 * component really does drop `fit` by the number the chart printed next to it.
 *
 * So this does not test the module against a fixture I wrote. It tests it
 * against the scoring engine itself: for every strategy and every component,
 * grade the tape with the component, grade it without, and check that the
 * observed delta equals the claimed marginal contribution.
 *
 * That is the check that would have caught the markup bug: a verifier written
 * from the same wrong assumption as the code passes 126/126 and proves
 * nothing. A differential test against the real engine cannot do that.
 *
 *   npx tsx scripts/verify-score-drivers.mjs
 */
import {
  scoreDrivers,
  reconstruct,
  topDrivers,
  missingDrivers,
} from "../src/lib/trading/score-drivers.ts";
import {
  gradeStrategyAgainstMarket,
  STRATEGY_TEMPLATES,
  SMC_STRUCTURE_KEYS,
} from "../src/lib/trading/strategy-grade.ts";
import { COMPONENT_KEYS } from "../src/lib/trading/engine-weights.ts";

let pass = 0;
let fail = 0;
const fails = [];

function ok(cond, label) {
  if (cond) pass++;
  else {
    fail++;
    fails.push(label);
  }
}

function near(a, b, tol, label) {
  ok(Math.abs(a - b) <= tol, `${label} (got ${a.toFixed(4)}, want ${b.toFixed(4)})`);
}

// The bonuses gradeStrategyAgainstMarket adds are session facts, not
// components. Hold them off so the deltas are pure component arithmetic.
const NO_BONUS = { htfOk: false, killzoneOk: false, conditionsOk: false };

// ── 1. DIFFERENTIAL: removing a component drops fit by exactly `points` ──────
//
// Only valid away from the clamps. `fit` is floored to PROFIT_ACTION_FLOOR-0.02
// when a strategy is neither complete nor near-complete, and that floor masks
// real deltas — so a pair where either side is clamped is skipped, and the
// count of skips is reported rather than quietly absorbed.
let checked = 0;
let skippedClamp = 0;

for (const t of STRATEGY_TEMPLATES) {
  // A tape carrying everything this template reads, so removals are meaningful.
  const full = [
    ...t.must,
    ...(t.mustAnyOf ?? []).flat(),
    ...t.nice,
    ...SMC_STRUCTURE_KEYS,
  ];
  const uniq = [...new Set(full)];

  const baseGrade = gradeStrategyAgainstMarket(t.id, uniq, NO_BONUS);
  const drivers = scoreDrivers(t.id, uniq);

  for (const d of drivers) {
    const without = uniq.filter((c) => c !== d.key);
    const cut = gradeStrategyAgainstMarket(t.id, without, NO_BONUS);

    // NOTHING IS SKIPPED ANY MORE.
    //
    // This loop used to skip every pair where either side sat on a clamp, and
    // removing a `must` ALWAYS trips the not-complete floor — so the twelve
    // skipped comparisons were precisely the twelve that mattered, and
    // 135/135 certified a module that understated musts threefold. A verifier
    // that excuses the hard cases is the module agreeing with its own fixture
    // by a slower route.
    //
    // The module now differences this same engine, so the clamps are inside
    // the measurement rather than outside it and every pair is checkable.
    const observed = +(baseGrade.fit - cut.fit).toFixed(4);

    // Strict equality on EVERY component, clamps included.
    near(observed, d.points, 0.0015, `${t.id}/${d.key} marginal drop`);

    // And the consequence a trader actually feels: removing a `must` must
    // drop the card under the action floor. If this ever stops being true the
    // template has changed and the figures need re-reading.
    if (t.must.includes(d.key) && baseGrade.complete) {
      ok(
        cut.fit < baseGrade.fit,
        `${t.id}/${d.key}: removing a must lowers the grade`,
      );
      ok(
        d.points > 0.05,
        `${t.id}/${d.key}: a must is worth real points (got ${d.points})`,
      );
    }
    checked++;
  }
}

ok(checked > 40, `differential coverage: ${checked} component removals compared`);
ok(skippedClamp === 0, "nothing was skipped — clamps are inside the measurement");
console.log(`  differential: ${checked} compared, ${skippedClamp} skipped`);

// ── 2. The any-of redundancy rule ───────────────────────────────────────────
// mechanical: mustAnyOf [["ifvg","order_block"]]. With BOTH present, removing
// either must not move fit at all — so the module must claim zero for both.
{
  const both = ["mechanical_model", "sweep_significant", "ifvg", "order_block"];
  const d = scoreDrivers("mechanical", both);
  const ifvg = d.find((x) => x.key === "ifvg");
  const ob = d.find((x) => x.key === "order_block");
  ok(ifvg?.channel === "anyof-redundant", "ifvg redundant when order_block also present");
  ok(ob?.channel === "anyof-redundant", "order_block redundant when ifvg also present");
  ok(ifvg?.points === 0, "redundant any-of member claims zero points");

  // And the engine agrees: removing one changes nothing.
  const a = gradeStrategyAgainstMarket("mechanical", both, NO_BONUS).fit;
  const b = gradeStrategyAgainstMarket(
    "mechanical",
    both.filter((c) => c !== "ifvg"),
    NO_BONUS,
  ).fit;
  near(a - b, 0, 0.0002, "engine confirms redundant member is marginally free");

  // Sole member is NOT free.
  const sole = ["mechanical_model", "sweep_significant", "ifvg"];
  const ds = scoreDrivers("mechanical", sole);
  ok(
    ds.find((x) => x.key === "ifvg")?.channel === "anyof-sole",
    "ifvg is load-bearing when it is the only any-of member",
  );
  ok((ds.find((x) => x.key === "ifvg")?.points ?? 0) > 0, "sole any-of member claims real points");
}

// ── 3. ifvg is NOT a structure key — the bug this module exists to prevent ──
{
  ok(!SMC_STRUCTURE_KEYS.includes("ifvg"), "precondition: ifvg is outside SMC_STRUCTURE_KEYS");
  // On a strategy whose template never reads ifvg, it must score zero and say
  // so — never inherit its raw weight of 8.
  const d = scoreDrivers("bias", ["ifvg", "mid_bias"]);
  const i = d.find((x) => x.key === "ifvg");
  const readsIfvg =
    templateReads("bias", "ifvg");
  if (!readsIfvg) {
    ok(i?.channel === "unscored", "ifvg unscored on a template that never reads it");
    ok(i?.points === 0, "unscored component claims zero, not its raw weight");
  } else {
    pass++; // template does read it; covered by the differential pass above
  }
}

function templateReads(id, key) {
  const t = STRATEGY_TEMPLATES.find((x) => x.id === id);
  if (!t) return false;
  return (
    t.must.includes(key) ||
    t.nice.includes(key) ||
    (t.mustAnyOf ?? []).some((g) => g.includes(key))
  );
}

// ── 4. reconstruct() reports honestly ───────────────────────────────────────
{
  const comps = ["mechanical_model", "sweep_significant", "ifvg", "structure", "mss"];
  const g = gradeStrategyAgainstMarket("mechanical", comps, NO_BONUS);
  const r = reconstruct(scoreDrivers("mechanical", comps), g.fit);
  ok(typeof r.summed === "number", "reconstruct returns a total");
  // It must never claim the drivers add up to the score when they overlap —
  // the old version asserted exactness and certified figures that were 3x low.
  ok(
    r.overlaps === r.summed > g.fit + 1e-9,
    "reconstruct's overlap flag matches its own arithmetic",
  );
  if (r.overlaps) ok(/overlap/i.test(r.note), "an overlapping total says it overlaps");
}

// ── 5. topDrivers only surfaces things that actually scored ────────────────
{
  const comps = ["mechanical_model", "sweep_significant", "ifvg", "order_block", "structure"];
  const top = topDrivers(scoreDrivers("mechanical", comps), 5);
  ok(
    top.every((d) => d.points > 0),
    "topDrivers never labels a zero-point component",
  );
  ok(
    top.every((d, i, a) => i === 0 || a[i - 1].points >= d.points),
    "topDrivers is sorted by contribution",
  );
}

// ── 6. missingDrivers names what is being waited FOR ────────────────────────
{
  const m = missingDrivers("mechanical", ["mechanical_model"]);
  ok(
    m.some((x) => x.key === "sweep_significant" && x.channel === "must"),
    "missing must is reported",
  );
  ok(
    m.some((x) => x.key === "ifvg" && x.channel === "anyof"),
    "unsatisfied any-of group lists its members",
  );
  const none = missingDrivers("mechanical", [
    "mechanical_model",
    "sweep_significant",
    "ifvg",
    "mid_bias",
    "htf2_bias",
    "displacement",
    "mss",
  ]);
  ok(none.length === 0, "nothing missing when the template is fully satisfied");
}

// ── 7. unknown inputs degrade quietly ──────────────────────────────────────
{
  ok(scoreDrivers("no-such-strategy", ["ifvg"]).length === 1, "unknown strategy still lists components");
  ok(
    scoreDrivers("mechanical", ["not_a_component"]).length === 0,
    "a non-component is dropped rather than scored",
  );
  ok(scoreDrivers("mechanical", []).length === 0, "empty tape yields no drivers");
  ok(missingDrivers("no-such-strategy", []).length === 0, "unknown strategy has no missing list");
}

// ── 8. every component key has a label ─────────────────────────────────────
{
  const d = scoreDrivers("mechanical", COMPONENT_KEYS);
  ok(d.length === COMPONENT_KEYS.length, "every component key is recognised");
  ok(
    d.every((x) => x.label && x.label !== x.key),
    "every component has a human label, not a raw key",
  );
}

console.log(`\nscore-drivers: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
