# 10/15 PM: flip T1 from the full pool list, desk T1 freeze, persist + STAND fixes (on #24)
rulesHash **c40b5555966491f3** unchanged (desk `shared/desk-rules.json` and watcher copy (now merged into `/workspace/desk-watcher`)): every new number is a code constant.

## 1. Read-priority flip T1 (`src/lib/smc/ifvg-flip.ts` `scannerPools` + `flipTargets`, wired in `scanner.ts`)
Flip target selection now gets the session pools **plus** unswept 1m/5m swing lows/highs, EQL/EQH clusters (>= 2 pivots within max(0.5, 0.1xATR5m)) and unmitigated, not-closed-through opposite 5m/15m FVGs. Side-aware: shorts draw on lows/EQL/bull-FVG tops, longs on highs/EQH/bear-FVG bottoms.
10/15 13:03:05 CT ES case (`case_readprio.mjs`): short entry 7781.75, stop 7786.76, **T1 EQL 7775.25 (1.30R)** (was: no T1). Fast rows plan/geometry/ifvg/agree/entry pass -> fireable. 13:05+ inversion short: T1 1m swing low 7772 (4.37R).

## 2. Desk T1 freeze (`src/lib/trading/t1-freeze.ts`, wired in `build-desk.ts` after sanePlan)
Keyed by the fast-chain setupId. First armed/fired poll with a real T1 freezes it; later polls force plan.t1/rr1 back (a different fresh T1 is only noted). Un-armed + not fired releases; fired holds for the session; per ET day.

## 3. Persist + STAND (desk `fast-chain.ts` and watcher twin `watcher.patch`)
- fast:persist: clock starts at the first qualifying card (never "held Nones"). A-+ with a fresh sweep/displacement fires on the next poll (2 passes, no hold). Otherwise 2 passes and >= 20 s. Stale after 90 s.
- brain STAND: -0.03 q, not a veto. STAND plus the iFVG flip against the side still blocks fast:agree. A non-STAND brain on the other side still blocks.
- Live note: `/workspace/desk-watcher` runs rules_hash 647c5ff4b8c3454c, which is old code with the 90 s hold timer and velocity/desk-ticket hard blocks. None of the #22/#24 fixes reach live until that watcher is redeployed (not done here).

Replay 10/15 (`replay_persist.py`, shipped F1+F3+F5+F12): base 4 fires +0.14R +$352 opt; +persist 2 / +0.60R / +$392; +STAND 4 / +0.64R / +$380; both 2 / +1.15R / +$425. The open 09:45/09:50 MNQ long holds the one-position slot for the rest of the day. Per-card table: `cards_1015.py` -> `cards_1015.json`.
