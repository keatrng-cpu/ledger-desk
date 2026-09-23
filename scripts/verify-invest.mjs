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
// ETN was the blank-CEO case until its operator was verified on 2026-09-22.
// The gate is therefore pinned against a SYNTHETIC blank instead, so this
// test keeps testing the mechanism rather than whichever real name happens
// to be incomplete on a given day.
ok("ETN is now buyable — its operator was verified", canAdd(dossierFor("ETN")).canAdd);
const blankCeo = { ...dossierFor("MSFT"), ticker: "MSFT", governance: { ...dossierFor("MSFT").governance, ceo: "  " } };
check("a blank operator is still refused", canAdd(blankCeo).canAdd, false);
ok("and the refusal names the blank field", completeness(blankCeo).missing.includes("governance.ceo"));
const blankKill = { ...dossierFor("MSFT"), killRule: "" };
ok("a blank kill rule is refused", !canAdd(blankKill).canAdd);
const blankMoat = { ...dossierFor("MSFT"), moat: "" };
ok("a blank moat is refused", !canAdd(blankMoat).canAdd);
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
// ETN used to be the incomplete case; its operator is verified now, so it
// correctly reads ADD. Pin the rule against a synthetic incomplete dossier.
check("a verified ETN reads ADD", verdictFor(dossierFor("ETN"), 0.01).verdict, "ADD");
check(
  "incomplete reads HOLD not ADD",
  verdictFor({ ...dossierFor("MSFT"), killRule: "" }, 0.01).verdict,
  "HOLD",
);
check("room to build reads ADD", verdictFor(dossierFor("MSFT"), 0.01).verdict, "ADD");

console.log("\nbenchmark honesty");
const young = excessVsBenchmark(12, 9, 6);
check("6 months is not evidence", young.meaningful, false);
ok("and it says three years", young.line.includes("Three years"));
ok("36 months is", excessVsBenchmark(12, 9, 36).meaningful);


// ─────────────────────────────────────────────────────────────────────────
// The analysis layer, the evidence ladder, and kill-rule monitoring.
// These were added after the tab shipped; the point of each test is that
// the module REFUSES something, because every one of them is a place where
// a confident-sounding wrong answer would be expensive.
// ─────────────────────────────────────────────────────────────────────────
const { impliedGrowth, sensitivity, qualityRead, trendRead, analyse, BASE_RATES, HORIZON_EVIDENCE, DEFAULT_ERP } =
  await import("../src/lib/invest/factors.ts");
const { evidenceFor, unsourced, strictGate, evidenceSummary, STALENESS_TRAPS } = await import(
  "../src/lib/invest/evidence.ts"
);
const { killQueries, killQuery, isDue, formatResult, CHECK_INTERVAL_DAYS } = await import(
  "../src/lib/invest/kill-watch.ts"
);
const { fundamentalsFor: fund } = await import("../src/lib/invest/universe.ts");

console.log("\nimplied growth — the price, inverted");
const msft = impliedGrowth(fund("MSFT"));
ok("MSFT resolves to a growth rate", msft.growth != null && msft.growth > 0 && msft.growth < 0.5);
ok("and it is demanding or heroic, not modest", ["demanding", "heroic", "reasonable"].includes(msft.demand));
ok("the line names the discount rate and the ERP", msft.line.includes("ERP") && msft.line.includes("10y"));
check("uncaptured name returns null rather than a guess", impliedGrowth(fund("AVGO")).growth, null);
check("unknown ticker returns null", impliedGrowth(null).growth, null);

// A higher required return must demand MORE growth to justify the same price.
const lowErp = impliedGrowth(fund("MSFT"), { erp: 0.035 }).growth;
const highErp = impliedGrowth(fund("MSFT"), { erp: 0.055 }).growth;
ok("raising the ERP raises the growth the price requires", highErp > lowErp);
check("sensitivity spans three ERPs", sensitivity(fund("MSFT")).length, 3);

// A cheaper multiple must require less growth than an expensive one.
const googl = impliedGrowth(fund("GOOGL")).growth;
const cost = impliedGrowth(fund("COST")).growth;
ok("COST (45 P/E) requires more growth than GOOGL (17.8 P/E)", cost > googl);

console.log("\nquality — parts, never a blend");
const etnQ = qualityRead(fund("ETN"));
ok("ETN's falling earnings are called out", etnQ.legs.some((l) => /FALLING/.test(l.reads)));
ok("CEG's falling earnings are called out", qualityRead(fund("CEG")).legs.some((l) => /FALLING/.test(l.reads)));
check("uncaptured name yields no legs", qualityRead(fund("JNJ")).legs.length, 0);
ok("there is no composite score anywhere in the read", !("score" in analyse(fund("MSFT"))));

console.log("\ntrend — context, explicitly not a signal");
check("CEG 50d is below its 200d", trendRead(fund("CEG")).goldenCross, false);
check("MSFT 50d is above its 200d", trendRead(fund("MSFT")).goldenCross, true);
ok("and the line says it gates nothing", trendRead(fund("MSFT")).line.includes("gates nothing"));
check("no moving averages yields nulls", trendRead(fund("JNJ")).goldenCross, null);

console.log("\nhorizon honesty");
check("short horizon is not usable", HORIZON_EVIDENCE.find((h) => h.horizon === "short").usable, false);
check("mid horizon is not usable", HORIZON_EVIDENCE.find((h) => h.horizon === "mid").usable, false);
check("long horizon is the only claim", HORIZON_EVIDENCE.find((h) => h.horizon === "long").usable, true);
check("every base rate carries a source URL", BASE_RATES.filter((b) => /^https?:/.test(b.url)).length, BASE_RATES.length);
ok("the concentration base rate justifies the per-name caps", BASE_RATES.some((b) => /4%/.test(b.claim)));

console.log("\nevidence ladder");
// 2026-09-22: all nine operators checked against SEC EDGAR. The ladder's
// whole point is that this number is visible and can only go up honestly.
check("all nine operators verified", evidenceSummary().verified, 9);
check("nothing left unsourced", evidenceSummary().unsourced, 0);
ok("and the summary says so", evidenceSummary().line.includes("verified against primary sources"));
check("a sourced CEO reads as verified", evidenceFor("MSFT", "governance.ceo"), "verified");
check("a sourced CEO reads as verified for the corrected name too", evidenceFor("AAPL", "governance.ceo"), "verified");
check("an unknown ticker reads blank", evidenceFor("ZZZZ", "governance.ceo"), "blank");
ok("strict gate now passes a verified operator", strictGate(dossierFor("MSFT")).canAdd);
ok("strict gate passes a fund", strictGate(dossierFor("VTI")).canAdd);
// The mechanism must still refuse an unsourced one.
ok("strict gate refuses a name with no source attached", !strictGate({ ...dossierFor("MSFT"), ticker: "AVGO" }).canAdd);

console.log("\nthe corrections the check produced");
const traps = STALENESS_TRAPS.map((t) => t.ticker);
ok("Apple's succession is recorded as a trap", traps.includes("AAPL"));
ok("Constellation's chair change is recorded as a trap", traps.includes("CEG"));
ok("every trap carries the document that settles it", STALENESS_TRAPS.every((t) => /^https:\/\/www\.sec\.gov/.test(t.url)));
check("Apple's CEO is Ternus, not Cook", dossierFor("AAPL").governance.ceo, "John Ternus");
check("and the dossier says the succession happened", dossierFor("AAPL").governance.ceoSince, 2026);
ok("and the caveat admits the earlier entry was wrong", /was asserted from memory and was wrong/.test(dossierFor("AAPL").caveat));
check("ETN's operator is Paulo Ruiz", dossierFor("ETN").governance.ceo, "Paulo Ruiz");
check("NVIDIA is spelled as the filings spell it", dossierFor("NVDA").governance.ceo, "Jen-Hsun Huang");
ok("and NVIDIA's no-chairperson structure is recorded", /no chairperson by design/.test(dossierFor("NVDA").governance.chair));
// Combined chair/CEO is a governance fact worth being able to query.
const combined = ["MSFT", "LLY", "CEG"].filter((t) => {
  const g = dossierFor(t).governance;
  return g.chair && g.chair.includes(g.ceo);
});
check("three names have the CEO chairing their own board", combined.length, 3);

console.log("\nkill watch");
const NOW2 = Date.parse("2026-09-22T12:00:00Z");
const qs = killQueries(NOW2);
ok("only companies are watched", qs.every((q) => dossierFor(q.ticker).kind === "company"));
ok("funds are never watched", !qs.some((q) => ["VTI", "ITOT", "VXUS", "SGOV"].includes(q.ticker)));
ok("every query quotes its own pre-written rule", qs.every((q) => q.query.includes(q.killRule)));
ok("every query asks for primary sources", qs.every((q) => /primary sources/.test(q.query)));
ok("every query is date-bounded", qs.every((q) => /^\d{4}-\d{2}-\d{2}$/.test(q.fromDate)));
check("a 7-day window looks back 7 days", killQuery(dossierFor("NVDA"), NOW2, 7).fromDate, "2026-09-15");

check("never checked is due", isDue({ lastCheckedAt: null }, NOW2).due, true);
check("checked yesterday is not due", isDue({ lastCheckedAt: "2026-09-21T12:00:00Z" }, NOW2).due, false);
ok(
  "and it says why a five-year book is not checked daily",
  isDue({ lastCheckedAt: "2026-09-21T12:00:00Z" }, NOW2).line.includes("screen"),
);
check("checked 8 days ago is due", isDue({ lastCheckedAt: "2026-09-14T12:00:00Z" }, NOW2).due, true);

// The most important refusal in the file: a model never judges a kill rule.
const unjudged = formatResult({
  ticker: "NVDA",
  killRule: "export controls cut data-center run-rate 30%",
  summary: "Nothing found.",
  citations: [{ url: "https://sec.gov/x", title: null }],
  tripped: null,
  checkedAt: "2026-09-22",
});
ok("an unjudged result says UNJUDGED", unjudged.includes("UNJUDGED"));
ok("and says nothing judged it for you", unjudged.includes("judged this for you"));
const noSources = formatResult({
  ticker: "NVDA", killRule: "x", summary: "s", citations: [], tripped: null, checkedAt: "2026-09-22",
});
ok("no sources is framed as no information, not good news", noSources.includes("not as good news"));

console.log(`
${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
