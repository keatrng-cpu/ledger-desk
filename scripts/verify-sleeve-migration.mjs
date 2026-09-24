/**
 * The sleeve model migration, checked as live-money arithmetic.
 *
 *   npx tsx scripts/verify-sleeve-migration.mjs
 *
 * On 2026-09-23 the trader replaced "$1,000 account, 15% of it = $150 max
 * debit" with "$1,000 max DEBIT per trade, loss capped at 15% of the debit
 * paid". Those two models share the number $150 and mean opposite things by
 * it, and one function — `rhMaxDebit`, equity x riskPct — was answering both
 * questions at four call sites.
 *
 * The migration raises the ticket ceiling 6.7x. The ONLY reason that is not a
 * 6.7x risk increase is that the loss cap is a fraction of the debit rather
 * than the whole of it. That reasoning is load-bearing, so it is asserted
 * here rather than trusted:
 *
 *   risk = contracts x premium x stopFrac  <=  budget
 *
 * must hold for every ticket the desk can size, at every DTE, or the change
 * is unsafe and should not ship.
 */

import {
  rhTicketCapUsd,
  rhRiskBudgetUsd,
  RH_SLEEVE_DEFAULT,
} from "../src/lib/trading/options-sleeve.ts";
import {
  contractsWithinRisk,
  brakeIsClock,
  EFFECTIVE_STOP_FRAC,
} from "../src/lib/trading/options-desk.ts";
import {
  MAX_DEBIT_USD,
  STOP_FRAC_OF_DEBIT,
  sizeFromStop,
} from "../src/lib/trading/sleeve-sizing.ts";
import { RH_WORKING_STOP_PCT } from "../src/lib/trading/rh-income.ts";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
let pass = 0;
let fail = 0;
const fails = [];
const ok = (c, l) => (c ? pass++ : (fail++, fails.push(l)));

// ── 1. The two numbers mean different things now ───────────────────────────
{
  const cap = rhTicketCapUsd();
  const budget = rhRiskBudgetUsd();
  ok(cap === 1_000, `ticket ceiling is $1,000 (got ${cap})`);
  ok(budget === 150, `loss budget is $150 (got ${budget})`);
  ok(cap !== budget, "the ceiling and the loss budget are no longer the same number");
  ok(cap === MAX_DEBIT_USD, "options-sleeve and sleeve-sizing agree on the ceiling");

  // Graded sizing: a probe must risk less than an A. This was computed and
  // then thrown away at options-swing.ts:263 under the old model.
  ok(rhRiskBudgetUsd(RH_SLEEVE_DEFAULT, 0.075) === 75, "a 0.075 probe risks $75");
  ok(
    rhRiskBudgetUsd(RH_SLEEVE_DEFAULT, 0.075) < rhRiskBudgetUsd(RH_SLEEVE_DEFAULT, 0.15),
    "a probe risks strictly less than an A",
  );
}

// ── 2. THE SAFETY INVARIANT: risk never exceeds the budget ─────────────────
//
// Swept across every premium the sleeve could plausibly meet. If this fails
// anywhere, raising the ceiling raised risk and the migration is wrong.
{
  const cap = rhTicketCapUsd();
  const budget = rhRiskBudgetUsd();
  let worst = 0;
  let worstAt = null;
  let sized = 0;

  for (let each = 5; each <= 2_000; each += 5) {
    const n = contractsWithinRisk(each, cap, budget);
    if (n === 0) continue;
    sized++;
    const debit = n * each;
    const loss = debit * EFFECTIVE_STOP_FRAC;
    ok(debit <= cap + 1e-9, `premium $${each}: debit $${debit} within the $${cap} ceiling`);
    if (loss > worst) {
      worst = loss;
      worstAt = each;
    }
  }
  ok(sized > 50, `swept ${sized} priceable premiums`);
  ok(
    worst <= budget + 1e-9,
    `worst-case loss across the sweep is $${worst.toFixed(2)} at premium $${worstAt} — budget $${budget}`,
  );
}

// ── 3. The 15%/25% contradiction is sized against the WORSE reading ────────
{
  ok(
    EFFECTIVE_STOP_FRAC === Math.max(STOP_FRAC_OF_DEBIT, RH_WORKING_STOP_PCT),
    "sizing uses the worse of the two stated stop fractions",
  );
  ok(EFFECTIVE_STOP_FRAC >= 0.25, "a 25% worked stop is what the size assumes");

  // Concretely: a $150 contract. Under a naive 15% assumption the desk would
  // buy 6 and risk $225 against a $150 budget if the worked stop is 25%.
  const n = contractsWithinRisk(150, 1_000, 150);
  ok(n === 4, `a $150 contract sizes to 4, not 6 (got ${n})`);
  ok(150 * n * 0.25 <= 150 + 1e-9, "four contracts stopped at 25% lose exactly the budget");
  ok(150 * 6 * 0.25 > 150, "six would have overshot — which is what a 15% assumption buys");
}

// ── 4. The decay clock: the ceiling is only spendable when price can reach it ──
{
  // Short DTE — theta walks a 15% brake before price can.
  ok(brakeIsClock(0), "0 DTE: the brake is a clock");
  ok(brakeIsClock(1), "1 DTE: the brake is a clock");
  // Far DTE — the brake is about price again.
  ok(!brakeIsClock(28), "28 DTE: the brake is about price");
  ok(!brakeIsClock(45), "45 DTE: the brake is about price");

  // Monotone: more time is never MORE of a clock.
  let broke = false;
  for (let d = 1; d < 45; d++) if (!brakeIsClock(d) && brakeIsClock(d + 1)) broke = true;
  ok(!broke, "clock risk decreases monotonically with DTE");

  // A longer hold is never less of a clock.
  ok(
    !(brakeIsClock(10, 1) === true && brakeIsClock(10, 8) === false),
    "a longer hold is never less of a clock than a shorter one",
  );
}

// ── 5. The old conflated function is GONE, not deprecated ──────────────────
//
// Leaving it exported would let a future call site take the wrong number with
// no compiler complaint — which is exactly how it reached four call sites.
{
  const files = [];
  (function walk(d) {
    for (const e of readdirSync(join(ROOT, d))) {
      const rel = `${d}/${e}`;
      if (statSync(join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(rel)) files.push(rel);
    }
  })("src");

  const offenders = files.filter((f) =>
    /\brhMaxDebit\b/.test(readFileSync(join(ROOT, f), "utf8")),
  );
  ok(
    offenders.length === 0,
    offenders.length
      ? `rhMaxDebit still referenced in: ${offenders.join(", ")}`
      : "rhMaxDebit is gone from the tree",
  );

  // And sleeve-sizing is genuinely imported now, not named in a comment.
  const desk = readFileSync(join(ROOT, "src/lib/trading/options-desk.ts"), "utf8");
  ok(
    /import\s*\{[^}]*\}\s*from\s*"\.\/sleeve-sizing"/.test(desk),
    "options-desk imports sleeve-sizing rather than citing it",
  );
}

// ── 6. Copy cannot claim the old model ─────────────────────────────────────
{
  const desk = readFileSync(join(ROOT, "src/lib/trading/options-desk.ts"), "utf8");
  ok(!/Size to \$150, not \$1,000/.test(desk), 'the "Size to $150, not $1,000" instruction is gone');
  ok(
    !/\$150 cap/.test(desk),
    "no hardcoded \"$150 cap\" copy survives — the cap is a variable now",
  );
}

// ── 7. SIZE FROM THE LEVEL — the trader's rule, 2026-09-24 ────────────────
//
// "Size from the stop, not from a fixed debit. Exit on the LEVEL — the futures
// plan's invalidation; the percentage is a disaster backstop, not the plan."
//
// The property that makes this worth doing: a TIGHTER invalidation must buy
// MORE contracts at the SAME risk. A fixed debit pays the same dollars to be
// wrong on a 0.55R idea and a 3R one.
{
  const plan = (riskPts) => ({
    symbol: "MNQ",
    side: "long",
    entry: 20000,
    stop: 20000 - riskPts,
    riskPts,
  });
  const base = { delta: 0.5, premiumUsd: 200, dte: 21, riskBudgetUsd: 150 };

  const tight = sizeFromStop({ ...base, plan: plan(20) });
  const wide = sizeFromStop({ ...base, plan: plan(80) });

  ok(tight.contracts > wide.contracts, `tighter stop buys more (${tight.contracts} vs ${wide.contracts})`);
  ok(wide.contracts >= 1, "a wide stop still sizes something");

  // SAME risk, not more. That is the whole claim.
  ok(
    tight.lossAtInvalidationUsd <= 150 + 1e-6,
    `tight loss at invalidation $${tight.lossAtInvalidationUsd} within the $150 budget`,
  );
  ok(
    wide.lossAtInvalidationUsd <= 150 + 1e-6,
    `wide loss at invalidation $${wide.lossAtInvalidationUsd} within the $150 budget`,
  );

  // Monotone across the whole plausible range — no stop distance may ever
  // breach the budget, and more distance may never buy more contracts.
  let prev = Infinity;
  let worstLoss = 0;
  for (let pts = 5; pts <= 400; pts += 5) {
    const r = sizeFromStop({ ...base, plan: plan(pts) });
    if (r.contracts > 0) {
      ok(
        r.contracts <= prev,
        `contracts never increase as the stop widens (${pts}pts: ${r.contracts} after ${prev})`,
      );
      prev = r.contracts;
      worstLoss = Math.max(worstLoss, r.lossAtInvalidationUsd);
    }
  }
  ok(worstLoss <= 150 + 1e-6, `worst loss across the sweep $${worstLoss} <= $150 budget`);

  // The debit ceiling still binds when the geometry would buy more than
  // $1,000 of premium.
  const cheapTight = sizeFromStop({
    ...base,
    premiumUsd: 50,
    plan: plan(5),
  });
  ok(
    cheapTight.debitUsd <= MAX_DEBIT_USD + 1e-6,
    `ceiling still binds: $${cheapTight.debitUsd} <= $${MAX_DEBIT_USD}`,
  );
  if (cheapTight.cappedByDebit) {
    ok(
      cheapTight.lossAtInvalidationUsd < 150,
      "when the ceiling binds, the ticket risks LESS than the budget",
    );
  }

  // One contract too big is a REFUSAL, not a rounded-down one.
  const huge = sizeFromStop({ ...base, delta: 0.9, premiumUsd: 900, plan: plan(600) });
  ok(huge.contracts === 0 && huge.unaffordable, "an unaffordable geometry refuses rather than buying one");
  ok(/TOO BIG/i.test(huge.lines.join(" ")), "and says why in words");
}

// ── 8. The ticket says WHICH method sized it ──────────────────────────────
{
  const src = readFileSync(
    fileURLToPath(new URL("../src/lib/trading/options-desk.ts", import.meta.url)),
    "utf8",
  );
  ok(/sizedFrom: "level"/.test(src), "options-desk can size from the level");
  ok(/sizedFrom: "ceiling"/.test(src), "and still falls back to the ceiling when no plan exists");
  ok(
    /import \{[^}]*sizeFromStop[^}]*\} from "\.\/sleeve-sizing"/.test(src),
    "options-desk imports the level solver rather than reimplementing it",
  );
  // Every toTicket call site must actually pass a plan, or level sizing is
  // dead code behind a default parameter.
  const sites = (src.match(/\? toTicket\(/g) ?? []).length;
  const passes = (src.match(/planForUnderlier\(desk, underlier\)/g) ?? []).length;
  ok(sites > 0, `${sites} toTicket call sites found`);
  ok(
    passes === sites,
    `every call site passes a plan (${passes}/${sites}) — a default null would make level sizing dead code`,
  );
}

console.log(`\nsleeve-migration: ${pass} passed, ${fail} failed`);
if (fails.length) {
  console.log("\nFAILURES:");
  for (const f of fails) console.log("  ✗", f);
}
process.exit(fail ? 1 : 0);
