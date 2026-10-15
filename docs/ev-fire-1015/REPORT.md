# evFire: EV fire path, shadow-only (2026-10-15 CT)

Everything ships **OFF** (`evFire.mode = "off"`, and the `ltfSoft`, `qRawOnce` and `dropCrossedStop` sub-flags are off too; `timing.mode` stays `shadow`). With the flags off, desk and watcher behaviour is unchanged.

## Verdict
**+0.33R/trade is not reachable robustly.** The design's +12.8R (39 trades) came from leaky calibration: it was leave-one-day-out over all 20 days, counted "R > 0" as a hit, and left RR uncapped. Here is what happens under the spec:
- Proper T1-hit calibration with RR uncapped: +0.2R in sample.
- With RR capped at 4: +14.4R in sample (n 34). That number is in-sample only.
- **Walk-forward** (calibrate on one half, test on the other, both directions): **no (threshold, q floor) cell is positive in both halves, and the B+ subset is negative in every cell.**

## Walk-forward grid (out of sample; R in full-size units, with sub-B+ fires weighted 0.5 for the $325 probe)
Halves: H1 is 09-17 to 09-30, H2 is 10-01 to 10-14. The current desk on the same engine: n 12, win 50%, +0.02 avgR, +0.19R total, max DD −4.63R (H1 −2.44R, H2 +2.63R).

| threshold / q floor | test H2 (cal H1) | test H1 (cal H2) | OOS n | win | avgR | totR | added losers | maxDD | B+ subset |
|---|---|---|---|---|---|---|---|---|---|
| 0.00 / 0.45 | 18 / −1.82 | 18 / +6.28 | 36 | 50% | +0.12 | +4.46 | 9 | −4.44 | 6 / −2.6 |
| 0.05 / 0.45 | 17 / −2.39 | 18 / +5.99 | 35 | 49% | +0.10 | +3.61 | 9 | −4.99 | 6 / −2.6 |
| **0.10 / 0.45 (plateau centre)** | 17 / −2.39 | 17 / +5.71 | 34 | 47% | +0.10 | +3.32 | 9 | −4.99 | 6 / −2.6 |
| 0.15 / 0.45 (design) | 17 / −4.06 | 17 / +5.71 | 34 | 44% | +0.05 | +1.64 | 10 | −5.95 | 5 / −4.21 |
| 0.15 / 0.50 | 9 / −4.90 | 7 / +0.44 | 16 | 38% | −0.28 | −4.46 | 5 | −7.35 | 8 / −5.02 |
| 0.20 / 0.45 | 17 / −3.78 | 15 / −1.15 | 32 | 44% | −0.15 | −4.93 | 10 | −6.56 | 5 / −4.21 |

The full 8×6 grid is in `wf.json`. The plateau is thresholds 0.00–0.15 at q floor ≤ 0.45, worth about +1.6 to +4.5R OOS. It collapses at q floor ≥ 0.48 and at threshold ≥ 0.20, so the q-floor fragility is still there. Every cell fails the "both halves positive" and "B+ not negative" criteria. **Recommendation: keep it shadow-only and judge it on the go/no-go rule after ≥ 20 live shadow days.**

## Today (CT, live gates.log, table trained on all 20 days)
| time | card | q | RR | p (calibrated) | EV_R | EV path |
|---|---|---|---|---|---|---|
| 08:30:16 | MNQ short B+ | 0.6499 | 2.50 | 0.14 | −0.60 | **no fire** (p is low for q 0.60–0.65 / rungs < 5) |
| 08:40:02 | MNQ short A- | 0.6699 | 3.33 | 0.55 | +1.30 | **no fire**: fast:entry (px 180 pts from entry, limit about 28) |
| 08:55:00 | MNQ short C | 0.4999 | 8.42 | 0.24 | +0.11 | **no fire**: EV < 0.15 and fast:entry |

## What is implemented (all flag-gated)
1. `ltfSoft`: the LTF kill's C cap becomes a B cap, lifted when displacement on the card's side is ≥ 0.6 (build-desk).
2. Chase (item 2) uses the existing `timing.mode` flag (`live` = chase no longer cuts q). Flip it together with evFire.
3. `qRaw0` is recorded once before R3/seal. `qRawOnce` live makes sealBand report it. The calibrated hit rate is shown as `wire.floor.ev` / `strategy.ev.p`. The table lives in `shared/ev-calibration.json`, its hash is pinned in the rules, and an untrained table or wrong hash means refuse. `scripts/ev-calibrate.mjs` rebuilds it (nightly job not installed).
4. EV path: `src/lib/desk/ev-fire.ts` and `watcher/evfire.py` (parity tested). `shadow:ev:fire` rows; paper brackets go to `shadow_ev.jsonl`. Live mode would replace band/persist/velocity with the EV hold and add a hard `ev:size` row ($650 at B+ and above, $325 below). Every other hard gate and cap is unchanged. There is a brain_ev_veto when the brain is on the opposite side.
5. A 20s per-`symbol:side` hold that survives card flips. It resets on a crossed stop, an opposite-side pass, or an EV fail on that key.
6. `dropCrossedStop` in the card builder. fast:entry now prints `|px-entry| = d <= limit (0.5xATR atr)` (an unconditional log-text fix).

The watcher is not in this repo: its diff is `watcher.patch`, built and tested in a copy, never started.
**Merge note:** the rules change also changes RULES_HASH, so the live watcher's rules_parity row fails until the watcher copy is updated in a maintenance window.
