/**
 * How long a filled card takes to reach T1 — the number theta prices.
 *
 *   npx tsx scripts/measure-option-time.mjs [--sigdir .cache/signals]
 *
 * WHY THIS EXISTS
 * hit-odds-model.json answers "does T1 print within 8 hours of the fill?".
 * A 0–1 DTE option does not live 8 hours: the trading floor's day tickets are
 * flat at 11:00 ET, and every 15 minutes in between costs theta. A futures
 * plan that reaches T1 at 14:40 is a winner; the option that expressed it was
 * sold at 11:00 for less than it cost. So the room needs the TIME profile of
 * the live rule's outcomes, measured, before it can price an option on a plan.
 *
 * RULE, FIXED BEFORE THE FIRST RUN (2026-10-04) — nothing below is tuned
 *  Population: the evidence-pack population (no Judas, no news, conf >= 0.65,
 *    deduped) with a T1 ahead of the entry and the stop inside 0.5–1.5 ATR —
 *    the band the desk trades — filled under the LIVE rule exactly as
 *    build-hit-odds.mjs simulates it: limit at CE within 12 bars, failed-hold
 *    close before T1 (exit-rules.ts), hard stop with one tick of slip, 50% at
 *    T1 / stop to BE / runner, 32-bar hold, ties against, the fill bar cannot
 *    score T1.
 *  Events, in bars after the fill bar (one bar = 15 minutes):
 *    T1    the first bar that touches T1 before the stop / a failed hold
 *    loss  the bar of the stop or the failed-hold close, T1 never touched
 *    open  neither inside the 32-bar hold
 *  Subsets: fills whose fill bar opens 09:30–11:00 ET (NY AM — the only
 *    window the room opens day tickets in) and all sessions, for reference;
 *    each split by T1 distance: < 1 ATR, 1–2 ATR, >= 2 ATR.
 *  Reported per subset: CDF of bars-to-T1 among T1 fills, CDF of bars-to-loss
 *    among non-T1 fills, P(T1 later | nothing yet after k bars), the mean
 *    mark of the plans still open after k bars on the bar close — in R and
 *    as the fraction of the way from entry to T1 (added the same day, before
 *    the four-year run, after a one-year preview showed a pooled R mark of
 *    +1.06R: above a 1R target, so unusable for pricing one plan) — and the
 *    same headline numbers for 2022–24 and 2025–26 separately so drift shows.
 *  Nothing is fitted and nothing here is a gate. The room reads the curves to
 *  price "T1 before the 11:00 flat" and "is holding still worth the theta".
 *
 * Out: src/data/room-time-odds.json (read by src/lib/room/quant.ts)
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";

const argOf = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const SIGDIR = argOf("sigdir", ".cache/signals");
const HIST = "src/data/history-4y.json";
const OUT = argOf("out", "src/data/room-time-odds.json");
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const FLOOR = 0.65;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const CURVE_K = 16; // 4 hours of conditional curve; the room's day is shorter
const NY_AM = [9 * 60 + 30, 11 * 60];

if (!existsSync(SIGDIR) || !existsSync(HIST)) {
  console.error(`needs ${SIGDIR} (capture-signals.mjs) and ${HIST}`);
  process.exit(1);
}

const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

/* ── Population (identical filters to build-evidence-pack + build-hit-odds) ── */

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
const cards = rows.length;
rows = rows.filter(
  (r) =>
    !r.judas &&
    !r.news &&
    r.conf >= FLOOR &&
    r.t1 != null &&
    r.atr > 0 &&
    Math.abs(r.e - r.s) > 0 &&
    (r.side === "long" ? r.t1 > r.e : r.t1 < r.e),
);
rows = rows.filter((r) => {
  const riskAtr = Math.abs(r.e - r.s) / r.atr;
  return riskAtr >= 0.5 && riskAtr <= 1.5;
});
rows.sort((a, b) => a.t - b.t);

/* ── The live rule, with the bar of every event ──────────────────────────── */

function sim(r) {
  const bars = BARS[r.sym];
  const long = r.side === "long";
  const E = r.e;
  const S = r.s;
  const risk = Math.abs(E - S);
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
  const rOf = (px) => (long ? px - E : E - px) / risk;
  // Progress toward T1 as a fraction of entry→T1: comparable across T1 distances
  // (an R mark pooled over a 1R and a 4R target can sit above the 1R target).
  const fracOf = (px) => (long ? px - E : E - px) / Math.abs(r.t1 - E);
  const failLevel = long ? E - 0.5 * risk : E + 0.5 * risk;
  const end = Math.min(bars.length, fi + HOLD_BARS);
  const marks = []; // close-of-bar R while nothing has happened yet
  const fracs = []; // the same closes as a fraction of the way to T1
  for (let k = fi; k < end; k++) {
    const b = bars[k];
    const off = k - fi;
    if (hitStop(b, S)) return { filled: true, fi, kind: "loss", at: off, r: rOf(long ? S - TICK : S + TICK), marks, fracs };
    if (k !== fi && hitTgt(b, r.t1)) return { filled: true, fi, kind: "t1", at: off, r: rOf(r.t1), marks, fracs };
    if (long ? b.c < failLevel : b.c > failLevel) return { filled: true, fi, kind: "loss", at: off, r: rOf(b.c), marks, fracs };
    marks.push(rOf(b.c));
    fracs.push(fracOf(b.c));
  }
  return { filled: true, fi, kind: "open", at: end - fi, r: rOf(bars[end - 1].c), marks, fracs };
}

/* ── Curves ──────────────────────────────────────────────────────────────── */

const etMinOf = (t) => {
  const w = etWallParts(t);
  return w.hour * 60 + w.minute;
};
const yearOf = (t) => new Date(t).getUTCFullYear();
const r3 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);

function median(xs) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function curves(sims) {
  const t1 = sims.filter((o) => o.kind === "t1");
  const loss = sims.filter((o) => o.kind === "loss");
  const open = sims.filter((o) => o.kind === "open");
  const notT1 = sims.length - t1.length;
  const cdfT1 = [];
  const cdfLoss = [];
  for (let k = 0; k <= HOLD_BARS; k++) {
    cdfT1.push(t1.length ? r3(t1.filter((o) => o.at <= k).length / t1.length) : null);
    cdfLoss.push(notT1 ? r3(loss.filter((o) => o.at <= k).length / notT1) : null);
  }
  const pT1Unresolved = [];
  const markR = [];
  const markFrac = [];
  const nUnresolved = [];
  const mean = (xs) => (xs.length ? r3(xs.reduce((s, x) => s + x, 0) / xs.length) : null);
  for (let k = 0; k <= CURVE_K; k++) {
    // Still nothing after k bars: no event at an offset <= k.
    const alive = sims.filter((o) => o.at > k);
    nUnresolved.push(alive.length);
    pT1Unresolved.push(alive.length ? r3(alive.filter((o) => o.kind === "t1").length / alive.length) : null);
    markR.push(mean(alive.map((o) => o.marks[k]).filter((x) => x != null && Number.isFinite(x))));
    markFrac.push(mean(alive.map((o) => o.fracs[k]).filter((x) => x != null && Number.isFinite(x))));
  }
  const lossR = loss.map((o) => o.r).filter((x) => x != null && Number.isFinite(x));
  return {
    n: sims.length,
    t1: t1.length,
    loss: loss.length,
    open: open.length,
    pT1: sims.length ? r3(t1.length / sims.length) : null,
    /** Mean R at a loss exit (stop with slip, or the failed-hold close) — what a losing path is worth. */
    lossR: lossR.length ? r3(lossR.reduce((s, x) => s + x, 0) / lossR.length) : null,
    medianT1Bars: median(t1.map((o) => o.at)),
    medianLossBars: median(loss.map((o) => o.at)),
    cdfT1,
    cdfLoss,
    pT1Unresolved,
    nUnresolved,
    markR,
    markFrac,
  };
}

function headline(sims) {
  const c = curves(sims);
  return { n: c.n, pT1: c.pT1, medianT1Bars: c.medianT1Bars, medianLossBars: c.medianLossBars, t1Within4: c.cdfT1[4], lossWithin4: c.cdfLoss[4] };
}

/* ── Run ─────────────────────────────────────────────────────────────────── */

const fills = [];
let unfilled = 0;
for (const r of rows) {
  const o = sim(r);
  if (!o.filled) {
    unfilled++;
    continue;
  }
  const fillT = BARS[r.sym][o.fi].t;
  const m = etMinOf(fillT);
  fills.push({
    ...o,
    year: yearOf(fillT),
    nyAm: m >= NY_AM[0] && m < NY_AM[1],
    t1Atr: Math.abs(r.t1 - r.e) / r.atr,
    sym: r.sym,
  });
}

const DIST = [
  ["lt1", "T1 under 1 ATR", (o) => o.t1Atr < 1],
  ["1to2", "T1 1–2 ATR", (o) => o.t1Atr >= 1 && o.t1Atr < 2],
  ["ge2", "T1 2 ATR or more", (o) => o.t1Atr >= 2],
];

const subsets = {};
for (const [sess, sessLabel, inSess] of [
  ["nyam", "fill bar 09:30–11:00 ET", (o) => o.nyAm],
  ["all", "every session", () => true],
]) {
  const base = fills.filter(inSess);
  subsets[`${sess}_all`] = {
    label: `${sessLabel} · every T1 distance`,
    ...curves(base),
    is: headline(base.filter((o) => IS_YEARS.includes(o.year))),
    oos: headline(base.filter((o) => OOS_YEARS.includes(o.year))),
  };
  for (const [key, label, inDist] of DIST) {
    const s = base.filter(inDist);
    subsets[`${sess}_${key}`] = {
      label: `${sessLabel} · ${label}`,
      ...curves(s),
      is: headline(s.filter((o) => IS_YEARS.includes(o.year))),
      oos: headline(s.filter((o) => OOS_YEARS.includes(o.year))),
    };
  }
}

const out = {
  version: 1,
  builtAt: new Date().toISOString(),
  script: "scripts/measure-option-time.mjs",
  rule: {
    population: "evidence-pack population (no Judas, no news, conf >= 0.65, deduped), T1 ahead, stop inside 0.5-1.5 ATR",
    live: "limit at CE within 12 bars, failed-hold close before T1, hard stop + 1 tick, 32-bar hold, ties against, the fill bar cannot score T1",
    clock: "bars after the fill bar; 1 bar = 15 minutes",
    t1: "first bar touching T1 before a stop or failed hold",
    loss: "the stop or the failed-hold close, T1 never touched",
    open: "neither inside 32 bars",
    halves: "IS 2022-24, OOS 2025-26 — headline numbers per half; nothing fitted",
  },
  barMinutes: 15,
  holdBars: HOLD_BARS,
  population: { cards, eligible: rows.length, unfilled, fills: fills.length, nyAmFills: fills.filter((o) => o.nyAm).length },
  subsets,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");

const show = (k) => {
  const s = subsets[k];
  console.log(
    `${k.padEnd(12)} n ${String(s.n).padStart(5)}  P(T1) ${s.pT1}  median T1 ${s.medianT1Bars} bars  loss ${s.medianLossBars}  T1 by 4 bars ${s.cdfT1[4]}  | IS n ${s.is.n} med ${s.is.medianT1Bars} · OOS n ${s.oos.n} med ${s.oos.medianT1Bars}`,
  );
};
console.log(`cards ${cards} · eligible ${rows.length} · fills ${fills.length} (NY AM ${out.population.nyAmFills})`);
for (const k of Object.keys(subsets)) show(k);
console.log("nyam_all P(T1 | nothing yet after k bars):", subsets.nyam_all.pT1Unresolved.slice(0, 9).join(" "));
console.log(`-> ${OUT}`);
