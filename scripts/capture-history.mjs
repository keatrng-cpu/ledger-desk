/**
 * Multi-year 15m history for the backtest.
 *
 *   npx tsx scripts/capture-history.mjs [--years 4] [--out src/data/history-4y.json]
 *
 * WHY THIS IS NOT `capture-learn-history.mjs` WITH A BIGGER WINDOW
 *
 * `src/lib/market/databento.ts` requests `symbols: contractSymbol(sym)`, which
 * is the CURRENT front quarterly — ESZ6 today. Ask it for four years and CME
 * returns only the weeks ESZ6 actually traded, which is one quarter. The file
 * would be valid JSON, correctly shaped, and cover 3% of the window. That is
 * the "looks like data, isn't" failure the repo guards exist for, so this uses
 * Databento's CONTINUOUS symbology (`ES.c.0`, `stype_in=continuous`) instead,
 * which stitches the front month across every roll.
 *
 * WHY IT AGGREGATES AS IT GOES
 * GLBX.MDP3 has no 15m schema, so 15m comes from `ohlcv-1m`. Four years of 1m
 * on two symbols is ~2.8M rows and ~170MB of CSV; holding that to aggregate at
 * the end would be pointless. Each month is fetched, folded into 15m buckets,
 * and the minutes are dropped.
 *
 * WHY IT IS RESUMABLE
 * ~96 requests against a live API. A failure at month 80 must not mean
 * starting again, so completed months are written to a part file and skipped
 * on a re-run.
 *
 * COST: Databento CME is the flat $199/mo Standard plan (verified 2026-09-14,
 * restated in gateway/README.md) — usage-based live billing was retired in
 * March 2025. This is a large request, not a metered one. It is a separate
 * deliberate script for that reason.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const argv = process.argv.slice(2);
const argOf = (name, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};
const YEARS = Number(argOf("years", "4"));
const OUT = argOf("out", "src/data/history-4y.json");
const PART = `${OUT}.part`;
const INTERVAL_MIN = Number(argOf("interval", "15"));

/* ── The key, read at runtime and never printed ──────────────────────────── */
function apiKey() {
  if (process.env.DATABENTO_API_KEY?.trim()) return process.env.DATABENTO_API_KEY.trim();
  for (const p of [".env", ".env.local", "gateway/.env.local"]) {
    try {
      if (!existsSync(p)) continue;
      const m = readFileSync(p, "utf8").match(/^\s*DATABENTO_API_KEY\s*=\s*(.+)$/m);
      if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      /* keep looking */
    }
  }
  return null;
}

const KEY = apiKey();
if (!KEY) {
  console.error("No DATABENTO_API_KEY found in env, .env, .env.local or gateway/.env.local.");
  process.exit(1);
}

const DATASET = "GLBX.MDP3";
// Continuous front month, rolled by Databento. `.c.0` is calendar-roll, which
// is what a 15m structure backtest wants — volume-roll (`.v.0`) would move the
// series mid-session on roll day.
const SYMBOLS = { MNQ: "NQ.c.0", ES: "ES.c.0" };

const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** Month boundaries covering the last `YEARS`, oldest first. */
function months() {
  const out = [];
  const end = new Date();
  end.setUTCDate(1);
  end.setUTCHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - YEARS);
  for (let d = new Date(start); d < end; d.setUTCMonth(d.getUTCMonth() + 1)) {
    const a = new Date(d);
    const b = new Date(d);
    b.setUTCMonth(b.getUTCMonth() + 1);
    out.push([iso(a), iso(b)]);
  }
  return out;
}

async function fetchMonth(rawSymbol, start, end) {
  const params = new URLSearchParams({
    dataset: DATASET,
    symbols: rawSymbol,
    schema: "ohlcv-1m",
    stype_in: "continuous",
    start,
    end,
    encoding: "csv",
    pretty_px: "true",
    pretty_ts: "true",
  });
  const url = `https://hist.databento.com/v0/timeseries.get_range?${params}`;
  const auth = Buffer.from(`${KEY}:`).toString("base64");
  const res = await fetch(url, { headers: { Authorization: `Basic ${auth}` } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, status: res.status, body: body.slice(0, 200) };
  }
  return { ok: true, text: await res.text() };
}

/** CSV → 1m bars → 15m buckets. The minutes are never kept. */
function foldTo15m(csv) {
  const lines = csv.trim().split("\n");
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const ix = (n) => head.indexOf(n);
  const [tI, oI, hI, lI, cI, vI] = [
    ix("ts_event"), ix("open"), ix("high"), ix("low"), ix("close"), ix("volume"),
  ];
  if (tI < 0 || oI < 0) return [];

  const MS = INTERVAL_MIN * 60_000;
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    const t = Date.parse(p[tI]);
    const o = +p[oI], h = +p[hI], l = +p[lI], c = +p[cI], v = +p[vI] || 0;
    if (!Number.isFinite(t) || !Number.isFinite(o)) continue;
    const bucket = Math.floor(t / MS) * MS;
    const last = out[out.length - 1];
    if (last && last.t === bucket) {
      last.h = Math.max(last.h, h);
      last.l = Math.min(last.l, l);
      last.c = c;
      last.v += v;
    } else {
      out.push({ t: bucket, o, h, l, c, v });
    }
  }
  return out;
}

/* ── Resume ──────────────────────────────────────────────────────────────── */
let done = {};
if (existsSync(PART)) {
  try {
    done = JSON.parse(readFileSync(PART, "utf8"));
    const n = Object.values(done).reduce((s, v) => s + (v?.length ?? 0), 0);
    console.log(`resuming: ${Object.keys(done).length} month-symbol chunks already captured (${n} bars)`);
  } catch {
    done = {};
  }
}

const ms = months();
console.log(`${YEARS}y of ${INTERVAL_MIN}m from ${ms[0][0]} to ${ms[ms.length - 1][1]}`);
console.log(`${ms.length} months x ${Object.keys(SYMBOLS).length} symbols = ${ms.length * 2} requests, continuous symbology\n`);

let failures = 0;
for (const [sym, raw] of Object.entries(SYMBOLS)) {
  for (const [start, end] of ms) {
    const key = `${sym}:${start}`;
    if (done[key]) continue;
    process.stdout.write(`  ${sym} ${start} `);
    const r = await fetchMonth(raw, start, end);
    if (!r.ok) {
      console.log(`FAILED ${r.status} ${r.body}`);
      failures++;
      // A 422 on a month before the dataset's history is expected at the edge;
      // record it as empty so a resume does not retry forever.
      done[key] = [];
      writeFileSync(PART, JSON.stringify(done));
      continue;
    }
    const bars = foldTo15m(r.text);
    done[key] = bars;
    writeFileSync(PART, JSON.stringify(done));
    console.log(`${bars.length} bars`);
  }
}

/* ── Assemble ────────────────────────────────────────────────────────────── */
const bars = {};
for (const sym of Object.keys(SYMBOLS)) {
  const all = [];
  for (const [start] of ms) all.push(...(done[`${sym}:${start}`] ?? []));
  all.sort((a, b) => a.t - b.t);
  // De-dup across chunk seams.
  bars[sym] = all.filter((b, i) => i === 0 || b.t !== all[i - 1].t);
}

const counts = Object.entries(bars).map(([k, v]) => `${k} ${v.length}`).join(", ");
const thin = Object.values(bars).some((v) => v.length < 5000);
if (thin) {
  console.error(`\nREFUSING TO WRITE: ${counts}. A ${YEARS}-year 15m tape should be tens of thousands of bars per symbol.`);
  console.error(`A short file that parses is exactly the stub the repo guards exist for. Part file kept at ${PART} — re-run to resume.`);
  process.exit(1);
}

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(
  OUT,
  JSON.stringify({
    capturedAt: new Date().toISOString(),
    interval: `${INTERVAL_MIN}m`,
    source: "databento",
    dataset: DATASET,
    symbology: "continuous .c.0 (calendar roll)",
    contracts: SYMBOLS,
    years: YEARS,
    window: { start: ms[0][0], end: ms[ms.length - 1][1] },
    note:
      `Real ${INTERVAL_MIN}m bars over ${YEARS} years, front month stitched by Databento continuous ` +
      `symbology. For regime backtesting only — not live, and no lookahead is implied by its presence.`,
    bars,
  }),
);
const mb = (JSON.stringify(bars).length / 1e6).toFixed(1);
console.log(`\nwrote ${OUT} (${mb} MB) — ${counts}${failures ? `, ${failures} month(s) failed` : ""}`);
console.log(`part file ${PART} can be deleted.`);
