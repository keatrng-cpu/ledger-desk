/**
 * Real Manager feed (room state) → RH live loop. Never places, never calls a broker.
 *
 * Run: npx tsx scripts/verify-manager-live-loop.mjs   (also invoked from verify-rh-autofire-gates.mjs)
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

export async function verifyManagerLiveLoop(check) {
  const ROOT = fileURLToPath(new URL("..", import.meta.url));
  const read = (p) => readFileSync(join(ROOT, p), "utf8");
  const feedMod = await import("../src/lib/room/manager-feed.ts");
  const room = await import("../src/lib/room/manager-room-feed.ts");
  const loop = await import("../src/lib/room/manager-live-loop.ts");
  const rh = await import("../src/lib/execution/rh-autofire.ts");
  const acct = await import("../src/lib/execution/manager-account.ts");

  const NOW = Date.UTC(2026, 9, 6, 13, 35, 0); // 09:35 ET
  const FLAGS = { autofireEnabled: true, liveArmed: true, confirmedInWriting: true, nowMs: NOW };
  const FUNDED = {
    label: "Agentic ••6158", accountNumber: "995386158", accountType: "limited_margin",
    cash: 1000, buyingPower: 1000, optionsBuyingPower: null, unsettledFunds: 0,
    agenticAllowed: true, optionLevel: "option_level_2", asOfMs: NOW - 20_000, source: "get_portfolio",
  };
  const card = (o = {}) => ({
    card: "path_continuation", name: "PATH continuation", verdict: "ARMED", blocks: [], underlier: "QQQ", type: "PUT", dte: 0,
    band: "A", confluence: 0.7, futSymbol: "MNQ", futSide: "short", smcWord: "TAKE", smcMissing: "", deskContracts: 2,
    sizedFrom: "level", deltaMin: 0.3, deltaMax: 0.6, plan: { entry: 21000, stop: 21030, t1: 20950, t2: null, rr1: 1.6 },
    tier: "live", awayPts: 0, pT1: 0.6, expR: 0.3, pFill: 1, patterns: null, strategy: "TJR sweep", ...o,
  });
  const frame = ({ beat = "fill", c = card(), ask = 1.2, qty = 2, triggerOk = true, id = 7, nowMs = NOW - 3_000, failGate = null } = {}) => {
    const plan = { entry: c, exp: "2026-10-06", offset: "ATM", quote: { ask, strike: 600, delta: -0.5, iv: 0.2 }, qty, capUsd: 600, debitUsd: Math.round(ask * 100 * qty) };
    const gates = [
      { id: "market", ok: true, label: "open" },
      { id: "desk_word", ok: true, label: "ARMED" },
      ...(failGate ? [{ id: failGate, ok: false, label: failGate }] : []),
      { id: "trigger", ok: triggerOk, label: triggerOk ? "CE touched" : "Resting at CE" },
    ];
    const fill = beat === "fill";
    return {
      id, nowMs,
      output: { broker_action: { execute_trade: fill, action_type: fill ? "BUY_OPEN" : "HOLD", underlying: c.underlier, option_type: c.type, strike_offset: "ATM", contracts_quantity: fill ? qty : 0, target_position_id: null } },
      trace: { beat, gates, refusal: failGate ? `${failGate} refused` : null, refusalGate: failGate, entry: ["fill", "trigger_wait", "vetoed"].includes(beat) ? plan : null, optionsOpen: true, meeting: null },
      roomP: 0.61,
      lenses: { Gemma: { p: 0.6 }, Jax: { p: 0.58 }, Nova: { p: 0.66 }, Sterling: { p: 0.55 }, Vince: { p: 0.62 } },
    };
  };
  const CTX = (c = card()) => ({ card: c, newsBlackout: false, synthetic: false });
  const fire = (grade = "A", confluence = 0.7, o = {}) => ({ key: `fire:${grade}`, symbol: "MNQ", side: "short", grade, confluence, at: NOW - 2_000, ...o });
  const quote = (ask = 1.25) => ({ optionId: "opt-live", askPrice: ask, bidPrice: ask - 0.03, asOfMs: NOW - 2_000, source: "get_option_quotes" });
  const step = (feed, o = {}) => loop.proposeRhFromManagerFeed({ feed, fire: fire(), account: FUNDED, liveQuote: quote(), flags: FLAGS, nowMs: NOW, ...o });
  const res = (p) => (p.mode === "live_when_armed" ? "ok" : p.gated.gate);

  console.log("\nManager feed = real room state (not the demo cycle)");
  const feed = room.createRoomManagerFeed();
  check("real feed is not the stub", [feedMod.isStubManagerFeed(feed), room.isRoomManagerFeed(feed)], [false, true]);
  check("before any cycle: LISTENING, no call, no agree", [feed.getState().current, feed.getState().call, feedMod.standAgentAgree(feed)], ["LISTENING", null, false]);
  check("before any cycle: loop refuses", res(step(feed)) !== "ok", true);
  feed.pushRoom(frame(), CTX());
  const s = feed.getState();
  check("room fill → AGREED / AGREE_LIVE / agentAgree", [s.current, s.call?.action, s.call?.agentAgree], ["AGREED", "AGREE_LIVE", true]);
  check("call mirrors the room's plan", [s.call?.underlier, s.call?.side, s.call?.strikeOffset, s.call?.contracts, s.call?.estDebitTotal], ["QQQ", "put", "ATM", 2, 240]);
  check("cycleId from the room frame", s.cycleId, "room-7");
  check("lenses + roomP from the room", [s.call?.lenses.Nova, s.call?.roomP], [0.66, 0.61]);
  check("signals: CE touch / DTE / SEQ / veto from the cycle", [s.signals?.ceTouch, s.signals?.dte, s.signals?.seqTake, s.signals?.vetoed], [true, 0, true, false]);
  check("managerStateForAgree(real) === feed.getState()", feedMod.managerStateForAgree(feed) === feed.getState(), true);

  console.log("\nlive loop: managerStateForAgree → candidateFromFloorPathStand → propose (hard gates unchanged)");
  const { candidate } = loop.rhCandidateFromManagerFeed({ feed, account: FUNDED, nowMs: NOW });
  check("candidate agentAgree from the real Manager", candidate.agentAgree, true);
  check("candidate Floor signals wired (CE / tape / DTE)", [candidate.ceTouch, Math.round(candidate.tapeAgeSec), candidate.dte], [true, 3, 0]);
  const ok = step(feed);
  check("armed + fire + funded + live quote → live_when_armed (shape only)", [res(ok), ok.placeShape?.priceSource, ok.placeShape?.priceHint, ok.placeShape?.quantity], ["ok", "live_quote", 1.27, 2]);
  check("repo env (empty) → autofire_off", res(step(feed, { flags: undefined, env: {} })), "autofire_off");
  check("live arm off → live_arm", res(step(feed, { flags: { ...FLAGS, liveArmed: false } })), "live_arm");
  check("no PATH fire → path_fire", res(step(feed, { fire: null })), "path_fire");
  check("BP $120 → bp_floor", res(step(feed, { account: { ...FUNDED, buyingPower: 120 } })), "bp_floor");
  check("Individual 7477 → bp_wrong_account", res(step(feed, { account: { ...FUNDED, accountNumber: "415577477" } })), "bp_wrong_account");
  check("tape 45s → tape_stale", res(step(feed, { nowMs: NOW + 42_000, flags: { ...FLAGS, nowMs: NOW + 42_000 }, fire: fire("A", 0.7, { at: NOW + 40_000 }), liveQuote: { ...quote(), asOfMs: NOW + 40_000 } })), "tape_stale");
  check("live debit over $550 → debit_cap", res(step(feed, { liveQuote: quote(2.9) })), "debit_cap");

  console.log("\ndemo stub NEVER produces a live agentAgree");
  const stub = feedMod.createStubManagerFeed({ reportAutomation: false });
  stub.steer("DECLARE_AGREE");
  check("stub's own call says agree (presentation)", stub.getState().call?.agentAgree, true);
  check("managerStateForAgree(stub) → null", feedMod.managerStateForAgree(stub), null);
  check("stub candidate agentAgree false", loop.rhCandidateFromManagerFeed({ feed: stub, account: FUNDED, nowMs: NOW }).candidate.agentAgree, false);
  check("stub step refused (even armed + funded + fire)", step(stub).mode, "refused");
  check("stub ticket null", loop.ticketFromManagerState(feedMod.managerStateForAgree(stub)), null);
  check("no feed step refused", step(null).mode, "refused");
  stub.dispose();

  console.log("\nroom beats that must not agree");
  const f2 = room.createRoomManagerFeed();
  f2.pushRoom(frame({ beat: "trigger_wait", triggerOk: false }), CTX());
  check("trigger_wait → PROPOSING, no agree", [f2.getState().current, feedMod.standAgentAgree(f2)], ["PROPOSING", false]);
  check("trigger_wait step refused (no CE touch / no ticket)", step(f2).mode, "refused");
  f2.pushRoom(frame({ beat: "vetoed", failGate: "ev" }), CTX());
  check("room vetoed → BLOCKED / VETO, no agree", [f2.getState().current, f2.getState().call?.action, feedMod.standAgentAgree(f2)], ["BLOCKED", "VETO", false]);
  f2.pushRoom(frame(), { ...CTX(), synthetic: true });
  check("synthetic desk feed → BLOCKED, no agree", [f2.getState().current, feedMod.standAgentAgree(f2)], ["BLOCKED", false]);
  f2.pushRoom(frame(), { ...CTX(), newsBlackout: true });
  check("news blackout → no agree", feedMod.standAgentAgree(f2), false);
  f2.pushRoom(frame({ ask: 3.0 }), CTX());
  check("room ticket $600 > $550 → no agree (debit_cap)", [feedMod.standAgentAgree(f2), f2.getState().call?.reasoning.blocks.includes("debit_cap")], [false, true]);
  f2.pushRoom(frame({ c: card({ dte: 2 }) }), CTX(card({ dte: 2 })));
  check("DTE 2 → no agree", feedMod.standAgentAgree(f2), false);
  f2.pushRoom(frame({ c: card({ band: "A-", confluence: 0.63 }) }), CTX(card({ band: "A-", confluence: 0.63 })));
  check("A- 0.63 (< 0.65) → no agree", feedMod.standAgentAgree(f2), false);

  console.log("\nOwner can only remove agreement");
  const f3 = room.createRoomManagerFeed();
  f3.pushRoom(frame(), CTX());
  check("fill agrees", feedMod.standAgentAgree(f3), true);
  f3.steer("DECLARE_VETO");
  check("DECLARE_VETO → BLOCKED, no agree", [f3.getState().current, feedMod.standAgentAgree(f3)], ["BLOCKED", false]);
  f3.steer("DECLARE_AGREE");
  check("DECLARE_AGREE cannot undo a veto", feedMod.standAgentAgree(f3), false);
  f3.pushRoom(frame({ id: 8 }), CTX());
  check("veto holds on the next cycle of the same plan", feedMod.standAgentAgree(f3), false);
  const c2 = card({ plan: { entry: 20980, stop: 21010, t1: 20930, t2: null, rr1: 1.6 } });
  f3.pushRoom(frame({ id: 9, c: c2 }), CTX(c2));
  check("a new plan is a new decision → agrees", feedMod.standAgentAgree(f3), true);
  f3.steer("TABLE");
  check("TABLE → no agree", feedMod.standAgentAgree(f3), false);

  console.log("\nB+ through the real feed (explicit gate, 1 contract)");
  const bp = card({ band: "B+", confluence: 0.61 });
  const f4 = room.createRoomManagerFeed();
  f4.pushRoom(frame({ c: bp, ask: 1.6, qty: 2 }), CTX(bp));
  check("B+ fill → agree, Stand shrinks to 1 contract", [feedMod.standAgentAgree(f4), f4.getState().call?.contracts, f4.getState().call?.estDebitTotal], [true, 1, 160]);
  const bstep = step(f4, { fire: fire("B+", 0.61), liveQuote: quote(1.6) });
  check("B+ step → live_when_armed, 1 contract, live quote", [res(bstep), bstep.placeShape?.quantity, bstep.placeShape?.priceHint], ["ok", 1, 1.62]);
  const bw = card({ band: "B+", confluence: 0.61, smcWord: "WAIT" });
  f4.pushRoom(frame({ c: bw, ask: 1.6 }), CTX(bw));
  check("B+ without SEQ TAKE → no agree (bplus_seq)", [feedMod.standAgentAgree(f4), f4.getState().call?.reasoning.blocks.includes("bplus_seq")], [false, true]);
  check("B+ without SEQ TAKE step refused", step(f4, { fire: fire("B+", 0.61), liveQuote: quote(1.6) }).mode, "refused");
  const bm = card({ band: "B-", confluence: 0.58 });
  f4.pushRoom(frame({ c: bm, ask: 1.6 }), CTX(bm));
  check("B- → no agree", feedMod.standAgentAgree(f4), false);
  f4.pushRoom(frame({ c: bp, ask: 1.2, qty: 2 }), CTX(bp));
  check("B+ 1ct at $120 (< $150 envelope) → no agree", feedMod.standAgentAgree(f4), false);

  console.log("\nlive Agentic account via managerRhAccountFromConnector");
  const f5 = room.createRoomManagerFeed();
  check("default account = Agentic SNAPSHOT (can never authorize)", [f5.getState().account.isSnapshot, acct.accountPlaceGate(f5.getState().account).ok], [true, false]);
  const a = f5.setAccountFromConnector({
    account: { account_number: "995386158", brokerage_account_type: "agentic", nickname: "Agentic", agentic_allowed: true, option_level: "option_level_2" },
    portfolio: { cash: "1000.00", buying_power: { buying_power: "1000.00" } },
    asOf: new Date(NOW - 10_000).toISOString(),
  });
  const st = f5.getState().account;
  check("ManagerRoomState.account = connector read", [st === a, st.accountNumber, st.isSnapshot, st.optionsBuyingPowerUsd, st.canFillEnvelope], [true, "995386158", false, 1000, true]);
  check("accountPlaceGate ok on the live Agentic read", acct.accountPlaceGate(st, { requiredDebitUsd: 240 }).ok, true);
  f5.pushRoom(frame(), CTX());
  check("account survives room cycles", f5.getState().account.accountNumber, "995386158");
  f5.setAccountFromConnector({
    account: { account_number: "415577477", brokerage_account_type: "individual", agentic_allowed: false, option_level: "option_level_2" },
    portfolio: { cash: "984.12", buying_power: { buying_power: "11.56" } },
  });
  check("Individual read refuses at accountPlaceGate", acct.accountPlaceGate(f5.getState().account).gate, "bp_wrong_account");
  f5.setAccountFromConnector({ account: { account_number: "995386158", agentic_allowed: true, option_level: "option_level_2" }, portfolio: { cash: "0" } });
  check("BP missing → unknown → refuse", acct.accountPlaceGate(f5.getState().account).gate, "bp_unknown");

  console.log("\nwiring + posture");
  const tab = read("src/components/room/trading-floor-tab.tsx");
  const eng = read("src/components/room/room-engine.ts");
  const mf = read("src/lib/room/manager-feed.ts");
  check("Floor scene gets the real room feed (stub only on ?manager=stub)", /managerFeed: managerStubRequested\(\) \? undefined : roomManagerFeed\(\)/.test(tab), true);
  check("room engine pushes each live cycle into the Manager feed", /roomManagerFeed\(\)\.pushRoom\(/.test(eng), true);
  check("managerStateForAgree: stub → null, real → getState()", /if \(!feed \|\| isStubManagerFeed\(feed\)\) return null;\s*return feed\.getState\(\);/.test(mf), true);
  const srcs = read("src/lib/room/manager-room-feed.ts") + read("src/lib/room/manager-live-loop.ts");
  check("real feed + loop never place", /place_option_order\(|CallDynamicTool|review_option_order\(/.test(srcs), false);
  check("loop reads the Stand bit via managerStateForAgree", /managerStateForAgree\(args\.feed\)/.test(read("src/lib/room/manager-live-loop.ts")), true);
  const env = read(".env.example");
  check(".env.example arms stay false", [/^RH_OPTIONS_AUTOFIRE_ENABLED=false$/m.test(env), /^RH_LIVE_ARMED=false$/m.test(env)], [true, true]);
  check("env helpers default off", [rh.rhAutofireEnabled({}), rh.rhLiveArmed({})], [false, false]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let pass = 0;
  let fail = 0;
  const check = (name, got, want) => {
    const ok = JSON.stringify(got) === JSON.stringify(want);
    if (ok) pass++;
    else fail++;
    console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
  };
  await verifyManagerLiveLoop(check);
  console.log(`\nmanager-live-loop: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}
