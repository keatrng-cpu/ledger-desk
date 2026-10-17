# Every-TF closes live + LTF inversion (2026-10-17)

**RULES_HASH 9eeed9b4083700cb → 0a692dc19944a8df.** It was 32d32bc808ccc4f4 at 00cd9954. The Accuracy Review and Release Watch NO-GO fixes moved the quote retry and ltfArm back to shadow. **Both stay shadow pending a desk replay and Keaton's OK.** Desk, Brain, Floor and the watcher change together:
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
| ltfArm plumbing, 1D rung added, `validatedOnly: true`. **Mode SHADOW** (Release Watch #52 NO-GO, pending a desk replay and Keaton's OK). | `ltf-arm.ts` (`ltfArmFireGate`), `scanner.ts` (`armApplies`), `build-desk.ts`. Watcher `ltf_arm_validated` HARD row, appended after the fast chain / evFire so nothing softens it. | shadow: arms are recorded on the card (`ltfArm`, `ltfArmShadow`) and never apply. If the mode goes live, an arm **applies** (components, entry/stop, extension release, T1 fallback, B+ cap) only for a validated setup id, and the list is empty. The `ltf_arm_validated` hard row and the desk `ltfArmGate` stay in place. |
| All-rung LTF kills (1m–4h), now behind their **own setting `ltfArm.allTfKills.mode`, default SHADOW**. Before this they were flipped by `ltfArm.mode`. | `mtf-context.ts` (`strictKillUnion`) | shadow: kills read 5m as before. The all-rung read is printed on the book (`ltfReversalsAllTfShadow`). The +0.02 q opposite-side boost per kill is unchanged. |
| Stale-quote soft path at order review (**SHADOW pending Keaton**, Accuracy Review #52; post-mortem 1016-short-postmortem.md:71 says the 10/16 refusal likely saved a loss) | watcher `daemon._review_quote_retry`, `fix1016.soft_review_pick`; rules `fix1016.reviewQuoteRetry` (shadow, rounds 4 × 400 ms, ≤ 2.5 s, `softMaxAgeS` 3) | shadow: the re-reads run and `review_quote_retry_shadow` logs would_pass / why / every re-read's age; any RH error, exception or empty read in the window makes the shadow verdict refuse. **Live is unchanged: strict 1 s (`fire.orderReviewMaxAgeS`) on desk and watcher**, plus a new watcher re-check of the quote age (1 s) right before `broker.buy`, mirroring the desk's `mayPlaceAfterReview`. |

## Proof that nothing loosened
- **Watcher replay of cards.log** (10,627 cards, 10/13–10/16), master vs patch (`tools/replay_every_tf.py`):
  - **0 shared rows changed** and 0 cards refused by master that pass on the patch.
  - New row `ltf_arm_validated` = True on all 10,627 (no card was LTF-armed).
  - With `ltfArmed` + a desk refusal injected on every card, `ltf_arm_validated` = False on all 10,627. Files: `diff2_default.json`, `diff2_armed.json`.
  - The replay is a dry gate replay with no broker and no order review. It does **not** exercise the order-review soft path; that path is covered only by the watcher unit tests.
- **Desk:**
  - An unvalidated arm never writes components, entry or stop, never releases the extension guard and never caps a card. This holds only while `fix1016.ltfPromote` stays shadow (see below).
  - `sanePlan`'s T1 fallback now applies only to LTF-armed cards. Source guards are in `scripts/every-tf.test.mjs`.
  - The truncation test of the every-TF read (later bars present vs absent) is identical at 4 cuts.

## Behaviour that does change
- **No live behaviour changes.** ltfArm, ltfArm.allTfKills and reviewQuoteRetry are all shadow. The only live additions are refusal-only: the watcher's `ltf_arm_validated` hard row and the pre-buy 1 s quote-age re-check.
- **Why ltfArm went back to shadow** (Release Watch #52): live ltfArm used to widen the mtf-context LTF kills from 5m to every rung from 1m to 4h. Each kill also adds +0.02 q to the opposite side, so about 115 side-minutes on the 8/31–10/16 tape could newly clear q 0.60. That is not a pure tightening (Release Watch count; not re-derived here, **unproven** by me). The all-rung kills now have their own setting (`ltfArm.allTfKills`, shadow), and ltfArm.mode no longer moves them.
- **If allTfKills goes live:** the all-rung read can only **add** kills. The 5m read keeps its exact kills, re-arm and governing read (alignment flip, both-sides rule), and the two reads are merged per side by `strictKillUnion`, so a side is free only when both reads leave it free. This fixes two Accuracy Review findings. First, the all-rung re-arm uses the newest kill's time (`rearmAfter(..., ks[0].t, ...)`), so a newer 1m kill could have made re-arming easier. Second, `ltfReversalOf` returns null when both sides are killed, so extra kills could have dropped the governing read. Extra kills still raise the opposite side's q by +0.02 each, so going live loosens the other side and needs the desk replay.
- **"No card is demoted or re-planned by an unvalidated arm" holds only while `fix1016.ltfPromote` stays shadow.** If ltfPromote goes live, it sets `ltfArmed` and writes the arm's plan onto the card (build-desk ltfPromote loop). validatedOnly then makes that card non-actionable, so a promoted card would be re-planned **and** refused.
- No live change at order review: the soft path is shadow, and the new pre-buy re-check only adds a refusal.

## Known, not fixed here
- **`mtf-arrays rung()` 4h buckets** are anchored to UTC epoch (20:00/00:00/04:00… ET), not to the Globex 18:00 open that `every-tf.ts` and Part A use. Changing it moves the live arrays and kills, which is unvalidated. Listed for a separate change.
- **Tests on this branch:** `npm test` 541/542. The one red test is `rules-parity` against the box's live, unpatched `/workspace/desk-watcher`; that is expected until the watcher patch is applied, and it passes with `WATCHER_DIR` set to the patched watcher. Watcher pytest: 662 passed, 3 skipped. The earlier note of 8 desk tests red on `main` was not re-checked after the box restore (**unproven** now).
