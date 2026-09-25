/**
 * The evidence pack — what four years of the desk's OWN cards actually paid,
 * cut the ways a trader looks at a card, and written to a small JSON the app
 * can read at the moment of decision.
 *
 * WHY THIS EXISTS
 * Every number that matters on a card was measured this week and then lived
 * only in a commit message: the Q score is anti-predictive, the stop-width band
 * is the one replicated edge, shorts underperform longs in rising tape, the
 * desk's own TAKE word is or is not better than its WAIT. A finding the trader
 * cannot see at 09:52 does not change the 09:52 decision. This file moves the
 * findings from git history onto the card.
 *
 * WHAT IT SIMULATES — the desk's rule as coded in APLUS_RULES, not a variant:
 *   limit rests at CE (`e`), must fill within FILL_BARS closed bars after the
 *   decision bar (simulation starts at i+1 — no lookahead); stop `s` with one
 *   tick of slip; T1 `t1` must sit ahead of the entry; 50% off at T1, stop to
 *   exact breakeven, runner to T2 (or the remainder at T1 when there is no T2);
 *   a bar that touches the stop and a target together is scored AGAINST the
 *   trade; anything still open after HOLD_BARS closes at that bar's close.
 *   R is before commission — the commission in R depends on contract count,
 *   which depends on account size, and this pack is account-free.
 *
 * WHAT IT REFUSES: Judas-tagged and news-blackout rows (every consumer must),
 * and anything under the 0.65 floor, because nothing under it is ever a card.
 *
 * HOW TO READ A BUCKET: `exp` is mean R per SIGNAL THAT FILLED. `ci` is a 95%
 * interval clustered by ET trading day — signals on one day are not
 * independent, and pretending they are makes every interval too narrow. A
 * bucket is only called POSITIVE or NEGATIVE when both halves of the tape
 * (2022-24 and 2025-26, which nothing here was tuned on) agree in sign AND the
 * pooled interval excludes zero. Everything else is MIXED or THIN, and the app
 * prints those words rather than a number that would be acted on.
 *
 * Run: npx tsx scripts/build-evidence-pack.mjs
 * In:  .cache/signals/signals-*.json (capture-signals.mjs), src/data/history-4y.json
 * Out: src/data/evidence-pack.json
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const OUT = "src/data/evidence-pack.json";
const DIST_OUT = "src/data/evidence-dist.json";
const FILL_BARS = 12; // 3h on 15m — the limit is a same-session order
const HOLD_BARS = 32; // 8h from the fill
const TICK = 0.25; // MNQ and ES both
const FLOOR = 0.65;
const TP1_FRACTION = 0.5; // APLUS_RULES.scaleOut.tp1Fraction
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const DRIFT_DAYS = 28; // ~20 trading sessions, calendar-anchored so it is causal
const MIN_READ = 30; // below this a bucket is THIN and prints no rate

if (!existsSync(SIGDIR) || !existsSync(HIST)) {
  console.error("needs .cache/signals (capture-signals.mjs) and src/data/history-4y.json");
  process.exit(1);
}

const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

let rows = [];
for (const f of readdirSync(SIGDIR).filter((f) => f.startsWith("signals-") && f.endsWith(".json"))) {
  rows.push(...JSON.parse(readFileSync(`${SIGDIR}/${f}`, "utf8")).rows);
}
// One row per (sym, bar, side): the capture is chunked and chunks can overlap
// at their seams.
{
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = `${r.sym}|${r.i}|${r.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const captured = rows.length;
rows = rows.filter((r) => !r.judas && !r.news && r.conf >= FLOOR);
rows.sort((a, b) => a.t - b.t);

const yearOf = (t) => new Date(t).getUTCFullYear();
const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${w.month}-${w.day}`;
};

/** Index of the last bar at or before time t (binary search). */
function barAtOrBefore(bars, t) {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/**
 * Drift regime at the decision bar: did this instrument close higher than it
 * did DRIFT_DAYS calendar days earlier? Uses only bars at or before the
 * decision — the same read the live desk can make from its own daily bars.
 */
function driftAt(r) {
  const bars = BARS[r.sym];
  const then = barAtOrBefore(bars, bars[r.i].t - DRIFT_DAYS * 86_400_000);
  if (then < 0) return null;
  return bars[r.i].c > bars[then].c ? "up" : "down";
}

/** The desk's scale rule, bar by bar, ties against. Null = never filled. */
function sim(r) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const E = r.e;
  const S = r.s;
  const risk = Math.abs(E - S);
  if (!(risk > 0) || r.t1 == null) return null;
  if (long ? r.t1 <= E : r.t1 >= E) return null;
  const t2 = r.t2 != null && (long ? r.t2 > r.t1 : r.t2 < r.t1) ? r.t2 : null;
  const hitStop = (b, lvl) => (long ? b.l <= lvl : b.h >= lvl);
  const hitTgt = (b, lvl) => (long ? b.h >= lvl : b.l <= lvl);

  let fi = null;
  for (let k = 1; k <= FILL_BARS && r.i + k < bars.length; k++) {
    const b = bars[r.i + k];
    if (long ? b.l <= E : b.h >= E) {
      fi = r.i + k;
      break;
    }
  }
  if (fi == null) return { filled: false };

  let stop = S;
  let rem = 1;
  let banked = 0;
  let t1Done = false;
  const rOf = (px) => (long ? px - E : E - px) / risk;
  // Open-equity extremes in R (banked + the open remainder at the bar's best
  // and worst print). An intraday-trailing prop account trails the PEAK, so
  // a simulator of one needs the peak, not just the exit.
  let peak = 0;
  let trough = 0;
  const mark = (b) => {
    const best = long ? b.h : b.l;
    const worst = long ? b.l : b.h;
    peak = Math.max(peak, banked + rem * rOf(best));
    trough = Math.min(trough, banked + rem * rOf(worst));
  };
  for (let k = fi; k < bars.length && k < fi + HOLD_BARS; k++) {
    const b = bars[k];
    // The fill bar itself can stop the trade out; it cannot also be credited
    // a target on the same bar, because the order of the prints is unknown.
    if (hitStop(b, stop)) {
      const px = long ? stop - TICK : stop + TICK;
      trough = Math.min(trough, banked + rem * rOf(px));
      banked += rOf(px) * rem;
      return { filled: true, R: banked, t1: t1Done, exit: t1Done ? "be" : "stop", peak, trough, bars: k - fi + 1 };
    }
    if (k === fi) {
      // The fill bar: only the adverse side is knowable (the stop did not
      // print), so it can deepen the trough but never lift the peak.
      trough = Math.min(trough, banked + rem * rOf(long ? b.l : b.h));
      continue;
    }
    if (!t1Done && hitTgt(b, r.t1)) {
      t1Done = true;
      peak = Math.max(peak, banked + rem * rOf(r.t1));
      if (t2 == null) {
        banked += rOf(r.t1) * rem;
        return { filled: true, R: banked, t1: true, exit: "t1", peak, trough, bars: k - fi + 1 };
      }
      banked += rOf(r.t1) * TP1_FRACTION;
      rem -= TP1_FRACTION;
      stop = E;
      continue;
    }
    if (t1Done && t2 != null && hitTgt(b, t2)) {
      peak = Math.max(peak, banked + rem * rOf(t2));
      banked += rOf(t2) * rem;
      return { filled: true, R: banked, t1: true, exit: "t2", peak, trough, bars: k - fi + 1 };
    }
    mark(b);
  }
  const li = Math.min(bars.length, fi + HOLD_BARS) - 1;
  banked += rOf(bars[li].c) * rem;
  return { filled: true, R: banked, t1: t1Done, exit: "time", peak, trough, bars: li - fi + 1 };
}

/** Did price close further the card's way than against it, 16 bars on? */
function dirHit(r) {
  const b = BARS[r.sym];
  if (r.i + 16 >= b.length) return null;
  const net = b[r.i + 16].c - b[r.i].c;
  if (Math.abs(net) < 1e-9) return null;
  return (r.side === "long") === net > 0;
}

const sims = [];
for (const r of rows) {
  const s = sim(r);
  if (!s) continue;
  sims.push({
    r,
    ...s,
    y: yearOf(r.t),
    day: dayKey(r.t),
    drift: driftAt(r),
    riskAtr: r.atr > 0 ? Math.abs(r.e - r.s) / r.atr : null,
    dir: dirHit(r),
  });
}

/** Mean with a day-clustered 95% interval. */
function clustered(items) {
  const n = items.length;
  if (!n) return null;
  const mean = items.reduce((s, o) => s + o.R, 0) / n;
  const byDay = new Map();
  for (const o of items) byDay.set(o.day, (byDay.get(o.day) ?? 0) + (o.R - mean));
  let v = 0;
  for (const s of byDay.values()) v += s * s;
  const G = byDay.size;
  const se = G > 1 ? (Math.sqrt(v) / n) * Math.sqrt(G / (G - 1)) : Infinity;
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, days: G };
}

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

function bucket(key, label, all) {
  const signals = all.length;
  const filled = all.filter((o) => o.filled);
  const n = filled.length;
  const pooled = clustered(filled);
  const isF = filled.filter((o) => IS_YEARS.includes(o.y));
  const oosF = filled.filter((o) => OOS_YEARS.includes(o.y));
  const mean = (a) => (a.length ? a.reduce((s, o) => s + o.R, 0) / a.length : null);
  const isExp = mean(isF);
  const oosExp = mean(oosF);
  const dirs = all.map((o) => o.dir).filter((d) => d !== null);
  const t1Rate = n ? filled.filter((o) => o.t1).length / n : null;

  let verdict = "thin";
  if (n >= MIN_READ && isF.length >= 15 && oosF.length >= 15) {
    const agree = Math.sign(isExp) === Math.sign(oosExp);
    if (agree && pooled.lo > 0) verdict = "positive";
    else if (agree && pooled.hi < 0) verdict = "negative";
    else verdict = "mixed";
  }
  return {
    key,
    label,
    signals,
    n,
    fillRate: r3(signals ? n / signals : null),
    exp: r3(pooled?.mean ?? null),
    lo: r3(pooled?.lo ?? null),
    hi: r3(pooled?.hi ?? null),
    isExp: r3(isExp),
    oosExp: r3(oosExp),
    isN: isF.length,
    oosN: oosF.length,
    t1Rate: r3(t1Rate),
    dirHit: r3(dirs.length >= MIN_READ ? dirs.filter(Boolean).length / dirs.length : null),
    dirN: dirs.length,
    verdict,
  };
}

const within = (lo, hi) => (x) => x != null && x >= lo && x < hi;
const cut = (defs, pick) => defs.map(([key, label, pred]) => bucket(key, label, sims.filter((o) => pred(pick(o)))));

const pack = {
  builtAt: new Date().toISOString(),
  source: {
    capture: `${SIGDIR} (${captured} plan moments, ${rows.length} at or above the floor after Judas/news refusal)`,
    tape: `${HIST} ${H.window?.start} -> ${H.window?.end}, ${H.interval}`,
    simulated: sims.length,
    filled: sims.filter((o) => o.filled).length,
  },
  rules: {
    entry: "limit at CE, must fill within 12 closed 15m bars after the decision",
    stop: "plan stop, 1 tick slip",
    manage: "50% at T1, stop to exact breakeven, runner to T2 (all at T1 when no T2)",
    ties: "a bar touching stop and target together is a stop",
    hold: "closed at market 32 bars after the fill",
    costs: "before commission",
    halves: "IS 2022-24, OOS 2025-26 — nothing here was tuned on either",
    verdict:
      "POSITIVE/NEGATIVE only when both halves agree in sign AND the day-clustered 95% interval excludes zero; MIXED otherwise; THIN below 30 fills or 15 per half",
    drift: `up = close above the close ${DRIFT_DAYS} calendar days earlier, at the decision bar`,
  },
  baseline: bucket("all", "every card at or above 0.65", sims),
  q: cut(
    [
      ["0.65-0.70", "Q 0.65-0.70", within(0.65, 0.7)],
      ["0.70-0.75", "Q 0.70-0.75", within(0.7, 0.75)],
      ["0.75-0.80", "Q 0.75-0.80", within(0.75, 0.8)],
      ["0.80-0.85", "Q 0.80-0.85", within(0.8, 0.85)],
      ["0.85+", "Q 0.85+", within(0.85, 9)],
    ],
    (o) => o.r.conf,
  ),
  riskAtr: cut(
    [
      ["<0.5", "stop under 0.5 ATR", within(0, 0.5)],
      ["0.5-0.75", "stop 0.5-0.75 ATR", within(0.5, 0.75)],
      ["0.75-1", "stop 0.75-1 ATR", within(0.75, 1)],
      ["1-1.5", "stop 1-1.5 ATR", within(1, 1.5)],
      ["1.5+", "stop over 1.5 ATR", within(1.5, 999)],
    ],
    (o) => o.riskAtr,
  ),
  inBand: [
    bucket("in", "stop inside 0.5-1.5 ATR", sims.filter((o) => o.riskAtr != null && o.riskAtr >= 0.5 && o.riskAtr <= 1.5)),
    bucket("out", "stop outside 0.5-1.5 ATR", sims.filter((o) => o.riskAtr != null && (o.riskAtr < 0.5 || o.riskAtr > 1.5))),
  ],
  side: cut(
    [
      ["long", "longs", (s) => s === "long"],
      ["short", "shorts", (s) => s === "short"],
    ],
    (o) => o.r.side,
  ),
  sideDrift: [
    bucket("long|up", "long with the drift (tape up 4 weeks)", sims.filter((o) => o.r.side === "long" && o.drift === "up")),
    bucket("long|down", "long against the drift (tape down 4 weeks)", sims.filter((o) => o.r.side === "long" && o.drift === "down")),
    bucket("short|down", "short with the drift (tape down 4 weeks)", sims.filter((o) => o.r.side === "short" && o.drift === "down")),
    bucket("short|up", "short against the drift (tape up 4 weeks)", sims.filter((o) => o.r.side === "short" && o.drift === "up")),
  ],
  word: cut(
    [
      ["TAKE", "desk said TAKE", (w) => w === "TAKE"],
      ["WAIT", "desk said WAIT", (w) => w === "WAIT"],
      ["STAND", "desk said STAND", (w) => w === "STAND"],
    ],
    (o) => o.r.word,
  ),
  musts: cut(
    [
      ["<=6", "6 or fewer musts", within(0, 7)],
      ["7", "7 of 9 musts", within(7, 8)],
      ["8", "8 of 9 musts", within(8, 9)],
      ["9", "all 9 musts", within(9, 99)],
    ],
    (o) => o.r.pass,
  ),
  session: cut(
    [
      ["london", "London killzone", (k) => k === "london"],
      ["ny_am", "NY AM killzone", (k) => k === "ny_am"],
      ["ny_pm", "NY PM", (k) => k === "ny_pm"],
      ["other", "outside the killzones", (k) => !["london", "ny_am", "ny_pm"].includes(k)],
    ],
    (o) => o.r.kz,
  ),
  // The session gate opened the clock to TAPE events (session-event.ts:
  // delivery >= 2.0 ATR and participation >= 1.5x). The capture carries both
  // reads at the decision bar, so the question "did the event cards outside
  // the killzones pay?" can be asked of the same four years directly.
  event: (() => {
    const inKz = (o) => ["london", "ny_am"].includes(o.r.kz);
    const shock = (o) => Math.max(o.r.rngAtr ?? 0, 1.35 * (o.r.bodyAtr ?? 0), 2 * (o.r.gapAtr ?? 0));
    const isEvent = (o) => shock(o) >= 2.0 && (o.r.volX ?? 0) >= 1.5;
    return [
      bucket("kz", "inside London / NY AM", sims.filter(inKz)),
      bucket("out-event", "outside, but a tape event (2.0 ATR + 1.5x vol)", sims.filter((o) => !inKz(o) && isEvent(o))),
      bucket("out-quiet", "outside, no event", sims.filter((o) => !inKz(o) && !isEvent(o))),
      bucket("kz-event", "inside a killzone AND a tape event", sims.filter((o) => inKz(o) && isEvent(o))),
    ];
  })(),
  // Pre-declared composites: each one only REMOVES a bucket that measured
  // negative in both halves for a stated reason. None was chosen by searching
  // for the best-looking combination.
  composite: (() => {
    const band = (o) => o.riskAtr != null && o.riskAtr >= 0.5 && o.riskAtr <= 1.5;
    const q = (o) => o.r.conf < 0.85;
    const kz = (o) => ["london", "ny_am"].includes(o.r.kz);
    return [
      bucket("band", "stop in 0.5-1.5 ATR", sims.filter(band)),
      bucket("band+q", "+ Q under 0.85", sims.filter((o) => band(o) && q(o))),
      bucket("band+q+kz", "+ inside London / NY AM", sims.filter((o) => band(o) && q(o) && kz(o))),
      bucket("band+q+nyam", "+ NY AM only", sims.filter((o) => band(o) && q(o) && o.r.kz === "ny_am")),
    ];
  })(),
  // The per-trade distribution behind the policy the ticket actually sizes
  // (stop inside the band), in time order, for simulators that need paths
  // rather than means — src/lib/propfirm Monte Carlo reads this. `peak` and
  // `trough` are open-equity extremes in R, because an intraday-trailing
  // account trails the peak.
  dist: (() => {
    const pol = sims
      .filter((o) => o.filled && o.riskAtr != null && o.riskAtr >= 0.5 && o.riskAtr <= 1.5)
      .sort((a, b) => a.r.t - b.r.t);
    const weeks = pol.length ? (pol[pol.length - 1].r.t - pol[0].r.t) / (7 * 86_400_000) : 0;
    const q2 = (x) => Math.round(x * 100) / 100;
    return {
      policy: "every filled card with the stop inside 0.5-1.5 ATR, taken as coded",
      n: pol.length,
      perWeek: weeks > 0 ? Math.round((pol.length / weeks) * 10) / 10 : null,
      t: pol.map((o) => o.r.t),
      r: pol.map((o) => q2(o.R)),
      peak: pol.map((o) => q2(o.peak ?? Math.max(0, o.R))),
      trough: pol.map((o) => q2(o.trough ?? Math.min(0, o.R))),
      riskAtr: pol.map((o) => q2(o.riskAtr)),
      sym: pol.map((o) => o.r.sym),
    };
  })(),
  etHalfHour: (() => {
    const out = [];
    for (let m = 0; m < 24 * 60; m += 30) {
      const hh = String(Math.floor(m / 60)).padStart(2, "0");
      const mm = String(m % 60).padStart(2, "0");
      const b = bucket(`${hh}:${mm}`, `${hh}:${mm} ET`, sims.filter((o) => o.r.etH * 60 + o.r.etM >= m && o.r.etH * 60 + o.r.etM < m + 30));
      if (b.signals) out.push(b);
    }
    return out;
  })(),
  weekday: cut(
    [
      ["1", "Monday", (d) => d === 1],
      ["2", "Tuesday", (d) => d === 2],
      ["3", "Wednesday", (d) => d === 3],
      ["4", "Thursday", (d) => d === 4],
      ["5", "Friday", (d) => d === 5],
    ],
    (o) => o.r.wd,
  ),
};

// The per-trade paths go to their own file: the card lookups ship in the
// client bundle on every page, the paths are only wanted by a simulator.
const dist = pack.dist;
delete pack.dist;
writeFileSync(OUT, JSON.stringify(pack, null, 1) + "\n");
writeFileSync(DIST_OUT, JSON.stringify({ builtAt: pack.builtAt, rules: pack.rules, ...dist }) + "\n");

const show = (b) =>
  `${b.label.padEnd(44)} n=${String(b.n).padStart(4)}  exp ${b.exp == null ? "  —   " : (b.exp >= 0 ? "+" : "") + b.exp.toFixed(3)}  [${b.lo ?? "—"}, ${b.hi ?? "—"}]  IS ${b.isExp ?? "—"} OOS ${b.oosExp ?? "—"}  dir ${b.dirHit == null ? "—" : (b.dirHit * 100).toFixed(1) + "%"}  ${b.verdict.toUpperCase()}`;
console.log(`${pack.source.capture}\nsimulated ${pack.source.simulated}, filled ${pack.source.filled}\n`);
console.log(show(pack.baseline));
for (const k of ["q", "riskAtr", "inBand", "side", "sideDrift", "word", "musts", "session", "event", "composite", "weekday"]) {
  console.log(`\n${k}`);
  for (const b of pack[k]) console.log("  " + show(b));
}
console.log("\netHalfHour (n>=30 only)");
for (const b of pack.etHalfHour.filter((b) => b.n >= MIN_READ)) console.log("  " + show(b));
console.log(`\nwrote ${OUT} and ${DIST_OUT} (${dist.n} trades, ${dist.perWeek}/wk)`);
