# 10/16 retest re-entry (A) and timing.mode live (B): walk-forward (2026-10-16, CT)
SHADOW/TEST only. No live firing, the watcher was not touched (its patch is `docs/watcher-retest-reentry-shadow.patch`, not applied), and no orders were placed.

## Data and method
- **Data:** Databento GLBX.MDP3 NQ.c.0 and ES.c.0, already on the box (`/workspace/data/databento`, where `get_cost` was $0.00). I pulled nothing new, so the cost was $0.
- **Engine:** this reuses `audits/databento-1015` (ratio back-adjust, roll-crossing skips, BS 0DTE option model with VXN/VIX from the prior close, a $500 debit and $0.03/share each side).
- **Card:** RTH 08:30–14:00 CT. A 1m sweep of the prior 20-bar extreme, then within 5 bars a displacement with body ≥ 1.0×ATR1m that closes through. Entry at CE, stop at the sweep extreme ±0.25 ATR1m, and T1 1.5R / T2 3R. At most 3 trades/day and one at a time.
- **Shadow chase (baseline):** q × max(0, 1 − 0.5·d), where d is the closed price's distance past CE in ATR15. The card arms only if q ≥ 0.60 and d ≤ 0.5 (the watcher's entry distance).
  - The desk q cannot be reproduced offline, so q0 is a **proxy**: 0.55 + 0.1·disp, +0.03 for a pool sweep, +0.02 per agreeing 1h/4h/1D bias and −0.03 per opposing one, capped at 0.85.
- **B:** the same card with no chase cut. The execution gates are unchanged.
- **A:** when the card did not fill, this arms the retest of the broken level. The level is the last opposite-close 1m OB that the displacement closed through.
  - Entry is at the edge or the CE. The stop is beyond the sweep extreme. The target is the next untaken pool (PDH/PDL, ON H/L or the prior swing).
  - It is refused under minRR, and voided when a closed bar reclaims the level or after the wait window.
  - Exits are stop, target or 14:50, with the stop taken first on a two-sided bar.
- **Walk-forward:** an expanding train (2019 → year−1) picks from {edge, ce} × {minRR 0.85, 1.2} × {wait 60, 90} on train $, and that pick is tested on the unseen next year. OOS runs 2021-01-01 → 2026-10-15 (301.9 weeks).
  - The picks were stable: A chose ce / 0.85R / 60 min every year, and AB chose ce / 1.2R / 60 min.

## Timeframe proof (all closed bars, no look-ahead)
| TF | Source | Used for | Known at |
|---|---|---|---|
| 30s | NQ/ES_30s (2026-08-16 → 10-15 only) | The retest fill is refused if the last closed 30s bar closed back through the level | 30s close (ts + 30s) |
| 1m | 1m_full | Sweep, displacement, OB/broken level, ATR1m, fills, exits | Bar close; ATR shifted by 1 |
| 3m | Resampled from 1m | m3 bias (logged on the signal) | Bucket close |
| 5m / 15m | Resampled from 1m | m5/m15 bias; ATR15 for the chase distance d | Bucket close (+5 / +15 min) |
| 1h / 4h | Resampled from 1m (4h anchored at 17:00 CT) | Card dropped when both oppose; q0 agreement | Bucket close (+60 / +240 min) |
| 1D | NQ/ES_1d | q0 agreement | Next day |

## OOS results (NQ + ES, 2021-01 → 2026-10-15, option $ after costs)
| Variant | Trades | Win | R/trade (underlying) | Trades/wk | $/trade | **$/wk** | vs base $/wk |
|---|---|---|---|---|---|---|---|
| Baseline (shadow chase, no re-entry) | 6,551 | 40.0% | +0.011 | 21.7 | −$36.8 | **−$800** | — |
| A: + retest re-entry | 7,505 | 32.4% | +0.011 | 24.9 | −$30.5 | **−$758** | +$42 |
| (A, retest trades only) | 2,728 | 17.6% | −0.018 | 9.0 | −$25.7 | −$232 | |
| B: timing.mode live | 7,249 | 40.1% | +0.006 | 24.0 | −$32.8 | **−$787** | +$12 |
| A + B | 7,566 | 35.7% | +0.008 | 25.1 | −$31.9 | **−$799** | +$1 |
| (A+B, retest trades only) | 1,334 | 16.0% | +0.054 | 4.4 | −$26.9 | −$119 | |

By year (R/trade): base was +0.024, +0.024, +0.034, −0.117, +0.068 and +0.029. A was −0.017, +0.007, +0.036, −0.021, +0.060 and −0.003. Option $ was negative in **every** year for every variant. Per-symbol figures are in `results.json`.

## Verdict: NO-GO for live
- **A** adds about 3 trades/week with a 17.6% win rate and −0.018R. It makes the option P&L "less negative" only because those trades lose less premium per trade than the base card, not because they make money.
- **B** adds about 2.3 trades/week at a lower R/trade. The $ difference of about $12/wk is noise.
- Neither variant moves R/trade off ≈ 0. This is consistent with the 10/15 Databento study: the sweep+displacement family has no edge after option costs.
- The 10/16 MNQ move is one sample. 2026-10-16 bars are not in the box data (it ends 10-15 14:59 UTC), so it is not in this replay.
- **Caveats:** q is a proxy, the option model has no real chain prints, and the 30s rung only exists for the last 60 days.
