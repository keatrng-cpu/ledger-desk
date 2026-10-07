/**
 * What the brain keeps from a graded high-alert card (src/lib/room/hi-alert-brain.ts), and the Floor recalling it.
 *
 *   npx tsx scripts/verify-hi-alert-brain.mjs
 *
 * WHY: the trader asked that the characters journal the setups (taken or passed), the displacement and bias-switch issues among them, and use it to
 * learn. Pins: the lesson lands on the backtest shelf for a pass as well as a take; the school that reads the card is graded against the CHART (only
 * when the card filled; fits+worked and missing+didn't are right, the other two wrong); the character who presents that school gets a personal note;
 * a hypothetical result never becomes a desk rule (only a taken trade that paid is offered as realized); each card is written once; Nova says what
 * the last cards like this one did; and whether the 1-3 minute was against the card at first sight is recorded beside the grade.
 */
import { readFileSync } from "node:fs";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) };
globalThis.window = globalThis;
// The brain's modules announce a change with window.dispatchEvent (desk-atlas, brain-traffic). A bare globalThis has none, so the shim gives it a no-op.
globalThis.dispatchEvent = () => true;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};

const A = await import("../src/lib/room/desk-atlas.ts");
const B = await import("../src/lib/room/hi-alert-brain.ts");
const H = await import("../src/lib/trading/hi-alert.ts");
const S = await import("../src/lib/trading/school-brief.ts");
const { exTier } = await import("../src/lib/room/live-voices.ts");
const { Facts, freshTalkState } = await import("../src/lib/room/live-types.ts");
const { spokenProblems } = await import("./lib/spoken-check.mjs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const outcome = (status, R, filled = true) => ({ status, done: true, filled, R, mfeR: 1, maeR: -1, barsSeen: 12 });
const rec = (o = {}) => ({
  id: "2026-10-07|ES|short|877", day: "2026-10-07", firstMs: 1, lastMs: 2, sym: "ES", side: "short", fit: 0.99, band: "A+", strategy: "patty",
  plan: { entry: 100, stop: 102, t1: 98, t2: 96, riskAtr: 0.23 }, pT1: 0.2, expR: -0.33, actionable: false, everActionable: false, taken: "no",
  why: ["Outside the session: lunch."], evidence: [], schools: [{ school: "patty", verdict: "missing", next: "a breaker block" }], sequence: null,
  outcome: outcome("unfilled", null, false), deliveryAtSight: "against", ...o,
});
const fresh = () => A.mergeAtlas(null, null, 1_000);
const conf = (a, id) => A.nodeById(a, id).confidence;
const entryId = (s) => A.schoolNodeId(s, "entry");

console.log("what lands in the brain");
{
  const a0 = fresh();
  const r = B.feedHiAlert(a0, null, rec(), 5_000);
  const node = A.nodeById(r.atlas, "backtest:hi-alert-es-short-10-07-877");
  check("a PASS is written as a lesson on the backtest shelf, in the voice of the seat that presents the school", !!node && node.shelf === "backtest" && node.who === "Sterling" && /ES short, patty, fit 0\.99, 2026-10-07: not taken \(Outside the session: lunch\)/.test(node.text), node?.text);
  check("... and it says whether passing was right", /Passing was right\./.test(node.text), node.text);
  check("... and that the lower timeframes were against it, when they were", /The 1 to 3 minute was against it\./.test(node.text));
  check("the lesson is short enough to say (the standing complaint)", node.text.split(/\s+/).length <= 55, String(node.text.split(/\s+/).length));
  check("a card that never filled grades no school (it says only that the limit was not touched)", r.graded === false && conf(r.atlas, entryId("patty")) === conf(a0, entryId("patty")));
  const t = B.feedHiAlert(a0, null, rec({ strategy: "tjr", schools: [{ school: "tjr", verdict: "fits", next: null }] }), 5_000);
  check("the character is the school's seat: TJR is Jax, a model with no school is Nova", t.who === "Jax" && B.feedHiAlert(a0, null, rec({ strategy: "continuation" }), 5_000).who === "Nova");
}

console.log("the school is graded against the chart");
{
  const a0 = fresh();
  const step = (verdict, status, R) => {
    const r = B.feedHiAlert(a0, null, rec({ schools: [{ school: "patty", verdict, next: null }], outcome: outcome(status, R) }), 5_000);
    return { graded: r.graded, d: conf(r.atlas, entryId("patty")) - conf(a0, entryId("patty")) };
  };
  check("'fits' and it worked: right (+6)", (() => { const x = step("fits", "t1", 0.5); return x.graded && x.d === 6; })());
  check("'fits' and it was stopped: wrong (−8)", (() => { const x = step("fits", "stopped", -1.1); return x.graded && x.d === -8; })());
  check("'missing' and it was stopped: the school was right to wait (+6)", (() => { const x = step("missing", "stopped", -1.1); return x.graded && x.d === 6; })());
  check("'missing' and it ran to T1: the school was wrong to wait (−8)", (() => { const x = step("missing", "t2", 1.5); return x.graded && x.d === -8; })());
  check("'against' says nothing about the entry: not graded", step("against", "t1", 0.5).graded === false);
  check("a flat finish did not 'work'", step("fits", "flat", 0.1).d === -8);
}

console.log("the person remembers; a hypothetical never becomes a rule");
{
  const a0 = fresh();
  const people0 = A.syncPeople(null, a0, 1_000);
  const pass = B.feedHiAlert(a0, people0, rec({ outcome: outcome("t1", 0.5) }), 9_000_000);
  check("the character gets the lesson as a personal note", pass.people.people.Sterling.notes[0]?.about === "Hi-alert ES short" && /Passing cost about/.test(pass.people.people.Sterling.notes[0].text), JSON.stringify(pass.people.people.Sterling.notes[0]));
  check("a missed (not taken) winner is NOT offered to the desk as realized P&L: only the dated lesson node is added", A.nodeById(pass.atlas, "backtest:hi-alert-es-short") == null);
  const win = B.feedHiAlert(a0, people0, rec({ taken: "paper", outcome: outcome("t2", 1.5), schools: [{ school: "patty", verdict: "fits", next: null }] }), 9_000_000);
  check("a TAKEN trade that paid is offered as realized, so the desk brain takes it", A.nodeById(win.atlas, "backtest:hi-alert-es-short") != null && /Taking it paid/.test(A.nodeById(win.atlas, "backtest:hi-alert-es-short").text));
  const loss = B.feedHiAlert(a0, people0, rec({ taken: "paper", outcome: outcome("stopped", -1.1) }), 9_000_000);
  check("a taken loss is remembered by the person and does not become a rule", A.nodeById(loss.atlas, "backtest:hi-alert-es-short") == null && /Taking it lost/.test(loss.people.people.Sterling.notes[0].text));
}

console.log("each card is written once");
{
  store.clear();
  const list = [rec({ id: "d|ES|short|1" }), rec({ id: "d|MNQ|long|2", sym: "MNQ", side: "long", strategy: "tjr", schools: [{ school: "tjr", verdict: "fits", next: null }], outcome: outcome("t1", 0.5) }),
    { ...rec({ id: "d|ES|short|3" }), outcome: { status: "pending", done: false, filled: true, R: null, mfeR: 0, maeR: 0, barsSeen: 3 } }, { ...rec({ id: "d|ES|short|4" }), fed: true }];
  const out = B.feedLedger(list, 5_000);
  check("graded cards are fed and marked; a pending one and an already-fed one are left", out[0].fed === true && out[1].fed === true && !out[2].fed && out[3].fed === true);
  const atlas = A.loadAtlas();
  check("the atlas in storage has both lessons", A.nodeById(atlas, "backtest:hi-alert-es-short-10-07-1") != null && A.nodeById(atlas, "backtest:hi-alert-mnq-long-10-07-2") != null);
  const again = B.feedLedger(out, 6_000);
  check("a second pass writes nothing more (idempotent)", again === out);
  check("a pending card is fed once it is graded", B.feedLedger([{ ...out[2], outcome: outcome("stopped", -1.1) }], 7_000)[0].fed === true);
  check("nothing to feed: the same list comes back and storage is not touched", (() => { const s = store.get(A.ATLAS_KEY); const r = B.feedLedger([out[2]], 8_000); return r[0] === out[2] && store.get(A.ATLAS_KEY) === s; })());
}

console.log("the delivery is recorded beside the grade");
{
  const cand = {
    id: "ES-short", symbol: "ES", side: "short", confluence: 0.99, grade: "A+", pathBand: "A+", components: ["ifvg"], completeStrategy: "patty", strategyPrimary: "patty",
    killzoneOk: false, htfOk: true, actionable: false, missing: ["BSL raid"], hitOdds: { pT1: 0.2, expR: -0.33 }, patterns: { inducement: false, mitigation: false }, atr: 8.9, entryPx: 7832.88,
    plan: { entry: 7832.88, stop: 7834.94, t1: 7829, t2: null, riskAtr: 0.6, atr: 8.9, rr1: 1.9, drawName: "PDL" }, draw: { name: "PDL", swept: false },
  };
  const lad = (tier4) => ({ reads: [], tier3: "bear", tier4, phase: "expansion" });
  const ctx = (tier4, nowMs) => ({ nowMs, day: "2026-10-07", clock: {}, blocked: [], bookFor: () => null, ladderFor: () => (tier4 ? lad(tier4) : null), takenFor: () => "no" });
  const [a] = H.recordHiAlerts([], [cand], ctx("bull", 1000));
  check("a short with the 1-3 minute up is recorded as 'against' at sight, and the reason says so in its own words", a.deliveryAtSight === "against" && a.why.some((w) => /delivering up, against this short, and there is no displacement down yet/.test(w)), a.why.join(" | "));
  const [b] = H.recordHiAlerts([a], [cand], ctx("bear", 2000));
  check("the first-sight delivery is kept when the rungs turn later", b.deliveryAtSight === "against");
  check("no trigger rungs read: unknown, and no invented reason", (() => { const [c] = H.recordHiAlerts([], [cand], ctx(null, 1000)); return c.deliveryAtSight === "unknown" && !c.why.some((w) => /delivering/.test(w)); })());
  check("a card with the rungs going its way says nothing about delivery", (() => { const [c] = H.recordHiAlerts([], [cand], ctx("bear", 1000)); return c.deliveryAtSight === "with" && !c.why.some((w) => /delivering/.test(w)); })());
  check("a school is found for each model that has a grader, and none for the rest", S.ownSchool("tjr") === "tjr" && S.ownSchool("mechanical") === "blake" && S.ownSchool("judas") === "ict" && S.ownSchool("patty") === "patty" && S.ownSchool("smt") === null && S.ownSchool("continuation") === null && S.ownSchool(null) === null);
}

console.log("Nova says what the ledger remembers");
{
  const k = { name: "A+ ES short", symbol: "ES", verdict: "WATCH", u: "SPY", type: "PUT", band: "A+", tier: "armed", awayPts: 2, futSymbol: "ES", futSide: "short", entry: 7832.88, stop: 7834.94, t1: 7829,
    pT1: 0.2, expR: -0.33, block: "BSL raid", strategy: "patty", setup: "", fit: 0.99, sequence: "STAND DOWN", entryLine: "x", key: "k", schools: { line: "Patty needs a breaker block.", by: { Nova: "Blake reads long." } } };
  const recall = H.recallHiAlerts([rec({ outcome: outcome("unfilled", null, false) }), rec({ id: "b", outcome: outcome("stopped", -1.1) }), rec({ id: "c", outcome: outcome("t1", 0.5) })], { strategy: "patty", side: "short" });
  const nova = (card) => exTier({ st: freshTalkState(), f: new Facts(), key: "t:r", now: 1_000_000 }, { card, from: null, to: "armed", b: null }).lines.find((l) => l.character === "Nova")?.text ?? "";
  check("the recall sentence is built from graded history only", /^The last 3 0\.90-plus patty short cards: 1 reached a target, 1 stopped, 1 never filled\. Passing was right 2 of 3 times\.$/.test(recall), recall);
  check("a new card: Nova gives the card's odds and then the recall", /P\(T1\)|20%/.test(nova({ ...k, recall })) && nova({ ...k, recall }).includes("The last 3 0.90-plus patty short cards"), nova({ ...k, recall }));
  check("no history: Nova says only the odds", !/The last/.test(nova({ ...k, recall: null })));
  check("the recall passes the floor's speech checker (the '0.90-plus' is said, not garbled)", spokenProblems([{ character: "Nova", text: recall }]).length === 0, spokenProblems([{ character: "Nova", text: recall }]).join(" | "));
}

console.log("wired in");
{
  const idx = readFileSync(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
  const lw = readFileSync(new URL("../src/lib/room/live-world.ts", import.meta.url), "utf8");
  check("the shell feeds the brain after grading and before saving", /gradeAll\([\s\S]{0,420}list = feedLedger\(list, now\);\s*saveHiAlerts\(list\)/.test(idx));
  check("the Floor's card read carries the recall from the ledger", /recall: recallHiAlerts\(loadHiAlerts\(\), \{ strategy: c\.completeStrategy \|\| c\.strategyPrimary \|\| null/.test(lw));
}

delete globalThis.localStorage;
console.log(`\nhi-alert-brain: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
