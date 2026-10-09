/**
 * The sequence grader and the canon had NO verifier.
 *
 * `smc-master.ts` decides the word the whole desk prints and `smc-canon.ts`
 * decides which model may be named, and until now neither had a single test.
 * Every check below is one of the Wave-2 items, each with the control that
 * fails when the fix is removed (see the NEGATIVE CONTROL note on each block).
 *
 *   item 1   T1 is a POOL, not the 20-hour box EQ. One price, everywhere.
 *   item 10  a COMPLETE sequence outranks a higher fit with a missing must,
 *            and when nothing is complete the word is WAIT.
 *   item 11  SMT credits the index that inverted FIRST; the laggard does not.
 *   item 13  pd_half is not ignorable at 0.80+ fit. The draw still is.
 *   item 14  Patty is a HIGHER-TIMEFRAME gap, in Patty's own hours.
 *   item 16  the plan object: the card, the chart and the order read one list.
 *   item 24  the silver bullet is the raid of the 09:30-10:00 range.
 *
 * Run: npx tsx scripts/verify-smc-master.mjs
 */

const {
  eligibleCandidates,
  sequenceComplete,
  sequenceGaps,
  SEQUENCE_PARTS,
} = await import("../src/lib/trading/smc-master.ts");
const {
  drawPoolsForSide,
  applyRunnerPool,
  cardPlanFrom,
  deskLevelsOf,
  planTargetText,
  poolFrom,
  attachPlansToCards,
  LOCATION_KINDS,
  EXTERNAL_KINDS,
  DESK_LEVEL_ORDER,
} = await import("../src/lib/trading/card-plan.ts");
const {
  MODEL_REQUIREMENTS,
  modelMayBeNamed,
  inModelWindow,
  scoreCanonStack,
  SMT_TRADES_THE_LEADER,
  SILVER_BULLET_EVIDENCE,
  OTE_SIZE_CUT_EVIDENCE,
} = await import("../src/lib/trading/smc-canon.ts");
const { STRATEGY_TEMPLATES, gradeAllStrategies, isStrategyComplete } = await import(
  "../src/lib/trading/strategy-grade.ts"
);
const { smtAtLevel } = await import("../src/lib/trading/smt-level.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const okv = JSON.stringify(got) === JSON.stringify(want);
  if (okv) pass++;
  else fail++;
  console.log(
    `  ${okv ? "ok  " : "FAIL"} ${name}${okv ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`,
  );
};
const ok = (name, cond) => check(name, !!cond, true);

/* ------------------------------------------------------------------ */
/* ITEM 1 — the target is a pool, never a location                     */
/* ------------------------------------------------------------------ */
console.log("\nitem 1 — T1 is the next unswept pool, not the 20-hour box EQ");

const lvl = (name, price, kind, swept = false, reach = 0.7) => ({
  name,
  price,
  kind,
  side: price > 24000 ? "above" : "below",
  distancePoints: Math.abs(price - 24000),
  distanceAtr: 1,
  liquidityWeight: 0.8,
  swept,
  reachProbability: reach,
  score: reach,
  why: [],
});

// A trending long: the box EQ sits 20 points ahead (near, and the kind draw.ts
// scores highest), a real unswept pool 60 points ahead, an external 160 ahead.
const trendUp = {
  primary: lvl("EQ", 24020, "range"),
  alternates: [
    lvl("Range high", 24040, "range"),
    lvl("EQH x3", 24060, "pool"),
    lvl("Asia high", 24090, "session"),
    lvl("PDH", 24160, "prior"),
  ],
  baseRateReliable: true,
};

const up = drawPoolsForSide(trendUp, "long", 24000);
// NEGATIVE CONTROL for this block: delete "range" from LOCATION_KINDS in
// card-plan.ts and this line reads 24020 (the EQ) instead of 24060.
check("T1 is the unswept POOL, not the EQ at 24020", up.t1?.price, 24060);
check("T1's kind is a pool", up.t1?.kind, "pool");
check("T2 is the EXTERNAL pool beyond T1", up.t2?.price, 24160);
check("T2's kind is external-class", EXTERNAL_KINDS.has(up.t2?.kind), true);
ok("the reason names both", /EQH x3/.test(up.why) && /PDH/.test(up.why));

ok("LOCATION_KINDS is exactly range+open", LOCATION_KINDS.has("range") && LOCATION_KINDS.has("open") && !LOCATION_KINDS.has("pool"));
ok("EXTERNAL_KINDS is external/prior/weekly", EXTERNAL_KINDS.has("external") && EXTERNAL_KINDS.has("prior") && EXTERNAL_KINDS.has("weekly"));

// A level BEHIND the entry is where price came from, not a target.
const behind = drawPoolsForSide(
  { primary: lvl("EQH x3", 23900, "pool"), alternates: [], baseRateReliable: true },
  "long",
  24000,
);
check("a pool behind CE is not a target", behind.t1, null);
ok("and it says why", /no level in the trade's direction|no target/i.test(behind.why));

// Only locations ahead: no target at all, rather than an EQ dressed as one.
const onlyLocations = drawPoolsForSide(
  { primary: lvl("EQ", 24020, "range"), alternates: [lvl("NY 9:30 open", 24030, "open")], baseRateReliable: true },
  "long",
  24000,
);
check("only locations ahead yields NO target", onlyLocations.t1, null);
ok("and names them as locations", /location/i.test(onlyLocations.why));

// An unswept pool beats a nearer swept one; a swept pool is the fallback.
const sweptNearer = drawPoolsForSide(
  {
    primary: lvl("EQH swept", 24030, "pool", true),
    alternates: [lvl("EQH x2", 24070, "pool", false)],
    baseRateReliable: true,
  },
  "long",
  24000,
);
check("unswept beats a nearer swept pool", sweptNearer.t1?.price, 24070);
const allSwept = drawPoolsForSide(
  { primary: lvl("EQH swept", 24030, "pool", true), alternates: [], baseRateReliable: true },
  "long",
  24000,
);
check("a swept pool is the FALLBACK, not nothing", allSwept.t1?.price, 24030);
ok("and the reason says it is already swept", /already swept/.test(allSwept.why));

// Shorts mirror exactly.
const trendDown = {
  primary: lvl("EQ", 23980, "range"),
  alternates: [lvl("EQL x3", 23940, "pool"), lvl("PDL", 23840, "prior")],
  baseRateReliable: true,
};
const down = drawPoolsForSide(trendDown, "short", 24000);
check("short T1 is the pool below", down.t1?.price, 23940);
check("short T2 is the external below it", down.t2?.price, 23840);

// Below draw.ts's base-rate floor the reach number is null, not a percentage
// off four sessions.
check("reach is null below the base-rate floor", poolFrom(up.t1, false)?.reachProbability, null);
check("and a number above it", poolFrom(up.t1, true)?.reachProbability, 0.7);

/* ------------------------------------------------------------------ */
/* ITEM 16 — one plan object                                           */
/* ------------------------------------------------------------------ */
console.log("\nitem 16 — the chart, the card and the order read ONE object");

const basePlan = {
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
  sweep: { price: 23972, t: 1700000000000 },
  range: { high: 24100, low: 23900, eq: 24000 },
  draw: { price: 24060, name: "EQH x3", reachProbability: 0.7 },
  arrays: [],
  levels: [
    { kind: "price", price: 24005, label: "live" },
    { kind: "entry", price: 24000, label: "entry FVG" },
    { kind: "stop", price: 23970, label: "stop" },
    { kind: "t1", price: 24060, label: "EQH x3" },
    { kind: "t2", price: 24100, label: "T2 ERL" },
  ],
};

// applyRunnerPool re-points T2 at the external pool, leaving `range` alone.
const runnered = applyRunnerPool(basePlan, up.t2);
check("the runner becomes the external pool", runnered.t2, 24160);
check("rr2 is recomputed from it", runnered.rr2, 5.33);
check("the dealing range is untouched", runnered.range.high, 24100);
check("exactly one t2 level survives", runnered.levels.filter((l) => l.kind === "t2").length, 1);
check("and it is labelled with the pool", runnered.levels.find((l) => l.kind === "t2").label, "T2 PDH");
// A runner behind T1 is refused rather than re-pointed backwards.
check("a runner behind T1 is refused", applyRunnerPool(basePlan, lvl("PDH", 24010, "prior")).t2, 24100);

const cp = cardPlanFrom(runnered, {
  partial: 24030,
  drawPool: poolFrom(up.t1, true),
  runnerPool: poolFrom(up.t2, true),
});
check("the plan carries the raid wick", cp.raid?.price, 23972);
check("the plan carries the partial", cp.partial, 24030);
check("the draw pool is named", cp.drawPool?.name, "EQH x3");
check("the runner pool is named", cp.runnerPool?.name, "PDH");
check("drawName follows the pool", cp.drawName, "EQH x3");

const kinds = cp.levels.map((l) => l.kind);
check("levels are raid->entry->stop->partial->draw->runner", kinds, [
  "raid",
  "entry",
  "stop",
  "partial",
  "draw",
  "runner",
]);
check("DESK_LEVEL_ORDER is that order", [...DESK_LEVEL_ORDER], kinds);
check("the draw level IS plan.t1", cp.levels.find((l) => l.kind === "draw").price, cp.t1);
check("the runner level IS plan.t2", cp.levels.find((l) => l.kind === "runner").price, cp.t2);
check("the stop level IS plan.stop", cp.levels.find((l) => l.kind === "stop").price, cp.stop);
check("the entry level IS plan.entry", cp.levels.find((l) => l.kind === "entry").price, cp.entry);

// `levels` is DERIVED. There must be no way to set it to something the other
// fields disagree with.
const derived = deskLevelsOf({ ...cp, t1: 99999 });
check("levels are re-derived from the fields, never stored stale", derived.find((l) => l.kind === "draw").price, 99999);

// A plan with no partial and no targets draws three lines, not six guesses.
const bare = cardPlanFrom({ ...basePlan, t1: null, t2: null, rr1: null, rr2: null, sweep: null, draw: null, levels: [] });
check("no raid, no partial, no targets => entry+stop only", bare.levels.map((l) => l.kind), ["entry", "stop"]);
check("and nothing invented for them", [bare.t1, bare.t2, bare.partial, bare.raid], [null, null, null, null]);

const text = planTargetText(cp);
ok("the card's T1 line quotes the plan's own price", text[0].includes("24060"));
ok("the card's T1 line names the pool", text[0].includes("EQH x3"));
ok("the card's T2 line quotes the runner", text[1].includes("24160"));
ok("the partial is stated as the impulse EQ", text[2].includes("impulse EQ"));

/*
 * THE PRICE MUST LEAD. Four readers (paper-manager.ts, simulate-path-trade.ts,
 * card-plan firstNum, the handoff) parse a target by pulling the FIRST number
 * out of the string, and pool names carry digits ("EQH x3", "PDH +2"). Found
 * on live tape by this file's real-engine block below, which read `1` off
 * "T1 EQH x3 11804.50" and would have fed 1 to the paper book as a target.
 *
 * NEGATIVE CONTROL for this block: put the name or a bare "T1" back in front
 * of the price in `planTargetText` and all four of these fail.
 */
const firstNumOf = (s) => {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
check("the FIRST number on the T1 line is the price", firstNumOf(text[0]), cp.t1);
check("the FIRST number on the T2 line is the price", firstNumOf(text[1]), cp.t2);
check("the FIRST number on the partial line is the price", firstNumOf(text[2]), cp.partial);
// The exact case that broke it: a pool whose own name contains a digit.
const digitPool = cardPlanFrom(runnered, { drawPool: poolFrom(lvl("EQH x3", 24060, "pool"), true) });
check("a pool named with a digit still parses to the price", firstNumOf(planTargetText(digitPool)[0]), 24060);

/* `attachPlansToCards` is the one write point, and it must overwrite the
 * scanner's target strings. NEGATIVE CONTROL: remove the
 * `c.targets = planTargetText(c.plan)` line and `firstPrice` below reads the
 * scanner's EQ instead of the plan's pool. */
console.log("\nitem 16 — attachPlansToCards makes the CARD read the plan");
const firstPrice = (s) => {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const card = {
  id: "MNQ-long",
  symbol: "MNQ",
  side: "long",
  confluence: 0.8,
  grade: "A+",
  pathBand: "A+",
  title: "MNQ long",
  reasons: [],
  missing: [],
  components: [],
  strategies: [],
  strategyPrimary: "mechanical",
  strategyWhy: [],
  entryZone: "",
  entryPx: 24000,
  invalidation: "Above EQ 24020",
  stopSource: "structure",
  // The scanner's placeholders — an EQ first, exactly the bug.
  targets: ["EQ 24020.00 — a location, not a pool", "PDH 24160.00", "Priced target comes from the plan"],
  killzoneOk: true,
  htfOk: true,
  conditionsOk: true,
  actionable: true,
  atr: 20,
};
const master = {
  left: { symbol: "MNQ", side: "long", plan: runnered, pools: { t1: up.t1, t2: up.t2, why: up.why, reliable: true }, partial: 24030 },
  right: { symbol: "ES", side: "short", plan: null },
};
check("one plan attached", attachPlansToCards([card], master, { MNQ: 20 }), 1);
check("the card's FIRST target is the plan's T1", firstPrice(card.targets[0]), card.plan.t1);
ok("and it is no longer the EQ", firstPrice(card.targets[0]) !== 24020);
check("the card's second target is the plan's T2", firstPrice(card.targets[1]), card.plan.t2);
check("the card's draw is the pool the plan used", card.draw?.name, "EQH x3");
check("the card's stop is the plan's stop", firstPrice(card.invalidation), card.plan.stop);
check("the stop source says plan", card.stopSource, "plan");

/* ------------------------------------------------------------------ */
/* ITEM 10 — completeness outranks fit                                 */
/* ------------------------------------------------------------------ */
console.log("\nitem 10 — a complete sequence beats a higher fit with a missing must");

const mk = (over = {}) => ({
  id: `${over.symbol ?? "MNQ"}-${over.side ?? "long"}`,
  symbol: "MNQ",
  side: "long",
  confluence: 0.7,
  grade: "A-",
  pathBand: "A-",
  title: "",
  reasons: [],
  missing: [],
  components: ["sweep_significant", "displacement", "mid_bias"],
  strategies: [],
  strategyPrimary: "mechanical",
  strategyWhy: [],
  entryZone: "",
  entryPx: 24000,
  invalidation: "",
  stopSource: "plan",
  targets: [],
  killzoneOk: true,
  htfOk: true,
  conditionsOk: true,
  actionable: true,
  ...over,
});

check("SEQUENCE_PARTS is the raid, the displacement, and the array", [...SEQUENCE_PARTS], [
  "raid",
  "displacement",
  "array",
]);
ok("a card with the three is complete", sequenceComplete(mk()));
check("no raid is named", sequenceGaps(mk({ components: ["displacement", "mid_bias"] })), ["raid"]);
check("no displacement is named", sequenceGaps(mk({ components: ["sweep_significant", "mid_bias"] })), ["displacement"]);
check("no array (entryPx null) is named", sequenceGaps(mk({ entryPx: null })), ["array"]);
ok(
  "a missing middle frame is a note, not a gap",
  !sequenceGaps(mk({ components: ["sweep_significant", "displacement"] })).includes("mtf"),
);
ok(
  "outside the window is a note, not a gap",
  !sequenceGaps(mk({ killzoneOk: false })).includes("window"),
);
// The mechanical model stands in for the raid, because detectors.ts only calls
// a sequence complete when its own sweep closed back inside.
ok(
  "a complete mechanical model satisfies the raid part",
  !sequenceGaps(mk({ components: ["mechanical_model", "displacement", "mid_bias"] })).includes("raid"),
);

// NEGATIVE CONTROL for this block: remove `sequenceComplete(c) ? 1 : 0` from
// eligibleCandidates' rank array and the 0.94 incomplete card wins.
const complete70 = mk({ confluence: 0.7, pathBand: "A-", grade: "A-" });
const incomplete94 = mk({ confluence: 0.94, pathBand: "A+", grade: "A+", components: ["displacement", "mid_bias"] });
const scan = { candidates: [incomplete94, complete70] };
const narr = { liquidity: { lastSweep: "none", lastSweepT: null, lastSweepExtreme: null }, confirmation: "none" };
const ordered = eligibleCandidates(scan, { symbol: "MNQ", topDown: "bull" }, narr);
check("the COMPLETE 0.70 card is first", ordered[0].confluence, 0.7);
check("the incomplete 0.94 card is second", ordered[1].confluence, 0.94);

// Among two complete cards the band, then the fit, still decides.
const completeA = mk({ confluence: 0.9, pathBand: "A+", grade: "A+" });
const orderedBoth = eligibleCandidates({ candidates: [complete70, completeA] }, { symbol: "MNQ", topDown: "bull" }, narr);
check("between two complete cards the better band wins", orderedBoth[0].confluence, 0.9);

// The HTF gate still outranks everything, including completeness.
const refusedComplete = mk({ htfOk: false, confluence: 0.95 });
const allowedIncomplete = mk({ side: "short", confluence: 0.66, components: ["displacement"] });
const orderedHtf = eligibleCandidates(
  { candidates: [refusedComplete, allowedIncomplete] },
  { symbol: "MNQ", topDown: "bear" },
  narr,
);
check("a card the HTF gate refuses never leads", orderedHtf[0].side, "short");

/* ------------------------------------------------------------------ */
/* ITEM 11 — the leader trades the divergence                           */
/* ------------------------------------------------------------------ */
console.log("\nitem 11 — SMT credits the index that inverted FIRST");

ok("the leader rule is on", SMT_TRADES_THE_LEADER.value === true);

// smt-level exposes `led`, which was computed and discarded before.
const bars = Array.from({ length: 80 }, (_, i) => ({
  t: 1700000000000 + i * 900000,
  o: 24000,
  h: 24010,
  l: 23990,
  c: 24000,
  v: 100,
}));
const div = {
  active: true,
  kind: "bearish",
  leader: "left",
  timeframe: "15m",
  sweepPrice: 24010,
  holdPrice: 24008,
};
const leftRead = smtAtLevel({ divergence: div, isLeft: true, side: "short", bars });
const rightRead = smtAtLevel({ divergence: div, isLeft: false, side: "short", bars });
check("the leader's read says led", leftRead.led, true);
check("the laggard's read says not led", rightRead.led, false);
check("no divergence reads null, not false", smtAtLevel({ divergence: null, isLeft: true, side: "short", bars }).led, null);

// NEGATIVE CONTROL for this block: change `input.smtLed !== false` to `true`
// in smc-canon.ts and the laggard's factor passes again.
const canonIn = (over) => ({
  side: "short",
  htf: "bear",
  mtf: "bear",
  dealingZone: "premium",
  swept: "bsl",
  confirmation: "confirmed",
  inKillzone: true,
  killzoneLabel: "NY AM",
  smt: true,
  components: ["ifvg", "sweep_significant", "ote"],
  strategy: "tjr",
  ...over,
});
const ledStack = scoreCanonStack(canonIn({ smtLed: true }));
const lagStack = scoreCanonStack(canonIn({ smtLed: false }));
const blindStack = scoreCanonStack(canonIn({}));
const smtFactor = (s) => s.factors.find((f) => f.id === "smt");
check("the leader earns the SMT factor", smtFactor(ledStack).pass, true);
check("the laggard does NOT", smtFactor(lagStack).pass, false);
check("no divergence read behaves exactly as before", smtFactor(blindStack).pass, true);
ok("the laggard is told which book to trade", /laggard is not a second setup/.test(smtFactor(lagStack).detail));
// It is an OPTIONAL factor, so it can move the A+/A boundary and never the word.
check("SMT is never a must", smtFactor(lagStack).must, false);
check("the laggard loses an optional hit", ledStack.optionalHits - lagStack.optionalHits, 1);
ok("both still clear every must", ledStack.mustHits === lagStack.mustHits);
// A divergence in the middle of the range does not light the factor at all.
const midRange = smtAtLevel({ divergence: div, isLeft: true, side: "short", bars, atr: 400 });
void midRange;
check(
  "a divergence nowhere near a level is not atLevel",
  smtAtLevel({ divergence: { ...div, sweepPrice: 50000 }, isLeft: true, side: "short", bars }).atLevel,
  false,
);

/* ------------------------------------------------------------------ */
/* ITEM 13 — pd_half is not ignorable                                  */
/* ------------------------------------------------------------------ */
console.log("\nitem 13 — a high fit at equilibrium still waits");

// Read the source, because the whole item is the SCOPE of one predicate and a
// behavioural test needs a full desk (which the real-engine block below runs).
const { readFileSync } = await import("node:fs");
const masterSrc = readFileSync("src/lib/trading/smc-master.ts", "utf8");
const ignorableLine = masterSrc.slice(masterSrc.indexOf("const ignorable ="), masterSrc.indexOf("const mustPass ="));
// NEGATIVE CONTROL for this block: put `l.id === "pd_half" ||` back into
// `ignorable` and both of these flip.
ok("pd_half is NOT in the ignorable set", !/pd_half/.test(ignorableLine));
ok("dol still is", /l\.id === "dol"/.test(ignorableLine));
ok("the 0.8 literal is unchanged in value", />= 0\.8/.test(ignorableLine));
ok("it still requires a live PATH and an HTF pass", /pathOk/.test(ignorableLine) && /htfPass/.test(ignorableLine));
ok("and it still only ever forgives a FAIL", /l\.state === "fail"/.test(ignorableLine));

/* ------------------------------------------------------------------ */
/* ITEM 14 — Patty is a higher-timeframe gap, in Patty's hours          */
/* ------------------------------------------------------------------ */
console.log("\nitem 14 — a 15-minute gap cannot be named Patty");

const patty = MODEL_REQUIREMENTS.patty;
check("Patty's hours are 9:45-11:00 and 13:30-14:30", patty.windows, [
  [585, 660],
  [810, 870],
]);
check("Patty requires the HTF gap", [...patty.requires], ["htf_gap"]);
ok("Patty requires no sweep", !patty.requires.includes("sweep_significant"));

// NEGATIVE CONTROL for this block: set Patty's template `must` back to
// ["ifvg"] in strategy-grade.ts and the execution-series gap completes it.
const execOnly = ["ifvg", "displacement", "daily_bias"];
const withHtf = ["htf_gap", "ifvg", "displacement", "daily_bias"];
check("a 15m gap + daily agreeing does NOT complete Patty", isStrategyComplete("patty", execOnly).complete, false);
ok("and the missing part is named", isStrategyComplete("patty", execOnly).missing.includes("htf_gap"));
check("an unmitigated 1h/4h gap does", isStrategyComplete("patty", withHtf).complete, true);
check("Patty may not be NAMED on the execution gap alone", modelMayBeNamed("patty", { etMin: 600, components: execOnly }).ok, false);
check("Patty may be named with the HTF gap, in the window", modelMayBeNamed("patty", { etMin: 600, components: withHtf }).ok, true);
check("Patty may not be named at lunch", modelMayBeNamed("patty", { etMin: 12 * 60 + 30, components: withHtf }).ok, false);
ok("and the hours are quoted in the refusal", /09:45–11:00 and 13:30–14:30/.test(modelMayBeNamed("patty", { etMin: 750, components: withHtf }).why));
check("Patty is not even graded outside its hours", gradeAllStrategies(withHtf, { etMin: 750 }).some((b) => b.id === "patty"), false);
check("and is graded inside them", gradeAllStrategies(withHtf, { etMin: 600 }).some((b) => b.id === "patty"), true);
check("a null clock names no window-bound model", inModelWindow("patty", null), false);

/* ------------------------------------------------------------------ */
/* ITEM 24 — the silver bullet is the opening-range raid                */
/* ------------------------------------------------------------------ */
console.log("\nitem 24 — only the 09:30-10:00 range raid is a silver bullet");

const sb = MODEL_REQUIREMENTS.silver_bullet;
check("the window is 10:00-11:00 only", sb.windows, [[600, 660]]);
check("the pool is the OPENING range", sb.pool, "opening_range_0930_1000");
check("it requires or_raid + displacement", [...sb.requires], ["or_raid", "displacement"]);
ok("03:00-04:00 is deliberately NOT a window", !sb.windows.some(([a]) => a < 600));
check("the name grants no size", SILVER_BULLET_EVIDENCE.grantsSize, false);
check("and the measured R behind it is zero", SILVER_BULLET_EVIDENCE.measuredR, 0);
check("the OTE size cut stays unwired", OTE_SIZE_CUT_EVIDENCE.wired, false);

// NEGATIVE CONTROL for this block: drop "or_raid" from
// MODEL_REQUIREMENTS.silver_bullet.requires and any 10:00-hour sweep takes the
// name.
const otherSweep = ["sweep_significant", "displacement", "ifvg", "opening_raid"];
const orSweep = ["or_raid", "displacement", "ifvg"];
check("a generic sweep in the 10:00 hour is NOT a silver bullet", modelMayBeNamed("silver_bullet", { etMin: 615, components: otherSweep }).ok, false);
check("the OVERNIGHT-range raid is not one either", modelMayBeNamed("silver_bullet", { etMin: 615, components: otherSweep }).ok, false);
check("the 09:30-10:00 range raid is", modelMayBeNamed("silver_bullet", { etMin: 615, components: orSweep }).ok, true);
check("not at 09:50, before the hour", modelMayBeNamed("silver_bullet", { etMin: 590, components: orSweep }).ok, false);
check("not at 11:00, after it", modelMayBeNamed("silver_bullet", { etMin: 660, components: orSweep }).ok, false);
check("silver_bullet has a template", STRATEGY_TEMPLATES.some((t) => t.id === "silver_bullet"), true);
check("and it completes only with or_raid", isStrategyComplete("silver_bullet", orSweep).complete, true);
check("...not with a generic sweep", isStrategyComplete("silver_bullet", otherSweep).complete, false);

// Judas keeps the OVERNIGHT range — the two models must not share a pool.
check("Judas's pool is the overnight range", MODEL_REQUIREMENTS.judas.pool, "overnight_range");
ok("the two pools are different", MODEL_REQUIREMENTS.judas.pool !== sb.pool);
check("Judas is still 09:30-09:45 only", MODEL_REQUIREMENTS.judas.windows, [[570, 585]]);

/* ------------------------------------------------------------------ */
/* ITEM 15 — Blake's must is the swing                                 */
/* ------------------------------------------------------------------ */
console.log("\nitem 15 — blake_mech needs the swing, not a bare CISD");

// NEGATIVE CONTROL: put "cisd" back in blake_mech's `must` (and drop
// blake_swing) and the first line completes.
const bareCisd = ["sweep_significant", "cisd", "ifvg"];
const withSwing = ["sweep_significant", "blake_swing", "ifvg"];
check("a bare CISD does NOT complete blake_mech", isStrategyComplete("blake_mech", bareCisd).complete, false);
ok("and the swing is what is missing", isStrategyComplete("blake_mech", bareCisd).missing.includes("blake_swing"));
check("the confirmed swing does", isStrategyComplete("blake_mech", withSwing).complete, true);

/* ------------------------------------------------------------------ */
/* The real engine — item 1 and item 13 on a fully built desk           */
/* ------------------------------------------------------------------ */
console.log("\nthe real engine — one price on a fully built desk");
{
  const { existsSync } = await import("node:fs");
  if (!existsSync("src/data/history-4y.json")) {
    console.log("  skip — src/data/history-4y.json missing; run capture-history.mjs");
  } else {
    const { getSessionClock } = await import("../src/lib/trading/sessions.ts");
    const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
    const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
    const { scanSetups } = await import("../src/lib/trading/scanner.ts");
    const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
    const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
    const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
    const { newsRead } = await import("../src/lib/trading/news.ts");
    const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");

    const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
    const MNQ = H.bars.MNQ ?? [];
    const ES = H.bars.ES ?? [];

    let plans = 0;
    let onePrice = 0;
    let poolTargets = 0;
    let locationTargets = 0;
    let ignorablePdHalf = 0;
    let takesWithGaps = 0;
    let books = 0;
    let pi = 0;
    for (let i = 900; i < MNQ.length; i += 97) {
      while (pi < ES.length && ES[pi].t <= MNQ[i].t) pi++;
      const slice = MNQ.slice(Math.max(0, i - 799), i + 1);
      const peer = ES.slice(Math.max(0, pi - 800), pi);
      if (slice.length < 200 || peer.length < 200) continue;
      const clock = getSessionClock(new Date(MNQ[i].t));
      const biasL = analyzeStructure("MNQ", slice, 0);
      const biasR = analyzeStructure("ES", peer, 0);
      const smtStack = smtDivergenceStack(slice, peer);
      const smc = { left: buildSmcTape(slice), right: buildSmcTape(peer) };
      const sc = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peer, smc);
      const detL = summarizeDetectors(slice);
      const detR = summarizeDetectors(peer);
      const m = gradeSmcMaster({
        clock,
        bias: { left: biasL, right: biasR },
        scan: sc,
        draws: { left: drawOnLiquidity(biasL, slice), right: drawOnLiquidity(biasR, peer) },
        narrative: {
          left: buildMarketNarrative(biasL, detL, clock, biasL.topDown === "bear" ? "bear" : "bull", slice),
          right: buildMarketNarrative(biasR, detR, clock, biasR.topDown === "bear" ? "bear" : "bull", peer),
        },
        news: newsRead(new Date(MNQ[i].t)),
        smtStack,
        smc,
        quotes: { left: { price: MNQ[i].c }, right: { price: peer[peer.length - 1].c } },
        shockFloorMs: null,
        left: { bars: slice },
        right: { bars: peer },
      });
      attachPlansToCards(sc.candidates, m, { MNQ: null, ES: null });
      for (const b of [m.left, m.right]) {
        books++;
        // item 13: no book may ever forgive a FAILED pd_half.
        const pd = b.layers.find((l) => l.id === "pd_half");
        if (pd?.state === "fail" && b.word === "TAKE") ignorablePdHalf++;
        // item 10: a TAKE always has a complete sequence behind it.
        if (b.word === "TAKE" && b.candidateComplete === false) takesWithGaps++;
        if (!b.plan) continue;
        plans++;
        // item 1: T1 is a pool, never a location.
        if (b.pools?.t1) {
          if (LOCATION_KINDS.has(b.pools.t1.kind)) locationTargets++;
          else poolTargets++;
        }
        // item 16: the card for this book reads the plan's own T1.
        const c = sc.candidates.find((x) => x.symbol === b.symbol && x.side === b.side && x.plan);
        if (c && c.plan.t1 != null) {
          if (firstPrice(c.targets[0]) === c.plan.t1 && c.plan.t1 === b.plan.t1) onePrice++;
          else {
            onePrice = -1;
            console.log(
              `  FAIL one price: card ${firstPrice(c.targets[0])} vs plan ${c.plan.t1} vs book ${b.plan.t1} @ bar ${i}`,
            );
            break;
          }
        }
      }
      if (onePrice === -1) break;
    }
    ok(`the engine produced books to grade (${books})`, books > 200);
    ok(`and priced plans (${plans})`, plans > 0);
    ok(`every planned card, plan and book quote ONE T1 (${onePrice})`, onePrice > 0);
    check(`no T1 is a location kind (${poolTargets} pools)`, locationTargets, 0);
    check("no TAKE forgives a failed pd_half", ignorablePdHalf, 0);
    check("no TAKE has an incomplete sequence", takesWithGaps, 0);
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
