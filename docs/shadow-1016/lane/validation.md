# Validation: Rule 1 SHADOW fire lane (overnight-1016 #2)

Events: 716 Rule 1 tickets ES+NQ 2019-01-02..2026-10-15 (716 with all delayed fills). Card latency sample: 711 first-cards-per-minute from cards.log (build after the 1m close p50 2.9 s / p90 8.6 s; watcher receipt p50 1.4 s).

R by whole-minute entry delay (closed 1m fills): 0 min +0.117, 1 min +0.105, 2 min +0.100, 3 min +0.095.

| path | decision latency s | mean R (interpolated) | delta R vs 0 s | ES | NQ |
|---|---|---|---|---|---|
| lane p50 (persist exempt) | 4.4 | +0.117 | -0.001 | +0.051 | +0.159 |
| lane p90 | 10.5 | +0.115 | -0.002 | +0.050 | +0.157 |
| legacy min: lane p50 + 20 s hold | 24.4 | +0.112 | -0.005 | +0.049 | +0.154 |
| legacy observed: lane p50 + 96 s | 100.4 | +0.101 | -0.016 | +0.049 | +0.136 |
| 10/15 live fire: 124 s | 124.0 | +0.099 | -0.018 | +0.050 | +0.131 |

Baseline (0 s, entry at the displacement close): mean R +0.117.
Fills are on closed 1m bars at 0..3 min; a latency between two whole minutes is linearly interpolated.

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

Conditions: Rule 1 as in shared/rule1.json; a delayed entry whose stop traded before the fill counts -1R; exit 14:55 CT.
The lane is SHADOW: these numbers say what the exemption would be worth; nothing fires.

