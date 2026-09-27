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
 *      node scripts/capture-invest-universe.mjs --etf [--budget 6]
 *
 * FIXED 2026-09-26
 *   - A refresh used to REPLACE each row with the OVERVIEW mapping, which
 *     never included the 50/200-day averages or the 52-week range — so the
 *     first refresh after the trend read shipped would have blanked it for
 *     every name it touched. They are mapped now (OVERVIEW carries them),
 *     along with Name and Industry, and a row's hand-written `note` (ADR
 *     currency mix, REIT earnings) survives the refresh.
 *   - `capturedAt` is the date of this RUN. Each row keeps its own `asOf`
 *     and the tab prints the oldest, so a partial refresh cannot make stale
 *     rows look new.
 *   - `--etf` refreshes src/data/invest-etf-profiles.json (ETF_PROFILE):
 *     each fund's expense ratio, sector split and holdings, trimmed to its
 *     top 80 plus every QQQ name and every researched name wherever they
 *     rank, so the QQQ overlap stays exact rather than a top-N guess.
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
const ETF_MODE = args.includes("--etf");

const doc = JSON.parse(readFileSync(OUT, "utf8"));
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Stale or never-captured rows first — the budget goes where it is needed. */
const today = new Date().toISOString().slice(0, 10);

if (ETF_MODE) {
  await captureEtfProfiles();
  process.exit(0);
}
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

  const prev = doc.fundamentals[ticker] ?? {};
  doc.fundamentals[ticker] = {
    ticker,
    name: json.Name ?? prev.name ?? undefined,
    industry: json.Industry ?? prev.industry ?? undefined,
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
    ma50: num(json["50DayMovingAverage"]),
    ma200: num(json["200DayMovingAverage"]),
    high52: num(json["52WeekHigh"]),
    low52: num(json["52WeekLow"]),
    ...(prev.note ? { note: prev.note } : {}),
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

/* ------------------------------------------------------------------ */
/* --etf : fund look-through profiles                                  */
/* ------------------------------------------------------------------ */

async function captureEtfProfiles() {
  const ETF_OUT = "src/data/invest-etf-profiles.json";
  const prof = JSON.parse(readFileSync(ETF_OUT, "utf8"));
  const funds = Object.keys(prof.funds);
  const universe = new Set(Object.keys(doc.fundamentals));
  const etfBudget = bIdx >= 0 ? budget : funds.length;
  const fetched = {};
  for (const t of funds.slice(0, etfBudget)) {
    const url = `${BASE}?function=ETF_PROFILE&symbol=${encodeURIComponent(t)}&apikey=${encodeURIComponent(key)}`;
    let json;
    try {
      json = await (await fetch(url)).json();
    } catch (e) {
      console.error(`  ${t}: network — ${String(e).slice(0, 120)}`);
      continue;
    }
    if (json?.Note || json?.Information) {
      console.error(`  ${t}: rate limited — stopping; unfetched funds keep their rows.`);
      break;
    }
    if (!json?.net_expense_ratio) {
      console.log(`  ${t}: no profile returned — left as is`);
      continue;
    }
    fetched[t] = json;
    console.log(`  ${t}: ok (${Array.isArray(json.holdings) ? json.holdings.length : 0} holdings)`);
    await new Promise((r) => setTimeout(r, GAP_MS));
  }
  // QQQ first: its names decide which rows every other fund must keep.
  const qqqRows = fetched.QQQ
    ? fetched.QQQ.holdings.filter((h) => h.symbol !== "n/a").map((h) => [h.symbol, Number(h.weight)])
    : prof.funds.QQQ.holdings;
  const qqqNames = new Set(qqqRows.map(([s]) => s));
  for (const [t, json] of Object.entries(fetched)) {
    const rows = json.holdings.filter((h) => h.symbol !== "n/a").map((h) => [h.symbol, Number(h.weight)]);
    const keepAll = t === "QQQ";
    const kept = rows.filter(([s], i) => keepAll || i < 80 || qqqNames.has(s) || universe.has(s));
    const w = new Map(rows);
    const sectors = Object.fromEntries((json.sectors ?? []).map((x) => [x.sector, Number(x.weight)]));
    const secSum = Object.values(sectors).reduce((a, b) => a + b, 0);
    prof.funds[t] = {
      ...prof.funds[t],
      asOf: String(json.last_updated ?? today).slice(0, 10),
      netAssets: num(json.net_assets),
      expenseRatio: num(json.net_expense_ratio),
      dividendYield: num(json.dividend_yield),
      turnover: num(json.portfolio_turnover),
      inception: json.inception_date ?? prof.funds[t].inception,
      holdingsCount: rows.length,
      // A split that sums far from 1 (VXUS in this source) is unusable, not zero.
      sectorsReliable: secSum > 0.9,
      sectors: secSum > 0.9 ? sectors : {},
      storedWeight: Math.round(kept.reduce((a, [, x]) => a + x, 0) * 10_000) / 10_000,
      overlapQQQ: Math.round(qqqRows.reduce((a, [s, x]) => a + Math.min(w.get(s) ?? 0, x), 0) * 10_000) / 10_000,
      holdings: kept,
    };
  }
  if (!Object.keys(fetched).length) {
    console.log("\nnothing refreshed — file untouched");
    return;
  }
  prof.capturedAt = today;
  const lines = ["{", `  "capturedAt": ${JSON.stringify(prof.capturedAt)},`, `  "source": ${JSON.stringify(prof.source)},`,
    `  "note": ${JSON.stringify(prof.note)},`, '  "funds": {'];
  const names = Object.keys(prof.funds);
  names.forEach((k, i) => {
    const f = prof.funds[k];
    lines.push(`    ${JSON.stringify(k)}: {`);
    for (const [kk, vv] of Object.entries(f)) if (kk !== "holdings") lines.push(`      ${JSON.stringify(kk)}: ${JSON.stringify(vv)},`);
    lines.push(`      "holdings": ${JSON.stringify(f.holdings)}`);
    lines.push(`    }${i < names.length - 1 ? "," : ""}`);
  });
  lines.push("  }", "}");
  writeFileSync(ETF_OUT, `${lines.join("\n")}\n`);
  console.log(`\nwrote ${ETF_OUT} — ${Object.keys(fetched).length} fund(s) refreshed`);
}
