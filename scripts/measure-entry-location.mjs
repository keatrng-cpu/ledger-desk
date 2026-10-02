/**
 * Entry location: where the limit rests, how long it rests, whether to wait
 * for a 15m close, and where the stop sits — measured on the same cards,
 * paired.
 *
 * WHY THIS, NOW
 * The exit-plan measurement (2026-10-01) found 79% of filled cards end on a
 * stop (65% the full stop, 14% breakeven after T1). Management can't fix a
 * loss that happens before management starts, so the remaining lever is the
 * geometry at the fill: the price the limit rests at, and the stop it is
 * measured against.
 *
 * THE VARIANTS (each changes ONE thing against the live rule)
 *   L0     baseline: limit at CE, 12-bar (3h) window, stop as the plan sets it.
 *   L-25   limit a quarter of the CE→stop distance SHALLOWER (toward price).
 *   L+25   a quarter DEEPER (toward the stop).
 *   L+50   half-way from CE to the stop. PROXY for "the far edge of the
 *          array": the capture stores no array bounds; the plan's stop sits a
 *          pad beyond min(raid extreme, array bottom), so half-way is at or
 *          past the far edge.
 *   OTE    limit at the 70.5% retracement of the post-raid leg (ICT's OTE
 *          "sweet spot"); CE where no leg is found or the level is not
 *          between the stop and the leg's extreme.
 *   W4/W8  the limit is cancelled after 4 / 8 bars (1h / 2h) instead of 12.
 *   C15    CONFIRMATION on 15m: wait for a bar that touches CE AND closes
 *          back on the trade's side of it; enter at that close. Skipped if the
 *          bar traded through the stop first, or closed at/through T1.
 *          (1m confirmation was measured and rejected in NY AM —
 *          measure-micro-entry.mjs; this is the 15m, four-year version.)
 *   S+25/S+50  the stop a quarter / half ATR further beyond; entry at CE.
 *   Filter: distance from price to CE when the card printed, in the
 *          entry-trigger tiers (LIVE <=0.25 ATR, ARMED <=1, FORMING >1).
 *
 * WHAT IS HELD CONSTANT
 * The cards, T1/T2 prices, 50% at T1, stop to BE, runner to T2, the 32-bar
 * hold, ties against, the fill bar cannot score T1, and the live exit rule
 * (the failed-hold exit, exit-rules.ts — level from each variant's own entry
 * and stop, as the live code computes it).
 *
 * THE UNIT is R PER CARD, an unfilled card counting 0: a deeper limit trades
 * fill rate for price, so per-FILL expectancy would compare different
 * populations. R is against each variant's own risk (fixed-dollar sizing:
 * a tighter stop buys more contracts at the same $).
 *
 * DECISION RULE, FIXED BEFORE THE FIRST RUN
 * Primary population: cards whose plan stop is inside the 0.5–1.5 ATR band
 * (trade-plan.ts refuses the rest, so these are the cards the desk trades).
 * 12 tests (9 variants + 3 tiers) → family-wise bar z >= 2.87 (Bonferroni,
 * two-sided 5%).
 *   ADOPT  paired Δ per card > 0, z >= 2.87, positive in both halves
 *          (2022–24, 2025–26) AND Δ > 0 under the old exits (no failed hold).
 *   WATCH  Δ > 0 with z >= 2 that misses any ADOPT condition. Not wired.
 *   WORSE  Δ < 0 with z <= −2. Recorded so it is not re-proposed.
 * Tier filters: same bars, on the unpaired day-clustered difference of per-
 * card R vs the other tiers. Secondary (reported, never decides): all cards.
 * Gate: under the old exits, all cards ≥0.65 must reproduce the evidence
 * pack (3,501 fills, −0.139R per fill) or nothing here is trusted.
 *
 * RESULT, first run 2026-10-01 (recorded after the run; the rule above was not
 * changed). Gate reproduced: 3,501 fills, −0.139R.
 *   Primary, in-band, n=1870 cards: NOTHING beats CE. Baseline +0.047R/card.
 *     L-25 +0.009 z 0.23 · L+25 −0.053 z −1.41 · L+50 −0.134 z −1.93 (both
 *     halves negative) · OTE −0.006 z −0.25 · W4 +0.013 z 0.53 · W8 −0.010 ·
 *     C15 −0.017 z −0.38 · S+25 −0.004 · S+50 −0.028. Deeper is worse, not
 *     better: the far edge fills 58% vs 71% and is stopped 78% vs 50%.
 *   Secondary, all cards: C15 +0.069 z 2.69, S+50 +0.060 z 2.41, W4 +0.028
 *     z 2.07 — all of it on the out-of-band cards the desk already refuses
 *     (they repair a stop that was too tight); those cards stay negative
 *     under C15 (≈ −0.05R/card), so the refusal stands.
 *   Tier at print: ARMED (0.25–1 ATR away) +0.119R/card vs −0.004, z 1.35,
 *     higher in both halves; LIVE (price already at CE) all cards −0.201 vs
 *     −0.056, z −2.02, worse in both halves — watch, the same story as
 *     "never pay the print".
 *   Stopped in-band fills: 56% touch T1 inside the 8h hold, after running a
 *     median 1.84 ATR beyond the stop (IQR 0.71–3.83). The stop is not in
 *     the noise; the entry is early — the raid it read was not the low.
 *
 * Run: npx tsx scripts/measure-entry-location.mjs
 * Out: .cache/entry-location-measurement.json (exploratory)
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const OUT = ".cache/entry-location-measurement.json";
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const FLOOR = 0.65;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const RECENT_WINDOW_BARS = 24;
const OTE_LEVEL = 0.705;
const Z_FAMILY = 2.87;
const Z_WATCH = 2;
const BAND = [0.5, 1.5];
const TIER_LIVE_ATR = 0.25;
const TIER_ARMED_ATR = 1;

const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const { detectSweeps } = await import("../src/lib/trading/detectors.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

/* ── Population (identical to the evidence pack) ─────────────────────────── */

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

const sweepCache = new Map();
const sweepsFor = (sym) => {
  if (!sweepCache.has(sym)) sweepCache.set(sym, detectSweeps(BARS[sym]));
  return sweepCache.get(sym);
};
/** The OTE level of the post-raid leg, or null when there is no usable leg. */
function oteLevel(r) {
  const long = r.side === "long";
  const want = long ? "sellside" : "buyside";
  const all = sweepsFor(r.sym).filter((s) => s.index <= r.i && s.side === want);
  const sw = all[all.length - 1];
  if (!sw || r.i - sw.index > RECENT_WINDOW_BARS) return null;
  const bars = BARS[r.sym];
  let ext = long ? -Infinity : Infinity;
  for (let j = sw.index; j <= r.i; j++) ext = long ? Math.max(ext, bars[j].h) : Math.min(ext, bars[j].l);
  const span = long ? ext - sw.wickExtreme : sw.wickExtreme - ext;
  if (!(span > 0)) return null;
  const lvl = long ? ext - OTE_LEVEL * span : ext + OTE_LEVEL * span;
  // Must sit between the stop and the leg's extreme, or it is not a limit.
  if (long ? !(lvl > r.s && lvl < ext) : !(lvl < r.s && lvl > ext)) return null;
  return lvl;
}

/* ── One sim, parameterized ──────────────────────────────────────────────── */

function sim(r, o, failedHold) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const E0 = r.e;
  const risk0 = Math.abs(E0 - r.s);
  if (!(risk0 > 0) || r.t1 == null) return null;
  if (long ? r.t1 <= E0 : r.t1 >= E0) return null;
  const S = o.stopAtr ? (long ? r.s - o.stopAtr * r.atr : r.s + o.stopAtr * r.atr) : r.s;
  let level = E0;
  if (o.depth) level = E0 + o.depth * (r.s - E0);
  if (o.ote) level = r.ote ?? E0;
  const t2 = r.t2 != null && (long ? r.t2 > r.t1 : r.t2 < r.t1) ? r.t2 : null;
  const hitStop = (b, lvl) => (long ? b.l <= lvl : b.h >= lvl);
  const hitTgt = (b, lvl) => (long ? b.h >= lvl : b.l <= lvl);
  const window = o.window ?? FILL_BARS;

  let fi = null;
  let E = level;
  let start = null;
  if (o.confirm) {
    for (let k = 1; k <= window && r.i + k < bars.length; k++) {
      const b = bars[r.i + k];
      if (hitStop(b, S)) return { filled: false, why: "stop-before-entry" };
      if (!(long ? b.l <= E0 : b.h >= E0)) continue;
      if (long ? b.c > E0 : b.c < E0) {
        if (long ? b.c >= r.t1 : b.c <= r.t1) return { filled: false, why: "closed-at-target" };
        fi = r.i + k;
        E = b.c;
        start = fi + 1;
        break;
      }
    }
  } else {
    if (long ? r.t1 <= level : r.t1 >= level) return { filled: false, why: "target-behind-entry" };
    for (let k = 1; k <= window && r.i + k < bars.length; k++) {
      const b = bars[r.i + k];
      if (long ? b.l <= level : b.h >= level) { fi = r.i + k; start = fi; break; }
    }
  }
  if (fi == null) return { filled: false, why: "no-touch" };

  const risk = Math.abs(E - S);
  if (!(risk > 0)) return { filled: false, why: "zero-risk" };
  const failLevel = long ? E - 0.5 * risk : E + 0.5 * risk;
  let stop = S, rem = 1, banked = 0, t1Done = false;
  const rOf = (px) => (long ? px - E : E - px) / risk;
  const end = Math.min(bars.length, start + HOLD_BARS);
  for (let k = start; k < end; k++) {
    const b = bars[k];
    if (hitStop(b, stop)) {
      const px = long ? stop - TICK : stop + TICK;
      banked += rOf(px) * rem;
      return { filled: true, R: banked, t1: t1Done, how: t1Done ? "be" : "stop", k, E, S, risk };
    }
    if (k !== fi) {
      if (!t1Done && hitTgt(b, r.t1)) {
        t1Done = true;
        if (t2 == null) { banked += rOf(r.t1) * rem; return { filled: true, R: banked, t1: true, how: "t1-full", E, S, risk }; }
        banked += rOf(r.t1) * 0.5;
        rem -= 0.5;
        stop = E;
        continue;
      }
      if (t1Done && t2 != null && hitTgt(b, t2)) {
        banked += rOf(t2) * rem;
        return { filled: true, R: banked, t1: true, how: "t2", E, S, risk };
      }
    }
    if (failedHold && !t1Done && (long ? b.c < failLevel : b.c > failLevel)) {
      banked += rOf(b.c) * rem;
      return { filled: true, R: banked, t1: false, how: "failed-hold", E, S, risk };
    }
  }
  banked += rOf(bars[end - 1].c) * rem;
  return { filled: true, R: banked, t1: t1Done, how: "time", E, S, risk };
}

const VARIANTS = {
  L0: {},
  "L-25": { depth: -0.25 },
  "L+25": { depth: 0.25 },
  "L+50": { depth: 0.5 },
  OTE: { ote: true },
  W4: { window: 4 },
  W8: { window: 8 },
  C15: { confirm: true },
  "S+25": { stopAtr: 0.25 },
  "S+50": { stopAtr: 0.5 },
};

const cards = [];
for (const r of rows) {
  if (!(Math.abs(r.e - r.s) > 0) || r.t1 == null || (r.side === "long" ? r.t1 <= r.e : r.t1 >= r.e)) continue;
  r.ote = oteLevel(r);
  const live = {}, old = {};
  for (const [name, o] of Object.entries(VARIANTS)) {
    live[name] = sim(r, o, true);
    old[name] = sim(r, o, false);
  }
  const riskAtr = r.atr > 0 ? Math.abs(r.e - r.s) / r.atr : null;
  const long = r.side === "long";
  const away = r.atr > 0 ? (long ? r.px - r.e : r.e - r.px) / r.atr : null;
  const tier = away == null ? null : away <= TIER_LIVE_ATR ? "LIVE" : away <= TIER_ARMED_ATR ? "ARMED" : "FORMING";
  cards.push({
    r, day: dayKey(r.t), y: new Date(r.t).getUTCFullYear(), live, old, tier,
    inBand: riskAtr != null && riskAtr >= BAND[0] && riskAtr <= BAND[1],
  });
}

/* ── Statistics ──────────────────────────────────────────────────────────── */

const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const Rc = (res) => (res && res.filled ? res.R : 0); // per card: unfilled = 0
function clusteredMean(items, val) {
  const n = items.length;
  if (!n) return { mean: null, se: null, z: null };
  const mean = items.reduce((s, o) => s + val(o), 0) / n;
  const byDay = new Map();
  for (const o of items) byDay.set(o.day, (byDay.get(o.day) ?? 0) + (val(o) - mean));
  let v = 0;
  for (const s of byDay.values()) v += s * s;
  const G = byDay.size;
  const se = G > 1 ? (Math.sqrt(v) / n) * Math.sqrt(G / (G - 1)) : Infinity;
  return { mean, se, z: se > 0 ? mean / se : 0 };
}
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
const mean = (a, val) => (a.length ? a.reduce((s, o) => s + val(o), 0) / a.length : null);
const halves = (items, val) => ({
  is: r3(mean(items.filter((o) => IS_YEARS.includes(o.y)), val)),
  oos: r3(mean(items.filter((o) => OOS_YEARS.includes(o.y)), val)),
});

// Gate: the evidence pack's baseline, old exits, all cards ≥0.65.
const baseFills = cards.filter((o) => o.old.L0?.filled);
const gate = { fills: baseFills.length, perFill: r3(mean(baseFills, (o) => o.old.L0.R)) };
const gateOk = gate.fills === 3501 && gate.perFill === -0.139;

function report(pop, label) {
  const out = { n: pop.length, variants: {}, tiers: {} };
  for (const name of Object.keys(VARIANTS)) {
    const lvl = clusteredMean(pop, (o) => Rc(o.live[name]));
    const d = clusteredMean(pop, (o) => Rc(o.live[name]) - Rc(o.live.L0));
    const dOld = clusteredMean(pop, (o) => Rc(o.old[name]) - Rc(o.old.L0));
    const h = halves(pop, (o) => Rc(o.live[name]) - Rc(o.live.L0));
    const fills = pop.filter((o) => o.live[name]?.filled);
    const stops = fills.filter((o) => o.live[name].how === "stop").length;
    const outBand = fills.filter((o) => {
      const ra = o.r.atr > 0 ? o.live[name].risk / o.r.atr : null;
      return ra == null || ra < BAND[0] || ra > BAND[1];
    }).length;
    let verdict = "baseline";
    if (name !== "L0") {
      const adopt = d.mean > 0 && d.z >= Z_FAMILY && h.is > 0 && h.oos > 0 && dOld.mean > 0;
      verdict = adopt ? "ADOPT" : d.mean > 0 && d.z >= Z_WATCH ? "WATCH" : d.mean < 0 && d.z <= -Z_WATCH ? "WORSE" : "no";
    }
    out.variants[name] = {
      perCard: r3(lvl.mean),
      fillRate: r3(fills.length / pop.length),
      perFill: r3(mean(fills, (o) => o.live[name].R)),
      fullStopShare: r3(fills.length ? stops / fills.length : null),
      beShare: r3(fills.length ? fills.filter((o) => o.live[name].how === "be").length / fills.length : null),
      // Old exits, for the record: the exit-plan run counted BE exits as "stop".
      fullStopShareOldExits: r3((() => { const f = pop.filter((o) => o.old[name]?.filled); return f.length ? f.filter((o) => o.old[name].how === "stop").length / f.length : null; })()),
      anyStopShareOldExits: r3((() => { const f = pop.filter((o) => o.old[name]?.filled); return f.length ? f.filter((o) => o.old[name].how === "stop" || o.old[name].how === "be").length / f.length : null; })()),
      t1Rate: r3(fills.length ? fills.filter((o) => o.live[name].t1).length / fills.length : null),
      variantOutOfBand: r3(fills.length ? outBand / fills.length : null),
      diff: r3(d.mean), z: r3(d.z), diffIS: h.is, diffOOS: h.oos, diffOldExits: r3(dOld.mean), zOldExits: r3(dOld.z),
      verdict,
    };
  }
  for (const t of ["LIVE", "ARMED", "FORMING"]) {
    const A = pop.filter((o) => o.tier === t);
    const B = pop.filter((o) => o.tier && o.tier !== t);
    if (A.length < 20 || B.length < 20) continue;
    const d = unpairedDiff(A, B, (o) => Rc(o.live.L0));
    const hA = halves(A, (o) => Rc(o.live.L0));
    const hB = halves(B, (o) => Rc(o.live.L0));
    const fillsA = A.filter((o) => o.live.L0?.filled);
    const verdict = Math.abs(d.z) >= Z_FAMILY && Math.sign(hA.is - hB.is) === Math.sign(d.diff) && Math.sign(hA.oos - hB.oos) === Math.sign(d.diff)
      ? (d.diff > 0 ? "BETTER" : "WORSE")
      : Math.abs(d.z) >= Z_WATCH ? "WATCH" : "no";
    out.tiers[t] = {
      n: A.length, perCard: r3(d.a), rest: r3(d.b), diff: r3(d.diff), z: r3(d.z),
      is: hA.is, oos: hA.oos, restIS: hB.is, restOOS: hB.oos,
      fillRate: r3(fillsA.length / A.length), perFill: r3(mean(fillsA, (o) => o.live.L0.R)),
      verdict,
    };
  }
  console.log(`\n${label} — n=${pop.length} cards (R per card, unfilled = 0; live exits)`);
  for (const [name, v] of Object.entries(out.variants)) {
    console.log(
      `  ${name.padEnd(5)} ${v.perCard >= 0 ? "+" : ""}${v.perCard.toFixed(3)}R/card  fill ${(v.fillRate * 100).toFixed(0)}%  ${v.perFill >= 0 ? "+" : ""}${v.perFill?.toFixed(3)}R/fill  stopped ${(v.fullStopShare * 100).toFixed(0)}%  T1 ${(v.t1Rate * 100).toFixed(0)}%` +
        (name === "L0" ? "" : `  Δ ${v.diff >= 0 ? "+" : ""}${v.diff} z ${v.z} IS ${v.diffIS} OOS ${v.diffOOS} old-exits ${v.diffOldExits} (z ${v.zOldExits})  out-of-band ${(v.variantOutOfBand * 100).toFixed(0)}%  ${v.verdict}`),
    );
  }
  for (const [t, v] of Object.entries(out.tiers)) {
    console.log(`  tier ${t.padEnd(7)} n=${v.n} ${v.perCard}R/card vs rest ${v.rest}  diff ${v.diff} z ${v.z}  IS ${v.is}/${v.restIS} OOS ${v.oos}/${v.restOOS}  fill ${(v.fillRate * 100).toFixed(0)}% ${v.perFill}R/fill  ${v.verdict}`);
  }
  return out;
}

// Diagnostic: stopped baseline fills that went on to T1 inside the hold —
// was the stop inside the noise? And how far beyond it did price go first?
function stopThenTarget(pop) {
  const stopped = pop.filter((o) => o.live.L0?.filled && o.live.L0.how === "stop");
  let later = 0;
  const beyond = [];
  for (const o of stopped) {
    const { r } = o;
    const bars = BARS[r.sym];
    const long = r.side === "long";
    const k0 = o.live.L0.k;
    let worst = long ? Infinity : -Infinity;
    for (let k = k0; k < Math.min(bars.length, k0 + HOLD_BARS); k++) {
      const b = bars[k];
      if (long ? b.h >= r.t1 : b.l <= r.t1) {
        later++;
        beyond.push(Math.abs(worst - r.s) / r.atr);
        break;
      }
      worst = long ? Math.min(worst, b.l) : Math.max(worst, b.h);
    }
  }
  beyond.sort((a, b) => a - b);
  const q = (p) => r3(beyond[Math.floor(p * (beyond.length - 1))] ?? null);
  return { stopped: stopped.length, thenT1: later, share: r3(later / (stopped.length || 1)), beyondStopAtr: { p25: q(0.25), median: q(0.5), p75: q(0.75) } };
}

const inBand = cards.filter((o) => o.inBand);
const out = {
  builtAt: new Date().toISOString(),
  gate: { ...gate, ok: gateOk },
  oteFound: r3(cards.filter((o) => o.r.ote != null).length / cards.length),
  primary: report(inBand, "PRIMARY — in-band cards (stop 0.5–1.5 ATR)"),
  secondary: report(cards, "SECONDARY — all cards ≥0.65"),
  stopThenTarget: { inBand: stopThenTarget(inBand), all: stopThenTarget(cards) },
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
console.log(`\ngate: ${gate.fills} fills, ${gate.perFill}R/fill under the old exits — ${gateOk ? "REPRODUCES the evidence pack" : "DOES NOT REPRODUCE — do not trust the rest"}`);
console.log(`OTE leg found on ${(out.oteFound * 100).toFixed(0)}% of cards (CE elsewhere)`);
for (const [k, v] of Object.entries(out.stopThenTarget)) {
  console.log(`stopped then T1 inside the hold (${k}): ${v.thenT1}/${v.stopped} = ${(v.share * 100).toFixed(0)}%; price went ${v.beyondStopAtr.median} ATR beyond the stop first (median; IQR ${v.beyondStopAtr.p25}–${v.beyondStopAtr.p75})`);
}
console.log(`\nwrote ${OUT}`);
