/**
 * The share book's ledger, look-through and habit — against hand-built cases.
 *
 * verify-invest.mjs pins the sweep waterfall, the ban and the dossier gate.
 * This pins what was added on 2026-09-26, each of which can quietly cost
 * money or tell the trader something false:
 *   1. LOTS. Every buy is its own tax lot. The v1 store merged buys and kept
 *      the earliest date, which called a month-old top-up long-term.
 *   2. FIFO + holding period. A sale on the anniversary is still short-term.
 *   3. WASH SALES inside the book, both directions, the VTI/ITOT twin, and
 *      shares already sold never counting as replacements.
 *   4. The month gate: a month that has not ended cannot be logged.
 *   5. The 40% rate is reachable, and a loss or a gap takes it back.
 *   6. LOOK-THROUGH: an all-VTI book overlaps QQQ by ~48% — the number the
 *      old direct-only concentration line printed as 0%.
 *   7. Verdicts read the book: effective weight vs the cap, the ballast
 *      twin, a HUMAN tripped judgement, and no TRIM below $500.
 *   8. The RH journal bridge: closed trades only, and the ban follows what
 *      the sleeve actually traded.
 *
 * Run: npx tsx scripts/verify-invest-book.mjs
 */
import { readFileSync } from "node:fs";

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);
const r2 = (n) => Math.round(n * 100) / 100;
const r4 = (n) => Math.round(n * 10_000) / 10_000;

// A browser, as far as store.ts can tell. Installed BEFORE the store loads.
const mem = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
  dispatchEvent() {},
  addEventListener() {},
  removeEventListener() {},
};

const L = await import("../src/lib/invest/ledger.ts");
const P = await import("../src/lib/invest/policy.ts");
const E = await import("../src/lib/invest/exposure.ts");
const Bk = await import("../src/lib/invest/book.ts");
const D = await import("../src/lib/invest/dossiers.ts");
const U = await import("../src/lib/invest/universe.ts");
const F = await import("../src/lib/invest/factors.ts");
const R = await import("../src/lib/invest/rh-bridge.ts");
const M = await import("../src/lib/invest/marks.ts");

const B = (id, date, ticker, shares, cost, extra = {}) => ({
  id,
  kind: "buy",
  date,
  loggedAt: `${date}T15:00:00.000Z`,
  ticker,
  sleeve: "ballast",
  shares,
  costUsd: cost,
  source: "sweep",
  ...extra,
});
const S = (id, date, ticker, shares, proceeds) => ({
  id,
  kind: "sell",
  date,
  loggedAt: `${date}T16:00:00.000Z`,
  ticker,
  shares,
  proceedsUsd: proceeds,
});

console.log("\nholding period — per lot, more than one year");
check("anniversary", L.anniversary("2025-03-10"), "2026-03-10");
check("a leap-day buy's anniversary clamps to Feb 28", L.anniversary("2024-02-29"), "2025-02-28");
check("sold ON the anniversary is still short-term", L.isLongTerm("2025-03-10", "2026-03-10"), false);
check("the day after is long-term", L.isLongTerm("2025-03-10", "2026-03-11"), true);
check("first long-term day", L.longTermFrom("2025-03-10"), "2026-03-11");

console.log("\nlots never merge (the v1 bug)");
const two = L.replay([B("b1", "2025-01-10", "VTI", 1, 100), B("b2", "2026-01-10", "VTI", 1, 120)]);
check("two buys are two lots", two.lots.length, 2);
const hp = L.heldPositions(two, "2026-02-01");
check("one position on the screen", hp.length, 1);
check("but only the first lot is long-term", hp[0].longTermShares, 1);
check("and the second turns long-term on its own date", hp[0].nextLongTerm, "2027-01-11");

console.log("\nFIFO relief");
const fifo = L.replay([B("b1", "2025-01-10", "VTI", 1, 100), B("b2", "2026-01-10", "VTI", 1, 120), S("s1", "2026-02-01", "VTI", 1.5, 190)]);
const sale = fifo.sales[0];
check("the oldest lot goes first", sale.relief[0].lotId, "b1");
check("then half of the next", r4(sale.relief[1].shares), 0.5);
check("cost relieved = 100 + 60", sale.costUsd, 160);
check("gain", sale.gainUsd, 30);
check("the long-term part", sale.ltGainUsd, 26.67);
check("the short-term part", sale.stGainUsd, 3.33);
const left = L.heldPositions(fifo, "2026-02-02")[0];
check("half a share left", r4(left.shares), 0.5);
check("carrying the second lot's remaining cost", left.costUsd, 60);
check("sweep-funded dollars are the lots' original cost", L.sweepFundedUsd(fifo), 220);

console.log("\nno selling what is not held");
const over = L.replay([B("b1", "2025-01-10", "VTI", 1, 100), S("s1", "2025-02-01", "VTI", 2, 200)]);
check("an oversell is not applied", over.sales.length, 0);
ok("and is reported, not skipped silently", over.problems.some((p) => /exceeds/.test(p)));
check("the preview refuses it before it is written", L.previewSale(two, { ticker: "VTI", shares: 5, proceedsUsd: 500, date: "2026-02-01" }).ok, false);
check("a preview of a real sale passes", L.previewSale(two, { ticker: "VTI", shares: 1, proceedsUsd: 130, date: "2026-02-01" }).ok, true);

console.log("\nwash sales inside the book");
const w1 = L.replay([B("b1", "2026-01-02", "VTI", 1, 100), B("b2", "2026-03-01", "VTI", 0.1, 9), S("s1", "2026-03-10", "VTI", 1, 90)]);
ok("a loss sale 9 days after a still-held buy is flagged", w1.sales[0].wash != null);
check("the deferred loss is pro rata by shares", w1.sales[0].wash?.disallowedEstUsd, 1);
const w2 = L.replay([B("b1", "2026-01-02", "VTI", 1, 100), S("s1", "2026-03-10", "VTI", 1, 90), B("b3", "2026-03-30", "VTI", 1, 92)]);
ok("a buy 20 days AFTER a loss sale washes it", w2.sales[0].wash != null);
check("a full replacement defers the whole loss", w2.sales[0].wash?.disallowedEstUsd, 10);
const w3 = L.replay([B("b1", "2026-01-02", "VTI", 1, 100), S("s1", "2026-03-10", "VTI", 1, 90), B("b4", "2026-03-20", "ITOT", 1, 95)]);
ok("buying the twin (ITOT) after a VTI loss is flagged", w3.sales[0].wash?.replacementTickers.includes("ITOT"));
const w4 = L.replay([B("b1", "2026-01-02", "VTI", 1, 100), S("s1", "2026-03-10", "VTI", 1, 110), B("b3", "2026-03-20", "VTI", 1, 112)]);
check("a gain is never a wash sale", w4.sales[0].wash, null);
const w5 = L.replay([B("b1", "2026-01-02", "VTI", 1, 100), S("s1", "2026-03-10", "VTI", 1, 90), B("b3", "2026-04-10", "VTI", 1, 92)]);
check("31 days later is outside the window", w5.sales[0].wash, null);
const w6 = L.replay([
  B("b1", "2026-02-20", "VTI", 1, 100),
  B("b2", "2026-02-25", "VTI", 1, 100),
  S("s0", "2026-02-26", "VTI", 1, 101),
  S("s1", "2026-03-10", "VTI", 1, 90),
]);
check("shares already sold are not replacements", w6.sales[1].wash, null);
// Rev. Rul. 56-602: part of a block sold at a loss is not washed by the rest of it.
const w7 = L.replay([B("b1", "2026-03-01", "VTI", 1, 100), S("s1", "2026-03-10", "VTI", 0.5, 45)]);
check("selling part of one recent lot at a loss is not a wash (Rev. Rul. 56-602)", w7.sales[0].wash, null);
// …but a different lot bought inside the window is an acquisition.
const w8 = L.replay([B("b0", "2025-06-01", "VTI", 1, 100), B("b1", "2026-03-01", "VTI", 1, 95), S("s1", "2026-03-10", "VTI", 1, 90)]);
ok("an older lot sold at a loss after a new buy IS washed by the new lot", w8.sales[0].wash?.replacementIds.includes("b1"));
ok("a buy inside the window after a loss sale warns first", L.buyWashWarning(w5, "VTI", "2026-03-25") != null);
check("a buy after the window does not", L.buyWashWarning(w5, "VTI", "2026-04-15"), null);
ok("the twin warns too", L.buyWashWarning(w5, "ITOT", "2026-03-25") != null);
check("an unrelated fund does not", L.buyWashWarning(w5, "VXUS", "2026-03-25"), null);

console.log("\nvoids and duplicates");
const v = L.replay([B("b1", "2026-01-02", "VTI", 1, 100), { id: "v1", kind: "void", date: "2026-01-03", loggedAt: "2026-01-03T00:00:00Z", targetId: "b1", reason: "typo" }]);
check("a voided buy is not a lot", v.lots.length, 0);
ok("and the void stays on the record", v.voided.has("b1"));
const sw = (id, month, realized) => ({ id, kind: "sweep", date: `${month}-01`, loggedAt: `${month}-02T00:00:00Z`, month, verdict: "SWEEP", realizedUsd: realized, rentUsd: 199, restoreUsd: 0, sweptUsd: 5.4, rate: 0.2 });
const dup = L.replay([sw("sweep:2026-08", "2026-08", 226), sw("sweep:2026-08:r1", "2026-08", 300)]);
check("a month logged twice keeps the first", dup.sweeps.length, 1);
ok("and says so", dup.problems.some((p) => /logged twice/.test(p)));

console.log("\ntax year");
const ty = L.taxYear(fifo, 2026);
check("short-term", ty.stGainUsd, 3.33);
check("long-term", ty.ltGainUsd, 26.67);
ok("an empty year says what a never-selling book owes", /never sells/.test(L.taxYear(two, 2024).line));

console.log("\nthe store — migration, the month gate, void + relog, backup");
mem.set("ledger.invest.positions.v1", JSON.stringify([{ ticker: "VTI", sleeve: "ballast", shares: 0.5, costUsd: 150, openedAt: "2026-09-10T14:00:00.000Z" }]));
mem.set("ledger.invest.sweeps.v1", JSON.stringify([{ month: "2026-08", verdict: "SWEEP", realizedUsd: 226, rentUsd: 199, restoreUsd: 0, sweptUsd: 5.4, rate: 0.2, loggedAt: "2026-09-02T00:00:00.000Z", note: "x" }]));
const store = await import("../src/lib/invest/store.ts");
const led = store.loadLedger();
check("a v1 position migrates to one lot", led.lots.length, 1);
ok("flagged as migrated", led.lots[0].migrated);
check("a v1 month migrates", led.sweeps.length, 1);
check("under the deterministic id", led.sweeps[0].id, "sweep:2026-08");
ok("the v1 keys are left untouched", mem.has("ledger.invest.positions.v1") && mem.has("ledger.invest.sweeps.v1"));
const rec = (month, realized, swept) => ({ month, verdict: "SWEEP", realizedUsd: realized, rentUsd: 199, restoreUsd: 0, sweptUsd: swept, rate: 0.2, loggedAt: new Date().toISOString(), note: "" });
check("the current month cannot be logged", store.logSweep(rec(store.etMonth(), 300, 20)).logged, false);
check("nor a future one", store.logSweep(rec("2099-01", 300, 20)).logged, false);
check("nor one already logged", store.logSweep(rec("2026-08", 300, 20)).logged, false);
check("a closed month logs", store.logSweep(rec("2026-07", 250, 10.2)).logged, true);
check("a month can be voided with a reason", store.voidEntry("sweep:2026-07", "realized was wrong").ok, true);
check("but not without one", store.voidEntry("sweep:2026-08", "no").ok, false);
check("the voided month can be logged again", store.logSweep(rec("2026-07", 260, 12.2)).logged, true);
ok("under a new id — history is not edited", store.loadLedger().sweeps.some((s) => s.id === "sweep:2026-07:r1"));
check("a buy writes a lot", store.recordBuy({ ticker: "VTI", sleeve: "ballast", shares: 0.02, costUsd: 6, date: "2026-09-20", source: "sweep" }).ok, true);
check("an oversell is refused at the store", store.recordSell({ ticker: "VTI", shares: 5, proceedsUsd: 1500, date: "2026-09-25" }).ok, false);
check("a reinvested dividend writes the dividend AND a lot", store.recordDividend({ ticker: "VTI", amountUsd: 1.2, date: "2026-09-24", reinvested: true, shares: 0.004 }).ok, true);
check("the lot is tagged as a dividend buy", store.loadLedger().lots.filter((l) => l.source === "dividend").length, 1);
const exported = store.exportLedger();
const n = store.loadEntries().length;
const again = store.importLedger(exported);
check("re-importing the same export adds nothing", again.added, 0);
check("and skips every entry", again.skipped, n);
check("a file that is not a ledger is refused", store.importLedger('{"kind":"nope"}').ok, false);
check("malformed rows are counted, not repaired", store.importLedger(JSON.stringify({ kind: "invest-ledger", entries: [{ id: "x" }] })).refused, 1);
ok("a negative buy is not an entry", !store.isEntry({ id: "bad-1", kind: "buy", date: "2026-01-01", loggedAt: "x", ticker: "VTI", sleeve: "ballast", shares: -1, costUsd: 5, source: "sweep" }));
ok("a reasonless void is not an entry", !store.isEntry({ id: "void-1", kind: "void", date: "2026-01-01", loggedAt: "x", targetId: "b1", reason: "" }));
check("positions still read through the old surface", store.loadPositions()[0]?.ticker, "VTI");

console.log("\nthe month gate, the rate ladder, the inverse waterfall");
check("a closed month is valid", P.validateSweepMonth("2026-08", "2026-09").ok, true);
check("the current month is not", P.validateSweepMonth("2026-09", "2026-09").ok, false);
check("a future month is not", P.validateSweepMonth("2026-10", "2026-09").ok, false);
check("month 13 is not", P.validateSweepMonth("2026-13", "2026-09").ok, false);
const mk = (month, r) => ({ month, realizedUsd: r, verdict: "SWEEP", sweptUsd: 5, loggedAt: `${month}-28T00:00:00Z` });
const months = [];
for (let i = 0; i < 20; i++) {
  const d = new Date(Date.UTC(2024, 11 + i, 1));
  months.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
}
const clean = months.map((m) => mk(m, 250));
check("20 months, the last 12 clean and consecutive, earn 40%", P.fullRateFromLog(clean).earned, true);
check("the ladder reads 40%", P.rateLadder(clean).rate, 0.4);
const lossy = clean.map((r, i) => (i === 15 ? { ...r, realizedUsd: -50 } : r));
check("a losing month inside the last 12 takes it back", P.fullRateFromLog(lossy).earned, false);
check("the ladder drops to 30%", P.rateLadder(lossy).rate, 0.3);
check("the streak counts back to the loss", P.fullRateFromLog(lossy).cleanStreak, 4);
check("a skipped month breaks the streak too", P.fullRateFromLog(clean.filter((_, i) => i !== 17)).earned, false);
check("12 clean months alone stay at the 20% probe", P.rateLadder(clean.slice(-12)).rate, 0.2);
check("$25 swept at 20% needs $324 realized", P.realizedNeededFor(25, 0.2), 324);
check("with a $100 restore, $424", P.realizedNeededFor(25, 0.2, 100), 424);
check("and the forward waterfall agrees", P.planSweep({ realizedMonthUsd: 324, monthClosed: true, sleeveEquityUsd: 1000, closedMonths: 4 }).sweepUsd, 25);
check("contributions only — no return assumed", P.contributionPath(5.4, 10).totalUsd, 648);
check("skipped months are named", P.missedMonths([mk("2026-05", 1), mk("2026-08", 1)], "2026-09"), ["2026-06", "2026-07"]);
const q = P.deployQueue([{ sweptUsd: 10, loggedAt: "2026-09-02T00:00:00Z" }, { sweptUsd: 5.4, loggedAt: "2026-08-02T00:00:00Z" }], 6, Date.parse("2026-09-03T00:00:00Z"));
check("waiting = swept − deployed", q.waitingUsd, 9.4);
check("parked 3 days after the newest sweep", q.parkedUntil, "2026-09-05");
ok("buys tagged 'sweep' beyond the sweep are called out", /exceed/.test(P.deployQueue([{ sweptUsd: 5, loggedAt: "2026-09-02T00:00:00Z" }], 8, Date.parse("2026-09-10T00:00:00Z")).line));
check("rent is one number across the desk", P.DATA_RENT_MONTHLY_USD, 199);

console.log("\nlook-through — what the book actually owns");
const prev = E.lookThrough([]);
ok("an empty book previews the landing pad", prev.preview);
check("VTI overlaps QQQ by 47.8% of its weight", Math.round(prev.overlapQQQ * 1000) / 1000, 0.478);
check("VTI is 42.9% tech + communication", Math.round(prev.techWeight * 1000) / 1000, 0.429);
ok("and that is loud enough to say", prev.warn);
const sgov = E.lookThrough([{ ticker: "SGOV", valueUsd: 100 }]);
check("T-bills overlap nothing", sgov.overlapQQQ, 0);
check("T-bills are no tech", sgov.techWeight, 0);
const vx = E.lookThrough([{ ticker: "VXUS", valueUsd: 100 }]);
check("VXUS's sector split is UNKNOWN in this source, not zero", vx.sectorUnknown, 1);
ok("and its overlap is flagged as reading low", vx.overlapPartial);
const mix = E.lookThrough([{ ticker: "VTI", valueUsd: 50 }, { ticker: "MSFT", valueUsd: 50 }]);
const msftEff = E.effectiveWeight(mix, "MSFT");
check("MSFT direct is half the book", msftEff.direct, 0.5);
check("plus half of VTI's MSFT", r4(msftEff.viaFunds), 0.0239);
check("VTI holds 6.4% NVDA", E.weightInFund("VTI", "NVDA"), 0.064);
check("a name VTI does not list reads 0", E.weightInFund("VTI", "ZZZZ"), 0);
const vtiP = E.fundProfile("VTI");
const qqqP = E.fundProfile("QQQ");
const vw = new Map(vtiP.holdings);
check(
  "the stored VTI rows reproduce the full-list QQQ overlap",
  r4(qqqP.holdings.reduce((s, [t, w]) => s + Math.min(vw.get(t) ?? 0, w), 0)),
  vtiP.overlapQQQ,
);
const qsum = qqqP.holdings.reduce((s, [, w]) => s + w, 0);
ok("QQQ's named rows sum to ~1 (no transcription slip)", qsum > 0.98 && qsum < 1.01);
ok("fees are priced", E.lookThrough([{ ticker: "VTI", valueUsd: 10_000 }]).feeUsdYear === 3);

console.log("\nverdicts read the book");
const allVti = E.lookThrough([{ ticker: "VTI", valueUsd: 1000 }]);
const msftV = Bk.verdictFor(D.dossierFor("MSFT"), 0, { held: new Set(["VTI"]), effective: E.effectiveWeight(allVti, "MSFT") });
check("MSFT with 0 direct but 4.8% inside VTI reads HOLD, not ADD", msftV.verdict, "HOLD");
ok("and says the funds already hold it", /inside your funds/.test(msftV.why));
const halfVti = E.lookThrough([{ ticker: "VTI", valueUsd: 500 }, { ticker: "SGOV", valueUsd: 500 }]);
check("at half VTI there is room: ADD", Bk.verdictFor(D.dossierFor("MSFT"), 0, { held: new Set(["VTI", "SGOV"]), effective: E.effectiveWeight(halfVti, "MSFT") }).verdict, "ADD");
check("ITOT while holding VTI reads HOLD — pick one", Bk.verdictFor(D.dossierFor("ITOT"), 0, { held: new Set(["VTI"]) }).verdict, "HOLD");
check("VTI at 90% of a real book is over its 65% cap", Bk.verdictFor(D.dossierFor("VTI"), 0.9, { held: new Set(["VTI"]) }).verdict, "TRIM");
check("but below $500 it stays CORE — weights are arithmetic there", Bk.verdictFor(D.dossierFor("VTI"), 0.9, { held: new Set(["VTI"]), belowMeaningful: true }).verdict, "CORE");
check("a human TRIPPED judgement makes it OUT", Bk.verdictFor(D.dossierFor("MSFT"), 0.02, { tripped: { judgedAt: "2026-09-26T00:00:00Z", note: "Azure under 10% four quarters" } }).verdict, "OUT");
check("a ban still beats everything", Bk.verdictFor({ ...D.dossierFor("VTI"), ticker: "VOO" }, 0).verdict, "OUT");

console.log("\nnext buy, benchmark, dry powder");
const small = Bk.buildBook([{ ticker: "VTI", sleeve: "ballast", shares: 0.1, costUsd: 30, openedAt: "2026-09-01" }], {}, Date.parse("2026-09-26"));
check("below $500 the next buy is VTI", Bk.nextBuy(small, 12, new Set(["VTI"])).ticker, "VTI");
check("if ITOT is the held fund, keep buying ITOT", Bk.nextBuy(small, 12, new Set(["ITOT"])).ticker, "ITOT");
check("nothing waiting, nothing to buy", Bk.nextBuy(small, 0, new Set()).ticker, null);
const big = Bk.buildBook(
  [
    { ticker: "VTI", sleeve: "ballast", shares: 3, costUsd: 900, openedAt: "2026-01-01" },
    { ticker: "MSFT", sleeve: "compounder", shares: 0.5, costUsd: 200, openedAt: "2026-01-01" },
  ],
  {},
  Date.parse("2026-09-26"),
);
check("above $500 the lightest sleeve gets it — dry powder → SGOV", Bk.nextBuy(big, 50, new Set(["VTI", "MSFT"])).ticker, "SGOV");
const noComp = Bk.buildBook(
  [
    { ticker: "VTI", sleeve: "ballast", shares: 3, costUsd: 900, openedAt: "2026-01-01" },
    { ticker: "SGOV", sleeve: "drypowder", shares: 2, costUsd: 200, openedAt: "2026-01-01" },
  ],
  {},
  Date.parse("2026-09-26"),
);
check("and when it is the compounder sleeve, the tab never picks a company", Bk.nextBuy(noComp, 50, new Set(["VTI", "SGOV"])).ticker, null);
const closesMap = new Map([
  ["2026-01-02", 300],
  ["2026-03-02", 280],
  ["2026-09-25", 330],
]);
const lotsX = [
  { date: "2026-01-02", costOrigUsd: 300, sharesOpen: 1, sharesOrig: 1, ticker: "MSFT" },
  { date: "2026-03-03", costOrigUsd: 280, sharesOpen: 1, sharesOrig: 1, ticker: "MSFT" },
];
const sh = Bk.shadowBenchmark(lotsX, 600, 0, closesMap, 330, "2026-09-26");
check("same dollars, same days, into VTI", sh.benchmarkValueUsd, 660);
check("excess is the book minus the shadow", sh.excessUsd, -60);
ok("under 36 months it says it means nothing", /too short/.test(sh.line));
check("a lot before any close counts at cost on both sides", Bk.shadowBenchmark([{ date: "2025-01-01", costOrigUsd: 50, sharesOpen: 1, sharesOrig: 1, ticker: "X" }], 50, 0, closesMap, 330, "2026-09-26").unpriced, 1);
const series = Array.from({ length: 60 }, (_, i) => ({ date: `2026-06-${String((i % 28) + 1).padStart(2, "0")}`, close: 100 }));
check("a 26% fall arms the dry powder", Bk.dryPowderTrigger([...series, { date: "2026-09-01", close: 74 }]).armed, true);
check("a 10% fall does not", Bk.dryPowderTrigger([...series, { date: "2026-09-01", close: 90 }]).armed, false);
check("no closes, no read", Bk.dryPowderTrigger([]).drawdown, null);

console.log("\nfactors — earnings yield, forward inversion, the trend fix");
const eyM = F.earningsYield(U.fundamentalsFor("MSFT"));
check("MSFT forward earnings yield = 1 / forward P/E", r4(eyM.forward), r4(1 / 24.94));
check("spread vs the captured ten-year", r2(eyM.spreadPts), r2(100 / 24.94 - D.RISK_FREE.yieldPct));
ok("a negative spread says LESS than Treasuries", /LESS/.test(eyM.line));
const gT = F.impliedGrowth(U.fundamentalsFor("GOOGL")).growth;
const gF = F.impliedGrowth(U.fundamentalsFor("GOOGL"), { basis: "forward" }).growth;
ok("GOOGL: forward earnings are lower, so the forward inversion requires MORE growth", gF > gT);
const tNo = F.trendRead(U.fundamentalsFor("MSFT"));
check("without a close, price-vs-200d is unknown (was: the golden-cross flag)", tNo.above200, null);
check("and the range position says it is the 50-day average", tNo.rangeFrom, "ma50");
const tClose = F.trendRead(U.fundamentalsFor("MSFT"), 400);
check("with a close under the 200-day it says so", tClose.above200, false);
check("and reads the range from the close", tClose.rangeFrom, "close");
check("the ten-year is the captured 5.18%", D.RISK_FREE.yieldPct, 5.18);

console.log("\nthe RH journal bridge");
const fills = [
  { id: "a", openedAt: "2026-08-03T14:00:00Z", closedAt: "2026-08-04T15:00:00Z", underlier: "QQQ", side: "call", debit: 400, exit: 520, pnl: 120, note: "" },
  { id: "b", openedAt: "2026-08-10T14:00:00Z", closedAt: "2026-08-10T19:00:00Z", underlier: "SPY", side: "put", debit: 300, exit: 240, pnl: -60, note: "" },
  { id: "c", openedAt: "2026-08-28T14:00:00Z", underlier: "QQQ", side: "call", debit: 500, note: "" },
  { id: "d", openedAt: "2026-09-01T14:00:00Z", closedAt: "2026-09-02T15:00:00Z", underlier: "IWM", side: "call", debit: 200, exit: 260, pnl: 60, note: "" },
];
const aug = R.rhMonthFrom(fills, "2026-08");
check("August realized = closed trades only", aug.realizedUsd, 60);
check("two closed", aug.closedCount, 2);
check("the open position is counted, never swept", aug.openCount, 1);
check("its premium is reported as not-cash", aug.openDebitUsd, 500);
const now = Date.parse("2026-09-20T00:00:00Z");
ok("QQQ stays banned from the static list", R.banReasonFrom(fills, "QQQ", now) != null);
ok("IWM, traded 18 days ago, is banned too", /RH journal shows IWM/.test(R.banReasonFrom(fills, "IWM", now) ?? ""));
check("VTI is not banned", R.banReasonFrom(fills, "VTI", now), null);
check("once the 61-day window passes, IWM is clear", R.banReasonFrom(fills, "IWM", Date.parse("2026-11-15T00:00:00Z")), null);

console.log("\nmarks — the Yahoo parser");
const t1 = Date.UTC(2026, 8, 23, 13, 30) / 1000;
const t2 = Date.UTC(2026, 8, 24, 13, 30) / 1000;
const t3 = Date.UTC(2026, 8, 25, 13, 30) / 1000;
const chart = {
  chart: {
    result: [
      {
        meta: { regularMarketPrice: 331.2, regularMarketTime: t3 + 23_400, gmtoffset: -14_400 },
        timestamp: [t1, t2, t3, t3 + 3_600],
        indicators: { quote: [{ close: [320.1, null, 330.5, 331.2] }] },
      },
    ],
  },
};
const parsed = M.parseDailyChart(chart, true);
check("null closes are skipped and a repeated day keeps the later value", parsed.closes, [["2026-09-23", 320.1], ["2026-09-25", 331.2]]);
check("the last price comes from the meta", parsed.last?.price, 331.2);
check("history is dropped unless asked for", M.parseDailyChart(chart, false).closes, []);
check("an empty chart reads null, not zero", M.parseDailyChart({}, true).last, null);
check("a recent first lot needs one year", M.rangeFor("2026-06-01", "2026-09-26"), "1y");
check("a lot from last year needs two", M.rangeFor("2025-01-01", "2026-09-26"), "2y");
check("an old lot reaches back far enough", M.rangeFor("2021-01-01", "2026-09-26"), "10y");

console.log("\ndata integrity");
ok("no researched name is on the ban list", D.ALL_DOSSIERS.every((d) => !U.WASH_SALE_BANNED[d.ticker]));
ok("every captured company row carries its trend fields", U.allFundamentals().filter((f) => !f.pendingCapture && f.marketCap).every((f) => f.ma50 != null && f.ma200 != null));
check("no company row is still pending capture", U.allFundamentals().filter((f) => f.pendingCapture).length, 0);
check("the tab can print the oldest row's date", U.oldestAsOf(), "2026-09-22");
const cap = readFileSync(new URL("./capture-invest-universe.mjs", import.meta.url), "utf8");
ok("a refresh maps the trend fields instead of dropping them", cap.includes("50DayMovingAverage") && cap.includes("52WeekLow"));
ok("and keeps a row's hand-written note", cap.includes("prev.note"));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
