---
type: community
cohesion: 0.08
members: 53
---

# manager-live-loop.ts

**Cohesion:** 0.08 - loosely connected
**Members:** 53 nodes

## Members
- [[2026-10-06 — Merge path and standing guards]] - document - ai/DECISIONS.md
- [[Agent send path (user-Robinhood-xai)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Arm  confirmation]] - document - docs/RH_LIVE_ROUTINE.md
- [[Armed (2026-10-07)]] - document - docs/RH_LIVE_ROUTINE.md
- [[B+ explicit gate (Accuracy + Keaton 2026-10-06) — `evaluateRhBplusGate`]] - document - docs/RH_LIVE_ROUTINE.md
- [[Buying-power hard gate (Keaton 2026-10-06)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Circuit breaker (2026-10-07)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Code]] - document - docs/RH_LIVE_ROUTINE.md
- [[Do not]] - document - docs/RH_LIVE_ROUTINE.md
- [[Done this session (each has a test; the count is the list)]] - document - docs/TOOLING_PLAN.md
- [[Floor rules on the RH path (`evaluateRhFloorRules`, fail closed)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Follow-ups (not in this commit)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Live constraints]] - document - ai/NOW.md
- [[RH_LIVE_ROUTINE]] - document - docs/RH_LIVE_ROUTINE.md
- [[RhAutofireCandidate]] - code - src/lib/execution/rh-autofire-gates.ts
- [[RhLiveOptionQuote]] - code - src/lib/execution/rh-autofire.ts
- [[RhPathFireTrigger]] - code - src/lib/execution/rh-autofire.ts
- [[Risk envelope (Keaton 2026-10-06)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Robinhood live options routine (live-when-armed)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Session checklist]] - document - docs/RH_LIVE_ROUTINE.md
- [[The cycle (Keaton 2026-10-07)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Trigger model (Keaton 2026-10-06)]] - document - docs/RH_LIVE_ROUTINE.md
- [[Triple agreement (all required)]] - document - docs/RH_LIVE_ROUTINE.md
- [[buildRhReviewPlaceShape()]] - code - src/lib/execution/rh-autofire.ts
- [[candidateFromFloorPathStand()]] - code - src/lib/execution/rh-autofire.ts
- [[evaluateRhAutofireGates()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[evaluateRhBandSize()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[evaluateRhBplusGate()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[evaluateRhBuyingPower()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[evaluateRhCircuitBreaker()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[evaluateRhFloorRules()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[evaluateRhLiveQuote()]] - code - src/lib/execution/rh-autofire.ts
- [[evaluateRhTicketEnvelope()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[fireBand()]] - code - src/lib/alerts/path-alarm.ts
- [[isBplusBand()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[isPathFire()]] - code - src/lib/alerts/path-alarm.ts
- [[manager-live-loop.ts]] - code - src/lib/room/manager-live-loop.ts
- [[managerAgreeFromRoom()]] - code - src/lib/room/manager-room-feed.ts
- [[managerLoopReadout()]] - code - src/lib/room/manager-live-loop.ts
- [[mayPlaceAfterReview()]] - code - src/lib/execution/rh-autofire.ts
- [[normOffset()]] - code - src/lib/room/manager-room-feed.ts
- [[normalizeOffset()]] - code - src/lib/execution/rh-autofire-gates.ts
- [[proposeRhFromManagerFeed()]] - code - src/lib/room/manager-live-loop.ts
- [[proposeRhFromPathFire()]] - code - src/lib/execution/rh-autofire.ts
- [[proposeRhLiveOption()]] - code - src/lib/execution/rh-autofire.ts
- [[rhAutofireFlagsFromEnv()]] - code - src/lib/execution/rh-autofire.ts
- [[rhCandidateFromManagerFeed()]] - code - src/lib/room/manager-live-loop.ts
- [[src_lib_execution_rh_autofire_rhaccountsnapshot]] - concept
- [[src_lib_execution_rh_autofire_rhautofirecandidate]] - concept
- [[src_lib_execution_rh_autofire_rhautofireflags]] - concept
- [[src_lib_execution_rh_autofire_rhautofiregateresult]] - concept
- [[ticketFromManagerState()]] - code - src/lib/room/manager-live-loop.ts
- [[ticketFromRhCard()]] - code - src/lib/execution/rh-autofire.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/manager-live-loopts
SORT file.name ASC
```

## Connections to other communities
- 51 edges to [[_COMMUNITY_rh-autofire.ts]]
- 15 edges to [[_COMMUNITY_rh-dispatch.ts]]
- 14 edges to [[_COMMUNITY_manager-feed.ts]]
- 7 edges to [[_COMMUNITY_react]]
- 7 edges to [[_COMMUNITY_meeting.ts]]
- 5 edges to [[_COMMUNITY_trading-floor-tab.tsx]]
- 3 edges to [[_COMMUNITY_school-brief.ts]]
- 3 edges to [[_COMMUNITY_smc-master.ts]]
- 3 edges to [[_COMMUNITY_live-world.ts]]
- 3 edges to [[_COMMUNITY_verify-rh-cycle.mjs]]
- 2 edges to [[_COMMUNITY_aplusconfig.ts]]
- 2 edges to [[_COMMUNITY_memory.py]]
- 2 edges to [[_COMMUNITY_build-desk.ts]]
- 2 edges to [[_COMMUNITY_cn]]
- 2 edges to [[_COMMUNITY_Log]]
- 1 edge to [[_COMMUNITY_2. SHARED CONTRACTS]]
- 1 edge to [[_COMMUNITY_dot-constructor]]
- 1 edge to [[_COMMUNITY_veteran-brain.ts]]
- 1 edge to [[_COMMUNITY_selfcheck.py]]
- 1 edge to [[_COMMUNITY_evaluateOptionsDesk]]
- 1 edge to [[_COMMUNITY_rhread.py]]
- 1 edge to [[_COMMUNITY_use-entry-state.ts]]
- 1 edge to [[_COMMUNITY_options-desk.ts]]
- 1 edge to [[_COMMUNITY_hi-alert.ts]]
- 1 edge to [[_COMMUNITY_getSql]]
- 1 edge to [[_COMMUNITY_verify-no-bot-entry.mjs]]
- 1 edge to [[_COMMUNITY_tradingscanner.ts]]

## Top bridge nodes
- [[manager-live-loop.ts]] - degree 55, connects to 15 communities
- [[isPathFire()]] - degree 16, connects to 7 communities
- [[evaluateRhBplusGate()]] - degree 12, connects to 3 communities
- [[Done this session (each has a test; the count is the list)]] - degree 6, connects to 3 communities
- [[Robinhood live options routine (live-when-armed)]] - degree 14, connects to 2 communities