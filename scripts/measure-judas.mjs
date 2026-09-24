/**
 * The Judas window, priced for the first time.
 *
 *   npx tsx scripts/measure-judas.mjs
 *
 * WHY THIS HAD TO EXIST BEFORE THE GATE MOVED
 * 09:30–09:45 ET was the desk's one unconditional refusal, enforced in three
 * separate places, and nothing in this repository had ever measured it. No n,
 * no win rate, no expectancy — it was the only hard gate running purely on
 * doctrine. Opening it on the strength of an argument would have replaced one
 * unmeasured rule with another.
 *
 * WHAT IT MEASURES
 * `judas-window.ts` releases the window only when the open's manipulation has
 * demonstrably finished: a raid printed on a sub-15m rung, price closed back
 * inside the pool it took, and a LATER bar displaced against it. This walks
 * every Judas window in the 1m tape and asks three questions:
 *
 *   1. How often does that resolution actually occur inside the window?
 *   2. When it does, what did fading the failed raid go on to do?
 *   3. And is that better or worse than the rest of the session — i.e. is
 *      the released window a good window, or merely a permitted one?
 *
 * WHY THE 1m FILE AND NOT THE FOUR-YEAR TAPE
 * The four-year capture is 15m, and 09:30–09:45 is EXACTLY ONE 15m candle.
 * On that series the raid and the reaction to the raid are the same bar, so
 * the release can never fire and the question cannot be asked. The honest
 * sample is `src/data/learn-history-1m.json` — two months, ~44 sessions — and
 * this script reports that n rather than borrowing a bigger one that cannot
 * answer the question.
 *
 * NO LOOKAHEAD
 * The decision at minute i uses bars[0..i]. The simulation starts at i+1.
 * Intrabar ties go against the trade.
 */

import { readFileSync, existsSync } from "node:fs";

const { readJudas, JUDAS_MIN_CONFLUENCE } = await import("../src/lib/trading/judas-window.ts");
const { allSeries } = await import("../src/lib/trading/chart-timeframes.ts");
const { etWallParts, isJudasWindow } = await import("../src/lib/trading/sessions.ts");
const { summarizeDetectors } = await import("../src/lib/trading/detectors.ts");

const FILE = "src/data/learn-history-1m.json";
if (!existsSync(FILE)) {
  console.error(`${FILE} missing — run scripts/capture-1m-history.mjs first.`);
  process.exit(1);
}
const H = JSON.parse(readFileSync(FILE, "utf8"));
const BARS = H.bars ?? {};
const SYMS = Object.keys(BARS).filter((k) => Array.isArray(BARS[k]) && BARS[k].length > 1000);
if (!SYMS.length) {
  console.error("no usable 1m series in the file.");
  process.exit(1);
}

console.log(`1m tape: ${H.interval} · session slice ${H.sessionSliceEt} · ${SYMS.map((s) => `${s} ${BARS[s].length.toLocaleString()}`).join(" · ")}`);

const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};

/* ── One trade, simulated on 1m bars ─────────────────────────────────────── */

/**
 * Fade the failed raid: enter at the decision bar's close, stop one tick
 * beyond the raid's wick extreme, and measure in R.
 *
 * The stop is the raid extreme because that is what the setup asserts — if
 * price goes back through the manipulation low, the manipulation was not a
 * manipulation. There is no array to rest a limit at on a one-minute
 * resolution decision, so this is deliberately the WORSE of the desk's two
 * entry styles (a market fill, not a limit at CE), and the number it produces
 * is therefore a floor rather than a flattering case.
 */
function fade(bars, i, side, raidExtreme, maxHold, targetR) {
  const entry = bars[i].c;
  const tick = 0.25;
  const long = side === "long";
  const stop = long ? raidExtreme - tick : raidExtreme + tick;
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) return null;
  const target = long ? entry + targetR * risk : entry - targetR * risk;
  for (let k = i + 1; k < bars.length && k <= i + maxHold; k++) {
    const b = bars[k];
    // Stop first — ties against the trade.
    if (long ? b.l <= stop : b.h >= stop) return { r: -1, bars: k - i, exit: "stop" };
    if (long ? b.h >= target : b.l <= target) return { r: targetR, bars: k - i, exit: "target" };
  }
  const last = bars[Math.min(bars.length - 1, i + maxHold)];
  return { r: ((long ? last.c - entry : entry - last.c) / risk), bars: maxHold, exit: "time" };
}

/* ── Walk every Judas window ─────────────────────────────────────────────── */

const MAX_HOLD = 120; // 2h on 1m
const TARGET_R = 2;

const results = { released: [], neverResolved: 0, windows: 0, byStage: new Map(), bySide: new Map() };
const control = []; // the identical release rule, applied 09:45-11:00 ET

for (const sym of SYMS) {
  const bars = BARS[sym];
  // Index the first bar of each ET day so windows can be walked day by day.
  const days = new Map();
  for (let i = 0; i < bars.length; i++) {
    const d = dayKey(bars[i].t);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(i);
  }

  for (const [d, idxs] of days) {
    const judasIdx = idxs.filter((i) => {
      const w = etWallParts(bars[i].t);
      return isJudasWindow(w.hour, w.minute);
    });
    if (judasIdx.length < 5) continue;
    results.windows++;

    let fired = false;
    for (const i of judasIdx) {
      if (fired) break;
      const w = etWallParts(bars[i].t);
      // Causal: the engine sees bars[0..i] and nothing after.
      const hist = bars.slice(Math.max(0, i - 400), i + 1);
      const rungs = allSeries([], hist); // 1m only — this is the whole point
      const j = readJudas(rungs, { etHour: w.hour, etMinute: w.minute }, null);
      results.byStage.set(j.stage, (results.byStage.get(j.stage) ?? 0) + 1);
      if (j.blocked || !j.releasedSide || !j.raid) continue;

      const sim = fade(bars, i, j.releasedSide, j.raid.extreme, MAX_HOLD, TARGET_R);
      if (!sim) continue;
      fired = true;
      results.released.push({ sym, day: d, min: `${w.hour}:${String(w.minute).padStart(2, "0")}`, side: j.releasedSide, tf: j.tf, ...sim });
      results.bySide.set(j.releasedSide, (results.bySide.get(j.releasedSide) ?? 0) + 1);
    }
    if (!fired) results.neverResolved++;

    // CONTROL — the SAME rule, in the window the desk already trusts.
    //
    // The first version looked for a resolved raid at exactly 10:15 and found
    // two, which compares nothing. This applies the identical release test
    // bar by bar through 09:45-11:00 ET and takes the first fire, so the only
    // difference between the two populations is the hour. Without that, a
    // negative Judas number cannot be told apart from "mechanically fading a
    // raid on 1m loses everywhere", which is a completely different finding
    // and would mean the window was never the problem.
    const ctrlIdxs = idxs.filter((i) => {
      const w = etWallParts(bars[i].t);
      const m = w.hour * 60 + w.minute;
      return m >= 9 * 60 + 45 && m < 11 * 60;
    });
    for (const i of ctrlIdxs) {
      const hist = bars.slice(Math.max(0, i - 400), i + 1);
      const det = summarizeDetectors(hist);
      const raid = det.sweep.latest;
      const disp = det.displacement.latest;
      if (!raid || !disp) continue;
      if (!(disp.index > raid.index && raid.closeBackInside > 0)) continue;
      const nowT = hist[hist.length - 1].t;
      if (nowT - raid.t > 25 * 60_000) continue;
      const want = raid.side === "sellside" ? "bull" : "bear";
      if (disp.direction !== want) continue;
      const side = raid.side === "sellside" ? "long" : "short";
      const sim = fade(bars, i, side, raid.wickExtreme, MAX_HOLD, TARGET_R);
      if (sim) control.push({ sym, day: d, side, ...sim });
      break;
    }
  }
}

/* ── Report ──────────────────────────────────────────────────────────────── */

function stat(rows, label) {
  if (!rows.length) return `${label}: n=0`;
  const n = rows.length;
  const wins = rows.filter((r) => r.r > 0.05).length;
  const sum = rows.reduce((s, r) => s + r.r, 0);
  const mean = sum / n;
  const sd = n > 1 ? Math.sqrt(rows.reduce((s, r) => s + (r.r - mean) ** 2, 0) / (n - 1)) : 0;
  const se = n > 1 ? sd / Math.sqrt(n) : 0;
  return (
    `${label}: n=${n} · WR ${((wins / n) * 100).toFixed(0)}% · ` +
    `exp ${(mean >= 0 ? "+" : "") + mean.toFixed(3)}R ` +
    `[${(mean - 1.96 * se).toFixed(2)}, ${(mean + 1.96 * se).toFixed(2)}] · sumR ${(sum >= 0 ? "+" : "") + sum.toFixed(1)}`
  );
}

console.log(`\n${"=".repeat(96)}`);
console.log("HOW OFTEN THE OPEN'S MANIPULATION ACTUALLY RESOLVES INSIDE THE WINDOW\n");
console.log(`  Judas windows walked      ${results.windows}`);
console.log(`  released at least once    ${results.released.length}`);
console.log(`  never resolved            ${results.neverResolved}  (the window stayed shut, as it always did)`);
console.log(`\n  every bar's verdict, by stage:`);
for (const [k, v] of [...results.byStage.entries()].sort((a, b) => b[1] - a[1]))
  console.log(`    ${String(k).padEnd(18)} ${v}`);

console.log(`\n${"=".repeat(96)}`);
console.log(`WHAT FADING THE FAILED RAID DID  (market fill, stop beyond the raid wick, ${TARGET_R}R target, ${MAX_HOLD}m max hold)\n`);
console.log(`  ${stat(results.released, "Judas release")}`);
console.log(`  ${stat(control, "NY AM control  ")}`);
const d = (results.released.reduce((a, r) => a + r.r, 0) / Math.max(1, results.released.length)) -
  (control.reduce((a, r) => a + r.r, 0) / Math.max(1, control.length));
console.log(`
  Judas minus control: ${(d >= 0 ? "+" : "") + d.toFixed(3)}R — this is the number that answers`);
console.log(`  "is the HOUR the problem", and it is the only comparison in this file that does.`);
console.log(`\n  by side:`);
for (const side of ["long", "short"]) {
  const rows = results.released.filter((r) => r.side === side);
  if (rows.length) console.log(`    ${stat(rows, side.padEnd(5))}`);
}
console.log(`\n  by exit:`);
for (const ex of ["target", "stop", "time"]) {
  const rows = results.released.filter((r) => r.exit === ex);
  if (rows.length) console.log(`    ${stat(rows, ex.padEnd(6))}`);
}

console.log(`\n${"=".repeat(96)}`);
console.log("READ IT THIS WAY\n");
console.log(
  `  This is ${results.windows} windows over two months, not four years, because 09:30-09:45 is one\n` +
    `  15m candle and the four-year tape physically cannot resolve a raid from the reaction\n` +
    `  to it. Treat every number above as a first look with a wide interval, not a finding.\n\n` +
    `  The release also still has to clear Q ${JUDAS_MIN_CONFLUENCE} and the whole SMC sequence in the live\n` +
    `  desk; this script measures the WINDOW, not the sequence, so the live population will\n` +
    `  be smaller and better selected than what is counted here.`,
);
