# Ledger Desk

Interactive **revenue analytics dashboard** + **dual futures index charts** (MNQ mini vs ES).

Built for shared use across Grok App Builder and Claude (read this repo when coaching trading or extending the desk).

## Features

### Revenue desk
- Date range filters (presets + custom)
- KPI cards: revenue, growth, churn, customers, new MRR
- Trend charts (area/bar) with tooltips
- Segment / channel breakdown tables
- Offline sample SaaS data
- Desk-style AI analyst (Grok when available; local fallback)

### Dual index desk (ProFX-aligned)
- Side-by-side **candlestick + volume** charts for **MNQ** / **ES** (or NQ / ES)
- Yahoo continuous futures: `MNQ=F`, `ES=F`, `NQ=F`
- Bar shape matches ProFX `bars.js`: `{ t, o, h, l, c, v }`
- **Second-precision** last print via Yahoo `regularMarketTime`
- Live poll every **2s** (print time, UTC, fetch time, lag seconds)
- Session change, day range, spread, Pearson ρ (time-aligned)
- Relative performance overlay for SMT-style cracks
- Synthetic OHLC fallback if Yahoo is unreachable
- Crosshair sync between the two panes

## Layout Claude / agents should know

```
src/lib/market/
  types.ts          # OhlcBar, LiveQuote, DualIndexPayload
  yahoo.ts          # Yahoo chart parse, live quote, corr, synthetic
  fetch-dual.ts     # createServerFn: fetchDualIndexes, fetchLiveQuotes
src/components/dashboard/
  dual-index-charts.tsx   # dual desk UI + poll loop
  candlestick-pane.tsx    # lightweight-charts v5 candles
  kpi-cards.tsx, trend-charts.tsx, breakdown-table.tsx, ...
src/routes/index.tsx      # main dashboard page
```

## Stack
React 19 · TypeScript · Vite · TanStack Start/Router · Tailwind v4 · Recharts · lightweight-charts · zustand/zod as needed

## Run
```bash
npm install
npm run dev      # 0.0.0.0:8080
npm run build
npm run typecheck
```

## Honest data note
Free Yahoo CME futures prints are often **~10 minutes delayed**. Timestamps are still exact to the **second** on Yahoo’s stamp. Sub-second pit data needs Databento (see `keatrng-cpu/profxtrader` `netlify/functions/bars.js`).

## Related repos
- [keatrng-cpu/profxtrader](https://github.com/keatrng-cpu/profxtrader) — ProFX trading desk + Databento bars + Claude Professor
- [keatrng-cpu/Trading-Automation](https://github.com/keatrng-cpu/Trading-Automation) — SMC/ICT automation / backtests
