# combo1016: SMC research best combo (SHADOW ONLY)

Stacks on #47's score1016 (and #46). Spec: `/workspace/audits/smc-research/s2-combo.md` (proof tables: `proof_table.md`, grid: `combo_grid.csv`). Export and fixture build: `/workspace/audits/smc-research/export/export_combo.py` (+ `build_m_all.py`).

| Item | Where | Mode |
|---|---|---|
| `score1016.v2` = S2 distilled logistic (`score-rebuild/ev/distill.json`, fit IS 2010–18). 5 layers / 14 subfactors, z → S2 = 100·clip((z−lo)/(hi−lo)) (no ceiling), p = isotonic(z). Signs as fit: L1 premium/discount enters as `ctx_pd = 1 − pd`; the iFVG event is + and L4 rewards a plain FVG as the newest array (`ent_arr_fvg`). NaN subfactors take the IS medians (shipped in the rules). | `src/lib/smc/combo1016.ts` `scoreV2`, rules `score1016.v2` | shadow |
| `gbmP`: the IS LightGBM (400 trees, `score-rebuild/ev/gbm.py` params) exported tree by tree → `shared/combo1016-gbm.json` (sha256/16 `95b5f2f952792673`, pinned in rules). Refit reproduced `m.pkl` pg exactly (max diff 0). | `gbmP` | shadow |
| Threshold = 90th pct of IS (2010–18) gbmP = **0.604112** | rules `combo1016.gbm.thr` | — |
| Fire = S2 ≥ 75 AND gbmP ≥ thr. A+ = fire AND S2 ≥ 90: logged only (`aPlusSizing: false`) | `comboRead` | shadow |
| Hybrid entry: market if chaseR ≤ 1, else a limit at the newest array edge. T1 1R 50% → BE → 2R | `comboPlan` | shadow |
| Caps 3/day, 2/symbol; halt for the day after the first loss; re-arm only with a new setup id (symbol, side, sweep level, sweep time); a sealed entry is never re-priced | `comboAdmit` (TS) / watcher `combo1016.admit` + `resolve` (shadow day ledger in `state_day["combo1016"]`) | shadow |
| Desk: `card.combo1016` (read + `rows: ["shadow:combo1016:would_fire" \| "read", "shadow:combo1016:a_plus"]` + feature vector) | `build-desk.ts` block after score1016 | shadow |
| Brain + Floor seats: `combo1016Seat` line tagged `shadow:combo1016:*` | `desk-listen.ts` | note only |
| Watcher: `shadow:combo1016:read / would_fire / a_plus / ledger / result` rows (status True, appended after every gate); recomputes S2 and gbmP from the card's features in pure Python and tags `DRIFT` on disagreement | `docs/combo1016/watcher-combo1016.patch` (`watcher/combo1016.py`, gates.py, model copy, rules copy) | shadow |

**RULES_HASH: c3b14cab9e29a630 (#47 v1) → ba5fee962993fd8f.** Adds `score1016.v2` and `combo1016`; no existing key changes. Paired deploy: desk merge + `watcher-fix1016.patch` → `watcher-score1016.patch` → `watcher-combo1016.patch` in one window (the watcher fails closed on a hash mismatch). The chain applies cleanly on the current live watcher tree.

## Parity (TS vs Python research, same 553 candidates as v1 parity)
`scripts/combo1016.test.mjs` / watcher `tests/test_combo1016.py` on `scripts/fixtures/combo1016-parity.json` (rows in the same order/keys as `score1016-parity.json`). Python reference: distill.json S2 and the LightGBM `predict_proba`. 538 of 553 come straight from `m.pkl`; the other 15 have no resolved outcome (`Ro` NaN), so they were rebuilt with gbm.py's own feature code minus the outcome filter (`build_m_all.py`; it reproduces m.pkl's pg exactly on the overlap).
- TS: max |ΔS2| 6e-14, max |Δp| 0, max |ΔgbmP| 1e-16. **Fire decision matches 553/553** (37 fire, 9 A+).
- Watcher Python: same tolerances, fire matches 553/553.

## Limits
- Research OOS figures use a walk-forward S2 (refit every 26 w). The shipped v2 uses the fixed IS fit (distill.json), as specified.
- Desk adapter coverage: the live card provides b1, b4, pd, wtmax, nk, smt, disp, mss, ifvg, arr_ifvg, eqhit, n_arr, tmin, chaseR, risk_atr (vs a 5m ATR14 built from closed 1m bars) and dow. `tr4h_with`, `atrpct`, `rng30` (S2) and sw_with, smt_with, fail3_with, mss5_with, tr1h_with, tr4h_with, pdpos_with, compress, rng30, since_disp, atrpct (GBM) are not on the card yet: S2 takes the IS median and the GBM takes its missing-value branch, and both are listed on the card (`filled`, `gbmMissing`). **Live adapter parity is unproven until those features are wired**, so expect the live shadow gbmP to differ from the research.
- The ledger outcomes resolve on the watcher's tape price per poll (futures R, not option P&L).

## Partial label (review fix)
`filled` lists every S2 input that did not come from a real value: median-filled subfactors plus the two research defaults (`ctx_lowvol` when atrpct is missing → 0.5, `ent_nochase` when chaseR is missing → chaseR 1). `card.combo1016.partial` = `partial: N/14 S2 filled, M/27 GBM missing` whenever any input is defaulted or missing. Then the desk row is `shadow:combo1016:would_fire_partial (partial: …)` (or `shadow:combo1016:read (partial: …)`), the Floor/Brain seat line reads `shadow:combo1016:would_fire_partial … · partial: …`, and the watcher logs `shadow:combo1016:would_fire_partial` with the label (recomputed from the card's feature vector). A clean `would_fire` appears only when every input is real. Numbers and fire decisions are unchanged (label only). The watcher imports combo1016 inside the try, so a corrupt GBM file only yields `shadow:combo1016:error`.

