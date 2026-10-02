/**
 * P(T1 reached | filled) — the card's score — fitted on four years of the
 * desk's own cards and validated out of sample.
 *
 * WHAT IS PREDICTED
 * For every captured card (same population as the evidence pack: deduped,
 * no Judas, no news, a T1 ahead of the entry), simulate the LIVE rule — limit
 * at CE inside 12 bars, failed-hold exit before T1 (exit-rules.ts), hard stop,
 * 50% at T1 / BE / runner, 32-bar hold, ties against, the fill bar cannot
 * score T1. y = 1 when T1 printed before the stop and before a failed hold.
 * Only filled cards are modelled; the fill rate is reported by location tier.
 *
 * THE CANDIDATES (features defined ONCE in src/lib/trading/hit-odds.ts, so
 * the live card computes exactly what was fitted)
 *   RW  random walk: 1 / (1 + rr1). No fitting — the geometry prior.
 *   RACE  the desk's existing 18-session first-passage race (target-odds.ts),
 *       computed causally on the 1,700 bars before each card.
 *   M0  logistic on geometry only: ln rr1, ln T1-in-ATR, stop-band dummies.
 *   M1  M0 + location tier, Tier-1 ladder, weekly+daily, inducement,
 *       mitigation, SMT at a level / away from levels, London, NY AM, Friday,
 *       the engine fit, side, symbol.
 *   M2  M1 + the race (logit) and a race-missing flag.
 *
 * DECISION RULE, FIXED BEFORE THE FIRST RUN
 *   Fit on 2022–24, evaluate on 2025–26. Ridge penalty for each model chosen
 *   by leave-one-year-out CV inside 2022–24 (grid 0.3 … 100).
 *   Start from M0. M1 replaces it only if its out-of-sample log loss is lower
 *   with a day-clustered paired z <= −2. M2 replaces the winner the same way.
 *   The shipped model is the winner refitted on all four years with its CV
 *   penalty. Its out-of-sample calibration (reliability by decile, slope,
 *   calibration-in-the-large) is published with it, whatever it shows.
 *   Effects are reported with day-block bootstrap 95% intervals (200 reps);
 *   the card marks a driver "reliable" only when its interval excludes zero.
 *   Nothing here is a gate: the 0.65 floor and the PATH bands in config.ts
 *   are the trader's numbers and are not touched.
 *
 * Run: npx tsx scripts/build-hit-odds.mjs [--refresh]
 * Out: src/data/hit-odds-model.json (read by the app)
 *      .cache/hit-odds-features.json (feature cache; --refresh rebuilds)
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const OUT = "src/data/hit-odds-model.json";
const CACHE = ".cache/hit-odds-features.json";
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const LAMBDAS = [0.3, 1, 3, 10, 30, 100];
const BOOT = 200;
const SLICE_DETECT = 300;
const SLICE_SMT = 800;
const SLICE_LADDER = 1100;
const SLICE_RACE = 1700;
const REFRESH = process.argv.includes("--refresh");

const { etWallParts, etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");
const { buildTfLadder, ladderTags, tradeDateOf } = await import("../src/lib/trading/tf-ladder.ts");
const { detectInducement, detectMitigationBlock } = await import("../src/lib/trading/detectors.ts");
const { smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { smtAtLevel } = await import("../src/lib/trading/smt-level.ts");
const { groupSessions } = await import("../src/lib/trading/draw.ts");
const { raceOdds } = await import("../src/lib/trading/target-odds.ts");
const HO = await import("../src/lib/trading/hit-odds.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

/* ── Population ──────────────────────────────────────────────────────────── */

let rows = [];
for (const f of readdirSync(SIGDIR).filter((f) => f.startsWith("signals-") && f.endsWith(".json"))) {
  rows.push(...JSON.parse(readFileSync(`${SIGDIR}/${f}`, "utf8")).rows);
}
{
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = `${r.sym}|${r.i}|${r.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
rows = rows.filter(
  (r) => !r.judas && !r.news && r.t1 != null && Math.abs(r.e - r.s) > 0 && (r.side === "long" ? r.t1 > r.e : r.t1 < r.e) && r.atr > 0,
);
rows.sort((a, b) => a.t - b.t);
const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${w.month}-${w.day}`;
};

/* ── The live rule, simulated (identical to measure-entry-location L0) ───── */

function sim(r) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const E = r.e, S = r.s;
  const risk = Math.abs(E - S);
  const t2 = r.t2 != null && (long ? r.t2 > r.t1 : r.t2 < r.t1) ? r.t2 : null;
  const hitStop = (b, lvl) => (long ? b.l <= lvl : b.h >= lvl);
  const hitTgt = (b, lvl) => (long ? b.h >= lvl : b.l <= lvl);
  let fi = null;
  for (let k = 1; k <= FILL_BARS && r.i + k < bars.length; k++) {
    const b = bars[r.i + k];
    if (long ? b.l <= E : b.h >= E) { fi = r.i + k; break; }
  }
  if (fi == null) return { filled: false };
  const failLevel = long ? E - 0.5 * risk : E + 0.5 * risk;
  let stop = S, rem = 1, banked = 0, t1Done = false;
  const rOf = (px) => (long ? px - E : E - px) / risk;
  const end = Math.min(bars.length, fi + HOLD_BARS);
  for (let k = fi; k < end; k++) {
    const b = bars[k];
    if (hitStop(b, stop)) {
      banked += rOf(long ? stop - TICK : stop + TICK) * rem;
      return { filled: true, R: banked, t1: t1Done };
    }
    if (k !== fi) {
      if (!t1Done && hitTgt(b, r.t1)) {
        t1Done = true;
        if (t2 == null) return { filled: true, R: banked + rOf(r.t1) * rem, t1: true };
        banked += rOf(r.t1) * 0.5;
        rem -= 0.5;
        stop = E;
        continue;
      }
      if (t1Done && t2 != null && hitTgt(b, t2)) return { filled: true, R: banked + rOf(t2) * rem, t1: true };
    }
    if (!t1Done && (long ? b.c < failLevel : b.c > failLevel)) {
      return { filled: true, R: banked + rOf(b.c) * rem, t1: false };
    }
  }
  return { filled: true, R: banked + rOf(bars[end - 1].c) * rem, t1: t1Done };
}

/* ── Causal inputs per card ──────────────────────────────────────────────── */

const DAYIDX = {};
for (const sym of Object.keys(BARS)) {
  const bars = BARS[sym];
  const days = [];
  for (let i = 0; i < bars.length; i++) {
    const td = tradeDateOf(bars[i].t);
    if (!days.length || days[days.length - 1].date !== td) days.push({ date: td, start: i, end: i });
    else days[days.length - 1].end = i;
  }
  const dayOfBar = new Int32Array(bars.length);
  days.forEach((d, k) => { for (let i = d.start; i <= d.end; i++) dayOfBar[i] = k; });
  const daily = days.map((d) => {
    let h = -Infinity, l = Infinity, v = 0;
    for (let i = d.start; i <= d.end; i++) { h = Math.max(h, bars[i].h); l = Math.min(l, bars[i].l); v += bars[i].v ?? 0; }
    return { t: etWallToEpochMs(d.date, "00:00"), o: bars[d.start].o, h, l, c: bars[d.end].c, v };
  });
  DAYIDX[sym] = { days, dayOfBar, daily };
}
function causalDaily(sym, i) {
  const { days, dayOfBar, daily } = DAYIDX[sym];
  const k = dayOfBar[i];
  const bars = BARS[sym];
  const d = days[k];
  let h = -Infinity, l = Infinity, v = 0;
  for (let j = d.start; j <= i; j++) { h = Math.max(h, bars[j].h); l = Math.min(l, bars[j].l); v += bars[j].v ?? 0; }
  return [...daily.slice(Math.max(0, k - 800), k), { t: daily[k].t, o: bars[d.start].o, h, l, c: bars[i].c, v }];
}
/** Last index in `bars` with t <= tMs. */
function idxAt(bars, tMs) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= tMs) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
function elapsedFractionOf(sessions) {
  const current = sessions[sessions.length - 1];
  if (!current?.bars.length) return 0.5;
  const lens = sessions.slice(0, -1).map((s) => s.bars.length).sort((a, b) => a - b);
  const typical = lens.length ? lens[Math.floor(lens.length / 2)] : 0;
  return Math.min(0.95, current.bars.length / Math.max(current.bars.length, typical || current.bars.length));
}

function inputsFor(r) {
  const bars = BARS[r.sym];
  const nowMs = bars[r.i].t + 15 * 60_000;
  const ladder = buildTfLadder({ symbol: r.sym, daily: causalDaily(r.sym, r.i), m15: bars.slice(Math.max(0, r.i + 1 - SLICE_LADDER), r.i + 1), m1: [], nowMs });
  const tags = ladderTags(ladder, r.side);
  const det = bars.slice(Math.max(0, r.i + 1 - SLICE_DETECT), r.i + 1);
  const inducement = detectInducement(det, r.side).inducement;
  const mitigation = detectMitigationBlock(det, r.side).present;
  // SMT exactly as the capture computed it: MNQ left, ES right, same instant.
  const iM = r.sym === "MNQ" ? r.i : idxAt(BARS.MNQ, bars[r.i].t);
  const iE = r.sym === "ES" ? r.i : idxAt(BARS.ES, bars[r.i].t);
  let smt = { present: false, atLevel: false, level: null };
  if (iM > 50 && iE > 50) {
    const sM = BARS.MNQ.slice(Math.max(0, iM + 1 - SLICE_SMT), iM + 1);
    const sE = BARS.ES.slice(Math.max(0, iE + 1 - SLICE_SMT), iE + 1);
    const stack = smtDivergenceStack(sM, sE);
    const own = r.sym === "MNQ" ? sM : sE;
    const read = smtAtLevel({ divergence: stack.primary, isLeft: r.sym === "MNQ", side: r.side, bars: own, arrays: stack.primary?.active ? buildSmcTape(own).arrays : [], atr: r.atr });
    smt = { present: read.present, atLevel: read.atLevel, level: read.level };
  }
  const sess = groupSessions(bars.slice(Math.max(0, r.i + 1 - SLICE_RACE), r.i + 1));
  let raceP = null;
  if (sess.length >= 2) {
    const ro = raceOdds(sess, elapsedFractionOf(sess), Math.abs(r.t1 - r.e), Math.abs(r.e - r.s), r.side);
    raceP = ro.pTargetFirst;
  }
  return { tags: { tf_dir: tags.tf_dir, tf_1w: tags.tf_1w, tf_1d: tags.tf_1d }, inducement, mitigation, smt, raceP };
}

let cache = {};
if (!REFRESH && existsSync(CACHE)) cache = JSON.parse(readFileSync(CACHE, "utf8"));
const started = Date.now();
const cards = [];
let built = 0;
for (const r of rows) {
  const key = `${r.sym}|${r.i}|${r.side}`;
  let inp = cache[key];
  if (!inp) {
    inp = inputsFor(r);
    cache[key] = inp;
    built++;
    if (built % 250 === 0) process.stderr.write(`\r  inputs ${built} built · ${((Date.now() - started) / 1000).toFixed(0)}s   `);
  }
  const s = sim(r);
  const input = {
    side: r.side, symbol: r.sym, entry: r.e, stop: r.s, t1: r.t1, atr: r.atr, price: r.px,
    tags: inp.tags, inducement: inp.inducement, mitigation: inp.mitigation, smt: inp.smt,
    killzone: r.kz, weekday: r.wd, fit: r.conf, raceP: inp.raceP,
  };
  const f = HO.oddsFeatures(input);
  const g = HO.geometryOf(input);
  if (!f || !g) continue;
  cards.push({ r, day: dayKey(r.t), y: new Date(r.t).getUTCFullYear(), s, f, g, raceP: inp.raceP, smt: inp.smt });
}
if (built) {
  process.stderr.write("\n");
  writeFileSync(CACHE, JSON.stringify(cache));
}
const fills = cards.filter((c) => c.s.filled);
console.log(`cards ${cards.length}, filled ${fills.length}, T1 ${fills.filter((c) => c.s.t1).length} (inputs built ${built}, ${((Date.now() - started) / 1000).toFixed(0)}s)`);

/* ── Logistic ridge (Newton) ─────────────────────────────────────────────── */

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    [M[c], M[p]] = [M[p], M[c]];
    const d = M[c][c] || 1e-12;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const k = M[r][c] / d;
      if (k === 0) continue;
      for (let q = c; q <= n; q++) M[r][q] -= k * M[c][q];
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1e-12));
}
const sig = (z) => 1 / (1 + Math.exp(-z));
function scaler(items, feats) {
  const sc = {};
  for (const k of feats) {
    if (!HO.CONTINUOUS.includes(k)) continue;
    const xs = items.map((o) => o.f[k]);
    const m = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) || 1;
    sc[k] = { mean: m, sd };
  }
  return sc;
}
const rowOf = (o, feats, sc) => [1, ...feats.map((k) => (sc[k] ? (o.f[k] - sc[k].mean) / sc[k].sd : o.f[k]))];
function fit(items, feats, lambda) {
  const sc = scaler(items, feats);
  const X = items.map((o) => rowOf(o, feats, sc));
  const y = items.map((o) => (o.s.t1 ? 1 : 0));
  const p = feats.length + 1;
  let w = new Array(p).fill(0);
  for (let it = 0; it < 60; it++) {
    const H = Array.from({ length: p }, () => new Array(p).fill(0));
    const g = new Array(p).fill(0);
    for (let n = 0; n < X.length; n++) {
      const x = X[n];
      let z = 0;
      for (let j = 0; j < p; j++) z += w[j] * x[j];
      const mu = sig(z);
      const wt = mu * (1 - mu);
      for (let j = 0; j < p; j++) {
        g[j] += (y[n] - mu) * x[j];
        const a = wt * x[j];
        for (let k = j; k < p; k++) H[j][k] += a * x[k];
      }
    }
    for (let j = 0; j < p; j++) for (let k = 0; k < j; k++) H[j][k] = H[k][j];
    for (let j = 1; j < p; j++) { H[j][j] += lambda; g[j] -= lambda * w[j]; }
    const step = solve(H, g);
    let mx = 0;
    w = w.map((v, j) => { mx = Math.max(mx, Math.abs(step[j])); return v + step[j]; });
    if (mx < 1e-8) break;
  }
  return { w, sc, feats, lambda };
}
const predict = (m, o) => sig(rowOf(o, m.feats, m.sc).reduce((a, x, j) => a + m.w[j] * x, 0));
const ll = (p, y) => -(y ? Math.log(Math.max(1e-9, p)) : Math.log(Math.max(1e-9, 1 - p)));

function cvLambda(items, feats) {
  let best = null;
  for (const lam of LAMBDAS) {
    let tot = 0, n = 0;
    for (const hold of IS_YEARS) {
      const tr = items.filter((o) => o.y !== hold);
      const te = items.filter((o) => o.y === hold);
      const m = fit(tr, feats, lam);
      for (const o of te) { tot += ll(predict(m, o), o.s.t1 ? 1 : 0); n++; }
    }
    const v = tot / n;
    if (!best || v < best.v) best = { lam, v };
  }
  return best.lam;
}

/* ── Out-of-sample comparison ────────────────────────────────────────────── */

const IS = fills.filter((o) => IS_YEARS.includes(o.y));
const OOS = fills.filter((o) => OOS_YEARS.includes(o.y));
const base = IS.filter((o) => o.s.t1).length / IS.length;
const MODELS = { M0: HO.GEOMETRY_FEATURES, M1: HO.ALL_FEATURES, M2: HO.RACE_FEATURES };
const fitted = {};
for (const [name, feats] of Object.entries(MODELS)) {
  const lam = cvLambda(IS, feats);
  fitted[name] = fit(IS, feats, lam);
}
const preds = {
  BASE: () => base,
  RW: (o) => 1 / (1 + o.g.rr1),
  RACE: (o) => (o.raceP != null ? Math.min(0.98, Math.max(0.02, o.raceP)) : 1 / (1 + o.g.rr1)),
  M0: (o) => predict(fitted.M0, o),
  M1: (o) => predict(fitted.M1, o),
  M2: (o) => predict(fitted.M2, o),
};
function pairedZ(a, b) {
  const items = OOS.map((o) => ({ day: o.day, d: ll(preds[a](o), o.s.t1 ? 1 : 0) - ll(preds[b](o), o.s.t1 ? 1 : 0) }));
  const n = items.length;
  const mean = items.reduce((s, o) => s + o.d, 0) / n;
  const byDay = new Map();
  for (const o of items) byDay.set(o.day, (byDay.get(o.day) ?? 0) + (o.d - mean));
  let v = 0;
  for (const s of byDay.values()) v += s * s;
  const G = byDay.size;
  const se = (Math.sqrt(v) / n) * Math.sqrt(G / (G - 1));
  return { diff: mean, z: mean / se };
}
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10000) / 10000);
function auc(name) {
  const pos = OOS.filter((o) => o.s.t1).map(preds[name]);
  const neg = OOS.filter((o) => !o.s.t1).map(preds[name]);
  let w = 0;
  for (const p of pos) for (const q of neg) w += p > q ? 1 : p === q ? 0.5 : 0;
  return w / (pos.length * neg.length);
}
const oosTable = {};
for (const name of Object.keys(preds)) {
  const L = OOS.reduce((s, o) => s + ll(preds[name](o), o.s.t1 ? 1 : 0), 0) / OOS.length;
  const B = OOS.reduce((s, o) => s + (preds[name](o) - (o.s.t1 ? 1 : 0)) ** 2, 0) / OOS.length;
  oosTable[name] = { logLoss: r4(L), brier: r4(B), auc: r4(auc(name)), meanP: r4(OOS.reduce((s, o) => s + preds[name](o), 0) / OOS.length) };
}
const oosRate = OOS.filter((o) => o.s.t1).length / OOS.length;

let chosen = "M0";
const steps = [];
for (const cand of ["M1", "M2"]) {
  const t = pairedZ(cand, chosen);
  const win = t.diff < 0 && t.z <= -2;
  steps.push({ candidate: cand, vs: chosen, dLogLoss: r4(t.diff), z: r4(t.z), replaces: win });
  if (win) chosen = cand;
}
const vsRace = pairedZ(chosen, "RACE");
const vsRw = pairedZ(chosen, "RW");

// Calibration of the chosen model, out of sample.
function calibration(name) {
  const ps = OOS.map((o) => ({ p: preds[name](o), y: o.s.t1 ? 1 : 0, R: o.s.R })).sort((a, b) => a.p - b.p);
  const dec = [];
  for (let d = 0; d < 10; d++) {
    const sl = ps.slice(Math.floor((d * ps.length) / 10), Math.floor(((d + 1) * ps.length) / 10));
    dec.push({ n: sl.length, meanP: r4(sl.reduce((s, o) => s + o.p, 0) / sl.length), hitRate: r4(sl.reduce((s, o) => s + o.y, 0) / sl.length), meanR: r4(sl.reduce((s, o) => s + o.R, 0) / sl.length) });
  }
  // slope: 1-D logistic of y on logit(p)
  let a = 0, b1 = 1;
  for (let it = 0; it < 50; it++) {
    let g0 = 0, g1 = 0, h00 = 0, h01 = 0, h11 = 0;
    for (const o of ps) {
      const x = Math.log(Math.max(1e-6, o.p) / Math.max(1e-6, 1 - o.p));
      const mu = sig(a + b1 * x);
      const wt = mu * (1 - mu);
      g0 += o.y - mu; g1 += (o.y - mu) * x;
      h00 += wt; h01 += wt * x; h11 += wt * x * x;
    }
    const det = h00 * h11 - h01 * h01;
    const da = (h11 * g0 - h01 * g1) / det, db = (h00 * g1 - h01 * g0) / det;
    a += da; b1 += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { deciles: dec, slope: r4(b1), meanP: r4(ps.reduce((s, o) => s + o.p, 0) / ps.length), hitRate: r4(oosRate) };
}
const calib = calibration(chosen);

/* ── Payoff split, fill rates, production refit, effects ─────────────────── */

function payoffOf(items) {
  const win = items.filter((o) => o.s.t1);
  const lose = items.filter((o) => !o.s.t1);
  const mx = win.reduce((s, o) => s + o.g.rr1, 0) / win.length;
  const my = win.reduce((s, o) => s + o.s.R, 0) / win.length;
  let sxy = 0, sxx = 0;
  for (const o of win) { sxy += (o.g.rr1 - mx) * (o.s.R - my); sxx += (o.g.rr1 - mx) ** 2; }
  const winB = sxx > 0 ? sxy / sxx : 0;
  return { winA: my - winB * mx, winB, lossMean: lose.reduce((s, o) => s + o.s.R, 0) / lose.length };
}
// E[R] check out of sample: IS model + IS payoff, priced on 2025–26 fills.
const payIS = payoffOf(IS);
const eROos = OOS.map((o) => {
  const p = preds[chosen](o);
  return { e: p * (payIS.winA + payIS.winB * o.g.rr1) + (1 - p) * payIS.lossMean, R: o.s.R };
}).sort((a, b) => a.e - b.e);
const eRQuint = [];
for (let q = 0; q < 5; q++) {
  const sl = eROos.slice(Math.floor((q * eROos.length) / 5), Math.floor(((q + 1) * eROos.length) / 5));
  eRQuint.push({ n: sl.length, expR: r4(sl.reduce((s, o) => s + o.e, 0) / sl.length), realizedR: r4(sl.reduce((s, o) => s + o.R, 0) / sl.length) });
}

const tierOf = (o) => o.g.tier;
const fillByTier = {};
for (const t of ["LIVE", "ARMED", "FORMING"]) {
  const all = cards.filter((o) => tierOf(o) === t);
  fillByTier[t] = r4(all.filter((o) => o.s.filled).length / all.length);
}

const prodLambda = fitted[chosen].lambda;
const prod = fit(fills, MODELS[chosen], prodLambda);
// Day-block bootstrap of the production fit, for driver intervals.
const daysAll = [...new Set(fills.map((o) => o.day))];
const byDay = new Map();
for (const o of fills) { if (!byDay.has(o.day)) byDay.set(o.day, []); byDay.get(o.day).push(o); }
let seed = 12345;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const draws = MODELS[chosen].map(() => []);
for (let b = 0; b < BOOT; b++) {
  const sample = [];
  for (let k = 0; k < daysAll.length; k++) sample.push(...byDay.get(daysAll[Math.floor(rnd() * daysAll.length)]));
  const m = fit(sample, MODELS[chosen], prodLambda);
  MODELS[chosen].forEach((_, j) => draws[j].push(m.w[j + 1]));
}
const effects = {};
MODELS[chosen].forEach((k, j) => {
  const d = draws[j].sort((a, b) => a - b);
  effects[k] = { coef: r4(prod.w[j + 1]), lo: r4(d[Math.floor(0.025 * d.length)]), hi: r4(d[Math.floor(0.975 * d.length) - 1]), n: fills.filter((o) => o.f[k] !== 0).length };
});
const pay = payoffOf(fills);

const model = {
  version: 1,
  builtAt: new Date().toISOString(),
  script: "scripts/build-hit-odds.mjs",
  target: "P(T1 reached | filled) under the live rule: limit at CE, failed-hold exit before T1, hard stop, 50% at T1 / BE / runner, 8h hold",
  chosen,
  lambda: prodLambda,
  features: MODELS[chosen],
  intercept: r4(prod.w[0]),
  coef: Object.fromEntries(MODELS[chosen].map((k, j) => [k, r4(prod.w[j + 1])])),
  scale: Object.fromEntries(Object.entries(prod.sc).map(([k, v]) => [k, { mean: r4(v.mean), sd: r4(v.sd) }])),
  payoff: { winA: r4(pay.winA), winB: r4(pay.winB), lossMean: r4(pay.lossMean) },
  fillByTier,
  effects,
  n: { cards: cards.length, fills: fills.length, t1: fills.filter((o) => o.s.t1).length },
  validation: {
    rule: "fit 2022–24, test 2025–26; a richer model replaces a simpler one only with OOS log-loss z <= −2 (day-clustered, paired)",
    isN: IS.length, oosN: OOS.length, oosHitRate: r4(oosRate),
    oos: oosTable,
    steps,
    chosenVsRace: { dLogLoss: r4(vsRace.diff), z: r4(vsRace.z) },
    chosenVsRandomWalk: { dLogLoss: r4(vsRw.diff), z: r4(vsRw.z) },
    calibration: calib,
    expectedRByQuintile: eRQuint,
    lambdas: Object.fromEntries(Object.entries(fitted).map(([k, v]) => [k, v.lambda])),
  },
};
// SECONDARY, NOT PRE-REGISTERED AS A DECISION: the full model's individual
// effects on all four years, with the same bootstrap. Reported so each piece
// of research has its own number; it decides nothing — the model above does.
if (chosen !== "M1") {
  const m1 = fit(fills, MODELS.M1, fitted.M1.lambda);
  const dr = MODELS.M1.map(() => []);
  let s2 = 999;
  const rnd2 = () => ((s2 = (s2 * 1103515245 + 12345) % 2147483648) / 2147483648);
  for (let b = 0; b < BOOT; b++) {
    const sample = [];
    for (let k = 0; k < daysAll.length; k++) sample.push(...byDay.get(daysAll[Math.floor(rnd2() * daysAll.length)]));
    const m = fit(sample, MODELS.M1, fitted.M1.lambda);
    MODELS.M1.forEach((_, j) => dr[j].push(m.w[j + 1]));
  }
  model.validation.secondaryM1Effects = Object.fromEntries(
    MODELS.M1.map((k, j) => {
      const d = dr[j].sort((a, b) => a - b);
      // Average marginal effect in probability points: mean over fills of
      // p(feature on) − p(feature off) for binaries, ±1 sd for continuous.
      const pOf = (o, v) => {
        const f2 = { ...o, f: { ...o.f, [k]: v } };
        return predict(m1, f2);
      };
      const sd = m1.sc[k]?.sd;
      const ame = fills.reduce((s, o) => s + (sd ? pOf(o, o.f[k] + sd / 2) - pOf(o, o.f[k] - sd / 2) : pOf(o, 1) - pOf(o, 0)), 0) / fills.length;
      return [k, { coef: r4(m1.w[j + 1]), lo: r4(d[Math.floor(0.025 * d.length)]), hi: r4(d[Math.floor(0.975 * d.length) - 1]), pts: r4(ame * 100), n: fills.filter((o) => o.f[k] !== 0).length }];
    }),
  );
}
writeFileSync(OUT, JSON.stringify(model, null, 1) + "\n");
if (model.validation.secondaryM1Effects) {
  console.log(`\nSECONDARY — full model (M1), each feature's own effect, all years (NOT shipped):`);
  for (const [k, e] of Object.entries(model.validation.secondaryM1Effects)) {
    console.log(`  ${k.padEnd(13)} ${e.pts >= 0 ? "+" : ""}${e.pts} pts  coef ${e.coef} [${e.lo}, ${e.hi}]  n=${e.n}${e.lo > 0 || e.hi < 0 ? "  *" : ""}`);
  }
}

console.log(`\nOOS 2025–26: n=${OOS.length}, T1 hit ${(oosRate * 100).toFixed(1)}%`);
for (const [k, v] of Object.entries(oosTable)) console.log(`  ${k.padEnd(5)} logloss ${v.logLoss}  brier ${v.brier}  AUC ${v.auc}  mean p ${v.meanP}`);
for (const s of steps) console.log(`  ${s.candidate} vs ${s.vs}: Δlogloss ${s.dLogLoss} z ${s.z} → ${s.replaces ? "REPLACES" : "stays"}`);
console.log(`  chosen ${chosen} vs RACE Δ ${r4(vsRace.diff)} z ${r4(vsRace.z)} · vs RW Δ ${r4(vsRw.diff)} z ${r4(vsRw.z)}`);
console.log(`\ncalibration (${chosen}, OOS): slope ${calib.slope}, mean p ${calib.meanP} vs hit ${calib.hitRate}`);
for (const d of calib.deciles) console.log(`  p ${d.meanP}  hit ${d.hitRate}  R ${d.meanR}  n ${d.n}`);
console.log(`\nE[R] by quintile (OOS): ${eRQuint.map((q) => `${q.expR}→${q.realizedR}`).join("  ")}`);
console.log(`fill by tier: ${JSON.stringify(fillByTier)}  payoff ${JSON.stringify(model.payoff)}`);
console.log(`\neffects (${chosen}, all years, 95% day-bootstrap):`);
for (const [k, e] of Object.entries(effects)) console.log(`  ${k.padEnd(13)} ${e.coef >= 0 ? "+" : ""}${e.coef}  [${e.lo}, ${e.hi}]  n=${e.n}${e.lo > 0 || e.hi < 0 ? "  *" : ""}`);
console.log(`\nwrote ${OUT}`);
