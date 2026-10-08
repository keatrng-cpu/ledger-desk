/**
 * The Robinhood cycle: look, place, manage, trim, close. No click.
 *
 *   npx tsx scripts/verify-rh-cycle.mjs
 */
import {
  armedSideOf,
  closedThroughStop,
  decideRhCycle,
  drawReached,
  etMinOf,
  failedHoldClose,
  partialDone,
  trimQuantity,
  RH_DAY_FLAT_MIN,
  RH_DISASTER_PCT,
  RH_FLATTEN_MIN,
} from "../src/lib/execution/rh-cycle.ts";

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const at = (iso) => Date.parse(iso);
const noon = at("2026-10-07T16:00:00Z"); // 12:00 ET
const ten = at("2026-10-07T14:00:00Z"); // 10:00 ET
const flat = at("2026-10-07T19:40:00Z"); // 15:40 ET

check("12:00 ET is after the room's 11:00 clock", etMinOf(noon) >= RH_DAY_FLAT_MIN, String(etMinOf(noon)));
check("10:00 ET is before it", etMinOf(ten) < RH_DAY_FLAT_MIN, String(etMinOf(ten)));
check("15:40 ET is the flatten", etMinOf(flat) >= RH_FLATTEN_MIN, String(etMinOf(flat)));

/** A short QQQ put: entry 100, raid wick (stop) 102, first draw 96. */
const held = (over = {}) => ({
  optionId: "opt-1",
  underlier: "QQQ",
  optionType: "put",
  quantity: 2,
  avgDebit: 2,
  bid: 2.1,
  mark: 100,
  entry: 100,
  stop: 102,
  t1: 96,
  close15: 100,
  openedQuantity: 2,
  side: "short",
  failedHold: false,
  deskOwned: true,
  decisionKey: "k1",
  ...over,
});

const refused = { mode: "refused", gated: { ok: false, gate: "bp_floor", reason: "Buying power is under $150." }, ticket: null, placeShape: null, flags: {} };
const shapeOf = (over = {}) => ({
  optionId: "opt-new",
  quantity: 2,
  priceHint: 2.52,
  priceSource: "live_quote",
  underlier: "QQQ",
  optionType: "put",
  decisionKey: "open-1",
  reason: "CE touch.",
  ...over,
});
const armed = { mode: "live_when_armed", gated: { ok: true, gate: "ok", reason: "clear" }, ticket: null, placeShape: shapeOf(), flags: {} };

/* ---------- what did not change ---------- */

const look = decideRhCycle({ proposal: refused, held: null, nowMs: ten });
check("a refused proposal looks", look.phase === "look" && look.order == null, look.phase);
check("the look says the gate", look.reason.includes("150"), look.reason);

const placed = decideRhCycle({ proposal: armed, held: null, nowMs: ten });
check("a live proposal places", placed.phase === "place", placed.phase);
check("the place is a buy to open on the agentic account", placed.order?.legs[0].side === "buy" && placed.order.legs[0].position_effect === "open" && placed.order.account_number === "995386158", JSON.stringify(placed.order?.legs));
check("the place limit is the live hint", placed.order?.price === "2.52" && placed.order?.type === "limit", placed.order?.price);

const noId = decideRhCycle({ proposal: { ...armed, placeShape: shapeOf({ optionId: null }) }, held: null, nowMs: ten });
check("no option id does not place", noId.phase === "look", noId.phase);

const managing = decideRhCycle({ proposal: armed, held: held(), nowMs: ten });
check("an open desk position is managed, not added to", managing.phase === "manage" && managing.order == null, managing.phase);

const flatten = decideRhCycle({ proposal: null, held: held(), nowMs: flat });
check("15:30 flattens a winner", flatten.phase === "close" && /15:30/.test(flatten.reason), flatten.reason);
check("the 15:30 close is the whole position", flatten.order?.quantity === "2" && flatten.partial !== true, flatten.order?.quantity);

const manual = decideRhCycle({ proposal: armed, held: held({ deskOwned: false }), nowMs: ten });
check("a position this desk did not open is not closed and not added to", manual.phase === "look" && manual.order == null, manual.phase);

const level = decideRhCycle({ proposal: null, held: held({ mark: 103 }), nowMs: ten });
check("through the futures hard stop closes", level.phase === "close" && /invalidation/.test(level.reason), level.reason);
check("the close sells to close", level.order?.legs[0].side === "sell" && level.order.legs[0].position_effect === "close", level.order?.legs[0].side);
check("the close limit is the bid minus five cents", level.order?.price === "2.05", level.order?.price);

const fh = decideRhCycle({ proposal: null, held: held({ failedHold: true }), nowMs: ten });
check("a failed 15-minute hold closes", fh.phase === "close" && /15-minute close/.test(fh.reason), fh.reason);

check("failed hold is a close, not a wick", failedHoldClose({ side: "long", entry: 100, stop: 98, close: 98.5 }) === true, "");
check("a close still inside half the stop is not a failed hold", failedHoldClose({ side: "long", entry: 100, stop: 98, close: 99.5 }) === false, "");
check("unknown close is not a failed hold", failedHoldClose({ side: "short", entry: 100, stop: 102, close: null }) === false, "");

const nobid = decideRhCycle({ proposal: null, held: held({ bid: null }), nowMs: flat });
check("a flatten with no bid is a market close", nobid.order?.type === "market" && nobid.order.price == null, nobid.order?.type);

const forced = decideRhCycle({ proposal: refused, held: held(), nowMs: ten, forceClose: "Account is down. Flatten." });
check("forceClose sells a desk position before the clock", forced.phase === "close" && /Flatten/.test(forced.reason), forced.reason);
const notOurs = decideRhCycle({ proposal: null, held: held({ deskOwned: false }), nowMs: ten, forceClose: "Flatten." });
check("forceClose does not sell a position this desk did not open", notOurs.phase === "look" && notOurs.order == null, notOurs.phase);

/* ---------- the 11:00 clock: full size through it (standing rule) ---------- */

const pastEleven = decideRhCycle({ proposal: null, held: held({ bid: 2.2 }), nowMs: noon });
check("11:00 does not flatten a position in profit", pastEleven.phase === "manage", pastEleven.reason);
const pastElevenFlat = decideRhCycle({ proposal: null, held: held({ bid: 1.9 }), nowMs: noon });
check("11:00 does not flatten a position offside either", pastElevenFlat.phase === "manage", pastElevenFlat.reason);

/* ---------- ITEM 2 — the partial at the first draw ---------- */

check("half of 2 is 1", trimQuantity(2) === 1, String(trimQuantity(2)));
check("half of 3 is 1", trimQuantity(3) === 1, String(trimQuantity(3)));
check("half of 4 is 2", trimQuantity(4) === 2, String(trimQuantity(4)));
check("one contract cannot be halved", trimQuantity(1) === 0, String(trimQuantity(1)));
check("a trim never sells the whole position", [2, 3, 4, 5, 9].every((q) => trimQuantity(q) < q), "");

check("the draw is reached on a short when the mark falls to it", drawReached({ side: "short", t1: 96, mark: 96 }) === true, "");
check("the draw is not reached before it", drawReached({ side: "short", t1: 96, mark: 96.25 }) === false, "");
check("the draw is reached on a long when the mark rises to it", drawReached({ side: "long", t1: 104, mark: 104.5 }) === true, "");
check("no draw on the card means no draw reached", drawReached({ side: "short", t1: null, mark: 90 }) === false, "");

const draw = decideRhCycle({ proposal: null, held: held({ quantity: 2, mark: 95.8, bid: 3.4 }), nowMs: ten });
check("the first draw sells PART of the position", draw.phase === "close" && draw.partial === true, `${draw.phase} ${draw.partial}`);
check("the partial REDUCES, it does not flatten", draw.order?.quantity === "1", draw.order?.quantity);
check("the partial is a sell to close", draw.order?.legs[0].side === "sell" && draw.order.legs[0].position_effect === "close", "");
check("the partial has its own refKey, so the sender mints a second UUID", draw.order?.refKey === "trim:k1", draw.order?.refKey);
check("the partial is limited at the bid minus five cents", draw.order?.price === "3.35", draw.order?.price);
check("the partial says the rest runs with its stop at entry", /rest runs with its stop at entry/.test(draw.reason), draw.reason);

const drawFour = decideRhCycle({ proposal: null, held: held({ quantity: 4, openedQuantity: 4, mark: 95.8 }), nowMs: ten });
check("four contracts sell two at the draw", drawFour.order?.quantity === "2" && drawFour.partial === true, drawFour.order?.quantity);

const one = decideRhCycle({ proposal: null, held: held({ quantity: 1, openedQuantity: 1, mark: 95.8 }), nowMs: ten });
check("one contract does not trim at the draw", one.phase === "manage", `${one.phase} ${one.reason}`);

const drawAgain = decideRhCycle({ proposal: null, held: held({ quantity: 1, openedQuantity: 2, mark: 95.8 }), nowMs: ten });
check("the partial does not sell twice", drawAgain.phase === "manage", `${drawAgain.phase} ${drawAgain.reason}`);

check("the quantity falling below what was opened IS the partial", partialDone(held({ quantity: 1, openedQuantity: 2 })) === true, "");
check("an untouched position has no partial", partialDone(held({ quantity: 2, openedQuantity: 2 })) === false, "");
check("an unknown opened quantity is not read as a partial", partialDone(held({ quantity: 2, openedQuantity: undefined })) === false, "");

/* stop → entry ONLY after the partial */
const beBefore = decideRhCycle({ proposal: null, held: held({ quantity: 2, openedQuantity: 2, mark: 100 }), nowMs: ten });
check("before the partial, a touch of entry does NOT close", beBefore.phase === "manage", `${beBefore.phase} ${beBefore.reason}`);
const beAfter = decideRhCycle({ proposal: null, held: held({ quantity: 1, openedQuantity: 2, mark: 100 }), nowMs: ten });
check("after the partial, a touch of entry closes the rest", beAfter.phase === "close" && /breakeven/.test(beAfter.reason), `${beAfter.phase} ${beAfter.reason}`);
check("the breakeven close takes the whole rest", beAfter.order?.quantity === "1" && beAfter.partial !== true, beAfter.order?.quantity);
const beRunning = decideRhCycle({ proposal: null, held: held({ quantity: 1, openedQuantity: 2, mark: 98 }), nowMs: ten });
check("after the partial, a runner still in profit is managed", beRunning.phase === "manage", beRunning.reason);

/* a close through the wick takes whatever is left */
const wickRest = decideRhCycle({ proposal: null, held: held({ quantity: 1, openedQuantity: 2, mark: 101, close15: 102.5 }), nowMs: ten });
check("a close beyond the wick takes the runner", wickRest.phase === "close" && /closed beyond the raid wick/.test(wickRest.reason), `${wickRest.phase} ${wickRest.reason}`);
check("that close is the whole remainder", wickRest.order?.quantity === "1" && wickRest.partial !== true, wickRest.order?.quantity);

/* ---------- ITEM 3 — the premium is a backstop, not the invalidation ---------- */

check("the backstop is still 25%", RH_DISASTER_PCT === 0.25, String(RH_DISASTER_PCT));

check("a closed bar beyond the short's wick is the invalidation", closedThroughStop({ side: "short", stop: 102, close: 102.25 }) === true, "");
check("a closed bar inside the wick is not", closedThroughStop({ side: "short", stop: 102, close: 101.75 }) === false, "");
check("a closed bar beyond a long's wick is the invalidation", closedThroughStop({ side: "long", stop: 98, close: 97.5 }) === true, "");
check("no closed bar is not an invalidation", closedThroughStop({ side: "long", stop: 98, close: null }) === false, "");

/* -30% premium, mark INSIDE the wick, nothing closed through it */
const wickOnly = decideRhCycle({ proposal: null, held: held({ bid: 1.4, mark: 101.5, close15: 101.5 }), nowMs: ten });
check("a mark inside the wick does NOT close on a -30% premium", wickOnly.phase === "manage", `${wickOnly.phase} ${wickOnly.reason}`);
check("the manage line names what still governs", /raid wick/.test(wickOnly.reason), wickOnly.reason);

/* the same -30%, but a 15m candle closed through the wick */
const wickClosed = decideRhCycle({ proposal: null, held: held({ bid: 1.4, mark: 101.5, close15: 102.4 }), nowMs: ten });
check("a close beyond the wick DOES close", wickClosed.phase === "close" && /invalidation/.test(wickClosed.reason), `${wickClosed.phase} ${wickClosed.reason}`);

/* the backstop still exists where structure cannot be read */
const noMark = decideRhCycle({ proposal: null, held: held({ bid: 1.4, mark: null, close15: null }), nowMs: ten });
check("no futures mark falls back to the premium backstop", noMark.phase === "close" && /no futures mark/.test(noMark.reason), `${noMark.phase} ${noMark.reason}`);
const noStop = decideRhCycle({ proposal: null, held: held({ bid: 1.4, stop: null, close15: null }), nowMs: ten });
check("no level on the card falls back to the premium backstop", noStop.phase === "close" && /no level/.test(noStop.reason), `${noStop.phase} ${noStop.reason}`);
const noMarkOk = decideRhCycle({ proposal: null, held: held({ bid: 1.75, mark: null, close15: null }), nowMs: ten });
check("the backstop does not fire above -25% with no mark", noMarkOk.phase === "manage", `${noMarkOk.phase} ${noMarkOk.reason}`);

/*
 * The numbers scripts/verify-rh-dispatch.mjs's "close" blocks use (short MNQ,
 * entry 21000, raid wick 21030, mark 21000, bid 1.40 on a $2.00 debit = -30%).
 * That fixture sold on the premium alone while the plan was intact — the exact
 * thing ITEM 3 refuses. Its desk mark has to go through the wick to sell.
 */
const dispatchPlan = (mark) => held({ underlier: "QQQ", optionType: "put", side: "short", entry: 21000, stop: 21030, t1: 20950, mark, close15: mark, bid: 1.4, avgDebit: 2 });
const dispatchIntact = decideRhCycle({ proposal: null, held: dispatchPlan(21000), nowMs: ten });
check("dispatch fixture: -30% with the mark at entry is managed, not sold", dispatchIntact.phase === "manage", `${dispatchIntact.phase} ${dispatchIntact.reason}`);
const dispatchStopped = decideRhCycle({ proposal: null, held: dispatchPlan(21040), nowMs: ten });
check("dispatch fixture: a mark of 21040 (through the 21030 wick) sells it", dispatchStopped.phase === "close" && dispatchStopped.order?.legs[0].side === "sell", `${dispatchStopped.phase} ${dispatchStopped.reason}`);

/* ---------- ITEM 22 — the wrong book comes off, and nothing new goes out ---------- */

const armedCall = { ...armed, placeShape: shapeOf({ optionType: "call", decisionKey: "open-2" }) };
const flip = decideRhCycle({ proposal: armedCall, held: held(), nowMs: ten });
check("a held put while the desk is armed call is CLOSED", flip.phase === "close" && /bias flipped/.test(flip.reason), `${flip.phase} ${flip.reason}`);
check("the flip close sells, it never opens", flip.order?.legs[0].side === "sell" && flip.order.legs[0].position_effect === "close", JSON.stringify(flip.order?.legs));
check("no new ticket goes out while the old book is still on", flip.order?.refKey === "close:k1", flip.order?.refKey);
check("the flip close is the whole position", flip.order?.quantity === "2", flip.order?.quantity);

const flipExplicit = decideRhCycle({ proposal: refused, held: held(), nowMs: ten, armed: { underlier: "QQQ", optionType: "call" } });
check("the armed side can be passed in when the proposal cannot carry it", flipExplicit.phase === "close" && /bias flipped/.test(flipExplicit.reason), `${flipExplicit.phase} ${flipExplicit.reason}`);

const sameSide = decideRhCycle({ proposal: armed, held: held(), nowMs: ten, armed: { underlier: "QQQ", optionType: "put" } });
check("the same side is not a flip", sameSide.phase === "manage", `${sameSide.phase} ${sameSide.reason}`);
const otherIndex = decideRhCycle({ proposal: null, held: held(), nowMs: ten, armed: { underlier: "SPY", optionType: "put" } });
check("the other index, same direction, is not a flip", otherIndex.phase === "manage", `${otherIndex.phase} ${otherIndex.reason}`);
const foreignFlip = decideRhCycle({ proposal: armedCall, held: held({ deskOwned: false }), nowMs: ten });
check("a flip does NOT touch a position this desk did not open", foreignFlip.phase === "look" && foreignFlip.order == null, foreignFlip.phase);

check("the armed side reads off the place shape", armedSideOf(armedCall)?.optionType === "call", JSON.stringify(armedSideOf(armedCall)));
check("a refused proposal carries no armed side", armedSideOf(refused) === null, JSON.stringify(armedSideOf(refused)));
check("an explicit armed side wins", armedSideOf(armed, { underlier: "SPY", optionType: "call" })?.underlier === "SPY", "");

/* ---------- ITEM 4 — the overnight runner is REFUSED ---------- */

const oneDte = decideRhCycle({ proposal: null, held: held({ bid: 3.6, mark: 95, close15: 95 }), nowMs: flat });
check("15:30 flattens a 1 DTE winner with an intact wick and an unswept draw", oneDte.phase === "close" && /15:30/.test(oneDte.reason), `${oneDte.phase} ${oneDte.reason}`);
check("the 15:30 flatten takes every contract", oneDte.order?.quantity === "2" && oneDte.partial !== true, oneDte.order?.quantity);
const oneDteTrimmed = decideRhCycle({ proposal: null, held: held({ quantity: 1, openedQuantity: 2, bid: 3.6, mark: 95, close15: 95 }), nowMs: flat });
check("15:30 flattens the runner too — nothing is carried overnight", oneDteTrimmed.phase === "close" && /15:30/.test(oneDteTrimmed.reason), oneDteTrimmed.reason);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
