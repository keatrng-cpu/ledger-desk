# CLAUDE.md — Ledger Desk (+ Trading-Automation port)

You (Claude) can read this repo for:

1. **Dual MNQ/ES futures desk** (Yahoo live prints)
2. **aplus ops console** ported from `keatrng-cpu/Trading-Automation`

## Source of truth for trading rules
Upstream: **https://github.com/keatrng-cpu/Trading-Automation** (`CLAUDE.md`, `RULES_CALIBRATION.md`, `aplus/config.py`).

If this file and Trading-Automation CLAUDE.md disagree on risk/floor numbers, **Trading-Automation wins** for engine behaviour. This desk is a display + demo surface.

## Dual charts
- **MNQ mini** vs **ES** side by side (toggle NQ/ES)
- Real Yahoo continuous: `MNQ=F`, `ES=F`, `NQ=F`
- OHLC shape: `{ t: ms, o, h, l, c, v }` — same idea as ProFX `bars.js`
- Live last print: `src/lib/market/yahoo.ts` → `fetchYahooLiveQuote`
  - Chart meta `regularMarketTime` (unix **seconds**) + `regularMarketPrice`
  - UI: Print (ET w/ seconds), UTC, Fetched, lag seconds
  - Client poll: `fetchLiveQuotes` every 2s in `dual-index-charts.tsx`
- Correlation: time-aligned bar returns
- SMT note: relative performance line chart

## aplus ops (ported modules)
| Path | Upstream |
|------|----------|
| `src/lib/aplus/config.ts` | `aplus/config.py` + RULES_CALIBRATION |
| `src/lib/aplus/analytics.ts` | `aplus/analytics.py` (NET pnl metrics) |
| `src/lib/aplus/confluence.ts` | `knowledge/confluence.json` |
| `src/lib/aplus/sample-run.ts` | dashboard `data.json` shape (demo) |
| `src/components/dashboard/aplus-ops.tsx` | `aplus/dashboard_page.html` |

Tabs: **Backtest** · **Premarket** · **Rules / knowledge**

### Active calibration (display)
- Confluence floor **0.50 TEST** (config.py) — production calib **0.67** (RULES_CALIBRATION)
- A+ tag ≥ **0.75**
- Max **2** setups / killzone · risk **0.5%** (1% ceiling) · R:R 1:1–1:3
- Daily **2%** / weekly **5%** loss halt
- HTF **top_down absolute gate**
- Dual **NQ+ES** · micros preferred · NY session
- AI **never gates** a trade — rules + brain only

### Demo honesty
`sample-run.ts` is offline demo dual-run data for the UI. It is **not** a live Python engine backtest. Label it clearly. Real runs: `python -m aplus backtest …` in Trading-Automation.

## Do not invent pit-level latency
Yahoo free futures can lag ~600s. Report lag honestly. Databento GLBX → profxtrader / Trading-Automation data layer.

## Key market files
| Path | Role |
|------|------|
| `src/lib/market/types.ts` | Shared types |
| `src/lib/market/yahoo.ts` | Yahoo fetch/parse/live quote |
| `src/lib/market/fetch-dual.ts` | Server functions |
| `src/components/dashboard/dual-index-charts.tsx` | Dual UI + polling |
| `src/components/dashboard/candlestick-pane.tsx` | lightweight-charts |
| `src/routes/index.tsx` | Page composition |

## When extending
- Keep ProFX / Trading-Automation bar shape stable
- Prefer POST server fns with validated symbol/range
- Synthetic fallback must still paint charts offline
- Never claim exchange-native real-time without Databento entitlement
- Never lower confluence floor in UI copy below what config says without labeling TEST
