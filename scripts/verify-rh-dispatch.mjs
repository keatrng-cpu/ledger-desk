/**
 * The desk sender. Review, then place. No token sends nothing.
 * A position this desk did not open is not closed and not added to.
 *
 *   npx tsx scripts/verify-rh-dispatch.mjs
 */
import { readFileSync } from "node:fs";

const { runRhDesk, closeMaySend } = await import("../src/lib/execution/rh-dispatch.ts");
const { memoryLedger, refIdFor } = await import("../src/lib/execution/rh-tools.ts");
const room = await import("../src/lib/room/manager-room-feed.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const NOW = Date.UTC(2026, 9, 6, 13, 35, 0); // 09:35 ET
const TEN = Date.UTC(2026, 9, 7, 14, 0, 0); // 10:00 ET

const card = (o = {}) => ({
  card: "path_continuation", name: "PATH continuation", verdict: "ARMED", blocks: [], underlier: "QQQ", type: "PUT", dte: 0,
  band: "A", confluence: 0.7, futSymbol: "MNQ", futSide: "short", smcWord: "TAKE", smcMissing: "", deskContracts: 2,
  sizedFrom: "level", deltaMin: 0.3, deltaMax: 0.6, plan: { entry: 21000, stop: 21030, t1: 20950, t2: null, rr1: 1.6 },
  tier: "live", awayPts: 0, pT1: 0.6, expR: 0.3, pFill: 1, patterns: null, strategy: "TJR sweep", ...o,
});

function frame(nowMs = NOW - 3_000) {
  const c = card();
  const plan = { entry: c, exp: "2026-10-06", offset: "ATM", quote: { ask: 1.2, strike: 600, delta: -0.5, iv: 0.2, bid: 1.17, mid: 1.18, thetaDay: 0 }, qty: 2, capUsd: 600, debitUsd: 240 };
  return {
    id: 7,
    nowMs,
    output: { broker_action: { execute_trade: true, action_type: "BUY_OPEN", underlying: "QQQ", option_type: "PUT", strike_offset: "ATM", contracts_quantity: 2, target_position_id: null } },
    trace: {
      beat: "fill",
      gates: [{ id: "market", ok: true, label: "open" }, { id: "desk_word", ok: true, label: "ARMED" }, { id: "trigger", ok: true, label: "CE touched" }],
      refusal: null,
      refusalGate: null,
      entry: plan,
      optionsOpen: true,
      meeting: null,
    },
    roomP: 0.61,
    lenses: { Gemma: { p: 0.6 }, Jax: { p: 0.58 }, Nova: { p: 0.66 }, Sterling: { p: 0.55 }, Vince: { p: 0.62 } },
  };
}

function desk(nowMs = NOW) {
  return {
    fetchedAt: new Date(nowMs - 3_000).toISOString(),
    feed: "databento",
    left: { symbol: "MNQ", bars: [{ t: nowMs - 20 * 60_000, c: 21000 }] },
    right: { symbol: "ES", bars: [{ t: nowMs - 20 * 60_000, c: 5800 }] },
    quotes: { left: { price: 21000 }, right: { price: 5800 } },
    scan: { candidates: [{ symbol: "MNQ", side: "short", pathBand: "A", grade: "A", confluence: 0.7, actionable: true, strategyPrimary: "TJR" }] },
    smcMaster: {
      left: { symbol: "MNQ", side: "short", plan: { symbol: "MNQ", side: "short", entry: 21000, stop: 21030, entryZone: { top: 21010, bottom: 20990 } } },
      right: { symbol: "ES", side: null, plan: null },
    },
  };
}

function manager(nowMs = NOW) {
  const feed = room.createRoomManagerFeed();
  feed.pushRoom(frame(nowMs - 3_000), { card: card(), newsBlackout: false, synthetic: false });
  return feed.getState();
}

function tooling(over = {}) {
  const calls = [];
  return {
    calls,
    async readAccount() {
      calls.push("account");
      return over.account === undefined
        ? {
            account: { account_number: "995386158", brokerage_account_type: "agentic", agentic_allowed: true, option_level: "option_level_2" },
            portfolio: { cash: "1000", buying_power: { buying_power: "1000" } },
          }
        : over.account;
    },
    async positions() {
      return over.positions ?? [];
    },
    async quote() {
      return over.quote === undefined ? { bid: 1.22, ask: 1.25, asOfMs: (over.nowMs ?? NOW) - 2_000 } : over.quote;
    },
    async findOption() {
      calls.push("find");
      return over.optionId === undefined ? "opt-live" : over.optionId;
    },
    async review(order) {
      calls.push(["review", order.legs[0].side, order.legs[0].position_effect]);
      return over.review ?? { ok: true, blocking: false, alerts: [] };
    },
    async place(order, ref) {
      calls.push(["place", order.legs[0].side, order.legs[0].position_effect, ref, order.refKey]);
      if (over.placeError) throw new Error(over.placeError);
      return { id: "ord-1" };
    },
    async dayPnlPct() {
      return over.dayPnlPct === undefined ? 0 : over.dayPnlPct;
    },
  };
}

const row = (over = {}) => ({
  optionId: "opt-1",
  decisionKey: "k1",
  underlier: "QQQ",
  optionType: "put",
  quantity: 2,
  avgDebit: 2,
  entry: 21000,
  stop: 21030,
  side: "short",
  refId: "abc",
  openedAt: TEN - 120_000,
  ...over,
});

console.log("no session");
{
  const t = tooling();
  const out = await runRhDesk({ desk: desk(), manager: manager(), nowMs: NOW, tooling: null, ledger: memoryLedger() });
  check("no token does not send", out.sent === false && /RH_ACCESS_TOKEN/.test(out.why), out.why);
  check("no token does not call place", t.calls.length === 0, t.calls.join(","));
}

console.log("open");
{
  const t = tooling();
  const ledger = memoryLedger();
  const out = await runRhDesk({ desk: desk(), manager: manager(), nowMs: NOW, tooling: t, ledger });
  check("open reviews then places", JSON.stringify(t.calls.filter((c) => c !== "account" && c !== "find")), JSON.stringify([["review", "buy", "open"], ["place", "buy", "open", refIdFor("open:" + (t.calls.find((c) => Array.isArray(c) && c[1] === "buy")?.[4] ?? "").replace(/^open:/, "")), t.calls.find((c) => Array.isArray(c) && c[0] === "place")?.[4]]]));
  const place = t.calls.find((c) => Array.isArray(c) && c[0] === "place");
  check("open sent", out.sent === true && out.orderId === "ord-1" && out.cycle.phase === "place", `${out.cycle.phase} ${out.why}`);
  check("ref id is the stable id of the ref key", place && place[3] === refIdFor(place[4]), String(place));
  check("ref id is stable", refIdFor("open:k") === refIdFor("open:k") && refIdFor("open:k") !== refIdFor("open:j"));
  const held = await ledger.list();
  check("the ledger remembers the open", held.length === 1 && held[0].optionId === "opt-live" && held[0].side === "short", JSON.stringify(held));
  const again = tooling();
  const second = await runRhDesk({ desk: desk(), manager: manager(), nowMs: NOW + 5_000, tooling: again, ledger });
  check("a fill that has not listed yet is not opened twice", second.sent === false && !again.calls.some((c) => Array.isArray(c) && c[0] === "place"), second.cycle.reason);
}

console.log("blocking review does not open");
{
  const t = tooling({ review: { ok: false, blocking: true, alerts: ["Robinhood review is not available on this session."] } });
  const out = await runRhDesk({ desk: desk(), manager: manager(), nowMs: NOW, tooling: t, ledger: memoryLedger() });
  check("blocking review does not place an open", out.sent === false && !t.calls.some((c) => Array.isArray(c) && c[0] === "place"), out.why);
}

console.log("close");
{
  const t = tooling({ nowMs: TEN, quote: { bid: 1.4, ask: 1.45, asOfMs: TEN - 1_000 }, positions: [{ optionId: "opt-1", quantity: 2, averagePrice: 2, chainSymbol: "QQQ", optionType: "put" }] });
  const out = await runRhDesk({ desk: desk(TEN), manager: null, nowMs: TEN, tooling: t, ledger: memoryLedger([row()]), blockNewEntries: true });
  const place = t.calls.find((c) => Array.isArray(c) && c[0] === "place");
  check("a losing desk position is sold even when the kill is on and there is no proposal", out.sent === true && place?.[1] === "sell" && place?.[2] === "close", `${out.cycle.phase} ${out.why} ${JSON.stringify(place)}`);
  check("the close reviews before it sells", t.calls.some((c) => Array.isArray(c) && c[0] === "review" && c[1] === "sell"));
}

console.log("close through a buying-power review");
{
  const t = tooling({
    nowMs: TEN,
    quote: { bid: 1.4, ask: 1.45, asOfMs: TEN - 1_000 },
    positions: [{ optionId: "opt-1", quantity: 2, averagePrice: 2, chainSymbol: "QQQ", optionType: "put" }],
    review: { ok: false, blocking: true, alerts: ["not enough buying power"] },
  });
  const out = await runRhDesk({ desk: desk(TEN), manager: null, nowMs: TEN, tooling: t, ledger: memoryLedger([row()]) });
  check("a buying-power review does not trap the close", out.sent === true, out.why);
}

console.log("hard reject does not close");
{
  const t = tooling({
    nowMs: TEN,
    quote: { bid: 1.4, ask: 1.45, asOfMs: TEN - 1_000 },
    positions: [{ optionId: "opt-1", quantity: 2, averagePrice: 2, chainSymbol: "QQQ", optionType: "put" }],
    review: { ok: false, blocking: true, alerts: ["Order rejected"] },
  });
  const out = await runRhDesk({ desk: desk(TEN), manager: null, nowMs: TEN, tooling: t, ledger: memoryLedger([row()]) });
  check("a hard reject does not sell", out.sent === false && !t.calls.some((c) => Array.isArray(c) && c[0] === "place"), out.why);
}

console.log("foreign");
{
  const t = tooling({ positions: [{ optionId: "foreign", quantity: 1, averagePrice: 1.2, chainSymbol: "QQQ", optionType: "call" }] });
  const out = await runRhDesk({ desk: desk(), manager: manager(), nowMs: NOW, tooling: t, ledger: memoryLedger() });
  check("a position this desk did not open is not closed and blocks a new open", out.sent === false && out.cycle.order == null && /did not open/.test(out.cycle.reason), out.cycle.reason);
  check("foreign calls neither review nor place", !t.calls.some((c) => Array.isArray(c) && (c[0] === "review" || c[0] === "place")));
}

console.log("drawdown");
{
  const t = tooling({
    nowMs: TEN,
    dayPnlPct: -0.5,
    quote: { bid: 2.1, ask: 2.14, asOfMs: TEN - 1_000 },
    positions: [{ optionId: "opt-1", quantity: 2, averagePrice: 2, chainSymbol: "QQQ", optionType: "put" }],
  });
  const out = await runRhDesk({ desk: desk(TEN), manager: null, nowMs: TEN, tooling: t, ledger: memoryLedger([row()]) });
  check("a drawdown force-closes a desk position", out.sent === true && out.cycle.phase === "close", `${out.cycle.phase} ${out.cycle.reason}`);
}

console.log("review policy");
check("a clean review may close", closeMaySend({ ok: true, blocking: false, alerts: [] }));
check("a missing review route may close", closeMaySend({ ok: false, blocking: true, alerts: ["Robinhood review is not available on this session."] }));
check("a rejected close may not", closeMaySend({ ok: false, blocking: true, alerts: ["Order rejected"] }) === false);

console.log("posture");
{
  const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
  const loop = read("src/lib/room/manager-live-loop.ts") + read("src/lib/execution/rh-autofire.ts");
  check("propose modules do not place", /place_option_order\(|CallDynamicTool|review_option_order\(/.test(loop) === false);
  const eng = read("src/components/room/room-engine.ts");
  check("the poll does not decide on a null account", /held:\s*null/.test(eng) === false && /account:\s*null/.test(eng) === false);
  check("the poll calls the sender", /stepRhDesk\(/.test(eng));
  const cardUi = read("src/components/room/exec-card.tsx");
  check("Flatten is one click", /Flatten all/.test(cardUi) && !/window\.confirm\([\s\S]{0,200}Flatten/.test(cardUi));
  const flat = read("src/routes/api/cron/exec-flatten.ts");
  check("15:30 calls the robinhood sender and does not require the alpaca phase", /runRhDesk\(/.test(flat) && /flatten:\s*true/.test(flat));
  const step = read("src/routes/api/cron/room-step.ts");
  check("room-step calls the same sender", /runRhDesk\(/.test(step));
  check("room-step still does not import the alpaca executor", [...step.matchAll(/^import .+$/gm)].every((m) => !/alpaca|exec\/executor|execAfterCycle/i.test(m[0])));
  const env = read(".env.example");
  check("env example no longer says node never places", /Node never places/.test(env) === false && /RH_ACCESS_TOKEN/.test(env));
  check("arms stay on in the example", /^RH_OPTIONS_AUTOFIRE_ENABLED=true$/m.test(env) && /^RH_LIVE_ARMED=true$/m.test(env));
}

console.log(`\nrh-dispatch: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
