# unblock-2-1015 (stacked on #22 `fix/fire-bugs-live-1015` be9ba9d2)

LIVE changes Keaton approved at 12:36 CT on 10/15. They apply to the desk (`src/lib/execution/fast-chain.ts`), the brain and Floor (both read `shared/desk-rules.json` → fastChain), and the watcher (`watcher.patch`, applied on top of #22's `watcher.patch`). rulesHash goes from **9c7a0478b4f910be** (#22) to **cfe75bee47cc5982**. The TS and Python hashes are identical.

## 1) The 2-trade daily entry cap is deleted
- `fastChain.dailyEntryCap.mode` = "off". `entries_day` comes off `fastChain.hard`, and the watcher row always passes. It still logs the count.
- These stay as they are: the $150 / 15% daily loss cap (`fireFix.dayLoss`), the −$300 weekly lock (`weekly.lossLock`), the $650 debit cap, and `second_entry_band` (entry #2 or later needs ≥ A). That last one is a band rule, not a count cap, so it was left alone. Say so if it should go too.
- **Re-fire:** Accuracy found that in #22 a setup could fire again after a stop or a T1 touch. The 15-minute `fast:refire` guard that was first drafted here has been **dropped**. This branch relies on #22's fix instead: a setup id is **spent for the session** after a fire, a stop, or a T1 touch. This branch must be rebased onto the #22 SHA that carries that fix.
- **10/15 08:33:33 CT MNQ short re-entry:** the 08:30 fire (entry 29771.13) touched T1 and then exited at breakeven at 08:33. The 08:33:33 re-entry has the same setup id, so it is **blocked** (spent). That avoids #22's −1.00R / −$140 stop at 08:39.

## 2) Grade smoothing (`fastChain.gradeSmoothing`). The edges are unchanged: A+ 0.75, A 0.68, A- 0.65, B+ 0.60
- A card counts as B+ in either case:
  - it was ≥ B+ on 2 of the last 3 real polls for that symbol and side, or
  - its q is within 0.01 below 0.60 and rising against the previous poll.
- A smoothed card sizes on the B+ rung. Smoothing only ever lifts a card to B+, never to A-/A/A+.
- **ES 10/15 10:01–10:02 CT long, entry 7757.75:**
  - These polls now count as B+: 10:01:21 (q .5991 rising), 10:01:31 (.5999 rising), and 10:02:02 (B .5999 after three B+ polls).
  - The card still **does not fire**, because of `fast:entry`. Price was 7764.75–7767.25, which is 7.0–9.5 points from entry against a 0.5×ATR limit of 7.55. Only 10:02:27 was inside the zone, and that was a single poll (confirmPolls needs 2 in a row). Nothing in the approved changes touches the entry gate.

## 3) HTF agree (`fastChain.htfReversal`)
- When 1h and 4h both oppose, the trade is allowed if the LTF shows a confirmed reversal: `strategy.sweep` true AND (`displacement` true OR `choch`/`mss` true), with the band (or smoothed band) ≥ B+. The trade runs at ×0.5 size, in whole contracts, minimum 1.
- If the legacy htf size cut has already halved the caps, it is not halved a second time.
- With no reversal evidence, the block stays. The brain-opposite block does not change.
- **10/15 09:58 CT MNQ A- long:** the card had sweep=true, displacement=true and regime=reversal, so `fast:agree` now passes. The 09:58:xx polls still fail `fast:entry` (px 29962 vs entry 29880.5, 0.5×ATR = 48.7). In the replay, the same reversal leg fires earlier, at **09:45:11 CT** (A- long, entry 29869.63, fill 29909.5, 1ct at half size). It is still open at the end of the log (+1.13R marked, about +$265), so it is **not realized**.

## 4) Live lesson 10/15 13:02–13:05 CT (ES long B+ q 0.6499, sig-85e8feddd99efe46, SPY 770C, stopped at 13:04:55 for −$36)
**(a) New hard row `fast:ifvg` (`fastChain.ifvgAgainst`)**
- This runs on the desk (`fast-chain.ts` via `src/lib/smc/ifvg-flip.ts`), in the brain and Floor (shared rules) and in the watcher (`fastchain.ifvg_against`).
- A long is blocked when either of these is true:
  - a 5m/15m bull FVG was closed through, i.e. a wire `ifvg` dir bear, not failed, ≤ 3 bars old;
  - the live price is below the bottom of a bull FVG formed within the last 12 bars, meaning the forming bar is inverting it.
- The same rule is mirrored for shorts.
- **13:02:02:** px 7784.0 was under the 5m bull FVG 7785.25–7786.25, so the long is **BLOCKED**. The closed-bar iFVG appeared only at 13:05:12, after the stop. That is why the forming-bar clause is needed.

**(b) The HTF-opposed half-size path now needs confirmed reversal evidence**
- `htfReversal.anyOppose` = true. One opposing 1h/4h is no longer a plain size cut. It needs sweep AND (displacement OR CHoCH) and band ≥ B+, never q alone. Otherwise it is blocked.
- **13:02:** 4h was bear, sweep=true, displacement=false, no CHoCH, so the trade is **BLOCKED** a second way.

**(c) Cause of the T1 jump**
- `card-plan.ts primaryTarget()` handed the card's first target to **T2** whenever T1's R:R dropped under 1.0.
- As price ran from 7782.63 to 7784, the R:R to T1 went to 0.92 (the watcher's bplus_caution logged "RR 0.92"). `wire.strategy.target` then became T2 7874.25, which is 12.0R.
- The fix:
  - T1 always stays the first target. A T1 under 1R is left to the R:R gate (fast:plan), never silently promoted.
  - The wire now also carries `strategy.t1`, and the watcher's `first_target` reads `t1` first.
- The watcher fired and managed on 7792.25. Only the card/Floor view showed 7874.25.

**iFVG flip in the card generator (`fastChain.ifvgFlip`, `scanner.ts` + `build-desk.ts`)**
- A fresh 5m/15m inversion generates or upgrades the other side's card (both sides are always scanner candidates):
  - it adds the `ifvg` component, plus `displacement` when the inverting body is ≥ 1×ATR;
  - entry is the iFVG CE retest;
  - stop is beyond the far edge plus 0.1×ATR(rung), and is then widened by `sanePlan` to ≥ 0.5×ATR15;
  - T1/T2 are the next real pools at ≥ 1R. If there is no pool, there is no plan.
- The band still comes from q, with edges unchanged.

**Test case 13:00–13:10 CT** (`case_1300.mjs` → `case_1300.json`; 1m bars built from the watcher's ~5 s live prints)

| CT | px | long fast:ifvg | iFVG-flip short |
|---|---|---|---|
| 13:00–13:01 | 7787.25 / 7786 | ok | none |
| 13:02–13:04 | 7781.25–7777.75 | **BLOCK** (5m bull FVG being inverted, forming bar) | none (not closed yet) |
| 13:05–13:10 | 7775.75–7774 | **BLOCK** (5m bull FVG 7779.75–7783.25 closed through) | **5m iFVG 7779.75–7783.25, entry 7781.5 (CE), stop 7783.71, T1 prior RTH high 7759.5, inverting body 2.51×ATR** |

- **Is it B+?** This cannot be verified offline. The q comes from the full scanner (draws, SMT, bias, killzone, profit path), and the ES short candidate's q is not on the wire.
- The flip adds `ifvg` (weight 8) and `displacement` (weight 4). That is about +0.11–0.12 q on the 0–1 scale, if both were missing.
- The short reaches B+ only if its base q was ≥ ~0.48. The 13:05 short candidate's base q is not logged, so check this on the live desk's next inversion. The stop also widens to ≥ 0.5×ATR15 (about 5.2 points), which makes R:R to 7759.5 about 4.2R.

## Replay 10/13 → 10/15 ~13:10 CT (`replay_unblock2.py` → `replay-unblock2-results.json`)
- This uses #22's quote-series outcome model and 0DTE Black-Scholes pricing.
- The #22 spent-for-session fix, `fast:ifvg` and the any-oppose HTF rule are all modelled.
- Contracts are whole contracts within the $650 debit, capped by the grade ladder A+4/A2/A-1/B+1, then the velocity cut, then the htf half.

| Time CT | Sym | Side | Band | Card entry / fill | Outcome | R | ct | 0DTE $ | ct / $ (#22 method) |
|---|---|---|---|---|---|---|---|---|---|
| 10/14 09:03:57 | MNQ | short | B+ | 30569.25 / 30529.5 | T1+T2 (10:08) | +1.17 | 1 | +$79 | 2 / +$257 |
| 10/15 08:30:21 | MNQ | short | B+ | 29771.13 / 29746.5 | T1 then BE (08:33) | +0.42 | 1 | +$49 | 4 / +$87 |
| 10/15 08:33:33 | MNQ | short | | (same setup) | blocked: spent | – | – | – | |
| 10/15 08:56:47 | MNQ | short | B+ | 29681.13 / 29664.25 | stop (09:01) | −1.00 | 1 | −$80 | 2 / −$160 |
| 10/15 09:40:14 | MNQ | short | B+ | 29877.38 / 29849.25 | stop (09:43) | −1.00 | 1 | −$82 | 2 / −$164 |
| 10/15 09:45:11 | MNQ | long | A- (htf half, sweep+disp) | 29869.63 / 29909.5 | **still open at 13:10, marked** | +0.40 | 1 | +$32 | 1 / +$32 |
| 10/15 13:02:02 | ES | long | B+ | 7782.63 / 7784.0 | **blocked: fast:ifvg + fast:agree** (it was also inside the open 09:45 position) | (live: stop, −1.00R, −$36) | – | – | |
| **Total** | | | | | | **−0.01R** | | **−$2** | **+$52** |

| Variant | Fires | Sum R | $ (ladder) | $ (#22 method) |
|---|---|---|---|---|
| #22 as first shipped (cap 2, no spent fix) | 3 | +0.59 | +$81 | +$204 |
| #22 + spent fix (cap 2) | 3 | +0.59 | +$48 | +$184 |
| **unblock-2 (all, + 13:02 lesson)** | **5** | **−0.01** | **−$2** | **+$52** |
| unblock-2 without the spent fix | 6 | −1.01 | −$49 | −$88 |

- In this replay, deleting the cap adds two −1R MNQ shorts (08:56 and 09:40). The HTF-reversal long gave back most of its mark, from +1.13R at 12:45 to +0.40R at 13:10.
- On this 2.5-session sample, unblock-2 is **not** better than #22. It is too small a sample to judge either way (see phase 2, `audits/optimize-1015/report.md`).

## Rebased onto #22 d2053f43 (spent fix) — 13:20 CT
rulesHash cfe75bee47cc5982. Replay 10/13–10/15: unblock-2 5 fires, +0.04R, +$9 ladder (+$63 #22 method; 09:45 long open, marked +0.45R);
#22 + spent fix 3 fires, +0.59R, +$48. 08:33 re-entry blocked (setup spent). Watcher patch regenerated vs the new #22 watcher base.

## Read-priority: desk vs watcher (Accuracy CHANGES)
- Desk: scanner `readPriorityKill` (src/lib/trading/read-priority.ts) kills the flipped side to C on a tracked card via `qWrite(c, "pathBand", "C", "cap:readPriority")`, so capReasons attributes it; a killed A+/A/A- grade reads B (`demoteGrade`, also used by the ltfArm cap).
- Watcher: mirrored as a FIRE BLOCK, not a band write: `fast:ifvg` fails via `fastchain.ifvg_against` -> `read_flipped` (readPriority live, minGaps 2, any band). Same effect: no fire on the flipped side. `fastchain.read_priority_hit` feeds a once-per-signal `cap` log row with `source: "cap:readPriority"`.
- Fixture: scripts/fixtures/es1m_1015.json (ES 1m 08:30-13:14 CT from audits/postmortem-1302/ES_1m.pkl); the 13:03 CT test in scripts/flip-targets-1015.test.mjs is no longer skipped.
