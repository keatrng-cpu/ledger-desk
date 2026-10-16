# Validation: Rule 1 SHADOW d.7 0DTE ticket (overnight-1016 #1), IV model = desk

Events: 716 Rule 1 tickets, ES+NQ, 2019-01-02 to 2026-10-15 (406 weeks, 1.76/wk); 1 roll-crossing sym-days skipped.
Decision time T = ticket.at (the displacement 5m close). Every bar read closed at or before T (table below).

| ticket | tickets | traded | cap-blocked | $/wk | $/trade | ES $/wk | NQ $/wk | 2026 $ total |
|---|---|---|---|---|---|---|---|---|
| d.7 0DTE | 716 | 708 | 8 | +35.6 | +20.4 | -4.8 | +40.4 | +2188 |
| ATM 0DTE (d.5) | 716 | 716 | 0 | +42.8 | +24.3 | +9.5 | +33.3 | -661 |

Paired d.7 - ATM per ticket: mean $-4.1, t = -0.55, n = 716 (cap-blocked = $0).

## Timeframes used (30s..1D, closed bars only, no lookahead)

| tf | source | events with a closed bar | bar end <= decision T (all) | max(bar end - T) s | agrees with side |
|---|---|---|---|---|---|
| 30s | Databento 30s file (2026-08-16 on) | 14 | True | 0 | 79% |
| 1m | Databento 1m | 716 | True | 0 | 78% |
| 2m | 1m -> 2m left-label | 716 | True | 0 | 88% |
| 3m | 1m -> 3m left-label | 716 | True | 0 | 93% |
| 5m | 1m -> 5m left-label | 716 | True | 0 | 100% |
| 15m | 1m -> 15m left-label | 716 | True | 0 | 35% |
| 30m | 1m -> 30m left-label | 716 | True | 0 | 31% |
| 1h | 1m -> 1h left-label | 715 | True | 0 | 27% |
| 4h | 1m -> 4h anchored 17:00 CT | 716 | True | 0 | 30% |
| 1D | 1m -> CT session 17:00-16:00 | 716 | True | -59700 | 47% |

## d.7 $/trade by closed-bar agreement on each timeframe (all read together at T)

| tf | n agree | $/trade agree | n against | $/trade against |
|---|---|---|---|---|
| 30s | 11 | -69.9 | 3 | +83.1 |
| 1m | 549 | +26.0 | 159 | +1.2 |
| 2m | 620 | +26.4 | 88 | -22.1 |
| 3m | 661 | +14.4 | 47 | +104.4 |
| 5m | 708 | +20.4 | 0 | +nan |
| 15m | 249 | -4.7 | 459 | +34.0 |
| 30m | 217 | -5.8 | 491 | +32.0 |
| 1h | 192 | +11.0 | 515 | +24.9 |
| 4h | 214 | +33.0 | 494 | +14.9 |
| 1D | 335 | +33.7 | 373 | +8.5 |

Conditions: Rule 1 = 08:30-09:00 CT key sweep (ON/PD high-low untouched 2h before) then 5m displacement body >= 1.5x mean 12-bar range;
market at the 5m close; stop = 15-min 1m structure +/- 0.02x range; target 3R; exit 14:55 CT. 1m bars feed Rule 1 only once closed (t+60s <= now).
Cost model note: the desk model uses IV = 1.2 x 5m-range sigma (cheaper than the study's 1.2 x 20-day realized), so absolute $ differ from the report; the ticket ordering is what this checks.
The timeframe table is context and proof only: no timeframe filter is applied to the shadow ticket.

