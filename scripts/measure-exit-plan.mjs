/**
 * The trader's entry/exit plan (2026-10-01, "The only trade") against the
 * desk's exit rule as coded — on the same filled cards, paired.
 *
 * The desk already does most of it: limit at CE, never chase, stop beyond the
 * raid, never widen, partial at the first pool, BE only after the partial,
 * runner to the external pool. What differs, and is tested here:
 *   V1  partial 2/3 at T1 instead of 1/2 ("half to two-thirds off").
 *   V2  runner held by STRUCTURE: after T1 (stop at BE), exit the runner on a
 *       15m close through the last confirmed 15m swing low (long; mirror for
 *       short) formed after the fill — "stays on while the 15m prints higher
 *       highs and higher lows" — with a 96-bar (24h) safety cap instead of
 *       the 32-bar (8h) time exit.
 *   V0_96  the 24h cap alone, no structure exit — so V2's effect can be told
 *       apart from simply holding longer.
 *   V3  failed hold of the entry array, before T1: exit on a 15m CLOSE beyond
 *       CE by half the CE→stop distance. PROXY: the capture stores no array
 *       bounds; CE is the array's middle and the stop sits beyond its far edge,
 *       so half-way to the stop is "through the array". 15m, not 5m — the tape
 *       is 15m.
 *   V4  two targets, always: a card with no T2 (35.5% of them) gets the
 *       nearest external pool beyond T1 — prior day or prior week high (long) /
 *       low (short), read causally.
 *   V5  V1 + V2 + V3 + V4: the trader's full exit plan.
 *   Gate: T1 >= 2R ("the partial is often around 2R") vs below.
 *
 * DECISION RULE, FIXED BEFORE THE FIRST RUN
 * Every variant runs on the SAME fills as V0, so each card gives a paired
 * difference (variant R − V0 R). A variant is adopted only if the mean paired
 * difference is positive with |z| >= 2 on a day-clustered SE AND positive in
 * both halves (2022–24, 2025–26). The T1 gate is a filter, judged on the
 * unpaired day-clustered difference vs the complement, same |z| >= 2 bar.
 * V0 must reproduce the evidence-pack baseline (−0.139R) or nothing here is
 * trusted.
 *
 * Run: npx tsx scripts/measure-exit-plan.mjs
 * Out: .cache/exit-plan-measurement.json (exploratory)
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const OUT = ".cache/exit-plan-measurement.json";
const FILL_BARS = 12;
const TICK = 0.25;
const FLOOR = 0.65;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const SWING_K = 2;

const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const { tradeDateOf } = await import("../src/lib/trading/tf-ladder.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

/* ── Prior day / prior week ranges, by bar ───────────────────────────────── */

function weekKey(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
  return dt.toISOString().slice(0, 10);
}
const POOLS = {};
for (const sym of Object.keys(BARS)) {
  const bars = BARS[sym];
  const days = [];
  const dayOf = new Int32Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    const td = tradeDateOf(bars[i].t);
    const last = days[days.length - 1];
    if (!last || last.date !== td) days.push({ date: td, week: weekKey(td), h: bars[i].h, l: bars[i].l });
    else { last.h = Math.max(last.h, bars[i].h); last.l = Math.min(last.l, bars[i].l); }
    dayOf[i] = days.length - 1;
  }
  const weeks = new Map();
  for (const d of days) {
    const w = weeks.get(d.week) ?? { h: -Infinity, l: Infinity };
    w.h = Math.max(w.h, d.h); w.l = Math.min(w.l, d.l);
    weeks.set(d.week, w);
  }
  const weekOrder = [...weeks.keys()];
  POOLS[sym] = { days, dayOf, weeks, weekOrder };
}
/** Nearest external pool beyond T1 in the trade's direction, as of bar i. */
function externalT2(r) {
  const { days, dayOf, weeks, weekOrder } = POOLS[r.sym];
  const k = dayOf[r.i];
  const prev = days[k - 1];
  const wi = weekOrder.indexOf(days[k].week);
  const pw = wi > 0 ? weeks.get(weekOrder[wi - 1]) : null;
  const long = r.side === "long";
  const cands = long ? [prev?.h, pw?.h] : [prev?.l, pw?.l];
  const beyond = cands.filter((p) => p != null && Number.isFinite(p) && (long ? p > r.t1 : p < r.t1));
  if (!beyond.length) return null;
  return long ? Math.min(...beyond) : Math.max(...beyond);
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
rows = rows.filter((r) => !r.judas && !r.news && r.conf >= FLOOR);
rows.sort((a, b) => a.t - b.t);
const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${w.month}-${w.day}`;
};

/* ── One sim, parameterized. V0 = the rule as coded. ─────────────────────── */

function sim(r, o) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const E = r.e, S = r.s;
  const risk = Math.abs(E - S);
  if (!(risk > 0) || r.t1 == null) return null;
  if (long ? r.t1 <= E : r.t1 >= E) return null;
  let t2 = r.t2 != null && (long ? r.t2 > r.t1 : r.t2 < r.t1) ? r.t2 : null;
  if (t2 == null && o.extT2) t2 = externalT2(r);
  const hitStop = (b, lvl) => (long ? b.l <= lvl : b.h >= lvl);
  const hitTgt = (b, lvl) => (long ? b.h >= lvl : b.l <= lvl);

  let fi = null;
  for (let k = 1; k <= FILL_BARS && r.i + k < bars.length; k++) {
    const b = bars[r.i + k];
    if (long ? b.l <= E : b.h >= E) { fi = r.i + k; break; }
  }
  if (fi == null) return { filled: false };

  const holdBars = o.holdBars ?? 32;
  const partial = o.partial ?? 0.5;
  const failLevel = long ? E - 0.5 * risk : E + 0.5 * risk;
  let stop = S, rem = 1, banked = 0, t1Done = false, swing = null;
  const rOf = (px) => (long ? px - E : E - px) / risk;
  let end = Math.min(bars.length, fi + holdBars);
  // "Flat by the session close": out at the close of the last bar before
  // 16:00 ET on the fill's ET day (the next day's if filled after 16:00).
  if (o.flatByClose) {
    for (let k = fi; k < end; k++) {
      const p = etWallParts(bars[k].t + 15 * 60_000);
      const pf = etWallParts(bars[fi].t);
      const sameDay = p.year === pf.year && p.month === pf.month && p.day === pf.day;
      const afterFill = pf.hour * 60 + pf.minute >= 16 * 60;
      if ((sameDay || !afterFill) && p.hour * 60 + p.minute >= 16 * 60 && (sameDay || !afterFill)) {
        end = k + 1;
        break;
      }
    }
  }
  for (let k = fi; k < end; k++) {
    const b = bars[k];
    if (hitStop(b, stop)) {
      const px = long ? stop - TICK : stop + TICK;
      banked += rOf(px) * rem;
      return { filled: true, R: banked, t1: t1Done, how: "stop" };
    }
    // A swing that formed after the fill is confirmed SWING_K bars later.
    if (o.structure) {
      const j = k - SWING_K;
      if (j - SWING_K >= fi) {
        let isSwing = true;
        for (let q = j - SWING_K; q <= j + SWING_K; q++) {
          if (q === j) continue;
          if (long ? bars[q].l <= bars[j].l : bars[q].h >= bars[j].h) { isSwing = false; break; }
        }
        if (isSwing) swing = long ? bars[j].l : bars[j].h;
      }
    }
    if (k !== fi) {
      if (!t1Done && hitTgt(b, r.t1)) {
        t1Done = true;
        if (t2 == null) { banked += rOf(r.t1) * rem; return { filled: true, R: banked, t1: true, how: "t1-full" }; }
        banked += rOf(r.t1) * partial;
        rem -= partial;
        stop = E;
        continue;
      }
      if (t1Done && t2 != null && hitTgt(b, t2)) {
        banked += rOf(t2) * rem;
        return { filled: true, R: banked, t1: true, how: "t2" };
      }
    }
    // Close-based exits, read at this bar's close.
    if (o.failedHold && !t1Done && (long ? b.c < failLevel : b.c > failLevel)) {
      banked += rOf(b.c) * rem;
      return { filled: true, R: banked, t1: false, how: "failed-hold" };
    }
    if (o.structure && t1Done && swing != null && (long ? b.c < swing : b.c > swing)) {
      banked += rOf(b.c) * rem;
      return { filled: true, R: banked, t1: true, how: "structure" };
    }
  }
  banked += rOf(bars[end - 1].c) * rem;
  return { filled: true, R: banked, t1: t1Done, how: "time" };
}

const VARIANTS = {
  V0: {},
  V0_96: { holdBars: 96 },
  V1: { partial: 2 / 3 },
  V2: { structure: true, holdBars: 96 },
  V3: { failedHold: true },
  V4: { extT2: true },
  V5: { partial: 2 / 3, structure: true, holdBars: 96, failedHold: true, extT2: true },
  // Added with the trader's second exit note (same day): flat by 16:00 ET.
  V6: { holdBars: 96, flatByClose: true },
  V7: { partial: 2 / 3, structure: true, holdBars: 96, failedHold: true, extT2: true, flatByClose: true },
};

const cards = [];
for (const r of rows) {
  const res = {};
  for (const [name, o] of Object.entries(VARIANTS)) res[name] = sim(r, o);
  if (!res.V0 || !res.V0.filled) continue;
  cards.push({ r, day: dayKey(r.t), y: new Date(r.t).getUTCFullYear(), res, rr1: Math.abs(r.t1 - r.e) / Math.abs(r.e - r.s) });
}

/* ── Statistics ──────────────────────────────────────────────────────────── */

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
function clusteredMean(items, val) {
  const n = items.length;
  if (!n) return null;
  const mean = items.reduce((s, o) => s + val(o), 0) / n;
  const byDay = new Map();
  for (const o of items) byDay.set(o.day, (byDay.get(o.day) ?? 0) + (val(o) - mean));
  let v = 0;
  for (const s of byDay.values()) v += s * s;
  const G = byDay.size;
  const se = G > 1 ? (Math.sqrt(v) / n) * Math.sqrt(G / (G - 1)) : Infinity;
  return { mean, se, z: se > 0 ? mean / se : 0 };
}
const halves = (items, val) => {
  const m = (a) => (a.length ? a.reduce((s, o) => s + val(o), 0) / a.length : null);
  return { is: r3(m(items.filter((o) => IS_YEARS.includes(o.y)))), oos: r3(m(items.filter((o) => OOS_YEARS.includes(o.y)))) };
};

const out = { builtAt: new Date().toISOString(), filled: cards.length, variants: {} };
for (const name of Object.keys(VARIANTS)) {
  const level = clusteredMean(cards, (o) => o.res[name].R);
  const diff = clusteredMean(cards, (o) => o.res[name].R - o.res.V0.R);
  const h = halves(cards, (o) => o.res[name].R - o.res.V0.R);
  const hows = {};
  for (const o of cards) hows[o.res[name].how] = (hows[o.res[name].how] ?? 0) + 1;
  const adopt = name !== "V0" && diff.mean > 0 && diff.z >= 2 && h.is > 0 && h.oos > 0;
  // Profit factor and max drawdown in R, cards taken in time order at 1R each
  // — the trader's note claims the partial split wins on THESE, not on mean R.
  const seq = [...cards].sort((a, b) => a.r.t - b.r.t).map((o) => o.res[name].R);
  const gains = seq.filter((x) => x > 0).reduce((s, x) => s + x, 0);
  const losses = -seq.filter((x) => x < 0).reduce((s, x) => s + x, 0);
  let eq = 0, peak = 0, maxDd = 0;
  for (const x of seq) { eq += x; peak = Math.max(peak, eq); maxDd = Math.max(maxDd, peak - eq); }
  out.variants[name] = {
    pf: r3(losses > 0 ? gains / losses : null),
    maxDdR: r3(maxDd),
    winRate: r3(seq.filter((x) => x > 0).length / seq.length),
    exp: r3(level.mean), expSe: r3(level.se),
    diff: r3(diff.mean), diffSe: r3(diff.se), z: r3(diff.z),
    diffIS: h.is, diffOOS: h.oos,
    t1Rate: r3(cards.filter((o) => o.res[name].t1).length / cards.length),
    exits: hows,
    verdict: name === "V0" ? "baseline" : adopt ? "ADOPT" : "no",
  };
}

// The T1 >= 2R gate, as a filter on the baseline rule.
function unpairedDiff(A, B, val) {
  const ma = A.reduce((s, o) => s + val(o), 0) / A.length;
  const mb = B.reduce((s, o) => s + val(o), 0) / B.length;
  const byDay = new Map();
  for (const o of A) byDay.set(o.day, (byDay.get(o.day) ?? 0) + (val(o) - ma) / A.length);
  for (const o of B) byDay.set(o.day, (byDay.get(o.day) ?? 0) - (val(o) - mb) / B.length);
  let v = 0;
  for (const s of byDay.values()) v += s * s;
  const G = byDay.size;
  const se = Math.sqrt(v * (G / (G - 1)));
  return { a: ma, b: mb, diff: ma - mb, se, z: (ma - mb) / se };
}
const gate = {};
for (const name of ["V0", "V5"]) {
  const A = cards.filter((o) => o.rr1 >= 2);
  const B = cards.filter((o) => o.rr1 < 2);
  const d = unpairedDiff(A, B, (o) => o.res[name].R);
  gate[name] = { t1AtLeast2R: { n: A.length, exp: r3(d.a), ...halves(A, (o) => o.res[name].R) }, below2R: { n: B.length, exp: r3(d.b), ...halves(B, (o) => o.res[name].R) }, diff: r3(d.diff), z: r3(d.z) };
}
out.gate = gate;

// SECONDARY (not pre-registered, reported as such): the cards the desk would
// actually let through — stop inside the 0.5–1.5 ATR band (trade-plan.ts
// refuses the rest). Exit rules only ever act on these.
const inBand = cards.filter((o) => {
  const ra = o.r.atr > 0 ? Math.abs(o.r.e - o.r.s) / o.r.atr : null;
  return ra != null && ra >= 0.5 && ra <= 1.5;
});
out.inBand = { n: inBand.length, variants: {} };
for (const name of Object.keys(VARIANTS)) {
  const level = clusteredMean(inBand, (o) => o.res[name].R);
  const diff = clusteredMean(inBand, (o) => o.res[name].R - o.res.V0.R);
  const h = halves(inBand, (o) => o.res[name].R - o.res.V0.R);
  const stops = inBand.filter((o) => o.res[name].how === "stop").length;
  out.inBand.variants[name] = { exp: r3(level.mean), diff: r3(diff.mean), z: r3(diff.z), diffIS: h.is, diffOOS: h.oos, stopShare: r3(stops / inBand.length) };
}
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`\nSECONDARY — in-band cards only (stop 0.5–1.5 ATR, what the desk lets through), n=${inBand.length}:`);
for (const [name, v] of Object.entries(out.inBand.variants)) {
  console.log(`  ${name.padEnd(6)} exp ${v.exp >= 0 ? "+" : ""}${v.exp.toFixed(3)}R` + (name === "V0" ? "" : `  Δ ${v.diff >= 0 ? "+" : ""}${v.diff}R z ${v.z}  IS ${v.diffIS} OOS ${v.diffOOS}`) + `  stopped ${(v.stopShare * 100).toFixed(0)}%`);
}

console.log(`filled cards ${cards.length} (paired across every variant)\n`);
for (const [name, v] of Object.entries(out.variants)) {
  console.log(
    `${name.padEnd(6)} exp ${v.exp >= 0 ? "+" : ""}${v.exp.toFixed(3)}R  ` +
      (name === "V0" ? "" : `Δ vs V0 ${v.diff >= 0 ? "+" : ""}${v.diff}R  z ${v.z}  IS ${v.diffIS} OOS ${v.diffOOS}  `) +
      `win ${(v.winRate * 100).toFixed(1)}%  PF ${v.pf}  maxDD ${v.maxDdR}R  ${v.verdict}`,
  );
}
console.log("\nT1 >= 2R gate (a filter):");
for (const [name, g] of Object.entries(gate)) {
  console.log(`  ${name}: T1>=2R n=${g.t1AtLeast2R.n} exp ${g.t1AtLeast2R.exp} (IS ${g.t1AtLeast2R.is} OOS ${g.t1AtLeast2R.oos})  vs <2R n=${g.below2R.n} exp ${g.below2R.exp} (IS ${g.below2R.is} OOS ${g.below2R.oos})  diff ${g.diff} z ${g.z}`);
}
console.log(`\nwrote ${OUT}`);
