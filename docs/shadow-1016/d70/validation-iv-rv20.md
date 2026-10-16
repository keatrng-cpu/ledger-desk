# Validation: Rule 1 SHADOW d.7 0DTE ticket (overnight-1016 #1), IV model = rv20

Events: 716 Rule 1 tickets, ES+NQ, 2019-01-02 to 2026-10-15 (406 weeks, 1.76/wk); 1 roll-crossing sym-days skipped.
Decision time T = ticket.at (the displacement 5m close). Every bar read closed at or before T (table below).

| ticket | tickets | traded | cap-blocked | $/wk | $/trade | ES $/wk | NQ $/wk | 2026 $ total |
|---|---|---|---|---|---|---|---|---|
| d.7 0DTE | 716 | 665 | 51 | -40.9 | -25.0 | -27.7 | -13.2 | -2773 |
| ATM 0DTE (d.5) | 716 | 710 | 6 | -116.1 | -66.4 | -57.6 | -58.6 | -8284 |

Paired d.7 - ATM per ticket: mean $+42.7, t = 6.10, n = 716 (cap-blocked = $0).

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
| 30s | 10 | -140.9 | 3 | -29.7 |
| 1m | 512 | -22.4 | 153 | -33.5 |
| 2m | 579 | -22.5 | 86 | -41.6 |
| 3m | 619 | -26.5 | 46 | -4.5 |
| 5m | 665 | -25.0 | 0 | +nan |
| 15m | 232 | -39.1 | 433 | -17.4 |
| 30m | 208 | -39.0 | 457 | -18.6 |
| 1h | 176 | -28.4 | 488 | -22.7 |
| 4h | 200 | -1.8 | 465 | -34.9 |
| 1D | 318 | -21.5 | 347 | -28.2 |

Conditions: Rule 1 = 08:30-09:00 CT key sweep (ON/PD high-low untouched 2h before) then 5m displacement body >= 1.5x mean 12-bar range;
market at the 5m close; stop = 15-min 1m structure +/- 0.02x range; target 3R; exit 14:55 CT. 1m bars feed Rule 1 only once closed (t+60s <= now).
Cost model note: the desk model uses IV = 1.2 x 5m-range sigma (cheaper than the study's 1.2 x 20-day realized), so absolute $ differ from the report; the ticket ordering is what this checks.
The timeframe table is context and proof only: no timeframe filter is applied to the shadow ticket.

