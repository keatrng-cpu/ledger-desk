# Ledger Desk

Interactive **trading ops desk** (Trading-Automation port) + **dual MNQ/ES charts** + sample **revenue analytics**.

Shared by Grok App Builder and Claude — open this repo so both agents see the same surface.

## Features

### aplus ops console (from Trading-Automation)
- **Backtest** tab: NET metrics, equity curve, confluence histogram, skip funnel, trades, journal
- **Premarket** tab: bias stack, conditions, session/killzone, news, PD arrays, levels, narrative
- **Rules / knowledge** tab: non-negotiables from `config.py` / RULES_CALIBRATION + confluence fire rates
- Ported TS modules under `src/lib/aplus/` (analytics, config, confluence, sample-run)

Upstream: [keatrng-cpu/Trading-Automation](https://github.com/keatrng-cpu/Trading-Automation)

### Dual index desk
- Side-by-side candlestick + volume for **MNQ** / **ES** (or NQ / ES)
- Yahoo continuous futures with **second-precision** last print
- Live poll every 2s · lag clock · time-aligned ρ · relative performance (SMT)

### Revenue desk (sample)
- Date filters, KPI cards, trend charts, segment/channel breakdown, AI analyst

## Layout

```
src/lib/aplus/          # Trading-Automation port
src/lib/market/         # Yahoo dual OHLC + live quotes
src/components/dashboard/
  aplus-ops.tsx
  dual-index-charts.tsx
  candlestick-pane.tsx
  …
src/routes/index.tsx
```

## Run
```bash
npm install
npm run dev      # 0.0.0.0:8080
npm run build
npm run typecheck
```

## Related
- [Trading-Automation](https://github.com/keatrng-cpu/Trading-Automation) — Python engine, CLAUDE.md source of truth for rules
- [profxtrader](https://github.com/keatrng-cpu/profxtrader) — Databento bars + Claude Professor
