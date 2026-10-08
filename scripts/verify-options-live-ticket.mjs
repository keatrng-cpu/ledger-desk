/**
 * The option ticket names a real contract, at a real price, sent the one
 * correct way — or it is not sent.
 *
 * WHAT WAS WRONG
 *
 * 1. THE DEBIT WAS INVENTED (item 8). `estimateDebitContract` built a price
 *    from spot x IV x sqrt(t) x 0.4, scaled by a delta the desk picked off a
 *    menu ("0DTE 0.40 delta"). The ticket then printed that as the price to
 *    pay and the strike as "ATM ~620". Robinhood fills ONE OCC contract at a
 *    price somebody is showing. On a 1 DTE ATM option the whole premium is
 *    about 0.4% of the ETF, so the model and the ask routinely differ by more
 *    than the premium — the ticket was a shape, not an order.
 *
 * 2. SIZE WAS NOT THE DISTANCE TO THE WICK (item 9). The comment said
 *    contracts = budget / (move to invalidation x delta x 100) and the code
 *    did solve that — but with the MENU delta and the item-8 estimate as the
 *    dollar. Two of the three inputs were invented, and the result was then
 *    clamped to 1-2 contracts.
 *
 * 3. THE ORDER CHASED (item 23). The model rested a limit at the middle of
 *    the array; the sender bought at the ask the moment the card said ARMED,
 *    which says nothing about where price is standing. A ticket could go in
 *    at the ask with the futures a full ATR from the array.
 *
 * 4. sweep_displace WAS TREATED AS A FILL (item 25). That state means the
 *    raid and the shift printed and price has NOT come back into the array.
 *    A marketable buy there is the chase by definition.
 *
 * WHAT IS PINNED HERE
 *   - a leg must come off a live get_option_quotes chain, with its own bid,
 *     ask and delta, a checkable OCC symbol, and a limit equal to the ask;
 *   - size solves from the LIVE delta and the raid-wick distance, inside the
 *     $50-$550 broker band, and SKIPS rather than oversizing;
 *   - nothing marketable leaves unless the futures are INSIDE the array;
 *   - sweep_displace + a live ltf_reaction arms a RESTING limit at the CE;
 *   - a working order is replaced at the new ask once, then cancelled, and a
 *     closed bar through the raid wick cancels it immediately.
 *
 * No claim here is an edge claim. Every one of them makes the ticket's price
 * and risk the price and risk the ticket says they are.
 *
 * Run: npx tsx scripts/verify-options-live-ticket.mjs
 */
const od = await import("../src/lib/trading/options-desk.ts");
const ss = await import("../src/lib/trading/sleeve-sizing.ts");
const gates = await import("../src/lib/execution/rh-autofire-gates.ts");

let pass = 0;
let fail = 0;
function check(name, ok, detail = "") {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);

const NOW = Date.UTC(2026, 9, 8, 14, 0, 0);
const fresh = NOW - 2_000;

/* ---------------- ITEM 8: a real contract at a real price ---------------- */
console.log("\nITEM 8 — the OCC symbol is built the one way and checked");

eq("QQQ 2026-10-09 put 620 is 21 chars", od.occSymbol("QQQ", "2026-10-09", "put", 620)?.length, 21);
eq("and reads as OCC does", od.occSymbol("QQQ", "2026-10-09", "put", 620), "QQQ   261009P00620000");
eq("a call flips one character", od.occSymbol("SPY", "2026-10-09", "call", 664.5), "SPY   261009C00664500");
eq("a bad date is refused", od.occSymbol("QQQ", "10/09/2026", "put", 620), null);
eq("a zero strike is refused", od.occSymbol("QQQ", "2026-10-09", "put", 0), null);

const leg = (over = {}) => ({
  occ: "QQQ   261009P00620000",
  optionId: "opt-1",
  underlier: "QQQ",
  type: "put",
  strike: 620,
  expiry: "2026-10-09",
  bid: 1.78,
  ask: 1.82,
  delta: -0.41,
  asOfMs: fresh,
  ...over,
});

console.log("\nITEM 8 — a contract is usable only when every number the limit needs is real");
check("a clean quote is usable", od.liveContractUsable(leg(), NOW).ok === true);
eq("and the ask is the ask", od.liveContractUsable(leg(), NOW).ask, 1.82);
eq("delta is taken as a magnitude", od.liveContractUsable(leg(), NOW).delta, 0.41);
check("no ask → refused", od.liveContractUsable(leg({ ask: null }), NOW).ok === false);
check("crossed book → refused", od.liveContractUsable(leg({ bid: 2.5 }), NOW).ok === false);
check("no delta → refused", od.liveContractUsable(leg({ delta: null }), NOW).ok === false);
check("delta of 1 → refused", od.liveContractUsable(leg({ delta: 1 }), NOW).ok === false);
check("a 60s-old quote → refused", od.liveContractUsable(leg({ asOfMs: NOW - 60_000 }), NOW).ok === false);
check("no broker id → refused", od.liveContractUsable(leg({ optionId: "" }), NOW).ok === false);
check(
  "an OCC that does not describe the contract → refused",
  od.liveContractUsable(leg({ occ: "QQQ   261009P00610000" }), NOW).ok === false,
);
check("a 30%-wide book → refused", od.liveContractUsable(leg({ bid: 1.3, ask: 1.9 }), NOW).ok === false);

console.log("\nITEM 8 — the contract is picked off the chain, never modelled");
const chain = (contracts, source = od.LIVE_CHAIN_SOURCE) => ({ underlier: "QQQ", contracts, source });
const near = leg({ occ: "QQQ   261009P00618000", optionId: "opt-near", strike: 618, delta: -0.33, bid: 1.1, ask: 1.14 });
const picked = od.pickLiveContract(chain([leg(), near]), { side: "put", deltaMin: 0.35, deltaMax: 0.45 }, NOW);
eq("the delta band picks the 0.41, not the 0.33", picked.contract?.optionId, "opt-1");
eq("and carries the live ask", picked.ask, 1.82);
check(
  "no chain at all → a refusal that says the ticket cannot be sent",
  /cannot be sent/.test(od.pickLiveContract(null, { side: "put", deltaMin: 0.3, deltaMax: 0.5 }, NOW).refusal ?? ""),
);
check(
  "a chain from anything but get_option_quotes → refused",
  "refusal" in od.pickLiveContract(chain([leg()], "model_grid"), { side: "put", deltaMin: 0.3, deltaMax: 0.5 }, NOW),
);
check(
  "nothing in the band → refused, no nearest-fit fallback",
  "refusal" in od.pickLiveContract(chain([near]), { side: "put", deltaMin: 0.45, deltaMax: 0.6 }, NOW),
);
check(
  "the wrong side is not borrowed from the other one",
  "refusal" in od.pickLiveContract(chain([leg()]), { side: "call", deltaMin: 0.35, deltaMax: 0.45 }, NOW),
);
// Ties on delta go to the tighter book — the crossing is the one certain cost.
const wide = leg({ occ: "QQQ   261009P00621000", optionId: "opt-wide", strike: 621, delta: -0.41, bid: 1.6, ask: 1.82 });
eq(
  "a delta tie goes to the tighter book",
  od.pickLiveContract(chain([wide, leg()]), { side: "put", deltaMin: 0.35, deltaMax: 0.45 }, NOW).contract.optionId,
  "opt-1",
);

/* ---------------- ITEM 9: size is the distance to the wick ---------------- */
console.log("\nITEM 9 — size solves from the LIVE delta and the raid-wick distance");

const plan = (over = {}) => ({
  symbol: "MNQ",
  side: "short",
  entry: 24_900,
  stop: 24_948,
  riskPts: 48,
  sweep: 24_944,
  ...over,
});
const sizeArgs = (over = {}) => ({
  delta: 0.41,
  askPerShare: 1.82,
  riskBudgetUsd: 150,
  minDebitUsd: gates.RH_MIN_DEBIT_TOTAL,
  maxDebitUsd: gates.RH_MAX_DEBIT_TOTAL,
  maxContracts: 4,
  dte: 1,
  ...over,
  plan: plan(over.plan),
});

eq("the broker band is the $50-$550 one", [gates.RH_MIN_DEBIT_TOTAL, gates.RH_MAX_DEBIT_TOTAL], [50, 550]);

const base = ss.sizeFromLiveContract(sizeArgs());
// MNQ/40: a 48pt stop is 1.2 ETF points. At delta 0.41 that is $49.20 a
// contract. $150 / 49.20 = 3.
eq("a 48pt stop at delta 0.41 buys 3", base.contracts, 3);
eq("the debit is the LIVE ask x 100 x 3", base.debitUsd, 546);
eq("and the limit is the live ask", base.limitPerShare, 1.82);
check("the loss at the level is inside the budget", base.lossAtInvalidationUsd <= 150, `${base.lossAtInvalidationUsd}`);
check("it names the raid wick", base.lines.some((l) => /raid wick 24944/.test(l)));

// THE DEFECT: a one-point wick and a twenty-point wick must not buy the same.
// Isolated on the RISK bound — a cheap contract and a high contract cap, so
// the $550 ceiling is not the thing deciding the count. (That the real $550
// ceiling and the 4-contract cap do bind is checked separately below.)
const geo = (riskPts, stop, sweep) =>
  ss.sizeFromLiveContract(sizeArgs({ askPerShare: 0.4, maxContracts: 20, plan: { riskPts, stop, sweep } }));
const geoBase = geo(48, 24_948, 24_944);
const tight = geo(12, 24_912, 24_908);
const wideStop = geo(72, 24_972, 24_968);
eq("a 48pt wick at delta 0.41 on a $40 contract buys 3", geoBase.contracts, 3);
eq("a 12pt wick buys 12", tight.contracts, 12);
eq("a 72pt wick buys 2", wideStop.contracts, 2);
// A 96pt wick on the same cheap contract buys ONE, which is $40 — under the
// $50 broker floor, so it is skipped rather than sent to be refused.
eq("and a 96pt wick is a skip, because one contract is under the floor", geo(96, 24_996, 24_990).contracts, 0);
check("a tighter wick buys MORE contracts", tight.contracts > geoBase.contracts, `${tight.contracts} vs ${geoBase.contracts}`);
check("a wider wick buys FEWER", wideStop.contracts < geoBase.contracts, `${wideStop.contracts} vs ${geoBase.contracts}`);
check("all three stay inside the budget", [geoBase, tight, wideStop].every((s) => s.lossAtInvalidationUsd <= 150));
eq("and RISK is what bound each of them", [geoBase.boundBy, tight.boundBy, wideStop.boundBy], ["risk", "risk", "risk"]);
// The real band and cap DO bind, and the ticket says which.
const ceilBound = ss.sizeFromLiveContract(sizeArgs({ plan: { riskPts: 12, stop: 24_912, sweep: 24_908 } }));
eq("a tight wick on a $182 contract is bound by the $550 ceiling", ceilBound.boundBy, "debit_ceiling");
eq("so it buys 3, not the 12 the geometry allowed", ceilBound.contracts, 3);
check(
  "and the ticket says the ceiling bound it, not the geometry",
  ceilBound.lines.some((l) => /ceiling bound the size/.test(l)),
  ceilBound.lines.join(" | "),
);
eq(
  "a 20-cent contract on a tight wick hits the 4-contract cap",
  ss.sizeFromLiveContract(sizeArgs({ askPerShare: 0.2, plan: { riskPts: 12, stop: 24_912, sweep: 24_908 } })).boundBy,
  "contract_cap",
);

// The LIVE delta moves the size. The menu delta cannot, because it is fixed.
const lowDelta = ss.sizeFromLiveContract(sizeArgs({ delta: 0.2, askPerShare: 0.9 }));
check("half the delta buys more contracts at the same risk", lowDelta.contracts > base.contracts);

console.log("\nITEM 9 — over the band is a SKIP, never a smaller guess");
const over = ss.sizeFromLiveContract(sizeArgs({ askPerShare: 6.0 }));
eq("one $600 contract is not bought", over.contracts, 0);
check("it is a skip", over.skip);
check("and it says it is over the ceiling", /over the \$550 ticket ceiling/i.test(over.skipReason ?? ""), over.skipReason ?? "");
check("the solved debit never exceeds the band", [base, tight, wideStop, geoBase, ceilBound].every((s) => s.debitUsd <= 550));

const underFloor = ss.sizeFromLiveContract(sizeArgs({ askPerShare: 0.2, delta: 0.41, maxContracts: 1 }));
eq("a $20 ticket under the $50 floor is not sent", underFloor.contracts, 0);
check("and says the floor refused it", /under the \$50 broker floor/.test(underFloor.skipReason ?? ""));

const unaffordable = ss.sizeFromLiveContract(
  sizeArgs({ plan: { stop: 26_000, riskPts: 1100, sweep: 25_990 }, delta: 0.8, askPerShare: 4.5 }),
);
eq("one contract past the budget is refused, not taken small", unaffordable.contracts, 0);
check("and it says not to take it small and hope", /small and hope/.test(unaffordable.skipReason ?? ""));

const tooTight = ss.sizeFromLiveContract(sizeArgs({ plan: { riskPts: 1.3, stop: 24_901.3, riskTooTight: true, riskAtr: 0.2 } }));
eq("a stop inside the noise is not sized off", tooTight.contracts, 0);
check("and it is said in those words", /STOP TOO TIGHT TO SIZE/.test(tooTight.skipReason ?? ""));

console.log("\nITEM 9 — the solve uses the level the position actually exits on");
// The stop sits BEYOND the raid wick. Sizing off the nearer wick would buy
// more contracts than the real exit distance supports.
eq("the farther of stop and wick is the exit", ss.exitLevelFor(plan()).exitPx, 24_948);
eq("and the wick is still named", ss.exitLevelFor(plan()).wickPx, 24_944);
eq("no wick on the plan → the stop", ss.exitLevelFor(plan({ sweep: null })).exitPx, 24_948);
const wickBeyond = ss.exitLevelFor(plan({ sweep: 24_960 }));
eq("a wick beyond the stop is the exit", wickBeyond.exitPx, 24_960);
check(
  "sizing off the nearer level would have bought more — it does not",
  ss.sizeFromLiveContract(sizeArgs({ plan: { stop: 24_944 } })).contracts >= base.contracts,
);

/* ---------------- ITEM 23: the order does not chase ---------------- */
console.log("\nITEM 23 — nothing marketable leaves unless the futures are IN the array");

const arr = (px, over = {}) =>
  od.arrayStateOf({ px, side: "short", entry: 24_900, zone: { top: 24_906, bottom: 24_894 }, stop: 24_948, sweep: 24_944, ...over });

eq("inside the array", arr(24_901).state, "inside");
eq("at the top edge is inside", arr(24_906).state, "inside");
eq("above the array is approaching", arr(24_920).state, "approaching");
eq("below the array is approaching", arr(24_870).state, "approaching");
eq("through the raid wick", arr(24_946).state, "through");
eq("no mark at all is unknown", arr(null).state, "unknown");
eq("the rest price is the middle of the array", arr(24_920).restAt, 24_900);
eq("a long reads the wick the other way", od.arrayStateOf({ px: 24_850, side: "long", entry: 24_900, zone: { top: 24_906, bottom: 24_894 }, stop: 24_856, sweep: 24_860 }).state, "through");

const planFor = (state, ask = 1.82, over = {}) =>
  od.orderPlanFor({ confirmation: "confirmed", components: ["ltf_reaction"], array: state, liveAsk: ask, ...over });

eq("price in the array → marketable at the live ask", planFor(arr(24_901)).kind, "marketable_limit");
eq("and the limit IS the live ask", planFor(arr(24_901)).limitPerShare, 1.82);
eq("price away → a resting limit, not a buy at the ask", planFor(arr(24_920)).kind, "resting_limit");
eq("resting at the CE", planFor(arr(24_920)).restAt, 24_900);
eq("through the wick → nothing", planFor(arr(24_946)).kind, "none");
eq("unknown location → nothing", planFor(arr(null)).kind, "none");
eq("no live ask → nothing, a model price is not an order", planFor(arr(24_901), null).kind, "none");
check("and it says so", /model price is not an order/.test(planFor(arr(24_901), null).reason));

/* ---------------- ITEM 25: sweep_displace is a rest, not a market ---------------- */
console.log("\nITEM 25 — sweep_displace arms a RESTING limit and sends nothing marketable");

const sd = (state, components = ["ltf_reaction"]) =>
  od.orderPlanFor({ confirmation: "sweep_displace", components, array: state, liveAsk: 1.82 });

eq("sweep_displace with price away → resting limit", sd(arr(24_920)).kind, "resting_limit");
check("and it says the trade is armed, not filled", /ARMED/.test(sd(arr(24_920)).reason));
check("and names the CE it waits at", /24900/.test(sd(arr(24_920)).reason.replace(/[.,]/g, "")));
eq("sweep_displace with NO ltf reaction → nothing at all", sd(arr(24_920), []).kind, "none");
check("and says a shift with no reaction is not an arm", /not an arm/.test(sd(arr(24_920), []).reason));
eq("sweep_displace once price is INSIDE the array → marketable", sd(arr(24_901)).kind, "marketable_limit");
eq("sweep_displace through the wick → nothing", sd(arr(24_946)).kind, "none");

/* ---------------- ITEM 8: never left pending ---------------- */
console.log("\nITEM 8 — a working order is replaced once at the new ask, then cancelled");

const work = (over = {}) =>
  od.decideWorkingOrder({
    placedAtMs: NOW,
    nowMs: NOW + 25_000,
    replacements: 0,
    filled: false,
    limitPerShare: 1.82,
    liveAsk: 1.9,
    side: "short",
    wickPx: 24_944,
    lastCloseSincePlace: 24_910,
    ...over,
  });

eq("the beat is 20s", od.RH_WORK_BEAT_MS, 20_000);
eq("only one replacement is allowed", od.RH_MAX_REPLACEMENTS, 1);
eq("inside the beat it holds", work({ nowMs: NOW + 5_000 }).action, "hold");
eq("past the beat it replaces", work().action, "replace");
eq("at the NEW ask", work().limitPerShare, 1.9);
eq("a second time it cancels", work({ replacements: 1 }).action, "cancel");
check("and says a pending order is not a plan", /not a plan/.test(work({ replacements: 1 }).reason));
eq("no live ask to replace at → cancel", work({ liveAsk: null }).action, "cancel");
eq("the ask has not moved → cancel rather than churn", work({ liveAsk: 1.82 }).action, "cancel");
eq("filled → nothing is working", work({ filled: true }).action, "hold");

console.log("\nITEM 23 — a closed bar through the raid wick cancels the working order");
eq("a short's close above the wick cancels", work({ nowMs: NOW + 1_000, lastCloseSincePlace: 24_950 }).action, "cancel");
check("even inside the beat", work({ nowMs: NOW + 1_000, lastCloseSincePlace: 24_950 }).action === "cancel");
eq(
  "a long's close below the wick cancels",
  work({ side: "long", wickPx: 24_860, lastCloseSincePlace: 24_850, nowMs: NOW + 1_000 }).action,
  "cancel",
);
// A WICK through is not a close through — the same rule as the failed-hold exit.
eq("a close still short of the wick does not cancel", work({ nowMs: NOW + 1_000, lastCloseSincePlace: 24_943 }).action, "hold");

/* ---------------- the sender's one answer ---------------- */
console.log("\nthe sender gets one answer, and a model ticket is never one of them");

const ticket = (over = {}) => ({
  contracts: 3,
  pricedFrom: "live_chain",
  live: {
    occ: "QQQ   261009P00620000",
    optionId: "opt-1",
    expiry: "2026-10-09",
    strike: 620,
    type: "put",
    bid: 1.78,
    ask: 1.82,
    delta: 0.41,
    limitPerShare: 1.82,
    asOfMs: fresh,
    exitPx: 24_948,
    wickPx: 24_944,
    lossAtInvalidationUsd: 147.6,
    boundBy: "risk",
  },
  order: { kind: "marketable_limit", limitPerShare: 1.82, restAt: 24_900, arrayState: "inside", reason: "at the array" },
  ...over,
});

eq("a live, in-array ticket is sendable", od.rhSendableFromTicket(ticket()).ok, true);
eq("as a limit at the live ask", od.rhSendableFromTicket(ticket()).limitPerShare, 1.82);
eq("for the solved quantity", od.rhSendableFromTicket(ticket()).quantity, 3);
eq("on the real contract", od.rhSendableFromTicket(ticket()).optionId, "opt-1");
eq(
  "a model-priced ticket is NOT sendable",
  od.rhSendableFromTicket(ticket({ pricedFrom: "model", live: null })).ok,
  false,
);
check(
  "and says why",
  /model estimate, not a contract/.test(od.rhSendableFromTicket(ticket({ pricedFrom: "model", live: null })).reason),
);
eq(
  "a resting ticket is not sendable as a buy",
  od.rhSendableFromTicket(ticket({ order: { kind: "resting_limit", limitPerShare: 1.82, restAt: 24_900, arrayState: "approaching", reason: "waiting" } })).ok,
  false,
);
eq("the live-quote adapter gives the gate what it wants", od.rhLiveQuoteFromTicket(ticket()).source, "get_option_quotes");
eq("with the live ask", od.rhLiveQuoteFromTicket(ticket()).askPrice, 1.82);
eq("and null on a model ticket, which is what makes the gate refuse", od.rhLiveQuoteFromTicket(ticket({ live: null })), null);

console.log(`\noptions-live-ticket: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
