/**
 * The trading floor (src/lib/room) against its contract.
 *
 *   npx tsx scripts/verify-room.mjs
 *
 * Plays the SYNTHETIC drill day through the real pipeline and checks: the
 * trader's output schema on every cycle, the beats and meetings the day must
 * produce, the room's memory scoring, fail-closed behaviour without a desk
 * read, a malformed input, determinism, Sterling's gates, and the pricer.
 */
const { playDrill, drillFrames, runDrillStep } = await import("../src/lib/room/drill.ts");
const { runRoomCycle, outputViolations } = await import("../src/lib/room/orchestrator.ts");
const { emptyBook } = await import("../src/lib/room/paper-book.ts");
const { blackScholes } = await import("../src/lib/room/option-math.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};

console.log("drill day");
const steps = playDrill();
const at = (t) => steps.find((s) => s.frame.at === t);
check("every cycle honours the output contract", steps.every((s) => outputViolations(s.cycle.output).length === 0), steps.map((s) => outputViolations(s.cycle.output)).flat().join("; "));
check("pre-news meeting at 08:00", at("08:00")?.cycle.trace.meeting?.kind === "pre_news");
check("blackout keeps everyone off the board at 08:20", Object.values(at("08:20").cycle.output.room_state.character_locations).every((z) => z !== "THE_WHITEBOARD" && z !== "WATERCOOLER"));
check("post-news meeting at 08:47 quotes the move", at("08:47")?.cycle.trace.meeting?.kind === "post_news" && at("08:47").cycle.output.floor_dialogue_and_meetings.some((l) => /−0\.38%/.test(l.text)));
check("morning brief at 09:20", at("09:20")?.cycle.trace.meeting?.kind === "brief");
check("Judas refuses at 09:31", at("09:31").cycle.output.broker_action.action_type === "HOLD" && at("09:31").cycle.trace.beat === "blocked");
check("B+ review at 09:40, paper only", at("09:40")?.cycle.trace.meeting?.kind === "setup" && at("09:40").cycle.output.floor_dialogue_and_meetings.some((l) => l.character === "Sterling" && /paper only/.test(l.text)));
const fill = at("09:56").cycle.output.broker_action;
check("CE touch buys 2× QQQ calls OTM_1", fill.action_type === "BUY_OPEN" && fill.contracts_quantity === 2 && fill.underlying === "QQQ" && fill.option_type === "CALL" && fill.strike_offset === "OTM_1", JSON.stringify(fill));
check("execution phase: Vince and Sterling at their desks", at("09:56").cycle.output.room_state.character_locations.Vince === "VINCE_DESK" && at("09:56").cycle.output.room_state.character_locations.Sterling === "STERLING_DESK");
check("never averages the filled plan at 10:05", at("10:05").cycle.output.broker_action.action_type === "HOLD" && at("10:05").cycle.trace.refusalGate === "no_average");
const trim = at("10:14").cycle.output.broker_action;
check("+40% trims half (1 of 2)", trim.action_type === "SELL_CLOSE" && trim.contracts_quantity === 1, JSON.stringify(trim));
check("second book on SPY vetoed at 10:22", at("10:22").cycle.trace.beat === "vetoed" && at("10:22").cycle.trace.refusalGate === "one_book");
check("Sterling walks to the board to veto", at("10:22").cycle.output.room_state.character_locations.Sterling === "THE_WHITEBOARD");
check("11:00 time stop closes the runner", at("11:00").cycle.output.broker_action.action_type === "SELL_CLOSE" && at("11:00").book.positions.length === 0);
check("close debrief at 16:02", at("16:02")?.cycle.trace.meeting?.kind === "debrief");
const minds = steps[steps.length - 1].minds;
check("Jax's Judas call scored wrong", minds.record.Jax.wrong >= 1, JSON.stringify(minds.record.Jax));
check("Sterling's veto priced as saved", minds.record.Sterling.savedUsd > 0, JSON.stringify(minds.record.Sterling));
check("lunch puts roamers in the lounge", Object.entries(at("12:30").cycle.output.room_state.character_locations).filter(([, z]) => z === "WATERCOOLER").length >= 2);
check("the day ends flat and in profit on the drill", steps[steps.length - 1].book.positions.length === 0 && steps[steps.length - 1].book.cash > 10_000);
check("every meeting is an exchange (5–9 lines, all five speak)", steps.every((s) => { const l = s.cycle.output.floor_dialogue_and_meetings; return l.length >= 5 && l.length <= 9 && new Set(l.map((x) => x.character)).size === 5; }));

console.log("fail closed");
const now = etWallToEpochMs("2026-10-05", "10:00");
const tape = { SPY: { price: 785, rsi: 78, vix: 22, trend: "BULLISH", volume_spike: true }, QQQ: { price: 775, rsi: 80, vix: 22, trend: "BULLISH", volume_spike: true } };
const blind = runRoomCycle({ portfolio: { cash: 10000, open_positions: [] }, market_data: tape }, null, now);
check("no desk read: no BUY_OPEN on RSI + a spike", blind.output.broker_action.action_type === "HOLD" && blind.trace.beat === "blind");
const stopped = runRoomCycle({ portfolio: { cash: 10000, open_positions: [{ id: "X1", ticker: "QQQ", type: "CALL", strike: 776, exp: "2026-10-06", pnl_percent: -21 }] }, market_data: tape }, null, now);
check("no desk read: −21% still exits", stopped.output.broker_action.action_type === "SELL_CLOSE" && stopped.output.broker_action.target_position_id === "X1" && stopped.output.broker_action.contracts_quantity === 0);
const bad = runRoomCycle({ portfolio: { cash: -5 }, market_data: {} }, null, now);
check("malformed input: HOLD, contract still valid", bad.output.broker_action.action_type === "HOLD" && outputViolations(bad.output).length === 0 && bad.trace.errors.length > 0);
const weekend = runRoomCycle({ portfolio: { cash: 10000, open_positions: [{ id: "X2", ticker: "SPY", type: "PUT", strike: 785, exp: "2026-10-05", pnl_percent: -30 }] }, market_data: tape }, null, etWallToEpochMs("2026-10-04", "12:00"));
check("options closed: the stop waits for the open", weekend.output.broker_action.action_type === "HOLD" && /waits for 09:30/.test(weekend.trace.refusal ?? ""));

console.log("determinism and gates");
const f = drillFrames().find((x) => x.at === "09:56");
const a1 = runDrillStep(emptyBook(10000), null, f).cycle.output;
const a2 = runDrillStep(emptyBook(10000), null, f).cycle.output;
check("same input, same JSON", JSON.stringify(a1) === JSON.stringify(a2));
const poor = runDrillStep(emptyBook(1000), null, f).cycle;
check("10% of $1,000 cannot buy one contract → refused", poor.output.broker_action.action_type === "HOLD" && poor.trace.refusalGate === "cash_cap", poor.trace.refusalGate);
const halted = emptyBook(10000);
halted.counters.realizedToday = -250;
halted.counters.dayKey = "2026-10-05";
halted.counters.dayStartEquity = 10000;
const h = runDrillStep(halted, null, f).cycle;
check("daily 2% halt refuses the fill", h.output.broker_action.action_type === "HOLD" && h.trace.refusalGate === "halt_day", h.trace.refusalGate);

console.log("pricer");
const c = blackScholes(775, 776, 1.25 / 365, 0.2, "CALL").price;
const p = blackScholes(775, 776, 1.25 / 365, 0.2, "PUT").price;
check("put-call parity (r = 0)", Math.abs(c - p - (775 - 776)) < 1e-6, `${c} ${p}`);
check("ATM call delta ≈ 0.5", Math.abs(blackScholes(775, 775, 1 / 365, 0.2, "CALL").delta - 0.5) < 0.02);

console.log(`\nroom: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
