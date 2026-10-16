# score1016: event-driven five-layer score, probability grading, entry/exit/caps, survivor flags, watcher resilience

Stacks on #46 (`grok/fix1016-postmortem`). Everything is **shadow by default** except the watcher resilience item (alerts only).
Research and backtests: `/workspace/audits/score-rebuild/impl/` (exp.py, exp2.py, fx.py, logs). Candidate table and proxy: `/workspace/audits/week1016-review/work/` (cands_all.pkl, ev.py).

## What ships
| Item | Where | Mode |
|---|---|---|
| Score S = (1.0·L1 HTF + 1.5·L2 Liquidity(+0.25 SMT, +0.1/extra pool, re-arm per event) + 1.5·L3 Displacement/MSS/iFVG + 1.0·L4 newest array + 0.5·L5 Timing)/5.5×100, fire ≥ 83 | `src/lib/smc/score1016.ts` `score1016()`, build-desk end block → `card.score1016`, wire `strategy.score1016` | shadow |
| Probability grading (no band ceiling): A+ ≥90 (p≈0.63), A ≥86, A- ≥83 (fire), B+ ≥80, B ≥75. Only hard vetoes: risk geometry, stale data, invalidation | `gradeOf`, `pOf`, `hardVetoes` | shadow |
| Entry: market if within 1.0R of the newest array edge, else a resting limit at the edge | `entryDecision` | shadow |
| Exit: T1 1R for 50%, stop to BE, runner to 2R | `exitPlan` | shadow |
| Caps: 2 fills/day, 1 per symbol | `capsOk` | shadow |
| bt13 survivors {2,3,7,8,10}: 2 = `fix1016.reanchor`, 10 = `fix1016.chaseFromAnchor` (already in #46); 3 `altEntryIfvgCe`, 7 `setupPerSweep`, 8 `scopeCaps` flags | rules `score1016.*` | shadow |
| Brain "POI in correct half" graded at the ENTRY via pdLeg (narrow) | `poiHalfAtEntry`, `seq/wire.ts` → `deskSeq.poiHalf` + `score1016:poiHalf` row | shadow |
| Floor + Brain seat line `score1016Seat` | `desk-listen.ts` | note only |
| Watcher: `shadow:score1016:would_fire` / `:read` rows (always pass, appended after every gate) | `docs/score1016/watcher-score1016.patch` (`watcher/score1016.py`, gates.py) | shadow |
| Watcher resilience: alert when a poll gap is > 15 s in the fast/slow window, plus an alert on restart after a gap; run.sh alerts and exits when `.venv` is missing (it used to loop silently) | patch: daemon.py, run.sh | **live-capable (alerts only)** |

**RULES_HASH: 9eeed9b4083700cb (#46) → c3b14cab9e29a630.** Adds the `score1016` block; no existing key changes. The watcher fails closed on a hash mismatch, so this needs a paired deploy: the desk merge plus `watcher-fix1016.patch` (#46) and then `watcher-score1016.patch` in the same window. It must not ride tonight's 3:20 CT window unless it goes in together with #44/#46. The patch applies cleanly on top of #46's watcher patch, and the watcher suite passes (602 passed, 3 skipped).

## Backtest (ES+NQ 1m, closed bars, 2010-10 → 2026-10-16; IS 2010–18, OOS 2019 → 2026-10-09, holdout 10/12–10/16)
FULL = S ≥ 83, hybrid entry, T1/BE/2R, caps 2/day and 1/symbol, re-arm, SMT bonus.

| | n | tr/wk | WR | avgR | PF | maxDD R | $/wk @ $150/R |
|---|---|---|---|---|---|---|---|
| Baseline (current-stack emulation) OOS | 2493 | 6.14 | 44% | −0.090 | 0.84 | 233 | −83 |
| **FULL OOS** | 2684 | 6.61 | 62% | **+0.181** | 1.45 | 22.8 | +179 |
| FULL IS | 2601 | 5.84 | 59% | +0.040 | 1.09 | 41.9 | +35 |
| FULL walk-forward (threshold re-picked every 26 w on 104 w), 2019+ | 2768 | 6.82 | 61% | +0.172 | 1.42 | 21.7 | +176 |
| FULL holdout 10/12–10/16 | 8 | 8 | 50% | +0.092 | 1.18 | 4.1 | +110 |
| Regimes: 2010–14 / 2015–19 / 2020–22 / 2023–26 | | 5.5/6.3/6.7/6.5 | 56/61/64/60% | −0.014 / +0.105 / +0.203 / +0.171 | | | |
| OOS ES / NQ | 1312 / 1372 | 3.2 / 3.4 | 61 / 63% | +0.120 / +0.240 | 1.28 / 1.64 | | |

Significance: the OOS mean R of +0.181 against random same-count picks from the same candidate pool has p < 0.0005 (null −0.058), and against same-day shuffles p < 0.003 (null −0.053). t = 9.0, Bonferroni ×40 p ≈ 4e-18. **Caveat:** the weights and the threshold came from earlier full-window research (week1016-review), so IS +0.04 is the more honest prior. Expectancy rises after 2015.

Calibration (every candidate on its own, hybrid/fixed). WR rises strictly by S bucket out of sample:
| S | ≤50 | 50–60 | 60–70 | 70–75 | 75–80 | 80–83 | 83–86 | 86–90 | ≥90 |
|---|---|---|---|---|---|---|---|---|---|
| IS WR | .44 | .47 | .47 | .48 | .50 | .54 | .57 | .57 | .63 |
| OOS WR | .45 | .46 | .49 | .50 | .51 | .56 | .58 | .61 | .63 |
| OOS avgR | −.17 | −.15 | −.09 | −.08 | −.05 | +.07 | +.09 | +.18 | +.20 |
S reaches 85–100 (no ceiling), but the **calibrated p(win) tops out near 0.63**. The 70% WR target is not met by this score.

## Per-finding keep / reject
(OOS avgR, tr/wk, WR, DD. "alone" = added to the baseline proxy. "LOO" = FULL with that one item swapped back.)
| Finding | alone vs baseline (−0.078, 5.3/wk, 44%, DD 183) | LOO from FULL (+0.181, 6.6/wk, 62%, DD 23) | Verdict |
|---|---|---|---|
| 5-layer score ≥ 83 | +0.058, 5.2/wk, 50%, DD 39 | baseline filter instead: +0.003, 7.3/wk, 53%, DD 71 | **KEEP** (the edge comes from here) |
| Hybrid entry (mkt ≤1R else edge limit) | −0.032, 7.1/wk, 56%, DD 113 | first-CE limit: **+0.275, 3.5/wk, 67%, DD 9.9** (IS +0.064); stale base: +0.100 | KEEP for frequency. First-CE dominates on WR and expectancy and still falls in 3–10/wk, so it is offered as an alternative flag value (frontier point) |
| T1 1R 50% → BE → 2R | −0.089, 4.8/wk, 49% | near-pool exit: +0.139, 65%, DD 16.9; pool: +0.153, 42% | KEEP (+0.04R inside the score) |
| Caps 2/day, 1/symbol | −0.078 (no change) | no per-symbol cap: +0.186, 7.05/wk, DD 26.4; cap 3: +0.155, 9.5/wk | KEEP (DD control, near neutral) |
| SMT bonus +0.25 | — | without it: +0.175, 6.5/wk | KEEP (small) |
| Re-arm per event (no new-extreme) | −0.092, 7.2/wk, DD 270 | new-extreme: +0.183, 6.5/wk | NEUTRAL inside the score, harmful alone. Kept as specified (+0.1 tr/wk) |
| Threshold 75/80/83/86/90 | — | +0.066/7.7, +0.163/7.5, **+0.181/6.6**, +0.213/4.6, +0.209/1.3 (tr/wk) | 83 KEEP (walk-forward picked 83 in 15 of 29 windows, 86 in 8, 80 in 6). 86 is the higher-WR frontier point |
| bt13 fixes {2,3,7,8,10} (old engine) | each alone: no change (+0.078, 0.23/wk) | set: +0.121, 0.37/wk; minus 2: +0.057, minus 3: +0.078, minus 7: +0.092, minus 8: +0.088, minus 10: +0.078 | KEEP AS A SET, shadow only. They only work jointly, and the engine they repair stays negative IS (−0.285) |
| Brain POI-half at entry (pdLeg narrow) | −0.141, 2.8/wk | on top of FULL: +0.199 but 0.47/wk | **REJECT for live** (kills frequency). Shipped as its own shadow flag |
| Watcher resilience | not bar-testable (ops) | — | KEEP live (alerts only) |

## Parity (TS vs the Python proxy)
`scripts/score1016.test.mjs` runs the TS `score1016()` on 553 candidates: all 153 from 10/12–10/16 plus 400 random from 2010–2026 (`scripts/fixtures/score1016-parity.json`). Max |S_ts − S_py| ≤ 0.05 and the fire decision matches on all 553.
**Limits:** the recorded `cards.log` wire carries only ltfArm metadata, not the sweep/displacement/gap event, so a replay of real desk cards through `inputFromCard` (the build-desk adapter) cannot reproduce the proxy events for this week. Adapter parity is unproven until shadow cards are logged live. The first live shadow session should be compared against the proxy for the same minutes.

## Holdout week (FULL, proxy)
| CT | sym | side | entry | R | S |
|---|---|---|---|---|---|
| 10-13 09:24 | ES | long | 7853.00 | −1.09 | 85.2 |
| 10-13 12:50 | NQ | short | 30707.25 | −1.01 | 85.5 |
| 10-14 08:31 | NQ | short | 30519.75 | −1.01 | 87.3 |
| 10-14 08:33 | ES | long | 7829.75 | −1.05 | 88.9 |
| 10-15 09:01 | ES | long | 7743.50 | +1.48 | 90.9 |
| 10-15 10:09 | NQ | long | 29998.75 | +0.49 | 84.7 |
| 10-16 08:16 | NQ | short | 30057.00 | +1.48 | 88.7 |
| 10-16 09:51 | ES | short | 7790.00 | +1.43 | 94.8 |

## Tests
`node --test scripts/score1016.test.mjs`: 7 pass. Full suite: 511 pass, 1 fail. The failure is the expected cross-repo check "watcher copy of the rules is byte-identical", which compares against the live watcher on the box until the paired deploy. `tsc --noEmit` is clean. Watcher (patched copy): 602 passed, 3 skipped.
