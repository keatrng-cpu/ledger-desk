/**
 * Durability snapshot for the Investments tab — what each business has
 * actually DELIVERED, so the price's requirement has something to be
 * compared against.
 *
 * WHY THIS EXISTS
 * `impliedGrowth` (factors.ts) inverts today's price into the earnings growth
 * it requires for a decade. That number alone cannot say whether the
 * requirement is plausible. The one fact that can is what the company has
 * delivered — not a forecast, a record. So this captures, per company:
 *   - net income and free cash flow growth over 10 and 5 fiscal years
 *     (Alpha Vantage CASH_FLOW annual reports, from 10-K data), where cached;
 *   - revenue growth, FCF conversion, stock-based comp, capex intensity and
 *     share-count change over the last four fiscal years (Yahoo Finance
 *     fundamentals timeseries — unofficial, keyless, labelled as such).
 *
 * WHAT IT WILL NOT DO
 * Invent a growth rate across a sign change. A CAGR from a loss (or a
 * negative FCF year) is undefined, and it is stored as null with the reason,
 * never as a number that looks precise.
 *
 * Run:  node scripts/capture-durability.mjs            (Yahoo for every company)
 *       AV cash-flow JSON placed in .cache/cf/<TICKER>.json is merged when present.
 * Output: src/data/invest-durability.json (committed, dated, never polled).
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const OUT = "src/data/invest-durability.json";
const UNIVERSE = "src/data/invest-universe.json";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36";
const TYPES = [
  "annualTotalRevenue",
  "annualNetIncome",
  "annualOperatingCashFlow",
  "annualCapitalExpenditure",
  "annualFreeCashFlow",
  "annualStockBasedCompensation",
  "annualDilutedAverageShares",
  "annualRepurchaseOfCapitalStock",
];

const universe = JSON.parse(readFileSync(UNIVERSE, "utf8"));
const only = process.argv.slice(2).filter((a) => /^[A-Z.-]{1,6}$/.test(a));
const tickers = (only.length ? only : Object.keys(universe.fundamentals)).filter((t) => {
  const f = universe.fundamentals[t];
  return f && f.sector !== "INDEX" && f.sector !== "CASH";
});

const round4 = (n) => (n == null || !Number.isFinite(n) ? null : Math.round(n * 10_000) / 10_000);

/** CAGR between two values `years` apart; null (with why) across a sign change. */
function cagr(start, end, years) {
  if (start == null || end == null || !(years > 0)) return { value: null, why: "missing data" };
  if (start <= 0 || end <= 0) return { value: null, why: start <= 0 ? "starts at a loss or negative FCF" : "ends at a loss or negative FCF" };
  return { value: round4((end / start) ** (1 / years) - 1), why: null };
}

async function yahoo(t) {
  const now = Math.floor(Date.now() / 1000);
  const url = `https://query1.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/${encodeURIComponent(
    t,
  )}?type=${TYPES.join(",")}&period1=1420070400&period2=${now}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const r of json?.timeseries?.result ?? []) {
    const type = r?.meta?.type?.[0];
    if (!type) continue;
    out[type] = (r[type] ?? [])
      .filter((x) => x && x.reportedValue && Number.isFinite(x.reportedValue.raw))
      .map((x) => [x.asOfDate, x.reportedValue.raw])
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }
  return out;
}

function avSeries(t) {
  const p = `.cache/cf/${t}.json`;
  if (!existsSync(p)) return null;
  try {
    const d = JSON.parse(readFileSync(p, "utf8"));
    const num = (v) => (v == null || v === "None" ? null : Number(v));
    return (d.annualReports ?? [])
      .map((r) => ({
        fy: r.fiscalDateEnding,
        ni: num(r.netIncome),
        ocf: num(r.operatingCashflow),
        capex: num(r.capitalExpenditures),
        sbc: num(r.stockBasedCompensation),
        buyback: num(r.proceedsFromRepurchaseOfEquity),
      }))
      .filter((r) => r.fy)
      .sort((a, b) => (a.fy < b.fy ? -1 : 1));
  } catch {
    return null;
  }
}

function lastN(series, n) {
  return (series ?? []).slice(-n);
}

const companies = {};
for (const t of tickers) {
  let y = {};
  let yErr = null;
  try {
    y = await yahoo(t);
  } catch (e) {
    yErr = String(e).slice(0, 80);
  }
  const rev = y.annualTotalRevenue ?? [];
  const ni = y.annualNetIncome ?? [];
  const ocf = y.annualOperatingCashFlow ?? [];
  const capex = y.annualCapitalExpenditure ?? [];
  const sbc = y.annualStockBasedCompensation ?? [];
  const sh = y.annualDilutedAverageShares ?? [];
  const fcfY = y.annualFreeCashFlow ?? [];

  const revC = rev.length >= 2 ? cagr(rev[0][1], rev.at(-1)[1], rev.length - 1) : { value: null, why: "missing data" };
  const shC = sh.length >= 2 ? cagr(sh[0][1], sh.at(-1)[1], sh.length - 1) : { value: null, why: "missing data" };
  const sumFcf = lastN(fcfY, 3).reduce((s, [, v]) => s + v, 0);
  const sumNi = lastN(ni, 3).reduce((s, [, v]) => s + v, 0);
  const lastOcf = ocf.at(-1)?.[1] ?? null;
  const lastCapex = capex.at(-1)?.[1] != null ? Math.abs(capex.at(-1)[1]) : null;
  const firstOcf = ocf[0]?.[1] ?? null;
  const firstCapex = capex[0]?.[1] != null ? Math.abs(capex[0][1]) : null;
  const lastSbc = sbc.at(-1)?.[1] ?? null;

  // The long record, from 10-K data via Alpha Vantage, when cached.
  const av = avSeries(t);
  let long = null;
  if (av && av.length >= 6) {
    const fcf = av.map((r) => ({ fy: r.fy, v: r.ocf != null && r.capex != null ? r.ocf - r.capex : null, ni: r.ni }));
    const pick = (k) => {
      const end = fcf.at(-1);
      const start = fcf.at(-1 - k);
      if (!start || !end) return { ni: { value: null, why: "under the window" }, fcf: { value: null, why: "under the window" } };
      return { ni: cagr(start.ni, end.ni, k), fcf: cagr(start.v, end.v, k), from: start.fy, to: end.fy };
    };
    const ten = av.length >= 11 ? pick(10) : null;
    const five = pick(5);
    long = {
      source: "alphavantage CASH_FLOW (10-K annual)",
      years: av.length,
      lastFy: av.at(-1).fy,
      niCagr10y: ten ? ten.ni.value : null,
      niCagr10yWhy: ten ? ten.ni.why : "fewer than 11 fiscal years on record",
      fcfCagr10y: ten ? ten.fcf.value : null,
      fcfCagr10yWhy: ten ? ten.fcf.why : "fewer than 11 fiscal years on record",
      niCagr5y: five.ni.value,
      niCagr5yWhy: five.ni.why,
      fcfCagr5y: five.fcf.value,
      fcfCagr5yWhy: five.fcf.why,
      window10: ten ? `${ten.from} → ${ten.to}` : null,
      window5: five.from ? `${five.from} → ${five.to}` : null,
      // The last three fiscal years' free cash flow, for the capex story.
      fcfLast3: fcf.slice(-3).map((r) => [r.fy, r.v]),
    };
  }

  companies[t] = {
    ticker: t,
    yahoo: yErr
      ? { error: yErr }
      : {
          source: "Yahoo Finance fundamentals timeseries (unofficial)",
          fiscalYears: rev.map(([d]) => d),
          revenueCagr: revC.value,
          revenueCagrWhy: revC.why,
          revenueYears: Math.max(0, rev.length - 1),
          // Σ FCF / Σ net income over the last three fiscal years: are earnings cash?
          fcfConversion3y: sumNi > 0 ? round4(sumFcf / sumNi) : null,
          fcfLast: fcfY.at(-1)?.[1] ?? null,
          niLast: ni.at(-1)?.[1] ?? null,
          sbcToOcf: lastOcf && lastSbc != null && lastOcf > 0 ? round4(lastSbc / lastOcf) : null,
          capexToOcf: lastOcf && lastCapex != null && lastOcf > 0 ? round4(lastCapex / lastOcf) : null,
          capexToOcfFirst: firstOcf && firstCapex != null && firstOcf > 0 ? round4(firstCapex / firstOcf) : null,
          // Diluted share count per year: negative = buybacks outrun dilution.
          sharesCagr: shC.value,
          sharesCagrWhy: shC.why,
          sharesYears: Math.max(0, sh.length - 1),
        },
    long,
  };
  process.stdout.write(`  ${t}: ${yErr ? `yahoo ${yErr}` : `${rev.length}y`}${long ? ` + AV ${long.years}y` : ""}\n`);
  await new Promise((r) => setTimeout(r, 600));
}

const doc = {
  capturedAt: new Date().toISOString().slice(0, 10),
  note:
    "What each business has DELIVERED — the record the price's implied growth is compared against. Four-year metrics from Yahoo Finance's fundamentals timeseries (unofficial, keyless); 5- and 10-year net income and free cash flow growth from Alpha Vantage CASH_FLOW annual reports (10-K data) where captured. A growth rate across a loss or a negative-FCF year is undefined and stored as null with the reason. Not a forecast. Refresh: node scripts/capture-durability.mjs",
  companies,
};
writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`);
console.log(`wrote ${OUT} — ${Object.keys(companies).length} companies`);
