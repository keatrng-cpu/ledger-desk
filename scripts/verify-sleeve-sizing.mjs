/**
 * Sleeve sizing from the stop, and the clock guard on a 15% brake.
 *
 * The trader set the model on 2026-09-23: up to a $1,000 debit per trade,
 * loss capped at 15% OF THE DEBIT. That cap is honoured here. What is NOT
 * silent is that a 15% premium stop on a 1 DTE contract is reached by theta
 * alone inside a four-hour hold — the position closes having never gone
 * against you. These tests pin both.
 *
 * Run: npx tsx scripts/verify-sleeve-sizing.mjs
 */
const { sizeFromStop, minDteFor, sleeveViolations, MAX_DEBIT_USD, STOP_FRAC_OF_DEBIT } =
  await import("../src/lib/trading/sleeve-sizing.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const plan = (riskPts, symbol = "MNQ") => ({
  symbol, side: "short", entry: 30974, stop: 31022, riskPts,
});

console.log("\nthe trader's cap is honoured");
check("max debit is $1,000", MAX_DEBIT_USD, 1000);
check("brake is 15% of the debit", STOP_FRAC_OF_DEBIT, 0.15);

console.log("\nsize is solved from the stop, not from a fixed debit");
// MNQ/40 -> a 48pt plan stop is 1.2 underlying points. At delta 0.5 that is
// $60 of premium per contract. A $150 budget buys 2.
const a = sizeFromStop({ plan: plan(48), delta: 0.5, premiumUsd: 150, dte: 7 });
check("a 48pt stop at delta 0.5 sizes 2 contracts", a.contracts, 2);
check("and risks the budget at invalidation", a.lossAtInvalidationUsd, 120);
ok("not unaffordable", !a.unaffordable);

// HALVE the stop distance and the same budget buys twice the contracts.
// This is the whole point: exposure tracks conviction, risk stays flat.
const tight = sizeFromStop({ plan: plan(24), delta: 0.5, premiumUsd: 150, dte: 7 });
ok("a tighter stop buys MORE contracts", tight.contracts > a.contracts);
ok("while risking a similar amount", Math.abs(tight.lossAtInvalidationUsd - a.lossAtInvalidationUsd) <= 60);

// A wide stop buys fewer. Same budget, worse geometry, smaller position.
const wide = sizeFromStop({ plan: plan(160), delta: 0.5, premiumUsd: 150, dte: 7 });
ok("a wide stop buys FEWER contracts", wide.contracts < a.contracts);

console.log("\nthe debit ceiling can bind before the stop does");
const capped = sizeFromStop({ plan: plan(6), delta: 0.5, premiumUsd: 400, dte: 7 });
ok("size capped by the $1,000 ceiling", capped.cappedByDebit);
ok("and the debit never exceeds it", capped.debitUsd <= MAX_DEBIT_USD);
ok("and it says the ceiling bound, not the geometry", capped.lines.some((l) => /ceiling is binding/.test(l)));

console.log("\na ticket too big for the budget is refused, not shrunk and hoped");
const huge = sizeFromStop({ plan: plan(400), delta: 0.9, premiumUsd: 4000, dte: 21, riskBudgetUsd: 150 });
check("no contracts", huge.contracts, 0);
ok("marked unaffordable", huge.unaffordable);
ok("and it says not to take it small and hope", huge.lines.some((l) => /small and hope/.test(l)));

console.log("\nTHE CLOCK — a 15% brake on 1 DTE is reached by theta alone");
const oneDte = sizeFromStop({ plan: plan(48), delta: 0.5, premiumUsd: 150, dte: 1, holdHours: 4 });
ok("1 DTE over 4h is a CLOCK", oneDte.clock);
ok("decay exceeds the whole brake", oneDte.decayToBrake >= 1);
ok("and it says so in those words", oneDte.lines.some((l) => /fire on time, not on price/.test(l)));
ok("and names the DTE that fixes it", oneDte.minDte >= 2);

// More time restores price as the thing being risked.
const sevenDte = sizeFromStop({ plan: plan(48), delta: 0.5, premiumUsd: 150, dte: 7, holdHours: 4 });
ok("7 DTE is not a clock", !sevenDte.clock);
ok("and decay is a small share of the brake", sevenDte.decayToBrake < 0.5);

// The tighter brake is strictly more clock-prone than the old 25% one.
ok("15% needs at least as much DTE as 25%", minDteFor(4, 0.15) >= minDteFor(4, 0.25));
ok("a longer hold needs at least as much time", minDteFor(12, 0.15) >= minDteFor(4, 0.15));

console.log("\nthe exit is the LEVEL, and every ticket says so");
ok("every sized ticket names the invalidation price", sevenDte.lines.some((l) => /31022\.00/.test(l)));
ok("and calls the percentage a backstop", sevenDte.lines.some((l) => /disaster backstop/.test(l)));

console.log("\nviolations feed the setup memory");
// Today's actual trade: $300 debit, no stop honoured.
const v = sleeveViolations({ debitUsd: 300, realisedLossUsd: null, exitedOnLevel: false });
check("a $300 debit is INSIDE the new cap", v.filter((x) => /over the \$1000/.test(x)).length, 0);
ok("but a discretionary exit is a violation", v.some((x) => /discretionary/.test(x)));
const over = sleeveViolations({ debitUsd: 1500, realisedLossUsd: 400, exitedOnLevel: true });
ok("a debit over the cap is caught", over.some((x) => /over the \$1000 per-trade cap/.test(x)));
ok("a loss past the brake is caught", over.some((x) => /over the 15% brake/.test(x)));
check("a clean ticket has no violations", sleeveViolations({ debitUsd: 300, realisedLossUsd: 40, exitedOnLevel: true }).length, 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
