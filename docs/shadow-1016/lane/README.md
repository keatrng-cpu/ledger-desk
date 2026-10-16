# Rule 1: SHADOW fire lane, persist-exempt (overnight-1016 item 2)

**Mode: SHADOW.** Rule 1 tickets come from a closed 5m bar, so their lane is exempt from the fast:persist hold. Today the watcher **logs when the lane WOULD fire and with what latency**. Nothing fires. The live fast chain, gates and RH order path are unchanged. **RULES_HASH stays `a4bfcb65c88badcd`**: the config is in `shared/rule1-lane.json`, outside the rules file, and a test asserts the hash.

| unit | what it gets |
|---|---|
| Desk | `src/lib/trading/rule1-lane.ts`. `build-desk` stamps each `rule1[]` ticket with `lane = {lane:"rule1", mode:"shadow", live:false, persistExempt, barCloseAt, builtAt, ageS, closedBar, stale, wouldFire, why}`. |
| Brain / Floor | The lane rides the same ticket objects: `wire.rule1[].lane` on the card, `MasterInput.rule1[].lane` for the brain seat (tested), and `DeskPayload.rule1[].lane` for the Floor's `readDeskForRoom`. No new display line, because that would touch the files the Δ0.7 PR owns. |
| Watcher | `watcher-lane.patch` adds `watcher/rule1_lane.py` plus one hook in `daemon._rule1_shadow`. The first poll that sees a ticket writes one `rule1_lane_would_fire` row to `rule1_lane_shadow.jsonl`. Each row has `would_fire`, `latency_s` (bar close → lane decision), `card_build_s`, `watcher_recv_s`, `legacy_min_latency_s` (+ the 20 s fast:persist hold), `legacy_observed_latency_s` (+ the 96 s the 10/15 live fire spent), `broker:false`, `orders:0`, `live:false`. The dedupe survives restarts, and the STOP file is respected. The module does not import any order code. The patch is NOT applied to the live watcher. |

## Validation (`validate_lane.py`, closed bars, all TFs 30s–1D) → `validation.md`
- Measured lane latency (cards.log, read-only): p50 4.4 s, p90 10.5 s. The legacy paths are p50 + 20 s and p50 + 96 s.
- The desk Rule 1 set (716 tickets, 2019 to 2026-10-15) has +0.117R with entry at the displacement close.
- Lane at p50: −0.001R. Legacy observed (≈100 s): −0.016R. 10/15 live fire (124 s): −0.018R.
- So the exemption is worth about **+0.015R per trade** here. The report estimated +0.04R on its own event set, which has a higher baseline R.
