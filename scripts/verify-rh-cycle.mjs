/**
 * The Robinhood cycle: look, place, manage, close. No click.
 *
 *   npx tsx scripts/verify-rh-cycle.mjs
 */
import { decideRhCycle, etMinOf, failedHoldClose, RH_DAY_FLAT_MIN, RH_FLATTEN_MIN } from "../src/lib/execution/rh-cycle.ts";

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

check("12:00 ET is after the day flat", etMinOf(noon) >= RH_DAY_FLAT_MIN, String(etMinOf(noon)));
check("10:00 ET is before the day flat", etMinOf(ten) < RH_DAY_FLAT_MIN, String(etMinOf(ten)));
check("15:40 ET is the flatten", etMinOf(flat) >= RH_FLATTEN_MIN, String(etMinOf(flat)));

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
  side: "short",
  failedHold: false,
  deskOwned: true,
  decisionKey: "k1",
  ...over,
});

const refused = { mode: "refused", gated: { ok: false, gate: "bp_floor", reason: "Buying power is under $150." }, ticket: null, placeShape: null, flags: {} };
const armed = {
  mode: "live_when_armed",
  gated: { ok: true, gate: "ok", reason: "clear" },
  ticket: null,
  placeShape: {
    optionId: "opt-new",
    quantity: 2,
    priceHint: 2.52,
    priceSource: "live_quote",
    underlier: "QQQ",
    decisionKey: "open-1",
    reason: "CE touch.",
  },
  flags: {},
};

const look = decideRhCycle({ proposal: refused, held: null, nowMs: ten });
check("a refused proposal looks", look.phase === "look" && look.order == null, look.phase);
check("the look says the gate", look.reason.includes("150"), look.reason);

const placed = decideRhCycle({ proposal: armed, held: null, nowMs: ten });
check("a live proposal places", placed.phase === "place", placed.phase);
check("the place is a buy to open on the agentic account", placed.order?.legs[0].side === "buy" && placed.order.legs[0].position_effect === "open" && placed.order.account_number === "995386158", JSON.stringify(placed.order?.legs));
check("the place limit is the live hint", placed.order?.price === "2.52" && placed.order?.type === "limit", placed.order?.price);

const noId = decideRhCycle({
  proposal: { ...armed, placeShape: { ...armed.placeShape, optionId: null } },
  held: null,
  nowMs: ten,
});
check("no option id does not place", noId.phase === "look", noId.phase);

const managing = decideRhCycle({ proposal: armed, held: held(), nowMs: ten });
check("an open desk position is managed, not added to", managing.phase === "manage" && managing.order == null, managing.phase);

const disaster = decideRhCycle({ proposal: null, held: held({ bid: 1.4 }), nowMs: ten });
check("a 30% premium loss closes", disaster.phase === "close", disaster.reason);
check("the close sells to close", disaster.order?.legs[0].side === "sell" && disaster.order.legs[0].position_effect === "close", disaster.order?.legs[0].side);
check("the close limit is the bid minus five cents", disaster.order?.price === "1.35", disaster.order?.price);

const flatten = decideRhCycle({ proposal: null, held: held(), nowMs: flat });
check("15:30 flattens a winner", flatten.phase === "close" && /15:30/.test(flatten.reason), flatten.reason);

const dayFlat = decideRhCycle({ proposal: null, held: held({ bid: 2.2 }), nowMs: noon });
check("11:00 closes a position under +50%", dayFlat.phase === "close", dayFlat.reason);

const runner = decideRhCycle({ proposal: null, held: held({ bid: 3.2 }), nowMs: noon });
check("11:00 keeps a position at +50% or better", runner.phase === "manage", runner.reason);

const manual = decideRhCycle({ proposal: armed, held: held({ deskOwned: false }), nowMs: ten });
check("a position this desk did not open is not closed and not added to", manual.phase === "look" && manual.order == null, manual.phase);

const level = decideRhCycle({ proposal: null, held: held({ mark: 103, bid: 2.1 }), nowMs: ten });
check("through the futures stop closes", level.phase === "close" && /invalidation/.test(level.reason), level.reason);

const fh = decideRhCycle({ proposal: null, held: held({ failedHold: true, bid: 2.1 }), nowMs: ten });
check("a failed 15-minute hold closes", fh.phase === "close" && /15-minute/.test(fh.reason), fh.reason);

check("failed hold is a close, not a wick", failedHoldClose({ side: "long", entry: 100, stop: 98, close: 98.5 }) === true, "");
check("a close still inside half the stop is not a failed hold", failedHoldClose({ side: "long", entry: 100, stop: 98, close: 99.5 }) === false, "");
check("unknown close is not a failed hold", failedHoldClose({ side: "short", entry: 100, stop: 102, close: null }) === false, "");

const nobid = decideRhCycle({ proposal: null, held: held({ bid: null }), nowMs: flat });
check("a flatten with no bid is a market close", nobid.order?.type === "market" && nobid.order.price == null, nobid.order?.type);

const forced = decideRhCycle({ proposal: refused, held: held(), nowMs: ten, forceClose: "Account is down. Flatten." });
check("forceClose sells a desk position before the clock", forced.phase === "close" && /Flatten/.test(forced.reason), forced.reason);
const notOurs = decideRhCycle({ proposal: null, held: held({ deskOwned: false }), nowMs: ten, forceClose: "Flatten." });
check("forceClose does not sell a position this desk did not open", notOurs.phase === "look" && notOurs.order == null, notOurs.phase);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
