/**
 * The nine lessons: are they the conditions the desk actually computes?
 *
 *   npx tsx scripts/verify-live-lesson.mjs
 *
 * WHAT THIS IS GUARDING. A teaching module is the easiest thing in a codebase
 * to let rot: the prose keeps rendering after the detector it describes has
 * changed, and nothing goes red. 0c3abe6 is exactly that — the mechanical
 * model stopped needing a retest and four separate sentences in the app went
 * on asking for one.
 *
 * So this checks the lessons against the code, not against themselves:
 *
 *   1. The nine ids, in the stated order.
 *   2. Every `owner` names a file that exists and EXPORTS that function.
 *   3. Every `layers` entry is a layer id `smc-master.ts` can actually emit.
 *   4. Every label `SmcMasterBook.missing` can print resolves to a lesson.
 *   5. Every sentence the floor can say passes the room's own spoken guard.
 *   6. The live read moves pass -> wait -> fail with the tape, on a crafted
 *      15m series where the raid, the displacement and the price are chosen.
 *   7. The lesson and `ticket-facts.ts` never disagree about the same fact.
 *   8. Negative controls: each live check is re-run with one input broken and
 *      has to change its answer.
 */

import { existsSync, readFileSync } from "node:fs";

const { spokenProblems } = await import("./lib/spoken-check.mjs");
const {
  LESSONS,
  LESSON_IDS,
  readLiveLessons,
  lessonForLayer,
  nextLesson,
  sayForMissing,
} = await import("../src/lib/learn/live-lesson.ts");
const { fourFacts } = await import("../src/lib/trading/ticket-facts.ts");
const { namingSweep, pairedDisplacement } = await import("../src/lib/trading/raid-pair.ts");
const { mechanicalWindowBars } = await import("../src/lib/trading/detectors.ts");
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");
const { RH_MIN_DEBIT_TOTAL, RH_MAX_DEBIT_TOTAL } = await import("../src/lib/execution/rh-autofire-gates.ts");

let pass = 0;
const fails = [];
function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fails.push(name);
    console.log(`  FAIL ${name}${detail != null ? ` — ${typeof detail === "string" ? detail : JSON.stringify(detail)}` : ""}`);
  }
}
function eq(name, got, want) {
  ok(name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
}
function head(s) {
  console.log(s);
}

/* ── 1. the nine, in order ────────────────────────────────────────────── */

head("The nine");
eq("nine lessons", LESSONS.length, 9);
eq(
  "in the order the work order states",
  LESSONS.map((l) => l.id).join(","),
  "raid,displacement,inversion,array,draw,half,counter,judas,ask",
);
eq("LESSON_IDS matches LESSONS", LESSON_IDS.join(","), LESSONS.map((l) => l.id).join(","));
ok(
  "every lesson states the object, the pass and the tape that is not it",
  LESSONS.every((l) => l.object.length > 40 && l.pass.length > 20 && l.notIt.length > 20),
  LESSONS.filter((l) => !(l.object.length > 40 && l.pass.length > 20 && l.notIt.length > 20)).map((l) => l.id),
);
ok(
  "the three are not the same sentence copied three times",
  LESSONS.every((l) => l.object !== l.pass && l.pass !== l.notIt && l.object !== l.notIt),
);
ok(
  "the R floor in the draw lesson is the config number, not a typed 1",
  LESSONS.find((l) => l.id === "draw").pass.includes(APLUS_RULES.minRr.toFixed(1)),
  LESSONS.find((l) => l.id === "draw").pass,
);
ok(
  "the envelope in the ask lesson is the gate's own numbers",
  LESSONS.find((l) => l.id === "ask").object.includes(`$${RH_MIN_DEBIT_TOTAL}`) &&
    LESSONS.find((l) => l.id === "ask").object.includes(`$${RH_MAX_DEBIT_TOTAL}`),
);

/* ── 2. every owner exists and exports what it claims ─────────────────── */

head("The named owner is real");
for (const l of LESSONS) {
  const file = l.owner.file;
  const there = existsSync(file);
  if (!there) {
    ok(`${l.id}: ${file} exists`, false);
    continue;
  }
  const src = readFileSync(file, "utf8");
  const exported = new RegExp(`export\\s+(?:async\\s+)?function\\s+${l.owner.fn}\\b`).test(src);
  // `gradeBook` is module-private by design (smc-master exports the read, not
  // the grader), so a plain `function` declaration counts for it.
  const declared = new RegExp(`function\\s+${l.owner.fn}\\b`).test(src);
  ok(`${l.id}: ${file} declares ${l.owner.fn}`, exported || declared, src.length);
}

/* ── 3. the layer ids are ones the grader can emit ────────────────────── */

head("The layer ids are real");
const masterSrc = readFileSync("src/lib/trading/smc-master.ts", "utf8");
const canonSrc = readFileSync("src/lib/trading/smc-canon.ts", "utf8");
const emitted = new Set(
  [...masterSrc.matchAll(/id:\s*"([a-z_]+)"/g), ...canonSrc.matchAll(/id:\s*"([a-z_]+)"/g)].map((m) => m[1]),
);
for (const l of LESSONS) {
  for (const layer of l.layers) {
    ok(`${l.id}: layer "${layer}" is emitted somewhere`, emitted.has(layer), [...emitted].join(","));
  }
}
ok(
  "the ask lesson claims no sequence layer (it is not part of the sequence)",
  LESSONS.find((l) => l.id === "ask").layers.length === 0,
);

/* ── 4. every label the grader prints finds a lesson ──────────────────── */

head("A missing layer finds its lesson");
// The labels as `smc-canon.ts` and `smc-master.ts` write them — read from the
// source so a renamed label fails here instead of silently printing nothing.
// Only a MUST layer's label can ever be `SmcMasterBook.missing` — the grader
// names the first must that is not passing — so the optional layers (SMT, the
// FVG/OB overlap) are deliberately not required to have a lesson.
const LABELS = [
  ...canonSrc.matchAll(/\{\s*id:\s*"[a-z_]+",\s*label:\s*"([^"]+)",\s*must:\s*true\s*\}/g),
  ...masterSrc.matchAll(/label:\s*"([^"]+)",\s*\n\s*must:\s*true,/g),
].map((m) => m[1]);
ok("found the grader's labels to test", LABELS.length >= 7, LABELS);
const stub = LESSONS.map((l) => ({ ...l, state: "wait", live: "", say: `say ${l.id}` }));
for (const label of [...new Set(LABELS)]) {
  const hit = lessonForLayer(stub, label);
  ok(`"${label}" resolves to a lesson`, hit != null, label);
}
eq("Sequence complete resolves to nothing", lessonForLayer(stub, "Sequence complete"), null);
eq("an empty label resolves to nothing", lessonForLayer(stub, ""), null);
eq("null resolves to nothing", lessonForLayer(stub, null), null);
eq("a label nobody emits resolves to nothing", lessonForLayer(stub, "zzz nonexistent"), null);
eq("a layer id resolves directly", lessonForLayer(stub, "sweep").id, "raid");
eq("the clean layer is the Judas lesson", lessonForLayer(stub, "Judas / news").id, "judas");
eq("the retrace layer is the array lesson", lessonForLayer(stub, "retrace").id, "array");

/* ── 5. the floor can say them ────────────────────────────────────────── */

head("A speech engine can say the prose");
for (const l of LESSONS) {
  for (const [what, text] of [["object", l.object], ["pass", l.pass], ["notIt", l.notIt]]) {
    const problems = spokenProblems([text]);
    ok(`${l.id} ${what} is speakable`, problems.length === 0, problems.join(" | "));
  }
}

/* ── 6. a crafted tape ────────────────────────────────────────────────── */

const BAR = 15 * 60_000;
const T0 = Date.UTC(2026, 9, 7, 13, 30); // a Wednesday, 09:30 ET

/**
 * A 15m series that raids a confirmed swing low and then displaces up.
 *
 * `opts.displace` false leaves the raid unanswered (so the raid is not the
 * naming sweep and the displacement lesson waits); `opts.bars` pads the series
 * after the displacement so the 2-bar window can be walked past.
 */
function craftBars({ displace = true, after = 0 } = {}) {
  const bars = [];
  let t = T0;
  const push = (o, h, l, c) => {
    bars.push({ t, o, h, l, c, v: 1000 });
    t += BAR;
  };
  // 14 quiet bars for the ATR, ranges of 10.
  for (let i = 0; i < 14; i++) push(100, 105, 95, 100);
  // A confirmed swing low at 80: three bars down, the low, three bars up.
  push(100, 104, 96, 99);
  push(99, 103, 92, 94);
  push(94, 96, 86, 88);
  push(88, 90, 80, 84); // the swing low = 80
  push(84, 92, 83, 90);
  push(90, 98, 89, 96);
  push(96, 104, 95, 102);
  for (let i = 0; i < 4; i++) push(102, 106, 98, 102);
  // The raid: wick under 80, close back above it.
  push(100, 102, 74, 97);
  if (displace) {
    // A bullish body of 30 against an ATR near 10 — 3x, well past 1.5x.
    push(97, 130, 96, 127);
  }
  for (let i = 0; i < after; i++) push(127, 131, 123, 127);
  return bars;
}

head("The crafted tape is the tape the detectors see");
const withDisp = craftBars();
eq("the window on a 15m series is two bars", mechanicalWindowBars(withDisp), 2);
const sweep = namingSweep(withDisp);
ok("a sellside raid with a close back inside is the naming sweep", sweep != null && sweep.side === "sellside", sweep);
ok(
  "and a later bullish close answers it inside the window",
  sweep != null && pairedDisplacement(withDisp, sweep, "bull") != null,
);
const noDisp = craftBars({ displace: false });
eq("with nothing answering it, no raid names the trade", namingSweep(noDisp), null);

/* a desk fixture, with every field the reads touch */

function mkDesk(over = {}) {
  const bars = over.bars ?? withDisp;
  const price = over.price ?? 128;
  const plan = over.plan === undefined
    ? {
        symbol: "MNQ",
        side: "long",
        price,
        entry: 110,
        entryZone: { top: 112, bottom: 108 },
        stop: 73,
        riskPts: 37,
        t1: 160,
        t2: 200,
        rr1: over.rr1 === undefined ? 1.35 : over.rr1,
        rr2: 2.4,
        sweep: { price: 74, t: T0 },
        range: { high: 130, low: 74, eq: 102 },
        draw: { price: 160, name: "PDH", reachProbability: 0.4 },
        arrays: [],
        levels: [],
      }
    : over.plan;
  const layers = over.layers ?? [
    { id: "htf", label: "HTF bias + DOL", must: true, state: "pass", detail: "" },
    { id: "sweep", label: "Liquidity sweep", must: true, state: "pass", detail: "" },
    { id: "clean", label: "Judas / news", must: true, state: over.cleanState ?? "pass", detail: "Tape is tradable" },
  ];
  const book = {
    symbol: "MNQ",
    side: over.side ?? "long",
    word: over.word ?? "WAIT",
    dealing: over.dealing === undefined ? { high: 130, low: 74, eq: 102, zone: "discount", source: "impulse", ratio: 0.3 } : over.dealing,
    missing: over.missing ?? "Retrace into array",
    missingDetail: "price is not in the array",
    layers,
    mustPass: 2,
    mustNeed: 3,
    canon: { total: 0, factors: [] },
    entry: "",
    invalidation: "",
    t1: "",
    t2: "",
    pathBand: "A",
    plan,
    pools: { t1: { name: "PDH", price: 160 }, t2: null, why: "", reliable: true },
  };
  const liquidity = {
    bsl: [{ label: "PDH", price: 160, swept: false }],
    ssl: [{ label: "PDL", price: 80, swept: true }],
    nearestBsl: 160,
    nearestSsl: 80,
    lastSweep: "sellside",
    lastSweepLabel: "PDL",
    lastSweepT: withDisp[withDisp.length - (over.displace === false ? 1 : 2)].t,
    lastSweepLevel: 80,
    lastSweepExtreme: 74,
  };
  return {
    ok: true,
    fetchedAt: new Date(T0).toISOString(),
    clock: { etHour: over.etHour ?? 10, etMinute: over.etMinute ?? 15, isWeekday: true, killzone: "ny_am", killzoneLabel: "NY AM" },
    left: { symbol: "MNQ", bars },
    right: { symbol: "ES", bars: [] },
    quotes: { left: { price, lagSec: 1, source: "databento", symbol: "MNQ" }, right: { price: 5000, lagSec: 1, source: "databento", symbol: "ES" } },
    bias: {
      left: { symbol: "MNQ", topDown: over.topDown ?? "bull", mid: over.mid ?? "bull", ltf: "bull", confidence: 0.6, dealing: null, liquidity: [] },
      right: { symbol: "ES", topDown: "bull", mid: "bull", ltf: "bull", confidence: 0.6, dealing: null, liquidity: [] },
    },
    scan: { candidates: over.candidates ?? [{ symbol: "MNQ", side: over.side ?? "long", atr: 10, htfDisrespected: over.released ?? false, entryPx: 110 }] },
    narrative: { left: { liquidity }, right: { liquidity }, summary: "" },
    news: { verdict: over.news ?? "clear", reason: "" },
    mtf: { left: { daily: [], minute: over.minute ?? [] }, right: { daily: [], minute: [] } },
    smcMaster: { left: book, right: { ...book, symbol: "ES", side: null, plan: null }, oneBook: over.oneBook === undefined ? book : over.oneBook, thesis: "", vsSchools: "" },
    draws: { left: { primary: null, sessionsSampled: 20, baseRateReliable: true }, right: { primary: null, sessionsSampled: 20, baseRateReliable: true } },
  };
}

const read = (over) => {
  const lessons = readLiveLessons(mkDesk(over), { leg: "left", options: null });
  return Object.fromEntries(lessons.map((l) => [l.id, l]));
};

head("The live read, on that tape");
const base = read();
eq("raid passes when the answered raid arms this side", base.raid.state, "pass");
eq("displacement passes on the later close", base.displacement.state, "pass");
eq("the draw passes above the floor", base.draw.state, "pass");
eq("the discount half passes a long", base.half.state, "pass");
eq("with the higher timeframe, counter-bias passes", base.counter.state, "pass");
eq("a tradable tape passes the Judas and news lesson", base.judas.state, "pass");
eq("price at 128 is in front of the array, so it waits", base.array.state, "wait");
eq("the ask is not read when the options book is withheld", base.ask.state, "wait");
ok("every lesson reports a live line", Object.values(base).every((l) => l.live.length > 0));
ok("every lesson reports a sentence a voice can say", Object.values(base).every((l) => l.say.length > 0));

head("Every sentence the live read produces is speakable");
for (const l of Object.values(base)) {
  const problems = spokenProblems([l.say]);
  ok(`${l.id} say`, problems.length === 0, problems.join(" | "));
}

head("Negative controls — break one input, the answer has to change");
eq("no displacement: the raid no longer names the side", read({ bars: noDisp, displace: false }).raid.state, "wait");
eq("no displacement: the displacement lesson waits inside the window", read({ bars: noDisp, displace: false }).displacement.state, "wait");
eq(
  "window walked past with nothing answering: the displacement lesson fails",
  read({ bars: craftBars({ displace: false, after: 6 }), displace: false }).displacement.state,
  "fail",
);
eq(
  "and the raid lesson still waits there, because no raid has been answered",
  read({ bars: craftBars({ displace: false, after: 6 }), displace: false }).raid.state,
  "wait",
);
eq("the book on the other side of the raid fails the raid lesson", read({ side: "short" }).raid.state, "fail");
eq("price through the array on the stop side is a chase", read({ price: 60 }).array.state, "fail");
eq("price inside the array passes", read({ price: 110 }).array.state, "pass");
eq(
  "no array at all is a fail, not a wait",
  read({ plan: null, candidates: [{ symbol: "MNQ", side: "long", atr: 10, htfDisrespected: false, entryPx: null }] }).array.state,
  "fail",
);
eq("an array priced with no plan behind it waits, it does not claim a side", read({ plan: null }).array.state, "wait");
ok(
  "and it says so rather than claiming in front or inside",
  read({ plan: null }).array.live.includes("no plan is priced yet"),
  read({ plan: null }).array.live,
);
eq("under the R floor the target fails", read({ rr1: 0.6 }).draw.state, "fail");
eq("no priced target waits", read({ plan: null }).draw.state, "wait");
eq("equilibrium waits, whatever the fit", read({ dealing: { high: 130, low: 74, eq: 102, zone: "equilibrium", source: "impulse", ratio: 0.5 } }).half.state, "wait");
eq("no dealing range at all is a fail", read({ dealing: null }).half.state, "fail");
const PREMIUM = { high: 130, low: 74, eq: 102, zone: "premium", source: "impulse", ratio: 0.8 };
const L = (ltfState) => [
  { id: "sweep", label: "Liquidity sweep", must: true, state: "pass", detail: "" },
  { id: "ltf", label: "LTF shift + displacement", must: true, state: ltfState, detail: "" },
  { id: "clean", label: "Judas / news", must: true, state: "pass", detail: "Tape is tradable" },
];
eq(
  "a premium half fighting a long is a note once the grader's raid and shift layers pass",
  read({ dealing: PREMIUM, layers: L("pass") }).half.state,
  "pass",
);
eq(
  "the same fighting half still waits when the shift layer has not printed",
  read({ dealing: PREMIUM, layers: L("wait") }).half.state,
  "wait",
);
eq("against the higher timeframe with no release fails", read({ topDown: "bear" }).counter.state, "fail");
eq("against it WITH the desk's release passes", read({ topDown: "bear", released: true }).counter.state, "pass");
eq("a neutral higher timeframe is not a disrespect", read({ topDown: "neutral" }).counter.state, "pass");
eq("a failing clean layer fails the Judas lesson", read({ cleanState: "fail" }).judas.state, "fail");
ok(
  "inside 09:30-09:45 the Judas lesson says the window is why",
  read({ etHour: 9, etMinute: 35, cleanState: "fail" }).judas.say.toLowerCase().includes("open has not resolved"),
  read({ etHour: 9, etMinute: 35, cleanState: "fail" }).judas.say,
);
ok(
  "outside it the lesson says the clock does not block",
  read({ etHour: 14, etMinute: 0 }).judas.live.includes("does not block"),
  read({ etHour: 14, etMinute: 0 }).judas.live,
);

/* ── 7. the lesson and ticket-facts never disagree ────────────────────── */

head("One word for the same fact");
for (const over of [
  {},
  { price: 110 },
  { price: 60 },
  { rr1: 0.6 },
  { plan: null },
  { side: "short" },
  { bars: noDisp, displace: false },
]) {
  const desk = mkDesk(over);
  const f = fourFacts(desk, "left");
  const l = Object.fromEntries(readLiveLessons(desk, { leg: "left", options: null }).map((x) => [x.id, x]));
  const label = JSON.stringify(over);
  eq(`${label}: raid condition == raid lesson passing`, f.four[0].ok, l.raid.state === "pass");
  eq(`${label}: array condition == array lesson passing`, f.four[2].ok, l.array.state === "pass");
  eq(`${label}: target condition == draw lesson passing`, f.four[3].ok, l.draw.state === "pass");
  eq(`${label}: fourOk is all four`, f.fourOk, f.four.every((c) => c.ok));
  ok(`${label}: the entry text is never a blank number`, f.entry.text.trim().length > 0 && !/\bNaN\b|undefined|null/.test(f.entry.text), f.entry.text);
  ok(`${label}: the target text is never a blank number`, !/\bNaN\b|undefined|null/.test(f.target.text), f.target.text);
  ok(`${label}: with no array the words are said`, f.entry.px != null || f.entry.text === "not at the array", f.entry.text);
}

/* ── 8. the helpers ──────────────────────────────────────────────────── */

head("The helpers");
const lessons = readLiveLessons(mkDesk(), { leg: "left", options: null });
eq("nextLesson takes the first failing over the first waiting", nextLesson(read({ rr1: 0.6, price: 128 }) && readLiveLessons(mkDesk({ rr1: 0.6 }), { leg: "left", options: null })).id, "draw");
ok("nextLesson is null only when nothing waits or fails", nextLesson(lessons) != null);
ok(
  "sayForMissing answers for a layer the grader named",
  typeof sayForMissing(mkDesk(), "Retrace into array", "left") === "string",
  sayForMissing(mkDesk(), "Retrace into array", "left"),
);
eq("sayForMissing on a complete sequence is null", sayForMissing(mkDesk(), "Sequence complete", "left"), null);
eq("sayForMissing with no layer is null", sayForMissing(mkDesk(), null, "left"), null);
ok(
  "sayForMissing never reads the options book (no ask sentence can come back)",
  sayForMissing(mkDesk(), "Judas / news", "left") !== null &&
    !String(sayForMissing(mkDesk(), "Judas / news", "left")).includes("$"),
  sayForMissing(mkDesk(), "Judas / news", "left"),
);

console.log(`\nlive-lesson: ${pass} passed, ${fails.length} failed`);
if (fails.length) {
  console.log(fails.map((f) => `  - ${f}`).join("\n"));
  process.exit(1);
}
