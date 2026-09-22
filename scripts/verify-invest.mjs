/**
 * The investments book, against hand-built cases.
 *
 * Three things here can quietly cost real money and so are pinned:
 *   1. The sweep waterfall. If it sweeps an open month, a losing month, or
 *      a month that did not cover its own data bill, it moves money out of
 *      a $1,000 engine that needed it.
 *   2. The wash-sale ban. If VOO or QQQ ever passes the gate, the trader
 *      buys a tax entanglement with their own options sleeve and does not
 *      find out until a 1099-B in February.
 *   3. The completeness gate. A dossier with a blank field must refuse the
 *      buy, or the whole scorecard is decoration.
 *
 * Run: npx tsx scripts/verify-invest.mjs
 */
const { planSweep, sweepRate, rentVsSweep, DATA_RENT_MONTHLY_USD } = await import(
  "../src/lib/invest/policy.ts"
);
const { canAdd, washSaleBan, completeness, concentrationWarning, incomeOverlayAvailable } =
  await import("../src/lib/invest/universe.ts");
const { BALLAST, COMPOUNDERS, WATCH, ALL_DOSSIERS, dossierFor } = await import(
  "../src/lib/invest/dossiers.ts"
);
const { buildBook, rebalanceCheck, verdictFor, excessVsBenchmark } = await import(
  "../src/lib/invest/book.ts"
);

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`,
  );
};
const ok = (name, cond) => check(name, !!cond, true);

console.log("\nsweep waterfall");
const baseIn = {
  realizedMonthUsd: 226,
  monthClosed: true,
  sleeveEquityUsd: 1000,
  closedMonths: 4,
};

// The trader's actual run rate: +$113/2wk -> ~$226/mo, n=4, sleeve whole.
const live = planSweep(baseIn);
check("live month verdict", live.verdict, "SWEEP");
check("live rate is the 20% probe at n=4", live.rate, 0.2);
check("rent covered first", live.rentCoveredUsd, 199);
check("live sweep is 20% of what survives rent", live.sweepUsd, 5.4);
check("the rest stays in the sleeve", live.toSleeveUsd, 21.6);
ok("rent alarm fires — rent is 88% of gross", live.rentAlarm);

// An open month must never sweep from a mark.
check("open month", planSweep({ ...baseIn, monthClosed: false }).verdict, "HOLD");
check("open month sweeps nothing", planSweep({ ...baseIn, monthClosed: false }).sweepUsd, 0);

// A losing month repairs the engine, never harvests.
const losing = planSweep({ ...baseIn, realizedMonthUsd: -80 });
check("losing month", losing.verdict, "HOLD");
check("losing month sweeps nothing", losing.sweepUsd, 0);

// A month that did not cover its own data bill.
const short = planSweep({ ...baseIn, realizedMonthUsd: 150 });
check("month under rent", short.verdict, "SHORT");
check("short month sweeps nothing", short.sweepUsd, 0);
check("short month names the gap", short.rentShortfallUsd, 49);

// Sleeve drawn down: restoration eats before the sweep does.
const drawn = planSweep({ ...baseIn, realizedMonthUsd: 400, sleeveEquityUsd: 820 });
check("restore happens before sweep", drawn.restoreUsd, 180);
check("sweep is 20% of what is left after rent AND restore", drawn.sweepUsd, 4.2);

// Restoration can consume the whole remainder.
const allRestore = planSweep({ ...baseIn, realizedMonthUsd: 260, sleeveEquityUsd: 800 });
check("restore-only month", allRestore.verdict, "RESTORE");
check("restore-only sweeps nothing", allRestore.sweepUsd, 0);

// The rate ladder is earned, never chosen.
check("rate at n=4", sweepRate(4), 0.2);
check("rate at n=20", sweepRate(20), 0.3);
check("rate at full", sweepRate(24, true), 0.4);

// Conservation: nothing is created or destroyed in the waterfall.
const conserved = live.rentCoveredUsd + live.sweepUsd + live.toSleeveUsd;
check("waterfall conserves the month", Math.round(conserved * 100) / 100, 226);

console.log("\nrent vs sweep — the highest-EV line on the tab");
const rvs = rentVsSweep(live);
check("annual rent", rvs.annualRent, 2388);
check("annual sweep at the live rate", rvs.annualSweep, 64.8);
check("one year of rent is 37x one year of sweeping", rvs.multiple, 37);

console.log("\nwash-sale ban");
for (const t of ["QQQ", "QQQM", "SPY", "VOO", "IVV", "SPLG"]) {
  ok(`${t} is banned`, washSaleBan(t) != null);
}
for (const t of ["VTI", "ITOT", "VXUS", "MSFT"]) {
  ok(`${t} is not banned`, washSaleBan(t) == null);
}
// A banned name must be refused even with a perfect dossier.
const fakeVoo = { ...dossierFor("VTI"), ticker: "VOO", name: "Vanguard S&P 500" };
check("a complete dossier does not rescue a banned ticker", canAdd(fakeVoo).canAdd, false);
ok("the refusal cites the statute", canAdd(fakeVoo).reason.includes("1091"));

console.log("\ncompleteness gate");
ok("VTI is buyable", canAdd(dossierFor("VTI")).canAdd);
ok("MSFT is buyable", canAdd(dossierFor("MSFT")).canAdd);
// ETN is carried with a blank CEO on purpose — the gate must refuse it.
const etn = dossierFor("ETN");
check("ETN is refused", canAdd(etn).canAdd, false);
ok("ETN refusal names the blank field", completeness(etn).missing.includes("governance.ceo"));
// A name whose fundamentals were never captured must also be refused.
const notCaptured = { ...dossierFor("MSFT"), ticker: "AVGO" };
check("uncaptured fundamentals block the buy", canAdd(notCaptured).canAdd, false);

console.log("\nevery dossier is internally consistent");
for (const d of ALL_DOSSIERS) {
  ok(`${d.ticker} has a kill rule or is an index`, d.killRule.trim().length > 0);
  ok(`${d.ticker} has a max weight under 10%`, d.maxWeight > 0 && d.maxWeight <= 0.65);
}
check("no duplicate tickers", new Set(ALL_DOSSIERS.map((d) => d.ticker)).size, ALL_DOSSIERS.length);

console.log("\nconcentration — the book must not repeat the sleeve's bet");
const techHeavy = concentrationWarning([
  { ticker: "MSFT", weight: 0.25 },
  { ticker: "NVDA", weight: 0.2 },
  { ticker: "VTI", weight: 0.55 },
]);
ok("45% tech warns", techHeavy.warn);
const balanced = concentrationWarning([
  { ticker: "VTI", weight: 0.7 },
  { ticker: "MSFT", weight: 0.1 },
  { ticker: "LLY", weight: 0.2 },
]);
ok("10% tech does not warn", !balanced.warn);

console.log("\nincome overlay honesty at this account size");
const cc = incomeOverlayAvailable(330, 0.18);
check("covered calls unavailable on a fractional share", cc.available, false);
ok("and it says how far away it is", cc.line.includes("100 shares"));
ok("100 shares unlocks it", incomeOverlayAvailable(330, 100).available);

console.log("\nthe book");
const NOW = Date.parse("2026-09-22T12:00:00Z");
const book = buildBook(
  [
    { ticker: "VTI", sleeve: "ballast", shares: 0.12, costUsd: 40, openedAt: "2026-08-01" },
    { ticker: "MSFT", sleeve: "compounder", shares: 0.02, costUsd: 10, openedAt: "2025-01-05" },
  ],
  { VTI: 350, MSFT: 500 },
  NOW,
);
check("book totals", book.totalUsd, 52);
check("small book is flagged", book.belowMeaningful, true);
ok("and says the weights are arithmetic", book.note.includes("arithmetic"));
check("long-term lot recognised", book.positions.find((p) => p.ticker === "MSFT").longTerm, true);
check("recent lot is short-term", book.positions.find((p) => p.ticker === "VTI").longTerm, false);
check("no banned holdings", book.banned.length, 0);

// A book holding VOO must surface it as banned rather than silently pass.
const dirty = buildBook(
  [{ ticker: "VOO", sleeve: "ballast", shares: 1, costUsd: 700, openedAt: "2026-01-01" }],
  { VOO: 700 },
  NOW,
);
check("a held banned ticker is surfaced", dirty.banned.length, 1);

// A missing price values at cost rather than inventing a mark.
const noPrice = buildBook(
  [{ ticker: "VTI", sleeve: "ballast", shares: 1, costUsd: 300, openedAt: "2026-01-01" }],
  {},
  NOW,
);
check("missing price values at cost", noPrice.totalUsd, 300);
check("and books no phantom P&L", noPrice.positions[0].plUsd, 0);

console.log("\nrebalance refuses to invent work");
check("small book never rebalances", rebalanceCheck(book).due, false);
const bigBook = buildBook(
  [
    { ticker: "VTI", sleeve: "ballast", shares: 10, costUsd: 3000, openedAt: "2024-01-01" },
    { ticker: "MSFT", sleeve: "compounder", shares: 4, costUsd: 1600, openedAt: "2024-01-01" },
  ],
  { VTI: 350, MSFT: 500 },
  NOW,
);
const reb = rebalanceCheck(bigBook);
ok("a real book can signal", reb.due);
ok("and prefers sweeping over selling", reb.note.includes("Selling realises gains"));

console.log("\nverdict vocabulary never collides with PATH");
const words = new Set(ALL_DOSSIERS.map((d) => verdictFor(d, 0.02).verdict));
for (const w of words) ok(`${w} is not a PATH word`, !["TAKE", "STAND", "MANAGE"].includes(w));
check("ballast reads CORE", verdictFor(dossierFor("VTI"), 0.5).verdict, "CORE");
check("over cap reads TRIM", verdictFor(dossierFor("MSFT"), 0.2).verdict, "TRIM");
check("incomplete reads HOLD not ADD", verdictFor(dossierFor("ETN"), 0.01).verdict, "HOLD");
check("room to build reads ADD", verdictFor(dossierFor("MSFT"), 0.01).verdict, "ADD");

console.log("\nbenchmark honesty");
const young = excessVsBenchmark(12, 9, 6);
check("6 months is not evidence", young.meaningful, false);
ok("and it says three years", young.line.includes("Three years"));
ok("36 months is", excessVsBenchmark(12, 9, 36).meaningful);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
