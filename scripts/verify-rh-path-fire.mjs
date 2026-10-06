/**
 * RH live path — PATH scanner FIRE is the place trigger; grades A+/A/A-/B+;
 * Floor signals (CE touch / tape / DTE) wired; live quote preferred.
 *
 * Run: npx tsx scripts/verify-rh-path-fire.mjs
 * Never places. Never calls a broker.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const gates = await import("../src/lib/execution/rh-autofire-gates.ts");
const rh = await import("../src/lib/execution/rh-autofire.ts");
const alarm = await import("../src/lib/alerts/path-alarm.ts");
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};

const NOW = Date.UTC(2026, 9, 6, 13, 35, 0); // 09:35 ET
const AFTER_10 = Date.UTC(2026, 9, 6, 14, 5, 0); // 10:05 ET
const FLAGS = { autofireEnabled: true, liveArmed: true, confirmedInWriting: true, nowMs: NOW };
const FUNDED = {
  label: "Agentic ••6158", accountNumber: "995386158", accountType: "limited_margin",
  cash: 1000, buyingPower: 1000, optionsBuyingPower: null, unsettledFunds: 0,
  agenticAllowed: true, optionLevel: "option_level_2", asOfMs: NOW - 20_000, source: "get_portfolio",
};
const BASE = {
  floorVerdict: "ARMED", deskContracts: 2, pathActionable: true, pathBand: "A+", confluence: 0.72,
  agentAgree: true, optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
  account: FUNDED, ceTouch: true, tapeAgeSec: 5, dte: 0,
};
// B+ explicit gate inputs (Accuracy 2026-10-06): SEQ TAKE + no veto. Ignored for A+/A/A-.
const BPLUS_OK = { seqTake: true, vetoed: false };
const g = (c, f = FLAGS) => {
  const r = gates.evaluateRhAutofireGates(c, f);
  return r.ok ? "ok" : r.gate;
};

console.log("grades accepted: A+, A, A-, B+");
{
  check("RH_PATH_GRADES", [...gates.RH_PATH_GRADES], ["A+", "A", "A-", "B+"]);
  check("matches config onlyExecuteGrades", [...APLUS_RULES.profitPath.onlyExecuteGrades], [...gates.RH_PATH_GRADES]);
  check("PATH floor unchanged 0.65", gates.RH_PATH_FLOOR, 0.65);
  check("B+ floor = config band (confluenceFloor - 0.05) = 0.60", gates.RH_PATH_FLOOR_BPLUS, 0.6);
  check("floor by band", gates.RH_PATH_FLOOR_BY_BAND, { "A+": 0.65, A: 0.65, "A-": 0.65, "B+": 0.6 });
  for (const b of ["A+", "A", "A-", "A−"]) check(`${b} @0.66 passes`, g({ ...BASE, pathBand: b, confluence: 0.66 }), "ok");
  check("A- @0.64 refuses path_floor", g({ ...BASE, pathBand: "A-", confluence: 0.64 }), "path_floor");
  check("B+ @0.60 + SEQ TAKE + no veto passes (LIVE path, not paper-only)", g({ ...BASE, ...BPLUS_OK, pathBand: "B+", confluence: 0.6 }), "ok");
  check("B+ @0.62 + SEQ TAKE + no veto passes", g({ ...BASE, ...BPLUS_OK, pathBand: "B+", confluence: 0.62 }), "ok");
  check("B+ @0.59 refuses path_floor", g({ ...BASE, ...BPLUS_OK, pathBand: "B+", confluence: 0.59 }), "path_floor");
  check("B refuses", g({ ...BASE, pathBand: "B", confluence: 0.7 }), "path_band");
  check("C refuses", g({ ...BASE, pathBand: "C", confluence: 0.7 }), "path_band");
  check("null band refuses", g({ ...BASE, pathBand: null }), "path_band");
  check("after 10:00 ET a 30-min-old BP read refuses bp_stale", g({ ...BASE, pathBand: "B+", confluence: 0.62 }, { ...FLAGS, nowMs: AFTER_10 }), "bp_stale");
  check("B+ after 10:00 ET (fresh BP) refuses aplus_after_10",
    g({ ...BASE, pathBand: "B+", confluence: 0.62, account: { ...FUNDED, asOfMs: AFTER_10 - 10_000 } }, { ...FLAGS, nowMs: AFTER_10 }), "aplus_after_10");
}

console.log("\nPATH alarm fires on B+ (isPathFire) — isHighProbPath unchanged");
{
  const cand = (pathBand, confluence, actionable = true) => ({ pathBand, grade: "B", confluence, actionable });
  check("isPathFire B+ 0.60", alarm.isPathFire(cand("B+", 0.6)), true);
  check("isPathFire B+ 0.59 false", alarm.isPathFire(cand("B+", 0.59)), false);
  check("isPathFire B+ not actionable false", alarm.isPathFire(cand("B+", 0.7, false)), false);
  check("isPathFire A- 0.66", alarm.isPathFire({ pathBand: "A-", grade: "A-", confluence: 0.66, actionable: true }), true);
  check("isPathFire B false", alarm.isPathFire(cand("B", 0.7)), false);
  check("isHighProbPath B+ still false (paper/sequence readers unchanged)", alarm.isHighProbPath(cand("B+", 0.7)), false);
  check("PATH_FIRE_BANDS", [...alarm.PATH_FIRE_BANDS], ["A+", "A", "A-", "B+"]);
  const src = read("src/lib/alerts/path-alarm.ts");
  check("considerPathAlarm keys off isPathFire", /if \(!isPathFire\(candidate\) \|\| !candidate\) return null;/.test(src), true);
}

console.log("\nFloor signals wired (CE touch / tape <= 30s / DTE 0/1)");
{
  const plan = { symbol: "MNQ", side: "short", price: 21010, entry: 21000, entryZone: { top: 21005, bottom: 20995 }, stop: 21030, t1: 20950 };
  const desk = (price, fetchedAtMs = NOW - 4_000, side = "short") => ({
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    left: { symbol: "MNQ" }, right: { symbol: "MES" },
    quotes: { left: { price }, right: { price: 6000 } },
    smcMaster: { left: { symbol: "MNQ", side, plan: { ...plan, side } }, right: { symbol: "MES", side: "long", plan: null } },
  });
  const s = (d, sym = "MNQ", side = "short", dte = 0) => rh.rhFloorSignals({ desk: d, symbol: sym, side, dte, nowMs: NOW });
  const inZone = s(desk(21001));
  check("in array → ceTouch true", inZone.ceTouch, true);
  check("tape age from desk.fetchedAt", Math.round(inZone.tapeAgeSec), 4);
  check("dte from Floor card", inZone.dte, 0);
  check("far from array → ceTouch false", s(desk(21200)).ceTouch, false);
  check("through the stop side → ceTouch false", s(desk(21100 - 200 + 300)).ceTouch, false);
  check("book side mismatch → false", s(desk(21001, NOW - 4_000, "long"), "MNQ", "short").ceTouch, false);
  check("no book for symbol → null", s(desk(21001), "NQX").ceTouch, null);
  check("no desk → all null", [rh.rhFloorSignals({ nowMs: NOW }).ceTouch, rh.rhFloorSignals({ nowMs: NOW }).tapeAgeSec, rh.rhFloorSignals({ nowMs: NOW }).dte], [null, null, null]);
  check("bad fetchedAt → tape null", rh.rhTapeAgeSec("nope", NOW), null);

  const cand = (d, dte = 0) => rh.candidateFromFloorPathStand({
    floor: { verdict: "ARMED", deskContracts: 2, band: "B+", confluence: 0.62, dte },
    pathActionable: true, agentAgree: true, optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
    account: FUNDED, desk: d, pathSymbol: "MNQ", pathSide: "short", nowMs: NOW, ...BPLUS_OK,
  });
  const c = cand(desk(21001));
  check("candidate carries derived signals", [c.ceTouch, Math.round(c.tapeAgeSec), c.dte], [true, 4, 0]);
  check("derived B+ candidate PASSES gates (no longer zero trades)", g(c), "ok");
  check("stale tape (45s) refuses tape_stale", g(cand(desk(21001, NOW - 45_000))), "tape_stale");
  check("DTE 3 refuses dte", g(cand(desk(21001), 3)), "dte");
  check("no CE touch refuses ce_touch", g(cand(desk(21200))), "ce_touch");
  const legacy = rh.candidateFromFloorPathStand({
    floor: { verdict: "ARMED", deskContracts: 2, band: "A+", confluence: 0.72 },
    pathActionable: true, agentAgree: true, optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false, account: FUNDED,
  });
  check("no desk / no signals → still fail closed", g(legacy), "dte");
}

console.log("\nlive option quote preferred over model priceHint");
{
  const ticket = rh.ticketFromRhCard({
    underlier: "QQQ", side: "put", dteTarget: 0, strikeNote: "ATM", strikeOffset: "ATM",
    contracts: 2, estDebitEach: 1.2, estDebitTotal: 240, decisionKey: "k1", reason: "test",
  });
  const q = (ask, ageMs = 3_000, extra = {}) => ({ optionId: "opt-1", askPrice: ask, bidPrice: ask - 0.03, asOfMs: NOW - ageMs, source: "get_option_quotes", ...extra });
  const live = rh.buildRhReviewPlaceShape(ticket, "r", q(1.5), NOW);
  check("live ask + $0.02 used", [live.priceSource, live.priceHint, live.debitTotal, live.optionId], ["live_quote", 1.52, 304, "opt-1"]);
  const model = rh.buildRhReviewPlaceShape(ticket, "r", null, NOW);
  check("no quote → model (labelled)", [model.priceSource, model.priceHint], ["model", 1.22]);
  check("stale quote → model", rh.buildRhReviewPlaceShape(ticket, "r", q(1.5, 60_000), NOW).priceSource, "model");
  check("crossed quote → model", rh.buildRhReviewPlaceShape(ticket, "r", q(1.5, 1000, { bidPrice: 1.9 }), NOW).priceSource, "model");
  const c = { ...BASE, pathBand: "A-", confluence: 0.66 };
  const ok = rh.proposeRhLiveOption({ candidate: c, ticket, flags: FLAGS, liveQuote: q(1.5) });
  check("propose with live quote → live_when_armed", [ok.mode, ok.placeShape?.priceSource], ["live_when_armed", "live_quote"]);
  const over = rh.proposeRhLiveOption({ candidate: c, ticket, flags: FLAGS, liveQuote: q(2.9) });
  check("live debit $584 > $550 refuses debit_cap", [over.mode, over.gated.gate], ["refused", "debit_cap"]);
  const thin = rh.proposeRhLiveOption({ candidate: { ...c, account: { ...FUNDED, buyingPower: 280 } }, ticket, flags: FLAGS, liveQuote: q(1.5) });
  check("live debit $304 > BP $280 refuses bp_ticket", [thin.mode, thin.gated.gate], ["refused", "bp_ticket"]);
  const base = {
    gatesStillOk: true, liveArmedNow: true, confirmedInWriting: true, reviewHadBlockingAlert: false,
    agenticAllowed: true, optionsLevelOk: true, accountAtReview: FUNDED,
    account: rh.toManagerRhAccount({ cashUsd: 1000, optionsBuyingPowerUsd: 1000, asOf: new Date(NOW - 20_000).toISOString(), accountNumber: "995386158", agenticAllowed: true, optionLevel: "option_level_2", label: "Agentic" }),
    debitTotal: 240, nowMs: NOW,
  };
  check("review with fresh live quote may place", rh.mayPlaceAfterReview({ ...base, liveQuote: q(1.5), quantity: 2 }).ok, true);
  check("review with stale live quote refuses", rh.mayPlaceAfterReview({ ...base, liveQuote: q(1.5, 60_000), quantity: 2 }).ok, false);
  check("review with null live quote refuses", rh.mayPlaceAfterReview({ ...base, liveQuote: null, quantity: 2 }).ok, false);
  check("review live debit $584 refuses", rh.mayPlaceAfterReview({ ...base, liveQuote: q(2.9), quantity: 2 }).ok, false);
  check("review live debit vs BP $280 refuses", rh.mayPlaceAfterReview({ ...base, accountAtReview: { ...FUNDED, buyingPower: 280 }, liveQuote: q(1.5), quantity: 2 }).ok, false);
}

console.log("\nPATH fire → propose (primary trigger, never places)");
{
  const ticket = rh.ticketFromRhCard({
    underlier: "QQQ", side: "put", dteTarget: 0, strikeNote: "ATM", strikeOffset: "ATM",
    contracts: 2, estDebitEach: 1.2, estDebitTotal: 240, decisionKey: "k2", reason: "fire",
  });
  const fire = (grade, confluence, at = NOW - 2_000, extra = {}) => ({ key: `d:${grade}`, symbol: "MNQ", side: "short", grade, confluence, at, ...extra });
  const args = (f, extra = {}) => ({
    fire: f, floor: { verdict: "ARMED", deskContracts: 2, band: "A-", confluence: 0.66 }, ticket,
    agentAgree: true, optionsSessionOpen: true, newsBlackout: false, riskHalt: false, oneBookBlocked: false,
    account: FUNDED, ceTouch: true, tapeAgeSec: 3, dte: 0, flags: FLAGS, nowMs: NOW,
    liveQuote: { optionId: "opt-2", askPrice: 1.4, bidPrice: 1.37, asOfMs: NOW - 2_000, source: "get_option_quotes" }, ...extra,
  });
  const m = (a) => { const r = rh.proposeRhFromPathFire(a); return r.mode === "live_when_armed" ? "ok" : r.gated.gate; };
  // B+ live: one contract, SEQ TAKE, no veto (1 × $1.62 = $162, inside $150-$550).
  const ticket1 = rh.ticketFromRhCard({
    underlier: "QQQ", side: "put", dteTarget: 0, strikeNote: "ATM", strikeOffset: "ATM",
    contracts: 1, estDebitEach: 1.6, estDebitTotal: 160, decisionKey: "k3", reason: "fire B+",
  });
  const bplus = { ...BPLUS_OK, ticket: ticket1, liveQuote: { optionId: "opt-3", askPrice: 1.6, bidPrice: 1.57, asOfMs: NOW - 2_000, source: "get_option_quotes" } };
  for (const [b, q] of [["A+", 0.78], ["A", 0.69], ["A-", 0.66]]) check(`PATH fire ${b} → live_when_armed`, m(args(fire(b, q))), "ok");
  check("PATH fire B+ (1ct, SEQ TAKE, no veto) → live_when_armed", m(args(fire("B+", 0.61), bplus)), "ok");
  check("PATH fire B+ with a 2-contract ticket refuses bplus_size", m(args(fire("B+", 0.61), { ...BPLUS_OK })), "bplus_size");
  check("PATH fire B+ without SEQ TAKE refuses bplus_seq", m(args(fire("B+", 0.61), { ...bplus, seqTake: false })), "bplus_seq");
  check("PATH fire B+ vetoed refuses bplus_veto", m(args(fire("B+", 0.61), { ...bplus, vetoed: true })), "bplus_veto");
  check("fire B refuses path_band", m(args(fire("B", 0.7))), "path_band");
  check("fire B+ 0.58 refuses path_floor", m(args(fire("B+", 0.58), bplus)), "path_floor");
  check("no fire refuses path_fire", m(args(null)), "path_fire");
  check("stale fire (45s) refuses", m(args(fire("A+", 0.78, NOW - 45_000))), "path_fire_stale");
  check("fire side ≠ ticket side refuses", m(args(fire("A+", 0.78, NOW - 2_000, { side: "long" }))), "path_fire_ticket");
  check("Floor WATCH refuses", m(args(fire("A+", 0.78), { floor: { verdict: "WATCH", deskContracts: 2, band: "A+", confluence: 0.7 } })), "floor");
  check("Stand not agreeing refuses", m(args(fire("A+", 0.78), { agentAgree: false })), "agent");
  check("Manager disagree refuses", m(args(fire("A+", 0.78), { manager: { call: { agentAgree: false } } })), "agent");
  check("BP $120 refuses bp_floor", m(args(fire("A+", 0.78), { account: { ...FUNDED, buyingPower: 120 } })), "bp_floor");
  check("BP unknown refuses", m(args(fire("A+", 0.78), { account: null })), "bp_unknown");
  check("Individual 7477 refuses", m(args(fire("A+", 0.78), { account: { ...FUNDED, accountNumber: "415577477" } })), "bp_wrong_account");
  check("env defaults (empty) refuse autofire_off", m(args(fire("A+", 0.78), { flags: undefined, env: {} })), "autofire_off");
  const r = rh.proposeRhFromPathFire(args(fire("B+", 0.61), bplus));
  check("B+ fire shape uses live quote, 1 contract", [r.placeShape?.priceSource, r.placeShape?.priceHint, r.placeShape?.quantity, r.placeShape?.refIdHint], ["live_quote", 1.62, 1, "rh-d:B+"]);
}

console.log("\nB+ explicit live gate (Accuracy + Keaton 2026-10-06)");
{
  const { bPlusLive } = APLUS_RULES.profitPath;
  check("config bPlusLive", bPlusLive, { fitFloor: 0.6, requireSeqTake: true, requireNoVeto: true, maxContracts: 1 });
  check("B+ fit floor == RH_PATH_FLOOR_BPLUS", bPlusLive.fitFloor, gates.RH_PATH_FLOOR_BPLUS);
  check("RH_PATH_FLOOR still 0.65 (not lowered globally)", gates.RH_PATH_FLOOR, 0.65);
  check("A- @0.62 still refuses path_floor (B+ band does not lower A grades)", g({ ...BASE, ...BPLUS_OK, pathBand: "A-", confluence: 0.62 }), "path_floor");
  const B = { ...BASE, ...BPLUS_OK, pathBand: "B+", confluence: 0.61 };
  check("B+ pass (fit 0.61, SEQ TAKE, no veto, CE/tape/DTE/BP ok, 09:35 ET)", g(B), "ok");
  check("B- fail", g({ ...B, pathBand: "B-" }), "path_band");
  check("B fail", g({ ...B, pathBand: "B" }), "path_band");
  check("vetoed B+ refuse", g({ ...B, vetoed: true }), "bplus_veto");
  check("B+ veto unknown refuse (fail closed)", g({ ...B, vetoed: null }), "bplus_veto");
  check("B+ without SEQ TAKE refuse", g({ ...B, seqTake: false }), "bplus_seq");
  check("B+ SEQ unknown refuse (fail closed)", g({ ...B, seqTake: undefined }), "bplus_seq");
  check("B+ fit 0.59 refuse", g({ ...B, confluence: 0.59 }), "path_floor");
  check("B+ no CE touch refuse", g({ ...B, ceTouch: false }), "ce_touch");
  check("B+ tape 31s refuse", g({ ...B, tapeAgeSec: 31 }), "tape_stale");
  check("B+ DTE 2 refuse", g({ ...B, dte: 2 }), "dte");
  check("B+ BP $120 refuse", g({ ...B, account: { ...FUNDED, buyingPower: 120 } }), "bp_floor");
  check("B+ at 11:05 ET refuse", g(B, { ...FLAGS, nowMs: Date.UTC(2026, 9, 6, 15, 5, 0) }), "bp_stale");
  check("B+ at 11:05 ET (fresh BP) refuse after_11",
    g({ ...B, account: { ...FUNDED, asOfMs: Date.UTC(2026, 9, 6, 15, 4, 50) } }, { ...FLAGS, nowMs: Date.UTC(2026, 9, 6, 15, 5, 0) }), "after_11");
  check("A+ ignores SEQ/veto inputs (unchanged gate)", g({ ...BASE, seqTake: null, vetoed: null }), "ok");
  check("B+ size: 1 contract ok", gates.evaluateRhBandSize("B+", 1).ok, true);
  check("B+ size: 2 contracts refuse", gates.evaluateRhBandSize("B+", 2).gate, "bplus_size");
  check("A size: 4 contracts per envelope", gates.evaluateRhBandSize("A", 4).ok, true);
  const t = (contracts, total) => rh.ticketFromRhCard({ underlier: "QQQ", side: "put", dteTarget: 0, strikeNote: "ATM", strikeOffset: "ATM", contracts, estDebitEach: total / contracts / 100, estDebitTotal: total, decisionKey: "kb", reason: "b+" });
  const p1 = rh.proposeRhLiveOption({ candidate: B, ticket: t(1, 160), flags: FLAGS });
  check("B+ propose 1ct $160 → live_when_armed", [p1.mode, p1.placeShape?.quantity], ["live_when_armed", 1]);
  const p2 = rh.proposeRhLiveOption({ candidate: B, ticket: t(2, 320), flags: FLAGS });
  check("B+ propose 2ct refuses bplus_size", [p2.mode, p2.gated.gate], ["refused", "bplus_size"]);
  const p0 = rh.proposeRhLiveOption({ candidate: B, ticket: t(1, 120), flags: FLAGS });
  check("B+ 1ct under $150 envelope refuses debit_floor", [p0.mode, p0.gated.gate], ["refused", "debit_floor"]);
  const rev = {
    gatesStillOk: true, liveArmedNow: true, confirmedInWriting: true, reviewHadBlockingAlert: false,
    agenticAllowed: true, optionsLevelOk: true, accountAtReview: FUNDED,
    account: rh.toManagerRhAccount({ cashUsd: 1000, optionsBuyingPowerUsd: 1000, asOf: new Date(NOW - 20_000).toISOString(), accountNumber: "995386158", agenticAllowed: true, optionLevel: "option_level_2", label: "Agentic" }),
    debitTotal: 162, nowMs: NOW,
  };
  check("B+ review 1ct may place (when armed)", rh.mayPlaceAfterReview({ ...rev, pathBand: "B+", quantity: 1 }).ok, true);
  check("B+ review 2ct refuses", rh.mayPlaceAfterReview({ ...rev, pathBand: "B+", quantity: 2 }).ok, false);
  check("B+ review quantity unknown refuses", rh.mayPlaceAfterReview({ ...rev, pathBand: "B+" }).ok, false);
}

console.log("\nposture");
{
  const src = read("src/lib/execution/rh-autofire.ts") + read("src/lib/execution/rh-floor-signals.ts");
  check("no place call in RH modules", /place_option_order\(|CallDynamicTool/.test(src), false);
  const env = read(".env.example");
  check(".env.example RH_OPTIONS_AUTOFIRE_ENABLED=false", /^RH_OPTIONS_AUTOFIRE_ENABLED=false$/m.test(env), true);
  check(".env.example RH_LIVE_ARMED=false", /^RH_LIVE_ARMED=false$/m.test(env), true);
  check("env helpers default off", [rh.rhAutofireEnabled({}), rh.rhLiveArmed({})], [false, false]);
  check("preferred account Agentic 995386158", gates.RH_PREFERRED_ACCOUNT_NUMBER, "995386158");
}

console.log(`\nrh-path-fire: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
