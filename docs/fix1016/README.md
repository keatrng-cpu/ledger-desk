# fix1016 — short post-mortem 2026-10-16 (Keaton-approved fixes 1–8, 10)

Source: `/workspace/audits/1016-short-postmortem.md` → "Exhaustive gate trace". Item 9 (VPS move) is scheduled separately.
Rules block: `shared/desk-rules.json` → `fix1016` (byte-identical copy in the watcher patch).
**RULES_HASH a4bfcb65c88badcd → 9eeed9b4083700cb** (block added; no existing key changed). Desk and watcher must deploy together:
the watcher fails closed (`rules_parity`) on a hash mismatch, so merge the desk PR and apply `watcher-fix1016.patch` in the same window.

| # | Item | Where | Mode now | Live-capable |
|---|---|---|---|---|
| 1 | Re-anchor entry to the newest same-side array when `|px-entry| > reanchor.atrMult×ATR15` (1.0) or the plan is invalidated; a dead plan is released so fix33/34/flip can write a new one | `fix1016.ts reanchorDecision`, build-desk (live pass before fix 33; shadow read at the end), brain book follows | shadow | yes (`reanchor.mode`) |
| 2 | AMD re-arm on a lower-high / higher-low retest into a live same-direction gap (frozen map + gaps printed this session, 5m–4h), close back through CE; `maxPerSide` 2 | `amdRetest`, `seq/amd-state.ts` (WATCH branch of the new-extreme rule) → `read.retest` | shadow (AMD itself is shadow too) | yes (`amdRetest.mode`, `zone` gap/gapHalf) |
| 3 | ltfArm promoted to the live plan when band ≥ B+, 1h/4h agree; watcher adds Brain TAKE same symbol+side (`fix1016:ltf_promote_brain` hard row) | `ltfPromote`, build-desk ltfArm plan loop, watcher `fix1016.ltf_promote_rows` | shadow (`shadow:fix1016:ltf_promote` would-fire row) | yes |
| 4 | Five-layer score (HTF context/bias+PD; liquidity; displacement/structure; entry array; risk/target) with sub-factors; old q kept beside it | `score5`, build-desk end block (`card.fix1016.score5 {total, old, delta, layers, sub}`) | shadow | yes (replaces q before re-seal) |
| 5 | Chase / late-entry from the current (re-anchored) array | `chaseFrom` / `chaseEntry`, discipline R3 | shadow | yes |
| 6 | Watcher fast window opens 09:25 ET; new hard `market_open` gate refuses any fire before 09:30 ET (appended after the fast chain / evFire so nothing softens it) | watcher `config.py`, `gates.evaluate_fire`, `fix1016.py` | **live** (no strategy change) | — |
| 7 | order_review_quote stale → extra refetch rounds (2 × 400 ms, ≤ 2.5 s) after the v5 tries; proceeds only on a fresh quote, then the existing chase check | watcher `daemon._review_quote_retry` | shadow (reads run, `review_quote_retry_shadow` logged, refusal unchanged) | yes |
| 8 | T1 partial (50 %) → stop to BE → runner to the next liquidity pool ≥ 2R | `runnerPlan` (card), watcher `fix1016.runner_manage` via `manage_action` | shadow (`shadow:fix1016:runner` WOULD rows) | yes |
| 10 | Exit-safety rev2 (Accuracy must-fix + Release Watch + should-fixes) | `docs/exit-safety-1016/watcher-exit-safety.patch`, TS twin `exit-safety.ts` | flags OFF (`EXIT_SAFE`, `EXIT_SAFE_RESTING_STOP`) | — |

Floor and Brain: both carry `fix1016Seat` (one note line from the top card's read — "would re-anchor …", "score5 x vs q y", "would promote", "runner → pool"); never a vote. When re-anchor goes live the brain's book plan on that symbol+side is rewritten with the card's new plan (desk/brain/Floor price one trade).

## Backtest hooks
`setFixOverrides({ item: { mode, ...params } })` (TS) / `fix1016.FX` (watcher) — backtests set values without editing the rules file.
Parameters: `reanchor.{atrMult,maxAgeMin,onInvalidated,replaceDeadPlan}`, `amdRetest.{maxPerSide,zone,tfs,closeBackThroughCe}`,
`ltfPromote.{minBand,requireBrainTake,requireHtfAgree}`, `score5.{weights,minRr,goodRr,chaseAtrZero}`, `reviewQuoteRetry.{rounds,roundDelayMs,maxTotalMs}`,
`runner.{t1PartialFrac,beAfterT1,minRunnerR}`, `watcherWindow.{fastStartEt,fireNotBeforeEt}`. Survivors from
`/workspace/audits/bt-13fixes-1016.md` / `week1016-review/` set the values and flip `mode` to `live` one item at a time.

## Proof that live fires are unchanged at the shadow default
- Watcher: `tools/replay_fix1016.py` replayed **7,718 cards (cards.log 10-13 → 10-16)** through v5 and through this patch:
  0 changed v5 rows (hash text normalised), dry would-fire 13 → 13, 0 decisions changed; with a full shadow `fix1016` read
  injected on every card: the same. Only new rows: `market_open` (all true — v5 never polled before 09:30) and `shadow:fix1016:*`.
- Desk: no fix1016 write to q/band/plan/entry outside a `mode === "live"` branch (source guard in `scripts/fix1016.test.mjs`);
  AMD replay of 10-16 NQ: shadow setups deep-equal the pre-fix machine; the shadow log catches the 08:46 CT lower high into the
  5m bear FVG 29940–29962.5 (post-mortem N3); live would re-arm and enter 29852.63.
