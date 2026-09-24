/**
 * The desk, run as an account. Four years, real entries, real exits, $100,000.
 *
 *   npx tsx scripts/backtest-account.mjs [--sweep] [--top 25] [--oos 2025,2026]
 *
 * WHAT THIS IS
 * `capture-signals.mjs` already asked the desk what it saw at every one of
 * 93,830 bars and wrote the answers down. This script does the other half:
 * it takes those decisions, applies a SESSION policy, an EXIT policy and the
 * account's own risk rules, and compounds $100,000 through them bar by bar.
 * Nothing here re-grades the market. The desk's read is fixed input; what is
 * being tested is what you DO with it.
 *
 * WHY THE TWO ARE SPLIT
 * Because the honest version of "we tested different targets, stops,
 * breakevens and partials" is a few hundred combinations, and re-running the
 * engine for each would cost weeks. Split this way the sweep costs seconds
 * and can therefore be exhaustive instead of anecdotal.
 *
 * THE THING THIS SCRIPT IS MOST LIKELY TO GET WRONG, STATED UP FRONT
 * Searching a few hundred variants against four years and reporting the best
 * one is not a finding — it is the maximum of a few hundred noisy draws, and
 * it will look excellent no matter what the underlying edge is. So:
 *
 *   - variants are chosen on IN-SAMPLE years only and reported on HELD-OUT
 *     years they never touched;
 *   - the out-of-sample number is the headline, and the in-sample number is
 *     printed beside it so the shrinkage is visible;
 *   - the count of variants searched is printed, because it is the
 *     denominator of every "best" in this file.
 *
 * COSTS ARE REAL
 * Commission is charged per contract per side from CONTRACTS, on the entry,
 * on the partial and on the final exit. Stop exits are filled one tick worse
 * than the stop; limit exits are filled at the limit. A bar that spans both
 * the stop and the target is a stop. A limit that gaps through is filled at
 * the limit, never at the better open — the improvement is real but it
 * flatters, so it is discarded.
 *
 * WHAT IS NEVER SWEPT
 * The 0.65 confluence floor, the Judas window, the news blackout and the
 * $100,000 equity are inputs, not knobs. There is no variant in this file
 * that lowers any of them.
 */

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const argOf = (n, d) => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const SIGDIR = argOf("signals", ".cache/signals");
const OOS = String(argOf("oos", "2025,2026")).split(",").map(Number);
const TOP = Number(argOf("top", "20"));
const OUT = argOf("out", ".cache/backtest");
// Pin the exit rule instead of letting stage 1 choose it. Stage 1's winner is
// selected on in-sample P&L, and with r = -0.08 between in- and out-of-sample
// that selection is noise — so when the QUESTION is about gates rather than
// exits, letting a noisy exit vary underneath the comparison contaminates it.
// A pinned, defensible exit makes the gate column the only thing moving.
const PIN = argOf("exit", null);
const RISK = Number(argOf("risk", "0.02"));

const { APLUS_RULES, CONTRACTS, riskGradeFromScore, riskPctForGrade } = await import(
  "../src/lib/aplus/config.ts"
);
const { etWallParts, resolveKillzone } = await import("../src/lib/trading/sessions.ts");
// The live path refuses a stop wider than this per instrument
// (simulate-path-trade.ts MAX_RISK_PTS). A backtest that ignores the clamp is
// sizing trades the desk would never have placed.
const { MAX_RISK_PTS, DEFAULT_MAX_RISK_PTS } = await import(
  "../src/lib/trading/simulate-path-trade.ts"
);
const { shockScore: rawShock, volumeRatio: rawVolX, EVENT_SCORE_MIN, EVENT_VOL_MIN } = await import(
  "../src/lib/trading/session-event.ts"
);

/* ── Load ────────────────────────────────────────────────────────────────── */

const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

let rows = [];
let planMoments = 0;
let barsScanned = 0;
for (const f of readdirSync(SIGDIR).filter((f) => f.startsWith("signals-") && f.endsWith(".json"))) {
  const j = JSON.parse(readFileSync(`${SIGDIR}/${f}`, "utf8"));
  rows.push(...j.rows);
  planMoments += j.planMoments ?? 0;
  barsScanned += j.barsScanned ?? 0;
}
rows.sort((a, b) => a.t - b.t || (a.sym < b.sym ? -1 : 1));
if (!rows.length) {
  console.error(`no signals in ${SIGDIR} — run capture-signals.mjs first.`);
  process.exit(1);
}

const yearOf = (t) => new Date(t).getUTCFullYear();
const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};
const monthKey = (t) => dayKey(t).slice(0, 7);
const weekKey = (t) => {
  const d = new Date(t);
  const th = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3));
  return `${th.getUTCFullYear()}-W${String(Math.ceil(((th - Date.UTC(th.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7)).padStart(2, "0")}`;
};

/* ── ATR on demand, memoised per symbol+index ────────────────────────────── */
const atrCache = { MNQ: new Map(), ES: new Map() };
function atrAt(sym, end, n = 14) {
  const c = atrCache[sym];
  if (c.has(end)) return c.get(end);
  const bars = BARS[sym];
  let sum = 0;
  let k = 0;
  for (let i = Math.max(1, end - n + 1); i <= end; i++) {
    const b = bars[i];
    const p = bars[i - 1];
    sum += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    k++;
  }
  const v = k ? sum / k : 0;
  c.set(end, v);
  return v;
}

/* ── Admission: which captured moments count as a trade ──────────────────── */

/**
 * The clock-only refusal.
 *
 * This is the population the whole killzone question is about: the desk had
 * every must-layer it asks for — the draw, the raid, the dealing-range half,
 * the LTF shift, a priced target, the retrace — and the ONLY thing not
 * passing was what hour it happened to be. Those are the trades a session
 * rule is currently throwing away, and until now nobody had counted them.
 */
const clockOnly = (r) => r.fail.length === 0 && r.wait.length === 1 && r.wait[0] === "time";
const isTake = (r) => r.word === "TAKE";

/**
 * ARMED — every must-layer passes except the retrace, which is WAITING.
 *
 * This is the population the four-year scan says actually matters. Counting
 * sole blockers across 5,049 near-trade moments: retrace 278, sweep 220,
 * pd_half 155, target 93, time 23. The clock was the FIFTH most binding
 * constraint; the retrace is the first, by a wide margin.
 *
 * "Retrace waiting" does not mean the setup is absent. It means the array is
 * named and priced and price has not come back to it yet — which is precisely
 * the situation the desk's own entry rule was built for: rest a limit at
 * consequent encroachment and let it fill or not. `gate-tuning.ts armedIsTake`
 * is the shipped knob for this and it is currently OFF, so all 278 are
 * refused outright rather than rested.
 *
 * Admitting them here is not loosening the sequence — every other must-layer
 * still had to pass, and the simulator still requires price to REACH the limit
 * inside the fill window or the trade never happens.
 */
const armed = (r) => r.fail.length === 0 && r.wait.length === 1 && r.wait[0] === "retrace";

/**
 * A measured shock, read from the SAME function the live gate uses.
 *
 * Imported rather than reimplemented: a threshold justified by a measurement
 * that used a slightly different formula is a threshold justified by nothing,
 * and that drift is invisible until it costs money. `session-event.ts` owns
 * the definition; this file owns only the sweep over it.
 */
const shockScore = (r) => rawShock(BARS[r.sym], r.i);
const volX = (r) => rawVolX(BARS[r.sym], r.i);

const SESSIONS = {
  /** Exactly what ships today: the desk's trade window, clock as a must. */
  shipped: (r) => isTake(r),
  /** NY AM only — the window the trader actually sits. */
  nyam: (r) => isTake(r) && r.kz === "ny_am",
  /** Clock stops being a veto anywhere. The permissive extreme. */
  anyhour: (r) => isTake(r) || clockOnly(r),
  /** Clock is a veto UNLESS the bar is a measured shock. */
  shock15: (r) => isTake(r) || (clockOnly(r) && shockScore(r) >= 1.5),
  shock20: (r) => isTake(r) || (clockOnly(r) && shockScore(r) >= 2.0),
  shock25: (r) => isTake(r) || (clockOnly(r) && shockScore(r) >= 2.5),
  shock30: (r) => isTake(r) || (clockOnly(r) && shockScore(r) >= 3.0),
  /** Lunch reopened, dead zone still closed. */
  pluslunch: (r) => isTake(r) || (clockOnly(r) && r.kz === "ny_lunch"),
  /** The retrace rested rather than refused — gate-tuning's armedIsTake. */
  armed: (r) => isTake(r) || armed(r),

  /** Both of today's questions at once. */
  armedEvent: (r) => isTake(r) || armed(r) || (clockOnly(r) && shockScore(r) >= 2.0),
  armedAnyhour: (r) => isTake(r) || armed(r) || clockOnly(r),
};

/**
 * ONE GATE AT A TIME.
 *
 * The four-year scan named every layer that was the SOLE thing standing
 * between the desk and a trade: retrace 278, sweep 220, pd_half 155,
 * target 93, time 23, htf 9. `armed` already harvests the retrace. These
 * policies harvest each of the others, one at a time and then cumulatively,
 * so the cost of each relaxation is priced on its own rather than as part of
 * a bundle where a good one can carry a bad one.
 *
 * Nothing here weakens a layer's DEFINITION. A "sole blocker" row is one
 * where every other must-layer passed; admitting it means resting a limit and
 * letting the tape decide, exactly as `armed` does. The 0.65 floor, Judas and
 * the news blackout are still applied above, to every policy.
 */
const sole = (r, id) => r.fail.length + r.wait.length === 1 && [...r.fail, ...r.wait][0] === id;
for (const id of ["retrace", "sweep", "pd_half", "target", "htf", "ltf", "dol"]) {
  SESSIONS[`sole_${id}`] = (r) => isTake(r) || sole(r, id);
}
// Cumulative, cheapest-risk first: the retrace is a timing fact, the sweep and
// the dealing-range half are location facts, and htf is the one CLAUDE.md
// calls an absolute gate — so it is added last and reported separately.
SESSIONS.stack_retrace = (r) => isTake(r) || sole(r, "retrace");
SESSIONS.stack_sweep = (r) => isTake(r) || sole(r, "retrace") || sole(r, "sweep");
SESSIONS.stack_pd = (r) =>
  isTake(r) || sole(r, "retrace") || sole(r, "sweep") || sole(r, "pd_half");
SESSIONS.stack_target = (r) =>
  isTake(r) || sole(r, "retrace") || sole(r, "sweep") || sole(r, "pd_half") || sole(r, "target");
SESSIONS.stack_all = (r) => r.fail.length + r.wait.length <= 1;
// The same stack WITH the session-event clock release, which is the pairing
// the trader actually gets after today's changes.
SESSIONS.stack_pd_event = (r) =>
  SESSIONS.stack_pd(r) || (clockOnly(r) && shockScore(r) >= 1.5);
// Two must-layers missing — the permissive extreme, priced so the cliff is
// visible rather than assumed.
SESSIONS.stack_two = (r) => r.fail.length + r.wait.length <= 2;

// The (delivery x participation) grid the live thresholds come from. Added
// programmatically so the pair is swept rather than two numbers being picked
// and then defended.
for (const sc of [1.5, 2.0, 2.5, 3.0])
  for (const vx of [1.0, 1.25, 1.5, 2.0])
    SESSIONS[`ev${sc}v${vx}`] = (r) =>
      isTake(r) || (clockOnly(r) && shockScore(r) >= sc && volX(r) >= vx);

/* ── The exit simulator ──────────────────────────────────────────────────── */

/**
 * Walk the plan forward over real bars under one exit policy.
 *
 * Every branch here resolves ambiguity against the trade. A 15m bar cannot
 * say whether its high or its low printed first, and choosing the favourable
 * order is how a backtest silently collects win-rate it never earned.
 */
function runTrade(r, V) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const entry = r.e;
  const atr = atrAt(r.sym, r.i);

  // Stop.
  let stop = r.s;
  if (V.stopMode === "atr" && atr > 0) stop = long ? entry - V.stopAtr * atr : entry + V.stopAtr * atr;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  if (V.minRiskAtr && atr > 0 && risk < V.minRiskAtr * atr) return null;
  // Wider than the live path will place. Refused, not clamped: clamping would
  // invent a stop at a level the desk never derived from the tape.
  if (risk > (MAX_RISK_PTS?.[r.sym] ?? DEFAULT_MAX_RISK_PTS ?? 48)) return null;

  // Targets. `plan` uses the structural levels the desk priced; `r` uses
  // fixed multiples of the risk the stop actually defines.
  const sgn = long ? 1 : -1;
  let t1 = V.t1Mode === "plan" ? r.t1 : entry + sgn * V.t1R * risk;
  let t2 = V.t2Mode === "plan" ? r.t2 : V.t2R ? entry + sgn * V.t2R * risk : null;
  if (V.t1Mode === "plan" && t1 == null) return null;
  // A structural target behind price is not a target.
  if (t1 != null && (long ? t1 <= entry : t1 >= entry)) return null;
  if (t2 != null && (long ? t2 <= t1 : t2 >= t1)) t2 = null;
  const rr1 = Math.abs(t1 - entry) / risk;
  if (V.minRr && rr1 < V.minRr) return null;

  const tick = CONTRACTS[r.sym]?.tick ?? 0.25;
  const touch = (b, lvl, dir) => (dir === "above" ? b.h >= lvl : b.l <= lvl);

  // Fill: the limit rests at CE and needs the bar's range to reach it.
  let fi = null;
  for (let k = 1; k <= V.fillWindow && r.i + k < bars.length; k++) {
    const b = bars[r.i + k];
    if (touch(b, entry, long ? "below" : "above")) {
      fi = r.i + k;
      break;
    }
  }
  if (fi == null) return { filled: false, r: 0, legs: 0, bars: 0, reason: "unfilled" };

  let stopLvl = stop;
  let remaining = 1;
  let banked = 0;
  let t1Done = false;
  let legs = 1; // the entry side
  let ext = long ? bars[fi].h : bars[fi].l; // running favourable extreme, for the trail
  let mfe = 0;

  for (let k = fi; k < bars.length && k < fi + V.maxHold; k++) {
    const b = bars[k];
    ext = long ? Math.max(ext, b.h) : Math.min(ext, b.l);
    mfe = Math.max(mfe, (long ? ext - entry : entry - ext) / risk);

    // Breakeven, armed by R reached rather than by T1 alone.
    //
    // Armed on the bar AFTER the one that reached the trigger, never on the
    // same bar: within one 15m candle there is no way to know whether the
    // favourable extreme printed before or after the low that would have
    // taken the original stop, and crediting the move first is the classic
    // way a backtest converts losses into scratches for free.
    if (!t1Done && V.beAtR != null && k > fi) {
      const prev = bars[k - 1];
      const favour = (long ? prev.h - entry : entry - prev.l) / risk;
      if (favour >= V.beAtR) stopLvl = long ? Math.max(stopLvl, entry) : Math.min(stopLvl, entry);
    }
    // Trail, only after T1 so it cannot pre-empt the scale rule.
    if (t1Done && V.trailAtr && atr > 0) {
      const tr = long ? ext - V.trailAtr * atr : ext + V.trailAtr * atr;
      stopLvl = long ? Math.max(stopLvl, tr) : Math.min(stopLvl, tr);
    }

    // Stop first. Ties against the trade, always.
    if (touch(b, stopLvl, long ? "below" : "above")) {
      const fill = long ? stopLvl - tick : stopLvl + tick; // stops slip
      banked += ((long ? fill - entry : entry - fill) / risk) * remaining;
      legs++;
      return { filled: true, r: banked, legs, bars: k - fi + 1, reason: t1Done ? "runner-stop" : "stop", mfe, rr1, risk, fi, xi: k };
    }
    // T1.
    if (!t1Done && touch(b, t1, long ? "above" : "below")) {
      t1Done = true;
      const f = V.partial;
      if (f > 0) {
        banked += ((long ? t1 - entry : entry - t1) / risk) * f;
        remaining -= f;
        legs++;
      }
      if (V.beAtT1) stopLvl = long ? Math.max(stopLvl, entry) : Math.min(stopLvl, entry);
      if (remaining <= 1e-9 || t2 == null) {
        if (remaining > 1e-9) {
          banked += ((long ? t1 - entry : entry - t1) / risk) * remaining;
          legs++;
          remaining = 0;
        }
        return { filled: true, r: banked, legs, bars: k - fi + 1, reason: "t1", mfe, rr1, risk, fi, xi: k };
      }
      continue; // a same-bar T2 is not credited
    }
    // T2.
    if (t1Done && t2 != null && touch(b, t2, long ? "above" : "below")) {
      banked += ((long ? t2 - entry : entry - t2) / risk) * remaining;
      legs++;
      return { filled: true, r: banked, legs, bars: k - fi + 1, reason: "t2", mfe, rr1, risk, fi, xi: k };
    }
    // The live desk's own context stop (management.ts `killzone_ended`): the
    // window that justified the trade closed, so the trade closes with it.
    if (V.flattenKzEnd && k > fi) {
      const w = etWallParts(b.t);
      if (!resolveKillzone(w.hour, w.minute).inTradeWindow) {
        banked += ((long ? b.c - entry : entry - b.c) / risk) * remaining;
        legs++;
        return { filled: true, r: banked, legs, bars: k - fi + 1, reason: "kz-end", mfe, rr1, risk, fi, xi: k };
      }
    }
  }

  // Time stop: whatever is open closes at the last close in the window.
  const li = Math.min(bars.length, fi + V.maxHold) - 1;
  const last = bars[li];
  banked += ((long ? last.c - entry : entry - last.c) / risk) * remaining;
  legs++;
  return { filled: true, r: banked, legs, bars: li - fi + 1, reason: "time", mfe, rr1, risk, fi, xi: li };
}

/* ── The account ─────────────────────────────────────────────────────────── */

/**
 * Compound $100,000 through the admitted trades, honouring the house rules.
 *
 * Only one position is open at a time. That is not a simplification for the
 * simulator's benefit — it is how a solo trader with one screen and a 2%
 * daily stop actually operates, and allowing concurrent positions would let
 * the backtest collect returns no one could have taken.
 */
function runAccount(trades, V, years) {
  let equity = APLUS_RULES.paperEquity;
  let peak = equity;
  let maxDD = 0;
  let busyUntil = -Infinity; // ms; no new entry while a position is open
  let curDay = null;
  let curWeek = null;
  let curMonth = null;
  let dayPnl = 0;
  let weekPnl = 0;
  let dayStartEq = equity;
  let weekStartEq = equity;
  let monthTakes = 0;
  let kzCount = new Map();
  let dayBook = null;
  let halted = { day: false, week: false };
  const taken = [];
  const perYear = new Map();

  for (const r of trades) {
    const d = dayKey(r.t);
    const w = weekKey(r.t);
    const m = monthKey(r.t);
    if (d !== curDay) {
      curDay = d;
      dayPnl = 0;
      dayStartEq = equity;
      kzCount = new Map();
      dayBook = null;
      halted.day = false;
    }
    if (w !== curWeek) {
      curWeek = w;
      weekPnl = 0;
      weekStartEq = equity;
      halted.week = false;
    }
    if (m !== curMonth) {
      curMonth = m;
      monthTakes = 0;
    }

    if (r.t <= busyUntil) continue; // already in a trade
    if (halted.day || halted.week) continue;
    if (dayBook && dayBook !== r.sym) continue; // one book per day
    if ((kzCount.get(r.kz) ?? 0) >= APLUS_RULES.maxSetupsPerSession) continue;
    if (monthTakes >= V.monthCap) continue;

    const res = runTrade(r, V);
    if (!res) continue;
    if (!res.filled) continue; // a limit that never came back is not a trade

    // Size from the grade the desk actually printed.
    const grade = riskGradeFromScore(r.conf);
    const pct = Math.min(riskPctForGrade(grade), V.riskCap);
    if (pct <= 0) continue;
    const micro = CONTRACTS[r.sym] ?? CONTRACTS.MNQ;
    const pv = micro.pointValue;
    const dollars = equity * pct;
    const perContract = res.risk * pv;
    let contracts = perContract > 0 ? Math.floor(dollars / perContract) : 0;
    if (contracts < 1) continue; // cannot size it — refuse rather than round up
    contracts = Math.min(contracts, 200);

    const gross = res.r * res.risk * pv * contracts;
    const comm = micro.commission * contracts * res.legs;
    const pnl = gross - comm;

    equity += pnl;
    dayPnl += pnl;
    weekPnl += pnl;
    monthTakes++;
    kzCount.set(r.kz, (kzCount.get(r.kz) ?? 0) + 1);
    dayBook = r.sym;
    busyUntil = BARS[r.sym][res.xi]?.t ?? r.t;

    peak = Math.max(peak, equity);
    maxDD = Math.max(maxDD, (peak - equity) / peak);
    if (dayPnl <= -APLUS_RULES.dailyLossLimitPct * dayStartEq) halted.day = true;
    if (weekPnl <= -APLUS_RULES.weeklyLossLimitPct * weekStartEq) halted.week = true;

    const y = yearOf(r.t);
    if (!perYear.has(y)) perYear.set(y, { y, n: 0, wins: 0, losses: 0, sumR: 0, pnl: 0, start: equity - pnl, grossWin: 0, grossLoss: 0, nWin: 0, nLoss: 0 });
    const py = perYear.get(y);
    py.n++;
    py.sumR += res.r;
    py.pnl += pnl;
    if (res.r > 0.05) { py.wins++; py.grossWin += res.r; py.nWin++; }
    else if (res.r < -0.05) { py.losses++; py.grossLoss += -res.r; py.nLoss++; }
    taken.push({ ...r, r: res.r, pnl, contracts, reason: res.reason, mfe: res.mfe, rr1: res.rr1, equity, grade });
  }

  const ys = [...perYear.values()].sort((a, b) => a.y - b.y);
  return { equity, maxDD, taken, perYear: ys };
}

/* ── Scoring one variant ─────────────────────────────────────────────────── */

function score(taken, yearsFilter) {
  const rs = taken.filter((t) => yearsFilter.includes(yearOf(t.t)));
  const n = rs.length;
  if (!n) return { n: 0 };
  const wins = rs.filter((t) => t.r > 0.05);
  const losses = rs.filter((t) => t.r < -0.05);
  const sumR = rs.reduce((s, t) => s + t.r, 0);
  const avgWin = wins.length ? wins.reduce((s, t) => s + t.r, 0) / wins.length : 0;
  const avgLoss = losses.length ? -losses.reduce((s, t) => s + t.r, 0) / losses.length : 0;
  // Day-clustered standard error: refusals and takes cluster inside a session,
  // so treating 3 trades on one day as 3 independent draws overstates n.
  const byDay = new Map();
  for (const t of rs) {
    const d = dayKey(t.t);
    byDay.set(d, (byDay.get(d) ?? 0) + t.r);
  }
  const dayR = [...byDay.values()];
  const dm = dayR.reduce((s, v) => s + v, 0) / dayR.length;
  const dsd = dayR.length > 1 ? Math.sqrt(dayR.reduce((s, v) => s + (v - dm) ** 2, 0) / (dayR.length - 1)) : 0;
  const se = dayR.length > 1 ? dsd / Math.sqrt(dayR.length) : null;
  return {
    n,
    days: dayR.length,
    wr: wins.length / n,
    expR: sumR / n,
    sumR,
    payoff: avgLoss > 0 ? avgWin / avgLoss : null,
    profitFactor: avgLoss > 0 && losses.length ? (avgWin * wins.length) / (avgLoss * losses.length) : null,
    // The interval is on R PER DAY, then divided back to per-trade scale.
    expLo: se != null ? (dm - 1.96 * se) / (n / dayR.length) : null,
    expHi: se != null ? (dm + 1.96 * se) / (n / dayR.length) : null,
  };
}

/* ── The variant space, staged rather than multiplied ────────────────────── */

/**
 * WHY THIS IS TWO SWEEPS AND NOT ONE.
 *
 * The full cross of 9 session policies x 8 target pairs x 5 partials x 5
 * breakeven rules x 4 stops x 3 trails is 21,600 cells. Reporting the best of
 * 21,600 draws from a four-year sample is not a measurement, it is an order
 * statistic: with per-trade sd near 1R and a few hundred trades, the best cell
 * would look outstanding even if every cell had exactly zero edge.
 *
 * So the questions are asked one at a time, and each stage's winner is frozen
 * before the next stage runs:
 *
 *   Stage 1  hold the session policy at what SHIPS today, and sweep exits.
 *            Answers "what should we do with the trades we already take".
 *   Stage 2  hold the exit rule at stage 1's answer, and sweep the session.
 *            Answers "should the clock be a veto at all".
 *
 * 2,400 + 9 instead of 21,600, each stage answers one question, and the search
 * cost of each is printed beside its result because that count is the
 * denominator of every "best" in this file.
 */

const EXIT_AXES = {
  targets: [
    { t1Mode: "plan", t2Mode: "plan", tag: "plan/plan" },
    { t1Mode: "plan", t2Mode: "none", tag: "plan/none" },
    { t1Mode: "r", t1R: 1.0, t2Mode: "r", t2R: 2.0, tag: "1R/2R" },
    { t1Mode: "r", t1R: 1.5, t2Mode: "r", t2R: 3.0, tag: "1.5R/3R" },
    { t1Mode: "r", t1R: 2.0, t2Mode: "r", t2R: 4.0, tag: "2R/4R" },
    { t1Mode: "r", t1R: 1.0, t2Mode: "plan", tag: "1R/plan" },
    { t1Mode: "r", t1R: 2.0, t2Mode: "plan", tag: "2R/plan" },
    { t1Mode: "r", t1R: 3.0, t2Mode: "none", tag: "3R/none" },
  ],
  partials: [0, 0.25, 0.5, 0.75, 1.0],
  bes: [
    { beAtT1: false, beAtR: null, tag: "noBE" },
    { beAtT1: true, beAtR: null, tag: "BE@T1" },
    { beAtT1: false, beAtR: 1.0, tag: "BE@1R" },
    { beAtT1: false, beAtR: 0.5, tag: "BE@0.5R" },
    { beAtT1: true, beAtR: 1.0, tag: "BE@1R+T1" },
  ],
  stops: [
    { stopMode: "plan", tag: "planStop" },
    { stopMode: "atr", stopAtr: 0.75, tag: "0.75atr" },
    { stopMode: "atr", stopAtr: 1.0, tag: "1atr" },
    { stopMode: "atr", stopAtr: 1.5, tag: "1.5atr" },
  ],
  trails: [
    { trailAtr: null, tag: "noTrail" },
    { trailAtr: 1.5, tag: "trail1.5" },
    { trailAtr: 2.5, tag: "trail2.5" },
  ],
};

const BASE = {
  fillWindow: 12,
  maxHold: 32,
  minRr: APLUS_RULES.minRr,
  minRiskAtr: 0.25,
  monthCap: 9,
  riskCap: 0.02,
  flattenKzEnd: false,
};

function exitVariants(session) {
  const out = [];
  for (const t of EXIT_AXES.targets)
    for (const p of EXIT_AXES.partials)
      for (const be of EXIT_AXES.bes)
        for (const s of EXIT_AXES.stops)
          for (const tr of EXIT_AXES.trails) {
            // Taking 100% off at T1 leaves no runner, so a T2 and a trail are
            // not different variants - they are one variant counted many
            // times, which would inflate the denominator the "best" is judged
            // against. Skipped rather than deduped afterwards.
            if (p === 1.0 && (t.t2Mode !== "none" || tr.trailAtr)) continue;
            if (p === 0 && be.tag === "BE@T1") continue; // identical to noBE
            // `tag` LAST. Every axis object carries its own `tag`, so
            // spreading them after the composed one silently overwrote it and
            // every variant in the report printed as its stop mode alone —
            // 1,864 rows that all looked like "0.75atr" and could not be told
            // apart or reproduced.
            out.push({
              session,
              ...BASE,
              ...t,
              partial: p,
              ...be,
              ...s,
              trailAtr: tr.trailAtr,
              tag: `${t.tag}|p${p}|${be.tag}|${s.tag}|${tr.tag}`,
            });
          }
  return out;
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

const ALL_YEARS = [...new Set(rows.map((r) => yearOf(r.t)))].sort();
const IS = ALL_YEARS.filter((y) => !OOS.includes(y));

function opportunities(pred) {
  const out = [];
  const lastT = new Map();
  for (const r of rows) {
    if (r.judas || r.news) continue; // never, under any variant
    if (r.conf < APLUS_RULES.confluenceFloor) continue; // the floor is not a knob
    if (!pred(r)) continue;
    const k = `${r.sym}:${r.side}`;
    const prev = lastT.get(k);
    if (prev != null && r.t - prev < 4 * 60 * 60 * 1000) continue; // 4h cooldown
    lastT.set(k, r.t);
    out.push(r);
  }
  return out;
}

const oppCache = new Map();
const oppsFor = (s) => {
  if (!oppCache.has(s)) oppCache.set(s, opportunities(SESSIONS[s]));
  return oppCache.get(s);
};

const line = (s) =>
  s.n
    ? `n=${String(s.n).padStart(4)} d=${String(s.days).padStart(3)} WR ${String(Math.round(s.wr * 100)).padStart(2)}% exp ${(s.expR >= 0 ? "+" : "") + s.expR.toFixed(3)}R [${s.expLo == null ? "  -" : s.expLo.toFixed(2)},${s.expHi == null ? "  -" : s.expHi.toFixed(2)}] payoff ${s.payoff == null ? " - " : s.payoff.toFixed(2)} PF ${s.profitFactor == null ? " - " : s.profitFactor.toFixed(2)}`
    : "n=0";

console.log(`signals ${rows.length.toLocaleString()} kept from ${planMoments.toLocaleString()} plan-moments over ${barsScanned.toLocaleString()} bar-scans`);
console.log(`years ${ALL_YEARS.join(" ")} - chosen on ${IS.join(",")} - HELD OUT ${OOS.join(",")}\n`);

console.log("ADMISSION by session policy - before any exit rule, after floor/Judas/news/cooldown:");
for (const s of Object.keys(SESSIONS)) {
  const o = oppsFor(s);
  const co = o.filter(clockOnly).length;
  console.log(`  ${s.padEnd(11)} ${String(o.length).padStart(5)} opportunities - ${String(co).padStart(4)} of them clock-only`);
}

/* ── Stage 1: exits, session held at what ships ──────────────────────────── */

/**
 * WHY RANKING IS DONE IN DOLLARS AND NOT IN R.
 *
 * A 0.75xATR stop and the plan's structural stop define DIFFERENT risk units,
 * so their R values are not the same quantity and cannot be compared. The
 * tight-stop variants duly reported +2.0R expectancy with a payoff of 11.6 —
 * not because they made more money, but because every R was measured against
 * a smaller denominator. Ranking on that number would have selected the
 * variant with the smallest stop every time, which is precisely the "widen or
 * narrow the stop until the backtest looks better" failure.
 *
 * Dollars are comparable, because the account sizes every trade to the same
 * percentage of equity: a tighter stop buys more contracts at identical
 * dollar risk. R is still reported, labelled, and never ranked on.
 */
const pnlOver = (acc, years) =>
  acc.perYear.filter((y) => years.includes(y.y)).reduce((s, y) => s + y.pnl, 0);

const stage1 = [];
for (const v of exitVariants(oppsFor("shipped").length >= 40 ? "shipped" : "armed")) {
  const acc = runAccount(oppsFor(v.session), v, ALL_YEARS);
  stage1.push({
    v,
    acc,
    inS: score(acc.taken, IS),
    out: score(acc.taken, OOS),
    isPnl: pnlOver(acc, IS),
    outPnl: pnlOver(acc, OOS),
  });
}
const MIN_N = 30;
// Stage 1 runs on the ARMED population when the shipped one is too thin to
// answer anything — 13 trades cannot rank 1,864 exit variants, and pretending
// otherwise is how a backtest reports a winner that is one lucky trade.

/**
 * MAXIMIN, not total.
 *
 * Ranking on total in-sample P&L picked a variant that made +104% in 2024 and
 * then gave back 21% of the account in the first year it had never seen. One
 * exceptional year is exactly what a four-year total cannot distinguish from
 * an edge, and selecting on it is how a backtest hands you a strategy whose
 * whole result is a fortnight in October.
 *
 * So the selection statistic is the WORST in-sample year. A variant has to
 * survive its own worst 12 months to be chosen, which is the property the
 * trader actually needs — the account has to still be there next year — and
 * it cannot be bought with a single outlier. Stated here, before the
 * out-of-sample years are looked at.
 */
const worstYear = (r) => {
  const ys = r.acc.perYear.filter((y) => IS.includes(y.y));
  return ys.length ? Math.min(...ys.map((y) => y.pnl)) : -Infinity;
};
for (const r of stage1) r.worst = worstYear(r);
const s1 = stage1
  .filter((r) => r.inS.n >= MIN_N)
  .sort((a, b) => b.worst - a.worst || b.isPnl - a.isPnl);

console.log(`\n${"=".repeat(118)}`);
console.log(`STAGE 1 - EXITS. ${stage1.length} variants, ${s1.length} with n>=${MIN_N} in-sample. Session held at what ships today.\n`);
for (const r of s1.slice(0, TOP)) {
  console.log(`  ${r.v.tag}`);
  console.log(`      worst IS year ${(r.worst >= 0 ? "+$" : "-$") + Math.abs(Math.round(r.worst)).toLocaleString()}`);
  console.log(`      IS  ${(r.isPnl >= 0 ? "+$" : "-$") + Math.abs(Math.round(r.isPnl)).toLocaleString().padStart(7)}  ${line(r.inS)}`);
  console.log(`      OOS ${(r.outPnl >= 0 ? "+$" : "-$") + Math.abs(Math.round(r.outPnl)).toLocaleString().padStart(7)}  ${line(r.out)}`);
}
if (s1.length) {
  const isExp = s1.map((r) => r.inS.expR).sort((a, b) => a - b);
  const q = (p) => isExp[Math.floor(p * (isExp.length - 1))];
  console.log(`\n  in-sample expectancy across all ${s1.length} exit variants: min ${q(0).toFixed(3)} - median ${q(0.5).toFixed(3)} - p95 ${q(0.95).toFixed(3)} - max ${q(1).toFixed(3)}R`);
  console.log(`  that spread IS the selection risk: picking the max of ${s1.length} draws buys most of the gap between median and max.`);
}

const bestExit =
  s1[0]?.v ?? {
    ...BASE,
    session: "shipped",
    t1Mode: "plan",
    t2Mode: "plan",
    partial: 0.5,
    beAtT1: true,
    beAtR: null,
    stopMode: "plan",
    trailAtr: null,
    tag: "fallback",
  };

/* ── Stage 2: the session policy, exits frozen at stage 1's answer ───────── */

console.log(`\n${"=".repeat(118)}`);
console.log(`STAGE 2 - THE CLOCK. Exit rule frozen at stage 1's winner (${bestExit.tag}); only the session policy varies.\n`);
const pinned = PIN
  ? (() => {
      const hit = exitVariants("shipped").find((v) => v.tag === PIN);
      if (!hit) {
        console.error(`--exit ${PIN} matches no variant. Example: plan/plan|p0.75|BE@T1|planStop|noTrail`);
        process.exit(1);
      }
      return hit;
    })()
  : bestExit;
if (PIN) console.log(`
  [exit PINNED to ${PIN} — stage 1's pick is ignored so the gate column is the only thing moving]`);

const stage2 = [];
for (const s of Object.keys(SESSIONS)) {
  const v = { ...pinned, session: s, riskCap: RISK };
  const acc = runAccount(oppsFor(s), v, ALL_YEARS);
  const st = { v, acc, inS: score(acc.taken, IS), out: score(acc.taken, OOS), all: score(acc.taken, ALL_YEARS) };
  stage2.push(st);
  console.log(`  ${s.padEnd(11)} ALL ${line(st.all)}`);
  console.log(`  ${" ".repeat(11)} OOS ${line(st.out)}   final $${Math.round(acc.equity).toLocaleString()} - maxDD ${(acc.maxDD * 100).toFixed(1)}%`);
}

/* ── Do the out-of-window trades stand on their own? ─────────────────────── */

const anyhour = stage2.find((s) => s.v.session === "anyhour");
if (anyhour) {
  const co = anyhour.acc.taken.filter(clockOnly);
  const inW = anyhour.acc.taken.filter((t) => !clockOnly(t));
  console.log(`\n${"-".repeat(118)}`);
  console.log("THE CLOCK-ONLY TRADES, SCORED ALONE - the population the session rule currently discards:\n");
  console.log(`  in-window  ${line(score(inW, ALL_YEARS))}`);
  console.log(`  clock-only ${line(score(co, ALL_YEARS))}`);
  const byKz = new Map();
  for (const t of co) {
    if (!byKz.has(t.kz)) byKz.set(t.kz, []);
    byKz.get(t.kz).push(t);
  }
  for (const [kz, ts] of [...byKz.entries()].sort((a, b) => b[1].length - a[1].length))
    console.log(`    ${kz.padEnd(10)} ${line(score(ts, ALL_YEARS))}`);
  console.log("\n  by measured shock at the decision bar (max of range/ATR, 1.35x body/ATR, 2x gap/ATR):");
  for (const [lo, hi] of [[0, 1], [1, 1.5], [1.5, 2], [2, 3], [3, 99]]) {
    const b = co.filter((t) => shockScore(t) >= lo && shockScore(t) < hi);
    if (b.length) console.log(`    ${String(lo).padStart(4)}-${String(hi).padEnd(4)} ${line(score(b, ALL_YEARS))}`);
  }
}

/* ── Discretion: how, why, when, where - not just a tuned constant ───────── */

/**
 * The session policy is chosen on the TRAINING years and on a sample big
 * enough to mean something.
 *
 * It was chosen on `out.expR` — the held-out years — which is peeking, and
 * with a minimum of nothing, so it once selected `nyam` on the strength of a
 * single trade. Both are the same mistake in different clothes: letting the
 * test set pick, and letting n=1 speak.
 */
const MIN_POLICY_N = 12;
const eligible = stage2.filter((p) => p.all.n >= MIN_POLICY_N);
const chosen = (eligible.length ? eligible : stage2).reduce((a, b) =>
  ((b.inS.expR ?? -9) > (a.inS.expR ?? -9) ? b : a),
);
console.log(`\n${"=".repeat(118)}`);
console.log(`DISCRETION - what the selected policy (${chosen.v.session} | ${chosen.v.tag}) learned about ITSELF\n`);

function slice(taken, label, keyOf) {
  const m = new Map();
  for (const t of taken) {
    const k = String(keyOf(t));
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  const base = score(taken, ALL_YEARS);
  const out = [...m.entries()]
    .map(([k, ts]) => ({ k, s: score(ts, ALL_YEARS) }))
    .filter((r) => r.s.n >= 8)
    .sort((a, b) => b.s.expR - a.s.expR);
  if (!out.length) return;
  console.log(`  ${label}  (pool ${(base.expR >= 0 ? "+" : "") + base.expR.toFixed(3)}R, n=${base.n})`);
  for (const r of out)
    console.log(`    ${r.k.padEnd(14)} ${line(r.s)}  lift ${(r.s.expR - base.expR >= 0 ? "+" : "") + (r.s.expR - base.expR).toFixed(3)}R`);
  console.log("");
}

const T = chosen.acc.taken;
slice(T, "WHEN - killzone", (t) => t.kz);
slice(T, "WHEN - ET hour", (t) => `${String(t.etH).padStart(2, "0")}:00`);
slice(T, "WHERE - side", (t) => t.side);
slice(T, "WHERE - book", (t) => t.sym);
slice(T, "WHAT - grade", (t) => t.grade);
slice(T, "HOW - exit taken", (t) => t.reason);
slice(T, "WHY - shock at entry", (t) => (shockScore(t) >= 2 ? "shock>=2" : shockScore(t) >= 1.5 ? "1.5-2" : "quiet<1.5"));
slice(T, "WHY - planned RR", (t) => (t.rr1 >= 3 ? ">=3R" : t.rr1 >= 2 ? "2-3R" : t.rr1 >= 1.5 ? "1.5-2R" : "1-1.5R"));

/* ── The account, year by year ───────────────────────────────────────────── */

console.log(`${"=".repeat(118)}`);
console.log(`THE ACCOUNT - ${chosen.v.session} | ${chosen.v.tag}\n`);
console.log(`  year   trades   WR    sumR   avg R  payoff       P&L       equity     ret%`);
let eq = APLUS_RULES.paperEquity;
for (const py of chosen.acc.perYear) {
  const start = eq;
  eq += py.pnl;
  const payoff = py.nLoss && py.nWin ? (py.grossWin / py.nWin) / (py.grossLoss / py.nLoss) : null;
  console.log(
    `  ${py.y} ${String(py.n).padStart(6)} ${String(Math.round((py.wins / py.n) * 100)).padStart(4)}% ${((py.sumR >= 0 ? "+" : "") + py.sumR.toFixed(1)).padStart(7)} ${((py.sumR / py.n >= 0 ? "+" : "") + (py.sumR / py.n).toFixed(3)).padStart(7)} ${(payoff == null ? "-" : payoff.toFixed(2)).padStart(6)} ${((py.pnl >= 0 ? "+$" : "-$") + Math.abs(Math.round(py.pnl)).toLocaleString()).padStart(10)} ${("$" + Math.round(eq).toLocaleString()).padStart(11)} ${((eq / start - 1) * 100).toFixed(1).padStart(7)}%${OOS.includes(py.y) ? "  *held out" : ""}`,
  );
}
console.log(`\n  $${APLUS_RULES.paperEquity.toLocaleString()} -> $${Math.round(chosen.acc.equity).toLocaleString()} - max drawdown ${(chosen.acc.maxDD * 100).toFixed(1)}%`);

/* ── The two goals ───────────────────────────────────────────────────────── */
/* ── Does the sweep predict anything at all? ─────────────────────────────── */

console.log(`
${"=".repeat(118)}`);
console.log("DOES IN-SAMPLE RANK PREDICT OUT-OF-SAMPLE? — the question that decides whether any of this is usable");
{
  const xs = stage1.filter((r) => r.inS.n >= MIN_N && r.out.n >= 10);
  const mx = xs.reduce((s, r) => s + r.isPnl, 0) / xs.length;
  const my = xs.reduce((s, r) => s + r.outPnl, 0) / xs.length;
  let sxy = 0, sxx = 0, syy = 0;
  for (const r of xs) {
    sxy += (r.isPnl - mx) * (r.outPnl - my);
    sxx += (r.isPnl - mx) ** 2;
    syy += (r.outPnl - my) ** 2;
  }
  const rho = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
  const sorted = [...xs].sort((a, b) => b.isPnl - a.isPnl);
  const dec = Math.max(1, Math.floor(xs.length / 10));
  const avg = (a) => a.reduce((s, r) => s + r.outPnl, 0) / a.length;
  const money = (v) => (v >= 0 ? "+$" : "-$") + Math.abs(Math.round(v)).toLocaleString();
  console.log(`  correlation between in-sample and out-of-sample P&L across ${xs.length} variants: r = ${rho.toFixed(3)}`);
  console.log(`  best in-sample decile,  out-of-sample average: ${money(avg(sorted.slice(0, dec)))}`);
  console.log(`  worst in-sample decile, out-of-sample average: ${money(avg(sorted.slice(-dec)))}`);
  console.log(`  variants positive out-of-sample: ${xs.filter((r) => r.outPnl > 0).length} of ${xs.length}`);
  console.log(
    rho > 0.3
      ? "  Positive: the sweep carries signal and the chosen variant is worth trusting."
      : "  Near zero or negative means choosing on in-sample rank is choosing NOISE. At this sample the exit " +
        "sweep cannot be resolved, and any best-exit-rule from it is an artefact. The honest read is that the " +
        "exits are not the binding constraint and tuning them further buys nothing.",
  );
}


console.log(`\n${"=".repeat(118)}`);
console.log("THE TWO GOALS, ANSWERED\n");

const GOAL_RR = 1.25;
const clearing = stage1.filter((r) => r.out.n >= 20 && (r.out.payoff ?? 0) >= GOAL_RR && r.outPnl > 0);
console.log(`1. AVERAGE R:R >= ${GOAL_RR}  (payoff = mean win R / mean loss R)`);
console.log(`   out-of-sample, n>=20, positive expectancy: ${clearing.length} of ${stage1.length} exit variants clear it.`);
for (const c of clearing.sort((a, b) => b.out.payoff - a.out.payoff).slice(0, 10))
  console.log(`     ${c.v.tag.padEnd(46)} OOS payoff ${c.out.payoff.toFixed(2)} - exp ${(c.out.expR >= 0 ? "+" : "") + c.out.expR.toFixed(3)}R - n=${c.out.n}`);

const e = chosen.all?.expR ?? chosen.out.expR;
const tradesPerYear = chosen.acc.taken.length / ALL_YEARS.length;
console.log(`\n2. DOUBLE THE ACCOUNT IN A YEAR`);
console.log(`   Compounding at fixed fractional risk f, growth over N trades is (1 + f*E[R])^N.`);
for (const f of [0.01, 0.02, 0.03]) {
  const need = Math.log(2) / Math.log(1 + f * Math.max(e, 1e-9));
  const eNeed = (Math.pow(2, 1 / 108) - 1) / f;
  console.log(
    `   f=${(f * 100).toFixed(0)}%  at the measured ${e.toFixed(3)}R that needs ${need > 0 && Number.isFinite(need) ? Math.round(need).toLocaleString() : "inf"} trades/yr` +
      `  -  at the 108/yr PATH cap it needs ${eNeed.toFixed(3)}R/trade`,
  );
}
console.log(`   the desk produced ${tradesPerYear.toFixed(0)} trades/year under this policy.`);

mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/stage1.json`, JSON.stringify(stage1.map((r) => ({ tag: r.v.tag, inS: r.inS, out: r.out })), null, 1));
writeFileSync(`${OUT}/chosen.json`, JSON.stringify({ variant: chosen.v, all: chosen.all, out: chosen.out, perYear: chosen.acc.perYear, maxDD: chosen.acc.maxDD, equity: chosen.acc.equity, trades: chosen.acc.taken }, null, 1));
console.log(`\nwrote ${OUT}/stage1.json and ${OUT}/chosen.json`);
