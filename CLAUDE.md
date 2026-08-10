# CLAUDE.md — Ledger Desk

You (Claude) can read this repo for the **dual MNQ/ES futures desk** and revenue dashboard.

## Dual charts (what the user cares about)
- **MNQ mini** vs **ES** side by side (toggle NQ/ES)
- Real Yahoo continuous: `MNQ=F`, `ES=F`, `NQ=F`
- OHLC shape: `{ t: ms, o, h, l, c, v }` — same idea as ProFX `bars.js`
- Live last print: `src/lib/market/yahoo.ts` → `fetchYahooLiveQuote`
  - Uses chart meta `regularMarketTime` (unix **seconds**) + `regularMarketPrice`
  - UI shows Print (ET w/ seconds), UTC, Fetched, lag seconds
  - Client poll: `fetchLiveQuotes` every 2s in `dual-index-charts.tsx`
- Bars: `fetchDualIndexes` with ranges 1d/5d/1mo/3mo
- Correlation: time-aligned bar returns (`alignedReturnPairs` + `pearsonCorr`)
- SMT note: relative performance line chart + comparison strip

## Do not invent pit-level latency
Yahoo free futures can lag ~600s. Report lag honestly. For real Databento GLBX, point at profxtrader `bars.js`.

## Key files
| Path | Role |
|------|------|
| `src/lib/market/types.ts` | Shared types |
| `src/lib/market/yahoo.ts` | Yahoo fetch/parse/live quote |
| `src/lib/market/fetch-dual.ts` | Server functions |
| `src/components/dashboard/dual-index-charts.tsx` | Dual UI + polling |
| `src/components/dashboard/candlestick-pane.tsx` | lightweight-charts |
| `src/routes/index.tsx` | Page composition |

## When extending
- Keep ProFX bar shape stable
- Prefer POST server fns with validated symbol/range
- Synthetic fallback must still paint charts offline
- Never claim exchange-native real-time without Databento entitlement
