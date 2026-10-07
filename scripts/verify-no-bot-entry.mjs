/**
 * A live Robinhood entry needs the desk, not a bot: the real room cycle -> the real Manager feed -> the RH proposal.
 *
 *   npx tsx scripts/verify-no-bot-entry.mjs
 *
 * WHY: the Manager is called "a Grok bot", and when Grok's usage ran out the worry was that the Stand could not agree and live
 * entries stalled. In the repo the Stand's bit is deterministic — chair rules over the room's own cycle (manager-room-feed.ts) — and
 * calls no model and no network. This runs the REAL drill day through it and proves: with a funded Agentic account read and the arms
 * on, and nothing from any bot, every room fill reaches live_when_armed; nothing that is not a fill ever does; and the safety
 * refusals (disarmed, unfunded, wrong account, no feed) still hold.
 *
 * It also pins the bug this found: the room filled 2 contracts at $3.29 ($658, over the $550 cap) and the Stand VETOED it (debit_cap)
 * although one contract ($329) fits. The Stand's job is to shrink, never grow — the envelope ($150-$550, 1-4) is unchanged.
 */
import fs from "node:fs";

const D = await import("../src/lib/room/drill.ts");
const room = await import("../src/lib/room/manager-room-feed.ts");
const loop = await import("../src/lib/room/manager-live-loop.ts");
const gates = await import("../src/lib/execution/rh-autofire-gates.ts");
const mf = await import("../src/lib/room/manager-feed.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

const steps = D.playDrill();
const account = (now, o = {}) => ({ label: "Agentic ••6158", accountNumber: "995386158", accountType: "limited_margin", cash: 1000, buyingPower: 1000, optionsBuyingPower: null, unsettledFunds: 0, agenticAllowed: true, optionLevel: "option_level_2", asOfMs: now - 20_000, source: "get_portfolio", ...o });
const quote = (now) => ({ optionId: "opt-live", askPrice: 1.2, bidPrice: 1.17, asOfMs: now - 2_000, source: "get_option_quotes" });
const armed = (now) => ({ autofireEnabled: true, liveArmed: true, confirmedInWriting: true, nowMs: now });

/** Push one drill step into a feed and read what the loop proposes. */
const run = (feed, i, { acct, flags, trace } = {}) => {
  const s = steps[i];
  feed.pushRoom({ id: i + 1, nowMs: s.nowMs, output: s.cycle.output, trace: trace ?? s.cycle.trace, roomP: null, lenses: null }, { card: s.desk?.entry ?? null, newsBlackout: !!s.desk?.news?.blackout, synthetic: false });
  const p = loop.proposeRhFromManagerFeed({ feed, fire: null, account: acct === undefined ? account(s.nowMs) : acct, liveQuote: quote(s.nowMs), flags: flags ?? armed(s.nowMs), nowMs: s.nowMs });
  return { p, st: feed.getState(), s };
};
const fills = steps.map((s, i) => [s, i]).filter(([s]) => s.cycle?.output?.broker_action?.execute_trade && s.cycle.output.broker_action.action_type === "BUY_OPEN").map(([, i]) => i);

console.log("no bot: the whole drill day through the real feed");
{
  const feed = room.createRoomManagerFeed();
  const results = steps.map((s, i) => (s.cycle ? run(feed, i) : null));
  const placed = results.map((r, i) => (r && r.p.mode === "live_when_armed" ? i : -1)).filter((i) => i >= 0);
  check(`the room fills on ${fills.length} steps of the drill day`, fills.length >= 2, String(fills));
  check("every room fill (BUY_OPEN) reaches live_when_armed with a funded Agentic read, the arms on and no bot input", fills.every((i) => placed.includes(i)), `fills ${fills} placed ${placed} refusals ${fills.filter((i) => !placed.includes(i)).map((i) => results[i].p.gated.gate)}`);
  check("nothing that is not a room fill is ever proposed (exits, waits, closed hours never place)", placed.every((i) => fills.includes(i)), String(placed));
  const t = fills.map((i) => results[i].p.ticket).filter(Boolean);
  check("each proposal is inside the envelope: $150-$550, 1-4 contracts, ATM or OTM_1", t.length === fills.length && t.every((x) => x.maxDebitTotal >= gates.RH_MIN_DEBIT_TOTAL && x.maxDebitTotal <= gates.RH_MAX_DEBIT_TOTAL && x.contracts >= 1 && x.contracts <= gates.RH_MAX_CONTRACTS && ["ATM", "OTM_1"].includes(x.strikeOffset)), JSON.stringify(t.map((x) => [x.contracts, x.maxDebitTotal, x.strikeOffset])));
  check("the Stand never grows the room's ticket: contracts <= what the room filled", fills.every((i) => (results[i].p.ticket?.contracts ?? 99) <= steps[i].cycle.output.broker_action.contracts_quantity), JSON.stringify(fills.map((i) => [results[i].p.ticket?.contracts, steps[i].cycle.output.broker_action.contracts_quantity])));
  check("the proposal carries a review/place shape and never places by itself", fills.every((i) => results[i].p.placeShape && results[i].p.placeShape.side === "buy" && results[i].p.placeShape.positionEffect === "open"));
}

console.log("the bug: a ticket over the cap is shrunk, not vetoed");
{
  const over = fills.find((i) => steps[i].cycle.trace.entry && steps[i].cycle.output.broker_action.contracts_quantity >= 2);
  const feed = room.createRoomManagerFeed();
  const trace = structuredClone(steps[over].cycle.trace);
  trace.entry.quote.ask = 3.29;
  trace.entry.qty = 2; // $658 at two contracts
  const out = structuredClone(steps[over].cycle.output);
  out.broker_action.contracts_quantity = 2;
  steps[over].cycle.output = out;
  const r = run(feed, over, { trace });
  check("two contracts at $3.29 is $658 — over the $550 cap", Math.round(3.29 * 100 * 2) === 658 && 658 > gates.RH_MAX_DEBIT_TOTAL);
  check("the Stand agrees at ONE contract ($329), not a veto", r.st.call?.agentAgree === true && r.st.call?.contracts === 1 && r.st.call?.estDebitTotal === 329, JSON.stringify([r.st.call?.action, r.st.call?.contracts, r.st.call?.estDebitTotal]));
  check("…and the proposal places that one contract", r.p.mode === "live_when_armed" && r.p.ticket?.contracts === 1 && r.p.ticket?.maxDebitTotal === 329, `${r.p.mode} ${r.p.gated?.gate ?? ""}`);
  const feed2 = room.createRoomManagerFeed();
  const trace2 = structuredClone(trace);
  trace2.entry.quote.ask = 6.0; // one contract is $600: still over the cap
  const r2 = run(feed2, over, { trace: trace2 });
  check("when even ONE contract is over $550 the ticket still refuses (the cap is not loosened)", r2.st.call?.agentAgree !== true && r2.p.mode === "refused", JSON.stringify([r2.st.call?.action, r2.p.mode, r2.p.gated?.gate]));
}

console.log("the safety refusals still hold");
{
  const i = fills[0];
  const feedA = room.createRoomManagerFeed();
  check("arms off -> refused", run(feedA, i, { flags: { autofireEnabled: false, liveArmed: false, confirmedInWriting: true, nowMs: steps[i].nowMs } }).p.mode === "refused");
  const feedB = room.createRoomManagerFeed();
  check("no account read -> refused (the broker read is what proves the money is there)", run(feedB, i, { acct: null }).p.mode === "refused");
  const feedC = room.createRoomManagerFeed();
  const poor = run(feedC, i, { acct: account(steps[i].nowMs, { buyingPower: 11.56, cash: 11.56 }) });
  check("an account under the $150 floor -> refused", poor.p.mode === "refused" && /bp_/.test(poor.p.gated.gate), poor.p.gated.gate);
  const feedD = room.createRoomManagerFeed();
  const wrong = run(feedD, i, { acct: account(steps[i].nowMs, { accountNumber: "415577477", label: "Individual ••7477" }) });
  check("the Individual account is never a place target -> refused", wrong.p.mode === "refused", wrong.p.gated.gate);
  const stub = mf.createStubManagerFeed();
  const sp = loop.proposeRhFromManagerFeed({ feed: stub, fire: null, account: account(steps[i].nowMs), liveQuote: quote(steps[i].nowMs), flags: armed(steps[i].nowMs), nowMs: steps[i].nowMs });
  check("the demo stub feed can never place", sp.mode === "refused");
  const none = loop.proposeRhFromManagerFeed({ feed: null, fire: null, account: account(steps[i].nowMs), liveQuote: quote(steps[i].nowMs), flags: armed(steps[i].nowMs), nowMs: steps[i].nowMs });
  check("no feed at all can never place", none.mode === "refused");
}

console.log("the Stand is not a bot");
{
  const read = (p) => fs.readFileSync(new URL(`../src/lib/${p}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = ["room/manager-room-feed.ts", "room/manager-live-loop.ts", "execution/manager-agree.ts"];
  check("the Manager feed, the live loop and the agree adapter call no network and no model", files.every((f) => !/\bfetch\s*\(|xai|anthropic|openai|grok|XAI_API_KEY|ANTHROPIC_API_KEY/i.test(read(f))), files.filter((f) => /\bfetch\s*\(|xai|anthropic|openai|grok/i.test(read(f))).join());
}

console.log(`\nno-bot-entry: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
