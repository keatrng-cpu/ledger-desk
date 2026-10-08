/**
 * The brain desk lights a path only when a seat actually sends, and the SMC book holds the deeper reads.
 *
 *   npx tsx scripts/verify-brain-nerve.mjs
 *
 * WHY: the Brain tab used to draw five lines that pulsed whenever a person had any note. That is a picture of
 * traffic, not traffic. A nerve is recorded when a node is rewritten, when the book hands a changed line to its
 * owner (and that owner tells the other four), and when the floor queues a real exchange. The same send inside
 * eight seconds is one nerve. The collective-logic scores are the node's own confidence.
 *
 * A mutant that deletes the noteNerve call in rewrite() fails "a rewrite of a line the book already has".
 */
import { readFileSync } from "node:fs";

const A = await import("../src/lib/room/desk-atlas.ts");
const N = await import("../src/lib/room/brain-traffic.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const src = readFileSync(new URL("../src/lib/room/desk-atlas.ts", import.meta.url), "utf8");
const rewrite = src.slice(src.indexOf("function rewrite"), src.indexOf("export function improveAtlas"));
check("rewrite tells the hub", /noteNerve\(who, "hub"/.test(rewrite));

console.log("sends");
{
  N.clearNerves();
  const base = A.mergeAtlas(null, null, 1_000);
  const wrote = A.improveAtlas(base, { shelf: "backtest", title: "Close probe", text: "The close paid. It goes on the book.", who: "Nova", nowMs: 3_000 });
  const into = N.allNerves().filter((n) => n.from === "Nova" && n.to === "hub");
  check("a new line into the book is a nerve into the hub", into.length === 1 && into[0].about === "Close probe" && A.nodeById(wrote, "backtest:close-probe") != null, JSON.stringify(N.allNerves()));

  N.clearNerves();
  A.improveAtlas(base, { shelf: "now", title: "Card", text: "QQQ short is the card.", who: "Nova", nowMs: 3_500 });
  const cardNerve = N.allNerves().filter((n) => n.to === "hub" && n.about === "Card");
  check("a rewrite of a line the book already has is a nerve into the hub", cardNerve.length === 1 && cardNerve[0].from === "Nova", JSON.stringify(N.allNerves()));

  const beforeRepeat = N.allNerves().length;
  A.improveAtlas(wrote, { shelf: "backtest", title: "Close probe", text: "The close paid. It goes on the book.", who: "Nova", nowMs: 4_000 });
  check("the same sentence again is not a second nerve", N.allNerves().length === beforeRepeat, JSON.stringify(N.allNerves()));

  N.clearNerves();
  const people = A.freshPeople();
  for (const who of A.BRAIN_CREW) for (const n of base.nodes) people.people[who].known[n.id] = n.at;
  const primed = { ...base, last: { ...base.last, hour: 10, news: false, cardKey: null } };
  const card = A.absorbAtlas(primed, {
    nowMs: 5_000,
    etMin: 10 * 60,
    cardKey: "QQQ:short",
    cardLine: "QQQ short. The sequence is on the board.",
    exitId: null,
    exitLine: null,
    newsOn: false,
  });
  N.clearNerves();
  A.syncPeople(people, card, 5_100);
  const back = N.allNerves().filter((n) => n.from === "hub");
  const peers = N.allNerves().filter((n) => n.from !== "hub" && n.to !== "hub");
  check("the book hands the new card line back to its owner", back.length === 1 && back[0].to === "Nova" && back[0].about === "Card", JSON.stringify(back));
  check("that owner tells the other four", peers.length === 4 && peers.every((n) => n.from === "Nova"), JSON.stringify(peers));
  check("the first time they meet the book is not a roll call", (() => { N.clearNerves(); A.syncPeople(A.freshPeople(), base, 6_000); return N.allNerves().length === 0; })());
  check("a queued exchange is seat to seat, in the order spoken", (() => {
    N.clearNerves();
    N.noteExchange(["Gemma", "Jax", "Sterling"], 7_000, "QQQ is at the entry");
    const n = N.allNerves();
    return n.length === 2 && n[0].from === "Gemma" && n[0].to === "Jax" && n[1].from === "Jax" && n[1].to === "Sterling";
  })());
  check("one seat talking to nobody is not a nerve", (() => { N.clearNerves(); N.noteExchange(["Vince"], 8_000, "alone"); return N.allNerves().length === 0; })());
}

console.log("a line's time means when it last changed");
{
  // The bug this pins: cloneSeed stamps every seed with the merge time, so an untouched stored line came back stamped NOW.
  // Every pulse then made all ninety lines look new, and the book announced whichever sorts first instead of the one that moved.
  const seeded = A.mergeAtlas(null, null, 1_000);
  const again = A.mergeAtlas(seeded, null, 9_000);
  const moved = again.nodes.filter((n) => n.at !== 1_000);
  check("merging an unchanged book twice moves no line's time", moved.length === 0, JSON.stringify(moved.slice(0, 3).map((n) => [n.id, n.at])));
  check("and keeps every line", again.nodes.length === seeded.nodes.length, `${seeded.nodes.length} -> ${again.nodes.length}`);

  // A line the desk really rewrote keeps the new time, and only that line.
  const wrote = A.absorbAtlas({ ...seeded, last: { ...seeded.last, hour: 10, news: false, cardKey: null } }, {
    nowMs: 5_000, etMin: 600, cardKey: "QQQ:short", cardLine: "QQQ short. The sequence is on the board.", exitId: null, exitLine: null, newsOn: false,
  });
  const fresh = wrote.nodes.filter((n) => n.at === 5_000).map((n) => n.id);
  check("a pulse that changed one line moves one line's time", fresh.length === 1 && fresh[0] === "now:card", JSON.stringify(fresh));
  check("the changed line is the one the people have not seen", A.nowLines(wrote).filter((n) => n.at > 1_000).length === 1);

  // A seed edited in code is genuinely new: it must still reach an older saved atlas.
  const edited = A.mergeAtlas({ ...seeded, nodes: seeded.nodes.map((n) => (n.id === "now:goal" ? { ...n, text: "An older saved line." } : n)) }, null, 9_000);
  const goal = A.nodeById(edited, "now:goal");
  check("a seed whose words changed in code still replaces an older saved line, and is marked new", goal.text !== "An older saved line." && goal.at === 9_000, JSON.stringify([goal.text.slice(0, 40), goal.at]));

  // Learning survives: a graded node keeps its own text and its own time.
  const graded = A.gradeAtlas(seeded, "now:card", true, 4_000);
  const kept = A.nodeById(A.mergeAtlas(graded, null, 9_000), "now:card");
  check("a line the brain graded is not reset by a later merge", kept.at === 4_000 && kept.n > 0, JSON.stringify([kept.at, kept.n]));
}

console.log("the deeper book");
{
  const atlas = A.mergeAtlas(null, null, 9_000);
  const ids = ["smc:po3", "smc:pd", "smc:dol", "smc:bos", "smc:breaker", "smc:smt", "smc:killzone", "smc:retest"];
  check("eight deeper reads are pinned on the SMC shelf", ids.every((id) => { const n = A.nodeById(atlas, id); return n && n.pinned && n.shelf === "smc" && n.text.length > 40; }));
  check("premium recalls the dealing range, not a school node", A.recall(atlas, "premium discount").hit?.id === "smc:pd");
  check("smt recalls the leader's divergence", A.recall(atlas, "smt").hit?.id === "smc:smt" && A.recall(atlas, "smt").neighbors.some((n) => n.id === "smc:leader"));
  check("a bare bias is still the desk's own line", !(A.recall(atlas, "bias").hit?.id ?? "").startsWith("school:") && A.recall(atlas, "bias").hit?.id !== "smc:pd");
  const rows = A.collectiveLogic(atlas);
  check("collective logic is the four nodes' own confidence", rows.length === 4 && rows[0].id === "smc:sequence" && rows[0].confidence === A.nodeById(atlas, "smc:sequence").confidence && rows[2].bars.some((b) => b.id === "smc:smt" && b.confidence === A.nodeById(atlas, "smc:smt").confidence));
  check("power of three hangs off AMD", atlas.edges.some((e) => e.from === "smc:amd" && e.to === "smc:po3"));
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
