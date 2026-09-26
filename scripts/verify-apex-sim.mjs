/**
 * The Apex evaluation simulator, pinned.
 *
 * Mechanics are checked on HAND-BUILT fixtures whose answers can be worked on
 * paper (an all-winner tape must pass on a known day, an all-loser tape must
 * bust, a runner that scratches must end an Intraday account and not an EOD
 * one), and the resampling is checked against the committed evidence with
 * RELATIONAL assertions — cards conserved, rate hit, control centred — so a
 * legitimate rebuild of evidence-dist.json does not break it, while a broken
 * bootstrap does.
 *
 * Run: npx tsx scripts/verify-apex-sim.mjs
 */

const sim = await import("../src/lib/propfirm/apex-sim.ts");
const { rulesFor } = await import("../src/lib/propfirm/rules.ts");
const { derivePropAccount } = await import("../src/lib/propfirm/account.ts");
const { MAX_ROOM_FRACTION_PER_TRADE } = await import("../src/lib/propfirm/score.ts");
const { EVIDENCE } = await import("../src/lib/trading/evidence.ts");
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");

let pass = 0;
let fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${JSON.stringify(got)} want ${JSON.stringify(want)}`}`);
};
const near = (name, got, want, tol) => {
  const ok = Number.isFinite(got) && Math.abs(got - want) <= tol;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — got ${got} want ${want} ±${tol}`}`);
};

const dist = await sim.loadEvidenceDist();

/** Consecutive weekdays at 10:00 ET (15:00 UTC), from Monday 2025-01-06. */
function weekdays(count) {
  const out = [];
  for (let d = Date.UTC(2025, 0, 6, 15, 0); out.length < count; d += 86_400_000) {
    const wd = new Date(d).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(d);
  }
  return out;
}

/** days: one array per weekday of [r, peak, trough] trades. */
function fixture(days) {
  const ts = weekdays(days.length);
  const t = [];
  const r = [];
  const peak = [];
  const trough = [];
  days.forEach((trades, di) =>
    trades.forEach(([rr, pk, tr], j) => {
      t.push(ts[di] + j * 60_000);
      r.push(rr);
      peak.push(pk);
      trough.push(tr);
    }),
  );
  return { n: t.length, perWeek: null, t, r, peak, trough };
}

/** 6 MNQ at 40 pt = $480 per R, $6 round-turn — the fixtures' sizing. */
const FIX = {
  ...sim.defaultSimInput(null),
  size: 50_000,
  riskUsd: 500,
  stopPts: 40,
  symbol: "MNQ",
  tradesPerWeek: 5,
  maxTradesPerDay: null,
  paths: 400,
  seed: 11,
};

const acct = (over = {}) =>
  sim.createEvalAccount({
    drawdown: "Intraday",
    startUsd: 50_000,
    trailUsd: 2_000,
    targetUsd: 3_000,
    dailyLossLimitUsd: null,
    dollarsPerR: 480,
    commissionUsd: 6,
    ...over,
  });

console.log("the rules table agrees with the cited rows in rules.ts");
{
  const r50 = sim.apexRulesFor(50_000);
  const ev = rulesFor("Apex", "evaluation", 50_000);
  const pa = rulesFor("Apex", "funded", 50_000);
  check("50K drawdown = rules.ts trail", r50.drawdown.value, ev.trailUsd);
  check("50K target = rules.ts target", r50.profitTarget.value, ev.profitTargetUsd);
  check("50K micro cap = rules.ts", r50.maxMicros.value, ev.maxMicroContracts);
  check("50K mini cap = rules.ts", r50.maxMinis.value, ev.maxContracts);
  check("rules.ts's Intraday eval has no DLL either", ev.dailyLossLimitUsd, null);
  check("rules.ts's Tradovate eval trail never stops (the sim's assumption)", ev.trailStopsAtProfitUsd, null);
  check("the PA lock trigger is drawdown + $100, as rules.ts has it", pa.trailStopsAtProfitUsd, r50.drawdown.value + sim.PA_LOCK_OFFSET_USD);
  const apexSizes = sim.APEX_EVAL_RULES.filter((r) =>
    [r.profitTarget, r.drawdown, r.maxMinis, r.maxMicros, r.eodDailyLossLimit].every((f) => f.confidence === "apex"),
  ).map((r) => r.size);
  check("only the 50K row claims Apex's own text", apexSizes, [50_000]);
  const secondary = sim.APEX_EVAL_RULES.filter((r) => r.size !== 50_000).every((r) =>
    [r.profitTarget, r.drawdown, r.maxMinis, r.maxMicros, r.eodDailyLossLimit].every((f) => f.confidence === "secondary"),
  );
  check("every other size is marked secondary", secondary, true);
  check("the eval-lock rule is marked assumed, not confirmed", sim.APEX_MECHANICS.find((m) => m.key === "eval-lock")?.confidence, "assumed");
  check("the secondary label prints 'unconfirmed'", sim.CONFIDENCE_LABEL.secondary, "unconfirmed");
  check("as-of date", sim.APEX_RULES_AS_OF, "2026-09-25");
}

console.log("\nthe evidence becomes trading days without losing a card");
{
  const pool = sim.buildDayPool(dist);
  const inPool = pool.sessions.reduce((s, d) => s + d.length, 0);
  check("every card lands in exactly one session", inPool, dist.n);
  check("no card index repeats", new Set(pool.sessions.flat()).size, dist.n);
  near("the pool's rate is the builder's perWeek", pool.perWeek, dist.perWeek, 0.05);
  check("empty sessions are kept (fewer than all sessions have a card)", pool.activeShare < 1, true);
  check("cards inside a session are in time order", pool.sessions.every((s) => s.every((i, k) => k === 0 || dist.t[s[k - 1]] <= dist.t[i])), true);
  // The 18:00 ET roll: 17:59 ET belongs to its own date, 18:00 ET to the next.
  const d0 = sim.tradingDayOrdinal(Date.UTC(2025, 0, 7, 22, 59)); // Tue 17:59 EST
  const d1 = sim.tradingDayOrdinal(Date.UTC(2025, 0, 7, 23, 0)); // Tue 18:00 EST
  check("18:00 ET starts the next trading day", d1 - d0, 1);
  const sun = sim.tradingDayOrdinal(Date.UTC(2025, 0, 5, 23, 30)); // Sun 18:30 EST
  const mon = sim.tradingDayOrdinal(Date.UTC(2025, 0, 6, 15, 0)); // Mon 10:00 EST
  check("Sunday evening is Monday's session", sun, mon);
  // The committed dist and the committed pack were built by the same script.
  const inBand = EVIDENCE.inBand.find((b) => b.key === "in");
  check("the dist is the pack's in-band bucket (n)", dist.n, inBand.n);
  near("the dist is the pack's in-band bucket (mean)", dist.r.reduce((a, x) => a + x, 0) / dist.n, inBand.exp, 0.001);
}

console.log("\nthinning hits the cadence, and says when it cannot");
{
  const pool = sim.buildDayPool(dist);
  const open = sim.calibrateThinning(pool, 3, null);
  near("uncapped: p = requested / pool rate", open.p, 3 / pool.perWeek, 1e-9);
  near("uncapped: realised 3/week", open.realizedPerWeek, 3, 1e-9);
  const capped = sim.calibrateThinning(pool, 3, 2);
  near("2/day cap: realised 3/week", capped.realizedPerWeek, 3, 1e-6);
  check("2/day cap needs a higher p than uncapped", capped.p > open.p, true);
  const six = sim.calibrateThinning(pool, 6, 2);
  check("6/week under a 2/day cap is rate-limited", six.rateLimited, true);
  check("and runs at p = 1", six.p, 1);
  check("at the pool's ceiling", six.realizedPerWeek, six.maxPerWeek);
  check("the ceiling is below the request", six.maxPerWeek < 6, true);
  // Empirical: an account that can neither pass nor bust (1 MNQ at 1 pt = $2
  // per R) takes exactly the calibrated rate on average.
  const inert = sim.runApexSim({ ...sim.defaultSimInput(dist.perWeek), tradesPerWeek: 3, riskUsd: 2, stopPts: 1, paths: 5_000 }, dist);
  check("an untouchable account neither passes nor busts", inert.ok && inert.strategy.timeout, 1);
  near("its trades per path = realised rate × 21 sessions / 5", inert.strategy.tradesPerPath, (3 * 21) / 5, 0.3);
}

console.log("\nthe zero-edge control is centred on exactly 0R");
{
  const pool = sim.buildDayPool(dist);
  for (const [pw, cap] of [
    [3, 2],
    [3, null],
    [6, 2],
    [2, 4],
  ]) {
    const th = sim.calibrateThinning(pool, pw, cap);
    const mu = sim.effectiveMeanR(dist.r, pool, th.p, th.cap);
    const ctl = sim.zeroEdgeControl(dist, mu);
    near(`${pw}/wk cap ${cap}: control mean trade`, sim.effectiveMeanR(ctl.r, pool, th.p, th.cap), 0, 1e-12);
  }
  const plain = dist.r.reduce((a, x) => a + x, 0) / dist.n;
  const th = sim.calibrateThinning(pool, 3, null);
  near("uncapped, the strategy's mean is the evidence mean", sim.effectiveMeanR(dist.r, pool, th.p, null), plain, 1e-9);
  const res = sim.runApexSim({ ...sim.defaultSimInput(dist.perWeek), tradesPerWeek: 3 }, dist);
  check("the run reports the control at 0R gross", res.ok && res.control.meanGrossR, 0);
  check("and the same commission drag on both arms", res.ok && +(res.strategy.meanGrossR - res.strategy.meanNetR).toFixed(9), +(res.control.meanGrossR - res.control.meanNetR).toFixed(9));
  const ctl = sim.zeroEdgeControl(dist, 0.5);
  check("a shifted trade never closes below its own low", ctl.r.every((x, i) => ctl.trough[i] <= x && x <= ctl.peak[i]), true);
}

console.log("\nseeded runs are reproducible");
{
  const input = { ...sim.defaultSimInput(dist.perWeek), tradesPerWeek: 3 };
  const a = sim.runApexSim(input, dist);
  const b = sim.runApexSim(input, dist);
  check("same seed, identical result", JSON.stringify(a) === JSON.stringify(b), true);
  const c = sim.runApexSim({ ...input, seed: 2 }, dist);
  check("another seed, other draws", JSON.stringify(a.strategy) !== JSON.stringify(c.strategy), true);
  const r1 = sim.mulberry32(42);
  const r2 = sim.mulberry32(42);
  const xs = Array.from({ length: 5 }, () => r1());
  check("mulberry32 replays by seed", Array.from({ length: 5 }, () => r2()), xs);
  check("mulberry32 stays in [0, 1)", xs.every((x) => x >= 0 && x < 1), true);
}

console.log("\nall +1R passes, all −1R busts");
{
  const wins = fixture(Array.from({ length: 60 }, () => [[1, 1, 0]]));
  for (const drawdown of ["EOD", "Intraday"]) {
    const res = sim.runApexSim({ ...FIX, drawdown }, wins);
    check(`${drawdown}: every path passes`, res.ok && res.strategy.pass, 1);
    // $480/R less $6 commission = $474 banked a day; the 7th trade's peak
    // touches $53,000 (52,844 + 480 − 6 ≥ 53,000).
    check(`${drawdown}: on trading day 7 (median, p25, p75)`, res.ok && [res.strategy.daysToPass.p25, res.strategy.daysToPass.median, res.strategy.daysToPass.p75], [7, 7, 7]);
  }
  const losses = fixture(Array.from({ length: 60 }, () => [[-1, 0, -1]]));
  for (const drawdown of ["EOD", "Intraday"]) {
    const res = sim.runApexSim({ ...FIX, drawdown }, losses);
    check(`${drawdown}: every path busts`, res.ok && res.strategy.bust, 1);
    check(`${drawdown}: none pass`, res.ok && res.strategy.pass, 0);
  }
}

console.log("\nan intraday trail charges for give-back; an EOD trail does not");
{
  // A runner that goes +5R ($2,400) and scratches: the Intraday threshold
  // follows the open peak to $50,400, and the scratch lands at $50,000.
  const intra = acct();
  sim.accountOpenDay(intra);
  check("+5R then scratch: Intraday busts on the spot", sim.accountTrade(intra, 0, 5, 0), "bust");
  const eod = acct({ drawdown: "EOD", dailyLossLimitUsd: 1_000 });
  sim.accountOpenDay(eod);
  check("the same trade on EOD is just a scratch", sim.accountTrade(eod, 0, 5, 0), "open");
  check("EOD threshold untouched by the open peak", eod.threshold, 48_000);

  // Same distribution, both products: winners that run 8R and keep 1R.
  const giveBack = fixture(Array.from({ length: 200 }, (_, i) => [i % 2 === 0 ? [1, 8, 0] : [-1, 0, -1]]));
  const input = { ...FIX, riskUsd: 200, paths: 2_000, seed: 5 };
  const e = sim.runApexSim({ ...input, drawdown: "EOD" }, giveBack);
  const n = sim.runApexSim({ ...input, drawdown: "Intraday" }, giveBack);
  console.log(`       (EOD bust ${(e.strategy.bust * 100).toFixed(1)}%, Intraday bust ${(n.strategy.bust * 100).toFixed(1)}%)`);
  check("Intraday busts more often than EOD on the same trades", n.strategy.bust > e.strategy.bust, true);
  check("by a wide margin, not noise", n.strategy.bust - e.strategy.bust > 0.1, true);
}

console.log("\nthe order of a trade's extremes follows the management rule");
{
  // Green trade: dipped −3.5R ($48,320 > $48,000), then ran +4R, closed +3R.
  // The dip came first — after T1 the stop is at breakeven — so it survives.
  const green = acct();
  sim.accountOpenDay(green);
  check("a green trade's dip is checked before its peak", sim.accountTrade(green, 3, 4, -3.5), "open");
  check("then the peak lifts the threshold", green.threshold, 50_000 + 4 * 480 - 2_000);
  // Red trade: peaked +4R (threshold to $49,920), then stopped at −1R ($49,520).
  const red = acct();
  sim.accountOpenDay(red);
  check("a red trade peaked first, and its stop-out is judged against that", sim.accountTrade(red, -1, 4, -1), "bust");
  // Give-back to a green exit: +6R peak ($52,880 → threshold $50,880), exit +1R ($50,480).
  const giveBack = acct();
  sim.accountOpenDay(giveBack);
  check("a green exit below the peak-raised threshold busts", sim.accountTrade(giveBack, 1, 6, 0), "bust");
}

console.log("\nthe EOD daily loss limit ends the day, not the account");
{
  const a = acct({ drawdown: "EOD", dailyLossLimitUsd: 1_000 });
  sim.accountOpenDay(a);
  check("loss 1 ($49,520 low)", sim.accountTrade(a, -1, 0, -1), "open");
  check("loss 2 ($49,034 low)", sim.accountTrade(a, -1, 0, -1), "open");
  check("loss 3 reaches $49,000 first: liquidated", sim.accountTrade(a, -1, 0, -1), "dll");
  check("at exactly the limit", a.balance, 49_000);
  check("the account is still alive", a.outcome, null);
  check("nothing more today", sim.accountTrade(a, 1, 1, 0), "skipped");
  sim.accountCloseDay(a);
  sim.accountOpenDay(a);
  check("next session it trades again", sim.accountTrade(a, 1, 1, 0), "open");
  check("one DLL day counted", a.dllDays, 1);
  check("Intraday has no DLL to hit", acct().params.dailyLossLimitUsd, null);

  // When the day's limit sits ON the threshold, the touch is a bust.
  const tie = acct({ drawdown: "EOD", dailyLossLimitUsd: 1_000, dollarsPerR: 1_000, commissionUsd: 0 });
  sim.accountOpenDay(tie);
  check("day 1: −$1,000 is a DLL lock", sim.accountTrade(tie, -1, 0, -1), "dll");
  sim.accountCloseDay(tie);
  sim.accountOpenDay(tie);
  check("day 2: DLL level = threshold = $48,000 — bust, not lock", sim.accountTrade(tie, -1, 0, -1), "bust");
}

console.log("\neach product moves its threshold on its own clock");
{
  const eod = acct({ drawdown: "EOD", dailyLossLimitUsd: 1_000 });
  sim.accountOpenDay(eod);
  sim.accountTrade(eod, 2, 2, 0);
  check("EOD: an intraday high does not move it", eod.threshold, 48_000);
  sim.accountCloseDay(eod);
  check("EOD: the close does ($50,954 − $2,000)", eod.threshold, 48_954);
  const intra = acct();
  sim.accountOpenDay(intra);
  sim.accountTrade(intra, 2, 2, 0);
  check("Intraday: the open peak moves it ($50,960 − $2,000)", intra.threshold, 48_960);
}

console.log("\ncontracts refuse above the cap and below one");
{
  const r50 = sim.apexRulesFor(50_000);
  const over = sim.apexContracts(r50, "MNQ", 5_000, 40);
  check("62 MNQ is over the 60-micro cap", over.ok, false);
  check("and says so", /cap of 60 micros/.test(over.refusal), true);
  check("60 MNQ is allowed", sim.apexContracts(r50, "MNQ", 4_800, 40).contracts, 60);
  const under = sim.apexContracts(r50, "MNQ", 50, 40);
  check("$50 buys no MNQ at 40 pt", under.ok, false);
  check("never rounded up to 1", under.contracts, 0);
  const es = sim.apexContracts(r50, "ES", 200, 8);
  check("$200 buys no ES at 8 pt ($400 each)", es.ok, false);
  check("and points at MES", /MES/.test(es.refusal), true);
  check("7 ES is over the 6-mini cap", sim.apexContracts(r50, "ES", 2_800, 8).ok, false);
  const two = sim.apexContracts(r50, "MNQ", 200, 40);
  check("$200 at 40 pt MNQ = 2 contracts", two.contracts, 2);
  check("1R is what the stop costs ($160), not what was typed", two.riskUsd, 160);
  check("round-turn commission $1 × 2", two.commissionUsd, 2);
  const refused = sim.runApexSim({ ...sim.defaultSimInput(dist.perWeek), symbol: "ES", stopPts: 8, riskUsd: 200 }, dist);
  check("the simulator refuses rather than runs a trade it cannot size", refused.ok, false);
  check("a 100K row labels its cap unconfirmed", /unconfirmed/.test(sim.apexContracts(sim.apexRulesFor(100_000), "MNQ", 9_000, 40).refusal), true);
}

console.log("\nroom to liquidation");
{
  // start 50,000 · peak 50,800 Intraday → threshold 48,800 · balance 50,200 → room 1,400.
  const base = { phase: "evaluation", drawdown: "Intraday", size: 50_000, balanceUsd: 50_200, peakUsd: 50_800, symbol: "MNQ", stopPts: 40 };
  const r = sim.roomToLiquidation(base);
  check("threshold = peak − $2,000", r.thresholdUsd, 48_800);
  check("room = balance − threshold", r.roomUsd, 1_400);
  check("buffer = 25% of the $2,000 drawdown", r.bufferUsd, 500);
  check("riskable = room − buffer", r.riskableUsd, 900);
  check("MNQ at 40 pt ($80): 11 contracts keep the buffer", r.maxContracts, 11);
  check("bound by the buffer", r.boundBy, "buffer");
  check(`the house size (score.ts, ${MAX_ROOM_FRACTION_PER_TRADE * 100}% of room) is 3`, r.houseContracts, 3);
  check("Intraday eval: no DLL", r.dll.applies, false);
  check("no refusal", r.refusal, null);
  const legacy = derivePropAccount(
    { phase: "evaluation", sizeUsd: 50_000, balanceUsd: 50_200, peakUsd: 50_800, daysTraded: 0, history: [], updatedAt: 0 },
    rulesFor("Apex", "evaluation", 50_000),
  );
  check("agrees with account.ts's room for the same account", r.roomUsd, legacy.roomUsd);

  const eod = sim.roomToLiquidation({ ...base, drawdown: "EOD" });
  check("EOD eval: the DLL applies", eod.dll.applies, true);
  check("at $1,000", eod.dll.amountUsd, 1_000);

  const locked = sim.roomToLiquidation({ ...base, phase: "pa", peakUsd: 52_100, balanceUsd: 51_000 });
  check("PA: peak $52,100 locks the threshold at $50,100", locked.thresholdUsd, 50_100);
  check("and says it is locked", locked.locked, true);
  check("room $900", locked.roomUsd, 900);
  const notYet = sim.roomToLiquidation({ ...base, phase: "pa", peakUsd: 52_099, balanceUsd: 51_000 });
  check("a dollar short of the trigger it still trails", [notYet.thresholdUsd, notYet.locked], [50_099, false]);
  check("the 50K Intraday PA DLL comes from rules.ts", locked.dll.amountUsd, rulesFor("Apex", "funded", 50_000).dailyLossLimitUsd);
  check("a PA row nobody has cited says unknown", sim.roomToLiquidation({ ...base, phase: "pa", drawdown: "EOD" }).dll.applies, null);

  const entered = sim.roomToLiquidation({ ...base, thresholdUsd: 49_000 });
  check("an entered threshold wins over the peak", [entered.thresholdUsd, entered.thresholdSource], [49_000, "entered"]);
  const fresh = sim.roomToLiquidation({ ...base, peakUsd: null, balanceUsd: 50_000 });
  check("no peak: a fresh account's threshold", [fresh.thresholdUsd, fresh.thresholdSource], [48_000, "start"]);
  const dead = sim.roomToLiquidation({ ...base, balanceUsd: 48_700 });
  check("at/below the threshold: refused, zero size", [dead.refusal != null, dead.maxContracts], [true, 0]);
  const typo = sim.roomToLiquidation({ ...base, balanceUsd: 51_000 });
  check("an Intraday peak below the balance is a typo, refused", typo.refusal != null, true);
  const thin = sim.roomToLiquidation({ ...base, balanceUsd: 49_300, peakUsd: 50_800, symbol: "ES", stopPts: 8 });
  check("room $500 all inside the buffer: no ES fits", [thin.maxContracts, thin.refusal != null], [0, true]);
  const capped = sim.roomToLiquidation({ ...base, balanceUsd: 52_000, peakUsd: 52_000, stopPts: 10 });
  check("a tiny stop is capped at 60 micros", [capped.maxContracts, capped.boundBy], [60, "account-cap"]);
}

console.log("\nthe panel's defaults and its honesty line");
{
  const d = sim.defaultSimInput(dist.perWeek);
  check("trades/week = the evidence's 6.4 clamped into 2–6", d.tradesPerWeek, 6);
  check("the daily cap is the desk's own per-killzone max", d.maxTradesPerDay, APLUS_RULES.maxSetupsPerSession);
  check("$200 risk, MNQ at 40 pt, 30 days, 5,000 paths", [d.riskUsd, d.symbol, d.stopPts, d.horizonDays, d.paths], [200, "MNQ", 40, 30, 5_000]);
  check("30 calendar days = 21 sessions", sim.sessionsInHorizon(30), 21);
  const line = sim.simHonestyLine();
  const inBand = EVIDENCE.inBand.find((b) => b.key === "in");
  check("the line says it is not a forecast", /not a forecast/.test(line), true);
  check("and carries the pack's own verdict word", line.includes(inBand.verdict.toUpperCase()), true);
  if (inBand.verdict === "mixed") check("a MIXED band reads as indistinguishable from zero", /not distinguishable from zero/.test(line), true);
  const res = sim.runApexSim(d, dist);
  check("the default run is rate-limited and says so", res.ok && res.warnings.some((w) => /most it supplies/.test(w)), true);
  check("caveats name the pre-NY share", res.ok && sim.simCaveats(res).some((c) => /before 09:00 ET/.test(c)), true);
  near("the pool's mean is every in-band card's mean", sim.buildDayPool(dist).meanR, dist.r.reduce((a, x) => a + x, 0) / dist.n, 1e-12);
  const capped = sim.runApexSim({ ...d, tradesPerWeek: 3 }, dist);
  const shifted = Math.abs(capped.strategy.meanGrossR - capped.pool.meanR) >= 0.005;
  check(
    "when the cap moves the mean, the caveats say it is an untested cut",
    sim.simCaveats(capped).some((c) => /untested|Nothing has tested/.test(c)),
    shifted,
  );
  const open = sim.runApexSim({ ...d, tradesPerWeek: 3, maxTradesPerDay: null }, dist);
  check("uncapped, there is no such line", sim.simCaveats(open).some((c) => /Nothing has tested/.test(c)), false);
}

console.log("\nit fits the panel's budget");
{
  const t0 = performance.now();
  const res = sim.runApexSim({ ...sim.defaultSimInput(dist.perWeek), tradesPerWeek: 3 }, dist);
  const ms = performance.now() - t0;
  console.log(`       (5,000 paths, strategy + control: ${ms.toFixed(0)} ms)`);
  check("5,000 paths × both arms finish well inside a second", res.ok && ms < 1_500, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
