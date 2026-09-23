/**
 * The setup drawn before it exists — and the green light that must never lie.
 *
 * WHY EACH OF THESE IS WORTH PINNING
 *
 * 1. THE FLASH. Every other number on this desk is advice; the flash is an
 *    instruction. It is true only when every must has printed AND price is in
 *    the array, and the expensive failure this desk has already measured is
 *    entering early on a setup that looked nearly ready. So the headline test
 *    builds the most convincing wrong entry the renderer can produce — one
 *    must short, raid printed, displacement printed, price sitting inside the
 *    array — and demands a dark card. If only one test in this file survives,
 *    it is that one.
 *
 * 2. BOTH SIDES OF `gone`. A long that has fallen through the bottom of its
 *    array and a short that has run above the top are both dead, and they are
 *    dead in opposite directions. A sign error here does not throw, it does not
 *    fail a build, and it does not look wrong on screen — it shows a green
 *    light on a setup that has already left. Both sides are traced by hand
 *    against the real 2026-09-23 MNQ card rather than round numbers.
 *
 * 3. THE MARKUP THRESHOLD. The board prints "A+ 0.95" beside "SMC skip 1/5"
 *    because the engine grades how well a MODEL fits the tape and the sequence
 *    grades how much of the TRADE has printed. Either can earn the chart, so
 *    `drawWhy` has to print both numbers and say out loud that a score is not a
 *    readiness. A markup that quietly implies the trade is on is the exact
 *    picture a trader must not chase.
 *
 * 4. UNREACHABLE TARGETS. On 2026-09-23 two A+ cards (0.95 and 0.94) named
 *    draws 4.18 and 8.33 ATR away at a 0% base rate. Both real numbers are
 *    pinned here, along with the two near-misses that must NOT warn: far but
 *    common is a stretch, not a fantasy, and a thin sample at a near level is
 *    just a thin sample.
 *
 * 5. `watchFor`, PRINTED AND AWAITED. The sentence is what makes the markup
 *    usable at 09:35. Awaited marks must say what price has to DO, priced where
 *    the tape allows, rather than reporting that a layer is missing — a legend
 *    entry reading "sweep: missing" is not a chart.
 *
 * 6. DEAD LAYERS. A layer that failed for the session must never be dressed up
 *    as something to wait for, and `next` has to say that waiting will not fix
 *    it. Hope is the cheapest thing on a chart and the most expensive thing in
 *    a book.
 *
 * 7. NULL SAFETY. No canon, no draw, no zone, no price. Every one of those is a
 *    normal state at 09:29 and none of them may throw or flash.
 *
 * Run: npx tsx scripts/verify-setup-anticipation.mjs
 */
const { anticipate, targetReachable, MARKUP_MIN_ENGINE, MARKUP_MIN_PROGRESS } = await import(
  "../src/lib/trading/setup-anticipation.ts"
);

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

// THE NINE MUSTS smc-master ACTUALLY GATES ON.
//
// The first version of this file used ["dol","sweep","pd_half","ltf","retrace"]
// — a mix of canon ids and smc-master ids that matches NEITHER real object.
// CanonStack has five musts (htf, sweep, pd_half, ltf, time); smc-master has
// these nine. Because the fixture invented a third shape, all 126 assertions
// passed against a stack production never produces, while the real code let
// the flash fire inside Judas on a 0.42 "skip" card.
//
// A fixture that is wrong in the same direction as the code proves nothing.
// These are the ids smc-master emits, and `seq()` below hands the verdict over
// rather than letting anticipate() recount anything.
const MUSTS = ["dol", "htf", "sweep", "pd_half", "ltf", "time", "target", "retrace", "clean"];

/**
 * smc-master's read, as the shell now carries it. `word` is the gate — the
 * flash may never be more permissive than this.
 */
const seq = (passed, over = {}) => {
  // `over.musts` lets a boundary test build its own set (e.g. exactly 7 of 10
  // to sit ON the progress floor); everything else uses the real nine.
  const set = over.musts ?? MUSTS;
  const states = Object.fromEntries(
    set.map((id) => [id, passed.includes(id) ? "pass" : "wait"]),
  );
  for (const id of over.failed ?? []) states[id] = "fail";
  const mustPass = set.filter((id) => states[id] === "pass").length;
  return {
    word: over.word ?? (mustPass === set.length ? "TAKE" : "STAND"),
    mustPass,
    mustNeed: set.length,
    states,
    ...(over.raw ?? {}),
  };
};

const canonOf = (passed, musts = MUSTS) => ({
  score: 0,
  mustHits: musts.filter((id) => passed.includes(id)).length,
  mustNeed: musts.length,
  optionalHits: 0,
  grade: "skip",
  factors: musts.map((id) => ({ id, label: id, pass: passed.includes(id), must: true, detail: "" })),
  thesis: "",
  schoolHint: null,
  journalPrompt: [],
});

const card = (over = {}) => ({ id: "c1", symbol: "MNQ", side: "short", confluence: 0.95, grade: "A+", ...over });

const target = (name, atr, reach, price, side = "above") => ({
  name, price, kind: "pool", side,
  distancePoints: 0, distanceAtr: atr, liquidityWeight: 1,
  reachProbability: reach, swept: false, score: 0.5, why: [],
});

// The real 2026-09-23 MNQ short: entry array 30,870.75-30,901.75, invalidation
// 30,930.00, live price 30,838.25.
const ZONE = { top: 30901.75, bottom: 30870.75 };
const RAID = 30930.0;
const ALL = MUSTS;

console.log('\nthe flash cannot mean "nearly" — the one test that pays for this file');
// One must short. Every DRAWN element has printed and price is inside the
// array. Nothing on the chart looks unfinished. It must still be dark.
const nearly = anticipate({
  c: card(),
  canon: canonOf(["sweep", "pd_half", "ltf", "retrace"]), sequence: seq(["sweep", "pd_half", "ltf", "retrace"]),
  price: 30886.25,
  zone: ZONE,
  sweepLevel: RAID,
});
check("one must short is not live", nearly.entry, "not-yet");
check("and it does NOT flash", nearly.flash, false);
check("the raid had printed", nearly.marks.find((m) => m.kind === "sweep").state, "printed");
check("the displacement had printed", nearly.marks.find((m) => m.kind === "displacement").state, "printed");
check("price was inside the array", nearly.marks.find((m) => m.kind === "array").state, "printed");
check("4 of the 9 real musts", [nearly.mustPass, nearly.mustNeed], [4, 9]);
check("the card is still drawn — honestly, not greenly", nearly.draw, true);
check("and next falls back to the count, inventing nothing", nearly.next, "4/9 musts printed.");

// The mirror failure: sequence done, price nowhere near the array.
const armedShort = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: 30838.25, zone: ZONE, sweepLevel: RAID });
check("all musts printed with price outside the array is armed", armedShort.entry, "armed");
check("and armed does NOT flash", armedShort.flash, false);
ok("and next says the fill is the retrace, not the print", /the fill is the retrace, not the print/.test(armedShort.next));

// Complete AND inside. This, and only this, is green.
const live = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: 30886.25, zone: ZONE, sweepLevel: RAID });
check("complete AND in the array is live", live.entry, "live");
check("live is the only thing that flashes", live.flash, true);
ok("and next points at the price already written down", /at the price already named/.test(live.next));

console.log("\nentry state traced by hand on BOTH sides — a sign error shows green on a dead setup");
// Short: array 30,870.75-30,901.75. Above the top the move has gone without you.
const shortAt = (p) => anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: p, zone: ZONE, sweepLevel: RAID }).entry;
check("short at 30,935.00, above the top, is gone", shortAt(30935.0), "gone");
check("short at 30,901.75, the top itself, is live", shortAt(30901.75), "live");
check("short at 30,886.25, mid array, is live", shortAt(30886.25), "live");
check("short at 30,870.75, the bottom itself, is live", shortAt(30870.75), "live");
check("short at 30,838.25, below and not yet retraced, is armed", shortAt(30838.25), "armed");

// Long: same array, mirrored. Below the bottom the move has gone without you.
const longAt = (p) =>
  anticipate({ c: card({ side: "long" }), canon: canonOf(ALL), sequence: seq(ALL), price: p, zone: ZONE, sweepLevel: 30850.0 }).entry;
check("long at 30,838.25, below the bottom, is gone", longAt(30838.25), "gone");
check("long at 30,870.75, the bottom itself, is live", longAt(30870.75), "live");
check("long at 30,886.25, mid array, is live", longAt(30886.25), "live");
check("long at 30,935.00, above and not yet retraced, is armed", longAt(30935.0), "armed");

const goneShort = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: 30935.0, zone: ZONE, sweepLevel: RAID });
const goneLong = anticipate({ c: card({ side: "long" }), canon: canonOf(ALL), sequence: seq(ALL), price: 30838.25, zone: ZONE, sweepLevel: 30850.0 });
check("a gone short does not flash", goneShort.flash, false);
check("a gone long does not flash", goneLong.flash, false);
ok("the two sides disagree about 30,838.25, which is the whole point", goneLong.entry !== armedShort.entry);

console.log("\nwhen the chart earns its ink, and what the reason admits");
const hiEngine = anticipate({ c: card({ confluence: 0.95 }), canon: canonOf(["sweep"]), sequence: seq(["sweep"]) });
check("engine 0.95 at 1/9 musts is drawn", hiEngine.draw, true);
ok("the reason prints both numbers, so you can see which one earned it", /0\.95/.test(hiEngine.drawWhy) && /1\/9 musts/.test(hiEngine.drawWhy));
ok("it is labelled an ANTICIPATION, not a trade", /ANTICIPATION/.test(hiEngine.drawWhy));
ok("it says solid is printed and dashed is the watch", /solid is printed/.test(hiEngine.drawWhy) && /dashed is what you are waiting to see/.test(hiEngine.drawWhy));
ok("and it refuses to let the score mean ready", /does not say the trade is ready/.test(hiEngine.drawWhy));

const SEVEN = ["dol", "htf", "sweep", "pd_half", "ltf", "time", "target"];
const hiProgress = anticipate({ c: card({ confluence: 0.4 }), canon: canonOf(SEVEN), sequence: seq(SEVEN) });
check("engine 0.40 at 7/9 musts is drawn on the sequence alone", hiProgress.draw, true);
ok("the reason shows it was the sequence carrying it, not the score", /0\.40/.test(hiProgress.drawWhy) && /7\/9 musts/.test(hiProgress.drawWhy));
ok("and it still says the score does not make it ready", /does not say the trade is ready/.test(hiProgress.drawWhy));

const neither = anticipate({ c: card({ confluence: 0.84 }), canon: canonOf(["dol", "sweep", "pd_half"]), sequence: seq(["dol", "sweep", "pd_half"]) });
check("engine 0.84 at 3/9 musts is not drawn", neither.draw, false);
ok("and the reason names both thresholds it missed", /below both markup thresholds/.test(neither.drawWhy));
ok("a card that is not drawn never flashes", !neither.flash);

const tenMusts = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
const sevenOfTen = anticipate({ c: card({ confluence: 0.1 }), canon: canonOf(tenMusts.slice(0, 7), tenMusts), sequence: seq(tenMusts.slice(0, 7), { musts: tenMusts }) });
check("the thresholds are the documented ones", [MARKUP_MIN_ENGINE, MARKUP_MIN_PROGRESS], [0.85, 0.7]);
check("the engine threshold is inclusive", anticipate({ c: card({ confluence: MARKUP_MIN_ENGINE }), canon: canonOf([]), sequence: seq([]) }).draw, true);
check("7 of 10 sits exactly on the progress floor", sevenOfTen.progress, MARKUP_MIN_PROGRESS);
check("and the progress threshold is inclusive", sevenOfTen.draw, true);

console.log("\na target nobody reaches is a warning, not a target");
// The two real A+ draws from the 2026-09-23 board.
const far0 = target("PWH", 4.18, 0, 31500);
const farther0 = target("PMH", 8.33, 0, 32200);
const farCommon = target("PDH", 4.18, 0.4, 31500);
const nearRare = target("EQ", 0.3, 0, 30880);

check("4.18 ATR at 0% is unreachable", targetReachable(far0).reachable, false);
check("8.33 ATR at 0% is unreachable", targetReachable(farther0).reachable, false);
ok("the note prices the distance", /4\.2 ATR away/.test(targetReachable(far0).note));
ok("the farther one prices its own", /8\.3 ATR away/.test(targetReachable(farther0).note));
ok("and quotes the base rate that condemned it", /0% of prior sessions reached it/.test(targetReachable(far0).note));
ok("and calls it a direction, not a target", /not a target, it is a direction/.test(targetReachable(far0).note));
ok("and gives the action: price a nearer one or stand", /Price a nearer one or stand/.test(targetReachable(far0).note));

check("far but common is a stretch, not a fantasy", targetReachable(farCommon).reachable, true);
check("and carries no warning at all", targetReachable(farCommon).note, null);
check("near but rare is fine — a thin sample nearby is not a warning", targetReachable(nearRare).reachable, true);
check("and it too stays silent", targetReachable(nearRare).note, null);
check("no draw is not a refusal", targetReachable(null).reachable, true);
check("nor is an undefined one", targetReachable(undefined).note, null);
// Both conditions, at their edges — this is an AND, and it has to stay one.
check("exactly 3 ATR at exactly 10% is unreachable", targetReachable(target("X", 3, 0.1, 1)).reachable, false);
check("2.99 ATR at 0% is not far enough to warn", targetReachable(target("X", 2.99, 0, 1)).reachable, true);
check("3 ATR at 11% is not rare enough to warn", targetReachable(target("X", 3, 0.11, 1)).reachable, true);

const unreachable = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: 30886.25, zone: ZONE, sweepLevel: RAID, draw: far0 });
check("the card carries the verdict", unreachable.targetReachable, false);
ok("and the note travels with it", /not a target, it is a direction/.test(unreachable.targetNote));
ok("and the mark is labelled UNREACHABLE on the chart", /UNREACHABLE/.test(unreachable.marks.find((m) => m.kind === "target").label));
// Honest about what this does NOT do: the warning is ink, not a gate. The
// target gate is the smc-master "Target priced" must-layer, upstream of here.
check("the warning is ink on the chart, not a gate on the flash", unreachable.flash, true);

const reachable = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: 30886.25, zone: ZONE, sweepLevel: RAID, draw: farCommon });
const tMark = reachable.marks.find((m) => m.kind === "target");
check("a reachable target is labelled plainly", tMark.label, "Target PDH");
ok("and still quotes its base rate", /40% of prior sessions travelled this far/.test(tMark.watchFor));
check("the target is priced from the draw, never guessed", tMark.price, 31500);
check("and is never 'printed' — it is the thing being waited for", tMark.state, "awaited");

console.log("\nevery mark says what to SEE, printed and awaited alike");
const awaitedAll = anticipate({ c: card(), canon: canonOf([]), sequence: seq([]), price: 30838.25, zone: ZONE, sweepLevel: RAID, draw: farCommon });
const printedAll = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: 30886.25, zone: ZONE, sweepLevel: RAID, draw: farCommon });
const bothWays = [...awaitedAll.marks, ...printedAll.marks];
check("both states draw the same four elements", [awaitedAll.marks.length, printedAll.marks.length], [4, 4]);
ok("nothing is drawn without a sentence", bothWays.every((m) => typeof m.watchFor === "string" && m.watchFor.length > 30));
ok("and no sentence is just the label repeated", bothWays.every((m) => m.watchFor !== m.label));
ok("no sentence reports a layer as missing", bothWays.every((m) => !/missing/i.test(m.watchFor)));

const aSweep = awaitedAll.marks.find((m) => m.kind === "sweep");
check("the awaited raid is a mark, not a gap", aSweep.state, "awaited");
check("and the label names the pool being taken", aSweep.label, "BSL raid");
check("the anticipated raid is PRICED, so the line can be drawn today", aSweep.price, RAID);
ok("and the sentence carries that price too", aSweep.watchFor.includes("30930.00"));
ok("a short waits for price ABOVE the pool and a close back under", /must trade ABOVE/.test(aSweep.watchFor) && /close back under it/.test(aSweep.watchFor));
ok("and says a short without it is a guess", /a short here is a guess/.test(aSweep.watchFor));
const longSweep = anticipate({ c: card({ side: "long" }), canon: canonOf([]), sequence: seq([]), sweepLevel: 30850.0 }).marks.find((m) => m.kind === "sweep");
check("a long raids the other side of the book", longSweep.label, "SSL raid");
ok("and waits for price BELOW the pool", /must trade BELOW/.test(longSweep.watchFor));

const aDsp = awaitedAll.marks.find((m) => m.kind === "displacement");
ok("the awaited displacement describes the candle to look for", /one candle must close down through structure/.test(aDsp.watchFor));
ok("and sizes it against the recent range", /body bigger than the recent range/.test(aDsp.watchFor));
ok("and says it out loud: no displacement, no trade", /No displacement, no trade/.test(aDsp.watchFor));
check("it refuses to invent a price the tape has not given", aDsp.price, null);

const aArr = awaitedAll.marks.find((m) => m.kind === "array");
ok("the awaited array names both edges", aArr.watchFor.includes("30870.75") && aArr.watchFor.includes("30901.75"));
ok("and says do not chase the impulse", /Do not chase the impulse/.test(aArr.watchFor));
ok("and that the retrace IS the entry", /the retrace is the entry/.test(aArr.watchFor));
check("the array is drawn at its midpoint", aArr.price, 30886.25);

ok("the printed raid says the stops are gone", /Raid printed at 30930\.00/.test(printedAll.marks.find((m) => m.kind === "sweep").watchFor));
ok("and calls it the reversal's footprint", /reversal's footprint/.test(printedAll.marks.find((m) => m.kind === "sweep").watchFor));
ok("the printed displacement says the shift is on the tape", /Displacement printed/.test(printedAll.marks.find((m) => m.kind === "displacement").watchFor));
ok("the printed array says this is the fill", /This is the fill/.test(printedAll.marks.find((m) => m.kind === "array").watchFor));

console.log("\na dead layer is never dressed up as something to wait for");
const deadOne = anticipate({
  c: card(), canon: canonOf(["dol", "pd_half"]), sequence: seq(["dol", "pd_half"]), price: 30838.25, zone: ZONE, sweepLevel: RAID, deadLayers: ["sweep"],
});
check("the dead layer is struck through, not dashed", deadOne.marks.find((m) => m.kind === "sweep").state, "dead");
ok("and no mark of it is left awaited", !deadOne.marks.some((m) => m.kind === "sweep" && m.state === "awaited"));
ok("next says waiting will not fix it", /Waiting will not fix this one/.test(deadOne.next));
ok("and counts the one layer AND names it", /^1 layer failed for this session \(sweep\)\./.test(deadOne.next));
// A layer still awaited exists here — the death has to outrank it.
ok("the retrace is still awaited underneath", deadOne.marks.some((m) => m.kind === "array" && m.state === "awaited"));
ok("but the death outranks the next thing to watch", !/come BACK into/.test(deadOne.next));
check("and a dead card never flashes", deadOne.flash, false);

const deadTwo = anticipate({
  c: card(), canon: canonOf(["dol", "pd_half"]), sequence: seq(["dol", "pd_half"]), price: 30838.25, zone: ZONE, sweepLevel: RAID, deadLayers: ["sweep", "ltf"],
});
check("the second dead layer is dead too", deadTwo.marks.find((m) => m.kind === "displacement").state, "dead");
ok("and two are counted in the plural, both named", /^2 layers failed for this session \(/.test(deadTwo.next) && /sweep/.test(deadTwo.next) && /ltf/.test(deadTwo.next));
check("two dead layers still do not flash", deadTwo.flash, false);

console.log("\nno canon, no draw, no zone, no price — refuse, never guess");
const bare = anticipate({ c: { symbol: "MNQ", side: "short" } });
check("a bare candidate scores zero, not NaN", bare.engine, 0);
check("progress is zero, never divided by a zero must-count", bare.progress, 0);
check("and it is not drawn", bare.draw, false);
check("there is nothing to arm", bare.entry, "not-yet");
check("and nothing flashes", bare.flash, false);
check("only the displacement can be drawn with no prices at all", bare.marks.length, 1);
ok("and it still carries a real sentence", bare.marks[0].watchFor.length > 30);
check("no draw means no target verdict to trip over", bare.targetNote, null);
check("and no target verdict reads as reachable, not as a refusal", bare.targetReachable, true);

const noFactors = anticipate({ c: card(), canon: { factors: undefined } });
check("a canon with no factors does not throw", noFactors.mustNeed, 1);
check("and is never complete", noFactors.entry, "not-yet");
check("and never flashes", noFactors.flash, false);

const noMusts = anticipate({ c: card(), canon: canonOf([], []), sequence: seq([], []), price: 30886.25, zone: ZONE });
check("a canon with zero must-layers is never vacuously complete", noMusts.entry, "not-yet");
check("and never flashes on an empty sequence", noMusts.flash, false);

const noPrice = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), zone: ZONE, sweepLevel: RAID });
check("a complete sequence with no price is armed, not live", noPrice.entry, "armed");
check("an unknown price never flashes", noPrice.flash, false);
const nullPrice = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: null, zone: ZONE, sweepLevel: RAID });
check("an explicitly null price likewise", nullPrice.flash, false);

const noZone = anticipate({ c: card(), canon: canonOf(ALL), sequence: seq(ALL), price: 30886.25, zone: null, sweepLevel: RAID });
check("a complete sequence with no array is armed", noZone.entry, "armed");
check("with nothing to be inside, nothing flashes", noZone.flash, false);
check("and no array mark is invented", noZone.marks.some((m) => m.kind === "array"), false);

console.log("\nthe invariant, across every fixture above");
const all = [
  nearly, armedShort, live, goneShort, goneLong, hiEngine, hiProgress, neither, sevenOfTen,
  unreachable, reachable, awaitedAll, printedAll, deadOne, deadTwo, bare, noFactors, noMusts,
  noPrice, nullPrice, noZone,
];
ok("flash is true if and only if entry is live", all.every((a) => a.flash === (a.entry === "live")));
ok("no incomplete sequence flashes, ever", all.every((a) => a.mustPass >= a.mustNeed || !a.flash));
ok("every mark carries a state we can draw", all.every((a) => a.marks.every((m) => ["printed", "awaited", "dead"].includes(m.state))));
ok("every mark carries a sentence", all.every((a) => a.marks.every((m) => typeof m.watchFor === "string" && m.watchFor.length > 20)));
ok("every card says why it is or is not drawn", all.every((a) => typeof a.drawWhy === "string" && a.drawWhy.length > 20));
ok("every card names a single next thing", all.every((a) => typeof a.next === "string" && a.next.length > 10));
ok("a price is either a number or null, never NaN", all.every((a) => a.marks.every((m) => m.price === null || Number.isFinite(m.price))));


console.log("\nTHE REGRESSION THAT SHIPPED — the flash must never be weaker than the desk's own TAKE");
// Reviewer's reproduced case, 2026-09-23: five canon musts standing in for
// nine let the flash fire inside the Judas window on a 0.42-confluence "skip"
// card with the R:R unpriced and the draw pointing the wrong way. Every one of
// these must stay false forever.
const inZone = { price: 30886.25, zone: ZONE, sweepLevel: RAID };

const judas = anticipate({
  c: card({ confluence: 0.42, grade: "skip" }),
  canon: canonOf(["htf", "sweep", "pd_half", "ltf", "time"]),
  sequence: seq(["htf", "sweep", "pd_half", "ltf", "time", "dol", "target", "retrace"], {
    word: "STAND",
    failed: ["clean"],
  }),
  ...inZone,
});
check("eight of nine, price in the array, but the desk says STAND", judas.entry, "not-yet");
check("IT DOES NOT FLASH", judas.flash, false);
ok("and the dead layer is visible, not silent", judas.marks.some((m) => m.state === "dead") || /will not fix/.test(judas.next));

const canonOnly = anticipate({
  c: card({ confluence: 0.95 }),
  canon: canonOf(["htf", "sweep", "pd_half", "ltf", "time"]),
  sequence: seq(["htf", "sweep", "pd_half", "ltf", "time"], { word: "WAIT" }),
  ...inZone,
});
check("all FIVE canon musts printed is not a TAKE", canonOnly.entry, "not-yet");
check("and it does not flash", canonOnly.flash, false);

const halted = anticipate({
  c: card(), canon: canonOf(MUSTS), sequence: seq(MUSTS), entryAllowed: false, ...inZone,
});
check("a complete sequence with entry blocked does not flash", halted.flash, false);
ok(
  "all nine printed WITH entry allowed does flash",
  anticipate({ c: card(), canon: canonOf(MUSTS), sequence: seq(MUSTS), entryAllowed: true, ...inZone }).flash,
);

check("no sequence cannot flash", anticipate({ c: card(), canon: canonOf(MUSTS), ...inZone }).flash, false);

const arrPrinted = anticipate({ c: card(), canon: canonOf([]), sequence: seq(MUSTS), ...inZone });
ok("the array mark can actually reach printed", arrPrinted.marks.some((m) => m.kind === "array" && m.state === "printed"));
ok(
  "and it never says come BACK while the card is live",
  !arrPrinted.marks.some((m) => m.kind === "array" && m.state === "printed" && /come BACK/.test(m.watchFor)),
);

for (const id of ["clean", "dol", "target", "pd_half", "htf", "time"]) {
  const f = anticipate({
    c: card(), canon: canonOf(MUSTS),
    sequence: seq(MUSTS.filter((x) => x !== id), { word: "STAND", failed: [id] }),
    ...inZone,
  });
  check(`a failed ${id} cannot flash`, f.flash, false);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
