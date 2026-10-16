# combo1016: SMC research best combo (legacy arm SHADOW; config1_trail LIVE since 10/16)

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

**RULES_HASH: c3b14cab9e29a630 (#47 v1) → ba5fee962993fd8f → 8380b2b3975fdee2 → 8dac52fc50de2428 → 5b73f1001c0cb23d → d440041c193ea8a9 (current).** Adds `score1016.v2` and `combo1016`; no existing key changes. Paired deploy: desk merge + `watcher-fix1016.patch` → `watcher-score1016.patch` → `watcher-combo1016.patch` in one window (the watcher fails closed on a hash mismatch). The chain applies cleanly on the current live watcher tree.

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


## combo1016 arms (SMC pnl-push finalists, SHADOW ONLY)
Source of truth: SMC integration bundle `/workspace/audits/smc-research/integration/` (README, FEATURES.md, features-ref.ts, option_ref, minutes fixtures, golden_decisions.json).
Rules `combo1016Arms` (mode shadow): config1_trail (ALT_C70trail_tier250_500), config2_e75 (P1_B70E75_flat300), config3_e75_s65 (P3_A65E75_tier250_500), config2_e75_tier200_400 (P2).
Fire S2 ≥ 70 (65 for config3) AND gbmP ≥ q90 0.6487956668756266 (walk-forward GBM 2020-01-01..2026-07-04, applies through 2027-01-02; 26-week refit is a documented parameter, no live refit).
Entry market if chaseR ≤ 1 else limit at the newest near edge, 20 min, cancel at +0.75R. Caps 5/day, 3/symbol, 1 open/symbol, halt after the first losing day result (net R < 0), re-arm only on a new setupId, flat 14:55 CT.
Fixed $/R; A+ (S2 ≥ 85) 2x for config1/config3. Exits TR (50% @1R → BE → trail MFE−1R) / E75 (50% @0.75R → BE → 2R). 2-tick cost. Rows `shadow:combo1016:<config>` (JSON, SMC log schema) with fire, legs, option-$ estimate, partial label. The legacy combo1016 arm's rules and fire rule are unchanged, but its inputs changed (see below).

### Inputs
Legacy combo1016 arm (correction): it now also receives the closed-bar 5m features from `barFeatures` (tr4h_with, rng30 and the GBM context features), and its ATR inputs (risk_atr/atr5 and the hard-veto atr1m) moved from 15m bars to closed 1m bars (HEAD computed them on 15m bars by mistake). Its candidate inputs (b1/b4/pd/smt/chaseR) are still the desk's; only the arms use `candFeatures`. Its S2/gbmP therefore differ from #47 v1 on live cards (shadow only).
Arms:
- 5m context features: `combo1016-feat.ts barFeatures` (closed-bar port of feat.py; row t5 = floor(decision bar label, 5m)).
- Candidate features: `candFeatures` = eng.py/score.py exact: b1/b4 sign(close − EMA20 adjust=False) on 1h / 4h bins (4h bins 02/06/10/14/18/22 UTC), pd on the eng.py DR (prior calendar-day RTH 08:30–15:00 + ON = prior day ≥15:15 and today <08:00) at the decision close, smt over [raid−5, decision] vs the 60 bars before, chaseR = |next open − newest near edge| / |next open − stop| (market-anchor risk, NOT riskEdge), tmin = decision bar label.
- S2 defaults per SMC: atrpct → 0.5, chaseR → 1, tr4h_with null → ctx_htf4 = 0 (not the median).
- Research quirks copied, not fixed: tr1h_with = −tr1h for both sides; ON/Asia/London levels use the full session — free of lookahead only during RTH (08:30+). Before 08:30 the research row used later overnight bars; the desk cannot, so those rows differ (sw_with 28, pdpos_with 266 of 4474 SMC minutes) and every row decided before 08:30 CT carries the partial flag `pre-08:30 CT: sw_with,pdpos_with on a partial overnight` (legacy and arms).
- Desk finding: the desk's bias1h/bias4h are structural MTF rung biases (not EMA), pd used the arm entry edge and desk-named levels, smt was a component flag, chaseR divided by riskEdge. None of these matched research; the arms now use candFeatures.

### Warmup (fail closed)
atrpct needs ≥ 20 days of 24h 5m bars (5760; ≥ 500 for any value). The desk keeps 480 1m bars + 1 month of 15m, so atrpct is null and EVERY arms row is labelled `would_fire_partial (warmup<20d 5m; …)` until a 20-day 5m feed exists. The fire decision is computed as research would with atrpct missing (S2 0.5 default, GBM NaN routing) and stays shadow.

### Parity
| check | result |
|---|---|
| 5m features, 10 days × ES/NQ × both sides, every minute 08:30–14:59 (15600 each) | 100% all except since_disp 97.56% (380 censored null, 0 wrong), atrpct null |
| SMC minutes fixtures (14 files, 4474 min) | 100% except pre-08:30 lookahead rows above, atrpct null |
| candidate features on 326 research candidates (b1, b4, pd, smt, tmin) | 100% each; chaseR 324/325 (1 null: no market anchor), 0 wrong |
| golden_decisions.json 166 decisions | dS2 5e-14, dgbmP 1e-16, fire 498/498 (TS) and watcher test_combo1016_arms |
| arms vs pnl-push VAL | n/WR/$ per week exact for all four; exit sim dR 0 on 400 paths; option max d 1.7e-12 |

### Brain P/D at entry (step 8, shadow)
`brainPd.mode = "shadow"`: brainPdNudge (+0.1 when aligned, 0 otherwise, never negative) is only added to the score when mode is live; it is never a STAND reason. pd_cur and pd_ent are logged on the arms rows.

### Hashes
Repo RULES_HASH = first 16 hex of sha256 over canonical shared/desk-rules.json = `d440041c193ea8a9`. SMC quotes `dee7810e4d8e050a`, a hash over its own bundle files; the two differ by construction and neither is expected to equal the other. The arms GBM file is pinned separately (sha256_16 1d976c113099d0d8).

## LIVE: config1_trail (Keaton 10/16 14:38 CT)
`combo1016Arms.live` = {mode live, arm config1_trail, bypass [debitCap650, dayLoss, weeklyLock, bplusBrainTake]}. Watcher `combo1016_live.py` decides before the v5 chain;
a take turns this card's non-safety v5 refusals into `soft:*` rows, sizes by SMC (desk pp4 contracts at $250/$500 per R, no $650 cap), records the day book
(5/day, 3/symbol, 1 open/symbol, halt after the first loss, new setupId), and manages TR on the underlying (`gates.manage_action`). Limit plans are sealed
for 20 min and fire on an edge touch unless +0.75R prints first. Rows: `combo1016:live` (TAKE / not taken: reason) and `live:combo1016:config1_trail`.
Candidate inputs for the arms now also carry eng.py a5 and risk_atr (100% on 326 research candidates).
Parity: golden_decisions 166/166 fire; the live day book reproduces SMC's 1177 config1 VAL trades exactly (pnl-push semantics); desk contracts 1177/1177,
strike 1177/1177, option $ max diff 3.6e-9; exit_ref TR 75/75. Differences and bypasses: ai/DECISIONS.md 2026-10-16 14:38 CT; numbers in `live_diff_backtest.json`.
