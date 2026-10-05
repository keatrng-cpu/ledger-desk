/**
 * The trading floor (src/lib/room) against its contract.
 *
 *   npx tsx scripts/verify-room.mjs
 *
 * Plays the SYNTHETIC drill day through the real pipeline and checks: the
 * trader's output schema on every cycle, the beats and meetings the day must
 * produce, the room's memory scoring, fail-closed behaviour without a desk
 * read, a malformed input, determinism, Sterling's gates, the pricer, and
 * the 3D floor's plan against the Blender office (public/floor/office.glb).
 */
const { playDrill, drillFrames, runDrillStep } = await import("../src/lib/room/drill.ts");
const { runRoomCycle, outputViolations } = await import("../src/lib/room/orchestrator.ts");
const { emptyBook } = await import("../src/lib/room/paper-book.ts");
const { blackScholes } = await import("../src/lib/room/option-math.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");
const { readFileSync, existsSync } = await import("node:fs");
const LAYOUT = JSON.parse(readFileSync(new URL("../src/data/floor-layout.json", import.meta.url), "utf8"));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
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
check("a forming card waits for the touch, priced at its CE", at("09:47").cycle.trace.beat === "trigger_wait" && at("09:47").cycle.trace.entry?.ev != null, at("09:47").cycle.trace.beat);
check("09:56 CE touch refused as an OPTION (the ledger), not as a plan", at("09:56").cycle.trace.beat === "vetoed" && at("09:56").cycle.trace.refusalGate === "ev", `${at("09:56").cycle.trace.beat} ${at("09:56").cycle.trace.refusalGate}`);
check("the refused touch opens a ghost on the room's rules", (at("09:56").book.lab?.ghosts ?? []).some((g) => g.kind === "refused" && g.of === "ev"));
const fill = at("10:11").cycle.output.broker_action;
check("10:11 the A+ CE touch buys 2× QQQ calls, the strike the ledger chose", fill.action_type === "BUY_OPEN" && fill.contracts_quantity === 2 && fill.underlying === "QQQ" && fill.option_type === "CALL" && fill.strike_offset === at("10:11").cycle.trace.entry?.offset, JSON.stringify(fill));
check("a fill passes the EV gate (the model's EV, after costs)", (at("10:11").cycle.trace.entry?.ev?.evUsd ?? 0) > 0);
check("execution phase: Vince and Sterling at their desks", at("10:11").cycle.output.room_state.character_locations.Vince === "VINCE_DESK" && at("10:11").cycle.output.room_state.character_locations.Sterling === "STERLING_DESK");
check("the fill opens its mandate twin in the ghost room", (at("10:11").book.lab?.ghosts ?? []).some((g) => g.kind === "twin"));
check("never averages the filled plan at 10:14", at("10:14").cycle.output.broker_action.action_type === "HOLD" && at("10:14").cycle.trace.refusalGate === "no_average");
const trim = at("10:30").cycle.output.broker_action;
check("+40% trims half (1 of 2)", trim.action_type === "SELL_CLOSE" && trim.contracts_quantity === 1, JSON.stringify(trim));
check("second book on SPY vetoed at 10:22", at("10:22").cycle.trace.beat === "vetoed" && at("10:22").cycle.trace.refusalGate === "one_book");
check("Sterling walks to the board to veto", at("10:22").cycle.output.room_state.character_locations.Sterling === "THE_WHITEBOARD");
check("11:00 time stop closes the runner", at("11:00").cycle.output.broker_action.action_type === "SELL_CLOSE" && at("11:00").book.positions.length === 0);
check("close debrief at 16:02", at("16:02")?.cycle.trace.meeting?.kind === "debrief");
check("the debrief reads the ghost room's receipt", at("16:02").cycle.output.floor_dialogue_and_meetings.some((l) => l.character === "Sterling" && /Ghost room/.test(l.text)));
const minds = steps[steps.length - 1].minds;
check("Jax's Judas call scored wrong", minds.record.Jax.wrong >= 1, JSON.stringify(minds.record.Jax));
check("Sterling's veto priced as saved", minds.record.Sterling.savedUsd > 0, JSON.stringify(minds.record.Sterling));
// Needs drive WHEN in the lunch window people go (a quiet morning sends them earlier) — check the window, not one frame.
const inLounge = (t) => Object.values(at(t).cycle.output.room_state.character_locations).filter((z) => z === "WATERCOOLER").length;
check("lunch puts roamers in the lounge", ["11:40", "12:30"].some((t) => inLounge(t) >= 2), ["11:40", "12:30"].map((t) => `${t}:${inLounge(t)}`).join(" "));
check("the day ends flat and in profit on the drill", steps[steps.length - 1].book.positions.length === 0 && steps[steps.length - 1].book.cash > 10_000);
check("every meeting is an exchange (5–9 lines, all five speak)", steps.every((s) => { const l = s.cycle.output.floor_dialogue_and_meetings; return l.length >= 5 && l.length <= 9 && new Set(l.map((x) => x.character)).size === 5; }));
// The people layer decides where Jax goes on a dead tape; his line has to agree.
const ERRAND = { coffee: /coffee/, cooler: /Water run/, couch: /couch/, tv: /news TV/, window: /window/, chat: /bar/, phone: /call/ };
const chops = steps.filter((s) => s.cycle.trace.beat === "chop" && !s.cycle.trace.meeting);
const errandOk = (s) => {
  const act = s.cycle.trace.acts?.Jax?.act ?? "desk";
  const line = s.cycle.output.floor_dialogue_and_meetings.find((l) => l.character === "Jax")?.text ?? "";
  return ERRAND[act] ? ERRAND[act].test(line) : /staying on the screens/.test(line);
};
check("dead-tape talk follows where Jax actually goes", chops.length >= 2 && chops.every(errandOk), chops.filter((s) => !errandOk(s)).map((s) => s.frame.at).join(", "));

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
// The frame that fills on the drill — so each refusal below is caused by the one gate under test.
const f = drillFrames().find((x) => x.at === "10:11");
check("the fill frame fills from an empty book", runDrillStep(emptyBook(10000), null, f).cycle.output.broker_action.action_type === "BUY_OPEN");
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

console.log("quant: pricing an option on a plan");
const Q = await import("../src/lib/room/quant.ts");
const TO = await import("../src/lib/room/time-odds.ts");
const EX = await import("../src/lib/room/exits.ts");
const LAB = await import("../src/lib/room/lab.ts");
const DB = await import("../src/lib/room/debate.ts");
const { etWallToEpochMs: wall } = await import("../src/lib/trading/sessions.ts");
// A synthetic, monotone time curve (the real one is measured; these checks are about the arithmetic).
const cdf = (k, half) => Array.from({ length: 33 }, (_, i) => (i === 0 ? 0 : Math.min(1, 1 - Math.pow(0.5, i / half))));
const curve = { label: "test", n: 500, t1: 150, loss: 300, open: 50, pT1: 0.3, lossR: -0.85, medianT1Bars: 3, medianLossBars: 2,
  cdfT1: cdf(0, 3), cdfLoss: cdf(0, 2), pT1Unresolved: Array(17).fill(0.25), nUnresolved: Array(17).fill(100), markR: Array(17).fill(0.1),
  is: {}, oos: {} };
const file = { version: 1, builtAt: "test", barMinutes: 15, holdBars: 32, subsets: { nyam_all: curve, nyam_1to2: curve } };
const w0 = TO.windowOdds(0.3, 1.5, 0, 4, file);
check("window odds sum to one", Math.abs(w0.pT1 + w0.pLoss + w0.pNone - 1) < 1e-9, JSON.stringify(w0));
check("a longer window holds more of the T1s", TO.windowOdds(0.3, 1.5, 0, 8, file).pT1 > w0.pT1);
const w2 = TO.windowOdds(0.3, 1.5, 2, 2, file);
check("conditional window odds still sum to one", Math.abs(w2.pT1 + w2.pLoss + w2.pNone - 1) < 1e-9, JSON.stringify(w2));
check("an unmeasured curve says so", TO.windowOdds(0.3, 1.5, 0, 4, { version: 0, subsets: {}, barMinutes: 15, holdBars: 32 }).measured === false);
const nowQ = wall("2026-10-05", "09:56");
const flatQ = wall("2026-10-05", "11:00");
const planQ = { side: "long", entry: 30996, stop: 30924, t1: 31110, atr: 60 };
// ── weekend time: a Friday option expiring Monday has one trading day of life, not three calendar days ──
{
  const om = await import("../src/lib/room/option-math.ts");
  const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");
  const hrs = (now, exp) => om.yearsToExpiry(etWallToEpochMs(...now), exp) * 365 * 24;
  const at = (d, hm) => [d, hm];
  check("Mon 10:00 → Tue 16:00 is 30.0 calendar hours (weekday pricing unchanged)", Math.abs(hrs(at("2026-10-05", "10:00"), "2026-10-06") - 30) < 1e-6, String(hrs(at("2026-10-05", "10:00"), "2026-10-06")));
  check("Thu 10:00 → Fri 16:00 is 30.0 hours", Math.abs(hrs(at("2026-10-08", "10:00"), "2026-10-09") - 30) < 1e-6);
  check("Fri 10:00 → Mon 16:00 is ALSO 30.0 hours (the weekend carries no variance)", Math.abs(hrs(at("2026-10-09", "10:00"), "2026-10-12") - 30) < 1e-6, String(hrs(at("2026-10-09", "10:00"), "2026-10-12")));
  check("Sun 20:00 → Mon 16:00 is 16.0 hours (only the rest of Sunday is removed)", Math.abs(hrs(at("2026-10-11", "20:00"), "2026-10-12") - 16) < 1e-6, String(hrs(at("2026-10-11", "20:00"), "2026-10-12")));
  check("Fri 16:00 → Mon 16:00 is 24.0 hours", Math.abs(hrs(at("2026-10-09", "16:00"), "2026-10-12") - 24) < 1e-6);
  const px = (day, exp) => om.quoteOption(777.5, 778, exp, "CALL", om.ivFor("QQQ", 16.2), etWallToEpochMs(day, "10:00")).mid;
  check("same trading hours, same price: Fri→Mon ATM call equals Thu→Fri", Math.abs(px("2026-10-09", "2026-10-12") - px("2026-10-08", "2026-10-09")) < 1e-9, `${px("2026-10-09", "2026-10-12")} vs ${px("2026-10-08", "2026-10-09")}`);
  check("expired is zero life, never negative", om.yearsToExpiry(etWallToEpochMs("2026-10-06", "16:30"), "2026-10-06") === 0);
  check("across the DST fall-back weekend (Sun Nov 1 2026 has 25 hours) Fri→Mon is still 30.0 hours: 79 elapsed − 49 weekend", Math.abs(hrs(at("2026-10-30", "10:00"), "2026-11-02") - 30) < 1e-6, String(hrs(at("2026-10-30", "10:00"), "2026-11-02")));
}

const quoteQ = (await import("../src/lib/room/option-math.ts")).quoteOption(775, 776, "2026-10-06", "CALL", 0.207, nowQ);
const ev = Q.priceOptionPlan({ plan: planQ, pT1: 0.31, type: "CALL", strike: 776, exp: "2026-10-06", iv: 0.207, entryPx: quoteQ.ask, futNow: 31000, etfNow: 775, nowMs: nowQ, fillMs: nowQ, flatMs: flatQ });
const evSum = ev.scenarios.reduce((a, x) => a + x.p * x.pnlUsd, 0) / ev.scenarios.reduce((a, x) => a + x.p, 0);
check("EV is the probability-weighted path P&L", Math.abs(evSum - ev.evUsd) < 0.02, `${evSum} vs ${ev.evUsd}`);
check("no path loses more than the −20% backstop", ev.scenarios.every((x) => x.pnlUsd >= Math.round(-0.2 * quoteQ.ask * 100) - 1), JSON.stringify(ev.scenarios.map((x) => x.pnlUsd)));
check("'T1 pays' is the sign of the T1 path", ev.t1Pays === ev.scenarios.find((x) => x.kind === "t1").pnlUsd > 0);
check("the plan's odds now equal the entry odds at the entry price", Math.abs(Q.pT1Now(planQ, 0.31, 30996) - 0.31) < 1e-9);
check("price walking toward T1 raises the odds", Q.pT1Now(planQ, 0.31, 31060) > 0.31 && Q.pT1Now(planQ, 0.31, 30950) < 0.31);
const atr8 = Q.attribute({ type: "CALL", strike: 776, exp: "2026-10-06", contracts: 2, spot0: 775, iv0: 0.207, t0Ms: nowQ, spot1: 777.6, iv1: 0.2, t1Ms: nowQ + 40 * 60_000, entryPx: 3.29, exitPx: 4.4 });
check("the P&L attribution sums to the trade", Math.abs(atr8.price + atr8.vol + atr8.time + atr8.spread - atr8.total) < 0.02, JSON.stringify(atr8));
check("a spot move up is green on price, the clock red", atr8.price > 0 && atr8.time < 0);
const pick2 = Q.chooseContract([
  { offset: "ATM", strike: 775, ask: 3.6, delta: 0.5, ev: { evPerDollar: 0.01 } },
  { offset: "OTM_1", strike: 776, ask: 3.1, delta: 0.42, ev: { evPerDollar: 0.03 } },
]);
check("the chooser takes the most EV per dollar", pick2.offset === "OTM_1");

console.log("quant: the window, the flat and the calibration");
// 40% of the losing fills lose ON the fill bar — the measured shape (2022 preview: 46%).
const cdfFB = Array.from({ length: 33 }, (_, i) => Math.min(1, 0.4 + 0.6 * (1 - Math.pow(0.5, i / 2))));
const curveFB = { ...curve, cdfLoss: cdfFB, markFrac: Array(17).fill(0.3) };
const fileFB = { ...file, subsets: { nyam_all: curveFB, nyam_1to2: curveFB } };
const wFB = TO.windowOdds(0.3, 1.5, 0, 4, fileFB);
check("at entry the fill bar's own stops are still ahead", Math.abs(wFB.pLoss - 0.7 * cdfFB[3]) < 1e-9 && Math.abs(wFB.pT1 - 0.3 * curve.cdfT1[3]) < 1e-9, JSON.stringify(wFB));
const wH = TO.windowOdds(0.3, 1.5, 2, 2, fileFB);
const aliveH = 1 - 0.3 * curve.cdfT1[1] - 0.7 * cdfFB[1];
check("a held plan conditions only on the bars already closed", Math.abs(wH.pT1 - (0.3 * (curve.cdfT1[3] - curve.cdfT1[1])) / aliveH) < 1e-9, JSON.stringify(wH));
check("the flat now is all flat path", TO.windowOdds(0.3, 1.5, 5, 0, fileFB).pNone === 1);
const g956 = TO.barGrid(wall("2026-10-05", "09:56"), wall("2026-10-05", "09:56"), wall("2026-10-05", "11:00"));
const g1000 = TO.barGrid(wall("2026-10-05", "10:00"), wall("2026-10-05", "10:00"), wall("2026-10-05", "11:00"));
const gHeld = TO.barGrid(wall("2026-10-05", "09:56"), wall("2026-10-05", "10:20"), wall("2026-10-05", "11:00"));
check("a 09:56 fill has bars 0–4 before 11:00, a 10:00 fill bars 0–3", g956.fromBar === 0 && g956.windowBars === 5 && g1000.windowBars === 4, `${g956.windowBars} ${g1000.windowBars}`);
check("held at 10:20 after a 09:56 fill: bar 2 in progress, bars 2–4 left", gHeld.fromBar === 2 && gHeld.windowBars === 3, JSON.stringify(gHeld));
const argsQ = { plan: planQ, pT1: 0.31, type: "CALL", strike: 776, exp: "2026-10-06", iv: 0.207, entryPx: quoteQ.ask, futNow: 31000, etfNow: 775, nowMs: nowQ, fillMs: nowQ, flatMs: flatQ };
const withMark = (frac) => ({ ...file, subsets: { nyam_all: { ...curve, markFrac: Array(17).fill(frac), markR: Array(17).fill(frac * 3) }, nyam_1to2: { ...curve, markFrac: Array(17).fill(frac), markR: Array(17).fill(frac * 3) } } });
const noneHi = Q.priceOptionPlan({ ...argsQ, curves: withMark(1.5) }).scenarios.find((x) => x.kind === "none");
const noneLo = Q.priceOptionPlan({ ...argsQ, curves: withMark(-3) }).scenarios.find((x) => x.kind === "none");
check("an open plan at the flat sits below T1 (no pooled mark above the target)", noneHi.fut < planQ.t1 && noneHi.fut > planQ.entry, `${noneHi.fut}`);
check("…and no lower than the failed-hold close", noneLo.fut >= planQ.entry - 0.5 * (planQ.entry - planQ.stop) - 1e-6, `${noneLo.fut}`);
const cals = Array.from({ length: 99 }, (_, i) => Q.calibratedP((i + 1) / 100).p);
check("the calibration is monotone in the model's odds", cals.every((x, i) => i === 0 || x >= cals[i - 1] - 1e-12));
check("it reads the out-of-sample table: 30.7% → 30.0%, 18.6% → 13.7%", Math.abs(Q.calibratedP(0.3067).p - 0.3) < 0.005 && Math.abs(Q.calibratedP(0.1863).p - 0.1374) < 0.005, `${Q.calibratedP(0.3067).p} ${Q.calibratedP(0.1863).p}`);
const evC = Q.priceOptionPlan({ ...argsQ, curves: fileFB });
const vC = (k) => evC.scenarios.find((x) => x.kind === k)?.pnlUsd ?? 0;
const cC = evC.calibrated;
check(
  "the realized-decile EV re-weights the same three paths",
  cC != null && Math.abs((cC.pT1 * vC("t1") + cC.pLoss * vC("loss") + cC.pNone * vC("none")) / (cC.pT1 + cC.pLoss + cC.pNone) - cC.evUsd) < 0.02,
  JSON.stringify(cC),
);

console.log("exits: the room's three added rules");
const deskX = (exits, agendaNext = null) => ({ exits, htf: { QQQ: "bull", SPY: "bull" }, agenda: { next: agendaNext, last: null, setup: null } });
const tapeX = { price: 776, rsi: 55, vix: 17, trend: "BULLISH", volume_spike: false };
const posX = { id: "P1", ticker: "QQQ", type: "CALL", strike: 776, exp: "2026-10-06", pnl_percent: 12, contracts: 2, trimmed: false };
// The T1 trim measured −$0.70 a fill against the mandate on four years — off in ROOM_POLICY, kept as a switch.
check("ROOM_POLICY leaves the T1 trim off (measured, not shown to help)", EX.ROOM_POLICY.levelTrim === false && EX.ROOM_POLICY.premiumTrim === true);
const t1x = EX.exitFor(posX, tapeX, { desk: deskX({ P1: { kind: "t1", why: "MNQ reached T1" } }), etDate: "2026-10-05", etMin: 600, nowMs: wall("2026-10-05", "10:00"), policy: { ...EX.ROOM_POLICY, levelTrim: true }, hold: null });
check("with the switch on, T1 on the futures plan trims half", t1x?.reason === "t1" && t1x.qty === 1 && !t1x.closesAll, JSON.stringify(t1x && { r: t1x.reason, q: t1x.qty }));
check("with ROOM_POLICY, T1 alone does not trim", EX.exitFor(posX, tapeX, { desk: deskX({ P1: { kind: "t1", why: "MNQ reached T1" } }), etDate: "2026-10-05", etMin: 600, nowMs: wall("2026-10-05", "10:00"), policy: EX.ROOM_POLICY, hold: null }) == null);
const t1m = EX.exitFor(posX, tapeX, { desk: deskX({ P1: { kind: "t1", why: "MNQ reached T1" } }), etDate: "2026-10-05", etMin: 600, nowMs: wall("2026-10-05", "10:00"), policy: EX.MANDATE_POLICY, hold: null });
check("the mandate alone ignores T1", t1m == null);
const neg = { holdPx: 3.0, bidNow: 3.2, edgeUsd: -20, pT1Now: 0.2, ev: { measured: true, scenarios: [{ kind: "t1", p: 0.1 }] } };
const th = EX.exitFor({ ...posX, pnl_percent: -5 }, tapeX, { desk: deskX({}), etDate: "2026-10-05", etMin: 620, nowMs: wall("2026-10-05", "10:20"), policy: EX.ROOM_POLICY, hold: neg });
check("holding worth less than the bid → theta stop", th?.reason === "theta", th?.reason);
const thT = EX.exitFor({ ...posX, pnl_percent: 5, trimmed: true }, tapeX, { desk: deskX({}), etDate: "2026-10-05", etMin: 620, nowMs: wall("2026-10-05", "10:20"), policy: EX.ROOM_POLICY, hold: neg });
check("a trimmed runner is not theta-stopped", thT == null);
const thG = EX.exitFor({ ...posX, pnl_percent: 8 }, tapeX, { desk: deskX({}), etDate: "2026-10-05", etMin: 620, nowMs: wall("2026-10-05", "10:20"), policy: EX.ROOM_POLICY, hold: neg });
check("a green position is never theta-stopped (no protecting early)", thG == null, thG?.reason);
const thU = EX.exitFor({ ...posX, pnl_percent: -5 }, tapeX, { desk: deskX({}), etDate: "2026-10-05", etMin: 620, nowMs: wall("2026-10-05", "10:20"), policy: EX.ROOM_POLICY, hold: { ...neg, ev: { ...neg.ev, measured: false } } });
check("no theta stop without the measured time curve", thU == null, thU?.reason);
const rel = { name: "ISM (test)", date: "2026-10-05", timeEt: "10:00", impact: "high", minutes: 4 };
const evx = EX.exitFor(posX, tapeX, { desk: deskX({}, rel), etDate: "2026-10-05", etMin: 596, nowMs: wall("2026-10-05", "09:56"), policy: EX.ROOM_POLICY, hold: null });
check("an untrimmed option leaves before a high-impact release", evx?.reason === "event", evx?.reason);
const evm = EX.exitFor(posX, tapeX, { desk: deskX({}, { ...rel, impact: "medium" }), etDate: "2026-10-05", etMin: 596, nowMs: wall("2026-10-05", "09:56"), policy: EX.ROOM_POLICY, hold: null });
check("a medium release does not move it", evm == null);

console.log("debate: who argues what");
check("TJR cards are Jax's thesis", DB.thesisOwner("TJR sweep → 5m CHoCH") === "Jax");
check("Blake mechanical cards are Nova's", DB.thesisOwner("Blake IFVG mech") === "Nova");
check("ICT cards are Gemma's", DB.thesisOwner("ICT OTE silver bullet") === "Gemma");
const cardD = { pT1: 0.31, plan: { entry: 30996, stop: 30924, t1: 31110, t2: null, rr1: 1.58 }, tier: "armed", pFill: 0.8, patterns: null, drivers: [] };
const lens = DB.lensesFor(cardD, ev, null);
check("five lenses, every one a probability", ["Jax", "Nova", "Sterling", "Gemma", "Vince"].every((c) => lens[c].p > 0 && lens[c].p < 1 && lens[c].basis));
check("Vince prices the fill: below Nova until the CE fills", lens.Vince.p < lens.Nova.p);
const badEv = { ...ev, evUsd: -12, t1Pays: true };
check("negative EV is a decisive challenge", DB.challengeFor(cardD, badEv, null, "10:20 ET").decisive === true);
const calNeg = { ...ev, evUsd: 6, t1Pays: true, calibrated: { p: 0.22, pT1: 0.1, pLoss: 0.6, pNone: 0.3, evUsd: -3 } };
const chCal = DB.challengeFor(cardD, calNeg, null, "10:20 ET");
check("model EV up, realized-decile EV down → Sterling notes it, not decisive (four years: gating on it did not pick better)", chCal.decisive === false && chCal.who === "Sterling" && /not blocking/.test(chCal.text), chCal.text);

console.log("lab: the ghost room's arithmetic");
const closedGhost = (id, kind, of, pnlUsd) => ({ id, kind, of, planKey: null, ticker: "QQQ", type: "CALL", strike: 776, exp: "2026-10-06", offset: "ATM", contracts: 1, entryPx: 3, openedAt: 0, fut: null, quant: null, trimmed: false, realizedUsd: 0, pnlPct: 0, closed: { at: 1, px: 3, reason: "t", pnlUsd } });
const watch = (outcome, p, touched = true) => ({ key: `k${Math.random()}`, at: 0, flatAt: 1, symbol: "MNQ", underlier: "QQQ", side: "long", entry: 1, stop: 0, t1: 2, decision: "fill", gate: null, pWindow: p, evUsd: 1, lenses: { Jax: p, Nova: p, Sterling: p, Gemma: p, Vince: p }, touched, outcome, resolvedAt: 1 });
const labX = { version: 1, seq: 3, ghosts: [closedGhost("G1", "twin", "QQQ-776C-1", 40), closedGhost("G2", "refused", "ev", 160), closedGhost("G3", "refused", "ev", -60)], watches: [watch("t1", 0.4), watch("stop", 0.3), watch("none", 0.2), watch("t1", 0.5), watch("stop", 0.25), watch("void", 0.6, false)] };
const lr = LAB.labRead(labX, [{ id: "QQQ-776C-1", pnlUsd: 25 }, { id: "QQQ-776C-1", pnlUsd: 30 }]);
check("twins: room P&L (trims summed) minus the mandate ghost", lr.twins.n === 1 && lr.twins.roomUsd === 55 && lr.twins.mandateUsd === 40 && lr.twins.deltaUsd === 15, JSON.stringify(lr.twins));
check("refusals are priced by the gate that refused them", lr.refusals[0]?.gate === "ev" && lr.refusals[0].n === 2 && lr.refusals[0].pnlUsd === 100 && lr.refusals[0].wins === 1, JSON.stringify(lr.refusals));
check("calibration scores only plans whose CE filled", lr.calibration.n === 5 && Math.abs(lr.calibration.hitRate - 0.4) < 1e-9, JSON.stringify(lr.calibration));
const brier = [0.4, 0.3, 0.2, 0.5, 0.25].map((p, i) => (p - [1, 0, 0, 1, 0][i]) ** 2).reduce((a, x) => a + x, 0) / 5;
check("a person's Brier is quoted at five scored plans", lr.track.Nova.n === 5 && Math.abs(lr.track.Nova.brier - brier) < 0.001, JSON.stringify(lr.track.Nova));
check("Vince is scored per card: an unfilled plan counts as a miss", lr.track.Vince.n === 6 && lr.track.Nova.n === 5 && Math.abs(lr.track.Vince.hitRate - 2 / 6) < 0.001, JSON.stringify(lr.track.Vince));

console.log("floor plan and the Blender office");
// Chairs face what they serve: yaw 0 faces +z, so the front is (sin yaw, cos yaw).
const table = LAYOUT.furniture.find((x) => x.id === "table_war");
const facesIt = (x, t) => Math.sin((x.rot * Math.PI) / 180) * (t.pos[0] - x.pos[0]) + Math.cos((x.rot * Math.PI) / 180) * (t.pos[1] - x.pos[1]) > 0;
const chairsFace = LAYOUT.furniture.filter((x) => /^mchair_\d+$/.test(x.id)).every((x) => facesIt(x, table));
check("war-room chairs face the table", chairsFace);
// The investment wing's meeting chairs face their own tables: the boardroom's, and the chair's visitors face the chair's desk.
const boardTable = LAYOUT.furniture.find((x) => x.id === "table_Board");
check("boardroom chairs face the boardroom table", Boolean(boardTable) && LAYOUT.furniture.filter((x) => /^mchair_B\d+$/.test(x.id)).every((x) => facesIt(x, boardTable)));
const ceoDesk = LAYOUT.furniture.find((x) => x.id === "desk_Chair");
check("the chair's visitors face the chair's desk", Boolean(ceoDesk) && LAYOUT.furniture.filter((x) => /^vchair_C\d+$/.test(x.id)).every((x) => facesIt(x, ceoDesk)));

console.log("floor plan: the annex offices and walking");
{
  // The annex (three offices with their glass, furniture and screens) is baked into office.glb. Its pieces are
  // picked by id: the "procedural" flag only ever meant "built at runtime because the GLB predates them".
  const ANNEX_ROOMS = ["office_RnD", "office_Ops", "office_Goal"];
  const isAnnexWall = (w) => /^(lab|ops|goal)_/.test(w.id);
  const isAnnexFurniture = (f) => /_(RnD|Ops|Goal)$/.test(f.id);
  const procRooms = ANNEX_ROOMS.map((id) => LAYOUT.rooms.find((r) => r.id === id)).filter(Boolean);
  check("the three annex offices are present and not flagged procedural (the GLB carries them)", procRooms.map((r) => r.id).sort().join() === "office_Goal,office_Ops,office_RnD" && procRooms.every((r) => !r.procedural), procRooms.map((r) => `${r.id}${r.procedural ? " (procedural)" : ""}`).join());
  const ids = [...LAYOUT.rooms, ...LAYOUT.walls, ...LAYOUT.furniture, ...LAYOUT.screens, ...LAYOUT.emissives].map((x) => x.id);
  check("every id in the plan is unique (screens and keyboards are found by exact name)", new Set(ids).size === ids.length, ids.filter((x, i) => ids.indexOf(x) !== i).join());
  const inside = (r, [x, z]) => x > r.x[0] && x < r.x[1] && z > r.z[0] && z < r.z[1];
  const spotOf = { office_RnD: "office_rnd", office_Ops: "office_ops", office_Goal: "office_goal" };
  for (const r of procRooms) {
    const sp = LAYOUT.spots[spotOf[r.id]];
    check(`${r.id}: its desk spot is inside it, sits, and looks at its monitors`, sp && inside(r, sp.pos) && sp.pose === "sit" && Math.abs(sp.look[0] - sp.pos[0]) < 0.01 && sp.look[1] < sp.pos[1]);
    const key = r.id.replace("office_", "");
    const mons = LAYOUT.screens.filter((x) => x.id.startsWith(`mon_${key === "RnD" ? "Rnd" : key}_`));
    check(`${r.id}: monitors face the chair, sit on the desk and are inside the room`, mons.length >= 2 && mons.every((m) => m.facing === 0 && inside(r, [m.center[0], m.center[2]]) && m.center[2] < sp.pos[1]), mons.map((m) => m.id).join());
    const walls = LAYOUT.walls.filter((w) => isAnnexWall(w) && w.id.startsWith(key === "RnD" ? "lab_" : `${key.toLowerCase()}_`));
    check(`${r.id}: walled in glass with a door at least 1.0 m wide`, walls.length >= 2 && walls.every((w) => w.kind === "glass") && walls.some((w) => w.doors.some(([a, b]) => b - a >= 1.0)), walls.map((w) => w.id).join());
    check(`${r.id}: the plate on its glass names it`, LAYOUT.screens.some((x) => x.id === `plate_${key === "RnD" ? "Rnd" : key}`));
  }
  const overlap = (a, b) => a.x[0] < b.x[1] && b.x[0] < a.x[1] && a.z[0] < b.z[1] && b.z[0] < a.z[1];
  check("the annex offices do not overlap each other", !overlap(procRooms[0], procRooms[1]) && !overlap(procRooms[1], procRooms[2]) && !overlap(procRooms[0], procRooms[2]));
  check("…and stay inside the building", procRooms.every((r) => r.x[0] >= LAYOUT.bounds.x[0] && r.x[1] <= LAYOUT.bounds.x[1] && r.z[0] >= LAYOUT.bounds.z[0] && r.z[1] <= LAYOUT.bounds.z[1]));
  // An annex piece must not sit inside a piece of the original office.
  const box = (f) => {
    const swap = Math.abs(Math.round(f.rot / 90)) % 2 === 1;
    const [w, , d] = f.size;
    const hw = (swap ? d : w) / 2;
    const hd = (swap ? w : d) / 2;
    return { x: [f.pos[0] - hw, f.pos[0] + hw], z: [f.pos[1] - hd, f.pos[1] + hd] };
  };
  const solid = LAYOUT.furniture.filter((f) => f.obstacle);
  const clash = [];
  for (const f of solid.filter(isAnnexFurniture)) for (const g of solid.filter((x) => !isAnnexFurniture(x))) if (overlap(box(f), box(g))) clash.push(`${f.id}×${g.id}`);
  check("no annex furniture sits inside furniture the GLB already has", clash.length === 0, clash.join());

  const FS = await import("../src/components/room/floor-scene.ts");
  const nav = new FS.NavGrid(LAYOUT);
  const free = (p) => nav.free(...nav.cellOf(p[0], p[1]));
  const reach = (a, b) => {
    const pts = nav.path(a, b);
    if (!nav.lastFound) return null;
    let len = 0;
    let cur = a;
    for (const q of pts) {
      len += Math.hypot(q[0] - cur[0], q[1] - cur[1]);
      cur = q;
    }
    return len;
  };
  const hubs = { "the war room": [-6, 1.8], "the lounge": [8, 2.5] };
  for (const [k, h] of Object.entries(hubs)) check(`${k} hub is open floor`, free(h));
  const stops = [
    ...Object.entries(LAYOUT.spots).map(([k, v]) => [`spot ${k}`, v.pos]),
    ...Object.entries(LAYOUT.anchors).flatMap(([z, ps]) => Object.entries(ps).map(([who, a]) => [`${z}/${who}`, a.pos])),
  ];
  const lost = [];
  const blocked = [];
  for (const [k, pos] of stops) {
    // A couch is sat IN: its anchors are inside the obstacle on purpose.
    const pose = LAYOUT.spots[k.replace("spot ", "")]?.pose;
    if (pose !== "couch" && !free(pos)) blocked.push(k);
    for (const h of Object.values(hubs)) if (reach(h, pos) == null) lost.push(`${k} from ${h}`);
  }
  check(`every spot and anchor is on open floor (${stops.length} checked)`, blocked.length === 0, blocked.join(", "));
  check("…and can be walked to from the war room and from the lounge", lost.length === 0, lost.join(", "));
  // Doors really open: a straight crossing is a short walk. A door a desk shuts forces a long way round, or none.
  const shut = [];
  for (const w of LAYOUT.walls.filter((x) => !x.id.startsWith("ext_"))) {
    const horizontal = w.a[1] === w.b[1];
    for (const [lo, hi] of w.doors) {
      const mid = (lo + hi) / 2;
      const a = horizontal ? [mid, w.a[1] - 0.8] : [w.a[0] - 0.8, mid];
      const b = horizontal ? [mid, w.a[1] + 0.8] : [w.a[0] + 0.8, mid];
      const len = reach(a, b);
      if (len == null || len > 3.2) shut.push(`${w.id}@${mid} (${len == null ? "no way" : len.toFixed(1) + " m"})`);
    }
  }
  check("every door in the plan can be walked through (no desk shuts it)", shut.length === 0, shut.join(", "));
  const seats = { Jax: "JAX'S_DESK", Nova: "NOVA'S_DESK", Gemma: "GEMMA_DESK", Sterling: "STERLING_DESK", Vince: "VINCE_DESK" };
  const trapped = Object.entries(seats).filter(([who, z]) => reach(LAYOUT.anchors[z][who].pos, hubs["the war room"]) == null || reach(LAYOUT.anchors[z][who].pos, hubs["the lounge"]) == null).map(([w]) => w);
  check("all five can walk from their own chair to the war room and the lounge (they used to clip through glass if a desk shut the door)", trapped.length === 0, trapped.join(", "));
  const annex = ["office_rnd", "office_ops", "office_goal"].filter((k) => reach(LAYOUT.spots[k].pos, hubs["the war room"]) == null || reach(LAYOUT.spots[k].pos, hubs["the lounge"]) == null);
  check("and from each annex desk", annex.length === 0, annex.join());
}

const glb = new URL("../public/floor/office.glb", import.meta.url);
if (existsSync(glb)) {
  const buf = readFileSync(glb);
  const jsonLen = buf.readUInt32LE(12);
  const okHeader = buf.toString("ascii", 0, 4) === "glTF" && buf.readUInt32LE(8) === buf.length && buf.toString("ascii", 16, 20) === "JSON";
  const gltf = okHeader ? JSON.parse(buf.toString("utf8", 20, 20 + jsonLen)) : { nodes: [] };
  const names = (gltf.nodes ?? []).map((n) => n.name ?? "");
  // The runtime finds screens, LEDs and keyboards by exact name.
  const wanted = [...LAYOUT.screens.filter((x) => !x.procedural).map((x) => x.id), ...LAYOUT.emissives.filter((x) => !x.procedural).map((x) => x.id), ...["Jax", "Nova", "Gemma", "Sterling", "Vince"].map((n) => `key_${n}`)];
  const off = wanted.filter((id) => names.filter((n) => n === id).length !== 1);
  check("office.glb is a binary glTF the size it says", okHeader);
  check(`office.glb names all ${wanted.length} screens, LEDs and keyboards exactly once`, off.length === 0, off.join(", "));
  check("office.glb carries no lights, cameras or images (the runtime lights it)", !gltf.lights && !gltf.cameras && !(gltf.images ?? []).length);
} else check("public/floor/office.glb exists", false, "run scripts/blender/build_floor.py");

console.log(`\nroom: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
