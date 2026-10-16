# Validation: push path SHADOW (overnight-1016 #3)

Latency sample: 711 minutes (first card per 1m bar, cards.log). Rule 1 events: 716 (2019-01-02..2026-10-15).

| path | bar close -> decision p50 s | p90 s | max s | share < 10 s | mean R at p50 | mean R at p90 |
|---|---|---|---|---|---|---|
| poll (measured) | 4.7 | 10.5 | 53.1 | 89% | +0.1164 | +0.1152 |
| push (modelled: build + 0.25 + 0.50 s) | 3.7 | 9.4 | 52.8 | 92% | +0.1167 | +0.1155 |
| desk build only (floor) | 2.9 | 8.6 | 52.0 | 93% | +0.1168 | +0.1156 |

R curve: entry at the displacement close +0.117R, one closed 1m bar later +0.105R (linear in between).
Push saves the poll receipt (p50 1.4 s); the build itself (p50 2.9 s / p90 8.6 s) dominates and is unchanged by push.

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

Conditions: Rule 1 as in shared/rule1.json; fills on closed 1m bars; exit 14:55 CT. SHADOW: push events are logged, never gated or fired.

