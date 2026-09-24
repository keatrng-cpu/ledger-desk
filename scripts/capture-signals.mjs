/**
 * Every decision the desk would have made over the 4-year tape, captured once.
 *
 *   npx tsx scripts/capture-signals.mjs --year 2023 [--out src/data/signals]
 *
 * WHY THIS EXISTS, AND WHY IT IS SEPARATE FROM THE BACKTEST
 *
 * Running the desk over one bar costs a full assembly: analyzeStructure, the
 * SMC tape, the scanner, the narrative, the draw engine and gradeSmcMaster,
 * on an 800-bar slice, for two symbols. Over 93,830 bars that is hours. Any
 * design that re-runs it per parameter variant can afford to test three
 * variants, which is how "we swept the exits" quietly becomes "we tried three
 * things".
 *
 * So the expensive part runs ONCE and writes what it found. The decision is
 * the expensive thing; the exit rule is arithmetic on bars that are already
 * on disk. Sweeping 500 exit variants then costs what sweeping one costs,
 * and the sweep can be honest about how many it looked at.
 *
 * WHAT IS DELIBERATELY NOT FILTERED HERE
 * The capture applies NO session filter. Not the killzone, not NY AM, not the
 * trade window. Every bar of the tape is asked the same question and the
 * answer is TAGGED with which window it fell in. That is the only way to
 * answer "what does the clock gate actually cost us" with data instead of an
 * opinion — a capture that drops out-of-window bars can only ever confirm
 * that out-of-window setups do not exist.
 *
 * Judas (09:30-09:45 ET) is captured and tagged the same way, and is refused
 * by every consumer. It is recorded so the refusal can be priced, never so it
 * can be lifted. CLAUDE.md is unambiguous and this script does not argue.
 *
 * NO LOOKAHEAD, MECHANICALLY
 * At bar i the engine is handed `bars.slice(i-HORIZON+1, i+1)` and the peer
 * series truncated to the same wall-clock instant. It never sees bar i+1. The
 * row records `i`, and every consumer simulates from i+1 onward — the two
 * cannot overlap because the boundary is an index, not a convention.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const YEAR = argOf("year", null);
const OUTDIR = argOf("out", "src/data/signals");
const LIMIT = Number(argOf("limit", "0")); // probe mode: stop after N bars
const CHUNK = Number(argOf("chunk", "0")); // 0-based chunk index
const OF = Number(argOf("of", "0")); // total chunks; 0 = no chunking

/* ── The desk, imported exactly as the live shell imports it ─────────────── */
const { getSessionClock, isJudasWindow, etWallParts } = await import("../src/lib/trading/sessions.ts");
const { analyzeStructure, smtDivergenceStack } = await import("../src/lib/trading/structure.ts");
const { buildSmcTape } = await import("../src/lib/trading/smc-board.ts");
const { scanSetups } = await import("../src/lib/trading/scanner.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");
const { buildMarketNarrative } = await import("../src/lib/trading/market-narrative.ts");
const { drawOnLiquidity } = await import("../src/lib/trading/draw.ts");
const { newsRead } = await import("../src/lib/trading/news.ts");
const { gradeSmcMaster } = await import("../src/lib/trading/smc-master.ts");

const H = JSON.parse(readFileSync("src/data/history-4y.json", "utf8"));
const MNQ = H.bars.MNQ ?? [];
const ES = H.bars.ES ?? [];
if (MNQ.length < 5000 || ES.length < 5000) {
  console.error(`tape too thin (MNQ ${MNQ.length}, ES ${ES.length}) — run capture-history.mjs first.`);
  process.exit(1);
}

/** Matches cases.ts — the live desk never sees more than this. */
const HORIZON = 800;
const WARMUP = 160;

/* ── Shock features, computed from the bar itself ────────────────────────── */

/** Wilder-free ATR over the last `n` closed bars. Cheap, and it is the same
 *  quantity trade-plan.ts uses for the risk floor, so the two agree. */
function atrAt(bars, end, n = 14) {
  let sum = 0;
  let k = 0;
  for (let i = Math.max(1, end - n + 1); i <= end; i++) {
    const b = bars[i];
    const p = bars[i - 1];
    sum += Math.max(b.h - b.l, Math.abs(b.h - p.c), Math.abs(b.l - p.c));
    k++;
  }
  return k > 0 ? sum / k : 0;
}

function medianVol(bars, end, n = 20) {
  const v = [];
  for (let i = Math.max(0, end - n + 1); i <= end; i++) v.push(bars[i].v ?? 0);
  v.sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

/**
 * How violent is THIS bar, relative to how this instrument has been moving?
 *
 * The point of these four numbers is that "a shock event" has to mean
 * something measurable before it can be allowed to substitute for a killzone.
 * A green candle that is 3x ATR on 4x median volume with a gap is a different
 * object from a green candle in a dead 16:40 tape, and the desk currently
 * cannot tell them apart because it only ever asked what time it was.
 */
function shockOf(bars, i) {
  const b = bars[i];
  const atr = atrAt(bars, i);
  const mv = medianVol(bars, i - 1);
  const prev = bars[i - 1];
  return {
    atr: +atr.toFixed(4),
    rngAtr: atr > 0 ? +((b.h - b.l) / atr).toFixed(3) : 0,
    bodyAtr: atr > 0 ? +(Math.abs(b.c - b.o) / atr).toFixed(3) : 0,
    volX: mv > 0 ? +(((b.v ?? 0) / mv)).toFixed(3) : 0,
    gapAtr: atr > 0 && prev ? +(Math.abs(b.o - prev.c) / atr).toFixed(3) : 0,
  };
}

/* ── The pass ────────────────────────────────────────────────────────────── */

const yearOf = (t) => new Date(t).getUTCFullYear();

// Peer alignment: ES index whose bar time is <= the MNQ bar time. Advanced
// monotonically so the whole pass stays O(n), and never allowed to include a
// peer bar that had not closed yet.
let peerIdx = 0;

const startI = YEAR
  ? Math.max(WARMUP, MNQ.findIndex((b) => yearOf(b.t) === Number(YEAR)))
  : WARMUP;
const endI = YEAR
  ? (() => {
      let last = -1;
      for (let i = 0; i < MNQ.length; i++) if (yearOf(MNQ[i].t) === Number(YEAR)) last = i;
      return last;
    })()
  : MNQ.length - 2;

if (startI < 0 || endI < 0 || endI <= startI) {
  console.error(`no bars for year ${YEAR}`);
  process.exit(1);
}

// Chunking splits the BAR RANGE, never the warmup: every chunk still slices
// its 800-bar horizon out of the full array, so a chunk boundary changes
// nothing about what the engine sees. The chunks are therefore genuinely
// independent and their union is bit-identical to one serial pass.
let lo = startI;
let hi = endI;
if (OF > 1) {
  const span = Math.ceil((endI - startI + 1) / OF);
  lo = startI + CHUNK * span;
  hi = Math.min(endI, lo + span - 1);
  if (lo > endI) {
    console.log(`chunk ${CHUNK}/${OF}: empty`);
    process.exit(0);
  }
}
const TAG = OF > 1 ? `${YEAR ?? "all"}-${CHUNK}` : `${YEAR ?? "all"}`;

const rows = [];
const t0 = Date.now();
let scanned = 0;
let seen = 0; // every bar-book with a numeric plan, kept or not

const layerIds = (layers, state) =>
  layers.filter((l) => l.must && l.state === state).map((l) => l.id);

/**
 * Which moments are worth writing down.
 *
 * 96% of bars produce SOME numeric plan, because the plan is built before the
 * word is decided — keeping all of them is 45MB of mostly "STAND, 2 of 9
 * layers". What the analysis needs is the moments where the desk was close to
 * a trade, plus every moment it was stopped by the clock specifically, since
 * that is the gate under examination.
 *
 * The filter is stated here rather than buried in a consumer so that every
 * number downstream can be read against a visible denominator.
 */
function worthKeeping(book, cand, clock) {
  if (book.word === "TAKE") return true;
  const bad = book.layers.filter((l) => l.must && l.state !== "pass");
  // Clock-only refusal: the exact population the killzone question is about.
  if (bad.length === 1 && bad[0].id === "time") return true;
  // Armed: retrace waiting, everything else in.
  if (bad.length === 1 && bad[0].state === "wait") return true;
  // Clock plus one other — the near-miss that a session change might reach.
  if (bad.length === 2 && bad.some((l) => l.id === "time")) return true;
  // Genuine near-miss at PATH confluence, whatever the hour.
  if (bad.length <= 2 && (cand?.confluence ?? 0) >= 0.65) return true;
  return false;
}

function record(book, cand, sym, i, peerI, clock, judas, newsBlk, shock, price) {
  if (!book || !book.side || !book.plan) return;
  const p = book.plan;
  if (!Number.isFinite(p.entry) || !Number.isFinite(p.stop) || !(p.riskPts > 0)) return;
  seen++;
  if (!worthKeeping(book, cand, clock)) return;
  rows.push({
    sym,
    i: sym === "MNQ" ? i : peerI,
    t: sym === "MNQ" ? MNQ[i].t : ES[peerI].t,
    side: book.side,
    word: book.word,
    conf: cand ? +Number(cand.confluence ?? 0).toFixed(4) : 0,
    band: cand ? String(cand.pathBand ?? cand.grade ?? "") : "",
    act: cand ? !!cand.actionable : false,
    kzOk: clock.inTradeWindow,
    kz: clock.killzone,
    etH: clock.etHour,
    etM: clock.etMinute,
    wd: clock.weekday,
    judas,
    news: newsBlk,
    pass: book.mustPass,
    need: book.mustNeed,
    fail: layerIds(book.layers, "fail"),
    wait: layerIds(book.layers, "wait"),
    px: +price.toFixed(2),
    e: +p.entry.toFixed(2),
    s: +p.stop.toFixed(2),
    t1: p.t1 == null ? null : +p.t1.toFixed(2),
    t2: p.t2 == null ? null : +p.t2.toFixed(2),
    rp: +p.riskPts.toFixed(2),
    tight: !!p.riskTooTight,
    ...shock,
  });
}

for (let i = lo; i <= hi; i++) {
  const now = MNQ[i];
  while (peerIdx < ES.length && ES[peerIdx].t <= now.t) peerIdx++;
  const peerI = peerIdx - 1;
  if (peerI < WARMUP) continue;

  const slice = MNQ.slice(Math.max(0, i + 1 - HORIZON), i + 1);
  const peerSlice = ES.slice(Math.max(0, peerI + 1 - HORIZON), peerI + 1);
  if (slice.length < WARMUP || peerSlice.length < WARMUP) continue;

  const clock = getSessionClock(new Date(now.t));
  const judas = isJudasWindow(clock.etHour, clock.etMinute);

  const dayPct = (s) => {
    const last = s[s.length - 1];
    const w = etWallParts(last.t);
    for (const b of s) {
      const bw = etWallParts(b.t);
      if (bw.year === w.year && bw.month === w.month && bw.day === w.day)
        return b.o > 0 ? ((last.c - b.o) / b.o) * 100 : 0;
    }
    return 0;
  };

  let master;
  try {
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
    const news = newsRead(new Date(now.t));

    master = gradeSmcMaster({
      clock,
      bias: { left: biasL, right: biasR },
      scan,
      draws: { left: drawL, right: drawR },
      narrative: { left: narrL, right: narrR },
      news,
      smtStack,
      smc,
      quotes: { left: { price: now.c }, right: { price: peerSlice[peerSlice.length - 1].c } },
      shockFloorMs: null,
      left: { bars: slice },
      right: { bars: peerSlice },
    });

    const newsBlk = news.verdict === "blackout";
    const shockL = shockOf(MNQ, i);
    const shockR = shockOf(ES, peerI);
    const candL = scan.candidates.find((c) => c.symbol === "MNQ") ?? null;
    const candR = scan.candidates.find((c) => c.symbol === "ES") ?? null;
    record(master.left, candL, "MNQ", i, peerI, clock, judas, newsBlk, shockL, now.c);
    record(master.right, candR, "ES", i, peerI, clock, judas, newsBlk, shockR, peerSlice[peerSlice.length - 1].c);
  } catch (e) {
    // One bad bar must not lose the year. Recorded and stepped over.
    if (scanned % 5000 === 0) console.error(`  bar ${i}: ${String(e).slice(0, 90)}`);
  }

  scanned++;
  if (scanned % 500 === 0) {
    const rate = scanned / ((Date.now() - t0) / 1000);
    const left = (hi - i) / rate;
    process.stderr.write(
      `\r  ${YEAR ?? "all"}: ${scanned}/${endI - startI + 1} bars · ${rows.length} signals · ${rate.toFixed(0)} bar/s · ~${(left / 60).toFixed(1)}m left   `,
    );
  }
  if (LIMIT && scanned >= LIMIT) break;
}

process.stderr.write("\n");

const out = `${OUTDIR}/signals-${TAG}.json`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(
  out,
  JSON.stringify({
    capturedAt: new Date().toISOString(),
    year: YEAR ?? "all",
    chunk: OF > 1 ? { index: CHUNK, of: OF, lo, hi } : null,
    planMoments: seen,
    barsScanned: scanned,
    horizon: HORIZON,
    note:
      "Every decision moment with a numeric plan, no session filter applied. " +
      "`i` indexes src/data/history-4y.json bars for that symbol; simulate from i+1 only. " +
      "Judas rows are tagged and must be refused by every consumer.",
    rows,
  }),
);
const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`${TAG}: ${rows.length} kept of ${seen} plan-moments across ${scanned} bars in ${secs}s -> ${out}`);
