/**
 * School, the card, the chart, the backtest, and the journal write the book, and the book hands each new line to all five.
 *
 *   npx tsx scripts/verify-brain-fuel.mjs
 *
 * A mutant that deletes the peer loop in fuelBrains fails "the owner tells the other four".
 */
const A = await import("../src/lib/room/desk-atlas.ts");
const F = await import("../src/lib/room/brain-fuel.ts");
const N = await import("../src/lib/room/brain-traffic.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const empty = { nowMs: 1_000, school: null, card: null, chart: null, backtest: null, journal: null };
const base = A.mergeAtlas(null, null, 1_000);
check("the four sources are on the now shelf", ["now:school", "now:chart", "now:backtest", "now:journal"].every((id) => A.nodeById(base, id)?.pinned));
check("an empty cycle does not invent a line", F.fuelBrains(base, A.freshPeople(), empty).atlas.nodes.find((n) => n.id === "now:school").text.startsWith("No school read"));

N.clearNerves();
const people = A.freshPeople();
const once = F.fuelBrains(base, people, {
  nowMs: 2_000,
  school: "ICT fits this short. TJR needs the sweep.",
  card: "MNQ short. Inverse on the 1 minute.",
  chart: "MNQ: higher timeframe down, middle down, lower up. ES: higher timeframe down, middle flat, lower down.",
  backtest: "MNQ short, fit 0.91, 10-07: not taken; it never filled inside 3 hours. Passing was right.",
  journal: "QQQ puts closed the level, cost 40 dollars.",
});
check("the school line is the line that was passed", A.nodeById(once.atlas, "now:school").text === "ICT fits this short. TJR needs the sweep.");
check("the chart line is stored as given", A.nodeById(once.atlas, "now:chart").text.startsWith("MNQ: higher timeframe down"));
check("the journal close is stored as given", A.nodeById(once.atlas, "now:journal").text.includes("cost 40 dollars"));
check("every seat now holds the school line", A.BRAIN_CREW.every((w) => once.people.people[w].known["now:school"] === 2_000));
check("the owner keeps the school line as a note", once.people.people.Nova.notes.some((n) => n.about === "now:school"));
const peers = N.allNerves().filter((n) => n.from === "Nova" && n.to !== "hub" && n.about === "School");
check("the owner tells the other four", peers.length === 4, JSON.stringify(peers));
check("the book hands the school line back", N.allNerves().some((n) => n.from === "hub" && n.to === "Nova" && n.about === "School"));

const before = N.allNerves().length;
const nBefore = A.nodeById(once.atlas, "now:school").n;
const twice = F.fuelBrains(once.atlas, once.people, {
  nowMs: 3_000,
  school: "ICT fits this short. TJR needs the sweep.",
  card: null,
  chart: null,
  backtest: null,
  journal: null,
});
check("the same school line is not written again", A.nodeById(twice.atlas, "now:school").n === nBefore && N.allNerves().length === before);
const P = await import("../src/lib/room/brain-precision.ts");
check("a flat spike is called noise", P.precisionSentence({ symbol: "MNQ", lagSec: 2, closes: Array(30).fill(100).concat([130]) }).includes("noise"));
check("a smooth tape is not called noise", P.precisionSentence({ symbol: "MNQ", lagSec: 2, closes: Array.from({ length: 40 }, (_, i) => 100 + i * 0.02) }).includes("not a noise bar"));
check("the book speaks one line", (A.nodeById(once.atlas, "now:read")?.text ?? "").includes("Chart:") && A.nodeById(once.atlas, "now:read").text.includes("School:"));
check("precision is a note the book keeps", (() => {
  const withTape = F.fuelBrains(once.atlas, once.people, { nowMs: 4_000, school: null, card: null, chart: null, backtest: null, journal: null, precision: "MNQ print is 2s old. last minute is 0.3z, not a noise bar. A note for the book. Not a gate." });
  return A.nodeById(withTape.atlas, "now:precision").text.includes("not a noise bar") && A.nodeById(withTape.atlas, "now:read").text.includes("Tape:");
})());

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
