# SHADOW push path: card update → watcher (overnight-1016 item 3)

**Mode: SHADOW, off by default.** The desk exposes `GET /api/desk/card-stream`, an SSE stream that sends one `card` event per new card. It returns 404 unless the site sets `DESK_PUSH_SHADOW=1`. The watcher listener is a background thread that starts only when the box sets `DESK_PUSH_SHADOW=1`. It **measures and logs latency only**: push events never reach gates or firing. **RULES_HASH stays `a4bfcb65c88badcd`**: the config is in `shared/push-shadow.json`, outside the rules file, and a test asserts the hash.

| unit | what it gets |
|---|---|
| Desk | `src/lib/desk/push-shadow.ts` and `src/routes/api/desk/card-stream.ts` (the route is registered in `routeTree.gen.ts`). `wire.latency = {mode:"shadow", barCloseAt, builtAt, buildMs, targetS:10}` is added to every card. |
| Brain / Floor | Both read the same card/wire, so `wire.latency` and the SSE frames (`at, pushedAt, rulesHash, latency, rule1, strategy, live:false`) reach them with no new seat logic. |
| Watcher | `watcher-push.patch` adds `watcher/push_shadow.py` plus three daemon hooks: the listener starts in `run()`, the poll path records `poll_card`, and the push path records `push_card`. Rows go to `push_shadow.jsonl` with `build_s`, `transit_s`, `bar_to_decision_s`, `under_target`, and, for each Rule 1 ticket, `would_decide_s`. Every row has `broker:false`, `orders:0`, `live:false`. Push vs poll can be compared per card `at`. The listener reconnects with back-off and never raises. The patch is NOT applied to the live watcher. |

## Validation (`validate_push.py`) → `validation.md`
- Poll, measured (bar close → decision): p50 4.7 s, p90 10.5 s, 89% under 10 s.
- Push, modelled (build + 0.25 s re-read + 0.5 s network): p50 3.7 s, p90 9.4 s, 92% under 10 s.
- Desk build alone: p50 2.9 s, p90 8.6 s. The build dominates and push does not change it.
- R gain at these latencies is under 0.001R per trade. The big latency cut is the persist exemption in PR "rule1-lane", not push.
- Real push numbers come from `push_shadow.jsonl` once both flags are on.
