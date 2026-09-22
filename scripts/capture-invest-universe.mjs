/**
 * Refresh src/data/invest-universe.json from Alpha Vantage.
 *
 * WHY THIS IS A SCRIPT AND NOT A POLL
 * A free Alpha Vantage key allows 25 requests per DAY. A tab that fetched
 * fundamentals on render would exhaust the quota before lunch and then show
 * either stale data or nothing, with no way to tell which. So the snapshot
 * is captured deliberately, committed, and dated — the same contract as
 * learn-history.json. A number on the Investments tab is always a number
 * somebody chose to fetch on a known day.
 *
 * It also means this file must be polite: one request per second, a hard
 * daily budget, and it MERGES rather than overwrites, so a run that hits
 * the quota half way through keeps everything it already had instead of
 * blanking the file. Names it could not fetch stay pendingCapture=true,
 * which is what blocks them from being bought.
 *
 * THE KEY
 * Sourced from the shell or the dotenv files the repo already uses, never
 * printed, never written into the output. Same handling as
 * capture-1m-history.mjs. Get a free one at alphavantage.co/support.
 *
 * Run: node scripts/capture-invest-universe.mjs [--budget 20] [TICKER ...]
 */
import { readFileSync, writeFileSync } from "node:fs";

const OUT = "src/data/invest-universe.json";
const BASE = "https://www.alphavantage.co/query";
/** Free tier is 25/day. Leave headroom so a rerun is possible same day. */
const DEFAULT_BUDGET = 20;
const GAP_MS = 1_200;

function readKey() {
  const fromEnv = process.env.ALPHAVANTAGE_API_KEY?.trim() || process.env.ALPHA_VANTAGE_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, from: "shell env" };
  for (const file of [".env.local", ".env", "gateway/.env.local"]) {
    try {
      const text = readFileSync(file, "utf8");
      const m = /^[ \t]*ALPHA_?VANTAGE_API_KEY[ \t]*=[ \t]*"?([^"\r\n]+)"?[ \t]*$/m.exec(text);
      if (m?.[1]?.trim()) return { key: m[1].trim(), from: file };
    } catch {
      /* next */
    }
  }
  return { key: null, from: null };
}

const { key, from } = readKey();
if (!key) {
  console.error(
    "No ALPHAVANTAGE_API_KEY in the shell, .env.local or .env. Nothing was fetched.\n" +
      "Get a free key at https://www.alphavantage.co/support/#api-key and add it as ALPHAVANTAGE_API_KEY.",
  );
  process.exit(1);
}
console.log(`key: found via ${from} (value not shown)`);

const args = process.argv.slice(2);
const bIdx = args.indexOf("--budget");
const budget = bIdx >= 0 ? Number(args[bIdx + 1]) : DEFAULT_BUDGET;
const only = args.filter((a) => /^[A-Z.-]{1,6}$/.test(a));

const doc = JSON.parse(readFileSync(OUT, "utf8"));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Stale or never-captured rows first — the budget goes where it is needed. */
const today = new Date().toISOString().slice(0, 10);
const queue = (only.length ? only : Object.keys(doc.fundamentals))
  .filter((t) => doc.fundamentals[t])
  .sort((a, b) => {
    const A = doc.fundamentals[a].pendingCapture ? 0 : 1;
    const B = doc.fundamentals[b].pendingCapture ? 0 : 1;
    if (A !== B) return A - B;
    return String(doc.fundamentals[a].asOf ?? "").localeCompare(String(doc.fundamentals[b].asOf ?? ""));
  })
  .slice(0, budget);

console.log(`refreshing ${queue.length} of ${Object.keys(doc.fundamentals).length} rows (budget ${budget}/day)`);

let got = 0;
let skipped = 0;
for (const ticker of queue) {
  const url = `${BASE}?function=OVERVIEW&symbol=${encodeURIComponent(ticker)}&apikey=${encodeURIComponent(key)}`;
  let json;
  try {
    const res = await fetch(url);
    json = await res.json();
  } catch (e) {
    console.error(`  ${ticker}: network — ${String(e).slice(0, 120)}`);
    skipped++;
    continue;
  }

  if (json?.Note || json?.Information) {
    console.error(`  ${ticker}: rate limited — stopping so the rest keep their existing rows.`);
    break;
  }
  // An ETF returns an empty object from OVERVIEW; that is expected, not an
  // error, and it must not clobber the row with nulls.
  if (!json?.Symbol) {
    console.log(`  ${ticker}: no OVERVIEW row (normal for ETFs) — left as is`);
    skipped++;
    await new Promise((r) => setTimeout(r, GAP_MS));
    continue;
  }

  doc.fundamentals[ticker] = {
    ticker,
    asOf: today,
    source: "alphavantage",
    marketCap: num(json.MarketCapitalization),
    peTrailing: num(json.TrailingPE ?? json.PERatio),
    peForward: num(json.ForwardPE),
    peg: num(json.PEGRatio),
    profitMargin: num(json.ProfitMargin),
    operatingMargin: num(json.OperatingMarginTTM),
    roe: num(json.ReturnOnEquityTTM),
    revenueGrowthYoy: num(json.QuarterlyRevenueGrowthYOY),
    earningsGrowthYoy: num(json.QuarterlyEarningsGrowthYOY),
    beta: num(json.Beta),
    dividendYield: num(json.DividendYield),
    insiderPct: num(json.PercentInsiders),
    institutionPct: num(json.PercentInstitutions),
    sector: json.Sector ?? null,
    pendingCapture: false,
  };
  got++;
  console.log(`  ${ticker}: ok`);
  await new Promise((r) => setTimeout(r, GAP_MS));
}

if (got > 0) {
  doc.capturedAt = today;
  writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`);
  console.log(`\nwrote ${OUT} — ${got} refreshed, ${skipped} left alone`);
  const pending = Object.values(doc.fundamentals).filter((f) => f.pendingCapture).length;
  if (pending) console.log(`${pending} row(s) still pendingCapture and therefore still blocked from ADD.`);
} else {
  console.log("\nnothing refreshed — file untouched");
}
