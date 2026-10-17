# Every-TF closes live + LTF inversion (2026-10-17)

**RULES_HASH 9eeed9b4083700cb → 32d32bc808ccc4f4.** Desk, Brain, Floor and the watcher change together:
the watcher fails closed (`rules_parity`) on a hash mismatch, so merge this PR and apply `watcher-every-tf.patch` in the same window.
**Depends on #51** (restore `src/lib/trading/week-ahead.ts`). On `main` @ 3c0f39b5 that file is not a module, so `npm run typecheck` is red with or without this branch.

## Part A (backtest): nothing passed, so no new setup is wired to fire
Full report: `/workspace/audits/mtf-ltf-inversion/README.md`. Covers NQ/ES from 2024-01 to 2026-10-16. Bars of 1, 2, 3, 4, 5, 15, 30, 60 and 240 minutes and 1D are all built from closed 1m bars.
- **Grid:** pre-declared in GRID.md (sha256 505cd012…), N = 4,693,248 trials, body vs wick variants included. Costs: 1 tick of slippage per side + $4.50 RT, at $250/R. The 0DTE option view is secondary.
- **Truncation test:** 0 violations over 339 decisions. The planted-leak control fails, so the test has power.
- **Holdout:** holdout_weeks.txt plus everything from 2026-10-01, read once at the end.
- **The live bar** (pre-declared): family walk-forward OOS $/wk > 0, and on the untouched holdout R/trade > 0, $/wk > 0 and n ≥ 20. **0 of 8 families pass.**
  - Families positive in walk-forward lose on the holdout (contL +$34/wk WF, then −0.20R / −$73/wk on 44 holdout trades).
  - Families positive on the holdout lose in walk-forward.
  - DSR ≤ 0.02. PBO is 0.57 on the main grid and 0.52 on the discounted-shorts grid.
- So `mtfInversion.validated = []`.

## What ships
| item | where | mode |
|---|---|---|
| Every-TF closed-bar read on 1m 2m 3m 4m 5m 15m 30m 1h 4h 1D. Each rung gets body, upper/lower wick (points and % of range), body/range, close location, body/ATR14, sweep wick-vs-body, iFVG body-vs-wick close (wick-to-wick and body-to-body FVGs) and MSS body-vs-wick. 4h/1D are anchored to the 18:00 ET Globex open. Buckets with holes are dropped, as in `rung()`. Facts only. | `src/lib/smc/every-tf.ts`. Carried as `card.everyTf` / `wire.strategy.everyTf`, plus the Brain/Floor `everyTfSeat` note. Watcher `every_tf` info row. | live (no gate reads it) |
| ltfArm live plumbing, 1D rung added, `validatedOnly: true` | `ltf-arm.ts` (`ltfArmFireGate`), `scanner.ts` (`armApplies`), `build-desk.ts`. Watcher `ltf_arm_validated` HARD row, appended after the fast chain / evFire so nothing softens it. | live. Arms are computed on every closed rung and carried on the card (`ltfArm`, `ltfArmRefused`, `ltfArmGate`). An arm **applies** (components, entry/stop, extension release, T1 fallback, B+ cap) only for a validated setup id. With an empty list no arm applies or fires, and no card is demoted or re-planned by one. |
| Stale-quote fix at order review | watcher `daemon._review_quote_retry`, `fix1016.soft_review_pick`. Rules `fix1016.reviewQuoteRetry` (live, rounds 4 × 400 ms, ≤ 2.5 s, `softMaxAgeS` 3). | live. Strict 1 s first. Then fresh re-reads inside the window. A soft pass needs: youngest re-read ≤ 3 s (capped at `fire.quoteMaxAgeS`), ask > 0, not crossed, ≥ 2 genuine re-reads each ≤ 3 s, and a moving quote stamp. Otherwise fail closed. The chase check and every other gate still run after it. |

## Proof that nothing loosened
- **Watcher replay of cards.log** (10,627 cards, 10/13–10/16), master vs patch (`tools/replay_every_tf.py`):
  - **0 shared rows changed** and 0 cards refused by master that pass on the patch.
  - New row `ltf_arm_validated` = True on all 10,627 (no card was LTF-armed).
  - With `ltfArmed` + a desk refusal injected on every card, `ltf_arm_validated` = False on all 10,627. Files: `diff2_default.json`, `diff2_armed.json`.
- **Desk:**
  - An unvalidated arm never writes components, entry or stop, never releases the extension guard and never caps a card.
  - `sanePlan`'s T1 fallback now applies only to LTF-armed cards. Source guards are in `scripts/every-tf.test.mjs`.
  - The truncation test of the every-TF read (later bars present vs absent) is identical at 4 cuts.

## Behaviour that does change
- **ltfArm mode live** switches `mtf-context` IFVG kills from 5m-only to every rung (`allTf`). This only adds kills, so it is a tightening.
- **The stale-quote soft pass:** the 10/16 NQ case (an RH stamp 1.3–2.2 s old on every fresh read) now passes review if the stamp moves. A frozen stamp, a quote > 3 s old, a crossed quote or a single re-read still refuses.

## Known, not fixed here
- **`mtf-arrays rung()` 4h buckets** are anchored to UTC epoch (20:00/00:00/04:00… ET), not to the Globex 18:00 open that `every-tf.ts` and Part A use. Changing it moves the live arrays and kills, which is unvalidated. Listed for a separate change.
- **8 desk tests are red on `main`** before this branch, and still red after: batch1, deep-audit, floor-overhaul, options-desk-cap, rule1-lane, smc-shared, fix1016 wire note, and RH gate quote ages. One watcher test is red on master (`test_gates_log_parity`, cards.log replay).
