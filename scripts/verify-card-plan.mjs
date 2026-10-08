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

const { attachPlansToCards, cardRisk, cardSizeRefusal, planStopText, restableFromCard, withOrderLevels } =
  await import("../src/lib/trading/card-plan.ts");
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

console.log("\nresting orders book THEIR levels");
{
  check("a card with no plan has nothing to rest", restableFromCard(esShort), null);
  const order = { symbol: "ES", side: "short", limit: 7805.5, stop: 7811.25, t1: 7795, t2: 7782, riskPts: 5.75, zone: { top: 7806, bottom: 7805 } };
  const booked = withOrderLevels({ ...esShort, atr: 8 }, order);
  check("the fill books the order's limit", booked.plan.entry, 7805.5);
  check("and the order's stop", booked.plan.stop, 7811.25);
  check("band recomputed against the card's ATR", booked.plan.riskAtr, 0.72);
  check("inside the band, so nothing refuses", cardSizeRefusal(booked), null);
  const tight = withOrderLevels({ ...esShort, atr: 20 }, order);
  check("the same order on a 20pt ATR is flagged too tight", tight.plan.riskTooTight, true);
  check("and cannot dodge the refusal at the fill", cardSizeRefusal(tight) != null, true);
  check("restable round-trips a plan", restableFromCard(booked)?.entry, 7805.5);
}

console.log("\nitem 16 — the plan object reaches the ORDER, not just the card");
{
  /**
   * The ticket, the paper book and the Log dialog all size from `c.plan`, and
   * the chart draws `plan.levels`. The question this block asks is the one the
   * old three-targets bug answered wrongly: does the thing a resting order
   * promises match the thing drawn, through every path that rebuilds a plan?
   *
   * NEGATIVE CONTROL for this block: delete `levels: deskLevelsOf(plan)` from
   * `withOrderLevels` and "a resting order's card still carries levels" fails;
   * drop `partial` from `restableFromCard` and the partial line fails.
   */
  const { cardPlanFrom, deskLevelsOf, planTargetText, poolFrom, applyRunnerPool } = await import(
    "../src/lib/trading/card-plan.ts"
  );
  const pool = (name, price, kind, swept = false) => ({
    name,
    price,
    kind,
    side: "above",
    distancePoints: 60,
    distanceAtr: 3,
    liquidityWeight: 0.85,
    swept,
    reachProbability: 0.7,
    score: 0.7,
    why: [],
  });
  const plan = {
    symbol: "MNQ",
    side: "long",
    price: 24005,
    entry: 24000,
    entryZone: { top: 24004, bottom: 23996 },
    stop: 23970,
    riskPts: 30,
    riskTooTight: false,
    riskTooWide: false,
    riskAtr: 20,
    riskOverCap: false,
    t1: 24060,
    t2: 24100,
    rr1: 2,
    rr2: 3.33,
    sweep: { price: 23972, t: 1 },
    range: { high: 24100, low: 23900, eq: 24000 },
    draw: { price: 24060, name: "EQH x3", reachProbability: 0.7 },
    arrays: [],
    levels: [],
  };
  const withRunner = applyRunnerPool(plan, pool("PDH", 24160, "prior"));
  const cp = cardPlanFrom(withRunner, {
    partial: 24030,
    drawPool: poolFrom(pool("EQH x3", 24060, "pool"), true),
    runnerPool: poolFrom(pool("PDH", 24160, "prior"), true),
  });

  // restableFromCard is what `restLimit` sends to the broker.
  const rest = restableFromCard({ plan: cp });
  check("the resting order's limit IS the plan's CE", rest.entry, cp.entry);
  check("its stop IS the plan's stop", rest.stop, cp.stop);
  check("its T1 IS the plan's draw", rest.t1, cp.t1);
  check("its T2 IS the plan's runner", rest.t2, cp.t2);
  check("and it carries the partial", rest.partial, 24030);
  // Every level drawn is a level the order knows about.
  const prices = cp.levels.map((l) => l.price);
  check("every drawn level is one of the order's own numbers",
    prices.every((p) => [cp.raid.price, cp.entry, cp.stop, cp.partial, cp.t1, cp.t2].includes(p)), true);
  check("nothing is drawn twice", new Set(cp.levels.map((l) => l.kind)).size, cp.levels.length);

  // A card re-levelled from a RESTING order still carries a derived level list.
  const booked = withOrderLevels(
    { ...esShort, symbol: "MNQ", side: "long", plan: cp, atr: 20 },
    { symbol: "MNQ", side: "long", limit: 23998, stop: 23968, t1: 24058, t2: 24098, riskPts: 30, zone: null },
  );
  check("a resting order's card still carries levels", booked.plan.levels.length > 0, true);
  check("its entry level is the ORDER's limit, not the card's CE", booked.plan.levels.find((l) => l.kind === "entry").price, 23998);
  check("its draw level is the ORDER's T1", booked.plan.levels.find((l) => l.kind === "draw").price, 24058);
  check("a resting order promises no partial", booked.plan.partial, null);
  check("and draws none", booked.plan.levels.some((l) => l.kind === "partial"), false);
  check("the raid wick rides along for the stop's story", booked.plan.raid?.price, 23972);

  // The target text the card prints is parseable by the price-first rule every
  // downstream reader uses.
  const t = planTargetText(cp);
  const firstOf = (s) => Number(String(s).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/)?.[0]);
  check("target line 1 parses to T1", firstOf(t[0]), cp.t1);
  check("target line 2 parses to T2", firstOf(t[1]), cp.t2);
  check("a bare plan derives only entry and stop", deskLevelsOf({ ...cp, raid: null, partial: null, t1: null, t2: null }).map((l) => l.kind), ["entry", "stop"]);
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
