/**
 * Place it — the cases for the replay execution drill (Learn tab, last step).
 *
 * WHAT A CASE IS
 * One moment the desk priced a plan over the four-year capture: the 64 closed
 * 15m bars the trader could have seen, the desk's word and must-layers at that
 * bar, the plan's CE / stop / T1 / T2, the raid and the entry array, and the
 * bars AFTER it — hidden until the trader has committed an order. Plus what
 * the desk's own plan paid under the rule as coded, for the reveal.
 *
 * STRATIFIED, NOT CHERRY-PICKED
 * The capture is 70% London and 42% Q 0.85+, so a random sample would drill
 * mostly one session at one grade. Cases are instead allocated EQUALLY across
 * the levels of each dimension the trader reads a card by — Q band, stop/ATR
 * band, captured word, session, and the two halves of the tape the evidence
 * pack splits on (at half weight: the blocker layer, symbol and side) — by a
 * greedy fill that always
 * takes the candidate the current counts need most. Candidates are visited in
 * a seeded hash order of sym|i, never Math.random, so the same capture always
 * yields the same 160. Nothing looks at the outcome: the future bars are read
 * only AFTER a case is chosen, to store them.
 *
 * Three refusals shape the pool, each for a stated reason:
 *   - Judas and news-blackout rows, and anything under the 0.65 floor — every
 *     consumer of the capture refuses them (build-evidence-pack.mjs does too).
 *   - Consecutive bars re-printing the SAME plan on the same day are one
 *     setup, not several: one case per (sym, side, CE, stop, T1, T2, ET day).
 *     A TAKE setup is represented by its first TAKE bar, so every distinct
 *     TAKE the capture holds is in the set.
 *   - No two cases share any bar of wall-clock time, on either book. MNQ and
 *     ES move together, so one case's hidden future must never be another
 *     case's visible past.
 *
 * THE RAID AND THE ARRAY ARE RE-DERIVED, NOT GUESSED
 * The capture stores the plan's numbers but not the raid wick or the array's
 * edges, and "stop beyond the raid" cannot be scored without them. So each
 * chosen case is re-run through the desk exactly as capture-signals.mjs ran it
 * (same modules, same 800-bar horizon, same peer alignment), and the re-run is
 * accepted ONLY if it reproduces the captured side, CE, stop, T1 and T2 to the
 * cent. A case that does not reproduce is refused, not patched: its raid and
 * array would be a different plan's.
 *
 * THE FUTURE WINDOW IS THE RULE'S OWN LENGTH
 * FUTURE_BARS = FILL_BARS + HOLD_BARS - 1 (43): the latest legal fill held for
 * its full life. The desk's outcome is simulated on exactly the stored bars,
 * and the verifier re-simulates it on the full four-year tape to prove the
 * window cut nothing off.
 *
 * Run: npx tsx scripts/build-replay-drills.mjs [--signals <dir>] [--n 160]
 * In:  .cache/signals/signals-all-*.json (capture-signals.mjs — gitignored;
 *      found by walking up from the repo, so a worktree finds the main
 *      checkout's), src/data/history-4y.json, src/data/evidence-pack.json
 * Out: src/data/replay-drills.json
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const k = argv.indexOf(`--${name}`);
  return k >= 0 && argv[k + 1] ? argv[k + 1] : dflt;
};

const N = Number(argOf("n", "160"));
const SEED = "place-it-v1";
const FLOOR = 0.65;
const IS_YEARS = [2022, 2023, 2024]; // same halves as the evidence pack
const HORIZON = 800; // capture-signals.mjs
const OUT = join(ROOT, "src/data/replay-drills.json");
const HIST = join(ROOT, "src/data/history-4y.json");

/* ── The capture ─────────────────────────────────────────────────────────── */

function findSignals() {
  const arg = argOf("signals", null);
  if (arg) return arg;
  let dir = ROOT;
  for (let k = 0; k < 8; k++) {
    const cand = join(dir, ".cache", "signals");
    if (existsSync(cand) && readdirSync(cand).some((f) => /^signals-all-\d+\.json$/.test(f))) return cand;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}

const SIGDIR = findSignals();
if (!SIGDIR || !existsSync(HIST)) {
  console.error("needs the causal capture (.cache/signals/signals-all-*.json, or --signals <dir>) and src/data/history-4y.json");
  process.exit(1);
}

const {
  DECISION,
  PAST_BARS,
  FUTURE_BARS,
  FILL_BARS,
  HOLD_BARS,
  TP1_FRACTION,
  simulateOrder,
  deskOrder,
  toDeskRecord,
  expectedAction,
  blockerLabel,
  tickOf,
} = await import("../src/lib/learn/replay-drill.ts");
const { MIN_RISK_ATR, MAX_RISK_ATR_TRADABLE } = await import("../src/lib/trading/trade-plan.ts");
const { qBucket } = await import("../src/lib/trading/evidence.ts");
const { getSessionClock, etWallParts } = await import("../src/lib/trading/sessions.ts");
// The desk, imported exactly as capture-signals.mjs imports it.
const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { scanSetups } = await import("../src/lib/trading/scanner.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");

const H = JSON.parse(readFileSync(HIST, "utf8"));
const BARS = { MNQ: H.bars.MNQ ?? [], ES: H.bars.ES ?? [] };

const files = readdirSync(SIGDIR)
  .filter((f) => /^signals-all-\d+\.json$/.test(f))
  .sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
let rows = [];
const capturedAt = [];
for (const f of files) {
  const j = JSON.parse(readFileSync(join(SIGDIR, f), "utf8"));
  capturedAt.push(j.capturedAt);
  rows.push(...j.rows);
}
const captured = rows.length;
{
  // Chunks overlap at their seams: one row per (sym, bar, side).
  const seen = new Set();
  rows = rows.filter((r) => {
    const k = `${r.sym}|${r.i}|${r.side}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
const deduped = rows.length;
rows = rows.filter((r) => !r.judas && !r.news && r.conf >= FLOOR);
const eligibleRows = rows.length;

/* ── Deterministic order ─────────────────────────────────────────────────── */

function fnv(s) {
  let h = 0x811c9dc5;
  for (let k = 0; k < s.length; k++) {
    h ^= s.charCodeAt(k);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
const hashOf = (r) => fnv(`${SEED}|${r.sym}|${r.i}`);

/* ── Strata ──────────────────────────────────────────────────────────────── */

const yearOf = (t) => new Date(t).getUTCFullYear();
const dayOf = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};
const bandOf = (r) => {
  const x = Math.abs(r.e - r.s) / r.atr;
  return x < MIN_RISK_ATR ? `<${MIN_RISK_ATR}` : x <= MAX_RISK_ATR_TRADABLE ? `${MIN_RISK_ATR}-${MAX_RISK_ATR_TRADABLE}` : `>${MAX_RISK_ATR_TRADABLE}`;
};
const DIMS = {
  q: { of: (r) => qBucket(r.conf)?.key ?? "?", levels: ["0.65-0.70", "0.70-0.75", "0.75-0.80", "0.80-0.85", "0.85+"], w: 1 },
  band: {
    of: bandOf,
    levels: [`<${MIN_RISK_ATR}`, `${MIN_RISK_ATR}-${MAX_RISK_ATR_TRADABLE}`, `>${MAX_RISK_ATR_TRADABLE}`],
    w: 1,
  },
  session: { of: (r) => (r.kz === "london" ? "london" : r.kz === "ny_am" ? "ny_am" : "other"), levels: ["london", "ny_am", "other"], w: 1 },
  half: { of: (r) => (IS_YEARS.includes(yearOf(r.t)) ? "2022-24" : "2025-26"), levels: ["2022-24", "2025-26"], w: 1 },
  word: { of: (r) => r.word, levels: ["WAIT", "STAND"], w: 1 },
  // The layer a WAIT / STAND stopped on. Without it the fill follows the
  // capture's own mix — the raid alone blocks a third of the pool — and the
  // one blocker the "do not chase" discipline is about (the retrace) came out
  // at 3 cases of 160. Half weight: it spreads the blockers without letting
  // them override the five strata a card is read by.
  blocker: {
    of: (r) => (r.word === "TAKE" ? "none" : (r.fail[0] ?? r.wait[0] ?? "path")),
    levels: ["dol", "htf", "sweep", "pd_half", "ltf", "time", "target", "retrace", "path"],
    w: 0.5,
  },
  sym: { of: (r) => r.sym, levels: ["MNQ", "ES"], w: 0.5 },
  side: { of: (r) => r.side, levels: ["long", "short"], w: 0.5 },
};

/* ── Episodes ────────────────────────────────────────────────────────────── */

const episodes = new Map();
for (const r of rows) {
  const k = `${r.sym}|${r.side}|${r.e}|${r.s}|${r.t1}|${r.t2}|${dayOf(r.t)}`;
  const ep = episodes.get(k);
  if (ep) ep.push(r);
  else episodes.set(k, [r]);
}
const reps = [];
for (const ep of episodes.values()) {
  const takes = ep.filter((r) => r.word === "TAKE").sort((a, b) => a.i - b.i);
  reps.push(takes.length ? takes[0] : [...ep].sort((a, b) => hashOf(a) - hashOf(b))[0]);
}
reps.sort((a, b) => hashOf(a) - hashOf(b) || a.i - b.i);

/* ── Windows and the re-run ──────────────────────────────────────────────── */

function windowOf(r) {
  const b = BARS[r.sym];
  const lo = r.i - (PAST_BARS - 1);
  const hi = r.i + FUTURE_BARS;
  if (lo < 0 || hi >= b.length) return null;
  return { start: b[lo].t, end: b[hi].t };
}

function lastAtOrBefore(bars, t) {
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
function firstAtOrAfter(bars, t) {
  let lo = 0;
  let hi = bars.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid].t >= t) {
      ans = mid;
      hi = mid - 1;
    } else lo = mid + 1;
  }
  return ans;
}

const dayPct = (s) => {
  const last = s[s.length - 1];
  const w = etWallParts(last.t);
  for (const b of s) {
    const bw = etWallParts(b.t);
    if (bw.year === w.year && bw.month === w.month && bw.day === w.day) return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
  }
  return 0;
};

/**
 * The desk at one captured moment, assembled exactly as capture-signals.mjs
 * assembles it — MNQ drives the loop and ES is the last bar at or before it.
 */
function rerun(r) {
  const MNQ = BARS.MNQ;
  const ES = BARS.ES;
  let i;
  let peerI;
  if (r.sym === "MNQ") {
    i = r.i;
    peerI = lastAtOrBefore(ES, MNQ[i].t);
  } else {
    peerI = r.i;
    i = firstAtOrAfter(MNQ, ES[peerI].t);
    if (i < 0 || lastAtOrBefore(ES, MNQ[i].t) !== peerI) return null;
  }
  const now = MNQ[i];
  const slice = MNQ.slice(Math.max(0, i + 1 - HORIZON), i + 1);
  const peerSlice = ES.slice(Math.max(0, peerI + 1 - HORIZON), peerI + 1);
  const clock = getSessionClock(new Date(now.t));
  const biasL = analyzeStructure("MNQ", slice, dayPct(slice));
  const biasR = analyzeStructure("ES", peerSlice, dayPct(peerSlice));
  const smtStack = smtDivergenceStack(slice, peerSlice);
  const smc = { left: buildSmcTape(slice), right: buildSmcTape(peerSlice) };
  const drawL = drawOnLiquidity(biasL, slice);
  const drawR = drawOnLiquidity(biasR, peerSlice);
  const scan = scanSetups(biasL, biasR, clock, smtStack.primary, slice, peerSlice, smc);
  const detL = summarizeDetectors(slice);
  const detR = summarizeDetectors(peerSlice);
  const narrL = buildMarketNarrative(biasL, detL, clock, biasL.topDown === "bear" ? "bear" : "bull", slice);
  const narrR = buildMarketNarrative(biasR, detR, clock, biasR.topDown === "bear" ? "bear" : "bull", peerSlice);
  const master = gradeSmcMaster({
    clock,
    bias: { left: biasL, right: biasR },
    scan,
    draws: { left: drawL, right: drawR },
    narrative: { left: narrL, right: narrR },
    news: newsRead(new Date(now.t)),
    smtStack,
    smc,
    quotes: { left: { price: now.c }, right: { price: peerSlice[peerSlice.length - 1].c } },
    shockFloorMs: null,
    left: { bars: slice },
    right: { bars: peerSlice },
  });
  const book = r.sym === "MNQ" ? master.left : master.right;
  const p = book.plan;
  const n2 = (x) => (x == null ? null : +x.toFixed(2));
  const same =
    book.side === r.side && p != null && n2(p.entry) === r.e && n2(p.stop) === r.s && n2(p.t1) === r.t1 && n2(p.t2) === r.t2;
  if (!same) return { ok: false };
  return {
    ok: true,
    word: book.word,
    missing: book.missing,
    missingDetail: book.missingDetail,
    zone: p.entryZone ? [n2(p.entryZone.bottom), n2(p.entryZone.top)] : null,
    raid: p.sweep ? n2(p.sweep.price) : null,
    draw: p.t1 != null && p.draw ? p.draw.name : null,
    range: p.range ? [n2(p.range.low), n2(p.range.eq), n2(p.range.high)] : null,
  };
}

/* ── Selection ───────────────────────────────────────────────────────────── */

const chosen = [];
const windows = [];
const counts = Object.fromEntries(Object.keys(DIMS).map((d) => [d, {}]));
const log = { rerunRefused: 0, overlapSkipped: 0, rerunWordAgrees: 0 };

const overlaps = (w) => windows.some((x) => w.start <= x.end && x.start <= w.end);

function take(r, re) {
  chosen.push({ r, re });
  windows.push(windowOf(r));
  for (const [d, spec] of Object.entries(DIMS)) {
    const lv = spec.of(r);
    counts[d][lv] = (counts[d][lv] ?? 0) + 1;
  }
  if (re.word === r.word) log.rerunWordAgrees++;
}

const refused = new Set();
function tryTake(r) {
  const w = windowOf(r);
  if (!w) return false;
  if (overlaps(w)) {
    log.overlapSkipped++;
    return false;
  }
  const re = rerun(r);
  if (!re?.ok) {
    log.rerunRefused++;
    refused.add(r);
    return false;
  }
  take(r, re);
  return true;
}

// Every distinct TAKE setup first, oldest first.
const takeReps = reps.filter((r) => r.word === "TAKE").sort((a, b) => a.t - b.t);
for (const r of takeReps) tryTake(r);
const takesIn = chosen.length;

// Then the greedy fill over WAIT / STAND.
const rest = N - chosen.length;
const target = (d) => {
  // Word and blocker are allocated over the WAIT / STAND slots only — the
  // TAKE setups are all in already and carry neither level.
  if (d === "word" || d === "blocker") return rest / DIMS[d].levels.length;
  return N / DIMS[d].levels.length;
};
const pool = reps.filter((r) => r.word !== "TAKE");
const used = new Set(chosen.map((c) => c.r));
while (chosen.length < N) {
  let best = null;
  let bestScore = -1;
  for (const r of pool) {
    if (used.has(r) || refused.has(r)) continue;
    let score = 0;
    for (const [d, spec] of Object.entries(DIMS)) {
      const lv = spec.of(r);
      const t = target(d);
      score += spec.w * Math.max(0, t - (counts[d][lv] ?? 0)) / t;
    }
    if (score > bestScore + 1e-12) {
      best = r;
      bestScore = score;
    }
  }
  if (!best) break;
  used.add(best);
  tryTake(best);
}

/* ── Cases ───────────────────────────────────────────────────────────────── */

const r2 = (x) => Math.round(x * 100) / 100;
const cases = chosen.map(({ r, re }) => {
  const b = BARS[r.sym];
  const lo = r.i - DECISION;
  const t0 = b[lo].t;
  const bars = b.slice(lo, r.i + FUTURE_BARS + 1).map((x) => [Math.round((x.t - t0) / 60_000), r2(x.o), r2(x.h), r2(x.l), r2(x.c)]);
  const base = {
    id: `${r.sym}-${r.i}-${r.side === "long" ? "L" : "S"}`,
    sym: r.sym,
    side: r.side,
    i: r.i,
    t: r.t,
    t0,
    word: r.word,
    fail: r.fail,
    wait: r.wait,
    conf: r.conf,
    band: r.band,
    kz: r.kz,
    etH: r.etH,
    etM: r.etM,
    wd: r.wd,
    atr: r.atr,
    px: r.px,
    e: r.e,
    s: r.s,
    t1: r.t1,
    t2: r.t2,
    zone: re.zone,
    raid: re.raid,
    draw: re.draw,
    range: re.range,
    why: null,
  };
  // The desk's own sentence for the blocker — only when the re-run printed the
  // same word and named the same layer the capture did, so the words cannot
  // describe a different state than the one being drilled.
  if (r.word !== "TAKE" && re.word === r.word && re.missing === blockerLabel(r.fail[0] ?? r.wait[0] ?? "path")) {
    base.why = re.missingDetail;
  }
  const simBars = bars.map(([, o, h, l, c]) => ({ o, h, l, c }));
  const desk = toDeskRecord(simulateOrder(simBars, DECISION, deskOrder(base)));
  return { ...base, bars, desk };
});
cases.sort((a, b) => fnv(`${SEED}|${a.sym}|${a.i}`) - fnv(`${SEED}|${b.sym}|${b.i}`) || a.i - b.i);

/* ── Stats ───────────────────────────────────────────────────────────────── */

const tally = (items, f) => {
  const m = {};
  for (const x of items) {
    const k = f(x);
    m[k] = (m[k] ?? 0) + 1;
  }
  return m;
};
const expected = cases.map((c) => ({ c, x: expectedAction(c) }));
const perStratum = Object.fromEntries(Object.entries(DIMS).map(([d, spec]) => [d, tally(chosen.map((x) => x.r), spec.of)]));
perStratum.word = tally(cases, (c) => c.word);
const population = Object.fromEntries(Object.entries(DIMS).map(([d, spec]) => [d, tally(reps, spec.of)]));
const deskKinds = tally(cases, (c) => c.desk.kind);
const filled = cases.filter((c) => c.desk.kind === "filled");
const meanR = filled.length ? filled.reduce((s, c) => s + c.desk.R, 0) / filled.length : null;

const selection = {
  seed: SEED,
  method:
    "equal allocation per level of each stratum (Q band, stop/ATR band, captured word, session, IS/OOS half; blocker layer, symbol and side at half weight), greedy fill in seeded hash order; every distinct TAKE setup included; no two case windows share wall-clock time; re-run must reproduce the plan to the cent",
  captured,
  deduped,
  eligibleRows,
  episodes: reps.length,
  takeRows: rows.filter((r) => r.word === "TAKE").length,
  takeEpisodes: takeReps.length,
  takesIncluded: takesIn,
  rerunRefused: log.rerunRefused,
  overlapSkipped: log.overlapSkipped,
  rerunWordAgrees: `${log.rerunWordAgrees}/${chosen.length}`,
  cases: cases.length,
  perStratum,
  expectedWord: tally(expected, ({ x }) => x.word),
  blockers: tally(expected, ({ x }) => x.blocker ?? "none"),
  population,
  deskOutcome: { ...deskKinds, meanRFilled: meanR == null ? null : Math.round(meanR * 1000) / 1000 },
};

const head = {
  builtAt: new Date().toISOString(),
  source: {
    capture: `.cache/signals/signals-all-*.json — ${files.length} chunks captured ${capturedAt.sort()[0]} → ${capturedAt.sort().at(-1)}; ${captured} rows, ${deduped} after dedupe, ${eligibleRows} at or above ${FLOOR} after Judas/news refusal`,
    tape: `src/data/history-4y.json ${H.window?.start} -> ${H.window?.end}, ${H.interval}`,
    word: "the desk's word and must-layers as CAPTURED (engine of the capture date — before the session gate read the tape and before the stop band); the drill's expected answer applies today's stop band on top (replay-drill.ts expectedAction)",
    raid: "raid wick and entry array re-derived by re-running the desk at the decision bar (build-replay-drills.mjs rerun), accepted only when it reproduced the captured side, CE, stop, T1 and T2 to the cent",
  },
  rules: {
    fillBars: FILL_BARS,
    holdBars: HOLD_BARS,
    tp1Fraction: TP1_FRACTION,
    pastBars: PAST_BARS,
    futureBars: FUTURE_BARS,
    tick: tickOf("MNQ"),
  },
  selection,
};

const headText = JSON.stringify(head, null, 1);
const text = `${headText.slice(0, -2)},\n "cases": [\n${cases.map((c) => `  ${JSON.stringify(c)}`).join(",\n")}\n ]\n}\n`;
JSON.parse(text); // refuse to write anything that does not parse
writeFileSync(OUT, text);

console.log(`capture ${SIGDIR}`);
console.log(`${captured} rows → ${deduped} deduped → ${eligibleRows} eligible → ${reps.length} setups`);
console.log(`TAKE: ${selection.takeRows} rows = ${selection.takeEpisodes} setups, ${takesIn} included`);
console.log(`re-run refused ${log.rerunRefused}, overlap skipped ${log.overlapSkipped}, re-run word agrees ${selection.rerunWordAgrees}`);
for (const [d, m] of Object.entries(perStratum)) console.log(`  ${d.padEnd(8)} ${JSON.stringify(m)}`);
console.log(`  expected ${JSON.stringify(selection.expectedWord)}`);
console.log(`  blockers ${JSON.stringify(selection.blockers)}`);
console.log(`  desk     ${JSON.stringify(selection.deskOutcome)}`);
console.log(`wrote ${OUT} — ${cases.length} cases, ${(Buffer.byteLength(text) / 1024).toFixed(0)} KB`);
