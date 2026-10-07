/**
 * The month ticket. Size stays until nine closes clear. A win does not raise it.
 * Run: npx tsx scripts/verify-month-contract.mjs
 */
import assert from "node:assert/strict";

const { ticketForEquity, monthDollars, nextContracts, monthContractLine, winRateFor } = await import(
  "../src/lib/trading/month-contract.ts"
);

const two = ticketForEquity(2000);
assert.equal(two.contracts, 4);
assert.equal(two.debit, 600);
assert.equal(two.stop, 180);
assert.equal(two.winner, 600);
assert.ok(Math.abs(two.ratio - 600 / 180) < 1e-9);
assert.ok(two.winRateFor3k > 0.6 && two.winRateFor3k < 0.7);

const small = ticketForEquity(996);
assert.equal(small.contracts, 3);
assert.equal(small.debit, 450);

assert.equal(Math.round(monthDollars(0.4, two)), 1188);

const early = nextContracts(2000, [{ win: true, dollars: 600 }]);
assert.equal(early.cleared, false);
assert.equal(early.contracts, 4);

const good = Array.from({ length: 9 }, (_, i) => ({ win: i < 6, dollars: i < 6 ? 600 : 180 }));
const up = nextContracts(2000, good);
assert.equal(up.cleared, true);
assert.equal(up.contracts, 5);

const bad = Array.from({ length: 9 }, (_, i) => ({ win: i < 3, dollars: i < 3 ? 600 : 180 }));
const stay = nextContracts(2000, bad);
assert.equal(stay.cleared, false);
assert.equal(stay.contracts, 4);

assert.ok(monthContractLine(2000).includes("not on a win"));
assert.ok(winRateFor(3000, 600, 180) > 0.65);
console.log("month-contract ok", two.contracts, two.debit, Math.round(two.winRateFor3k * 100));
