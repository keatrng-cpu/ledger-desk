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

Unchanged: velocity, entry distance, agree, band, caps and every other filter.

## Replay (`replay.py`, read-only on the desk-watcher gates.log 10/13 → 10/15 12:01 CT)
| Variant | Fires | Sum R |
|---|---|---|
| as-is (90s hold, resets) | 0 | 0 |
| **live: confirmPolls 2, max age 90s, geometry fix** | **2** | **+0.77** |
| confirmPolls 3 (sensitivity) | 1 | +0.33 |
