/**
 * The trader's model research (2026-10-01: the 2022 model, Power of 3, the
 * Market Maker models, Silver Bullet, NY AM/PM, OTE, …) reduced to the claims
 * that are TESTABLE on this desk's four-year tape and not yet tested, plus a
 * proper re-test of the two vetoes already wired.
 *
 * CLAIMS
 *   A. "A sweep that does not run a pool is just a wick." The card's raid took
 *      a NAMED pool — prior day high/low, prior week high/low, Asia (20:00–
 *      00:00 ET) or London (02:00–05:00 ET) high/low — wick through, close
 *      back inside — vs a generic fractal swing.
 *   B. ICT's Silver Bullet minimum objective (2023-05-15, verified): at least
 *      10 handles to the target on indices. ES ≥ 10 points; MNQ ≥ 40 (NQ
 *      trades ~4× ES in points). Entry → T1 distance.
 *   C. "Do not fade the drive if the daily objective is still open" / NY PM
 *      "direction comes from whether the daily objective is met": has the
 *      card's OWN-side daily objective (PDH for longs, PDL for shorts) already
 *      been taken today before the decision bar? And the opposite side
 *      (the Power-of-3 manipulation leg) taken?
 *   D. OTE (ICT, verified 62–79%): the card's entry inside the 62–79%
 *      retracement of the post-raid leg, vs shallower or deeper.
 *   E. RE-TEST of the inducement and mitigation vetoes with the same
 *      difference test (they were wired on "bucket negative in both halves",
 *      which the population baseline itself satisfies).
 *
 * DECISION RULE, FIXED BEFORE THE FIRST RUN
 * The population averages −0.139R, so "negative in both halves" alone says
 * nothing about a bucket being WORSE. A claim is acted on only if BOTH:
 *   1. the bucket's verdict is NEGATIVE or POSITIVE (both halves agree in
 *      sign, day-clustered 95% CI excludes zero, n ≥ 30, ≥15 per half), and
 *   2. the difference from its complement is |z| ≥ 2 on a day-clustered
 *      difference test (influence functions summed by day, so shared market
 *      days are not double-counted as independent evidence).
 * Negative and significant → scanner veto. Positive and significant → a
 * candidate score input, reported for the trader's call. Anything else →
 * documented, not wired.
 *
 * Same population, same sim() as build-evidence-pack.mjs.
 *
 * Run: npx tsx scripts/measure-model-claims.mjs
 * Out: .cache/model-claims-measurement.json (exploratory)
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const OUT = ".cache/model-claims-measurement.json";
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const FLOOR = 0.65;
const TP1_FRACTION = 0.5;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const MIN_READ = 30;
const RECENT_WINDOW_BARS = 24;
const SLICE = 300;
const MIN_OBJECTIVE = { ES: 10, MNQ: 40 };

const { etWallParts, etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");
const { detectSweeps, detectInducement, detectMitigationBlock } = await import("../src/lib/trading/detectors.ts");
const { tradeDateOf } = await import("../src/lib/trading/tf-ladder.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

/* ── Per-symbol session index, built once ────────────────────────────────── */

function weekKey(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}

const IDX = {};
for (const sym of Object.keys(BARS)) {
  const bars = BARS[sym];
  const days = [];
  const dayOf = new Int32Array(bars.length);
  const minuteOf = new Int16Array(bars.length); // ET minutes of day
  for (let i = 0; i < bars.length; i++) {
    const p = etWallParts(bars[i].t);
    minuteOf[i] = p.hour * 60 + p.minute;
    const td = tradeDateOf(bars[i].t);
    if (!days.length || days[days.length - 1].date !== td) days.push({ date: td, start: i, end: i, week: weekKey(td) });
    else days[days.length - 1].end = i;
    dayOf[i] = days.length - 1;
  }
  for (const d of days) {
    let h = -Infinity, l = Infinity;
    const asia = { h: -Infinity, l: Infinity, end: null };
    const london = { h: -Infinity, l: Infinity, end: null };
    for (let i = d.start; i <= d.end; i++) {
      const b = bars[i];
      h = Math.max(h, b.h);
      l = Math.min(l, b.l);
      const m = minuteOf[i];
      if (m >= 20 * 60) { asia.h = Math.max(asia.h, b.h); asia.l = Math.min(asia.l, b.l); asia.end = i; }
      if (m >= 2 * 60 && m < 5 * 60) { london.h = Math.max(london.h, b.h); london.l = Math.min(london.l, b.l); london.end = i; }
    }
    Object.assign(d, { h, l, asia, london });
  }
  // Prior week's range, by week key.
  const weeks = new Map();
  for (const d of days) {
    const w = weeks.get(d.week) ?? { h: -Infinity, l: Infinity };
    w.h = Math.max(w.h, d.h);
    w.l = Math.min(w.l, d.l);
    weeks.set(d.week, w);
  }
  const weekOrder = [...weeks.keys()];
  IDX[sym] = { days, dayOf, minuteOf, weeks, weekOrder };
}

/** Named pools visible at bar i (sessions only once they have ENDED before i). */
function namedPools(sym, i) {
  const { days, dayOf, weeks, weekOrder } = IDX[sym];
  const k = dayOf[i];
  const today = days[k];
  const prev = days[k - 1];
  const out = { highs: [], lows: [] };
  if (prev) { out.highs.push(["PDH", prev.h]); out.lows.push(["PDL", prev.l]); }
  const wi = weekOrder.indexOf(today.week);
  if (wi > 0) { const pw = weeks.get(weekOrder[wi - 1]); out.highs.push(["PWH", pw.h]); out.lows.push(["PWL", pw.l]); }
  if (today.asia.end != null && today.asia.end < i) { out.highs.push(["Asia H", today.asia.h]); out.lows.push(["Asia L", today.asia.l]); }
  if (today.london.end != null && today.london.end < i) { out.highs.push(["London H", today.london.h]); out.lows.push(["London L", today.london.l]); }
  return out;
}

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
const captured = rows.length;
rows = rows.filter((r) => !r.judas && !r.news && r.conf >= FLOOR);
rows.sort((a, b) => a.t - b.t);

const yearOf = (t) => new Date(t).getUTCFullYear();
const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${w.month}-${w.day}`;
};

const sweepCache = new Map();
const sweepsFor = (sym) => {
  if (!sweepCache.has(sym)) sweepCache.set(sym, detectSweeps(BARS[sym]));
  return sweepCache.get(sym);
};
function mainSweepAt(sym, i, side) {
  const want = side === "long" ? "sellside" : "buyside";
  const all = sweepsFor(sym).filter((s) => s.index <= i && s.side === want);
  if (!all.length) return null;
  const main = all[all.length - 1];
  return i - main.index > RECENT_WINDOW_BARS ? null : main;
}

/* ── sim() and dirHit(), identical to build-evidence-pack.mjs ─────────────── */

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

/* ── Features ────────────────────────────────────────────────────────────── */

const sims = [];
for (const r of rows) {
  const s = sim(r);
  if (!s) continue;
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const { days, dayOf } = IDX[r.sym];
  const k = dayOf[r.i];
  const today = days[k];
  const prev = days[k - 1];

  // A — did the main raid take a named pool?
  const sw = mainSweepAt(r.sym, r.i, r.side);
  let named = null;
  let namedPool = null;
  if (sw) {
    const b = bars[sw.index];
    const pools = namedPools(r.sym, sw.index);
    const hit = long
      ? pools.lows.find(([, L]) => b.l < L && b.c > L)
      : pools.highs.find(([, Hh]) => b.h > Hh && b.c < Hh);
    named = hit != null;
    namedPool = hit ? hit[0] : null;
  }

  // B — distance to the first target, in index points.
  const tgtPts = Math.abs(r.t1 - r.e);
  const minObj = MIN_OBJECTIVE[r.sym] ?? 10;

  // C — daily objectives taken today before the decision bar.
  let ownMet = null;
  let oppMet = null;
  if (prev) {
    let h = -Infinity, l = Infinity;
    for (let j = today.start; j <= r.i; j++) { h = Math.max(h, bars[j].h); l = Math.min(l, bars[j].l); }
    ownMet = long ? h > prev.h : l < prev.l;
    oppMet = long ? l < prev.l : h > prev.h;
  }

  // D — where the entry sits in the post-raid leg.
  let ote = null;
  if (sw) {
    let ext = long ? -Infinity : Infinity;
    for (let j = sw.index; j <= r.i; j++) ext = long ? Math.max(ext, bars[j].h) : Math.min(ext, bars[j].l);
    const span = long ? ext - sw.wickExtreme : sw.wickExtreme - ext;
    if (span > 0) {
      const f = long ? (ext - r.e) / span : (r.e - ext) / span;
      ote = f < 0.62 ? "shallow" : f <= 0.79 ? "ote" : f < 1 ? "deep" : "beyond";
    }
  }

  // E — the two vetoes, on the same bounded slice the evidence pack uses.
  const slice = bars.slice(Math.max(0, r.i + 1 - SLICE), r.i + 1);
  const ind = detectInducement(slice, r.side);
  const mit = detectMitigationBlock(slice, r.side);

  sims.push({
    r, ...s, y: yearOf(r.t), day: dayKey(r.t), dir: dirHit(r),
    hasSweep: sw != null, named, namedPool, tgtPts, bigObj: tgtPts >= minObj,
    ownMet, oppMet, ote,
    hasMainSweep: ind.mainSweep != null, inducement: ind.inducement, mitigation: mit.present,
  });
}

/* ── Statistics ──────────────────────────────────────────────────────────── */

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
  return { mean, lo: mean - 1.96 * se, hi: mean + 1.96 * se, se };
}
/** Day-clustered test of mean(A) − mean(B): influence functions summed by day. */
function clusteredDiff(A, B) {
  const a = A.filter((o) => o.filled);
  const b = B.filter((o) => o.filled);
  if (a.length < 2 || b.length < 2) return null;
  const ma = a.reduce((s, o) => s + o.R, 0) / a.length;
  const mb = b.reduce((s, o) => s + o.R, 0) / b.length;
  const byDay = new Map();
  for (const o of a) byDay.set(o.day, (byDay.get(o.day) ?? 0) + (o.R - ma) / a.length);
  for (const o of b) byDay.set(o.day, (byDay.get(o.day) ?? 0) - (o.R - mb) / b.length);
  let v = 0;
  for (const s of byDay.values()) v += s * s;
  const G = byDay.size;
  const se = Math.sqrt(v * (G / (G - 1)));
  return { diff: ma - mb, se, z: se > 0 ? (ma - mb) / se : 0 };
}
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
function bucket(key, label, all) {
  const filled = all.filter((o) => o.filled);
  const n = filled.length;
  const pooled = clustered(filled);
  const isF = filled.filter((o) => IS_YEARS.includes(o.y));
  const oosF = filled.filter((o) => OOS_YEARS.includes(o.y));
  const mean = (a) => (a.length ? a.reduce((s, o) => s + o.R, 0) / a.length : null);
  const isExp = mean(isF);
  const oosExp = mean(oosF);
  const dirs = all.map((o) => o.dir).filter((d) => d !== null);
  let verdict = "thin";
  if (n >= MIN_READ && isF.length >= 15 && oosF.length >= 15) {
    const agree = Math.sign(isExp) === Math.sign(oosExp);
    if (agree && pooled.lo > 0) verdict = "positive";
    else if (agree && pooled.hi < 0) verdict = "negative";
    else verdict = "mixed";
  }
  return {
    key, label, signals: all.length, n,
    exp: r3(pooled?.mean ?? null), lo: r3(pooled?.lo ?? null), hi: r3(pooled?.hi ?? null),
    isExp: r3(isExp), oosExp: r3(oosExp), isN: isF.length, oosN: oosF.length,
    t1Rate: r3(n ? filled.filter((o) => o.t1).length / n : null),
    dirHit: r3(dirs.length >= MIN_READ ? dirs.filter(Boolean).length / dirs.length : null),
    verdict,
  };
}
/** A claim: the bucket, its complement, the difference test, and the rule's verdict. */
function claim(id, label, yes, no) {
  const a = bucket(`${id}|yes`, label, yes);
  const b = bucket(`${id}|no`, `complement of: ${label}`, no);
  const d = clusteredDiff(yes, no);
  const sig = d != null && Math.abs(d.z) >= 2;
  const act =
    sig && a.verdict === "negative" && d.diff < 0
      ? "VETO"
      : sig && a.verdict === "positive" && d.diff > 0
        ? "CANDIDATE BONUS"
        : "document only";
  return { id, label, yes: a, no: b, diff: d && { diff: r3(d.diff), se: r3(d.se), z: r3(d.z) }, act };
}

const withSweep = sims.filter((o) => o.hasSweep);
const withMain = sims.filter((o) => o.hasMainSweep);
const withPrev = sims.filter((o) => o.ownMet != null);
const withLeg = sims.filter((o) => o.ote != null);

const claims = [
  claim("A_named_pool", "raid took a named pool (PDH/PDL, PWH/PWL, Asia, London)", withSweep.filter((o) => o.named), withSweep.filter((o) => !o.named)),
  claim("A_generic", "raid took only a generic swing (no named pool)", withSweep.filter((o) => !o.named), withSweep.filter((o) => o.named)),
  claim("B_small_objective", "T1 under ICT's 10-handle minimum (ES <10, MNQ <40 pts)", sims.filter((o) => !o.bigObj), sims.filter((o) => o.bigObj)),
  claim("C_own_met", "own-side daily objective already taken (late)", withPrev.filter((o) => o.ownMet), withPrev.filter((o) => !o.ownMet)),
  claim("C_opp_met", "opposite-side daily pool already raided (Power-of-3 manipulation done)", withPrev.filter((o) => o.oppMet), withPrev.filter((o) => !o.oppMet)),
  claim("D_in_ote", "entry inside 62–79% OTE of the post-raid leg", withLeg.filter((o) => o.ote === "ote"), withLeg.filter((o) => o.ote !== "ote")),
  claim("D_shallow", "entry shallower than 62% of the post-raid leg", withLeg.filter((o) => o.ote === "shallow"), withLeg.filter((o) => o.ote !== "shallow")),
  claim("E_inducement", "RE-TEST: inducement (shallow decoy sweep first)", withMain.filter((o) => o.inducement), withMain.filter((o) => !o.inducement)),
  claim("E_mitigation", "RE-TEST: mitigation block present", sims.filter((o) => o.mitigation), sims.filter((o) => !o.mitigation)),
];

const namedBreakdown = [...new Set(withSweep.map((o) => o.namedPool).filter(Boolean))].map((p) =>
  bucket(`pool|${p}`, `raid took ${p}`, withSweep.filter((o) => o.namedPool === p)),
);

const result = {
  builtAt: new Date().toISOString(),
  source: { capture: `${SIGDIR} (${captured} plan moments, ${rows.length} at or above the floor)`, simulated: sims.length, filled: sims.filter((o) => o.filled).length },
  baseline: bucket("all", "every card", sims),
  claims,
  namedBreakdown,
};
writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");

const show = (b) =>
  `${b.label.slice(0, 66).padEnd(66)} n=${String(b.n).padStart(4)}  exp ${b.exp == null ? "  —   " : (b.exp >= 0 ? "+" : "") + b.exp.toFixed(3)}  [${b.lo ?? "—"}, ${b.hi ?? "—"}]  IS ${b.isExp ?? "—"} OOS ${b.oosExp ?? "—"}  dir ${b.dirHit == null ? "—" : (b.dirHit * 100).toFixed(1) + "%"}  ${b.verdict.toUpperCase()}`;
console.log(result.source.capture);
console.log(`simulated ${result.source.simulated}, filled ${result.source.filled}\n`);
console.log(show(result.baseline));
for (const c of claims) {
  console.log(`\n${c.id}`);
  console.log("  " + show(c.yes));
  console.log("  " + show(c.no));
  console.log(`  difference ${c.diff ? `${c.diff.diff >= 0 ? "+" : ""}${c.diff.diff}R  se ${c.diff.se}  z ${c.diff.z}` : "—"}  →  ${c.act}`);
}
console.log("\nnamed pools taken, individually");
for (const b of namedBreakdown) console.log("  " + show(b));
console.log(`\nwrote ${OUT}`);
