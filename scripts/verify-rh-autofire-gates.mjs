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
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const NOW = Date.UTC(2026, 9, 6, 13, 35, 0);
// Fresh get_portfolio read that can afford the envelope (test fixture only).
const FUNDED = {
  label: "Agentic ••0000",
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
  check("min debit $150", gates.RH_MIN_DEBIT_TOTAL, 150);
  check("max debit $550", gates.RH_MAX_DEBIT_TOTAL, 550);
  check("contracts 1–4", [gates.RH_MIN_CONTRACTS, gates.RH_MAX_CONTRACTS], [1, 4]);
  check("written confirmation is on (Keaton chat 2026-10-06)", gates.RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING, true);
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

  const band = gates.evaluateRhAutofireGates({ ...QUALIFIED, pathBand: "B+" }, ARMED_FLAGS);
  check("B+ PATH refuses", [band.ok, band.gate], [false, "path_band"]);

  const low = gates.evaluateRhAutofireGates({ ...QUALIFIED, confluence: 0.64 }, ARMED_FLAGS);
  check("below 0.65 refuses", [low.ok, low.gate], [false, "path_floor"]);

  const stand = gates.evaluateRhAutofireGates({ ...QUALIFIED, agentAgree: false }, ARMED_FLAGS);
  check("Stand agent disagree refuses", [stand.ok, stand.gate], [false, "agent"]);
}

console.log("\nrisk / session / one-book");
{
  check("risk halt", gates.evaluateRhAutofireGates({ ...QUALIFIED, riskHalt: true }, ARMED_FLAGS).gate, "risk_halt");
  check("blackout", gates.evaluateRhAutofireGates({ ...QUALIFIED, newsBlackout: true }, ARMED_FLAGS).gate, "blackout");
  check("session", gates.evaluateRhAutofireGates({ ...QUALIFIED, optionsSessionOpen: false }, ARMED_FLAGS).gate, "session");
  check("one book", gates.evaluateRhAutofireGates({ ...QUALIFIED, oneBookBlocked: true }, ARMED_FLAGS).gate, "one_book");
}

console.log("\nticket envelope $150–$550 · 1–4 · ATM/OTM_1");
{
  const okEnv = gates.evaluateRhTicketEnvelope({ contracts: 2, debitTotal: 400, strikeOffset: "ATM" });
  check("ATM $400 / 2ct ok", okEnv.ok, true);

  const otm = gates.evaluateRhTicketEnvelope({ contracts: 3, debitTotal: 550, strikeOffset: "OTM_1" });
  check("OTM_1 $550 / 3ct ok", otm.ok, true);

  check("under $150 refuses", gates.evaluateRhTicketEnvelope({ contracts: 1, debitTotal: 149, strikeOffset: "ATM" }).gate, "debit_floor");
  check("over $550 refuses", gates.evaluateRhTicketEnvelope({ contracts: 2, debitTotal: 551, strikeOffset: "ATM" }).gate, "debit_cap");
  check("0 contracts refuses", gates.evaluateRhTicketEnvelope({ contracts: 0, debitTotal: 200, strikeOffset: "ATM" }).gate, "contracts");
  check("5 contracts refuses", gates.evaluateRhTicketEnvelope({ contracts: 5, debitTotal: 400, strikeOffset: "ATM" }).gate, "contracts");
  check("OTM_2 refuses", gates.evaluateRhTicketEnvelope({ contracts: 2, debitTotal: 300, strikeOffset: "OTM_2" }).gate, "strike_offset");
}

console.log("\nbuying-power hard gate (Keaton 2026-10-06: $984.12 cash / $11.56 BP)");
{
  const keaton = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: KEATON_LIVE }, ARMED_FLAGS);
  check("$11.56 BP refuses at bp_floor even fully qualified", [keaton.ok, keaton.gate], [false, "bp_floor"]);
  check("bp_floor reason names $11.56 and $150", /\$11\.56/.test(keaton.reason ?? "") && /\$150/.test(keaton.reason ?? ""), true);
  check("cash $984.12 is NOT spendable (BP rules)", gates.rhSpendable(KEATON_LIVE), 11.56);

  const none = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: undefined }, ARMED_FLAGS);
  check("no get_portfolio read refuses at bp_unknown", [none.ok, none.gate], [false, "bp_unknown"]);

  const snap = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: rh.RH_DESK_ACCOUNT_SNAPSHOT }, ARMED_FLAGS);
  check("desk snapshot (screenshot) cannot authorize", [snap.ok, snap.gate], [false, "bp_source"]);

  const stale = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, asOfMs: NOW - 6 * 60_000 } }, ARMED_FLAGS);
  check("6-min-old read refuses at bp_stale", [stale.ok, stale.gate], [false, "bp_stale"]);

  const noAccess = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, agenticAllowed: false } }, ARMED_FLAGS);
  check("account not tradable by agent refuses", [noAccess.ok, noAccess.gate], [false, "account_access"]);

  const noLvl = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, optionLevel: "" } }, ARMED_FLAGS);
  check("no options level refuses", [noLvl.ok, noLvl.gate], [false, "options_level"]);

  const optBp = gates.evaluateRhAutofireGates({ ...QUALIFIED, account: { ...FUNDED, optionsBuyingPower: 149.99 } }, ARMED_FLAGS);
  check("options BP below $150 refuses even with big BP", [optBp.ok, optBp.gate], [false, "bp_floor"]);

  check("$150.00 exactly clears the floor", gates.evaluateRhBuyingPower({ ...FUNDED, buyingPower: 150 }, NOW).ok, true);
  check("BP $300 refuses a $400 ticket", gates.evaluateRhBuyingPower({ ...FUNDED, buyingPower: 300 }, NOW, 400).gate, "bp_ticket");

  const parsed = rh.rhAccountFromPortfolio({
    portfolio: { data: { cash: "984.12", buying_power: { buying_power: "11.5600" } } },
    account: { account_number: "415577477", type: "cash", unsettled_funds: "972.5600", brokerage_account_type: "individual", agentic_allowed: false, option_level: "option_level_2" },
    asOfMs: NOW,
  });
  check("get_portfolio parse: BP from buying_power.buying_power", [parsed.buyingPower, parsed.cash, parsed.source], [11.56, 984.12, "get_portfolio"]);
  check("get_portfolio parse: masked label", parsed.label, "Individual ••7477");
  check("parsed Individual refuses (access first)", gates.evaluateRhBuyingPower(parsed, NOW).gate, "account_access");
  check("parsed Individual with access still refuses bp_floor", gates.evaluateRhBuyingPower({ ...parsed, agenticAllowed: true }, NOW).gate, "bp_floor");

  const flow = rh.candidateFromFloorPathStand({
    floor: { verdict: "ARMED", deskContracts: 2, band: "A+", confluence: 0.72 },
    pathActionable: true, agentAgree: true, optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
    account: KEATON_LIVE,
  });
  const p = rh.proposeRhLiveOption({ candidate: flow, ticket: null, flags: ARMED_FLAGS });
  check("candidateFromFloorPathStand carries account → propose refuses bp_floor", [p.mode, p.gated.gate], ["refused", "bp_floor"]);
}

console.log("\nhappy path when fully armed + confirmed + envelope");
{
  const g = gates.evaluateRhAutofireGates(QUALIFIED, ARMED_FLAGS);
  check("qualified + armed + confirmed → ok", g.ok, true);
  check("why names Floor / PATH / Stand", /Floor ARMED/.test(g.why ?? "") && /Stand agrees/.test(g.why ?? ""), true);

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
  const prop = rh.proposeRhLiveOption({
    candidate: QUALIFIED,
    ticket,
    flags: ARMED_FLAGS,
    refIdHint: "test-ref-1",
  });
  check("proposal mode live_when_armed", prop.mode, "live_when_armed");
  check("placeShape quantity", prop.placeShape?.quantity, 2);
  check("placeShape is buy open limit", [prop.placeShape?.side, prop.placeShape?.positionEffect, prop.placeShape?.type], ["buy", "open", "limit"]);
  check("optionId left null for agent resolve", prop.placeShape?.optionId, null);

  const overCap = rh.proposeRhLiveOption({
    candidate: QUALIFIED,
    ticket: { ...ticket, maxDebitTotal: 600 },
    flags: ARMED_FLAGS,
  });
  check("debit > $550 refuses", [overCap.gated.ok, overCap.gated.gate], [false, "debit_cap"]);

  const tooFar = rh.proposeRhLiveOption({
    candidate: QUALIFIED,
    ticket: { ...ticket, strikeOffset: "OTM_2" },
    flags: ARMED_FLAGS,
  });
  check("OTM_2 ticket refuses", [tooFar.gated.ok, tooFar.gated.gate], [false, "strike_offset"]);

  const thin = rh.proposeRhLiveOption({
    candidate: { ...QUALIFIED, account: { ...FUNDED, buyingPower: 300 } },
    ticket,
    flags: ARMED_FLAGS,
  });
  check("$400 ticket on $300 BP refuses bp_ticket", [thin.gated.ok, thin.gated.gate], [false, "bp_ticket"]);
}

console.log("\nmayPlaceAfterReview preflight");
{
  const base = {
    gatesStillOk: true,
    liveArmedNow: true,
    confirmedInWriting: true,
    reviewHadBlockingAlert: false,
    agenticAllowed: true,
    optionsLevelOk: true,
    accountAtReview: FUNDED,
    debitTotal: 400,
    nowMs: NOW,
  };
  check("clean review may place", rh.mayPlaceAfterReview(base).ok, true);
  check("no re-read at review refuses place", rh.mayPlaceAfterReview({ ...base, accountAtReview: undefined }).ok, false);
  check("$11.56 BP at review refuses place", rh.mayPlaceAfterReview({ ...base, accountAtReview: KEATON_LIVE }).ok, false);
  check("blocking alert refuses place", rh.mayPlaceAfterReview({ ...base, reviewHadBlockingAlert: true }).ok, false);
  check("disarm after review refuses place", rh.mayPlaceAfterReview({ ...base, liveArmedNow: false }).ok, false);
  check("default confirmation constant allows place when true", rh.mayPlaceAfterReview({ ...base, confirmedInWriting: undefined }).ok, true);
}

console.log("\nenv helpers default off (arm at 09:30 ET tomorrow)");
{
  check("autofireEnabled empty env", rh.rhAutofireEnabled({}), false);
  check("liveArmed empty env", rh.rhLiveArmed({}), false);
  check("autofireEnabled true", rh.rhAutofireEnabled({ RH_OPTIONS_AUTOFIRE_ENABLED: "true" }), true);
  check("liveArmed true", rh.rhLiveArmed({ RH_LIVE_ARMED: "true" }), true);
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

console.log("\nsource posture");
{
  const src = read("src/lib/execution/rh-autofire.ts");
  const gsrc = read("src/lib/execution/rh-autofire-gates.ts");
  check("gates file says review_option_order is the preview", /review_option_order/.test(gsrc) && /preview_option_order/.test(gsrc), true);
  check("confirmation is true with Keaton chat cite", /RH_OPTIONS_LIVE_CONFIRMED_IN_WRITING = true/.test(gsrc) && /Keaton confirmed in writing in chat/.test(gsrc), true);
  check("envelope constants present", /RH_MIN_DEBIT_TOTAL = 150/.test(gsrc) && /RH_MAX_DEBIT_TOTAL = 550/.test(gsrc), true);
  check("no place call in gates module", /CallDynamicTool|place_option_order\(/.test(gsrc), false);
  check("propose uses evaluateRhTicketEnvelope", /evaluateRhTicketEnvelope/.test(src), true);
  check("propose + place re-check evaluateRhBuyingPower", (src.match(/evaluateRhBuyingPower\(/g) ?? []).length >= 2, true);
  check("gates doc says agent must call get_portfolio", /get_portfolio/.test(gsrc), true);
  check("spendable never reads cash", /a\.cash/.test(gsrc), false);
  const msrc = read("src/lib/execution/manager-agree.ts");
  check("manager-agree adapter exports resolveStandAgentAgree", /export function resolveStandAgentAgree/.test(msrc), true);
  check("manager-agree does not place", /place_option_order|CallDynamicTool/.test(msrc), false);
  const asrc = read("src/lib/execution/manager-account.ts");
  check("manager-account does not place", /place_option_order|CallDynamicTool/.test(asrc), false);
  check("candidateFromFloorPathStand accepts manager", /manager\?:\s*ManagerRoomStateAgree/.test(src), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
