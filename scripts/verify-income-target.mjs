/**
 * The income identity, pinned.
 *
 * This module's whole job is to refuse a comfortable answer, so the tests are
 * mostly about what it must NOT say: it must not call a negative-expectancy
 * policy reachable at any account size, and it must not offer frequency as a
 * route past the point where frequency was measured to destroy the edge.
 *
 * Run: npx tsx scripts/verify-income-target.mjs
 */
const { planIncome, incomeLadder, MEASURED, FREQUENCY_CLIFF_PER_YEAR } = await import(
  "../src/lib/trading/income-target.ts"
);
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");

let pass = 0, fail = 0;
const check = (n, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${n}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

console.log("the identity");
{
  const p = planIncome({ target: 10_000, equity: 100_000, policyId: "stack_pd_event", riskPct: 0.02 });
  check("10k on 100k is 10% a month", Math.abs(p.requiredMonthlyReturn - 0.1) < 1e-9, true);
  const expected = (42 / 12) * 0.091 * 0.02;
  check("projection is trades x E[R] x risk", Math.abs(p.projectedMonthlyReturn - expected) < 1e-9, true);
  check("and it is not reachable at this size", p.reachable, false);
  check("the shortfall is stated as a multiple", p.shortfallMultiple > 10, true);
  check("capital is offered as a route", p.equityNeeded > 100_000, true);
  check("the lines name the identity", /Identity:/.test(p.lines[1]), true);
}

console.log("\nit refuses frequency past the measured cliff");
{
  const p = planIncome({ target: 10_000, equity: 100_000, policyId: "stack_pd_event", riskPct: 0.02 });
  check("the frequency route is flagged as past the cliff", p.tradesPastCliff, true);
  check("and the refusal is in the text", /REFUSED/.test(p.lines.join(" ")), true);
  check("the cliff is where expectancy went negative", FREQUENCY_CLIFF_PER_YEAR, 104);
  const cliff = MEASURED.find((m) => m.id === "stack_two");
  check("and that row is recorded as negative", cliff.oosExpR < 0, true);
}

console.log("\na negative edge is never reachable");
{
  const p = planIncome({ target: 1, equity: 100_000_000, policyId: "shipped" });
  check("no account size rescues a negative expectancy", p.reachable, false);
  check("no equity is suggested", p.equityNeeded, null);
  check("no trade count is suggested", p.tradesNeeded, null);
  check("and it says why", /does not compound/.test(p.lines.join(" ")), true);
}

console.log("\nrisk is clamped to the house ceiling");
{
  const p = planIncome({ target: 10_000, riskPct: 0.25 });
  check("a 25% risk request is clamped", p.riskPct, APLUS_RULES.riskPctCeiling);
  check("the ceiling is the config's, not a local copy", APLUS_RULES.riskPctCeiling, 0.03);
}

console.log("\nplanning uses the held-out number by default");
{
  const held = planIncome({ target: 10_000, policyId: "armed" });
  const pooled = planIncome({ target: 10_000, policyId: "armed", pooled: true });
  check("armed's pooled figure is positive", pooled.projectedMonthlyReturn > 0, true);
  check("its held-out figure is not", held.projectedMonthlyReturn < 0, true);
  check("and the DEFAULT is the held-out one", held.projectedMonthlyReturn === planIncome({ target: 10_000, policyId: "armed" }).projectedMonthlyReturn, true);
  check("the pooled run labels itself", /POOLED/.test(pooled.lines[2]), true);
}

console.log("\nthe ladder");
{
  const l = incomeLadder(10_000, 100_000, 0.02);
  check("every measured policy is priced", l.length, MEASURED.length);
  check("best projected income first", l[0].projectedMonthlyDollars >= l[l.length - 1].projectedMonthlyDollars, true);
  const most = MEASURED.reduce((a, b) => (b.tradesPerYear > a.tradesPerYear ? b : a));
  check("the highest-frequency policy is NOT the best earner", l[0].policy.id !== most.id, true);
  check("because it has no edge left", most.oosExpR < 0, true);
}

console.log("\nthe cadence band");
{
  const { readCadence, WEEKLY_MIN, WEEKLY_MAX } = await import("../src/lib/trading/income-target.ts");
  const c = readCadence({ target: 10_000, equity: 100_000, riskPct: 0.03 });
  check("the band is 2-6 a week", [WEEKLY_MIN, WEEKLY_MAX], [2, 6]);
  check("the desk is currently below the floor", c.belowFloor, true);
  check("a lower cadence demands a higher expectancy", c.expRAtFloor > c.expRAtCeiling, true);
  // The identity must hold exactly: the ceiling is 3x the floor, so the floor
  // must demand exactly 3x the expectancy. If this drifts, the page is wrong.
  check("and demands exactly 3x it, because 6/wk is 3x 2/wk", Math.abs(c.expRAtFloor / c.expRAtCeiling - 3) < 1e-9, true);
  const rich = readCadence({ target: 10_000, equity: 500_000, riskPct: 0.03 });
  check("more capital lowers the expectancy required", rich.expRAtFloor < c.expRAtFloor, true);
  check("at $500k the floor is inside what is already measured", rich.expRAtFloor < 0.091, true);
  check("the line always names the measured figure", /measured is/.test(c.line), true);
  check("and flags the floor breach in words", /BELOW the 2\/week floor/.test(c.line), true);
}

console.log("\nthe caveat that outranks the projection");
{
  const { EDGE_IS_ONE_TRADE_WIDE, TOP5PCT_SHARE_OF_PROFIT } = await import("../src/lib/trading/income-target.ts");
  check("the edge is flagged as one trade wide", EDGE_IS_ONE_TRADE_WIDE, true);
  check("and the tail share is above 100%", TOP5PCT_SHARE_OF_PROFIT > 1, true);
  // A positive projection must NEVER print without the caveat beside it.
  const p = planIncome({ target: 10_000, equity: 500_000, policyId: "stack_pd_event", riskPct: 0.03 });
  check("a positive projection carries the caveat", /one trade wide/.test(p.lines.join(" ")), true);
  const neg = planIncome({ target: 10_000, policyId: "shipped" });
  check("a negative one does not need it", /one trade wide/.test(neg.lines.join(" ")), false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
