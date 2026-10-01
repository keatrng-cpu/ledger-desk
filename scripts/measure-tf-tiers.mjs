/**
 * Does the trader's tiered, closed-candle timeframe ladder predict outcomes?
 *
 * The ladder (src/lib/trading/tf-ladder.ts, rebuilt 2026-10-01) reads the
 * trader's twelve frames in four tiers — Q·M·W·D bias / 4H·1H·30m range /
 * 15m·5m confirm / 3m·2m·1m trigger — from CLOSED candles only, direction
 * from the top of Tier 1, "the higher frame wins". This measures that read
 * against the four-year capture before it is allowed to touch the score.
 *
 * DECISION RULES, FIXED BEFORE THE FIRST RUN (no fishing after the fact)
 *   - tf_dir = against is NEGATIVE (both halves, CI below zero, n >= 30) and
 *     worse than tf_dir = with  -> the scanner vetoes cards against Tier 1
 *     (same discount as the inducement / mitigation vetoes).
 *   - tf_dir = with is POSITIVE -> it may earn a score bonus.
 *   - anything else -> it stays a warning (ladder-conflict.ts), with its n=13
 *     evidence replaced by these numbers.
 *
 * WHAT CAN AND CANNOT BE MEASURED HERE
 * The four-year tape is 15m bars. Tier 1 (daily candles are built per CME
 * trade date from the 15m), Tier 2 (4H/1H/30m resampled) and the 15m half of
 * Tier 3 are measurable over four years. The 5m and Tier 4 (3m/2m/1m) are not
 * — there is no four-year 1m tape — and the trader's own hierarchy keeps
 * Tier 4 out of direction anyway.
 *
 * CAUSAL
 * Each card is read with only the bars up to and including its decision bar,
 * now = that bar's close. The current trade date's daily candle is rebuilt
 * from that day's 15m bars up to the decision bar, never from the full day.
 *
 * SAME POPULATION, SAME SIM, SAME VERDICT BAR as build-evidence-pack.mjs.
 *
 * Run: npx tsx scripts/measure-tf-tiers.mjs [--sample N]
 * Out: .cache/tf-tiers-measurement.json (exploratory — not read by the app)
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const OUT = ".cache/tf-tiers-measurement.json";
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const FLOOR = 0.65;
const TP1_FRACTION = 0.5;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const MIN_READ = 30;
/** 15m bars handed to the intraday rungs: 60 closed 4H candles need ~960. */
const INTRADAY_SLICE = 1100;

const sampleArg = process.argv.indexOf("--sample");
const SAMPLE = sampleArg > 0 ? Number(process.argv[sampleArg + 1]) : 0;

const { etWallParts } = await import("../src/lib/trading/sessions.ts");
const { buildTfLadder, ladderTags, tradeDateOf } = await import("../src/lib/trading/tf-ladder.ts");
const { etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

/* ── Per-symbol trade-date index, built once ─────────────────────────────── */

const DAYIDX = {};
for (const sym of Object.keys(BARS)) {
  const bars = BARS[sym];
  const td = new Array(bars.length);
  const days = []; // { date, start, end }
  for (let i = 0; i < bars.length; i++) {
    td[i] = tradeDateOf(bars[i].t);
    if (!days.length || days[days.length - 1].date !== td[i]) days.push({ date: td[i], start: i, end: i });
    else days[days.length - 1].end = i;
  }
  const dayOfBar = new Int32Array(bars.length);
  days.forEach((d, k) => {
    for (let i = d.start; i <= d.end; i++) dayOfBar[i] = k;
  });
  const daily = days.map((d) => {
    let h = -Infinity, l = Infinity, v = 0;
    for (let i = d.start; i <= d.end; i++) {
      h = Math.max(h, bars[i].h);
      l = Math.min(l, bars[i].l);
      v += bars[i].v ?? 0;
    }
    return { t: etWallToEpochMs(d.date, "00:00"), o: bars[d.start].o, h, l, c: bars[d.end].c, v };
  });
  DAYIDX[sym] = { days, dayOfBar, daily };
}

/** Daily candles a card at bar i could have seen: closed days + today so far. */
function causalDaily(sym, i) {
  const { days, dayOfBar, daily } = DAYIDX[sym];
  const k = dayOfBar[i];
  const bars = BARS[sym];
  const d = days[k];
  let h = -Infinity, l = Infinity, v = 0;
  for (let j = d.start; j <= i; j++) {
    h = Math.max(h, bars[j].h);
    l = Math.min(l, bars[j].l);
    v += bars[j].v ?? 0;
  }
  const today = { t: daily[k].t, o: bars[d.start].o, h, l, c: bars[i].c, v };
  return [...daily.slice(Math.max(0, k - 800), k), today];
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
if (SAMPLE > 0) rows = rows.filter((_, k) => k % Math.max(1, Math.floor(rows.length / SAMPLE)) === 0).slice(0, SAMPLE);

const yearOf = (t) => new Date(t).getUTCFullYear();
const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${w.month}-${w.day}`;
};

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

/* ── Build the rows ──────────────────────────────────────────────────────── */

const started = Date.now();
const sims = [];
for (const r of rows) {
  const s = sim(r);
  if (!s) continue;
  const bars = BARS[r.sym];
  const nowMs = bars[r.i].t + 15 * 60_000;
  const ladder = buildTfLadder({
    symbol: r.sym,
    daily: causalDaily(r.sym, r.i),
    m15: bars.slice(Math.max(0, r.i + 1 - INTRADAY_SLICE), r.i + 1),
    m1: [],
    nowMs,
  });
  const tags = ladderTags(ladder, r.side);
  sims.push({ r, ...s, y: yearOf(r.t), day: dayKey(r.t), dir: dirHit(r), tags, decidedBy: ladder.decidedBy });
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

/* ── Same clustered()/bucket() as build-evidence-pack.mjs ────────────────── */

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
    exp: r3(pooled?.mean ?? null), lo: r3(pooled?.lo ?? null), hi: r3(pooled?.hi ?? null),
    isExp: r3(isExp), oosExp: r3(oosExp), isN: isF.length, oosN: oosF.length,
    t1Rate: r3(t1Rate),
    dirHit: r3(dirs.length >= MIN_READ ? dirs.filter(Boolean).length / dirs.length : null),
    dirN: dirs.length,
    verdict,
  };
}
const by = (tag, label) =>
  ["with", "against", "flat", "eq"]
    .map((v) => bucket(`${tag}|${v}`, `${label}: ${v}`, sims.filter((o) => o.tags[tag] === v)))
    .filter((b) => b.signals > 0);

const result = {
  builtAt: new Date().toISOString(),
  source: {
    capture: `${SIGDIR} (${captured} plan moments, ${rows.length} at or above the floor after Judas/news refusal${SAMPLE ? `, sampled ${SAMPLE}` : ""})`,
    simulated: sims.length,
    filled: sims.filter((o) => o.filled).length,
    seconds: Number(elapsed),
  },
  baseline: bucket("all", "every card in this population", sims),
  tierOneDirection: by("tf_dir", "Tier 1 direction vs the card"),
  tier2: by("tf_tier2", "Tier 2 (4H/1H/30m) vs the card"),
  tier3_15m: by("tf_15m", "15m vs the card"),
  ipda: by("tf_ipda", "IPDA 60-day zone vs the card (long wants discount)"),
  rungs: Object.fromEntries(["3M", "1M", "1w", "1d", "4h", "1h", "30m"].map((tf) => [tf, by(`tf_${tf}`, `${tf} vs the card`)])),
  decidedBy: ["3M", "1M", "1w", "1d"].map((tf) =>
    bucket(`decided|${tf}|against`, `against Tier 1, decided by ${tf}`, sims.filter((o) => o.decidedBy === tf && o.tags.tf_dir === "against")),
  ),
  stack: [
    bucket("t1with_t2with", "Tier 1 with AND Tier 2 with", sims.filter((o) => o.tags.tf_dir === "with" && o.tags.tf_tier2 === "with")),
    bucket("t1with_t2against", "Tier 1 with, Tier 2 against (a pullback)", sims.filter((o) => o.tags.tf_dir === "with" && o.tags.tf_tier2 === "against")),
    bucket("t1against_t2with", "Tier 1 against, Tier 2 with", sims.filter((o) => o.tags.tf_dir === "against" && o.tags.tf_tier2 === "with")),
    bucket("t1against_t2against", "Tier 1 against AND Tier 2 against", sims.filter((o) => o.tags.tf_dir === "against" && o.tags.tf_tier2 === "against")),
  ],
  phase: [...new Set(sims.map((o) => o.tags.tf_phase))].map((p) => bucket(`phase|${p}`, `phase ${p}`, sims.filter((o) => o.tags.tf_phase === p))),
};

writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");

const show = (b) =>
  `${b.label.padEnd(52)} n=${String(b.n).padStart(4)}  exp ${b.exp == null ? "  —   " : (b.exp >= 0 ? "+" : "") + b.exp.toFixed(3)}  [${b.lo ?? "—"}, ${b.hi ?? "—"}]  IS ${b.isExp ?? "—"} OOS ${b.oosExp ?? "—"}  t1 ${b.t1Rate == null ? "—" : (b.t1Rate * 100).toFixed(1) + "%"}  dir ${b.dirHit == null ? "—" : (b.dirHit * 100).toFixed(1) + "%"}  ${b.verdict.toUpperCase()}`;
console.log(result.source.capture);
console.log(`simulated ${result.source.simulated}, filled ${result.source.filled}, ${elapsed}s\n`);
console.log(show(result.baseline));
for (const k of ["tierOneDirection", "tier2", "tier3_15m", "ipda", "decidedBy", "stack", "phase"]) {
  console.log(`\n${k}`);
  for (const b of result[k]) console.log("  " + show(b));
}
console.log("\nrungs");
for (const [tf, bs] of Object.entries(result.rungs)) for (const b of bs) console.log("  " + show(b));
console.log(`\nwrote ${OUT}`);
