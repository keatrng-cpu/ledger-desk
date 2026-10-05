/**
 * The office props are a view of a decision, not a new one.
 *   npx tsx scripts/verify-floor-cues.mjs
 */
const { floorCues, stampOf } = await import("../src/lib/room/floor-cues.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const base = {
  etMin: 10 * 60 + 11,
  beat: "vetoed",
  refusalGate: "ev",
  refusal: "EV after the spread is not positive",
  execute: false,
  action: "HOLD",
  feedKind: "yahoo",
  lagSec: 12,
  synthetic: false,
  verdict: "ARMED",
  band: "A+",
  side: "long",
  tier: "live",
  missing: "LTF shift",
  rangePos: 0.8,
  jaxLastChaseWrong: false,
  quoteAgeSec: null,
  experiments: [{ title: "OTM ladder", n: 3, nNeeded: 8, status: "collecting" }],
  seats: [{ name: "Sterling", status: "running" }, { name: "Jax", status: "floor" }],
  blockedSeats: [],
  leader: "Vince",
  refusals: [{ pnlUsd: -40 }, { pnlUsd: 15 }],
  modelP: 0.4,
  calP: 0.3,
  highImpactMin: 10,
  killed: false,
  openPositions: 0,
  winsNeed: 16,
  tradeBudget: 9,
};

const a = floorCues(base);
check("a fresh tape does not tint the room", a.tint === "ink");
check("premium on a long is hostile", a.range?.zone === "premium" && a.range.hostile);
check("an EV veto returns the paper and stamps EV", a.flight === "return" && a.stamp === "EV");
check("an armed card is the one that pulses", a.armed);
check("a missing layer stays pinned until the card is armed", floorCues({ ...base, verdict: "WATCH" }).missing === "LTF shift");
check("T−15 of a high release frosts; the quote hand is quiet without a broker age", a.frost && a.quoteAgeSec == null && !a.quoteHot);
check("the ladder names the break when the winners will not fit", a.ladderBreak);
check("a floored seat sits and the leader is named", a.seated.includes("Jax") && a.leader === "Vince");
check("saved and cost are separated", a.savedUsd === 40 && a.costUsd === 15);
check("the closest experiment is the one nearest its bar", a.experiment?.title === "OTM ladder" && a.experiment.n === 3);

const late = floorCues({ ...base, beat: "vetoed", refusalGate: "fresh_tape", lagSec: 600, execute: false, action: "HOLD" });
check("a ten-minute print is amber and gets no flight", late.tint === "amber" && late.flight === "none" && late.stamp === "TAPE");

const syn = floorCues({ ...base, synthetic: true, feedKind: "synthetic", lagSec: 0, beat: "fill", execute: true, action: "BUY_OPEN" });
check("synthetic tape is a hatch and is not a fill", syn.tint === "hatch" && syn.flight === "none");

const fill = floorCues({ ...base, beat: "fill", refusalGate: null, execute: true, action: "BUY_OPEN", verdict: "ARMED" });
check("a fresh fill flies, and an armed card does not keep the pin", fill.flight === "fill" && fill.missing == null && fill.blotter === "live");

const gone = floorCues({ ...base, beat: "chop", tier: "gone", refusalGate: null, verdict: "WATCH" });
check("a chase slides the card back", gone.blotter === "back");

check("Jax's last wrong chase lets Sterling speak first", floorCues({ ...base, jaxLastChaseWrong: true }).sterlingFirst);
check("after 10:00 a card that is not A+ dims the killzone clock", floorCues({ ...base, etMin: 10 * 60 + 5, band: "A" }).clock.dim);
check("11:00 stops the clock", floorCues({ ...base, etMin: 11 * 60 }).clock.stopped);
const raid = floorCues({ ...base, etMin: 9 * 60 + 36, side: "short" });
check("Judas is a named raid only inside 09:30–09:45", raid.judas.on && raid.judas.side === "short");
check("a medium release does not frost", !floorCues({ ...base, highImpactMin: null }).frost);
check("a quote older than 15s is hot", floorCues({ ...base, quoteAgeSec: 20 }).quoteHot && !floorCues({ ...base, quoteAgeSec: 8 }).quoteHot);
check("the kill plate lights only when the server says so", floorCues({ ...base, killed: true, openPositions: 1 }).kill.lit && !floorCues({ ...base, killed: true, openPositions: 1 }).kill.flat);
check("TOO TIGHT stamps even without a gate id", stampOf(null, "STOP TOO TIGHT TO SIZE") === "TIGHT");
check("a halt stamp is HALT", stampOf("halt_day", null) === "HALT");

console.log(`\nfloor-cues: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
