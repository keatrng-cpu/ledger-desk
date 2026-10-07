/**
 * Which card the Floor talks about follows the delivery (src/lib/room/focus-pick.ts).
 *
 *   npx tsx scripts/verify-focus-pick.mjs
 *
 * WHY: the Floor took the board's first card. On 2026-10-07 that was an ES short at fit 0.99 while the 1, 2 and 3 minute were delivering UP and the
 * short had no displacement down; the five kept discussing a short the tape was not giving them. PB reads the 1 to 5 minute inverse, TJR the 1 minute
 * after the 5 minute break, ICT the displacement after the sweep, to decide WHICH side is in play, and they change sides when those rungs change.
 *
 * Pins: the delivery read from the trigger and confirmation rungs; the focus switches to the other side only when that side's delivery is "with" and
 * it is at least as takeable or was released by the HTF disrespect check (the HTF gate is never bypassed); a card in the entry zone keeps priority
 * unless it is itself against; what is said; and that the Floor's three Jax lines say it first.
 */
import { readFileSync } from "node:fs";

const F = await import("../src/lib/room/focus-pick.ts");
const { exTier, exAtEntry } = await import("../src/lib/room/live-voices.ts");
const { Facts, freshTalkState } = await import("../src/lib/room/live-types.ts");
const { spokenProblems } = await import("./lib/spoken-check.mjs");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const L = (tier3, tier4) => ({ tier3, tier4 });
const short = (o = {}) => ({ id: "s", side: "short", htfOk: true, actionable: false, ...o });
const long = (o = {}) => ({ id: "l", side: "long", htfOk: true, actionable: false, ...o });

console.log("delivery");
{
  const d = F.deliveryOfLadder;
  check("a short with the 1-3 minute UP and the 15/5 minute not down: against (the 2026-10-07 card)", d(L("bear", "bull"), short()) === "against");
  check("... also against when the 15/5 minute is neutral", d(L("neutral", "bull"), short({ actionable: true })) === "against");
  check("a short that IS actionable with the 15/5 minute confirming down is not 'against' on a lone up trigger (mixed)", d(L("bear", "bull"), short({ actionable: true })) === "mixed");
  check("a short with the trigger rungs down: with", d(L("bear", "bear"), short()) === "with");
  check("a long mirrors: trigger down and not actionable = against; trigger up = with", d(L("bull", "bear"), long()) === "against" && d(L("neutral", "bull"), long()) === "with");
  check("trigger neutral: mixed; no ladder: unknown", d(L("bear", "neutral"), short()) === "mixed" && d(null, short()) === "unknown" && d(undefined, long()) === "unknown");
}

console.log("who is in focus");
{
  const against = (c) => (c.side === "short" ? "against" : "with");
  const noZone = () => false;
  check("nothing ranked: nothing in focus", F.pickFocus([], noZone, against) === null);
  const p1 = F.pickFocus([short(), long()], noZone, against);
  check("the short on top is against and the long is with and as takeable: the focus moves to the long", p1.card.side === "long" && p1.switchedFrom.side === "short" && p1.topDelivery === "against" && p1.delivery === "with");
  const p2 = F.pickFocus([short(), long({ htfOk: false })], noZone, against);
  check("the long is still refused by the HTF gate: no switch (the gate is absolute), and the short is told to wait", p2.card.side === "short" && p2.switchedFrom === null && p2.delivery === "against");
  const p3 = F.pickFocus([short(), long({ htfOk: false, htfDisrespected: true })], noZone, against);
  check("... unless the HTF bias was disrespected and the desk released the gate: then it moves", p3.card.side === "long" && p3.switchedFrom !== null);
  const p4 = F.pickFocus([short(), long()], noZone, (c) => (c.side === "short" ? "against" : "mixed"));
  check("the other side must be delivered, not just allowed: mixed does not take the focus", p4.card.side === "short" && p4.switchedFrom === null);
  const p5 = F.pickFocus([short({ actionable: true }), long()], noZone, against);
  check("a more takeable card on top is not left for a less takeable one", p5.card.side === "short" && p5.switchedFrom === null);
  const p6 = F.pickFocus([short(), long()], noZone, () => "with");
  check("nothing against: the board's order stands", p6.card.id === "s" && p6.switchedFrom === null);
  const p7 = F.pickFocus([long(), short({ id: "z" })], (c) => c.id === "z", () => "mixed");
  check("a card in the entry zone keeps priority over the board's first", p7.card.id === "z");
  const p8 = F.pickFocus([short({ id: "z" }), long()], (c) => c.id === "z", against);
  check("... unless that card is itself against, then it is the long's turn", p8.card.side === "long" && p8.switchedFrom.id === "z");
  check("a different index is read on its own ladder (the delivery function is per card)", (() => { const seen = []; F.pickFocus([short({ symbol: "ES" }), long({ symbol: "MNQ" })], noZone, (c) => { seen.push(c.symbol); return c.symbol === "ES" ? "against" : "with"; }); return seen.includes("ES") && seen.includes("MNQ"); })());
}

console.log("what is said");
{
  const sw = F.pickFocus([short(), long()], () => false, (c) => (c.side === "short" ? "against" : "with"));
  const stay = F.pickFocus([short(), long({ htfOk: false })], () => false, (c) => (c.side === "short" ? "against" : "with"));
  const quiet = F.pickFocus([short()], () => false, () => "with");
  const longWaits = F.pickFocus([long()], () => false, () => "against");
  check("a switch says what is delivering and where the focus went", F.deliveryLine(sw) === "Displacement is up on the 1 to 3 minute, not down. Leaving the short for the long.", F.deliveryLine(sw));
  check("a card that waits says why, in the card's own direction", F.deliveryLine(stay) === "The 1 to 3 minute is delivering up, against this short, and there is no displacement down yet. It waits." && F.deliveryLine(longWaits) === "The 1 to 3 minute is delivering down, against this long, and there is no displacement up yet. It waits.", F.deliveryLine(stay));
  check("a card the tape is delivering needs no comment", F.deliveryLine(quiet) === "");
  check("the lines pass the floor's own speech checker", spokenProblems([sw, stay, longWaits].map((p) => ({ character: "Jax", text: F.deliveryLine(p) }))).length === 0, spokenProblems([sw, stay].map((p) => ({ character: "Jax", text: F.deliveryLine(p) }))).join(" | "));
}

console.log("the Floor says it first");
{
  const k = { name: "A+ ES short", symbol: "ES", verdict: "WATCH", u: "SPY", type: "PUT", band: "A+", tier: "armed", awayPts: 2, futSymbol: "ES", futSide: "short", entry: 7832.88, stop: 7834.94, t1: 7829,
    pT1: 0.2, expR: -0.33, block: "BSL raid", strategy: "patty", setup: "", fit: 0.99, sequence: "STAND DOWN · NQ LEADS", entryLine: "x", key: "k", delivery: F.deliveryLine(stay0()) };
  function stay0() { return F.pickFocus([short(), long({ htfOk: false })], () => false, (c) => (c.side === "short" ? "against" : "with")); }
  const run = (builder, card, d) => builder({ st: freshTalkState(), f: new Facts(), key: "t:focus", now: 1_000_000 }, d(card));
  const jax = (ex) => ex?.lines.find((l) => l.character === "Jax")?.text ?? "";
  const first = jax(run(exTier, k, (card) => ({ card, from: null, to: "armed", b: null })));
  const step = jax(run(exTier, k, (card) => ({ card, from: "forming", to: "armed", b: null })));
  const entry = jax(run(exAtEntry, k, (card) => ({ card })));
  check("a new card: Jax opens with the delivery", first.startsWith("The 1 to 3 minute is delivering up, against this short"), first.slice(0, 100));
  check("a tier step: Jax opens with it too", step.startsWith("The 1 to 3 minute is delivering up, against this short"), step.slice(0, 100));
  check("at the entry: the delivery replaces the canned 'watch the entry' line", entry.startsWith("The 1 to 3 minute is delivering up") && !/Watch the entry|raid does not get/.test(entry), entry);
  const none = jax(run(exAtEntry, { ...k, delivery: null }, (card) => ({ card })));
  check("no delivery note: the old line stands", /raid does not get the order|Watch the entry/.test(none), none);
  check("none of it is over-long (the user's standing complaint)", [first, step, entry].every((t) => t.split(/\s+/).length <= 60), [first, step, entry].map((t) => t.split(/\s+/).length).join(","));
}

console.log("wired in, and no gate");
{
  const lw = readFileSync(new URL("../src/lib/room/live-world.ts", import.meta.url), "utf8");
  const fp = readFileSync(new URL("../src/lib/room/focus-pick.ts", import.meta.url), "utf8");
  check("the Floor's card read picks its focus with pickFocus and carries the line", /const pick = pickFocus\(/.test(lw) && /deliveryOfLadder\(ladderOf\(desk, x\.symbol\), x\)/.test(lw) && /delivery: deliveryLine\(pick\) \|\| null/.test(lw) && /const c = pick\.card;\s*const \{ u, b, plan, read \} = readOf\(c\);/.test(lw));
  check("it never touches a rule: no config, gate, size, floor or sleeve import", !/aplus\/config|profit-rules|options-sleeve|sleeve-sizing|APLUS_RULES|confluenceFloor/.test(fp));
  check("deterministic: no network, no model, no clock, no randomness", !/\bfetch\s*\(|anthropic|\bxai\b|Math\.random|Date\.now\s*\(|new Date\s*\(/.test(fp));
}

console.log(`\nfocus-pick: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
