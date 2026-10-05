/**
 * The goal planner (src/lib/room/goal.ts) against its contract.
 *
 *   npx tsx scripts/verify-goal.mjs
 *
 * WHY: the trader's goal is $1,000 → $5,000 of live options in one to two weeks, and the five are asked to plan it
 * together. A plan that says "62% chance" off a Monte Carlo seed, or that forgets that one stopped contract already
 * breaches the weekly halt, is a story and not a plan. So every number the planner prints is checked here:
 *
 *   - the calendar: window dates skip weekends, the clock counts sessions left and ends today's entries at 11:00 ET;
 *   - the odds are EXACT: the dynamic programme is compared with an independent path-by-path enumeration written
 *     from the model's definition (no merging, factorial Poisson), to 1e-12, over many random configurations that
 *     include the daily and weekly halts, week breaks, partly spent days and weeks, the ticket budget and contract
 *     granularity; probabilities sum to 1;
 *   - the model's numbers are the desk's measured ones (room-ev-test.json, evidence-dist.json, room-time-odds.json),
 *     and the win size reproduces the measured mean, so a negative edge cannot hide inside a generous win;
 *   - monotonicity where it must hold, Kelly's stake, contract granularity, the straight-line "wins in a row";
 *   - the "what would have to be true" solver returns an input that reaches the chance it was asked for, and not one
 *     step below it;
 *   - the collisions are the desk's real ones, with the arithmetic and the trader-owned number, and no collision is
 *     reported that the numbers do not support.
 *
 * Pure: no network, no real clock, no model.
 */
const G = await import("../src/lib/room/goal.ts");
const { ROOM_MANDATE, ROOM_CLOCK } = await import("../src/lib/room/mandate.ts");
const { LIVE_EVIDENCE, EXEC_FLAGS } = await import("../src/lib/room/exec/limits.ts");
const { APLUS_RULES } = await import("../src/lib/aplus/config.ts");
const { PATH_MONTH_CAP } = await import("../src/lib/trading/profit-rules.ts");
const { MAX_DEBIT_USD } = await import("../src/lib/trading/sleeve-sizing.ts");
const fs = await import("node:fs");
const ROOM_EV = JSON.parse(fs.readFileSync(new URL("../src/data/room-ev-test.json", import.meta.url), "utf8"));
const EVID = JSON.parse(fs.readFileSync(new URL("../src/data/evidence-dist.json", import.meta.url), "utf8"));
const TIMES = JSON.parse(fs.readFileSync(new URL("../src/data/room-time-odds.json", import.meta.url), "utf8"));

let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` — ${detail}`}`);
};
const near = (a, b, tol = 1e-12) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(a), Math.abs(b));
const at = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h + 4, mi); // ET (EDT) wall → epoch

/* ── The calendar ──────────────────────────────────────────────────────── */
console.log("calendar");
{
  check("a Saturday start rolls to Monday", G.weekdayOnOrAfter("2026-10-10") === "2026-10-12", G.weekdayOnOrAfter("2026-10-10"));
  check("a weekday stays", G.weekdayOnOrAfter("2026-10-07") === "2026-10-07");
  const ten = G.tradingDates("2026-10-05", 10);
  check("ten sessions from Monday skip the weekend", JSON.stringify(ten) === JSON.stringify(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16"]), ten.join());
  check("week breaks fall on the Monday", JSON.stringify(G.weekBreaksOf(ten)) === JSON.stringify([false, false, false, false, false, true, false, false, false, false]));
  check("week breaks from midweek", JSON.stringify(G.weekBreaksOf(["2026-10-08", "2026-10-09", "2026-10-12"])) === JSON.stringify([false, false, true]));

  const spec = { version: 1, start: 1000, target: 5000, startDate: "2026-10-05", tradingDays: 10, floorFrac: 0.5, capFrac: 0.1, mode: "rehearsal" };
  const c = (ms) => G.goalClock(spec, ms);
  const mon0940 = c(at(2026, 10, 5, 9, 40));
  check("Monday 09:40 is day 1 with ten sessions to buy in", mon0940.state === "running" && mon0940.day === 1 && mon0940.daysLeft === 10 && !mon0940.entriesOver, JSON.stringify(mon0940));
  const mon1100 = c(at(2026, 10, 5, 11, 0));
  check("at 11:00 ET today's entries are over", mon1100.entriesOver && mon1100.daysLeft === 9 && mon1100.remaining[0] === "2026-10-06", JSON.stringify(mon1100));
  const mon1059 = c(at(2026, 10, 5, 10, 59));
  check("10:59 still counts today", !mon1059.entriesOver && mon1059.daysLeft === 10);
  const sat = c(at(2026, 10, 10, 10, 0));
  check("Saturday: running, no entries today, five left", sat.state === "running" && sat.entriesOver && sat.daysLeft === 5 && sat.remaining[0] === "2026-10-12", JSON.stringify(sat));
  const before = G.goalClock({ ...spec, startDate: "2026-10-12" }, at(2026, 10, 7, 9, 40));
  check("before the window: state before, all sessions ahead", before.state === "before" && before.daysLeft === 10 && before.day === 0);
  const lastDay = c(at(2026, 10, 16, 11, 30));
  check("last day after 11:00: running, nothing left to buy", lastDay.state === "running" && lastDay.daysLeft === 0 && lastDay.day === 10, JSON.stringify(lastDay));
  const past = c(at(2026, 10, 19, 9, 40));
  check("after the deadline: past", past.state === "past" && past.daysLeft === 0);

  check("asGoal accepts a good spec", G.asGoal(spec) != null);
  check("asGoal refuses a target below the start", G.asGoal({ ...spec, target: 900 }) == null);
  check("asGoal refuses a ticket share of 0 or above 100%", G.asGoal({ ...spec, capFrac: 0 }) == null && G.asGoal({ ...spec, capFrac: 1.5 }) == null);
  check("asGoal refuses a bad date and a bad mode", G.asGoal({ ...spec, startDate: "10/5/2026" }) == null && G.asGoal({ ...spec, mode: "yolo" }) == null);
  const def = G.defaultGoal(at(2026, 10, 10, 12, 0));
  check("the default goal is $1,000 → $5,000 over ten sessions starting the next weekday, ticket share = the room mandate", def.start === 1000 && def.target === 5000 && def.tradingDays === 10 && def.startDate === "2026-10-12" && def.capFrac === ROOM_MANDATE.maxCashFracPerTrade && def.mode === "rehearsal", JSON.stringify(def));
}

/* ── The path ──────────────────────────────────────────────────────────── */
console.log("the path");
{
  const spec = { version: 1, start: 1000, target: 5000, startDate: "2026-10-05", tradingDays: 10, floorFrac: 0.5, capFrac: 0.1, mode: "rehearsal" };
  const now = at(2026, 10, 5, 9, 40);
  const r = G.readGoal(spec, 1000, now);
  check("the ladder is geometric and ends at the target", r.ladder.length === 10 && near(r.ladder[9].equity, 5000, 1e-9) && near(r.ladder[0].equity, 1000 * Math.pow(5, 0.1), 1e-12));
  check("day one asks the first rung of the ladder", near(r.pathToday, 1000 * Math.pow(5, 0.1), 1e-12));
  check("compounded need per session = 5^(1/10) − 1", near(r.perSessionNeeded, Math.pow(5, 0.1) - 1, 1e-12), String(r.perSessionNeeded));
  check("straight-line need per session = $400", near(r.perSessionUsd, 400, 1e-12));
  check("floor is half the start", r.floor === 500);
  check("multiple needed is 5×", near(r.multipleNeeded, 5, 1e-12));
  check("on the ladder's first rung is 'on path'", G.readGoal(spec, r.pathToday, now).pace.label === "on path");
  check("far under the rung is 'behind', far over is 'ahead'", G.readGoal(spec, 900, now).pace.label === "behind" && G.readGoal(spec, 1500, now).pace.label === "ahead");
  check("status: hit at the target", G.readGoal(spec, 5000, now).status === "hit");
  check("status: floor at the floor", G.readGoal(spec, 500, now).status === "floor");
  check("status: running mid-window", G.readGoal(spec, 1000, now).status === "running");
  check("status: before the window", G.readGoal({ ...spec, startDate: "2026-10-12" }, 1000, now).status === "before");
  check("status: expired after the deadline", G.readGoal(spec, 1000, at(2026, 10, 19, 9, 40)).status === "expired");
}

/* ── The model's numbers are the desk's measured ones ──────────────────── */
console.log("the reference model");
{
  const m = G.referenceModel();
  const row = ROOM_EV.results.find((r) => r.pop === "nyam" && r.vix === 18 && r.dte === 1 && r.half === "all");
  check("win rate, mean and n are the measured row", m.pWin === row.all.winRate && m.meanPct === row.all.meanPctPremium && m.n === row.all.n, JSON.stringify(m));
  check("loss size is the mandate's backstop", m.lossPct === Math.abs(ROOM_MANDATE.hardStopPct) / 100 && m.lossPct === 0.2, String(m.lossPct));
  check("the win size reproduces the measured mean (a negative edge cannot hide in a generous win)", near(m.pWin * m.winPct - (1 - m.pWin) * m.lossPct, m.meanPct, 1e-12), `${m.pWin * m.winPct - (1 - m.pWin) * m.lossPct} vs ${m.meanPct}`);
  check("the measured mean is negative", m.meanPct < 0);
  const o = G.opportunityRate();
  check("opportunities per session = perWeek × NY AM share ÷ 5, from the data files", near(o.perSession, (EVID.perWeek * (TIMES.population.nyAmFills / TIMES.population.fills)) / 5, 1e-12), String(o.perSession));
  check("that is about one qualifying ticket in five sessions", o.perSession > 0.15 && o.perSession < 0.25, String(o.perSession));
  check("Kelly stakes nothing on the measured edge", G.kellyFrac(m) === 0);
  check("Kelly on a positive edge: p=.5, W=1, L=.5 → 50%", near(G.kellyFrac({ pWin: 0.5, winPct: 1, lossPct: 0.5, meanPct: 0.25, n: null, source: "t" }), 0.5, 1e-12));
  const mm = G.modelFromMean(0.4, 0.2, 0.05, 10, "t");
  check("modelFromMean: p=.4, L=.2, mean .05 → W = (.05 + .6×.2)/.4 = .425", near(mm.winPct, 0.425, 1e-12), String(mm.winPct));
}

/* ── Contract granularity ──────────────────────────────────────────────── */
console.log("contracts");
{
  check("$100 buys no $371 contract", G.contractsFor(1000, 371, 0.1, 1000) === 0);
  check("40% of $1,000 buys one", G.contractsFor(1000, 371, 0.4, 1000) === 1);
  check("100% of $1,000 buys two", G.contractsFor(1000, 371, 1, 1000) === 2);
  check("the $1,000 ceiling binds at $5,000", G.contractsFor(5000, 371, 1, 1000) === 2);
  check("no ceiling: 100% of $5,000 buys thirteen", G.contractsFor(5000, 371, 1, Infinity) === 13);
  check("zero equity buys nothing", G.contractsFor(0, 371, 1, 1000) === 0);
  check("an exact fit buys one (float fuzz does not lose it)", G.contractsFor(1000, 100, 0.1, 1000) === 1);
  check("arrivals: Poisson with the tail folded into the cap", (() => {
    const pm = G.arrivalPmf(0.5, 2);
    const e = Math.exp(-0.5);
    return pm.length === 3 && near(pm[0], e) && near(pm[1], e * 0.5) && near(pm[2], 1 - e - e * 0.5) && near(pm.reduce((a, b) => a + b, 0), 1);
  })());
}

/* ── Exact odds: the DP against an independent enumeration ─────────────── */
console.log("exact odds");

/** Written from the definition, not from the DP: every path, no merging, factorial Poisson. */
function brute(i) {
  const W = i.model.winPct;
  const L = i.model.lossPct;
  const pois = (k) => Math.exp(-i.lambda) * Math.pow(i.lambda, k) / fact(k);
  const fact = (n) => (n <= 1 ? 1 : n * fact(n - 1));
  const cts = (eq) => {
    if (!(eq > 0)) return 0;
    const byFrac = Math.floor((i.policy.frac * eq + 1e-9) / i.contractUsd);
    const byCeil = Math.floor((i.maxDebitUsd + 1e-9) / i.contractUsd);
    return Math.max(0, Math.min(byFrac, byCeil));
  };
  const terminal = []; // { eq, p, kind, used }
  let expectedTrades = 0;
  function startDay(d, eq, used, wk, p) {
    if (d === i.days) {
      terminal.push({ eq, p, kind: "between", used });
      return;
    }
    if (d > 0 && i.weekBreaks && i.weekBreaks[d]) wk = eq;
    const dayNet0 = d === 0 ? i.dayNet0 ?? 0 : 0;
    const dayStart = eq - dayNet0;
    const halted = (e, dn) => dn <= -i.policy.dayHaltFrac * dayStart + 1e-9 || e - wk <= -i.policy.weekHaltFrac * wk + 1e-9;
    const left = Math.min(i.policy.perDay, Math.max(0, i.tradeBudget - used));
    if (left <= 0 || halted(eq, dayNet0) || cts(eq) < 1) return startDay(d + 1, eq, used, wk, p);
    let acc = 0;
    for (let k = 0; k <= left; k++) {
      let pk;
      if (k < left) {
        pk = pois(k);
        acc += pk;
      } else pk = Math.max(0, 1 - acc);
      if (pk * p < 1e-15) continue;
      tickets(d, eq, used, wk, p * pk, k, dayNet0, dayStart);
    }
  }
  function tickets(d, eq, used, wk, p, remaining, dayNet, dayStart) {
    if (remaining === 0) return startDay(d + 1, eq, used, wk, p);
    const c = cts(eq);
    if (c < 1) return startDay(d + 1, eq, used, wk, p);
    const debit = c * i.contractUsd;
    expectedTrades += p;
    for (const win of [true, false]) {
      const pr = p * (win ? i.model.pWin : 1 - i.model.pWin);
      if (pr < 1e-15) continue;
      const delta = win ? debit * W : -debit * L;
      const e2 = eq + delta;
      const u2 = used + 1;
      if (e2 >= i.target) {
        terminal.push({ eq: e2, p: pr, kind: "target", used: u2 });
        continue;
      }
      if (e2 <= i.floor) {
        terminal.push({ eq: e2, p: pr, kind: "floor", used: u2 });
        continue;
      }
      const dn = dayNet + delta;
      const hl = dn <= -i.policy.dayHaltFrac * dayStart + 1e-9 || e2 - wk <= -i.policy.weekHaltFrac * wk + 1e-9;
      if (hl || u2 >= i.tradeBudget) {
        startDay(d + 1, e2, u2, wk, pr);
        continue;
      }
      tickets(d, e2, u2, wk, pr, remaining - 1, dn, dayStart);
    }
  }
  const wk0 = i.equity - (i.weekNet0 ?? 0);
  if (i.equity >= i.target) return { pTarget: 1, pFloor: 0 };
  if (i.equity <= i.floor) return { pTarget: 0, pFloor: 1 };
  startDay(0, i.equity, 0, wk0, 1);
  const sum = (f) => terminal.filter(f).reduce((a, t) => a + t.p, 0);
  const sorted = [...terminal].sort((a, b) => a.eq - b.eq);
  const quant = (q) => {
    let acc = 0;
    for (const t of sorted) {
      acc += t.p;
      if (acc >= q - 1e-12) return t.eq;
    }
    return sorted[sorted.length - 1].eq;
  };
  return {
    pTarget: sum((t) => t.kind === "target"),
    pFloor: sum((t) => t.kind === "floor"),
    pBetween: sum((t) => t.kind === "between"),
    pNoTrade: sum((t) => t.kind === "between" && t.used === 0),
    expectedEnd: terminal.reduce((a, t) => a + t.eq * t.p, 0),
    expectedTrades,
    p10: quant(0.1),
    p50: quant(0.5),
    p90: quant(0.9),
    paths: terminal.length,
  };
}

/** A small deterministic generator, so the same configurations run every time. */
let seed = 20261005;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const pickOf = (arr) => arr[Math.floor(rnd() * arr.length)];

{
  let worst = 0;
  let worstKey = "";
  let configs = 0;
  let pathsTotal = 0;
  let haltCases = 0;
  let weekCases = 0;
  let partCases = 0;
  for (let n = 0; n < 60; n++) {
    const days = 1 + Math.floor(rnd() * 5);
    const weekBreaks = Array.from({ length: days }, (_, d) => d > 0 && rnd() < 0.3);
    const equity = pickOf([1000, 1000, 1250, 800, 2000]);
    const contractUsd = pickOf([60, 90, 120, 250, 371]);
    const pWin = pickOf([0.2, 0.315, 0.45, 0.6]);
    const lossPct = pickOf([0.2, 0.3, 0.5]);
    const winPct = pickOf([0.37, 0.8, 1.5]);
    const model = { pWin, winPct, lossPct, meanPct: pWin * winPct - (1 - pWin) * lossPct, n: null, source: "t" };
    const tight = rnd() < 0.5;
    const policy = {
      frac: pickOf([0.1, 0.25, 0.4, 0.7, 1]),
      perDay: pickOf([1, 2, 3]),
      dayHaltFrac: tight ? 0.02 : pickOf([0.05, 0.1, 1e9]),
      weekHaltFrac: tight ? 0.05 : pickOf([0.08, 0.2, 1e9]),
    };
    const input = {
      equity,
      target: pickOf([1500, 2500, 5000]),
      floor: pickOf([0, 400, 500]),
      days,
      model,
      policy,
      contractUsd,
      maxDebitUsd: pickOf([300, 1000, 1e9]),
      lambda: pickOf([0.2, 0.7, 1.5, 3]),
      tradeBudget: 1 + Math.floor(rnd() * 6),
      weekBreaks,
      dayNet0: rnd() < 0.3 ? pickOf([-15, 20, -45]) : 0,
      weekNet0: rnd() < 0.3 ? pickOf([-30, 40, -80]) : 0,
    };
    const a = G.goalDp(input);
    const b = brute(input);
    configs++;
    pathsTotal += b.paths ?? 0;
    if (b.paths == null) continue;
    if (policy.dayHaltFrac < 1) haltCases++;
    if (weekBreaks.some(Boolean)) weekCases++;
    if (input.dayNet0 || input.weekNet0) partCases++;
    for (const k of ["pTarget", "pFloor", "pBetween", "pNoTrade", "expectedEnd", "expectedTrades", "p10", "p50", "p90"]) {
      const d = Math.abs(a[k] - b[k]) / Math.max(1, Math.abs(b[k]));
      if (d > worst) {
        worst = d;
        worstKey = `${k} config ${n}: dp ${a[k]} vs brute ${b[k]}`;
      }
    }
    const tot = a.pTarget + a.pFloor + a.pBetween;
    if (Math.abs(tot - 1) > 1e-12) {
      worst = Math.max(worst, Math.abs(tot - 1));
      worstKey = `probabilities sum to ${tot} on config ${n}`;
    }
  }
  check(`DP equals the path enumeration to 1e-12 over ${configs} configurations (${pathsTotal} terminal paths)`, worst <= 1e-12, `${worst.toExponential(2)} — ${worstKey}`);
  check("the sample exercised halts, week breaks and part-spent days/weeks", haltCases >= 10 && weekCases >= 10 && partCases >= 8, `halts ${haltCases} weeks ${weekCases} part ${partCases}`);
}

{
  // Hand-checkable cases.
  const base = {
    equity: 1000,
    target: 5000,
    floor: 500,
    days: 1,
    model: { pWin: 0.5, winPct: 1, lossPct: 0.5, meanPct: 0.25, n: null, source: "t" },
    policy: { frac: 0.1, perDay: 1, dayHaltFrac: 1e9, weekHaltFrac: 1e9 },
    contractUsd: 100,
    maxDebitUsd: 1000,
    lambda: 1e6, // a ticket for certain (the pmf folds the whole tail into the cap)
    tradeBudget: 5,
  };
  const one = G.goalDp(base);
  check("one certain ticket, 1 contract, win +100 / lose −50: E[end] = 1025", near(one.expectedEnd, 1025, 1e-9), String(one.expectedEnd));
  check("…and exactly one trade is taken", near(one.expectedTrades, 1, 1e-9));
  check("…the median is the lower outcome at p = .5", one.p50 === 950 && one.p90 === 1100 && one.p10 === 950, `${one.p10} ${one.p50} ${one.p90}`);
  const lose = G.goalDp({ ...base, equity: 1000, floor: 960, model: { ...base.model, lossPct: 0.5 } });
  check("a loss that reaches the floor is a floor path (950 ≤ 960), with p = .5", near(lose.pFloor, 0.5, 1e-12) && near(lose.pTarget, 0), JSON.stringify(lose));
  const win = G.goalDp({ ...base, target: 1100 });
  check("a win that reaches the target is a target path with p = .5", near(win.pTarget, 0.5, 1e-12));
  const noBuy = G.goalDp({ ...base, policy: { ...base.policy, frac: 0.05 } });
  check("a cap that cannot buy one contract takes no ticket, ends where it began, pNoTrade = 1", noBuy.expectedTrades === 0 && near(noBuy.pNoTrade, 1) && noBuy.p50 === 1000 && noBuy.contractsNow === 0);
  const done = G.goalDp({ ...base, equity: 5200 });
  check("already past the target: pTarget 1", done.pTarget === 1 && done.pFloor === 0);
  const bust = G.goalDp({ ...base, equity: 400 });
  check("already under the floor: pFloor 1", bust.pFloor === 1 && bust.pTarget === 0);
  const halted = G.goalDp({ ...base, days: 2, policy: { ...base.policy, perDay: 3, dayHaltFrac: 0.03, weekHaltFrac: 1e9 }, lambda: 1e6, tradeBudget: 9 });
  // day one: 3 tickets for certain; a first-ticket loss (−50 = 5% ≥ 3%) halts the day.
  check("a loss past the daily halt ends the session (fewer than 6 trades over two days)", halted.expectedTrades < 6 && halted.expectedTrades > 2, String(halted.expectedTrades));
  // A 15% ticket share buys one $100 contract at $950, $1,000 and $1,100 alike, so the only difference is the halt.
  const weekHalt = (days, breaks) =>
    G.goalDp({ ...base, days, policy: { ...base.policy, frac: 0.15, perDay: 1, dayHaltFrac: 1e9, weekHaltFrac: 0.04 }, lambda: 1e6, tradeBudget: 9, weekBreaks: breaks });
  const sameWeek = weekHalt(3, [false, false, false]);
  const newWeek = weekHalt(3, [false, true, false]);
  check("a loss past the weekly halt stops trading until the week rolls (same week: fewer trades than with a Monday in between)", sameWeek.expectedTrades < newWeek.expectedTrades, `${sameWeek.expectedTrades} vs ${newWeek.expectedTrades}`);
  const budget = G.goalDp({ ...base, days: 4, policy: { ...base.policy, perDay: 2 }, lambda: 1e6, tradeBudget: 3 });
  check("the ticket budget caps the window's trades", budget.expectedTrades <= 3 + 1e-9, String(budget.expectedTrades));
}

/* ── Monotonicity ──────────────────────────────────────────────────────── */
console.log("monotonicity");
{
  const mk = (over = {}) => ({
    equity: 1000,
    target: 3000,
    floor: 0,
    days: 6,
    model: { pWin: 0.5, winPct: 1, lossPct: 0.3, meanPct: 0.35, n: null, source: "t" },
    policy: { frac: 0.3, perDay: 2, dayHaltFrac: 1e9, weekHaltFrac: 1e9 },
    contractUsd: 60,
    maxDebitUsd: 1000,
    lambda: 1,
    tradeBudget: 12,
    ...over,
  });
  const p = (over) => G.goalDp(mk(over)).pTarget;
  const seq = (xs, f) => xs.map(f);
  const nonInc = (a) => a.every((x, i) => i === 0 || x <= a[i - 1] + 1e-12);
  const nonDec = (a) => a.every((x, i) => i === 0 || x >= a[i - 1] - 1e-12);
  check("higher target → no more likely", nonInc(seq([1500, 2000, 3000, 4000, 5000], (t) => p({ target: t }))));
  check("more sessions → no less likely", nonDec(seq([1, 2, 4, 6, 8], (d) => p({ days: d }))));
  check("more opportunities per session (positive edge) → no less likely", nonDec(seq([0.2, 0.5, 1, 2, 4], (l) => p({ lambda: l }))));
  check("a bigger win → no less likely", nonDec(seq([0.5, 0.8, 1, 1.5, 2], (w) => p({ model: { pWin: 0.5, winPct: w, lossPct: 0.3, meanPct: 0, n: null, source: "t" } }))));
  check("a higher win rate → no less likely", nonDec(seq([0.3, 0.4, 0.5, 0.6, 0.7], (x) => p({ model: { pWin: x, winPct: 1, lossPct: 0.3, meanPct: 0, n: null, source: "t" } }))));
  check("a larger floor-risk (higher loss size) → no more likely to hit", nonInc(seq([0.1, 0.2, 0.3, 0.5], (l) => p({ model: { pWin: 0.5, winPct: 1, lossPct: l, meanPct: 0, n: null, source: "t" } }))));
  check("more equity to start → no less likely", nonDec(seq([800, 1000, 1500, 2000], (e) => p({ equity: e }))));
  const sizes = seq([0.1, 0.2, 0.3, 0.5, 0.8], (f) => G.goalDp(mk({ policy: { frac: f, perDay: 2, dayHaltFrac: 1e9, weekHaltFrac: 1e9 } })).pTarget);
  check("with a positive edge and no halts, bigger tickets reach the target more often (the press is rational only then)", nonDec(sizes), sizes.join(" "));
  const neg = (f) => G.goalDp(mk({ model: { pWin: 0.315, winPct: 0.368, lossPct: 0.2, meanPct: -0.021, n: null, source: "t" }, policy: { frac: f, perDay: 2, dayHaltFrac: 1e9, weekHaltFrac: 1e9 } }));
  check("with the measured negative edge, the expected end is below the start at every size", [0.1, 0.4, 1].every((f) => neg(f).expectedEnd < 1000), [0.1, 0.4, 1].map((f) => neg(f).expectedEnd).join(" "));
}

/* ── The measured goal ─────────────────────────────────────────────────── */
console.log("the measured goal");
{
  const spec = { version: 1, start: 1000, target: 5000, startDate: "2026-10-05", tradingDays: 10, floorFrac: 0.5, capFrac: 0.1, mode: "rehearsal" };
  const now = at(2026, 10, 5, 9, 40);
  const view = (capFrac, contractUsd = 371, over = {}) =>
    G.viewGoal({ spec: { ...spec, capFrac }, equity: 1000, nowMs: now, contractUsd, cheapest: { usd: 290, name: "a one-strike-out contract" }, monthEntries: 0, atrUsdPerContract: 12, paperFills: 0, ...over });

  const v10 = view(0.1);
  check("at the room's 10% cap a $371 contract cannot be bought: nothing trades, every policy's pNoTrade is 1", v10.table.every((r) => r.out.contractsNow === 0 && near(r.out.pNoTrade, 1) && r.out.pTarget === 0), JSON.stringify(v10.table.map((r) => r.out.contractsNow)));
  const cvc = v10.collisions.find((c) => c.id === "cap_vs_contract");
  check("…and the first collision is that blocker, naming the arithmetic and the 38% the trader would have to set", cvc && cvc.severity === "blocker" && v10.collisions[0].id === "cap_vs_contract" && /\$371/.test(cvc.detail) && /\$100/.test(cvc.detail) && /38%/.test(cvc.decision), JSON.stringify(cvc));
  check("…and it names the cheapest contract and that it is still over the cap", /one-strike-out contract/.test(cvc.detail) && /still over the cap/.test(cvc.detail));
  check("the room's mandate is still 10% (the goal does not change it)", ROOM_MANDATE.maxCashFracPerTrade === 0.1);

  const v40 = view(0.4);
  check("at a 40% ticket share one contract is bought", v40.table.find((r) => r.def.id === "mechanical").out.contractsNow === 1);
  check("no cap collision at 40%", !v40.collisions.some((c) => c.id === "cap_vs_contract"));
  const press = v40.table.find((r) => r.def.id === "press");
  check("on the measured numbers the goal is under one in a million (about two tickets in the window; the arithmetic cannot reach 5×)", press.out.pTarget < 1e-6, String(press.out.pTarget));
  check("the expected end is below the start (negative measured edge)", v40.table.every((r) => r.out.expectedEnd <= 1000 + 1e-9), JSON.stringify(v40.table.map((r) => r.out.expectedEnd)));
  check("expected tickets in the window ≈ λ × sessions", near(v40.expectedTickets, G.opportunityRate().perSession * 10, 1e-12));
  check("the model's chance of ZERO tickets in ten sessions is about 14%", (() => {
    const z = Math.exp(-G.opportunityRate().perSession * 10);
    return z > 0.13 && z < 0.15;
  })(), String(Math.exp(-G.opportunityRate().perSession * 10)));
  const ids = v40.collisions.map((c) => c.id);
  check("collisions at 40%: halt (day AND week), ceiling, frequency, edge, live gate", ["halt", "ceiling", "frequency", "edge", "live_gate"].every((x) => ids.includes(x)), ids.join());
  const halt = v40.collisions.find((c) => c.id === "halt");
  check("one stopped $371 ticket (−$74) breaches both the 2% day ($20) and the 5% week ($50)", halt.severity === "warn" && /and the week/.test(halt.title) && /\$74/.test(halt.detail) && /\$20/.test(halt.detail) && /\$50/.test(halt.detail), halt.detail);
  const frequency = v40.collisions.find((c) => c.id === "frequency");
  check("frequency is a blocker (fewer expected tickets than straight wins needed)", frequency.severity === "blocker", frequency.detail);
  const live = v40.collisions.find((c) => c.id === "live_gate");
  check("the live gate quotes the evidence rule and sessions at the measured rate", new RegExp(`${LIVE_EVIDENCE.minPaperFills} paper fills`).test(live.detail) && /103 sessions/.test(live.detail), live.detail);
  check("EXEC_FLAGS are still shut (a human flips them, not this module)", Object.values(EXEC_FLAGS).every((x) => x === false));
  check("blockers sort first", v40.collisions.map((c) => ({ blocker: 0, warn: 1, info: 2 })[c.severity]).every((x, i, a) => i === 0 || x >= a[i - 1]));
  check("a collision that touches a desk rule says the rule is not moved for the goal; the others hand the number to the trader", (() => {
    const h = v40.collisions.find((c) => c.id === "halt");
    const ce = v40.collisions.find((c) => c.id === "ceiling");
    return /not moved for the goal/.test(h.decision) && /not moved for the goal/.test(ce.decision) && v40.collisions.every((c) => c.decision == null || c.decision.length > 20);
  })(), v40.collisions.map((c) => c.decision).join(" | "));
  // The ceiling: wins in a row, with and without it.
  const w = (frac, ceil) => G.winsNeeded(1000, 5000, G.referenceModel(), frac, 371, ceil);
  let eq = 1000;
  let n = 0;
  const m = G.referenceModel();
  while (eq < 5000 && n < 100) {
    const c = Math.min(Math.floor((0.4 * eq + 1e-9) / 371), Math.floor((1000 + 1e-9) / 371));
    eq += c * 371 * m.winPct;
    n++;
  }
  check("straight wins to 5× at a 40% share under the $1,000 ceiling (independent loop)", w(0.4, 1000) === n, `${w(0.4, 1000)} vs ${n}`);
  check("the ceiling costs wins: fewer without it", w(0.4, Infinity) < w(0.4, 1000), `${w(0.4, Infinity)} vs ${w(0.4, 1000)}`);
  check("no contract bought → no answer", w(0.1, 1000) === null);
  check("MAX_DEBIT_USD is the sleeve's $1,000", MAX_DEBIT_USD === 1000 && ROOM_CLOCK.dayFlatMin === 660);
  check("the window's ticket budget is the lesser of two a session and the PATH month cap", G.tradeBudget(10, 0) === Math.min(APLUS_RULES.maxSetupsPerSession * 10, PATH_MONTH_CAP) && G.tradeBudget(3, 8) === 1 && G.tradeBudget(0, 0) === 0);
  check("the policies: five owners, one per person", G.POLICIES.map((p) => p.owner).sort().join() === ["Gemma", "Jax", "Nova", "Sterling", "Vince"].sort().join());
  check("Nova's Kelly stake is zero on the measured edge (so her seat buys nothing)", G.resolveFrac(G.policyOf("edge"), 0.4, G.referenceModel()) === 0);
  check("Jax presses to the cap; Vince sits at the cap; Sterling is under it", G.resolveFrac(G.policyOf("press"), 0.4, m) === 0.4 && G.resolveFrac(G.policyOf("mechanical"), 0.4, m) === 0.4 && G.resolveFrac(G.policyOf("protect"), 0.4, m) === 0.25);
}

/* ── What would have to be true ────────────────────────────────────────── */
console.log("what would have to be true");
{
  const spec = { version: 1, start: 1000, target: 5000, startDate: "2026-10-05", tradingDays: 10, floorFrac: 0.5, capFrac: 0.4, mode: "rehearsal" };
  const now = at(2026, 10, 5, 9, 40);
  const read = G.readGoal(spec, 1000, now);
  const ctx = G.planContext({ contractUsd: 120, capFrac: 0.4, daysLeft: read.clock.daysLeft, monthEntries: 0 });
  const nd = G.needed(read, ctx, 0.1);
  const press = { frac: 0.4, perDay: 2, dayHaltFrac: ctx.dayHaltFrac, weekHaltFrac: ctx.weekHaltFrac };
  const p = (over) => G.simFor(read, ctx, press, over).pTarget;
  check("pStar is echoed", nd.pStar === 0.1);
  if (nd.pWin != null) {
    const m = ctx.model;
    const at1 = p({ model: { ...m, pWin: nd.pWin, meanPct: nd.pWin * m.winPct - (1 - nd.pWin) * m.lossPct } });
    const below = p({ model: { ...m, pWin: nd.pWin - 0.002, meanPct: (nd.pWin - 0.002) * m.winPct - (1 - (nd.pWin - 0.002)) * m.lossPct } });
    check("the win rate the solver returns reaches 10%, and a hair below does not", at1 >= 0.1 - 1e-6 && below < 0.1 + 1e-6, `${at1} / ${below} at ${nd.pWin}`);
  } else check("no win rate below 98% reaches 10% (the solver says so)", p({ model: { ...ctx.model, pWin: 0.98 } }) < 0.1);
  if (nd.lambda != null) {
    const at1 = p({ lambda: nd.lambda });
    const below = p({ lambda: nd.lambda * 0.99 });
    check("the frequency the solver returns reaches 10%, a hair below does not", at1 >= 0.1 - 1e-6 && below < 0.1 + 1e-6, `${at1} / ${below} at ${nd.lambda}`);
    check("the multiple is that frequency over the measured one", near(nd.lambdaMultiple, nd.lambda / ctx.lambda, 1e-12));
  } else check("no frequency within 40× the measured rate reaches 10% (the solver says so)", p({ lambda: ctx.lambda * 40 }) < 0.1);
  if (nd.winPct != null) {
    const m = ctx.model;
    const at1 = p({ model: { ...m, winPct: nd.winPct, meanPct: m.pWin * nd.winPct - (1 - m.pWin) * m.lossPct } });
    check("the win size the solver returns reaches 10%", at1 >= 0.1 - 1e-6, `${at1} at ${nd.winPct}`);
  } else check("no win size within 500% reaches 10% (the solver says so)", p({ model: { ...ctx.model, winPct: 5 } }) < 0.1);
  check("the solver never claims a requirement below what is measured", (nd.pWin == null || nd.pWin >= ctx.model.pWin) && (nd.lambdaMultiple == null || nd.lambdaMultiple >= 1) && (nd.winPct == null || nd.winPct >= ctx.model.winPct));
  // An easy ask: pStar below what is already true returns the measured value itself.
  const easy = G.needed(G.readGoal({ ...spec, target: 1100 }, 1000, now), ctx, 0.0001);
  check("an ask the measured numbers already meet returns the measured numbers", easy.pWin != null && easy.pWin >= ctx.model.pWin && easy.pWin < ctx.model.pWin + 0.2);
}

/* ── Today ─────────────────────────────────────────────────────────────── */
console.log("today");
{
  const spec = { version: 1, start: 1000, target: 5000, startDate: "2026-10-05", tradingDays: 10, floorFrac: 0.5, capFrac: 0.4, mode: "rehearsal" };
  const now = at(2026, 10, 5, 9, 40);
  const v = G.viewGoal({ spec, equity: 1000, nowMs: now, contractUsd: 371, cheapest: null, monthEntries: 0, atrUsdPerContract: 20, paperFills: 3 });
  check("today asks the ladder's first rung", near(v.plan.needTodayUsd, 1000 * Math.pow(5, 0.1) - 1000, 1e-9), String(v.plan.needTodayUsd));
  check("max loss today is the daily halt (2% = $20), well inside the floor room", v.plan.maxLossUsd === 20);
  check("one contract, $371 debit; one ATR is worth $20 on it", v.plan.contracts === 1 && v.plan.debitUsd === 371 && v.plan.perAtrUsd === 20);
  check("ATRs needed = what today asks ÷ what an ATR pays", near(v.plan.atrsNeeded, (1000 * Math.pow(5, 0.1) - 1000) / 20, 1e-9));
  check("two tickets a day at most, and the paper-fill count is quoted", v.plan.maxTickets === 2 && /3 so far/.test(v.collisions.find((c) => c.id === "live_gate").detail));
  const v0 = G.viewGoal({ spec, equity: 1000, nowMs: now, contractUsd: 371, cheapest: null, monthEntries: 0, atrUsdPerContract: null, paperFills: null });
  check("no ATR read → no ATR arithmetic, never a made-up one", v0.plan.perAtrUsd === null && v0.plan.atrsNeeded === null);
  const t0 = performance.now();
  for (let i = 0; i < 5; i++) G.viewGoal({ spec, equity: 1000, nowMs: now, contractUsd: 371, cheapest: null, monthEntries: 0, atrUsdPerContract: 20, paperFills: 3 });
  const per = (performance.now() - t0) / 5;
  check("a full view (five policies, three solvers, collisions) computes in well under a second", per < 800, `${per.toFixed(0)} ms`);
  console.log(`      (view ${per.toFixed(0)} ms · DP states ${Math.max(...v.table.map((r) => r.out.states))})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
