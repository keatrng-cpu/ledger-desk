/**
 * The PATH walkthrough and the setup memory.
 *
 * Two things are pinned here because both are places a comfortable lie would
 * be easy to ship:
 *   1. The walkthrough must RECONCILE the engine grade against the sequence,
 *      not pick a winner. On screen the desk currently shows STAND 3/9 and
 *      A+ 0.87 within one scroll and explains neither.
 *   2. The memory must derive WHY from expectation-versus-print, never from a
 *      note written after the outcome. A reason written afterwards is a story
 *      about a result.
 *
 * Run: npx tsx scripts/verify-setup-memory.mjs
 */
const { walkthrough, shouldMarkUp, MARKUP_MIN_PROGRESS } = await import(
  "../src/lib/trading/setup-steps.ts"
);
const { fingerprint, shapeLabel, attribute, recallShapes, recallFor, MIN_N_FOR_LESSON } =
  await import("../src/lib/trading/setup-memory.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const ok = (name, cond) => check(name, !!cond, true);

const L = (id, label, must, state, detail = "") => ({ id, label, must, state, detail });
// The exact situation in the screenshots: A+ 0.87 on the model, 3/9 sequence.
const book = {
  symbol: "MNQ",
  side: "short",
  word: "STAND",
  dealing: null,
  missing: "Liquidity sweep",
  missingDetail: "no raid yet",
  mustPass: 3,
  mustNeed: 9,
  layers: [
    L("dol", "Draw on liquidity", true, "fail", "PDH above, price below."),
    L("htf", "HTF bias + DOL", true, "pass", "HTF bear agrees."),
    L("sweep", "Liquidity sweep", true, "wait", "No raid yet."),
    L("pd_half", "POI in correct half", true, "pass", "Premium."),
    L("ltf", "LTF shift + displacement", true, "wait", "No MSS."),
    L("kz", "Kill zone", true, "wait", "Asia range."),
    L("target", "Target priced >= 1:1", true, "wait", "No plan priced."),
    L("retrace", "Retrace into array", true, "wait", "Price outside."),
    L("news", "Judas / news", true, "pass", "Clear."),
    L("smt", "SMT (optional)", false, "wait", "None."),
  ],
  canon: {},
  entry: "",
  invalidation: "",
  t1: "",
  t2: "",
  pathBand: null,
  plan: null,
};

console.log("\nthe walkthrough — order, not a grid");
const w = walkthrough(book, { score: 0.87, grade: "A+", model: "Judas" });
check("every layer becomes a numbered step", w.steps.length, 10);
check("steps are numbered from one", w.steps[0].n, 1);
check("a passing must is done", w.steps.find((s) => s.id === "htf").status, "done");
check("a waiting must is waiting", w.steps.find((s) => s.id === "sweep").status, "waiting");
check("a failed must is failed", w.steps.find((s) => s.id === "dol").status, "failed");
check("a non-must is optional", w.steps.find((s) => s.id === "smt").status, "optional");

// The current step is the first must not done — step 1 here, because DOL failed.
const current = w.steps.filter((s) => s.current);
check("exactly one step is current", current.length, 1);
check("and it is the first must not done", current[0].id, "dol");
ok("the next action names the step number", /Step 1/.test(w.nextAction));
ok("and says waiting will not fix a failure", /Waiting will not fix it/.test(w.nextAction));

console.log("\nreconciling A+ 0.87 against STAND 3/9 — the thing on screen today");
ok("the reconciliation names both numbers", /0\.87/.test(w.reconcile) && /3\/9/.test(w.reconcile));
ok("it says they are not in conflict", /not in conflict/.test(w.reconcile));
ok("it says the sequence authorises, not the grade", /sequence authorises the entry, never the grade/.test(w.reconcile));
ok("and warns when a must has already died today", /already failed for this session/.test(w.reconcile));
check("progress is musts passed over musts needed", w.progress, 3 / 9);

// A complete sequence must read as agreement.
const done = { ...book, word: "TAKE", mustPass: 9, layers: book.layers.map((l) => ({ ...l, state: "pass" })) };
const wd = walkthrough(done, { score: 0.87, grade: "A+", model: "Judas" });
ok("a complete sequence says both agree", /Both agree/.test(wd.reconcile));
ok("and the next action is the entry at the named price", /not a better one/.test(wd.nextAction));
check("no step is current when nothing is outstanding", wd.steps.filter((s) => s.current).length, 0);

console.log("\nwhen the chart earns its ink");
check("a 3/9 setup is not drawn", shouldMarkUp(w, 0.87).mark, false);
ok("and it says why a high grade is not enough", /a model's opinion, not a trade/.test(shouldMarkUp(w, 0.87).why));
check("a complete sequence is always drawn", shouldMarkUp(wd, 0.87).mark, true);
// 7 of 9 with nothing failed clears the bar; the same 7 with a dead must does not.
const near = {
  ...book,
  mustPass: 7,
  layers: book.layers.map((l, i) => ({ ...l, state: i < 7 || !l.must ? "pass" : "wait" })),
};
ok("7 of 9 with nothing failed is drawn", shouldMarkUp(walkthrough(near), 0.7).mark);
const nearDead = { ...near, layers: near.layers.map((l, i) => (i === 8 ? { ...l, state: "fail" } : l)) };
check("the same 7 with a dead must is not", shouldMarkUp(walkthrough(nearDead), 0.7).mark, false);
ok("the threshold is a real constant", MARKUP_MIN_PROGRESS > 0 && MARKUP_MIN_PROGRESS < 1);

console.log("\nthe shape key groups the same KIND of trade");
const a = { model: "Judas", side: "short", killzone: "NY AM", drawKind: "PDH", missing: ["sweep"], reachTier: "clean" };
check("same shape, same key", fingerprint(a), fingerprint({ ...a }));
ok("different model is a different shape", fingerprint(a) !== fingerprint({ ...a, model: "TJR" }));
ok("different killzone is a different shape", fingerprint(a) !== fingerprint({ ...a, killzone: "London" }));
check("missing-layer order does not matter", fingerprint({ ...a, missing: ["sweep", "ltf"] }), fingerprint({ ...a, missing: ["ltf", "sweep"] }));
ok("the label is readable", /Judas short in NY AM/.test(shapeLabel(a)));

console.log("\nthe WHY is derived from expectation vs print, never from a note");
const exp = { entry: 100, stop: 97, t1: 106, t2: 112, rr1: 2, reachT1: 0.6, reachT2: 0.3, expR: 0.2 };
const O = (o) => ({ filled: true, mfePts: 0, maePts: 0, hitT1: false, hitT2: false, hitStop: false, resultR: 0, drawTradedLater: null, ...o });

check("never filled", attribute(exp, O({ filled: false }), "long").attribution, "never_filled");
ok("and blames the entry, not the read", /says nothing about whether the read was right/.test(attribute(exp, O({ filled: false }), "long").lesson));

check("reached T2", attribute(exp, O({ hitT1: true, hitT2: true, resultR: 4 }), "long").attribution, "full");
check("T1 only", attribute(exp, O({ hitT1: true, resultR: 1 }), "long").attribution, "t1_only");
ok("and points at runnerWorthIt rather than assuming the hold was wrong", /runnerWorthIt/.test(attribute(exp, O({ hitT1: true, resultR: 1 }), "long").lesson));

// The expensive distinction: stopped and the draw traded anyway vs never traded.
const stoppedThenRan = attribute(exp, O({ hitStop: true, resultR: -1, drawTradedLater: true }), "long");
check("stopped", stoppedThenRan.attribution, "stopped");
ok("stop-then-draw-traded blames the stop, not the read", /DIRECTION was right/.test(stoppedThenRan.lesson));
const stoppedDead = attribute(exp, O({ hitStop: true, resultR: -1, drawTradedLater: false }), "long");
ok("stop-and-draw-never-traded blames the read", /READ was wrong/.test(stoppedDead.lesson));
ok("unrecorded draw outcome asks for it", /Record it/.test(attribute(exp, O({ hitStop: true, resultR: -1 }), "long").lesson));

const missed = attribute(exp, O({ mfePts: 4, resultR: 0 }), "long");
check("filled, right way, no T1, no stop", missed.attribution, "target_missed");
ok("and blames the target", /TARGET was too far/.test(missed.lesson));

console.log("\nthe memory refuses to conclude early");
const rec = (i, r, o = {}) => ({
  id: `r${i}`, at: "2026-09-01", symbol: "MNQ", side: "long",
  fingerprint: fingerprint(a), shape: shapeLabel(a), model: "Judas", killzone: "NY AM",
  word: "STAND", missingAtEntry: ["sweep"], expectation: exp,
  outcome: O({ resultR: r, ...o }), note: null, notePreRegistered: false,
});
const few = recallShapes([rec(1, 1), rec(2, -1), rec(3, 1)]);
check("three records is one shape", few.length, 1);
check("and n is three", few[0].n, 3);
check("no lesson below the floor", few[0].lesson, null);
ok("and it says a record is not a lesson", /record, not a lesson/.test(few[0].line));

// Ten of the same failure must produce the lesson.
const many = Array.from({ length: 10 }, (_, i) => rec(i, -1, { hitStop: true, drawTradedLater: false }));
const shaped = recallShapes(many);
check("ten records clears the floor", shaped[0].n, 10);
ok("and names the dominant failure mode", /stopped/.test(shaped[0].lesson));
check("the breakdown counts every stop", shaped[0].byAttribution.stopped, 10);
ok("the line reports WR and expectancy", /0% WR/.test(shaped[0].line));

// Open records must never enter the statistics.
const withOpen = recallShapes([...many, { ...rec(99, 0), outcome: null }]);
check("an open trade is not counted", withOpen[0].n, 10);

console.log("\nwhat the desk says when the shape reappears");
ok("a thin history is shown but disclaimed", /Too few to mean anything/.test(recallFor([rec(1, 1)], fingerprint(a))));
ok("a real history is surfaced", /SEEN BEFORE/.test(recallFor(many, fingerprint(a))));
check("an unknown shape says nothing", recallFor(many, "no|such|shape"), null);
ok("the floor is a real constant", MIN_N_FOR_LESSON >= 5);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
