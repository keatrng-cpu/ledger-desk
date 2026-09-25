/**
 * Does the release reaction predict the session? — the testable half of
 * "news should form bias".
 *
 * THE IDEA, AND THE TRAP IN IT
 * The trader's proposal: good country/market news leans the bias bullish, bad
 * news bearish. The intuition is sound and the implementation is a trap,
 * because the sign convention is not stable. Strong payrolls are good news for
 * the economy and frequently SELL equities off, since the market is pricing
 * the central bank's reaction rather than the headline. Any table mapping
 * "beat consensus" to "bullish" is right in one regime and backwards in the
 * next, and this desk would have no way to tell which regime it is in.
 *
 * So this measures the version that needs NO sign convention: after the
 * release, the market itself votes, and the vote is observable. The question
 * is whether that vote carries into the window the desk actually trades.
 *
 * WHAT IS MEASURED
 *   release move  = 08:30 -> 08:45 ET   (the US data slot, on 15m bars)
 *   session move  = 09:45 -> 11:00 ET   (the window the desk trades)
 * Agreement = do they share a sign. Reported overall, and split by how big
 * the release move was in ATR — because "the market voted loudly" and "a
 * 0.3 ATR drift at 08:30" are different claims.
 *
 * THE CONTROL IS THE WHOLE EXPERIMENT
 * An 08:00 ET candle, on the same days, against the same session window. There
 * is no scheduled release at 08:00. If 08:30 predicts and 08:00 predicts
 * equally well, this measures ordinary morning momentum and calling it "news"
 * would be naming a thing that is not there. The gap between them is the only
 * number in this file that is about news at all.
 *
 * WHY A STRUCTURAL PROXY AND NOT THE CALENDAR
 * src/data/news-calendar.json holds 32 events spanning 2026-08-12 to
 * 2026-10-02 — far too few, and far too recent, to measure against a four-year
 * tape. 08:30 ET is where BLS/BEA/Census put their releases, so the slot is a
 * high-coverage proxy for "a release probably just landed". It is a proxy and
 * it is labelled as one: some 08:30 candles have no release behind them, which
 * biases the result TOWARD the null, not toward a finding.
 *
 * NO LOOKAHEAD: the release window closes before the session window opens.
 */

import { readFileSync, existsSync } from "node:fs";

const FILE = "src/data/history-4y.json";
if (!existsSync(FILE)) {
  console.error(`${FILE} missing — run scripts/capture-history.mjs first.`);
  process.exit(1);
}
const H = JSON.parse(readFileSync(FILE, "utf8"));
const { etWallParts } = await import("../src/lib/trading/sessions.ts");

const dayKey = (t) => {
  const w = etWallParts(t);
  return `${w.year}-${String(w.month).padStart(2, "0")}-${String(w.day).padStart(2, "0")}`;
};
const etMin = (t) => {
  const w = etWallParts(t);
  return w.hour * 60 + w.minute;
};
const weekday = (t) => {
  const w = etWallParts(t);
  return w.weekday >= 1 && w.weekday <= 5;
};

/** Mean true range over the n bars ending at `end`. */
function atrAt(bars, end, n = 14) {
  let sum = 0;
  let k = 0;
  for (let i = Math.max(1, end - n + 1); i <= end; i++) {
    sum += Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i - 1].c),
      Math.abs(bars[i].l - bars[i - 1].c),
    );
    k++;
  }
  return k ? sum / k : 0;
}

/**
 * Move across an ET minute window, as a signed multiple of ATR.
 * Null when the window is not fully present — a partial window is a different
 * measurement wearing the same name.
 */
function windowMove(bars, idxs, fromMin, toMin) {
  const inWin = idxs.filter((i) => etMin(bars[i].t) >= fromMin && etMin(bars[i].t) < toMin);
  if (inWin.length < 1) return null;
  const first = inWin[0];
  const last = inWin[inWin.length - 1];
  const atr = atrAt(bars, Math.max(1, first - 1));
  if (!(atr > 0)) return null;
  return { pts: bars[last].c - bars[first].o, atr, x: (bars[last].c - bars[first].o) / atr };
}

function measure(sym) {
  const bars = H.bars?.[sym] ?? [];
  if (bars.length < 5000) return null;

  const days = new Map();
  for (let i = 1; i < bars.length; i++) {
    if (!weekday(bars[i].t)) continue;
    const d = dayKey(bars[i].t);
    if (!days.has(d)) days.set(d, []);
    days.get(d).push(i);
  }

  const rows = [];
  for (const [d, idxs] of days) {
    // 08:30-08:45 ET: the release slot. 08:00-08:15: the control.
    const release = windowMove(bars, idxs, 8 * 60 + 30, 8 * 60 + 45);
    const control = windowMove(bars, idxs, 8 * 60, 8 * 60 + 15);
    // 09:45-11:00 ET: the window the desk trades, after Judas.
    const session = windowMove(bars, idxs, 9 * 60 + 45, 11 * 60);
    if (!release || !session || !control) continue;
    rows.push({ d, release: release.x, control: control.x, session: session.x });
  }
  return rows;
}

/** Agreement rate with a Wilson interval — a rate without one is a vibe. */
function agree(rows, key) {
  const used = rows.filter((r) => Math.abs(r[key]) > 1e-9 && Math.abs(r.session) > 1e-9);
  const n = used.length;
  if (!n) return null;
  const hits = used.filter((r) => Math.sign(r[key]) === Math.sign(r.session)).length;
  const p = hits / n;
  const z = 1.96;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return { n, hits, p, lo: centre - half, hi: centre + half };
}

const pct = (v) => `${(v * 100).toFixed(1)}%`;
const line = (a) =>
  a ? `n=${String(a.n).padStart(4)}  agree ${pct(a.p)}  [${pct(a.lo)}, ${pct(a.hi)}]` : "n=0";

console.log(`tape ${H.window?.start} -> ${H.window?.end}, ${H.interval}\n`);
console.log("Does the 08:30 ET release reaction predict the 09:45-11:00 session?");
console.log("50% is chance. An interval that contains 50% is not a finding.\n");

for (const sym of Object.keys(H.bars ?? {})) {
  const rows = measure(sym);
  if (!rows?.length) continue;
  const rel = agree(rows, "release");
  const ctl = agree(rows, "control");
  console.log(`${sym}  ${rows.length} sessions`);
  console.log(`  08:30 release window  ${line(rel)}`);
  console.log(`  08:00 CONTROL window  ${line(ctl)}`);
  if (rel && ctl) {
    const gap = rel.p - ctl.p;
    console.log(
      `  release minus control ${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1)}pp` +
        `  <- the only number here that is about NEWS rather than morning momentum`,
    );
  }

  // Split by how loudly the market voted. A big release candle is a different
  // claim from a drift, and pooling them hides whichever one is real.
  console.log(`  by release size:`);
  for (const [lo, hi, label] of [
    [0, 0.5, "< 0.5 ATR"],
    [0.5, 1, "0.5-1 ATR"],
    [1, 2, "1-2 ATR"],
    [2, 99, "2+ ATR  "],
  ]) {
    const b = rows.filter((r) => Math.abs(r.release) >= lo && Math.abs(r.release) < hi);
    const a = agree(b, "release");
    if (a && a.n >= 20) console.log(`    ${label}  ${line(a)}`);
  }
  console.log("");
}

console.log("READ IT THIS WAY");
console.log(
  "  A release window that agrees with the session more often than the 08:00 control\n" +
    "  is evidence that the market's VOTE on the news carries — and a vote needs no\n" +
    "  sign convention, so it cannot be backwards the way 'good news is bullish' can.\n" +
    "  If release and control agree equally, this is morning momentum and news adds\n" +
    "  nothing. Either way the +/-15m blackout stands: this is about bias AFTER the\n" +
    "  release, never about trading through it.",
);
