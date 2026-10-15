# fire-bugs-live-1015

Live fix for the two bugs that stopped the desk firing (audit `audits/fire-fail-1015/report.md`). The desk (`src/lib/execution/fast-chain.ts`) and the watcher (`watcher/fastchain.py`, `watcher.patch`) change together.

## fast:persist: the hold timer is removed (Keaton, 10/15)
- The old behaviour: a 90s hold, keyed `symbol:side`, that any failing evaluation reset, including a sibling card. It passed 0 of 5,007 times.
- The new behaviour: the card fires the first time it is fully actionable, provided the **same setup id** (`symbol:side:entry`) passed on `fastChain.confirmPolls` = 2 **consecutive real polls**. This is an anti-flicker check with no seconds timer. Re-reading the same card does not count as a new poll.
- A setup more than `fastChain.maxActionableAgeS` = 90s past the moment it first became actionable, and never fired, is **stale** and does not fire.
- A failing poll or a sibling card breaks the consecutive count. It does not reset the setup's age.
- The setup is reset on invalidation (price through the stop, T1 touched, or `strategy.invalidated`) and on a side change on the same symbol.
- `fastChain.minHoldS` is removed.
- `fireFix.persistGrace` (shadow) is no longer called from `streak_next`. The rules key is left in place.

## fast:geometry
- A desk Floor ticket on another underlying or in the other direction is another setup. It is **ignored** and noted in the reason text instead of refusing; for example, a QQQ put against an MNQ/ES long card.
- A T2 that is not beyond T1 is treated as **no T2** (managed at T1 and 2×T1) instead of rejecting the card.
- Real level-order checks still refuse: stop/entry/T1, the management stop, and the traded ticket.

## fast:velocity is now a size cut (Keaton, 10/15)
- `fastChain.velocity`: `mode` = "size", `cutMult` = 0.5, `minSizeBeyondCapX` = 2.
- If the T1 ETA is over the 30m cap, the contracts are halved (whole contracts, minimum 1).
- If the ETA is over 60m, or unknown, the trade uses the minimum size (1 contract).
- The cut never raises size above what the band and the $650 debit cap allow.
- `fast:velocity` is removed from `fastChain.hard`, and the row becomes `soft:fast:velocity`.
- In the watcher, the cut is applied to the `sizing` row, and the fire path reads the leading count.
- The cut does not re-check the `min_debit` floor, because Keaton asked for a minimum of 1 whole contract.

## Entry re-arm (Keaton, 10/15)
- `fastChain.entryRearm.mode` = "live".
- When fast:entry fails because price is more than 0.5×ATR from entry, the setup is kept alive.
- When price pulls back inside the zone, with the stop and T1 untouched and the band still ≥ B+, the setup becomes actionable again. At that point the 90s staleness clock and confirmPolls restart.

Unchanged hard gates: band, real stop/targets, entry distance (as the actionable condition), agree, tape/feed freshness, rules hash/pin, and the daily/weekly caps. Brain stays soft.

## Replay of the final config (`replay_live.py` → `replay-live-results.json`)
| Time CT | Sym | Side | Card entry / fill | Outcome | R | ct (full) | 0DTE $ |
|---|---|---|---|---|---|---|---|
| 10/14 09:03:57 | MNQ | short | 30569.25 / 30529.5 | T1+T2 (10:08) | +1.17 | 2 (4), ETA 31.8m | +$257 |
| 10/15 08:30:21 | MNQ | short | 29771.13 / 29746.5 | T1 then BE (08:33) | +0.42 | 4 | +$87 |
| 10/15 08:33:33 | MNQ | short | 29771.13 / 29764.75 (after the T1-touch reset) | stop (08:39) | −1.00 | 3 | −$140 |
| **Total** | | | | | **+0.59R** | | **+$204** |

## Earlier replay (`replay.py`; no-timer config, before the velocity/re-arm changes, read-only on the desk-watcher gates.log 10/13 → 10/15 12:01 CT)
| Variant | Fires | Sum R |
|---|---|---|
| as-is (90s hold, resets) | 0 | 0 |
| **live: confirmPolls 2, max age 90s, geometry fix** | **2** | **+0.77** |
| confirmPolls 3 (sensitivity) | 1 | +0.33 |
