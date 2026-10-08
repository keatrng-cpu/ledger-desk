/**
 * detectors.ts — the five things the detectors were calling by the wrong name.
 *
 * Each block below pins one of them, and each pins the DEFAULT too: four of
 * the five fixes are additive (new fields, new exported tests) and must leave
 * today's output byte-identical until the scanner owner flips the switch. The
 * one behaviour change is the mechanical window (ITEM 6), and it only ever
 * tightens — `mechanicalWindowBars` takes the MINIMUM of the minute budget
 * and the original bar count.
 *
 * What was wrong:
 *   5  displacement was "a big candle". A fat body that filled its own path
 *      scored; an ordinary body that LEFT a gap and held it did not.
 *   6  MM_DISPLACE_WITHIN = 6 BARS, which on the desk's 15m series is NINETY
 *      MINUTES. The model is the next 1m-5m close after the raid.
 *   7  a sweep was a 15m object: a 15m wick + close back inside was called a
 *      raid even when every 1m candle underneath CLOSED outside.
 *   12 inducement was computed and ignored. A raid of a minor pool with the
 *      obvious swing still unswept beyond it is the trap, not the arming raid.
 *   15 blake was a generic CISD — a close back through a run of opposing
 *      candles, with no raid, no pullback and no level to reclaim.
 *
 * Differential, not fixture-shaped where it can be: ITEM 15's central test
 * runs raid-pair.ts's `cisdThroughSeries` over the SAME bars and shows the
 * generic test says yes where blake says no. ITEM 5 and 6 compare the two
 * rule settings against each other on one series.
 *
 * Run: npx tsx scripts/verify-detectors.mjs
 */
const D = await import("../src/lib/trading/detectors.ts");
const { cisdThroughSeries } = await import("../src/lib/trading/raid-pair.ts");
const { GATE } = await import("../src/lib/trading/gate-tuning.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : detail ? ` — ${detail}` : ""}`);
};
const eq = (name, got, want) =>
  check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const M15 = 900_000;
const bar = (t, o, h, l, c) => ({ t, o, h, l, c, v: 1 });
/** 14+ bars of identical 10-point range: ATR(14) = 10 and, because every low
 *  and high ties, fractalSwings finds nothing in here to confuse a test. */
const quiet = (n, t0, step = M15) =>
  Array.from({ length: n }, (_, i) => bar(t0 + i * step, 100, 105, 95, 100));
const at = (arr, i) => arr.find((e) => e.index === i) ?? null;

/* ================================================================== */
console.log("\nITEM 5 — displacement is 'gap left, close held', not 'a big candle'");
/* ================================================================== */

// Index 20 is a 23-point body (1.5 x ATR(10) = 15) that leaves NO gap:
// bars[19].h = 105 and bars[21].l = 95, so 105 < 95 is false.
const bigNoGap = [
  ...quiet(20, 0),
  bar(20 * M15, 95, 120, 94, 118),
  ...quiet(4, 21 * M15),
];
const bigBody = D.detectDisplacements(bigNoGap);
const big = at(bigBody, 20);
check("a 23-point body on ATR 10 is still found under the default rule", big != null);
eq("and the default rule is unchanged", D.DISPLACEMENT_RULE.rule, "body");
eq("it left no gap", big?.gap ?? null, null);
eq("so 'gap left, close held' is false", big?.gapHeld, false);
eq("and it says which test it passed", big?.qualifiedBy, "body");
eq("under the gap rule a big candle that closed no gap is NOT displacement", at(D.detectDisplacements(bigNoGap, { rule: "gap" }), 20), null);
check("the body test itself is reported either way", at(D.detectDisplacements(bigNoGap, { rule: "either" }), 20)?.bodyQualified === true);

// Index 20 is a 6-point body — well under 1.5 x ATR — but bars[19].h = 105 <
// bars[21].l = 112, so it left a gap, and nothing after closes below 105.
const smallHeldGap = [
  ...quiet(20, 0),
  bar(20 * M15, 110, 118, 109, 116),
  bar(21 * M15, 113, 125, 112, 120),
  ...Array.from({ length: 4 }, (_, i) => bar((22 + i) * M15, 120, 126, 118, 123)),
];
eq("an ordinary body is not displacement under the body rule", at(D.detectDisplacements(smallHeldGap), 20), null);
const gapOnly = at(D.detectDisplacements(smallHeldGap, { rule: "gap" }), 20);
check("but it IS under the gap rule — it skipped price and held", gapOnly != null);
eq("the gap it left is carried on the event", { top: gapOnly?.gap?.top, bottom: gapOnly?.gap?.bottom }, { top: 112, bottom: 105 });
eq("the gap becomes a fact on the THIRD candle, not the displacement itself", gapOnly?.gap?.createdIndex, 21);
eq("held", gapOnly?.gapHeld, true);
eq("nothing closed back through it", gapOnly?.gapClosedIndex, null);
eq("and it says the gap is what let it through", gapOnly?.qualifiedBy, "gap");

// Same gap, but bar 24 CLOSES at 100 — below the gap's 105 floor.
const closedBack = [
  ...smallHeldGap.slice(0, 24),
  bar(24 * M15, 118, 120, 99, 100),
  bar(25 * M15, 100, 106, 98, 102),
];
const spent = at(D.detectDisplacements(closedBack, { rule: "gap" }), 20);
eq("a gap that was closed back through does not qualify under the gap rule", spent, null);
const spentEither = at(D.detectDisplacements(closedBack, { rule: "either" }), 20);
eq("and under 'either' it is still refused, because the body failed too", spentEither, null);
// Read the same gap off a displacement that DID pass the body test, so the
// close-through bookkeeping is observable.
const bodyAndSpentGap = [
  ...quiet(20, 0),
  bar(20 * M15, 100, 122, 99, 120),
  bar(21 * M15, 121, 130, 112, 125),
  bar(22 * M15, 125, 127, 118, 120),
  bar(23 * M15, 120, 122, 99, 100),
  ...quiet(3, 24 * M15),
];
const bs = at(D.detectDisplacements(bodyAndSpentGap), 20);
check("a body displacement that left a gap carries it", bs?.gap != null);
eq("the gap is marked not held once a close went back through", bs?.gapHeld, false);
eq("and names the bar that did it", bs?.gapClosedIndex, 23);
eq("qualifiedBy says body, not both, when the gap did not hold", bs?.qualifiedBy, "body");

// The default must reproduce the pre-change set exactly: body >= K x ATR.
const atr = D.rollingAtr(bodyAndSpentGap);
const handRolled = bodyAndSpentGap
  .map((b, i) => ({ b, i, a: atr[i] }))
  .filter(({ b, i, a }) => i >= D.ATR_PERIOD && Number.isFinite(a) && a > 0 && b.c !== b.o && Math.abs(b.c - b.o) >= GATE.displacementK * a)
  .map(({ i }) => i);
eq("the default rule is exactly the old 1.5-ATR body test", D.detectDisplacements(bodyAndSpentGap).map((d) => d.index), handRolled);

/* ================================================================== */
console.log("\nITEM 6 — the mechanical window is MINUTES read off the series, not 6 bars");
/* ================================================================== */

const m1 = quiet(40, 0, 60_000);
const m5 = quiet(40, 0, 5 * 60_000);
const m15 = quiet(40, 0, M15);
const h1 = quiet(40, 0, 60 * 60_000);
eq("bar spacing is read from the data — 15m", D.barSpanMs(m15), M15);
eq("1m", D.barSpanMs(m1), 60_000);
// One overnight gap must not move it: the MEDIAN is the spacing, a mean is not.
const gapped = [...quiet(20, 0), ...quiet(20, 20 * M15 + 17 * 3_600_000)];
eq("a session gap does not move the spacing", D.barSpanMs(gapped), M15);
eq("one bar has no spacing", Number.isNaN(D.barSpanMs([bar(0, 1, 1, 1, 1)])), true);

eq("30 minutes on a 15m series is 2 candles, not 6 (was 90 minutes)", D.mechanicalWindowBars(m15), 2);
eq("on 5m it is the original handful", D.mechanicalWindowBars(m5), 6);
eq("on 1m it is capped back to the original 6 — never looser", D.mechanicalWindowBars(m1), 6);
eq("on 1h it floors at 1 — a zero-bar window would be a kill switch", D.mechanicalWindowBars(h1), 1);
eq("unreadable spacing falls back to today's behaviour", D.mechanicalWindowBars([]), D.MM_DISPLACE_WITHIN);
check("the minute budget is monotone-tightening on every rung", [m1, m5, m15, h1].every((s) => D.mechanicalWindowBars(s) <= D.MM_DISPLACE_WITHIN));

// A sellside raid at index 24, and the bullish displacement lands at index 29
// — five 15m bars, 75 minutes later.
const lateDisp = [
  ...quiet(20, 0),
  bar(20 * M15, 100, 104, 90, 100), // swing low at 90
  ...quiet(3, 21 * M15),
  bar(24 * M15, 95, 100, 88, 98), // raid: wick below 90, close back inside
  ...quiet(4, 25 * M15),
  bar(29 * M15, 98, 125, 97, 123), // displacement, 5 bars = 75 minutes later
  ...Array.from({ length: 4 }, (_, i) => bar((30 + i) * M15, 123, 128, 118, 123)),
];
const sweepsLate = D.detectSweeps(lateDisp);
eq("the raid is found", sweepsLate.map((s) => [s.index, s.side]), [[24, "sellside"]]);
const seqMin = D.detectMechanicalModel(lateDisp);
eq("a displacement 75 minutes after the raid does not complete the model", seqMin.displacement, null);
eq("and the sequence says why", seqMin.invalidation, "displacement_window_closed");
eq("it never got past the raid", seqMin.state, "swept");
D.MM_WINDOW.mode = "bars";
const seqBars = D.detectMechanicalModel(lateDisp);
check("under the old bar-count window the SAME tape pairs them", seqBars.displacement?.index === 29);
D.MM_WINDOW.mode = "minutes";
eq("the switch restores the minute rule", D.mechanicalWindowBars(m15), 2);

/* ================================================================== */
console.log("\nITEM 7 — the raid is confirmed on the CLOSED finer tape, tri-state");
/* ================================================================== */

const sweep = { index: 24, t: 24 * M15, side: "sellside", sweptLevel: 90, wickExtreme: 88, closeBackInside: 8 };
const oneMin = (spec) => spec.map((s, i) => bar(24 * M15 + i * 60_000, s[0], s[1], s[2], s[3]));
const NOW = 24 * M15 + 20 * 60_000; // the whole 15m candle has closed

// 15 closed 1m bars: #3 wicks to 88 and closes at 95, back inside the pool.
const cleanRaid = oneMin(
  Array.from({ length: 15 }, (_, i) =>
    i === 3 ? [93, 94, 88, 95] : [95, 97, 93, 96],
  ),
);
const okRead = D.confirmSweepOnTape(sweep, m15, cleanRaid, { nowMs: NOW });
eq("wick through the pool then a close back inside is confirmed", okRead.verdict, "confirmed");
eq("no finer bar ever closed outside — a clean raid", okRead.closedOutside, 0);
eq("it names the bar that wicked through", okRead.wickIndex, 3);

// Same wick, but every 1m bar from there CLOSES below 90 and stays there.
const breakout = oneMin(
  Array.from({ length: 15 }, (_, i) =>
    i < 3 ? [95, 97, 93, 96] : [89, 90, 84, 86],
  ),
);
const brRead = D.confirmSweepOnTape(sweep, m15, breakout, { nowMs: NOW });
eq("every finer close outside the pool is a BREAKOUT, not a raid", brRead.verdict, "breakout");
check("and it counts the closes that accepted outside", brRead.closedOutside === 12, `got ${brRead.closedOutside}`);
eq("breakout is not confirmed", brRead.verdict === "confirmed", false);

// Accepted outside for a while and then came back: confirmed, but it says so.
const lateReturn = oneMin(
  Array.from({ length: 15 }, (_, i) =>
    i < 3 ? [95, 97, 93, 96] : i < 10 ? [89, 90, 84, 86] : [91, 97, 90, 95],
  ),
);
const lateRead = D.confirmSweepOnTape(sweep, m15, lateReturn, { nowMs: NOW });
eq("a return after acceptance outside is confirmed", lateRead.verdict, "confirmed");
check("with the acceptance reported, not hidden", lateRead.closedOutside === 7 && /accepted outside/.test(lateRead.reason));

console.log("  -- and the three ways it must read no_tape, which NEVER means confirmed");
const noTapes = {
  "no finer series at all": D.confirmSweepOnTape(sweep, m15, null, { nowMs: NOW }),
  "a series that is not finer than the raid's own": D.confirmSweepOnTape(sweep, m15, quiet(20, 24 * M15, M15), { nowMs: NOW }),
  "only part of the raid candle covered": D.confirmSweepOnTape(sweep, m15, cleanRaid.slice(0, 5), { nowMs: NOW }),
  "the finer tape never traded through the pool": D.confirmSweepOnTape(sweep, m15, oneMin(Array.from({ length: 15 }, () => [95, 97, 93, 96])), { nowMs: NOW }),
  "the finer bars have not CLOSED yet": D.confirmSweepOnTape(sweep, m15, cleanRaid, { nowMs: 24 * M15 + 5 * 60_000 }),
};
for (const [why, read] of Object.entries(noTapes)) {
  eq(`${why} -> no_tape`, read.verdict, "no_tape");
  eq(`  ...and never reads as confirmed`, read.verdict === "confirmed", false);
}
eq("coverage is reported so the caller can see what was missing", noTapes["only part of the raid candle covered"].barsExpected, 15);

console.log("  -- the summary only answers the question when it is asked");
eq("no minute series -> tape is null, which is not confirmation", D.summarizeDetectors(lateDisp).sweep.tape, null);
const summed = D.summarizeDetectors(lateDisp, { minute: cleanRaid, nowMs: NOW });
eq("handed the tape, the summary grades the latest raid", summed.sweep.tape?.verdict, "confirmed");
eq("and the rest of the summary is unchanged by asking", JSON.stringify({ ...summed, sweep: { ...summed.sweep, tape: null } }), JSON.stringify(D.summarizeDetectors(lateDisp)));

/* ================================================================== */
console.log("\nITEM 12 — the arming raid is the one BEYOND the inducement");
/* ================================================================== */

// A deep swing low at 85 (index 14) and a shallower one at 92 (index 18).
// Index 24 raids only the 92 — the 85 is still standing.
const induceBase = [
  ...quiet(14, 0),
  bar(14 * M15, 100, 104, 85, 100), // the obvious low
  ...quiet(3, 15 * M15),
  bar(18 * M15, 100, 104, 92, 100), // the minor low in front of it
  ...quiet(5, 19 * M15),
  bar(24 * M15, 98, 103, 90, 100), // raids the 92 only
  ...quiet(5, 25 * M15),
];
const trap = D.readArmingSweep(induceBase, "long");
eq("a raid of the minor pool with the obvious low unswept beyond is inducement", trap.inducementOnly, true);
eq("so nothing arms", trap.armingSweep, null);
eq("it names the raid that must not arm", trap.inducementSweep?.sweptLevel, 92);
eq("and the pool still standing beyond it", trap.unsweptBeyond?.price, 85);
check("and says so in words", /still unswept beyond/.test(trap.reason));

// Index 34 takes the 85. Now the arming raid exists.
const armed = [
  ...induceBase,
  ...quiet(4, 30 * M15),
  bar(34 * M15, 90, 100, 83, 95), // takes the low the inducement sat in front of
  ...Array.from({ length: 4 }, (_, i) => bar((35 + i) * M15, 95, 100, 90, 97)),
];
const arm = D.readArmingSweep(armed, "long");
eq("once the pool beyond is taken, this raid arms", arm.inducementOnly, false);
check("and it is the later raid, not the decoy", arm.armingSweep?.index === 34, `got ${arm.armingSweep?.index}`);
check("the decoy it cleared is named", arm.inducementSweep != null && arm.inducementSweep.index < 34);
eq("nothing is left standing beyond", arm.unsweptBeyond, null);

eq("a short reads the mirror pool", D.readArmingSweep(induceBase, "short").inducementSweep, null);
eq("too few bars is not an arm", D.readArmingSweep(quiet(5, 0), "long").inducementOnly, false);
// The existing measured veto must be untouched: shallow-then-deep is still
// what detectInducement reports, independent of the new test.
const ind = D.detectInducement(armed, "long");
check("detectInducement still reports the measured shallow-then-deep shape", ind.inducement === true && ind.mainSweep?.index === 34);

/* ================================================================== */
console.log("\nITEM 15 — blake is a swing, and a generic CISD is not one");
/* ================================================================== */

// low 90 (14) -> pullback high 115 (18) -> LOWER low 86 (22) -> body close
// back through 115 (23).
const blakeOk = [
  ...quiet(14, 0),
  bar(14 * M15, 100, 104, 90, 100),
  ...quiet(3, 15 * M15),
  bar(18 * M15, 100, 115, 99, 110),
  ...quiet(3, 19 * M15),
  bar(22 * M15, 100, 104, 86, 95),
  bar(23 * M15, 96, 122, 95, 120), // body CLOSE through the pullback high
  ...Array.from({ length: 3 }, (_, i) => bar((24 + i) * M15, 118, 124, 112, 120)),
];
const good = D.detectBlakeSwing(blakeOk, "long");
check("the full swing is a blake long", good.present, good.reason);
eq("the first low", good.swing?.firstExtreme.price, 90);
eq("the pullback high the body has to reclaim", good.swing?.pullback.price, 115);
eq("the lower low that took the first", good.swing?.takeExtreme.price, 86);
eq("the confirming body close", good.swing?.confirmClose, 120);
eq("the stop is the raid wick", good.swing?.stop, 86);
eq("the other side is not a blake", D.detectBlakeSwing(blakeOk, "short").present, false);

// THE DIFFERENTIAL. Same four-part shape, but the reclaim candle closes at
// 112 — under the pullback high. cisdThroughSeries says yes (a bullish close
// back through a run of bearish candles, over their open at 104); blake says
// no, because the pullback swing was never traded back through.
const cisdOnly = [
  ...quiet(14, 0),
  bar(14 * M15, 100, 104, 90, 100),
  ...quiet(3, 15 * M15),
  bar(18 * M15, 100, 115, 99, 110),
  bar(19 * M15, 104, 105, 95, 96),
  bar(20 * M15, 96, 97, 92, 93),
  bar(21 * M15, 93, 94, 90, 91),
  bar(22 * M15, 91, 92, 86, 88),
  bar(23 * M15, 88, 113, 87, 112), // closes through the RUN, not the pullback
  ...Array.from({ length: 3 }, (_, i) => bar((24 + i) * M15, 112, 114, 108, 112)),
];
eq("the generic CISD test fires on this tape", cisdThroughSeries(cisdOnly, "bull", 0), true);
const notBlake = D.detectBlakeSwing(cisdOnly, "long");
eq("blake does NOT — the pullback swing was never traded back through", notBlake.present, false);
check("and it says exactly that", /closed back through the pullback swing/.test(notBlake.reason), notBlake.reason);

// Same swing, but the reclaim candle only WICKS through 115 and closes under
// it — and nothing inside the confirmation window closes through either.
const underTail = Array.from({ length: 6 }, (_, i) => bar((24 + i) * M15, 112, 114, 108, 112));
const wickOnly = [...blakeOk.slice(0, 23), bar(23 * M15, 96, 120, 95, 112), ...underTail];
eq("a wick through the pullback high does not confirm", D.detectBlakeSwing(wickOnly, "long").present, false);
// A close beyond the level on a DOWN candle is not a body close through it.
const bearishClose = [...blakeOk.slice(0, 23), bar(23 * M15, 125, 126, 95, 118), ...underTail];
eq("a close beyond the level on a down candle is not a body close", D.detectBlakeSwing(bearishClose, "long").present, false);
check("the down-candle case is refused for the right reason", /closed back through the pullback swing/.test(D.detectBlakeSwing(bearishClose, "long").reason));

// No raid: the second low never takes the first.
const noTake = [
  ...quiet(14, 0),
  bar(14 * M15, 100, 104, 90, 100),
  ...quiet(3, 15 * M15),
  bar(18 * M15, 100, 115, 99, 110),
  ...quiet(3, 19 * M15),
  bar(22 * M15, 100, 104, 91, 95), // 91 > 90 — the first low still stands
  bar(23 * M15, 96, 122, 93, 120),
  ...Array.from({ length: 3 }, (_, i) => bar((24 + i) * M15, 118, 124, 112, 120)),
];
const na = D.detectBlakeSwing(noTake, "long");
eq("a shift with no raid of the prior low is not blake", na.present, false);
check("and the reason is the missing raid, not the missing close", /took the prior extreme/.test(na.reason), na.reason);
eq("too few bars is not a blake", D.detectBlakeSwing(quiet(5, 0), "long").present, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
