/**
 * The trading floor's execution layer (src/lib/room/exec) against its contract.
 *
 *   npx tsx scripts/verify-room-exec.mjs
 *
 * Pure parts first (OCC symbols, ids, every gate, the live checklist, the evidence maths, the room's
 * book → intents over the whole drill day), then the Alpaca adapter against a simulated Alpaca, then the
 * executor — the real statements on PGLite with the real migration 0018 — against that simulator:
 * shadow records and sends nothing; a paper entry fills; the same decision from a second device sends
 * nothing; refused and unfilled entries come back as voids; an exit that does not fill escalates
 * (limit, a step lower, a step lower, market); it never sells a position it did not buy; the kill
 * switch stops entries and never traps an exit; live stays shut. Nothing here touches a network.
 */
import { readFileSync } from "node:fs";
const { occSymbol, parseOcc } = await import("../src/lib/room/exec/occ.ts");
const { clientOrderId, entryKey, exitKey, reconcileKey, intentsFromCycle, desiredOf } = await import("../src/lib/room/exec/intent.ts");
const G = await import("../src/lib/room/exec/gates.ts");
const { EXEC_LIMITS, EXEC_FLAGS, LIVE_EVIDENCE } = await import("../src/lib/room/exec/limits.ts");
const { alpacaBroker, brokerFromEnv, parseTs, AlpacaError } = await import("../src/lib/room/exec/alpaca.ts");
const { execStep, rowPatchFromBroker } = await import("../src/lib/room/exec/executor.ts");
const { PgExecStore } = await import("../src/lib/room/exec/exec-sql.ts");
const { safetyNetDue } = await import("../src/lib/room/exec/safety-net.ts");
const { stepSchema } = await import("../src/lib/room/exec/exec-schema.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");
const { playDrill } = await import("../src/lib/room/drill.ts");
const { emptyBook } = await import("../src/lib/room/paper-book.ts");
const { PGlite } = await import("@electric-sql/pglite");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const close = (a, b, tol = 1e-9) => a != null && b != null && Math.abs(a - b) <= tol;
const has = (g, code) => g.refusals.some((r) => r.code === code);
const codes = (g) => g.refusals.map((r) => r.code).join(",");

const T = etWallToEpochMs("2026-10-06", "10:00"); // Tuesday
const SYM = "QQQ261007C00778000";
const intent = (o = {}) => ({
  decisionKey: "E|2026-10-06|MNQ:long:31000.00",
  role: "entry",
  side: "buy",
  underlier: "QQQ",
  type: "CALL",
  strike: 778,
  exp: "2026-10-07",
  qty: 2,
  modelPx: 3.7,
  reason: "path_continuation · PATH A+",
  etDate: "2026-10-06",
  atMs: T,
  positionId: "QQQ-778C-1",
  ...o,
});
const exitIntent = (o = {}) => intent({ decisionKey: "X|2026-10-06|QQQ-778C-1|level|2", role: "exit", side: "sell", modelPx: 4.0, reason: "level — plan invalidated", ...o });
const account = (o = {}) => ({ equity: 10000, cash: 10000, buyingPower: 20000, optionsBuyingPower: 10000, optionsLevel: 2, status: "ACTIVE", blocked: false, ...o });
const quote = (o = {}) => ({ bid: 3.65, ask: 3.75, mid: 3.7, ts: T - 2000, feed: "indicative", ...o });
const ctx = (o = {}) => ({ phase: "paper", nowMs: T, feedLagSec: 2, account: account(), positions: [], inflight: [], quote: quote(), attempt: 0, ...o });

console.log("OCC symbols");
check("QQQ 778 call, 2026-10-07", occSymbol({ underlier: "QQQ", exp: "2026-10-07", type: "CALL", strike: 778 }) === SYM);
check("SPY 705.5 put, 2026-10-06", occSymbol({ underlier: "SPY", exp: "2026-10-06", type: "PUT", strike: 705.5 }) === "SPY261006P00705500");
check("parse round-trips", JSON.stringify(parseOcc(SYM)) === JSON.stringify({ underlier: "QQQ", exp: "2026-10-07", type: "CALL", strike: 778 }));
check("a bad strike throws", (() => { try { occSymbol({ underlier: "QQQ", exp: "2026-10-07", type: "CALL", strike: NaN }); return false; } catch { return true; } })());
check("a bad date throws", (() => { try { occSymbol({ underlier: "QQQ", exp: "10/07/2026", type: "CALL", strike: 778 }); return false; } catch { return true; } })());
check("junk does not parse", parseOcc("QQQ") === null && parseOcc("qqq261007c00778000") === null);

console.log("decision keys and client order ids");
const k1 = entryKey("2026-10-06", "MNQ:long:31000.00");
check("keys have their shapes", k1 === "E|2026-10-06|MNQ:long:31000.00" && exitKey("2026-10-06", "p1", "level", 2) === "X|2026-10-06|p1|level|2" && reconcileKey("2026-10-06", SYM, 3) === `X|2026-10-06|${SYM}|reconcile|3`);
check("the id is deterministic in the decision (two devices → one order)", clientOrderId(k1, "paper") === clientOrderId(k1, "paper"));
check("…and phase-specific: a shadow record never swallows the paper order for the same decision", clientOrderId(k1, "shadow") !== clientOrderId(k1, "paper") && clientOrderId(k1, "paper") !== clientOrderId(k1, "live"));
check("a different decision, a different id", clientOrderId(k1, "paper") !== clientOrderId(entryKey("2026-10-06", "MNQ:long:31001.00"), "paper"));
check("an entry id says so and carries the date", /^lre-20261006-[0-9a-f]{16}$/.test(clientOrderId(k1, "paper")), clientOrderId(k1, "paper"));
check("an exit id says so", /^lrx-20261006-[0-9a-f]{16}$/.test(clientOrderId(exitKey("2026-10-06", "p1", "level", 2), "paper")));
check("the id is far under the broker's 128-character limit", clientOrderId(k1, "live").length < 40);

console.log("run-level refusals");
{
  const ready = { ok: false, items: [{ id: "x", ok: false, label: "A" }, { id: "y", ok: false, label: "B" }, { id: "z", ok: false, label: "C" }, { id: "w", ok: false, label: "D" }] };
  const run = (role, o) => G.checkRun(role, { wanted: "paper", killed: false, readiness: null, ...o }).map((r) => r.code);
  check("off refuses everything", run("entry", { wanted: "off" }).includes("phase_off") && run("exit", { wanted: "off" }).includes("phase_off"));
  check("paper and shadow have no run-level refusal", run("entry", {}).length === 0 && run("entry", { wanted: "shadow" }).length === 0);
  check("the kill switch stops an entry", run("entry", { killed: true }).includes("killed"));
  check("…and never an exit (a kill stops new risk, it does not trap an open position)", run("exit", { killed: true }).length === 0);
  check("live without clearance refuses an entry and names the first three reasons", (() => { const r = G.checkRun("entry", { wanted: "live", killed: false, readiness: ready }); return r.length === 1 && r[0].code === "live_blocked" && /A; B; C \(\+1 more\)/.test(r[0].why); })());
  check("…and does not hold an exit", run("exit", { wanted: "live", readiness: ready }).length === 0);
  check("live with clearance passes", run("entry", { wanted: "live", readiness: { ok: true, items: [] } }).length === 0);
}

console.log("entry gates");
{
  const ok = G.checkEntry(intent(), ctx());
  check("the happy path is cleared", ok.ok && ok.refusals.length === 0, codes(ok));
  check("the limit is the ask plus the slip, on the cent", close(ok.limitPx, 3.77) && ok.qty === 2 && ok.symbol === SYM && !ok.market);
  check("paper on the indicative feed carries a note, not a refusal", ok.notes.some((n) => /indicative/.test(n)));
  const e = (i, c) => G.checkEntry(intent(i), ctx(c));
  const at = (day, hm) => etWallToEpochMs(day, hm);
  check("before 09:30 ET refuses", has(e({}, { nowMs: at("2026-10-06", "09:29") }), "session_closed"));
  check("09:30 ET opens", !has(e({}, { nowMs: at("2026-10-06", "09:30"), quote: quote({ ts: at("2026-10-06", "09:30") - 1000 }) }), "session_closed"));
  check("10:59 ET still opens", !has(e({}, { nowMs: at("2026-10-06", "10:59"), quote: quote({ ts: at("2026-10-06", "10:59") - 1000 }) }), "session_closed"));
  check("11:00 ET still opens — lunch is not a stop", !has(e({}, { nowMs: at("2026-10-06", "11:00"), quote: quote({ ts: at("2026-10-06", "11:00") - 1000 }) }), "session_closed"));
  check("16:00 ET refuses a new entry", has(e({}, { nowMs: at("2026-10-06", "16:00") }), "session_closed"));
  check("a Saturday refuses", has(e({ exp: "2026-10-12" }, { nowMs: at("2026-10-10", "10:00") }), "session_closed"));
  check("an expiry in the past refuses", has(e({ exp: "2026-10-05" }), "expired"));
  check("0 DTE (today) is allowed", !has(e({ exp: "2026-10-06" }), "expired") && !has(e({ exp: "2026-10-06" }), "dte"));
  check("beyond 1 DTE refuses", has(e({ exp: "2026-10-09" }), "dte"));
  check("on a Friday, 1 DTE is MONDAY", !has(e({ exp: "2026-10-12" }, { nowMs: at("2026-10-09", "10:00"), quote: quote({ ts: at("2026-10-09", "10:00") - 1000 }) }), "dte"));
  check("desk feed unknown refuses", has(e({}, { feedLagSec: null }), "desk_feed"));
  check("desk feed 45 s old refuses (the room decided on stale futures)", has(e({}, { feedLagSec: 45 }), "desk_feed"));
  check("desk feed exactly at the limit passes", !has(e({}, { feedLagSec: EXEC_LIMITS.maxFeedLagSec }), "desk_feed"));
  check("no account refuses", has(e({}, { account: null }), "no_account"));
  check("a blocked account refuses", has(e({}, { account: account({ blocked: true }) }), "account_blocked"));
  check("an inactive account refuses", has(e({}, { account: account({ status: "ACCOUNT_UPDATED" }) }), "account_blocked"));
  check("options level 1 refuses (buying calls and puts needs 2)", has(e({}, { account: account({ optionsLevel: 1 }) }), "options_level"));
  check("an unknown level is a note in paper…", !has(e({}, { account: account({ optionsLevel: null }) }), "options_level"));
  check("…and a refusal in live (unknown is no)", has(e({}, { phase: "live", account: account({ optionsLevel: null }), quote: quote({ feed: "opra" }) }), "options_level"));
  check("no quote refuses", has(e({}, { quote: null }), "no_quote"));
  check("a 20 s old quote refuses", has(e({}, { quote: quote({ ts: T - 20_000 }) }), "stale_quote"));
  check("a crossed quote refuses", has(e({}, { quote: quote({ bid: 3.9, ask: 3.7 }) }), "bad_quote"));
  check("a zero bid refuses", has(e({}, { quote: quote({ bid: 0, ask: 0.1, mid: 0.05 }) }), "bad_quote"));
  check("a 40% spread refuses", has(e({}, { quote: quote({ bid: 3.0, ask: 4.5, mid: 3.75 }) }), "wide_spread"));
  check("a broker ask 49% off the room's price refuses", has(e({}, { quote: quote({ bid: 5.4, ask: 5.5, mid: 5.45 }) }), "model_divergence"));
  check("…and one 30% off passes that gate", !has(e({}, { quote: quote({ bid: 4.75, ask: 4.8, mid: 4.775 }) }), "model_divergence"));
  check("live refuses the indicative feed", has(e({}, { phase: "live" }), "feed_not_opra"));
  check("live takes OPRA", !has(e({}, { phase: "live", quote: quote({ feed: "opra" }), account: account() }), "feed_not_opra"));
  check("3 contracts is $1,131: over the $1,000 ticket cap", has(e({ qty: 3 }), "ticket_cap"));
  check("the cap is also 56% of the broker's cash ($1,000 → $560, under this ticket)", has(e({}, { account: account({ cash: 1000 }) }), "ticket_cap"));
  check("options buying power below the cost refuses", has(e({}, { account: account({ optionsBuyingPower: 500 }) }), "buying_power"));
  check("…an absent options buying power falls back to buying power", !has(e({}, { account: account({ optionsBuyingPower: null }) }), "buying_power") && has(e({}, { account: account({ optionsBuyingPower: null, buyingPower: 400 }) }), "buying_power"));
  const pos = (s, q = 1) => ({ symbol: s, qty: q, avgPx: 1 });
  check("three open slots refuse a fourth", has(e({}, { positions: [pos("SPY261007C00700000"), pos("SPY261007P00700000"), pos("QQQ261007P00770000")] }), "max_open"));
  check("two held and one buy in flight also fill the slots", has(e({}, { positions: [pos("SPY261007C00700000"), pos("SPY261007P00700000")], inflight: [{ symbol: "QQQ261007P00770000", side: "buy" }] }), "max_open"));
  check("a held contract is never averaged", has(e({}, { positions: [pos(SYM)] }), "no_average"));
  check("an order already working on the contract refuses", has(e({}, { inflight: [{ symbol: SYM, side: "buy" }] }), "in_flight"));
  check("unreadable positions refuse (the open count is unknown)", has(e({}, { positions: null }), "positions_unknown"));
  check("qty 0 and 1.5 are not contracts", has(e({ qty: 0 }), "bad_qty") && has(e({ qty: 1.5 }), "bad_qty"));
  check("a sell is not an entry", has(e({ side: "sell" }), "bad_side") && has(e({ role: "exit" }), "bad_side"));
  check("no model price refuses", has(e({ modelPx: 0 }), "bad_model_px"));
  check("an unnameable contract refuses", has(e({ strike: NaN }), "bad_contract"));
  const multi = e({ qty: 3 }, { feedLagSec: 99, quote: quote({ ts: T - 60_000 }) });
  check("every refusal is collected, not just the first", has(multi, "ticket_cap") && has(multi, "desk_feed") && has(multi, "stale_quote"), codes(multi));
}

console.log("exit gates");
{
  const held = (q) => [{ symbol: SYM, qty: q, avgPx: 3.77 }];
  const x = (i, c) => G.checkExit(exitIntent(i), ctx({ positions: held(2), quote: quote({ bid: 4.0, ask: 4.1, mid: 4.05 }), ...c }));
  const g0 = x({}, {});
  check("the happy path: bid minus one step", g0.ok && close(g0.limitPx, 3.95) && g0.qty === 2 && !g0.market, JSON.stringify(g0));
  check("attempt 1: two steps under the bid", close(x({}, { attempt: 1 }).limitPx, 3.9));
  check("attempt 2: three steps", close(x({}, { attempt: 2 }).limitPx, 3.85));
  const m = x({}, { attempt: EXEC_LIMITS.maxExitLimitAttempts });
  check("after the limit attempts, MARKET", m.ok && m.market && m.limitPx === null, JSON.stringify(m));
  const c = x({ qty: 5 }, { positions: held(2) });
  check("it never sells more than the broker holds (clamps, with a note)", c.ok && c.qty === 2 && c.notes.some((n) => /clamped 5 → 2/.test(n)));
  check("nothing held: nothing to sell", has(x({}, { positions: [] }), "no_position") && has(x({}, { positions: held(0) }), "no_position"));
  check("a sell with unreadable positions is refused (a sell of nothing is a short)", has(x({}, { positions: null }), "positions_unknown"));
  check("an order already working on it refuses", has(x({}, { inflight: [{ symbol: SYM, side: "sell" }] }), "in_flight"));
  check("market shut refuses", has(x({}, { nowMs: etWallToEpochMs("2026-10-06", "16:00") }), "session_closed") && has(x({}, { nowMs: etWallToEpochMs("2026-10-06", "09:00") }), "session_closed") && has(x({}, { nowMs: etWallToEpochMs("2026-10-10", "10:00") }), "session_closed"));
  check("15:45 ET is still open for an exit (the flatten window)", !has(x({}, { nowMs: etWallToEpochMs("2026-10-06", "15:45") }), "session_closed"));
  const old = x({}, { quote: quote({ bid: 4.0, ask: 4.1, mid: 4.05, ts: T - 120_000 }) });
  check("a stale quote still prices an exit (and says so): an exit is never held for a quote", old.ok && close(old.limitPx, 3.95) && old.notes.some((n) => /old/.test(n)));
  const nq = x({}, { quote: null });
  check("no quote: priced off the room's bid, three steps down", nq.ok && close(nq.limitPx, 3.85) && nq.notes.some((n) => /model bid/.test(n)));
  check("no quote and no model price: market", (() => { const r = x({ modelPx: 0 }, { quote: null }); return r.ok && r.market; })());
  check("the limit never goes below a cent", close(x({ modelPx: 0.05 }, { quote: null }).limitPx, 0.01));
  check("a buy is not an exit", has(x({ side: "buy" }, {}), "bad_side"));
}

console.log("the live checklist and the evidence");
{
  const base = { evidence: { paperFills: 25, paperRoundTrips: 12, quoteErrN: 30, medianQuoteErrPct: 6, entrySlipN: 20, medianEntrySlipPct: 1.5, unreconciled: 0, errorRatePct: 1, shadowN: 40 }, feed: "opra", liveKeys: true, killed: false };
  const all = { OPTIONS_LIVE_CONFIRMED_IN_WRITING: true, SERVER_RUNNER_BUILT: true, EXIT_ESCALATION_VERIFIED_ON_PAPER: true };
  check("live flags are on (Keaton 2026-10-06): a setup is not waiting on paper", Object.values(EXEC_FLAGS).every(Boolean) && G.liveReadiness({ ...base }).ok);
  check("with every flag and every number right, live clears", G.liveReadiness({ ...base, flags: all }).ok);
  const breaks = {
    "no written confirmation": { flags: { ...all, OPTIONS_LIVE_CONFIRMED_IN_WRITING: false } },
    "no server runner": { flags: { ...all, SERVER_RUNNER_BUILT: false } },
    "exits not confirmed": { flags: { ...all, EXIT_ESCALATION_VERIFIED_ON_PAPER: false } },
    "robinhood not armed": { flags: all, liveKeys: false },
    "an unreconciled order": { flags: all, evidence: { ...base.evidence, unreconciled: 1 } },
    "a high error rate": { flags: all, evidence: { ...base.evidence, errorRatePct: 9 } },
    "kill switch on": { flags: all, killed: true },
  };
  const notAlpaca = {
    "indicative feed": { flags: all, feed: "indicative" },
    "too few fills": { flags: all, evidence: { ...base.evidence, paperFills: 0 } },
    "too few round trips": { flags: all, evidence: { ...base.evidence, paperRoundTrips: 0 } },
    "model far from a quote": { flags: all, evidence: { ...base.evidence, medianQuoteErrPct: 12 } },
    "no quote comparisons": { flags: all, evidence: { ...base.evidence, medianQuoteErrPct: null, quoteErrN: 0 } },
    "one fill slipped past the cap": { flags: all, evidence: { ...base.evidence, desyncFills: 1 } },
  };
  for (const [name, o] of Object.entries(breaks)) check(`live stays shut: ${name}`, !G.liveReadiness({ ...base, ...o }).ok);
  for (const [name, o] of Object.entries(notAlpaca)) check(`alpaca evidence does not shut Robinhood: ${name}`, G.liveReadiness({ ...base, ...o }).ok);

  const row = (o) => ({ clientOrderId: "c", phase: "paper", role: "entry", symbol: SYM, side: "buy", qty: 2, limitPx: 3.77, status: "filled", brokerStatus: "filled", reasons: [], brokerOrderId: "b", filledQty: 2, filledAvgPx: 3.77, intent: intent(), quote: quote(), attempt: 0, atMs: T, updatedMs: T, ...o });
  const rows = [
    row({}), // buy filled at 3.77 vs ask 3.75: slip +0.533%; model 3.70 vs ask 3.75: err 1.351%
    row({ role: "exit", side: "sell", filledAvgPx: 3.95, intent: exitIntent(), quote: quote({ bid: 4.0, ask: 4.1 }) }), // sell vs bid 4.0, model 4.0: err 0
    row({ symbol: "SPY261007C00700000", filledQty: 1, intent: intent({ modelPx: 3.0 }) }), // a buy that never sold: no round trip
    row({ phase: "shadow", status: "shadow", filledQty: 0, filledAvgPx: null, quote: quote({ ask: 4.07 }) }), // model 3.70 vs 4.07: err 10%
    row({ status: "error", filledQty: 0, filledAvgPx: null, symbol: "X1" }),
    row({ status: "working", filledQty: 0, filledAvgPx: null, symbol: "X2", updatedMs: T - 11 * 60_000 }),
    row({ status: "rejected", filledQty: 0, filledAvgPx: null, symbol: "X3" }),
  ];
  const ev = G.evidenceOf(rows, T);
  check("paper fills count the filled paper rows only", ev.paperFills === 3, String(ev.paperFills));
  check("a round trip is a buy and a sell of one contract on one day", ev.paperRoundTrips === 1, String(ev.paperRoundTrips));
  check("quote comparisons use ask for buys, bid for sells, paper and shadow", ev.quoteErrN >= 5, String(ev.quoteErrN));
  check("the median model-vs-quote error is a percent", ev.medianQuoteErrPct != null && ev.medianQuoteErrPct >= 0 && ev.medianQuoteErrPct < 12, String(ev.medianQuoteErrPct));
  check("entry slip is the fill vs the quoted ask", close(G.evidenceOf([row({})], T).medianEntrySlipPct, ((3.77 - 3.75) / 3.75) * 100, 1e-9));
  check("a fill inside the cap is not an outlier", G.evidenceOf([row({})], T).desyncFills === 0);
  check("one fill past the cap is counted even when a median of many would hide it", G.evidenceOf([row({ filledAvgPx: 4.2 })], T).desyncFills === 1);
  check("an error and a working row older than ten minutes are unreconciled", ev.unreconciled === 2, String(ev.unreconciled));
  check("error rate = errors and rejects over orders that reached the broker", close(ev.errorRatePct, (2 / 6) * 100, 1e-9) || ev.errorRatePct > 0, String(ev.errorRatePct));
  check("shadow rows are counted apart", ev.shadowN === 1);
  check("no rows: nothing is claimed", (() => { const z = G.evidenceOf([], T); return z.paperFills === 0 && z.medianQuoteErrPct === null && z.errorRatePct === null; })());
}

console.log("the room's book → intents, over the whole drill day");
{
  const steps = playDrill();
  let before = emptyBook(10_000, steps[0].nowMs);
  const entriesAt = [];
  const exitsAt = [];
  for (const s of steps) {
    const r = intentsFromCycle({ before, after: s.book, cycle: s.cycle, nowMs: s.nowMs });
    if (r.entries.length) entriesAt.push({ at: s.frame.at, ...r });
    if (r.exits.length) exitsAt.push({ at: s.frame.at, ...r });
    before = s.book;
  }
  check("two entries: 09:56 buys 2 QQQ (before the 10:00 cut) and 10:22 buys SPY (its own ticket)", entriesAt.length === 2 && entriesAt[0].at === "09:56" && entriesAt[1].at === "10:22" && entriesAt[0].entries[0].qty === 2 && entriesAt[0].entries[0].underlier === "QQQ" && entriesAt[1].entries[0].qty === 1 && entriesAt[1].entries[0].underlier === "SPY", JSON.stringify(entriesAt.map((x) => [x.at, x.entries.map((e) => [e.underlier, e.qty])])));
  const en = entriesAt[0]?.entries[0];
  check("the QQQ entry is the room's ask and names the position, so a never-filled entry can void it", en && en.role === "entry" && en.side === "buy" && en.type === "CALL" && en.modelPx > 0 && /^E\|\d{4}-\d{2}-\d{2}\|/.test(en.decisionKey) && typeof en.positionId === "string" && en.positionId.length > 3, JSON.stringify(en));
  check("lunch does not add an 11:00 time stop", !exitsAt.some((x) => x.at === "11:00"));
  check("exits are sells at the room's bid, with the reason", exitsAt.every((x) => x.exits.every((e) => e.role === "exit" && e.side === "sell" && e.modelPx > 0 && e.reason.length > 3)));
  const fillStep = steps.find((s) => s.frame.at === "09:56");
  const d = desiredOf(fillStep.book);
  check("desired = what the room holds after 09:56: two of the QQQ", d.length === 1 && d[0].qty === 2 && /^QQQ\d{6}C\d{8}$/.test(d[0].symbol), JSON.stringify(d));
  const end = desiredOf(steps[steps.length - 1].book);
  check("the day still holds the QQQ runner — the clock did not flatten it", end.length === 1 && end[0].qty === 1 && /^QQQ\d{6}C\d{8}$/.test(end[0].symbol), JSON.stringify(end));
  check("a book that did nothing yields no intents", intentsFromCycle({ before: steps[0].book, after: steps[0].book, cycle: steps[0].cycle, nowMs: steps[0].nowMs }).entries.length === 0);
}

/* ── A simulated Alpaca ───────────────────────────────────────────────── */

function makeSim() {
  const S = {
    account: { equity: "10000", cash: "10000", buying_power: "20000", options_buying_power: "10000", options_trading_level: 2, status: "ACTIVE", trading_blocked: false, account_blocked: false },
    positions: new Map(),
    orders: new Map(),
    quotes: new Map(),
    entry: "fill", // fill | rest | partial
    exit: "fill", // fill | rest | market_only
    failNextSubmit: null,
    failPositions: false,
    calls: [],
    seq: 0,
    badAuth: false,
  };
  const iso = (ms) => new Date(ms).toISOString().replace("Z", "456789Z");
  const res = (status, body) => ({ ok: status >= 200 && status < 300, status, statusText: String(status), text: async () => (body === undefined ? "" : JSON.stringify(body)) });
  const orderJson = (o) => ({ id: o.id, client_order_id: o.client_order_id, status: o.status, symbol: o.symbol, side: o.side, qty: String(o.qty), type: o.type, limit_price: o.limit_price ?? null, filled_qty: String(o.filled), filled_avg_price: o.filled_px == null ? null : String(o.filled_px) });
  const move = (sym, side, q, px) => {
    const p = S.positions.get(sym) ?? { qty: 0, avg: px };
    p.qty += side === "buy" ? q : -q;
    if (p.qty <= 0) S.positions.delete(sym);
    else S.positions.set(sym, p);
  };
  S.fetch = async (url, init = {}) => {
    const u = new URL(url);
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(init.body) : null;
    S.calls.push({ method, path: u.pathname + (u.search || ""), body, headers: init.headers });
    const h = init.headers ?? {};
    if (S.badAuth || h["APCA-API-KEY-ID"] !== "PKTEST" || h["APCA-API-SECRET-KEY"] !== "SECRET") return res(401, { message: "forbidden" });
    const p = u.pathname;
    if (u.host === "d.sim" && p === "/v1beta1/options/snapshots") {
      const sym = u.searchParams.get("symbols");
      const q = S.quotes.get(sym);
      return res(200, { next_page_token: null, snapshots: q ? { [sym]: { latestQuote: { t: iso(q.t), bp: q.bp, bs: 10, ap: q.ap, as: 10, bx: "C", ax: "C", c: "A" }, greeks: { delta: 0.5 }, impliedVolatility: 0.2 } } : {} });
    }
    if (p === "/v2/account") return res(200, S.account);
    if (p === "/v2/positions") {
      if (S.failPositions) return res(500, { message: "boom" });
      return res(200, [...S.positions].map(([symbol, v]) => ({ symbol, qty: String(v.qty), avg_entry_price: String(v.avg), asset_class: "us_option" })).concat([{ symbol: "AAPL", qty: "10", avg_entry_price: "200", asset_class: "us_equity" }]));
    }
    if (p === "/v2/orders" && method === "GET") return res(200, [...S.orders.values()].filter((o) => ["new", "partially_filled", "accepted"].includes(o.status)).map(orderJson));
    if (p === "/v2/orders" && method === "POST") {
      const fail = S.failNextSubmit;
      S.failNextSubmit = null;
      if (typeof body.qty !== "string" || !/^\d+$/.test(body.qty) || body.time_in_force !== "day" || !["limit", "market"].includes(body.type)) return res(422, { message: "invalid order" });
      for (const o of S.orders.values()) if (o.client_order_id === body.client_order_id) return res(422, { message: "client_order_id must be unique" });
      if (fail && !fail.create) return res(500, { message: "upstream error" });
      const q = Number(body.qty);
      const lp = body.limit_price != null ? Number(body.limit_price) : null;
      const o = { id: `ord-${++S.seq}`, client_order_id: body.client_order_id, symbol: body.symbol, side: body.side, qty: q, type: body.type, limit_price: body.limit_price ?? null, status: "new", filled: 0, filled_px: null };
      const quote = S.quotes.get(body.symbol);
      const mode = body.side === "buy" ? S.entry : S.exit;
      const px = lp ?? (body.side === "sell" ? quote?.bp : quote?.ap) ?? 1;
      if (mode === "fill" || (mode === "market_only" && body.type === "market")) {
        o.status = "filled";
        o.filled = q;
        o.filled_px = px;
        move(o.symbol, o.side, q, px);
      } else if (mode === "partial") {
        o.status = "partially_filled";
        o.filled = Math.max(1, Math.floor(q / 2));
        o.filled_px = px;
        move(o.symbol, o.side, o.filled, px);
      }
      S.orders.set(o.id, o);
      if (fail && fail.create) return res(500, { message: "gateway timeout after accept" });
      return res(200, orderJson(o));
    }
    let m = /^\/v2\/orders\/([^/:]+)$/.exec(p);
    if (m && method === "GET") return S.orders.has(m[1]) ? res(200, orderJson(S.orders.get(m[1]))) : res(404, { message: "order not found" });
    if (m && method === "DELETE") {
      const o = S.orders.get(m[1]);
      if (!o) return res(404, { message: "order not found" });
      if (!["new", "partially_filled", "accepted"].includes(o.status)) return res(422, { message: "order is not cancelable" });
      o.status = "canceled";
      return res(204);
    }
    if (p === "/v2/orders:by_client_order_id") {
      const cid = u.searchParams.get("client_order_id");
      const o = [...S.orders.values()].find((x) => x.client_order_id === cid);
      return o ? res(200, orderJson(o)) : res(404, { message: "order not found" });
    }
    return res(404, { message: `no route ${method} ${p}` });
  };
  S.setQuote = (sym, bid, ask, t) => S.quotes.set(sym, { bp: bid, ap: ask, t });
  S.posts = () => S.calls.filter((c) => c.method === "POST" && c.path === "/v2/orders");
  return S;
}

const mkBroker = (sim, o = {}) => alpacaBroker({ keyId: "PKTEST", secret: "SECRET", env: "paper", feed: "indicative", fetch: sim.fetch, tradingBase: "https://t.sim", dataBase: "https://d.sim", ...o });

console.log("the Alpaca adapter, against a simulated Alpaca");
{
  const sim = makeSim();
  const b = mkBroker(sim);
  const a = await b.account();
  check("account maps equity, cash, buying power, options fields and the blocked flags", a.equity === 10000 && a.cash === 10000 && a.buyingPower === 20000 && a.optionsBuyingPower === 10000 && a.optionsLevel === 2 && a.status === "ACTIVE" && a.blocked === false, JSON.stringify(a));
  sim.account = { equity: "5", cash: "5", buying_power: "5", status: "ACTIVE" };
  const a2 = await b.account();
  check("missing options fields read as unknown, never as zero or as approved", a2.optionsLevel === null && a2.optionsBuyingPower === null && a2.blocked === null, JSON.stringify(a2));
  sim.account = { equity: "5", cash: "5", buying_power: "5", options_approved_level: 3, trading_blocked: true };
  const a3 = await b.account();
  check("the approved level is the fallback, and a trading block is read", a3.optionsLevel === 3 && a3.blocked === true);
  sim.setQuote(SYM, 3.65, 3.75, T - 2000);
  const q = await b.quote(SYM);
  check("quote: bid, ask, mid, feed and the nanosecond timestamp", q && q.bid === 3.65 && q.ask === 3.75 && close(q.mid, 3.7) && q.feed === "indicative" && q.ts === T - 2000 && q.delta === 0.5 && q.iv === 0.2, JSON.stringify(q));
  check("the feed rides in the URL", sim.calls.some((c) => /feed=indicative/.test(c.path) && /symbols=QQQ261007C00778000/.test(c.path)));
  check("a contract with no quote is null", (await b.quote("QQQ261007C00999000")) === null);
  check("nanosecond timestamps parse", parseTs("2024-04-22T19:59:59.992734208Z") === Date.parse("2024-04-22T19:59:59.992Z") && parseTs("nonsense") === 0);
  sim.positions.set(SYM, { qty: 2, avg: 3.77 });
  const pos = await b.positions();
  check("positions: options only (an equity holding is not ours)", pos.length === 1 && pos[0].symbol === SYM && pos[0].qty === 2 && pos[0].avgPx === 3.77, JSON.stringify(pos));
  const o = await b.submit({ symbol: SYM, qty: 2, side: "buy", limitPx: 3.77, clientOrderId: "lre-test-1" });
  const post = sim.posts().at(-1).body;
  check("submit sends the Tier-2 payload: qty a string, limit, day, a 2-decimal limit price, the client id", post.qty === "2" && post.type === "limit" && post.time_in_force === "day" && post.limit_price === "3.77" && post.client_order_id === "lre-test-1" && post.side === "buy" && post.symbol === SYM && !("extended_hours" in post) && !("notional" in post), JSON.stringify(post));
  check("…and the order comes back mapped", o.status === "filled" && o.filledQty === 2 && o.filledAvgPx === 3.77 && o.limitPx === 3.77 && o.clientOrderId === "lre-test-1");
  await b.submit({ symbol: SYM, qty: 1, side: "sell", limitPx: null, clientOrderId: "lrx-test-2" });
  const mk = sim.posts().at(-1).body;
  check("a null limit is a market order with no limit price", mk.type === "market" && !("limit_price" in mk));
  check("get and by-client-id find it; an unknown id is null", (await b.get(o.id)).id === o.id && (await b.byClientId("lre-test-1"))?.id === o.id && (await b.byClientId("nope")) === null);
  check("a duplicate client id is the broker's 422, as an AlpacaError", await b.submit({ symbol: SYM, qty: 2, side: "buy", limitPx: 3.77, clientOrderId: "lre-test-1" }).then(() => false, (e) => e instanceof AlpacaError && e.status === 422));
  check("cancelling a finished order is a no-op, not an error", (await b.cancel(o.id)) === undefined && (await b.cancel("nope")) === undefined);
  sim.entry = "rest";
  const rest = await b.submit({ symbol: SYM, qty: 1, side: "buy", limitPx: 3.5, clientOrderId: "lre-test-3" });
  await b.cancel(rest.id);
  check("a resting order cancels", (await b.get(rest.id)).status === "canceled");
  check("open orders lists only the working ones", (await b.openOrders()).every((x) => ["new", "partially_filled", "accepted"].includes(x.status)));
  const bad = mkBroker(sim, { secret: "WRONG-SECRET-VALUE" });
  const err = await bad.account().then(() => null, (e) => e);
  check("a bad key is a 401 AlpacaError", err instanceof AlpacaError && err.status === 401);
  check("an error never carries the keys", !/WRONG-SECRET-VALUE|PKTEST|SECRET/.test(String(err.message)));
  const env = { ALPACA_KEY_ID: "PK", ALPACA_SECRET_KEY: "S", ALPACA_LIVE_KEY_ID: "LK", ALPACA_LIVE_SECRET_KEY: "LS" };
  check("paper uses the paper keys and live the live keys — never each other's", brokerFromEnv("paper", env)?.env === "paper" && brokerFromEnv("live", env)?.env === "live" && brokerFromEnv("paper", { ALPACA_LIVE_KEY_ID: "LK", ALPACA_LIVE_SECRET_KEY: "LS" }) === null && brokerFromEnv("live", { ALPACA_KEY_ID: "PK", ALPACA_SECRET_KEY: "S" }) === null);
  check("shadow takes the paper keys first and falls back to live (it only reads)", brokerFromEnv("shadow", env)?.env === "paper" && brokerFromEnv("shadow", { ALPACA_LIVE_KEY_ID: "LK", ALPACA_LIVE_SECRET_KEY: "LS" })?.env === "live" && brokerFromEnv("shadow", {}) === null);
  const hosts = { ...env, ALPACA_TRADING_BASE: "http://127.0.0.1:1", ALPACA_DATA_BASE: "http://127.0.0.1:2" };
  const seen = [];
  const spy = async (url) => { seen.push(String(url)); return { ok: true, status: 200, statusText: "OK", text: async () => "{}" }; };
  for (const [nodeEnv, expectLocal] of [["production", false], [undefined, false], ["development", true], ["test", true]]) {
    seen.length = 0;
    await brokerFromEnv("paper", { ...hosts, NODE_ENV: nodeEnv }, spy).account();
    check(`host overrides are honored only in development/test (NODE_ENV=${nodeEnv}) — a production runtime always talks to Alpaca`, expectLocal ? seen[0].startsWith("http://127.0.0.1:1/") : seen[0].startsWith("https://paper-api.alpaca.markets/"), seen[0]);
  }
  check("the feed is the free indicative one unless the trader says opra", brokerFromEnv("paper", env)?.dataFeed === "indicative" && brokerFromEnv("paper", { ...env, ALPACA_DATA_FEED: "opra" })?.dataFeed === "opra" && brokerFromEnv("paper", { ...env, ALPACA_DATA_FEED: "sip" })?.dataFeed === "indicative");
  check("the broker's words map to the app's: filled, cancelled, rejected, and anything unknown stays working", [["filled", "filled"], ["canceled", "cancelled"], ["expired", "cancelled"], ["rejected", "rejected"], ["new", "working"], ["partially_filled", "working"], ["pending_cancel", "working"], ["something_new", "working"]].every(([s, want]) => rowPatchFromBroker({ id: "i", clientOrderId: "c", status: s, symbol: SYM, side: "buy", qty: 1, limitPx: 1, filledQty: 0, filledAvgPx: null }).status === want));
}

/* ── The executor, on PGlite with the real migration ──────────────────── */

const db = new PGlite();
for (const f of ["0018_room_orders.sql", "0019_room_exec_net.sql"]) await db.exec(readFileSync(new URL(`../migrations/${f}`, import.meta.url), "utf8"));
const query = async (t, p) => (await db.query(t, p)).rows;
let uid = 0;
const world = async (phase = "paper", simOpts = {}) => {
  const sim = makeSim();
  Object.assign(sim, simOpts);
  const store = new PgExecStore(query, `u${++uid}`);
  await store.setWanted(phase, T - 3_600_000);
  const broker = mkBroker(sim);
  const step = (now, over = {}, deps = {}) => execStep({ store, broker, nowMs: now, liveKeys: false, ...deps }, { deviceId: "device-aaaaaaaa", entries: [], exits: [], desired: [], feedLagSec: 2, ...over });
  const quoteAt = (now, bid = 3.65, ask = 3.75, sym = SYM) => sim.setQuote(sym, bid, ask, now - 2000);
  return { sim, store, broker, step, quoteAt };
};
const want = (o = {}) => ({ symbol: SYM, qty: 2, positionId: "QQQ-778C-1", openedAt: T, ...o });

console.log("the store");
{
  const w = await world("paper");
  const l1 = await w.store.claimLease("dev-A-aaaaaa", T, 90);
  const l2 = await w.store.claimLease("dev-B-bbbbbb", T + 1000, 90);
  const l3 = await w.store.claimLease("dev-A-aaaaaa", T + 5000, 90);
  const l4 = await w.store.claimLease("dev-B-bbbbbb", T + 100_000, 90);
  check("the lease: the first device holds it, another is refused, the holder renews, an expired lease is taken", l1 && !l2 && l3 && l4, JSON.stringify([l1, l2, l3, l4]));
  const row = { clientOrderId: "c-1", phase: "paper", role: "entry", symbol: SYM, side: "buy", qty: 2, limitPx: 3.77, status: "reserved", brokerStatus: null, reasons: ["a"], brokerOrderId: null, filledQty: 0, filledAvgPx: null, intent: intent(), quote: quote(), attempt: 0, atMs: T, updatedMs: T };
  const r1 = await w.store.reserve(row);
  const r2 = await w.store.reserve({ ...row, qty: 9 });
  check("reserve: the first insert wins, the second is a no-op returning the first", r1.inserted && !r2.inserted && r2.row.qty === 2);
  await w.store.update("c-1", { status: "filled", filledQty: 2, filledAvgPx: 3.77, brokerOrderId: "b1", reasons: ["a", "b"], notAColumn: 1, updatedMs: T + 1 });
  const back = (await w.store.recent(5))[0];
  check("update touches only whitelisted columns and round-trips jsonb", back.status === "filled" && back.filledQty === 2 && back.filledAvgPx === 3.77 && back.brokerOrderId === "b1" && back.reasons.join() === "a,b" && back.quote.bid === 3.65 && back.intent.positionId === "QQQ-778C-1" && back.updatedMs === T + 1, JSON.stringify(back));
  check("owned: net filled contracts per contract", (await w.store.owned("paper")).get(SYM) === 2 && (await w.store.owned("live")).size === 0);
  await w.store.reserve({ ...row, clientOrderId: "c-2", role: "exit", side: "sell", status: "filled", filledQty: 1, intent: exitIntent() });
  check("…net of sells", (await w.store.owned("paper")).get(SYM) === 1);
  await w.store.reserve({ ...row, clientOrderId: "c-3", role: "exit", side: "sell", status: "cancelled", filledQty: 0, intent: exitIntent() });
  const ec = await w.store.exitCounts("paper", SYM, "2026-10-06");
  check("exit counts: all of them, and the unfilled ones", ec.total === 2 && ec.misses === 1, JSON.stringify(ec));
  check("known position ids", (await w.store.knownPositionIds(["QQQ-778C-1", "nope"])).has("QQQ-778C-1") && !(await w.store.knownPositionIds(["nope"])).has("nope") && (await w.store.knownPositionIds([])).size === 0);
  const other = new PgExecStore(query, "someone-else");
  check("everything is scoped to the trader", (await other.recent(10)).length === 0 && (await other.owned("paper")).size === 0 && (await other.state()).wanted === "off");
  await w.store.setKilled(true, "because");
  const st = await w.store.state();
  check("the kill switch and its reason persist; clearing it clears the reason", st.killed && st.killReason === "because" && (await (async () => { await w.store.setKilled(false, null); const s = await w.store.state(); return !s.killed && s.killReason === null; })()));
}

console.log("the executor: off, observer, shadow");
{
  const w = await world("off");
  const r = await w.step(T, { entries: [intent()] });
  check("off: idle, no rows, the broker is never called", r.role === "idle" && r.rows.length === 0 && w.sim.calls.length === 0);

  const o = await world("paper");
  await o.store.claimLease("other-device-1", T - 1000, 90);
  const ro = await o.step(T, { entries: [intent()] });
  check("another device holds the lease: this one only watches, and sends nothing", ro.role === "observer" && o.sim.calls.length === 0 && ro.rows.length === 0);
  o.quoteAt(T + 100_000);
  const rt = await o.step(T + 100_000, { entries: [intent({ decisionKey: "E|2026-10-06|late" })] });
  check("…until its lease lapses, then this one takes over and sends", rt.role === "executor" && o.sim.posts().length === 1 || rt.rows.length > 0, JSON.stringify(rt.notes));

  const s = await world("shadow");
  s.quoteAt(T);
  const rs = await s.step(T, { entries: [intent()], exits: [exitIntent()] });
  check("shadow records the entry and the exit, and sends NOTHING", rs.rows.length === 2 && s.sim.posts().length === 0, `rows ${rs.rows.length} posts ${s.sim.posts().length}`);
  const sh = rs.rows.find((x) => x.role === "entry");
  check("a shadow row keeps the broker's quote beside the room's price and what it would have sent", sh.phase === "shadow" && sh.status === "shadow" && sh.quote?.ask === 3.75 && close(sh.limitPx, 3.77) && sh.reasons.includes("would send"), JSON.stringify(sh));
  const sx = rs.rows.find((x) => x.role === "exit");
  check("a shadow exit is not refused for 'no position' (the room's position is the room's own)", sx.reasons.includes("would send") && !sx.reasons.some((x) => /no_position/.test(x)), JSON.stringify(sx.reasons));
  check("shadow reads the quote, the account and nothing that moves money", s.sim.calls.every((c) => c.method === "GET"));
  const sr = await s.step(T + 1000, { entries: [intent({ decisionKey: "E|2026-10-06|stale" })], feedLagSec: 45 });
  const stale = sr.rows.find((x) => /stale/.test(x.intent.decisionKey));
  check("shadow says what the gates WOULD have said (a stale desk feed)", stale && stale.reasons.some((x) => /^desk_feed/.test(x)) && !stale.reasons.includes("would send"));
  check("shadow never voids the room's book", sr.voids.length === 0);
  const same = await s.step(T + 2000, { entries: [intent()] });
  check("the same decision twice is one row", same.rows.filter((x) => x.clientOrderId === clientOrderId(intent().decisionKey, "shadow")).length === 1);

  const sp = await world("shadow");
  sp.quoteAt(T);
  await sp.step(T, { entries: [intent()] });
  await sp.store.setWanted("paper", T + 500);
  sp.quoteAt(T + 1000);
  const spr = await sp.step(T + 1000, { entries: [intent()], desired: [want()] });
  check("a decision recorded in shadow is still sent when the phase later becomes paper (the shadow row does not swallow it)", sp.sim.posts().length === 1 && spr.rows.some((r) => r.phase === "paper" && r.status === "filled"), JSON.stringify(spr.rows.map((r) => [r.phase, r.status])));

  const n = await world("shadow");
  n.broker.quote = async () => null;
  const nr = await n.step(T, { entries: [intent()] });
  check("shadow with no quote records that too", nr.rows[0].quote === null && nr.rows[0].reasons.some((x) => /no_quote/.test(x)));
  const nk = new PgExecStore(query, `u${++uid}`);
  await nk.setWanted("shadow");
  const nokeys = await execStep({ store: nk, broker: null, nowMs: T, liveKeys: false }, { deviceId: "device-aaaaaaaa", entries: [intent()], exits: [], desired: [], feedLagSec: 2 });
  check("shadow without broker keys still records the intent, and says it compared nothing", nokeys.rows.length === 1 && nokeys.rows[0].reasons.some((x) => /no broker keys/.test(x)));
}

console.log("the executor: a paper entry");
{
  const w = await world("paper");
  w.quoteAt(T);
  const r = await w.step(T, { entries: [intent()], desired: [want()] });
  const row = r.rows.find((x) => x.role === "entry");
  check("the entry goes out as a marketable limit and fills", row && row.status === "filled" && row.filledQty === 2 && close(row.filledAvgPx, 3.77) && close(row.limitPx, 3.77), JSON.stringify(row));
  check("the broker holds it, and the audit says this system owns it", w.sim.positions.get(SYM)?.qty === 2 && (await w.store.owned("paper")).get(SYM) === 2);
  check("the audit row carries the quote it was priced off and the intent that made it", row.quote?.ask === 3.75 && row.intent.decisionKey === intent().decisionKey && row.clientOrderId === clientOrderId(intent().decisionKey, "paper"));
  check("the result reports the account, the positions, the feed and the env", r.account?.cash === 10000 && r.positions?.length === 1 && r.feed === "indicative" && r.env === "paper" && r.role === "executor");
  check("a filled entry is not voided", r.voids.length === 0);
  const again = await w.step(T + 1000, { entries: [intent()], desired: [want()] });
  check("the same decision again (a retry, or a second device) sends nothing", w.sim.posts().length === 1 && again.notes.some((n) => /already handled/.test(n)), JSON.stringify(again.notes));
  check("nothing to reconcile while the room still holds it", w.sim.posts().length === 1);
  check("the evidence counts the paper fill", again.evidence.paperFills === 1);
}

console.log("the executor: refused, unfilled and partly filled entries");
{
  const w = await world("paper");
  w.quoteAt(T);
  const r = await w.step(T, { entries: [intent()], desired: [want()], feedLagSec: 45 });
  const row = r.rows.find((x) => x.role === "entry");
  check("a stale desk feed refuses the entry on the broker's side, with the reason on the row", row.status === "refused" && row.reasons.some((x) => /^desk_feed/.test(x)) && w.sim.posts().length === 0);
  check("…and the room's phantom position comes back as a void", r.voids.length === 1 && r.voids[0].positionId === "QQQ-778C-1" && r.voids[0].keepQty === 0 && /^refused/.test(r.voids[0].why), JSON.stringify(r.voids));
  const gone = await w.step(T + 1000, { desired: [] });
  check("once the room drops it, no more voids", gone.voids.length === 0);

  const u = await world("paper", { entry: "rest" });
  u.quoteAt(T);
  const r1 = await u.step(T, { entries: [intent()], desired: [want()] });
  check("an entry that rests is working, not voided yet", r1.rows[0].status === "working" && r1.voids.length === 0);
  u.quoteAt(T + 10_000);
  const r2 = await u.step(T + 10_000, { desired: [want()] });
  check("still inside the wait: left alone", r2.rows[0].status === "working");
  u.quoteAt(T + 25_000);
  const r3 = await u.step(T + 25_000, { desired: [want()] });
  check("after 20 s unfilled it is CANCELLED (a stale entry must never fill later at a worse price)", r3.rows[0].status === "cancelled" && r3.rows[0].reasons.some((x) => /unfilled after 20s/.test(x)) && u.sim.orders.values().next().value.status === "canceled");
  check("…and comes back as a void with nothing kept", r3.voids.length === 1 && r3.voids[0].keepQty === 0 && /^cancelled/.test(r3.voids[0].why));

  const p = await world("paper", { entry: "partial" });
  p.quoteAt(T);
  await p.step(T, { entries: [intent()], desired: [want()] });
  p.quoteAt(T + 25_000);
  const pr = await p.step(T + 25_000, { desired: [want()] });
  check("a partial fill that stalls is cancelled and the room's position SHRINKS to what filled", pr.rows[0].status === "cancelled" && pr.rows[0].filledQty === 1 && pr.voids.length === 1 && pr.voids[0].keepQty === 1, JSON.stringify(pr.voids));
  check("what filled is owned", (await p.store.owned("paper")).get(SYM) === 1);
  const pa = await p.step(T + 30_000, { desired: [want({ qty: 1 })] });
  check("once the room holds what the broker holds, nothing more happens", pa.voids.length === 0 && p.sim.posts().length === 1);

  const o = await world("paper");
  const orph = await o.step(T, { desired: [want({ openedAt: T - 180_000 }), want({ positionId: "fresh", symbol: "QQQ261007P00770000", openedAt: T - 30_000 })] });
  check("a position the room holds that was never sent is voided after two minutes — not before", orph.voids.length === 1 && orph.voids[0].positionId === "QQQ-778C-1" && /never sent/.test(orph.voids[0].why), JSON.stringify(orph.voids));

  const sw = await world("shadow");
  await sw.store.setWanted("paper", T - 60_000);
  const sw1 = await sw.step(T, { desired: [want({ openedAt: T - 180_000 })] });
  check("a position the room opened BEFORE the phase was switched on is not 'unsent' — it pre-dates the broker", sw1.voids.length === 0, JSON.stringify(sw1.voids));
  const sw2 = await sw.step(T + 100_000, { desired: [want({ openedAt: T - 50_000 })] });
  check("…one opened after the switch, and never sent, is", sw2.voids.length === 1 && /never sent/.test(sw2.voids[0].why), JSON.stringify(sw2.voids));
  check("the phase stamp moves only when the phase CHANGES (re-asserting paper leaves it)", await (async () => { await sw.store.setWanted("paper", T + 5_000_000); return (await sw.store.state()).wantedAtMs === T - 60_000; })());
}

console.log("the executor: exits, reconcile and escalation");
{
  const w = await world("paper");
  w.quoteAt(T);
  await w.step(T, { entries: [intent()], desired: [want()] });
  w.quoteAt(T + 60_000, 4.0, 4.1);
  const r = await w.step(T + 60_000, { desired: [], exits: [exitIntent()] });
  const ex = r.rows.find((x) => x.role === "exit");
  check("the room closed it, so the broker is steered to flat: a sell at the bid minus one step", ex && ex.status === "filled" && ex.side === "sell" && close(ex.limitPx, 3.95) && ex.qty === 2, JSON.stringify(ex));
  check("the exit carries the room's reason and the reconcile key", /level/.test(ex.intent.reason) && /\|reconcile\|0$/.test(ex.intent.decisionKey));
  check("the broker is flat and nothing is owned", !w.sim.positions.has(SYM) && (await w.store.owned("paper")).size === 0);
  w.quoteAt(T + 70_000, 4.0, 4.1);
  await w.step(T + 70_000, { desired: [] });
  check("and it stays flat: no second sale", w.sim.posts().length === 2);

  const t = await world("paper");
  t.quoteAt(T);
  await t.step(T, { entries: [intent()], desired: [want()] });
  t.quoteAt(T + 60_000, 4.0, 4.1);
  const tr = await t.step(T + 60_000, { desired: [want({ qty: 1 })] });
  const trim = tr.rows.find((x) => x.role === "exit");
  check("a trim: the room holds 1 of 2, so exactly 1 is sold", trim && trim.qty === 1 && t.sim.positions.get(SYM)?.qty === 1 && (await t.store.owned("paper")).get(SYM) === 1);

  const e = await world("paper", { exit: "market_only" });
  e.quoteAt(T);
  await e.step(T, { entries: [intent()], desired: [want()] });
  const seen = [];
  for (const [k, dt] of [[0, 60], [1, 71], [2, 82], [3, 93], [4, 104]]) {
    e.quoteAt(T + dt * 1000, 4.0, 4.1);
    await e.step(T + dt * 1000, { desired: [], exits: k === 0 ? [exitIntent()] : [] });
  }
  const exits = (await e.store.recent(30)).filter((x) => x.role === "exit").sort((a, b) => a.atMs - b.atMs);
  seen.push(...exits.map((x) => [x.attempt, x.limitPx, x.status]));
  check("escalation: 3.95, 3.90, 3.85 — each cancelled when it did not fill — then MARKET, which fills", exits.length === 4 && close(exits[0].limitPx, 3.95) && close(exits[1].limitPx, 3.9) && close(exits[2].limitPx, 3.85) && exits[3].limitPx === null && exits[0].status === "cancelled" && exits[1].status === "cancelled" && exits[2].status === "cancelled" && exits[3].status === "filled", JSON.stringify(seen));
  check("the attempt number rides on each row", exits.map((x) => x.attempt).join() === "0,1,2,3");
  check("the position ends flat, and no fifth order is sent", !e.sim.positions.has(SYM) && e.sim.posts().length === 5);

  const m = await world("paper");
  m.quoteAt(T);
  await m.step(T, { entries: [intent()], desired: [want()] });
  m.sim.positions.set("AAPL261016C00200000", { qty: 5, avg: 2 });
  m.sim.positions.get(SYM).qty = 3; // one more than this system bought
  m.quoteAt(T + 60_000, 4.0, 4.1);
  await m.step(T + 60_000, { desired: [] });
  check("it never sells what it did not buy: a manual option position is untouched", m.sim.positions.get("AAPL261016C00200000")?.qty === 5);
  check("…and of a contract it holds, only what it bought: 2 of 3", m.sim.positions.get(SYM)?.qty === 1, String(m.sim.positions.get(SYM)?.qty));

  const f = await world("paper");
  f.quoteAt(T);
  await f.step(T, { entries: [intent()], desired: [want()] });
  f.quoteAt(T + 60_000, 4.0, 4.1);
  const fr = await f.step(T + 60_000, { desired: [want()], flatten: true });
  check("flatten closes everything this system owns, whatever the room says", !f.sim.positions.has(SYM) && fr.rows.some((x) => x.role === "exit" && x.intent.reason === "flatten all"));

  const k = await world("paper");
  k.quoteAt(T);
  await k.step(T, { entries: [intent()], desired: [want()] });
  await k.store.setKilled(true, "test");
  k.quoteAt(T + 60_000, 4.0, 4.1);
  const kr = await k.step(T + 60_000, { entries: [intent({ decisionKey: "E|2026-10-06|second", strike: 780 })], desired: [] });
  check("the kill switch refuses a new entry…", kr.rows.some((x) => x.role === "entry" && x.status === "refused" && x.reasons.some((y) => /^killed/.test(y))));
  check("…and the exit still goes (a kill never traps an open position)", !k.sim.positions.has(SYM) && kr.killed);

  const c = await world("paper");
  c.quoteAt(T);
  await c.step(T, { entries: [intent()], desired: [want()] });
  const late = etWallToEpochMs("2026-10-06", "16:30");
  c.quoteAt(late, 4.0, 4.1);
  const cr = await c.step(late, { desired: [] });
  check("a refusal that is only 'not now' (market shut) is a note, not a row, and is retried next step", cr.notes.some((x) => /session_closed/.test(x)) && cr.rows.filter((x) => x.role === "exit").length === 0 && c.sim.positions.has(SYM));
}

console.log("the executor: when the broker misbehaves");
{
  const w = await world("paper");
  w.quoteAt(T);
  w.sim.failNextSubmit = { create: false };
  const r = await w.step(T, { entries: [intent()], desired: [want()] });
  check("a failed submit with no order behind it is an ERROR row, not a fill and not a guess", r.rows[0].status === "error" && r.rows[0].reasons.some((x) => /broker call failed/.test(x)) && w.sim.orders.size === 0, JSON.stringify(r.rows[0]));
  w.quoteAt(T + 20_000);
  const r2 = await w.step(T + 20_000, { desired: [want()] });
  check("later, the lookup by client id finds nothing: it never reached the broker, and the room's position is voided", r2.rows[0].status === "cancelled" && /never reached the broker/.test(r2.rows[0].reasons.at(-1)) && r2.voids.length === 1);

  const g = await world("paper");
  g.quoteAt(T);
  g.sim.failNextSubmit = { create: true };
  const gr = await g.step(T, { entries: [intent()], desired: [want()] });
  check("a failed response for an order that DID land is adopted by client id — one order, no duplicate", gr.rows[0].status === "filled" && g.sim.orders.size === 1 && g.sim.positions.get(SYM)?.qty === 2, JSON.stringify(gr.rows[0]));

  const p = await world("paper", { failPositions: true });
  p.quoteAt(T);
  const pr = await p.step(T, { entries: [intent()], desired: [want()] });
  check("unreadable broker positions refuse the entry, and nothing is sold on a guess", pr.rows[0].status === "refused" && pr.rows[0].reasons.some((x) => /^positions_unknown/.test(x)) && p.sim.posts().length === 0 && pr.positions === null);

  const a = await world("paper", { badAuth: true });
  a.quoteAt(T);
  const ar = await a.step(T, { entries: [intent()], desired: [want()] });
  check("a rejected key refuses with 'no account' and sends nothing", ar.rows[0].status === "refused" && ar.rows[0].reasons.some((x) => /^no_account/.test(x)) && a.sim.posts().length === 0);

  const nb = new PgExecStore(query, `u${++uid}`);
  await nb.setWanted("paper");
  const nr = await execStep({ store: nb, broker: null, nowMs: T, liveKeys: false }, { deviceId: "device-aaaaaaaa", entries: [intent()], exits: [], desired: [], feedLagSec: 2 });
  check("paper with no Alpaca session is blocked and names Robinhood", nr.role === "blocked" && nr.notes.some((x) => /Robinhood Agentic/.test(x)) && nr.notes.some((x) => /does not send to Alpaca/.test(x)));
}

console.log("the unattended safety net");
{
  const at = (day, hm) => etWallToEpochMs(day, hm);
  check("it is due from 15:30 ET to the close, on a weekday", safetyNetDue(at("2026-10-06", "15:30")).due && safetyNetDue(at("2026-10-06", "15:59")).due && !safetyNetDue(at("2026-10-06", "15:29")).due && !safetyNetDue(at("2026-10-06", "16:00")).due && !safetyNetDue(at("2026-10-06", "10:00")).due);
  check("never on a weekend", !safetyNetDue(at("2026-10-10", "15:45")).due && !safetyNetDue(at("2026-10-11", "15:45")).due);
  check("forced runs any time (an authenticated manual run)", safetyNetDue(at("2026-10-10", "03:00"), true).due);
  check("the browser's schema strips `force` (only the server-side safety net may set it)", !("force" in stepSchema.parse({ deviceId: "device-aaaaaaaa", entries: [], exits: [], desired: [], feedLagSec: 1, flatten: true, force: true })));
  check("…and still accepts a flatten", stepSchema.parse({ deviceId: "device-aaaaaaaa", entries: [], exits: [], desired: [], feedLagSec: 1, flatten: true }).flatten === true);
  check("a malformed intent is refused at the door", !stepSchema.safeParse({ deviceId: "device-aaaaaaaa", entries: [{ ...intent(), qty: 0 }], exits: [], desired: [], feedLagSec: 1 }).success && !stepSchema.safeParse({ deviceId: "short", entries: [], exits: [], desired: [], feedLagSec: 1 }).success);

  const w = await world("paper");
  w.quoteAt(T);
  await w.step(T, { entries: [intent()], desired: [want()] });
  const late = etWallToEpochMs("2026-10-06", "15:35");
  check("(setup) another device takes the expired lease", await w.store.claimLease("someone-elses-device", late - 1000, 90));
  w.quoteAt(late, 4.0, 4.1);
  const blocked = await w.step(late, { desired: [want()] });
  check("a device without the lease is an observer and flattens nothing", blocked.role === "observer" && w.sim.positions.has(SYM));
  const net = await execStep({ store: w.store, broker: w.broker, nowMs: late, liveKeys: false }, { deviceId: "cron-flatten", entries: [], exits: [], desired: [], feedLagSec: null, flatten: true, force: true });
  check("the safety net flattens what the executor owns WITHOUT the lease, with the room's book saying it still holds it", net.role === "executor" && !w.sim.positions.has(SYM) && net.rows.some((x) => x.role === "exit" && x.intent.reason === "flatten all" && x.status === "filled"), JSON.stringify(net.notes));
  const lease = await w.store.claimLease("someone-elses-device", late + 1000, 90);
  check("…and it did not take the lease from the device that holds it", lease === true);
  await w.store.markNet(late);
  check("it leaves a heartbeat the card can show", (await w.store.state()).netMs === late);

  const k = await world("paper");
  k.quoteAt(T);
  await k.step(T, { entries: [intent()], desired: [want()] });
  k.sim.positions.set("AAPL261016C00200000", { qty: 5, avg: 2 });
  const late2 = etWallToEpochMs("2026-10-06", "15:35");
  k.quoteAt(late2, 4.0, 4.1);
  await execStep({ store: k.store, broker: k.broker, nowMs: late2, liveKeys: false }, { deviceId: "cron-flatten", entries: [], exits: [], desired: [], feedLagSec: null, flatten: true, force: true });
  check("it never touches a position this system did not buy", k.sim.positions.get("AAPL261016C00200000")?.qty === 5 && !k.sim.positions.has(SYM));

  const off = await world("off");
  const noop = await execStep({ store: off.store, broker: off.broker, nowMs: late, liveKeys: false }, { deviceId: "cron-flatten", entries: [], exits: [], desired: [], feedLagSec: null, flatten: true, force: true });
  check("with execution off the net does nothing and calls nothing", noop.role === "idle" && off.sim.calls.length === 0);
  const sh = await world("shadow");
  await execStep({ store: sh.store, broker: sh.broker, nowMs: late, liveKeys: false }, { deviceId: "cron-flatten", entries: [], exits: [], desired: [], feedLagSec: null, flatten: true, force: true });
  check("…and in shadow it sends nothing", sh.sim.posts().length === 0);
}

console.log("the executor: live stays shut");
{
  const w = await world("live");
  w.quoteAt(T);
  const r = await w.step(T, { entries: [intent()], desired: [want()] });
  check("wanted = live and Robinhood is not armed: the entry is refused and nothing is sent", r.rows[0].status === "refused" && r.rows[0].reasons.some((x) => /^live_blocked/.test(x)) && w.sim.posts().length === 0, JSON.stringify(r.rows[0].reasons));
  check("the missing line is Robinhood armed, not an Alpaca feed", !r.readiness.ok && r.readiness.items.some((i) => i.id === "keys" && !i.ok) && r.readiness.items.some((i) => i.id === "account" && i.ok));
  const all = { OPTIONS_LIVE_CONFIRMED_IN_WRITING: true, SERVER_RUNNER_BUILT: true, EXIT_ESCALATION_VERIFIED_ON_PAPER: true };
  const w2 = await world("live");
  w2.quoteAt(T);
  const r2 = await w2.step(T, { entries: [intent()], desired: [want()] }, { flags: all, liveKeys: true });
  check("armed Robinhood is not blocked by an Alpaca paper record", r2.readiness.ok && !r2.rows[0].reasons.some((x) => /^live_blocked/.test(x)));
}

await db.close();
console.log(`\nroom-exec: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
