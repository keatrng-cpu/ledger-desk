/**
 * Does accumulation (a pre-sweep range), manipulation quality (depth/speed/
 * shape of the raid), distribution quality (magnitude/CLV/run-length of the
 * displacement leg), or the newly-fixed mitigation block predict anything
 * beyond what the current engine already captures?
 *
 * WHY THIS IS SEPARATE, EXPLORATORY, NOT WIRED INTO capture-signals.mjs
 * Same reasoning as measure-inducement-news.mjs: re-derive from data already
 * on disk as a post-processing pass, not a re-run of the full desk assembly.
 * Nothing here is read by the live app. This measures first.
 *
 * SAME POPULATION, SAME STATISTICAL BAR AS evidence-pack.json / inducement
 * Same filter (no Judas, no news-blackout row, conf >= 0.65), same sim()
 * (limit at CE, 50% at T1, stop to BE, runner to T2, ties against), same
 * day-clustered 95% CI, same both-halves-IS/OOS-agree-in-sign rule before a
 * bucket is allowed to say POSITIVE or NEGATIVE.
 *
 * ORIGIN: 2026-09-30 research pass (4 parallel research agents, one per
 * concept) found accumulation/manipulation-quality/distribution-quality all
 * have real lineage (Wyckoff/ICT/TJR) but ZERO published depth/duration/
 * shape threshold anywhere in that lineage, and the closest peer-reviewed
 * test of the nearest mechanical analogue (Sullivan/Timmermann/White 1999,
 * channel-breakout rules) found the apparent edge was a data-snooping
 * artifact. detectors.ts ships these as RAW FACT EXTRACTORS with NO
 * pre-baked score for exactly this reason — this script decides bucket
 * edges from the data, not the other way around. Mitigation is different:
 * it fixes a confirmed `X && !X` dead-code bug in scanner.ts independent of
 * whether the concept has edge (see detectMitigationBlock's docstring).
 *
 * PERFORMANCE: detectSweeps()/detectMitigationBlock() are O(n * swings) —
 * fine once per symbol on the full history, NOT fine called per-row on an
 * unbounded slice (an 8-billion-operation bug was caught and fixed this
 * session for exactly this mistake in build-evidence-pack.mjs). Every
 * per-row call below runs on a small bounded slice, rebased to local
 * indices — never the full multi-year array.
 *
 * Run: npx tsx scripts/measure-amd-signals.mjs
 * In:  .cache/signals/signals-*.json, src/data/history-4y.json
 * Out: .cache/amd-signals-measurement.json (exploratory — not read by the app)
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const OUT = ".cache/amd-signals-measurement.json";
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const FLOOR = 0.65;
const TP1_FRACTION = 0.5;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const MIN_READ = 30;

// Same recency window the live engine reads a sweep/displacement as "the
// current one" through (measure-inducement-news.mjs's own MAIN_SWEEP_WINDOW_BARS).
const RECENT_WINDOW_BARS = 24;
// Bounded lookback slices for per-row detector calls — see PERFORMANCE above.
const ACCUM_SLICE_PAD = 65; // > ACCUM_LOOKBACK_BARS(40) + margin
const QUALITY_SLICE_PAD = 40; // > ATR_PERIOD(14) + MM_DISPLACE_WITHIN(6) + margin
const MITIGATION_SLICE_BARS = 300; // matches the fixed inducement lookback

const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const {
  detectSweeps,
  detectDisplacements,
  detectAccumulation,
  gradeSweepQuality,
  gradeDisplacementQuality,
  detectMitigationBlock,
} = await import("../src/lib/trading/detectors.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

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
const captured = rows.length;
rows = rows.filter((r) => !r.judas && !r.news && r.conf >= FLOOR);
rows.sort((a, b) => a.t - b.t);

const yearOf = (t) => new Date(t).getUTCFullYear();
const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${w.month}-${w.day}`;
};
const isNyAm = (t) => {
  const w = etWallParts(t);
  const mins = w.hour * 60 + w.minute;
  return mins >= 9 * 60 + 45 && mins < 11 * 60;
};

/* ── Cached per-symbol full-history detector runs (once each, not per-row) ── */

const sweepCache = new Map();
const sweepsFor = (sym) => {
  if (!sweepCache.has(sym)) sweepCache.set(sym, detectSweeps(BARS[sym]));
  return sweepCache.get(sym);
};
const dispCache = new Map();
const dispsFor = (sym) => {
  if (!dispCache.has(sym)) dispCache.set(sym, detectDisplacements(BARS[sym]));
  return dispCache.get(sym);
};

/** Most recent sweep of the side this row's direction needs, at or before
 *  bar i, within RECENT_WINDOW_BARS — same polarity rule as detectInducement. */
function mainSweepAt(sym, i, side) {
  const wantSide = side === "long" ? "sellside" : "buyside";
  const all = sweepsFor(sym).filter((s) => s.index <= i && s.side === wantSide);
  if (!all.length) return null;
  const main = all[all.length - 1];
  return i - main.index > RECENT_WINDOW_BARS ? null : main;
}

/** Most recent displacement agreeing with this row's direction, at or before
 *  bar i, within RECENT_WINDOW_BARS. */
function mainDisplacementAt(sym, i, side) {
  const wantDir = side === "long" ? "bull" : "bear";
  const all = dispsFor(sym).filter((d) => d.index <= i && d.direction === wantDir);
  if (!all.length) return null;
  const main = all[all.length - 1];
  return i - main.index > RECENT_WINDOW_BARS ? null : main;
}

/** Rebase a full-history index onto a bounded slice for a per-row detector
 *  call — see file header PERFORMANCE note. */
function slicedCall(bars, anchorIndex, pad, fn) {
  const start = Math.max(0, anchorIndex - pad);
  const slice = bars.slice(start, anchorIndex + 1);
  return fn(slice, anchorIndex - start);
}

/* ── sim() and dirHit(), identical to build-evidence-pack.mjs / measure-inducement-news.mjs ── */

function sim(r) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const E = r.e, S = r.s;
  const risk = Math.abs(E - S);
  if (!(risk > 0) || r.t1 == null) return null;
  if (long ? r.t1 <= E : r.t1 >= E) return null;
  const t2 = r.t2 != null && (long ? r.t2 > r.t1 : r.t2 < r.t1) ? r.t2 : null;
  const hitStop = (b, lvl) => (long ? b.l <= lvl : b.h >= lvl);
  const hitTgt = (b, lvl) => (long ? b.h >= lvl : b.l <= lvl);

  let fi = null;
  for (let k = 1; k <= FILL_BARS && r.i + k < bars.length; k++) {
    const b = bars[r.i + k];
    if (long ? b.l <= E : b.h >= E) { fi = r.i + k; break; }
  }
  if (fi == null) return { filled: false };

  let stop = S, rem = 1, banked = 0, t1Done = false;
  const rOf = (px) => (long ? px - E : E - px) / risk;
  for (let k = fi; k < bars.length && k < fi + HOLD_BARS; k++) {
    const b = bars[k];
    if (hitStop(b, stop)) {
      const px = long ? stop - TICK : stop + TICK;
      banked += rOf(px) * rem;
      return { filled: true, R: banked, t1: t1Done };
    }
    if (k === fi) continue;
    if (!t1Done && hitTgt(b, r.t1)) {
      t1Done = true;
      if (t2 == null) { banked += rOf(r.t1) * rem; return { filled: true, R: banked, t1: true }; }
      banked += rOf(r.t1) * TP1_FRACTION;
      rem -= TP1_FRACTION;
      stop = E;
      continue;
    }
    if (t1Done && t2 != null && hitTgt(b, t2)) {
      banked += rOf(t2) * rem;
      return { filled: true, R: banked, t1: true };
    }
  }
  const li = Math.min(bars.length, fi + HOLD_BARS) - 1;
  banked += rOf(bars[li].c) * rem;
  return { filled: true, R: banked, t1: t1Done };
}

function dirHit(r) {
  const b = BARS[r.sym];
  if (r.i + 16 >= b.length) return null;
  const net = b[r.i + 16].c - b[r.i].c;
  if (Math.abs(net) < 1e-9) return null;
  return (r.side === "long") === net > 0;
}

/* ── Build sim rows once, with all four features attached ────────────────── */

const sims = [];
for (const r of rows) {
  const s = sim(r);
  if (!s) continue;
  const bars = BARS[r.sym];
  const side = r.side;

  const mainSweep = mainSweepAt(r.sym, r.i, side);
  const mainDisp = mainDisplacementAt(r.sym, r.i, side);

  let accum = null;
  let sweepQ = null;
  if (mainSweep) {
    accum = slicedCall(bars, mainSweep.index, ACCUM_SLICE_PAD, (slice, idx) =>
      detectAccumulation(slice, { ...mainSweep, index: idx }),
    );
    sweepQ = slicedCall(bars, mainSweep.index, QUALITY_SLICE_PAD, (slice, idx) =>
      gradeSweepQuality(slice, { ...mainSweep, index: idx }),
    );
  }

  let dispQ = null;
  if (mainDisp) {
    dispQ = slicedCall(bars, mainDisp.index, QUALITY_SLICE_PAD, (slice, idx) =>
      gradeDisplacementQuality(slice, { ...mainDisp, index: idx }),
    );
  }

  const mStart = Math.max(0, r.i + 1 - MITIGATION_SLICE_BARS);
  const mitigation = detectMitigationBlock(bars.slice(mStart, r.i + 1), side);

  sims.push({
    r, ...s,
    y: yearOf(r.t),
    day: dayKey(r.t),
    dir: dirHit(r),
    nyAm: isNyAm(r.t),
    hasMainSweep: mainSweep != null,
    hasMainDisp: mainDisp != null,
    accumPresent: accum?.present ?? null,
    accumRangeAtr: accum?.rangeAtrRatio ?? null,
    sweepDepthAtr: sweepQ?.depthAtr ?? null,
    sweepSpeedBars: sweepQ?.speedBars ?? null,
    dispRatio: dispQ?.ratio ?? null,
    dispClv: dispQ?.directionalClv ?? null,
    dispRun: dispQ?.runLength ?? null,
    mitigationPresent: mitigation.present,
  });
}

/* ── Same clustered()/bucket() statistical methodology as build-evidence-pack.mjs ── */

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
    key, label, signals, n,
    fillRate: r3(signals ? n / signals : null),
    exp: r3(pooled?.mean ?? null),
    lo: r3(pooled?.lo ?? null),
    hi: r3(pooled?.hi ?? null),
    isExp: r3(isExp), oosExp: r3(oosExp),
    isN: isF.length, oosN: oosF.length,
    t1Rate: r3(t1Rate),
    dirHit: r3(dirs.length >= MIN_READ ? dirs.filter(Boolean).length / dirs.length : null),
    dirN: dirs.length,
    verdict,
  };
}

/** Pearson r, for the "is this just re-measuring X" falsification checks. */
function corr(pairs) {
  const n = pairs.length;
  if (n < MIN_READ) return null;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) {
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? +(sxy / Math.sqrt(sxx * syy)).toFixed(3) : null;
}

const withMainSweep = sims.filter((o) => o.hasMainSweep);
const withMainDisp = sims.filter((o) => o.hasMainDisp);

const result = {
  builtAt: new Date().toISOString(),
  source: {
    capture: `${SIGDIR} (${captured} plan moments, ${rows.length} at or above the floor after Judas/news refusal)`,
    simulated: sims.length,
    filled: sims.filter((o) => o.filled).length,
    withMainSweepInWindow: withMainSweep.length,
    withMainDisplacementInWindow: withMainDisp.length,
  },
  note:
    "Exploratory. Same population, same sim, same verdict bar as evidence-pack.json. " +
    "Nothing here is read by the live app until a finding is wired in explicitly.",

  baseline: bucket("all", "every card in this population (sanity check)", sims),

  accumulation: [
    bucket("present", "pre-sweep range present (deterministic anchor)", withMainSweep.filter((o) => o.accumPresent === true)),
    bucket("absent", "no qualifying pre-sweep range", withMainSweep.filter((o) => o.accumPresent === false)),
  ],
  accumulationPresentRate: r3(
    withMainSweep.length
      ? withMainSweep.filter((o) => o.accumPresent === true).length / withMainSweep.length
      : null,
  ),

  sweepDepth: [
    bucket("shallow<0.15atr", "raid depth < 0.15x ATR (near the equal-highs noise floor)", withMainSweep.filter((o) => o.sweepDepthAtr != null && o.sweepDepthAtr < 0.15)),
    bucket("mid0.15-0.50atr", "raid depth 0.15-0.50x ATR", withMainSweep.filter((o) => o.sweepDepthAtr != null && o.sweepDepthAtr >= 0.15 && o.sweepDepthAtr < 0.5)),
    bucket("committed0.50-1.20atr", "raid depth 0.50-1.20x ATR", withMainSweep.filter((o) => o.sweepDepthAtr != null && o.sweepDepthAtr >= 0.5 && o.sweepDepthAtr < 1.2)),
    bucket("overextended>1.20atr", "raid depth > 1.20x ATR", withMainSweep.filter((o) => o.sweepDepthAtr != null && o.sweepDepthAtr >= 1.2)),
  ],
  sweepSpeed: [
    bucket("1bar", "single-bar raid", withMainSweep.filter((o) => o.sweepSpeedBars === 1)),
    bucket("2-3bar", "2-3 bar raid", withMainSweep.filter((o) => o.sweepSpeedBars != null && o.sweepSpeedBars >= 2 && o.sweepSpeedBars <= 3)),
    bucket("4plusbar", "4+ bar raid", withMainSweep.filter((o) => o.sweepSpeedBars != null && o.sweepSpeedBars >= 4)),
  ],
  // Falsification check flagged by the research: is sweep depth just
  // displacement ratio measured on the (frequently identical) same bar?
  sweepDepthVsDisplacementRatio: corr(
    sims
      .filter((o) => o.sweepDepthAtr != null && o.dispRatio != null)
      .map((o) => [o.sweepDepthAtr, o.dispRatio]),
  ),

  displacementRatio: [
    bucket("1.5-2.0atr", "displacement 1.5-2.0x ATR (today's whole boolean-true population's lower half)", withMainDisp.filter((o) => o.dispRatio != null && o.dispRatio < 2.0)),
    bucket("2.0-3.0atr", "displacement 2.0-3.0x ATR", withMainDisp.filter((o) => o.dispRatio != null && o.dispRatio >= 2.0 && o.dispRatio < 3.0)),
    bucket("3.0-4.5atr", "displacement 3.0-4.5x ATR", withMainDisp.filter((o) => o.dispRatio != null && o.dispRatio >= 3.0 && o.dispRatio < 4.5)),
    bucket("4.5plusAtr", "displacement > 4.5x ATR", withMainDisp.filter((o) => o.dispRatio != null && o.dispRatio >= 4.5)),
  ],
  displacementClv: [
    bucket("clvPositive", "closed toward its own direction (CLV > 0)", withMainDisp.filter((o) => o.dispClv != null && o.dispClv > 0)),
    bucket("clvNegative", "closed against its own direction (CLV < 0) — rejection tail on a qualifying body", withMainDisp.filter((o) => o.dispClv != null && o.dispClv <= 0)),
  ],
  displacementRun: [
    bucket("run1", "displacement bar stood alone", withMainDisp.filter((o) => o.dispRun === 1)),
    bucket("run2", "one supporting bar before it", withMainDisp.filter((o) => o.dispRun === 2)),
    bucket("run3plus", "2+ supporting bars before it", withMainDisp.filter((o) => o.dispRun != null && o.dispRun >= 3)),
  ],
  // Falsification check: does displacement quality correlate with reach only
  // in the pooled sample, or does it survive stratifying by session (the
  // confound every researcher flagged as most likely to produce a false
  // positive here)?
  displacementQualityBySession: [
    bucket("nyAm|highRatio", "NY AM, displacement >= 3.0x ATR", withMainDisp.filter((o) => o.nyAm && o.dispRatio != null && o.dispRatio >= 3.0)),
    bucket("nyAm|lowRatio", "NY AM, displacement 1.5-3.0x ATR", withMainDisp.filter((o) => o.nyAm && o.dispRatio != null && o.dispRatio < 3.0)),
    bucket("other|highRatio", "outside NY AM, displacement >= 3.0x ATR", withMainDisp.filter((o) => !o.nyAm && o.dispRatio != null && o.dispRatio >= 3.0)),
    bucket("other|lowRatio", "outside NY AM, displacement 1.5-3.0x ATR", withMainDisp.filter((o) => !o.nyAm && o.dispRatio != null && o.dispRatio < 3.0)),
  ],

  mitigation: [
    bucket("present", "mitigation block present (fixed detector)", sims.filter((o) => o.mitigationPresent === true)),
    bucket("absent", "no mitigation block", sims.filter((o) => o.mitigationPresent === false)),
  ],
  mitigationPresentRate: r3(sims.length ? sims.filter((o) => o.mitigationPresent === true).length / sims.length : null),
};

writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");

const show = (b) =>
  `${b.label.padEnd(66)} n=${String(b.n).padStart(4)}  exp ${b.exp == null ? "  —   " : (b.exp >= 0 ? "+" : "") + b.exp.toFixed(3)}  [${b.lo ?? "—"}, ${b.hi ?? "—"}]  IS ${b.isExp ?? "—"} OOS ${b.oosExp ?? "—"}  t1 ${b.t1Rate == null ? "—" : (b.t1Rate * 100).toFixed(1) + "%"}  dir ${b.dirHit == null ? "—" : (b.dirHit * 100).toFixed(1) + "%"}  ${b.verdict.toUpperCase()}`;

console.log(result.source.capture);
console.log(
  `simulated ${result.source.simulated}, filled ${result.source.filled}, ` +
    `with main sweep ${result.source.withMainSweepInWindow}, with main displacement ${result.source.withMainDisplacementInWindow}\n`,
);
console.log(show(result.baseline));
console.log(`\naccumulation present-rate: ${result.accumulationPresentRate == null ? "—" : (result.accumulationPresentRate * 100).toFixed(1) + "%"}`);
console.log(`mitigation present-rate:   ${result.mitigationPresentRate == null ? "—" : (result.mitigationPresentRate * 100).toFixed(1) + "%"}`);
console.log(`sweep-depth vs displacement-ratio correlation: ${result.sweepDepthVsDisplacementRatio ?? "— (thin)"}`);
for (const k of [
  "accumulation", "sweepDepth", "sweepSpeed",
  "displacementRatio", "displacementClv", "displacementRun", "displacementQualityBySession",
  "mitigation",
]) {
  console.log(`\n${k}`);
  for (const b of result[k]) console.log("  " + show(b));
}
console.log(`\nwrote ${OUT}`);
