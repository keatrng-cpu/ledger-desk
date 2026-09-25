/**
 * The entry ticket and the pre-filled trade note, pinned.
 *
 * The ticket is the message a trader acts on from a phone, with money, without
 * opening the desk. That makes a wrong number here more expensive than a wrong
 * number almost anywhere else in the repo — a bad backtest costs a conclusion,
 * a bad ticket costs a position. So the tests are mostly about REFUSAL and
 * about agreement with the plan that produced it.
 *
 * The note's job is narrower and just as important: it must never fill a field
 * only the trader can know. An invented fill price in a log is worse than no
 * log, because a backtest that disagrees with it would then be "corrected"
 * toward a number nobody observed.
 *
 * Run: npx tsx scripts/verify-entry-ticket.mjs
 */

const { buildEntryTicket, ticketHeadline } = await import("../src/lib/trading/entry-ticket.ts");
const { buildTradeNote, missingLayers, noteBlanks } = await import("../src/lib/trading/trade-note.ts");
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

/** An MNQ long: CE 20100, stop 20080 (20pt), T1 20140 (2R), T2 20180 (4R). */
const plan = {
  symbol: "MNQ",
  side: "long",
  price: 20102,
  entry: 20100,
  stop: 20080,
  riskPts: 20,
  t1: 20140,
  t2: 20180,
  rr1: 2,
  rr2: 4,
  riskTooTight: false,
  riskAtr: 1.2,
  draw: { price: 20140, name: "PDH", reachProbability: 0.82 },
};

console.log("the ticket agrees with the plan that made it");
{
  const t = buildEntryTicket({ plan, confluence: 0.78, equity: 100_000 });
  check("entry is CE, unchanged", t.entry, plan.entry);
  check("stop is the plan's stop, unchanged", t.stop, plan.stop);
  check("T1 and T2 pass through", [t.t1, t.t2], [20140, 20180]);
  check("grade comes from the shared mapper", t.grade, "A+");
  check("it sizes a real position", t.contracts > 0, true);
  // MNQ point value 2, 20pt stop = $40/contract. A+ is 3% of $100k = $3,000.
  check("contracts = floor(riskDollars / (riskPts x pointValue))", t.contracts, 75);
  check("and the risk dollars are the grade's, not a default", t.riskUsd, 3000);
}

console.log("\nit says how to MANAGE, which is the whole point");
{
  const t = buildEntryTicket({ plan, confluence: 0.78 });
  const frac = Math.round(APLUS_RULES.scaleOut.tp1Fraction * 100);
  check("the partial fraction is the configured one", new RegExp(`take ${frac}%`).test(t.lines.manage), true);
  check("the stop moves to breakeven and it says so", /BREAKEVEN/.test(t.lines.manage), true);
  check("the runner is named", /runner/.test(t.lines.manage), true);
  // The most-replicated finding on the desk, and the one most tempting to
  // abandon mid-trade. It must travel WITH the entry.
  check("and it carries the cost of protecting early", /-0\.18R to -0\.41R/.test(t.lines.manage), true);
  check("the text contains all five lines", t.text.split("\n").length, 5);
}

console.log("\nit says when the idea is DEAD");
{
  const t = buildEntryTicket({ plan, confluence: 0.78 });
  check("the stop level is the death condition", t.lines.invalid.includes("20080.00"), true);
  check("an unfilled plan does not carry overnight", /does not carry to tomorrow/.test(t.lines.invalid), true);
}

console.log("\nit REFUSES rather than sizing something it should not");
{
  const tight = buildEntryTicket({ plan: { ...plan, riskTooTight: true }, confluence: 0.78 });
  check("a stop inside the ATR floor gets no size", tight.contracts, 0);
  check("and no risk dollars", tight.riskUsd, 0);
  check("the line says DO NOT SIZE", /DO NOT SIZE/.test(tight.lines.risk), true);
  check("and names the floor", /0\.5xATR/.test(tight.lines.risk), true);
  check("with the measured cost beside it", /-0\.35R, both halves/.test(tight.lines.risk), true);

  // The CEILING, added 2026-09-25. 1.5+ ATR measured -0.086R in both halves,
  // so the tradable geometry is a BAND and a plan can be inside the far wider
  // structural cap while still sitting outside it.
  const wide = buildEntryTicket({ plan: { ...plan, riskTooWide: true }, confluence: 0.78 });
  check("a stop beyond 1.5xATR gets no size", wide.contracts, 0);
  check("and names the ceiling", /1\.5xATR/.test(wide.lines.risk), true);
  check("with its measured cost too", /-0\.086R, both halves/.test(wide.lines.risk), true);
  check("the headline says NO SIZE for it as well", /NO SIZE/.test(ticketHeadline(wide)), true);
  check("the headline says NO SIZE so a glance cannot misread it", /NO SIZE/.test(ticketHeadline(tight)), true);

  // A stop so wide that one contract exceeds the budget.
  const huge = buildEntryTicket({
    plan: { ...plan, stop: 10000, riskPts: 10100 },
    confluence: 0.78,
    equity: 1000,
  });
  check("an unaffordable single contract is refused, not bought small", huge.contracts, 0);
  // config.ts floors sizeContracts at 1 contract when pct > 0. That floor is
  // correct for the paper book and WRONG for a ticket: rounding a position the
  // budget cannot pay for up to one does not make it affordable. This pins the
  // ticket's own refusal so it can never re-inherit the floor.
  check("and it prices the refusal in dollars", /one contract risks \$/.test(huge.lines.risk), true);
  check("a barely-affordable stop still sizes", buildEntryTicket({
    plan: { ...plan, stop: 20080, riskPts: 20 },
    confluence: 0.78,
    equity: 1400,
  }).contracts, 1);
}

console.log("\nthe headline is glanceable");
{
  const t = buildEntryTicket({ plan, confluence: 0.78 });
  const h = ticketHeadline(t);
  check("it carries entry and stop", /20100\.00.*20080\.00/.test(h), true);
  check("and the size", /75x/.test(h), true);
  check("and stays short", h.length < 70, true);
}

console.log("\nrisk scales with the grade, never past the ceiling");
{
  const aPlus = buildEntryTicket({ plan, confluence: 0.80, equity: 100_000 });
  const aMinus = buildEntryTicket({ plan, confluence: 0.66, equity: 100_000 });
  check("A+ risks more than A-", aPlus.riskUsd > aMinus.riskUsd, true);
  check("and never above the house ceiling", aPlus.riskUsd <= 100_000 * APLUS_RULES.riskPctCeiling, true);
}

/* ── The note ────────────────────────────────────────────────────────────── */

const layers = [
  { id: "dol", label: "Draw", must: true, state: "pass", detail: "" },
  { id: "sweep", label: "Sweep", must: true, state: "fail", detail: "" },
  { id: "retrace", label: "Retrace", must: true, state: "wait", detail: "" },
  { id: "smt", label: "SMT", must: false, state: "fail", detail: "" },
];

console.log("\nthe note fills what the desk knows");
{
  const note = buildTradeNote({
    atMs: Date.UTC(2026, 8, 24, 14, 52),
    symbol: "MNQ",
    side: "long",
    book: "options",
    underlier: "QQQ",
    plan,
    deskWord: "STAND",
    layers,
    grade: "A+",
    killzone: "ny_am",
  });
  check("the plan levels are written", note.includes("plan_entry:   20100"), true);
  check("the stop too", note.includes("plan_stop:    20080"), true);
  check("the desk's word is recorded", /desk_word:    STAND/.test(note), true);
  check("only the MUST layers that failed are listed", /missing:      sweep, retrace/.test(note), true);
  check("optional layers are not treated as missing", /smt/.test(note.split("missing:")[1].split("\n")[0]), false);
  check("the options legs are asked for", /contract:.*<- YOU/.test(note), true);
}

console.log("\nand REFUSES to fill what only the trader knows");
{
  const note = buildTradeNote({
    atMs: Date.UTC(2026, 8, 24, 14, 52),
    symbol: "MNQ",
    side: "long",
    book: "futures",
    plan,
    deskWord: "TAKE",
    layers: [],
  });
  // An invented fill in a log is worse than no log: a backtest that disagreed
  // with it would be "corrected" toward a number nobody observed.
  for (const field of ["entry_fill", "exit_fill", "exit_reason", "pnl"]) {
    const line = note.split("\n").find((l) => l.startsWith(`${field}:`));
    check(`${field} is present`, line != null, true);
    check(`${field} is EMPTY`, (line ?? "").split("#")[0].split(":")[1].trim(), "");
  }
  check("and each is marked as the trader's", /entry_fill:.*<- YOU/.test(note), true);
  check("a futures note does not ask for option legs", /underlier:/.test(note), false);
  check("blanks are counted honestly", noteBlanks({ symbol: "MNQ", side: "long", book: "futures" }), 4);
  check("options ask for more", noteBlanks({ symbol: "MNQ", side: "long", book: "options" }), 7);
}

console.log("\nmissingLayers is the override record");
{
  check("only musts, only not-passing", missingLayers(layers), ["sweep", "retrace"]);
  check("no layers is no record, not a crash", missingLayers(null), []);
  check("all passing is an empty list", missingLayers([{ id: "a", must: true, state: "pass", label: "", detail: "" }]), []);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
