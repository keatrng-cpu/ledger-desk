/**
 * Robinhood live options autofire — gates, envelope, confirmation.
 *
 * Run: npx tsx scripts/verify-rh-autofire-gates.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const gates = await import("../src/lib/execution/rh-autofire-gates.ts");
const rh = await import("../src/lib/execution/rh-autofire.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const NOW = Date.UTC(2026, 9, 6, 13, 35, 0);
// Fresh get_portfolio read that can afford the envelope (test fixture only).
const FUNDED = {
  label: "Agentic ••6158",
  accountNumber: "995386158",
  accountType: "limited_margin",
  cash: 2000,
  buyingPower: 2000,
  optionsBuyingPower: null,
  unsettledFunds: 0,
  agenticAllowed: true,
  optionLevel: "option_level_2",
  asOfMs: NOW - 30_000,
  source: "get_portfolio",
};
// Keaton screenshot 2026-10-06: Individual $984.12 cash, $11.56 BP — but as a FRESH live read.
const KEATON_LIVE = {
  label: "Individual ••7477",
  accountNumber: "995386158", // isolate the BP gate from the account-number gate
  accountType: "cash",
  cash: 984.12,
  buyingPower: 11.56,
  optionsBuyingPower: 11.56,
  unsettledFunds: 972.56,
  agenticAllowed: true, // isolate the BP gate from the access gate
  optionLevel: "option_level_2",
  asOfMs: NOW - 30_000,
  source: "get_portfolio",
};

const acctMod = await import("../src/lib/execution/manager-account.ts");
// Fresh, funded Agentic Manager block (test fixture only).
const MANAGER_OK = acctMod.toManagerRhAccount({
  cashUsd: 1000,
  optionsBuyingPowerUsd: 1000,
  asOf: new Date(NOW - 30_000).toISOString(),
  accountNumber: "995386158",
  agenticAllowed: true,
  optionLevel: "option_level_2",
  label: "Agentic",
});

const QUALIFIED = {
  floorVerdict: "ARMED",
  deskContracts: 2,
  pathActionable: true,
  pathBand: "A+",
  confluence: 0.72,
  agentAgree: true,
  optionsSessionOpen: true,
  newsBlackout: false,
  riskHalt: false,
  oneBookBlocked: false,
  account: FUNDED,
  // Floor rule signals (fail closed when missing). NOW = 09:35 ET.
  ceTouch: true,
  tapeAgeSec: 5,
  dte: 1,
};

const ARMED_FLAGS = {
  autofireEnabled: true,
  liveArmed: true,
  confirmedInWriting: true,
  nowMs: NOW,
};

console.log("PATH floor, envelope, confirmation");
{
  check("PATH floor is 0.65", gates.RH_PATH_FLOOR, 0.65);
  check("min debit $50", gates.RH_MIN_DEBIT_TOTAL, 50);
  check("max debit $550", gates.RH_MAX_DEBIT_TOTAL, 550);
  check("contracts 1–4", [gates.RH_MIN_CONTRACTS, gates.RH_MAX_CONTRACTS], [1, 4]);
  check("written confirmation is on (Keaton chat 2026-10-06)", gates.RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING, true);
}

console.log("\ncircuit breaker: one placement per 60 s, and no new entries once the account is down the desk's own daily limit");
{
  const NOW = ARMED_FLAGS.nowMs ?? Date.now();
  const gateOf = (r) => (r.ok ? "ok" : r.gate);
  const full = (over) => gates.evaluateRhAutofireGates({ ...QUALIFIED, ...over }, { ...ARMED_FLAGS, nowMs: NOW });
  check("the throttle is exactly 60 seconds (the trader's number)", gates.RH_MIN_PLACE_GAP_MS, 60_000);
  check("a candidate with no breaker input is not asserted: the baseline still passes the whole chain", gateOf(full({})), "ok");
  check("an order placed 59 s ago is refused: throttle", gateOf(full({ lastPlaceAtMs: NOW - 59_000 })), "throttle");
  check("an order placed 1 s ago is refused: throttle", gateOf(full({ lastPlaceAtMs: NOW - 1_000 })), "throttle");
  check("exactly 60 s ago is allowed", gateOf(full({ lastPlaceAtMs: NOW - 60_000 })), "ok");
  check("an hour ago is allowed", gateOf(full({ lastPlaceAtMs: NOW - 3_600_000 })), "ok");
  check("none placed today (null) is allowed", gateOf(full({ lastPlaceAtMs: null })), "ok");
  check("a placement stamped in the future is refused (clocks disagree: fail closed)", gateOf(full({ lastPlaceAtMs: NOW + 5_000 })), "throttle");
  check("... and says it is a clock disagreement, not an ordinary throttle", /future|clocks disagree/.test(gates.evaluateRhCircuitBreaker({ lastPlaceAtMs: NOW + 5_000 }, NOW).reason) && !/one placement per/.test(gates.evaluateRhCircuitBreaker({ lastPlaceAtMs: NOW + 5_000 }, NOW).reason), true);
  check("a non-finite stamp is not asserted (it cannot throttle, and it cannot pass for a fresh one)", gateOf(full({ lastPlaceAtMs: Number.NaN })), "ok");
  const LIMIT = (await import("../src/lib/aplus/config.ts")).APLUS_RULES.dailyLossLimitPct;
  check("the drawdown limit is the desk's own daily loss limit, not a new number", gates.evaluateRhCircuitBreaker({ dayPnlPct: -LIMIT }, NOW).ok, false);
  check("down exactly the limit: refused as drawdown", gateOf(full({ dayPnlPct: -LIMIT })), "drawdown");
  check("down more than the limit: refused as drawdown", gateOf(full({ dayPnlPct: -(LIMIT + 0.05) })), "drawdown");
  check("down a little less than the limit is allowed", gateOf(full({ dayPnlPct: -(LIMIT - 0.01) })), "ok");
  check("up on the day is allowed", gateOf(full({ dayPnlPct: 0.1 })), "ok");
  check("an unread P&L (null / NaN) is not asserted", [gateOf(full({ dayPnlPct: null })), gateOf(full({ dayPnlPct: Number.NaN }))], ["ok", "ok"]);
  const dd = gates.evaluateRhCircuitBreaker({ dayPnlPct: -(LIMIT + 0.01) }, NOW);
  check("the refusal says flatten is advised and does not place anything itself", /flatten what is open through review_option_order/.test(dd.reason) && Object.keys(dd).sort().join() === "gate,ok,reason", true);
  check("throttle and drawdown together: the throttle names itself first", gateOf(full({ lastPlaceAtMs: NOW - 1_000, dayPnlPct: -0.9 })), "throttle");
  check("the breaker cannot be skipped by an armed, confirmed, qualified candidate (it sits before the Floor rules)", gateOf(gates.evaluateRhAutofireGates({ ...QUALIFIED, lastPlaceAtMs: NOW - 5_000, floorVerdict: "WATCH" }, { ...ARMED_FLAGS, nowMs: NOW })), "throttle");
  check("an unarmed desk still says unarmed first (the breaker never masks the arm switches)", gateOf(gates.evaluateRhAutofireGates({ ...QUALIFIED, lastPlaceAtMs: NOW - 5_000 }, { autofireEnabled: false, liveArmed: true, confirmedInWriting: true, nowMs: NOW })), "autofire_off");
}

console.log("\nlive stays shut without arm / autofire (confirmation may be on)");
{
  const noAuto = gates.evaluateRhAutofireGates(QUALIFIED, { autofireEnabled: false, liveArmed: true, confirmedInWriting: true });
  check("autofire off refuses", [noAuto.ok, noAuto.gate], [false, "autofire_off"]);

  const noArm = gates.evaluateRhAutofireGates(QUALIFIED, { autofireEnabled: true, liveArmed: false, confirmedInWriting: true });
  check("disarmed refuses at live_arm", [noArm.ok, noArm.gate], [false, "live_arm"]);
  check("disarmed reason names RH_LIVE_ARMED", /RH_LIVE_ARMED/.test(noArm.reason ?? ""), true);

  const noConfirm = gates.evaluateRhAutofireGates(QUALIFIED, { autofireEnabled: true, liveArmed: true, confirmedInWriting: false });
  check("unconfirmed refuses at confirmed", [noConfirm.ok, noConfirm.gate], [false, "confirmed"]);
}

console.log("\ntriple agreement required");
{
  const floor = gates.evaluateRhAutofireGates({ ...QUALIFIED, floorVerdict: "WATCH" }, ARMED_FLAGS);
  check("Floor WATCH refuses", [floor.ok, floor.gate], [false, "floor"]);

  const noTicket = gates.evaluateRhAutofireGates({ ...QUALIFIED, deskContracts: 0 }, ARMED_FLAGS);
  check("no ticket refuses", [noTicket.ok, noTicket.gate], [false, "floor_ticket"]);

  const pathOff = gates.evaluateRhAutofireGates({ ...QUALIFIED, pathActionable: false }, ARMED_FLAGS);
  check("PATH not actionable refuses", [pathOff.ok, pathOff.gate], [false, "path_actionable"]);

  // Updated (not deleted) 2026-10-06: B+ is a LIVE grade behind its own explicit gate
  // (fit >= 0.60 · SEQ TAKE · no veto · 1 contract). A bare B+ (no SEQ / veto read) still refuses.
  const band = gates.evaluateRhAutofireGates({ ...QUALIFIED, pathBand: "B+" }, ARMED_FLAGS);
  check("bare B+ (no SEQ read) refuses bplus_seq", [band.ok, band.gate], [false, "bplus_seq"]);
  const bVeto = gates.evaluateRhAutofireGates({ ...QUALIFIED, pathBand: "B+", seqTake: true, vetoed: true }, ARMED_FLAGS);
  check("B+ veto refuses bplus_veto", [bVeto.ok, bVeto.gate], [false, "bplus_veto"]);
  const bOk = gates.evaluateRhAutofireGates({ ...QUALIFIED, pathBand: "B+", confluence: 0.6, seqTake: true, vetoed: false }, ARMED_FLAGS);
  check("B+ PATH passes with fit 0.60 + SEQ TAKE + no veto", bOk.ok, true);
  const bMinus = gates.evaluateRhAutofireGates({ ...QUALIFIED, pathBand: "B-", seqTake: true, vetoed: false }, ARMED_FLAGS);
  check("B- PATH refuses", [bMinus.ok, bMinus.gate], [false, "path_band"]);
  const bPlain = gates.evaluateRhAutofireGates({ ...QUALIFIED, pathBand: "B" }, ARMED_FLAGS);
  check("B PATH refuses", [bPlain.ok, bPlain.gate], [false, "path_band"]);

  const low = gates.evaluateRhAutofireGates({ ...QUALIFIED, confluence: 0.64 }, ARMED_FLAGS);
  check("below 0.65 refuses path_floor", [low.ok, low.gate], [false, "path_floor"]);

  const stand = gates.evaluateRhAutofireGates({ ...QUALIFIED, agentAgree: false }, ARMED_FLAGS);
  check("Stand disagree refuses", [stand.ok, stand.gate], [false, "agent"]);
}

console.log("\nrisk / session / one-book");
{
  check("risk halt", gates.evaluateRhAutofireGates({ ...QUALIFIED, riskHalt: true }, ARMED_FLAGS).gate, "risk_halt");
  check("blackout refuses", gates.evaluateRhAutofireGates({ ...QUALIFIED, confluence: 0.66, newsBlackout: true }, ARMED_FLAGS).gate, "blackout");
  check("blackout refuses an A+ too", gates.evaluateRhAutofireGates({ ...QUALIFIED, newsBlackout: true }, ARMED_FLAGS).gate, "blackout");
  check("session", gates.evaluateRhAutofireGates({ ...QUALIFIED, optionsSessionOpen: false }, ARMED_FLAGS).gate, "session");
  check("one book refuses", gates.evaluateRhAutofireGates({ ...QUALIFIED, oneBookBlocked: true }, ARMED_FLAGS).gate, "one_book");
}

console.log("\nticket envelope $50–$550 · 1–4 · ATM/OTM_1");
{
  const okEnv = gates.evaluateRhTicketEnvelope({ contracts: 2, debitTotal: 400, strikeOffset: "ATM" });
  check("ATM $400 / 2ct ok", okEnv.ok, true);

  const otm = gates.evaluateRhTicketEnvelope({ contracts: 3, debitTotal: 550, strikeOffset: "OTM_1" });
  check("OTM_1 $550 / 3ct ok", otm.ok, true);

  check("under $50 refuses", gates.evaluateRhTicketEnvelope({ contracts: 1, debitTotal: 49, strikeOffset: "ATM" }).gate, "debit_floor");
  check("over $550 refuses", gates.evaluateRhTicketEnvelope({ contracts: 2, debitTotal: 551, strikeOffset: "ATM" }).gate, "debit_cap");
  check("0 contracts refuses", gates.evaluateRhTicketEnvelope({ contracts: 0, debitTotal: 200, strikeOffset: "ATM" }).gate, "contracts");
  check("5 contracts refuses", gates.evaluateRhTicketEnvelope({ contracts: 5, debitTotal: 400, strikeOffset: "ATM" }).gate, "contracts");
  check("OTM_2 refuses", gates.evaluateRhTicketEnvelope({ contracts: 2, debitTotal: 300, strikeOffset: "OTM_2" }).gate, "strike_offset");
}

console.log("\nbuying-power hard gate (Keaton 2026-10-06: $984.12 cash / $11.56 BP)");
{
  const keaton = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: KEATON_LIVE }, ARMED_FLAGS);
  check("$11.56 BP refuses at bp_floor even fully qualified", [keaton.ok, keaton.gate], [false, "bp_floor"]);
  check("bp_floor reason names $11.56 and $50", /\$11\.56/.test(keaton.reason ?? "") && /\$50/.test(keaton.reason ?? ""), true);
  check("cash $984.12 is NOT spendable (BP rules)", gates.rhSpendable(KEATON_LIVE), 11.56);

  const none = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: undefined }, ARMED_FLAGS);
  check("no get_portfolio read refuses at bp_unknown", [none.ok, none.gate], [false, "bp_unknown"]);

  const snap = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: rh.RH_DESK_ACCOUNT_SNAPSHOT }, ARMED_FLAGS);
  check("desk snapshot (screenshot) cannot authorize", [snap.ok, snap.gate], [false, "bp_source"]);

  const stale = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, asOfMs: NOW - 6 * 60_000 } }, ARMED_FLAGS);
  check("6-min-old read refuses bp_stale even with buying power", [stale.ok, stale.gate], [false, "bp_stale"]);
  const staleDead = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, buyingPower: 0, cash: 0, asOfMs: NOW - 6 * 60_000 } }, ARMED_FLAGS);
  check("6-min-old read with no money refuses at bp_stale", [staleDead.ok, staleDead.gate], [false, "bp_stale"]);

  const noAccess = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, agenticAllowed: false } }, ARMED_FLAGS);
  check("account not tradable by agent refuses", [noAccess.ok, noAccess.gate], [false, "account_access"]);

  const noLvl = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, optionLevel: "" } }, ARMED_FLAGS);
  check("no options level refuses", [noLvl.ok, noLvl.gate], [false, "options_level"]);

  const optBp = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, optionsBuyingPower: 49 } }, ARMED_FLAGS);
  check("options BP below $50 refuses even with big BP", [optBp.ok, optBp.gate], [false, "bp_floor"]);

  check("$50.00 exactly clears the floor", gates.evaluateRhBuyingPower({ ...FUNDED, buyingPower: 50 }, NOW).ok, true);
  check("BP $300 refuses a $400 ticket", gates.evaluateRhBuyingPower({ ...FUNDED, buyingPower: 300 }, NOW, 400).gate, "bp_ticket");

  const parsed = rh.rhAccountFromPortfolio({
    portfolio: { data: { cash: "984.12", buying_power: { buying_power: "11.5600" } } },
    account: { account_number: "415577477", type: "cash", unsettled_funds: "972.5600", brokerage_account_type: "individual", agentic_allowed: false, option_level: "option_level_2" },
    asOfMs: NOW,
  });
  check("get_portfolio parse: BP from buying_power.buying_power", [parsed.buyingPower, parsed.cash, parsed.source], [11.56, 984.12, "get_portfolio"]);
  check("get_portfolio parse: masked label", parsed.label, "Individual ••7477");
  check("parsed carries account_number", parsed.accountNumber, "415577477");
  check("parsed Individual refuses (not the Agentic trade account)", gates.evaluateRhBuyingPower(parsed, NOW).gate, "bp_wrong_account");
  check("parsed Individual with access still refuses (wrong account)", gates.evaluateRhBuyingPower({ ...parsed, agenticAllowed: true }, NOW).gate, "bp_wrong_account");
  check("same read on Agentic number → bp_floor", gates.evaluateRhBuyingPower({ ...parsed, accountNumber: "995386158", agenticAllowed: true }, NOW).gate, "bp_floor");

  const flow = rh.candidateFromFloorPathStand({
    floor: { verdict: "ARMED", deskContracts: 2, band: "A+", confluence: 0.72 },
    pathActionable: true, agentAgree: true, optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
    account: KEATON_LIVE,
  });
  const p = rh.proposeRhLiveOption({ candidate: flow, ticket: null, flags: ARMED_FLAGS });
  check("candidateFromFloorPathStand carries account → propose refuses bp_floor", [p.mode, p.gated.gate], ["refused", "bp_floor"]);
}

console.log("\nhard BP gate — fail closed on unknown / wrong account (Accuracy)");
{
  const bp = (a, d) => gates.evaluateRhBuyingPower(a, NOW, d).gate ?? "ok";
  check("preferred account is Agentic 995386158 / 6158", [gates.RH_PREFERRED_ACCOUNT_NUMBER, gates.RH_PREFERRED_ACCOUNT_MASK_LAST4, gates.RH_PREFERRED_ACCOUNT_LABEL], ["995386158", "6158", "Agentic"]);
  check("fresh funded Agentic ok", bp(FUNDED), "ok");
  check("null account → bp_unknown", bp(null), "bp_unknown");
  check("BP null → bp_unknown", bp({ ...FUNDED, buyingPower: null }), "bp_unknown");
  check("BP undefined → bp_unknown", bp({ ...FUNDED, buyingPower: undefined }), "bp_unknown");
  check("BP NaN → bp_unknown", bp({ ...FUNDED, buyingPower: NaN }), "bp_unknown");
  check("BP string → bp_unknown", bp({ ...FUNDED, buyingPower: "2000" }), "bp_unknown");
  check("options BP NaN → bp_unknown", bp({ ...FUNDED, optionsBuyingPower: NaN }), "bp_unknown");
  const noBp = rh.rhAccountFromPortfolio({ portfolio: { data: { cash: "1000" } }, account: { account_number: "995386158", type: "limited_margin", agentic_allowed: true, option_level: "option_level_2" }, asOfMs: NOW });
  check("get_portfolio without buying_power → bp_unknown", bp(noBp), "bp_unknown");
  check("Agentic unfunded $0 → bp_floor", bp({ ...FUNDED, cash: 0, buyingPower: 0 }), "bp_floor");
  check("missing account number → bp_wrong_account", bp({ ...FUNDED, accountNumber: undefined }), "bp_wrong_account");
  check("Individual 415577477 → bp_wrong_account", bp({ ...FUNDED, accountNumber: "415577477" }), "bp_wrong_account");
  check("agenticAllowed unknown → account_access", bp({ ...FUNDED, agenticAllowed: null }), "account_access");
  check("option level not reported does not refuse", bp({ ...FUNDED, optionLevel: null }), "ok");
  const { account: _drop, ...noAcct } = QUALIFIED;
  check("autofire: candidate without account → bp_unknown", gates.evaluateRhAutofireGates(noAcct, ARMED_FLAGS).gate, "bp_unknown");
  check("autofire: BP null → bp_unknown", gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, buyingPower: null } }, ARMED_FLAGS).gate, "bp_unknown");
  check("autofire: BP $0 with cash on the snapshot refuses (cash is not spendable)", gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, buyingPower: 0 } }, ARMED_FLAGS).ok, false);
  const t = { underlier: "QQQ", side: "call", dteTarget: 1, strikeNote: "ATM", strikeOffset: "ATM", contracts: 2, estDebitEach: 2, maxDebitTotal: 400, decisionKey: "k", reason: "r" };
  const pr = rh.proposeRhLiveOption({ candidate: noAcct, ticket: t, flags: ARMED_FLAGS });
  check("propose without account → refused, no placeShape", [pr.mode, pr.placeShape, pr.gated.gate], ["refused", null, "bp_unknown"]);
}

console.log("\nFloor rules (fail closed when signals missing)");
{
  const at = (iso) => ({ ...ARMED_FLAGS, nowMs: Date.parse(iso) });
  const acctAt = (iso) => ({ ...FUNDED, asOfMs: Date.parse(iso) - 10_000 });
  const g = (o, f = ARMED_FLAGS) => gates.evaluateRhAutofireGates({ ...QUALIFIED, ...o }, f).gate ?? "ok";
  check("09:35 ET A+ qualified ok", g({}), "ok");
  check("09:35 ET band A ok", g({ pathBand: "A" }), "ok");
  check("10:15 ET band A still ok — clock cuts size, it does not ban", g({ pathBand: "A", account: acctAt("2026-10-06T14:15:00Z") }, at("2026-10-06T14:15:00Z")), "ok");
  check("10:15 ET band A+ ok", g({ account: acctAt("2026-10-06T14:15:00Z") }, at("2026-10-06T14:15:00Z")), "ok");
  check("11:00 ET still ok — clock cuts size", g({ account: acctAt("2026-10-06T15:00:00Z") }, at("2026-10-06T15:00:00Z")), "ok");
  check("DTE 2 → dte", g({ dte: 2 }), "dte");
  check("DTE missing → dte", g({ dte: undefined }), "dte");
  check("tape missing refuses tape_unknown", g({ tapeAgeSec: undefined }), "tape_unknown");
  check("tape 31s refuses tape_stale", g({ tapeAgeSec: 31 }), "tape_stale");
  check("tape 30s ok", g({ tapeAgeSec: 30 }), "ok");
  check("CE touch missing refuses", g({ ceTouch: undefined }), "ce_touch");
  check("CE touch false refuses", g({ ceTouch: false }), "ce_touch");
}

console.log("\nhappy path when fully armed + confirmed + envelope");
{
  const g = gates.evaluateRhAutofireGates(QUALIFIED, ARMED_FLAGS);
  check("qualified + armed + confirmed → ok", g.ok, true);
  check("why names Floor and the Stand", /Floor ARMED/.test(g.why ?? "") && /Stand agrees/.test(g.why ?? ""), true);

  const ticket = {
    underlier: "QQQ",
    side: "call",
    dteTarget: 1,
    expiry: "2026-10-07",
    strikeNote: "ATM ~778",
    strikeOffset: "ATM",
    contracts: 2,
    estDebitEach: 2.0,
    maxDebitTotal: 400,
    decisionKey: "E|2026-10-06|MNQ:long:31000",
    reason: "path_continuation · PATH A+",
  };
  const liveQuote = {
    optionId: "opt-happy",
    askPrice: 1.98,
    bidPrice: 1.95,
    asOfMs: NOW - 3_000,
    source: "get_option_quotes",
  };
  const prop = rh.proposeRhLiveOption({
    candidate: QUALIFIED,
    ticket,
    flags: ARMED_FLAGS,
    refIdHint: "test-ref-1",
    liveQuote,
  });
  check("proposal mode live_when_armed", prop.mode, "live_when_armed");
  check("placeShape quantity", prop.placeShape?.quantity, 2);
  check("placeShape is buy open limit", [prop.placeShape?.side, prop.placeShape?.positionEffect, prop.placeShape?.type], ["buy", "open", "limit"]);
  check("placeShape uses live quote", prop.placeShape?.priceSource, "live_quote");
  check("optionId from live quote", prop.placeShape?.optionId, "opt-happy");
  const noQuote = rh.proposeRhLiveOption({
    candidate: QUALIFIED,
    ticket,
    flags: ARMED_FLAGS,
    refIdHint: "test-ref-1",
  });
  check("propose missing liveQuote refuses", [noQuote.mode, noQuote.gated.gate, noQuote.placeShape], ["refused", "live_quote", null]);

  const overCap = rh.proposeRhLiveOption({
    candidate: QUALIFIED,
    ticket: { ...ticket, maxDebitTotal: 600 },
    flags: ARMED_FLAGS,
    liveQuote,
  });
  check("debit > $550 refuses", [overCap.gated.ok, overCap.gated.gate], [false, "debit_cap"]);

  const tooFar = rh.proposeRhLiveOption({
    candidate: QUALIFIED,
    ticket: { ...ticket, strikeOffset: "OTM_2" },
    flags: ARMED_FLAGS,
    liveQuote,
  });
  check("OTM_2 ticket refuses", [tooFar.gated.ok, tooFar.gated.gate], [false, "strike_offset"]);

  const thin = rh.proposeRhLiveOption({
    candidate: { ...QUALIFIED, account: { ...FUNDED, buyingPower: 300 } },
    ticket,
    flags: ARMED_FLAGS,
    liveQuote,
  });
  check("$400 ticket on $300 BP refuses bp_ticket", [thin.gated.ok, thin.gated.gate], [false, "bp_ticket"]);
}

console.log("\nmayPlaceAfterReview preflight");
{
  const reviewQuote = {
    optionId: "opt-review",
    askPrice: 1.98,
    bidPrice: 1.95,
    asOfMs: NOW - 3_000,
    source: "get_option_quotes",
  };
  const base = {
    gatesStillOk: true,
    liveArmedNow: true,
    confirmedInWriting: true,
    reviewHadBlockingAlert: false,
    agenticAllowed: true,
    optionsLevelOk: true,
    accountAtReview: FUNDED,
    account: MANAGER_OK,
    debitTotal: 400,
    liveQuote: reviewQuote,
    quantity: 2,
    nowMs: NOW,
  };
  check("clean review with liveQuote may place", rh.mayPlaceAfterReview(base).ok, true);
  check("review missing liveQuote refuses", rh.mayPlaceAfterReview({ ...base, liveQuote: undefined }).ok, false);
  const { liveQuote: _q, ...noQuote } = base;
  check("review omitted liveQuote refuses", rh.mayPlaceAfterReview(noQuote).ok, false);
  const { account: _m, ...noManager } = base;
  check("no Manager account key refuses place (fail closed)", rh.mayPlaceAfterReview(noManager).ok, false);
  check("Manager block BP $300 < $400 debit refuses place", rh.mayPlaceAfterReview({ ...base, account: { ...MANAGER_OK, optionsBuyingPowerUsd: 300 } }).ok, false);
  check("no re-read at review refuses place", rh.mayPlaceAfterReview({ ...base, accountAtReview: undefined }).ok, false);
  check("$11.56 BP at review refuses place", rh.mayPlaceAfterReview({ ...base, accountAtReview: KEATON_LIVE }).ok, false);
  check("a review disclosure does not wait for a click", rh.mayPlaceAfterReview({ ...base, reviewHadBlockingAlert: true }).ok, true);
  check("disarm after review refuses place", rh.mayPlaceAfterReview({ ...base, liveArmedNow: false }).ok, false);
  check("default confirmation constant allows place when true", rh.mayPlaceAfterReview({ ...base, confirmedInWriting: undefined }).ok, true);
}

console.log("\nenv helpers default armed (false is the disarm)");
{
  check("autofireEnabled empty env is armed", rh.rhAutofireEnabled({}), true);
  check("liveArmed empty env is armed", rh.rhLiveArmed({}), true);
  check("autofireEnabled true", rh.rhAutofireEnabled({ RH_OPTIONS_AUTOFIRE_ENABLED: "true" }), true);
  check("liveArmed true", rh.rhLiveArmed({ RH_LIVE_ARMED: "true" }), true);
  check("explicit false disarms", [rh.rhAutofireEnabled({ RH_OPTIONS_AUTOFIRE_ENABLED: "false" }), rh.rhLiveArmed({ RH_LIVE_ARMED: "false" })], [false, false]);
  // The kill switch must not fail open on a word it does not recognize (2026-10-07).
  for (const word of ["disabled", "disable", "nope", "f", "n", "stop", "0", "off", "no", "FALSE", " False ", "unarmed", "tru"]) {
    check(`'${word}' disarms both switches`, [rh.rhAutofireEnabled({ RH_OPTIONS_AUTOFIRE_ENABLED: word }), rh.rhLiveArmed({ RH_LIVE_ARMED: word })], [false, false]);
  }
  for (const word of ["true", "TRUE", " true ", "1", "on", "yes"]) {
    check(`'${word}' arms both switches`, [rh.rhAutofireEnabled({ RH_OPTIONS_AUTOFIRE_ENABLED: word }), rh.rhLiveArmed({ RH_LIVE_ARMED: word })], [true, true]);
  }
  check("blank or whitespace is the armed default, same as unset", [rh.rhAutofireEnabled({ RH_OPTIONS_AUTOFIRE_ENABLED: "  " }), rh.rhLiveArmed({ RH_LIVE_ARMED: "" })], [true, true]);
}


console.log("\nManager → agentAgree wiring (design step 5)");
{
  const { verifyManagerAgree } = await import("./verify-manager-agree.mjs");
  await verifyManagerAgree(gates, rh, check, ARMED_FLAGS, FUNDED);
}

console.log("\nManagerRoomState.account (read-only RH block)");
{
  const { verifyManagerAccount } = await import("./verify-manager-account.mjs");
  await verifyManagerAccount(rh, check);
}

console.log("\nReal Manager feed (room state) → RH live loop");
{
  const { verifyManagerLiveLoop } = await import("./verify-manager-live-loop.mjs");
  await verifyManagerLiveLoop(check);
}

console.log("\nsource posture");
{
  const src = read("src/lib/execution/rh-autofire.ts");
  const gsrc = read("src/lib/execution/rh-autofire-gates.ts");
  check("gates file says review_option_order is the preview", /review_option_order/.test(gsrc) && /preview_option_order/.test(gsrc), true);
  check("confirmation is true with Keaton chat cite", /RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING = true/.test(gsrc) && /Keaton confirmed in writing in chat/.test(gsrc), true);
  check("envelope constants present", /RH_MIN_DEBIT_TOTAL = 50/.test(gsrc) && /RH_MAX_DEBIT_TOTAL = 550/.test(gsrc), true);
  check("no place call in gates module", /CallDynamicTool|place_option_order\(/.test(gsrc), false);
  check("propose uses evaluateRhTicketEnvelope", /evaluateRhTicketEnvelope/.test(src), true);
  check("propose + place re-check evaluateRhBuyingPower", (src.match(/evaluateRhBuyingPower\(/g) ?? []).length >= 2, true);
  check("gates doc says agent must call get_portfolio", /get_portfolio/.test(gsrc), true);
  check("a zero buying-power read does not fall back to cash", /a\.cash/.test(gsrc), false);
  const msrc = read("src/lib/execution/manager-agree.ts");
  check("manager-agree adapter exports resolveStandAgentAgree", /export function resolveStandAgentAgree/.test(msrc), true);
  check("manager-agree does not place", /place_option_order|CallDynamicTool/.test(msrc), false);
  const asrc = read("src/lib/execution/manager-account.ts");
  check("manager-account does not place", /place_option_order|CallDynamicTool/.test(asrc), false);
  check("rh-autofire never hardcodes env arms true", /RH_LIVE_ARMED\s*=\s*true|RH_OPTIONS_AUTOFIRE_ENABLED\s*=\s*true/.test(src + gsrc), false);
  check("rh-autofire does not place", /place_option_order\(|CallDynamicTool/.test(src), false);
  check("candidateFromFloorPathStand accepts manager", /manager\?:\s*ManagerRoomStateAgree/.test(src), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
