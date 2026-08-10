# Ledger Masterplace

Private **trading masterplace** for becoming profitable with Grok + Claude as desk coaches.

## Organized flow (top → bottom)

1. **Session HUD** — ET clock, killzone, risk, live MNQ/ES, focus line  
2. **Automatic HTF bias** — structure from live OHLC (absolute gate)  
3. **Premarket brief** — checklist + narrative  
4. **Setup scanner** — confluence grades, present/missing components  
5. **Dual tape** — MNQ mini vs ES candlesticks + relative performance  
6. **Liquidity & levels** — EQH/EQL, PDH/PDL, dealing range  
7. **Risk governor** — Trading-Automation non-negotiables  
8. **Desk coach** — posture + focus action  
9. **Lab** — deep aplus backtest / rules (collapsible)

## Stack
TanStack Start · React 19 · Tailwind v4 · lightweight-charts · Recharts · Yahoo continuous futures

## Rules (summary)
Risk 0.5% · floor 0.50 TEST (calib 0.67) · max 2/killzone · HTF absolute · dual NQ+ES micros · AI never gates trades

## Related
- [Trading-Automation](https://github.com/keatrng-cpu/Trading-Automation) — Python engine source of truth  
- [profxtrader](https://github.com/keatrng-cpu/profxtrader) — Databento + Professor  

## Run
```bash
npm install && npm run dev
```

See **CLAUDE.md** for agent protocol.
