/**
 * Does inducement (a shallow decoy sweep before the real one) or news timing
 * (minutes since the last scheduled high-impact release) predict anything
 * the current Q score does not already predict?
 *
 * WHY THIS IS A SEPARATE, EXPLORATORY SCRIPT, NOT A PATCH TO capture-signals.mjs
 * Both features are computable from data already on disk — the captured
 * signal rows (`.cache/signals/*.json`, `i` indexes the 4-year bar history)
 * and `src/data/history-4y.json` itself — so this re-derives them as a
 * POST-PROCESSING pass rather than re-running the full multi-hour desk
 * assembly (analyzeStructure + scanner + smc-master, per bar, per symbol —
 * capture-signals.mjs's own docstring: "over 93,830 bars that is hours").
 * Nothing here is wired into the live grade. This measures first.
 *
 * SAME POPULATION, SAME STATISTICAL BAR AS evidence-pack.json
 * Same filter (no Judas, no news-blackout row, conf >= 0.65), same sim()
 * (limit at CE, 50% at T1, stop to BE, runner to T2, ties against), same
 * day-clustered 95% CI, same both-halves-IS/OOS-agree-in-sign rule before a
 * bucket is allowed to say POSITIVE or NEGATIVE. A finding here is only
 * worth trusting if it would have cleared the same bar the Q-bands and the
 * musts-count buckets were held to — and both of those came back flat.
 *
 * INDUCEMENT, OPERATIONALIZED
 * The canon research note (src/lib/learn/canon.ts) already flags this as an
 * unresolved modeling choice: "Photon and TradingHub reframe the sweep as an
 * inducement grab, which is a different object (the first pullback, not the
 * external extreme)." Concretely: a SHALLOWER sweep of the same polarity
 * (sellside for a long setup, buyside for a short) printing shortly BEFORE
 * the deeper sweep the card is actually keyed on. Built directly on
 * detectors.ts's detectSweeps() — no new detection primitive invented, the
 * existing one re-run on the causal bar slice up to (and including) the
 * decision bar.
 *
 * NEWS TIMING, NOT "SURPRISE"
 * src/data/news-calendar.json carries only {date, timeEt, name, impact} — no
 * actual/consensus values anywhere in this repo. A real economic-surprise
 * magnitude (actual minus consensus) is NOT computable honestly from data on
 * disk, so this does not claim to compute one. What IS computable: minutes
 * since the most recent scheduled high-impact release, same ET day, at or
 * before the decision bar. That tests a different, real hypothesis — does
 * freshly-past-a-catalyst (outside the existing +/-15m blackout) carry any
 * signal — not "was this print a surprise".
 *
 * Run: npx tsx scripts/measure-inducement-news.mjs
 * In:  .cache/signals/signals-*.json, src/data/history-4y.json, src/data/news-calendar.json
 * Out: .cache/inducement-news-measurement.json (exploratory — not read by the app)
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const SIGDIR = ".cache/signals";
const HIST = "src/data/history-4y.json";
const NEWS = "src/data/news-calendar.json";
const OUT = ".cache/inducement-news-measurement.json";
const FILL_BARS = 12;
const HOLD_BARS = 32;
const TICK = 0.25;
const FLOOR = 0.65;
const TP1_FRACTION = 0.5;
const IS_YEARS = [2022, 2023, 2024];
const OOS_YEARS = [2025, 2026];
const MIN_READ = 30;

// Same recency window the live engine reads a sweep as "the raid" through
// (GATE.recentSweepBars default, detectors.ts RECENT_SWEEP_BARS).
const MAIN_SWEEP_WINDOW_BARS = 24;
// How far back before the main sweep an earlier, shallower sweep still
// counts as its own decoy leg rather than an unrelated event. 16 bars = 4h
// on 15m — inside a single session, generous enough to catch a pre-London
// or pre-NY-open decoy without reaching into the prior day.
const INDUCEMENT_WINDOW_BARS = 16;

const { etWallParts, etWallToEpochMs } = await import("../src/lib/trading/sessions.ts");
const { detectSweeps } = await import("../src/lib/trading/detectors.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };
const CALENDAR = JSON.parse(readFileSync(NEWS, "utf8"));

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

/* ── Inducement: two-stage sweep on the causal bar slice ─────────────────── */

// Cache detectSweeps() per (sym, i) is wasteful across nearby rows on the
// same symbol; sweeps only depend on the bar slice, so cache by symbol and
// reuse across rows, slicing the cached full-symbol sweep list down to
// "sweeps visible by bar i" per row instead of re-scanning bars every time.
const sweepCache = new Map();
function sweepsFor(sym) {
  if (!sweepCache.has(sym)) sweepCache.set(sym, detectSweeps(BARS[sym]));
  return sweepCache.get(sym);
}

/**
 * Was the sweep this card is keyed on preceded by a shallower sweep of the
 * SAME polarity within INDUCEMENT_WINDOW_BARS? Both sweeps must be visible
 * at bar `i` (detectSweeps confirms a swing MM_SWING_WIDTH bars after it
 * forms, and the sweep bar itself is bar `i` or earlier) — no lookahead.
 */
function inducementAt(sym, i, side) {
  const wantSide = side === "long" ? "sellside" : "buyside";
  const all = sweepsFor(sym).filter((s) => s.index <= i);
  const candidates = all.filter((s) => s.side === wantSide);
  if (!candidates.length) return { has: false, mainSweepIndex: null };
  const main = candidates[candidates.length - 1];
  if (i - main.index > MAIN_SWEEP_WINDOW_BARS) return { has: false, mainSweepIndex: null };
  const earlier = candidates.filter(
    (s) => s.index < main.index && main.index - s.index <= INDUCEMENT_WINDOW_BARS,
  );
  // Shallower = a less extreme level taken first: for a sellside pair, the
  // earlier low must sit ABOVE the main (deeper) low; for buyside, the
  // earlier high must sit BELOW the main (higher) high.
  const shallower = earlier.some((s) =>
    wantSide === "sellside" ? s.sweptLevel > main.sweptLevel : s.sweptLevel < main.sweptLevel,
  );
  return { has: shallower, mainSweepIndex: main.index };
}

/* ── News timing: minutes since the last scheduled high-impact release ──── */

const HIGH_IMPACT_EPOCHS = CALENDAR.filter((e) => e.impact === "high")
  .map((e) => etWallToEpochMs(e.date, e.timeEt))
  .sort((a, b) => a - b);

/** Minutes since the most recent high-impact release at/before t, same ET
 *  calendar day only (a release from yesterday is not "recent" today). */
function minutesSinceNews(t) {
  const w = etWallParts(t);
  let best = null;
  for (const et of HIGH_IMPACT_EPOCHS) {
    if (et > t) break;
    const ew = etWallParts(et);
    if (ew.year !== w.year || ew.month !== w.month || ew.day !== w.day) continue;
    best = et;
  }
  return best == null ? null : Math.round((t - best) / 60_000);
}

/* ── sim() and dirHit(), intentionally identical to build-evidence-pack.mjs
   for a like-for-like comparison — see that file for the rule this encodes. */

function barAtOrBefore(bars, t) {
  let lo = 0, hi = bars.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t <= t) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}
void barAtOrBefore; // kept for parity with build-evidence-pack.mjs; unused here

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

/* ── Build the sim rows once, with both new features attached ───────────── */

const sims = [];
for (const r of rows) {
  const s = sim(r);
  if (!s) continue;
  const ind = inducementAt(r.sym, r.i, r.side);
  sims.push({
    r, ...s,
    y: yearOf(r.t),
    day: dayKey(r.t),
    dir: dirHit(r),
    inducement: ind.has,
    hasMainSweep: ind.mainSweepIndex != null,
    newsMin: minutesSinceNews(r.t),
  });
}

/* ── Same bucket()/clustered() statistical methodology as build-evidence-pack.mjs ── */

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

const withMainSweep = sims.filter((o) => o.hasMainSweep);

const result = {
  builtAt: new Date().toISOString(),
  source: {
    capture: `${SIGDIR} (${captured} plan moments, ${rows.length} at or above the floor after Judas/news refusal)`,
    simulated: sims.length,
    filled: sims.filter((o) => o.filled).length,
    withMainSweepInWindow: withMainSweep.length,
  },
  note:
    "Exploratory. Same population, same sim, same verdict bar as evidence-pack.json (build-evidence-pack.mjs). " +
    "Nothing here is read by the live app — see the file header for why each feature is defined the way it is.",
  baseline: bucket("all", "every card in this population (sanity check vs evidence-pack baseline)", sims),
  inducement: [
    bucket("yes", "shallow decoy sweep before the main one (inducement)", withMainSweep.filter((o) => o.inducement)),
    bucket("no", "main sweep alone, no earlier decoy", withMainSweep.filter((o) => !o.inducement)),
  ],
  newsTiming: (() => {
    const within = (lo, hi) => (o) => o.newsMin != null && o.newsMin >= lo && o.newsMin < hi;
    return [
      bucket("15-30", "15-30 min after a high-impact release", sims.filter(within(15, 30))),
      bucket("30-60", "30-60 min after", sims.filter(within(30, 60))),
      bucket("60-120", "1-2h after", sims.filter(within(60, 120))),
      bucket("120+", "2h+ after (same ET day)", sims.filter((o) => o.newsMin != null && o.newsMin >= 120)),
      bucket("none", "no high-impact release yet today", sims.filter((o) => o.newsMin == null)),
    ];
  })(),
  // Does inducement's effect (if any) hold up WITHIN each Q band, or is it
  // just re-describing Q? A real, independent signal should show up net of
  // confluence, not only in the pooled cut above.
  inducementByQ: (() => {
    const qWithin = (lo, hi) => (o) => o.r.conf >= lo && o.r.conf < hi;
    const bands = [
      ["0.65-0.75", qWithin(0.65, 0.75)],
      ["0.75+", qWithin(0.75, 9)],
    ];
    const out = [];
    for (const [label, pred] of bands) {
      const pool = withMainSweep.filter(pred);
      out.push(bucket(`${label}|yes`, `Q ${label} + inducement`, pool.filter((o) => o.inducement)));
      out.push(bucket(`${label}|no`, `Q ${label}, no inducement`, pool.filter((o) => !o.inducement)));
    }
    return out;
  })(),
};

writeFileSync(OUT, JSON.stringify(result, null, 1) + "\n");

const show = (b) =>
  `${b.label.padEnd(52)} n=${String(b.n).padStart(4)}  exp ${b.exp == null ? "  —   " : (b.exp >= 0 ? "+" : "") + b.exp.toFixed(3)}  [${b.lo ?? "—"}, ${b.hi ?? "—"}]  IS ${b.isExp ?? "—"} OOS ${b.oosExp ?? "—"}  t1 ${b.t1Rate == null ? "—" : (b.t1Rate * 100).toFixed(1) + "%"}  dir ${b.dirHit == null ? "—" : (b.dirHit * 100).toFixed(1) + "%"}  ${b.verdict.toUpperCase()}`;

console.log(result.source.capture);
console.log(`simulated ${result.source.simulated}, filled ${result.source.filled}, with a main sweep in window ${result.source.withMainSweepInWindow}\n`);
console.log(show(result.baseline));
for (const k of ["inducement", "newsTiming", "inducementByQ"]) {
  console.log(`\n${k}`);
  for (const b of result[k]) console.log("  " + show(b));
}
console.log(`\nwrote ${OUT}`);
