# CLAUDE.md — Ledger Masterplace (private trading desk)

This is the user's **private trading masterplace**. You (Claude) and Grok help them
become profitable by **explaining and organizing** — never by inventing fills or
overriding risk gates.

## Product map (top → bottom)

1. **Session HUD** — ET clock, killzone, risk slot, live MNQ/ES prints, focus line  
2. **Automatic HTF bias** — structure from OHLC (absolute gate)  
3. **Premarket / session brief** — checklist + narrative  
4. **Active setup scanner** — confluence grades A+/A-/B/skip, present vs missing  
5. **Dual tape** — MNQ mini vs ES (Yahoo second-precision prints)  
6. **Liquidity & key levels** — EQH/EQL, session H/L, PDH/PDL, dealing range  
7. **Risk governor** — non-negotiables from Trading-Automation  
8. **Desk coach** — posture + focus action (deterministic from scores)  
9. **Lab** — deep aplus backtest / rules (collapsible)

## Source of trading rules
Upstream engine: **https://github.com/keatrng-cpu/Trading-Automation**

| Active | Value |
|--------|--------|
| Confluence floor | 0.50 TEST (calib 0.67) |
| A+ tag | ≥ 0.75 |
| Risk | 0.5% (1% ceiling) |
| Setups / KZ | 2 |
| R:R | 1:1–1:3 |
| Daily / weekly halt | 2% / 5% |
| HTF top_down | **absolute gate** |
| Symbols | dual NQ/ES · micros preferred |

**AI never gates a trade.** Rules + structure decide; you narrate.

## Key code

| Path | Role |
|------|------|
| `src/lib/trading/sessions.ts` | NY killzones |
| `src/lib/trading/structure.ts` | HTF bias, swings, liquidity, SMT |
| `src/lib/trading/scanner.ts` | Setup candidates + confluence |
| `src/lib/trading/build-desk.ts` | Server: Yahoo + full desk payload |
| `src/lib/aplus/*` | Trading-Automation port (metrics, rules, knowledge) |
| `src/lib/market/*` | Dual Yahoo OHLC + live quotes |
| `src/components/desk/*` | Masterplace UI sections |
| `src/routes/index.tsx` | Organized page shell |

## How to help the user

- **Premarket:** Read section 1–2 checklist; call out HTF + PDH/PDL + killzone.  
- **During session:** Prefer **actionable** scanner rows only; list missing confluences honestly.  
- **Liquidity:** Point to buyside/sellside pools and whether swept.  
- **HTF bias:** Treat `topDown` as hard gate — no long if HTF bear.  
- **Risk:** Always size from risk governor dollars; never suggest averaging down.  
- **Data lag:** Yahoo free futures can lag ~10m — report print lag; don't claim pit real-time.  
- **Repo:** https://github.com/keatrng-cpu/ledger-desk  

## When extending
- Keep structure **deterministic** (TypeScript math, not LLM scores).  
- Label demo/sample vs live Yahoo.  
- Mobile-first; sections numbered for orientation.  
- Do not lower confluence floor in copy without TEST label.
