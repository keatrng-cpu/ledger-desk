/**
 * One stop, everywhere — pinned against the screen that exposed it.
 *
 * 2026-09-25 16:52 ET, ES short card: entry 7805.05 – 7806.04 (OTE, opt
 * 7805.55), invalidation "Above PDH 7783.50 / sweep". The stop sat 22 points
 * BELOW a short entry. card-geometry.ts refused it on the card; the Log LIVE
 * dialog read the same string through buildPaperLevels, clamped it to a 0.04%
 * pad and prefilled MES × 123 on a 3.25pt stop. That card is the fixture.
 *
 * Also pins the evidence lookups the card, the ticket and the paper book now
 * read their measured costs from.
 *
 * Run: npx tsx scripts/verify-card-plan.mjs
 */

const { attachPlansToCards, cardRisk, cardSizeRefusal, planStopText } = await import(
  "../src/lib/trading/card-plan.ts"
);
const { protectiveInvalidation } = await import("../src/lib/trading/scanner.ts");
const { buildPaperLevels } = await import("../src/lib/trading/paper-manager.ts");
const { qBucket, riskAtrBucket, sessionBucket, cardEvidence, describeBucket, EVIDENCE } = await import(
  "../src/lib/trading/evidence.ts"
);

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

// The real card, as the scanner built it before the fix.
const esShort = {
  id: "ES-short",
  symbol: "ES",
  side: "short",
  confluence: 0.79,
  grade: "A+",
  pathBand: "A+",
  title: "ES short — Ronan",
  reasons: [],
  missing: [],
  components: [],
  strategies: [],
  strategyPrimary: "ronan",
  strategyWhy: [],
  entryZone: "7805.05 – 7806.04 (OTE, opt 7805.55)",
  entryPx: 7805.55,
  invalidation: "Above PDH 7783.50 / sweep",
  stopSource: "structure",
  targets: ["EQ 7782.00", "PDL 7707.25", "Next unfilled pool (clamped 1–3R)"],
  killzoneOk: false,
  htfOk: true,
  conditionsOk: true,
  actionable: false,
  regime: "ranging",
  volatility: "normal",
  atr: 8,
};

console.log("the 2026-09-25 ES short, as the old scanner built it");
{
  const risk = cardRisk(esShort);
  check("a stop below a short entry is not a stop", risk.stop, null);
  check("so the geometry reads as nothing to size from", risk.source, "none");
  const why = cardSizeRefusal(esShort);
  check("and anything that sizes refuses", why != null, true);
  check("in words that say which side is wrong", /correct side/.test(why ?? ""), true);

  const lv = buildPaperLevels(esShort, 100_000);
  check("the paper/log builder carries the refusal", lv.refusal != null, true);
  check("and knows the stop was a pad, not structure", lv.stopSource, "fallback");
}

console.log("\nthe scanner now puts the invalidation on the side it protects");
{
  const read = {
    pdh: 7783.5,
    pdl: 7707.25,
    swings: [
      { t: 1, price: 7790.0, kind: "high" },
      { t: 2, price: 7814.75, kind: "high" },
      { t: 3, price: 7809.25, kind: "high" },
      { t: 4, price: 7748.9, kind: "low" },
    ],
    dealing: { high: 7814.75, low: 7707.25, eq: 7761, zone: "premium", position: 0.9 },
  };
  const inv = protectiveInvalidation(read, "bear", 7805.55);
  check("PDH below a short entry is skipped", /PDH/.test(inv.text), false);
  check("the nearest swing high ABOVE the entry is used", inv.text, "Above swing high 7809.25 / sweep");
  check("and it is structural", inv.source, "structure");

  const withPdhAbove = protectiveInvalidation({ ...read, pdh: 7820 }, "bear", 7805.55);
  check("PDH still wins while it is beyond the entry (old behaviour kept)", withPdhAbove.text, "Above PDH 7820.00 / sweep");

  const nothing = protectiveInvalidation({ ...read, swings: [], dealing: null }, "bear", 7805.55);
  check("no protective level is said in words", nothing.source, "none");
  check("with no number anything could parse and size from", /\d/.test(nothing.text), false);

  const long = protectiveInvalidation(read, "bull", 7760);
  check("a long's PDL below the entry is kept", long.text, "Below PDL 7707.25 / sweep");
}

console.log("\na priced plan becomes the card's stop");
{
  const plan = {
    symbol: "ES",
    side: "short",
    price: 7805,
    entry: 7805.5,
    entryZone: { top: 7806, bottom: 7805 },
    stop: 7811.25,
    riskPts: 5.75,
    riskTooTight: false,
    riskTooWide: false,
    riskAtr: 8,
    riskOverCap: false,
    t1: 7795,
    t2: 7782,
    rr1: 1.83,
    rr2: 4.09,
    sweep: { price: 7810.25, t: null },
    range: null,
    draw: { price: 7795, name: "NY low", reachProbability: 0.6 },
    arrays: [],
    levels: [],
  };
  const card = { ...esShort };
  const book = { symbol: "ES", side: "short", plan };
  const n = attachPlansToCards([card], { left: { symbol: "MNQ", side: null, plan: null }, right: book }, { ES: 8 });
  check("one card attached", n, 1);
  check("the card's invalidation IS the plan's stop", card.invalidation, planStopText(plan));
  check("and says what it sits beyond", /beyond the raid 7810\.25/.test(card.invalidation), true);
  check("stop source is the plan", card.stopSource, "plan");
  check("risk in ATR is carried", card.plan.riskAtr, 0.72);
  check("inside the band nothing refuses", cardSizeRefusal(card), null);

  const lv = buildPaperLevels(card, 100_000);
  check("paper entry is the plan's CE", lv.entry, 7805.5);
  check("paper stop is the plan's stop", lv.stop, 7811.25);
  check("paper T1 is the plan's draw", lv.tp1, 7795);
  check("paper T2 is the plan's ERL", lv.tp2, 7782);
  check("no refusal", lv.refusal, null);
  check("stop source recorded", lv.stopSource, "plan");
  // 5.75pt on MES = $28.75/contract; A+ card at the A probe is 2% = $2,000.
  check("sized at the A+ probe (2%), not 3%", lv.riskDollars, 2000);

  // The plan's own ATR (same series it was graded on) wins over the desk-wide
  // stamp — so the tight case is the same stop judged against a 20pt ATR.
  const tight = { ...esShort };
  const tightBook = { ...book, plan: { ...plan, riskAtr: 20, riskTooTight: true } };
  attachPlansToCards([tight], { left: tightBook, right: tightBook }, { ES: 8 });
  check("the same stop on a 20pt ATR is 0.29 ATR", tight.plan.riskAtr, 0.29);
  const why = cardSizeRefusal(tight);
  check("which refuses as inside the floor", /inside the 0\.5×ATR floor/.test(why ?? ""), true);
  check("with the measured cost from the pack", /measured −\d\.\d\dR\/card/.test(why ?? ""), true);

  const other = { ...esShort, side: "long", id: "ES-long" };
  attachPlansToCards([other], { left: book, right: book });
  check("a plan never attaches to the other side's card", other.plan ?? null, null);
}

console.log("\nthe evidence pack lookups");
{
  check("the pack is loaded", EVIDENCE.baseline.n > 1000, true);
  check("Q 0.86 falls in the 0.85+ bucket", qBucket(0.86)?.key, "0.85+");
  check("under the floor is no bucket", qBucket(0.6), null);
  check("0.3 ATR is the <0.5 bucket", riskAtrBucket(0.3)?.key, "<0.5");
  check("1.5 exactly is still inside the band's last bucket", riskAtrBucket(1.5)?.key, "1-1.5");
  check("an event outside the killzones has its own bucket", sessionBucket(null, "event")?.key, "out-event");
  check("NY AM reads the NY AM bucket", sessionBucket("ny_am", "killzone")?.key, "ny_am");
  const lines = cardEvidence({ confluence: 0.86, riskAtr: 0.3, side: "short", killzone: "ny_am", sessionSource: "killzone" });
  check("a card gets its Q line and its stop line", lines.map((l) => l.key), ["q", "stop"]);
  check("a bucket that loses in both halves is a warning", lines.find((l) => l.key === "stop")?.tone, "warn");
  const thin = { ...EVIDENCE.baseline, verdict: "thin", n: 4 };
  check("a thin bucket prints no rate", /too few to read/.test(describeBucket(thin)), true);
  const mixed = { ...EVIDENCE.baseline, verdict: "mixed" };
  check("a mixed bucket says it is not an edge", /not an edge either way/.test(describeBucket(mixed)), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
