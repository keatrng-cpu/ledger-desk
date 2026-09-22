/**
 * Capture 1-minute Databento bars for the SAME window and the SAME contracts
 * as src/data/learn-history.json.
 *
 * WHY A SEPARATE SCRIPT
 * `fetchDatabentoAbsoluteRange` resolves its contract with
 * `frontQuarterly(new Date())` — the front month as of TODAY. Pointing that
 * at a June–September window after the September roll would quietly fetch
 * ESZ6/NQZ6 and hand back a price series that never traded in the period
 * being measured. The contracts are therefore pinned from the 15m file's own
 * `contracts` map, so the two files describe the same instrument by
 * construction rather than by luck.
 *
 * WHY 02:00–16:15 ET
 * This file answers one question: does timing the entry on the 1m turn
 * INSIDE the 15m array beat resting at consequent encroachment? The first
 * cut of this capture kept only 09:00–16:15 and produced nonsense — the
 * baseline came out at −0.21R against the +0.35R the same cards measured on
 * 15m bars. The reason was population, not code: 58% of the shadow book
 * opens in the LONDON killzone (02:00–05:00 ET), which `inTradeWindow`
 * allows, so more than half the cards had no 1m bars at their own entry and
 * were silently simulated against the next morning's tape. 02:00 covers
 * London through the cash close; the Asian session is still dropped because
 * no shadow has ever opened in it.
 *
 * Deterministic and committed for the same reason learn-history.json is:
 * a measurement that moves because the feed moved is not a measurement.
 *
 * Run: npx tsx scripts/capture-1m-history.mjs [--probe]
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "src/data/learn-history-1m.json";
const SRC = "src/data/learn-history.json";
const URL_BASE = "https://hist.databento.com/v0/timeseries.get_range";
const DATASET = process.env.DATABENTO_DATASET || "GLBX.MDP3";
/** ET session slice kept: 02:00 (London open) through 16:15, the close bell. */
const KEEP_START_MIN = 2 * 60;
const KEEP_END_MIN = 16 * 60 + 15;
const CHUNK_MS = 4 * 24 * 3600 * 1000;

/**
 * The key, from the shell or from the dotenv the gateway already uses.
 *
 * `gateway/.env.local` is where this machine keeps the Databento credential
 * (gateway/README.md), so the capture sources it the same way the gateway
 * does rather than asking anyone to paste a secret into a shell. The value
 * is never printed, never logged, and never written to the output file —
 * only the presence of a key is ever reported.
 */
function readKey() {
  const fromEnv = process.env.DATABENTO_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, from: "shell env" };
  for (const file of ["gateway/.env.local", ".env.local", ".env"]) {
    try {
      const text = readFileSync(file, "utf8");
      const m = /^[ \t]*DATABENTO_API_KEY[ \t]*=[ \t]*"?([^"\r\n]+)"?[ \t]*$/m.exec(text);
      if (m?.[1]?.trim()) return { key: m[1].trim(), from: file };
    } catch {
      /* not there — try the next one */
    }
  }
  return { key: null, from: null };
}

const { key, from: keyFrom } = readKey();
if (!key) {
  console.error(
    "No DATABENTO_API_KEY found in the shell, gateway/.env.local, .env.local or .env. Nothing was fetched.",
  );
  process.exit(1);
}
console.log(`key: found via ${keyFrom} (value not shown)`);
const auth = `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
const probe = process.argv.includes("--probe");

const src = JSON.parse(readFileSync(SRC, "utf8"));
const contracts = src.contracts;
if (!contracts) {
  console.error(`${SRC} has no \`contracts\` map — cannot pin the instrument. Refusing to guess.`);
  process.exit(1);
}
const symbols = Object.keys(src.bars);
const firstT = Math.min(...symbols.map((s) => src.bars[s][0].t));
const lastT = Math.max(...symbols.map((s) => src.bars[s][src.bars[s].length - 1].t));
// The 15m file's last bar OPENS at 20:45Z; add its width so the window covers it.
const endT = lastT + 15 * 60_000;

const etMin = (ms) => {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  }).formatToParts(new Date(ms));
  const g = (k) => p.find((x) => x.type === k)?.value;
  return { min: Number(g("hour")) * 60 + Number(g("minute")), wd: g("weekday") };
};

async function getRange(contract, startIso, endIso) {
  const params = new URLSearchParams({
    dataset: DATASET,
    symbols: contract,
    schema: "ohlcv-1m",
    stype_in: "raw_symbol",
    start: startIso,
    end: endIso,
    encoding: "csv",
    pretty_px: "true",
    pretty_ts: "true",
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 90_000);
  try {
    const res = await fetch(`${URL_BASE}?${params}`, { headers: { Authorization: auth }, signal: controller.signal });
    const text = await res.text();
    if (!res.ok) return { ok: false, status: res.status, body: text.slice(0, 400) };
    return { ok: true, text };
  } catch (e) {
    return { ok: false, status: 0, body: String(e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

/** Databento CSV → bars, keeping only the ET slice this measurement needs. */
function parse(text) {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((h) => h.trim());
  const idx = (n) => head.indexOf(n);
  const iTs = idx("ts_event") >= 0 ? idx("ts_event") : idx("ts_recv");
  const iO = idx("open"), iH = idx("high"), iL = idx("low"), iC = idx("close"), iV = idx("volume");
  if (iTs < 0 || iO < 0) return [];
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length <= iC) continue;
    const t = Date.parse(c[iTs]);
    if (!Number.isFinite(t)) continue;
    const { min, wd } = etMin(t);
    if (wd === "Sat" || wd === "Sun") continue;
    if (min < KEEP_START_MIN || min > KEEP_END_MIN) continue;
    const o = Number(c[iO]), h = Number(c[iH]), l = Number(c[iL]), cl = Number(c[iC]);
    if (![o, h, l, cl].every(Number.isFinite) || o <= 0) continue;
    out.push({ t, o, h, l, c: cl, v: Number(c[iV]) || 0 });
  }
  return out;
}

console.log(`window ${new Date(firstT).toISOString()} → ${new Date(endT).toISOString()}`);
console.log(`contracts ${JSON.stringify(contracts)} · dataset ${DATASET}${probe ? " · PROBE (one chunk per symbol)" : ""}`);

const bars = {};
for (const sym of symbols) {
  const contract = contracts[sym];
  if (!contract) {
    console.error(`no pinned contract for ${sym} — skipping rather than guessing`);
    continue;
  }
  const rows = [];
  let cursor = firstT;
  let chunks = 0;
  while (cursor < endT) {
    const chunkEnd = Math.min(cursor + CHUNK_MS, endT);
    const res = await getRange(contract, new Date(cursor).toISOString(), new Date(chunkEnd).toISOString());
    if (!res.ok) {
      console.error(`  ${sym} ${new Date(cursor).toISOString().slice(0, 10)} HTTP ${res.status}: ${res.body}`);
      if (res.status === 401 || res.status === 403) process.exit(1);
    } else {
      const part = parse(res.text);
      rows.push(...part);
      process.stdout.write(`  ${sym} ${new Date(cursor).toISOString().slice(0, 10)} +${part.length}\r`);
    }
    chunks++;
    cursor = chunkEnd;
    if (probe && chunks >= 1) break;
  }
  // Dedupe by timestamp (chunk boundaries overlap by one bar) and sort.
  const byT = new Map();
  for (const b of rows) byT.set(b.t, b);
  bars[sym] = [...byT.values()].sort((a, b) => a.t - b.t);
  console.log(`\n${sym} (${contract}): ${bars[sym].length} 1m bars`);
}

if (probe) {
  const s = symbols[0];
  console.log("probe sample:", JSON.stringify(bars[s]?.slice(0, 2)));
  console.log("probe OK — rerun without --probe for the full window.");
  process.exit(0);
}

const out = {
  capturedAt: new Date().toISOString(),
  interval: "1m",
  source: "databento",
  dataset: DATASET,
  contracts,
  sessionSliceEt: "02:00–16:15",
  note:
    "Real 1m CME bars, captured once so the entry-timing measurement is reproducible. " +
    "Same window and same pinned contracts as learn-history.json. Trimmed to the ET " +
    "session slice every shadow lives inside. Not live; do not trade from this file.",
  bars,
};
writeFileSync(OUT, JSON.stringify(out));
const kb = (JSON.stringify(out).length / 1024).toFixed(0);
console.log(`\nwrote ${OUT} — ${symbols.map((s) => `${s} ${bars[s].length}`).join(" · ")} (${kb} KB)`);
