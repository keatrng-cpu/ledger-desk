---
type: community
cohesion: 0.04
members: 59
---

# news.ts

**Cohesion:** 0.04 - loosely connected
**Members:** 59 nodes

## Members
- [[4. Live positions are still unmanaged]] - document - INTEGRATION-B.md
- [[5. Hooks for B4 (alerts)  B5 (cron) — owned by another agent]] - document - INTEGRATION-B.md
- [[COVERAGE_MIN_DAYS]] - code - src/lib/trading/news.ts
- [[FlattenDecision]] - code - src/lib/trading/management.ts
- [[FlattenReason]] - code - src/lib/trading/management.ts
- [[KILLZONE_FLATTEN_LEAD_MIN]] - code - src/lib/trading/management.ts
- [[LIVE_CALENDAR_MAX_AGE_MIN]] - code - src/lib/trading/news.ts
- [[MANAGEMENT_BAR_MINUTES]] - code - src/lib/trading/management.ts
- [[MAX_BARS_IN_TRADE]] - code - src/lib/trading/management.ts
- [[MIN_HOLD_MINUTES]] - code - src/lib/trading/management.ts
- [[ManageContext]] - code - src/lib/trading/paper-manager.ts
- [[ManagedPosition]] - code - src/lib/trading/management.ts
- [[ManagementContext]] - code - src/lib/trading/management.ts
- [[NEWS_FLATTEN_LEAD_MIN]] - code - src/lib/trading/management.ts
- [[NewsEvent]] - code - src/lib/trading/news.ts
- [[NewsVerdict]] - code - src/lib/trading/news.ts
- [[PROGRESS_R]] - code - src/lib/trading/management.ts
- [[RELEASE_SLOTS_ET]] - code - src/lib/trading/news.ts
- [[RETARGET_MAX_TP2_R]] - code - src/lib/trading/management.ts
- [[RETARGET_MIN_TP1_R]] - code - src/lib/trading/management.ts
- [[RetargetResult]] - code - src/lib/trading/management.ts
- [[SESSION_END_FLATTEN_LEAD_MIN]] - code - src/lib/trading/management.ts
- [[SLOT_MIN_SIGHTINGS]] - code - src/lib/trading/news.ts
- [[calendarExhausted()]] - code - src/lib/trading/news.ts
- [[check()_21]] - code - scripts/verify-news-coverage.mjs
- [[clearLiveCalendar()]] - code - src/lib/trading/news.ts
- [[dayChangePct()]] - code - scripts/probe-closest.mjs
- [[dayChangePct()_1]] - code - scripts/trace-session.mjs
- [[dayKey()_5]] - code - scripts/probe-closest.mjs
- [[dayKey()_6]] - code - scripts/trace-session.mjs
- [[describeFlatten()]] - code - src/lib/trading/management.ts
- [[effectiveCalendar()]] - code - src/lib/trading/news.ts
- [[etDateOf()]] - code - src/lib/trading/news.ts
- [[ev()]] - code - scripts/verify-news-coverage.mjs
- [[flat()]] - code - src/lib/trading/management.ts
- [[history]] - code - scripts/probe-closest.mjs
- [[history_1]] - code - scripts/trace-session.mjs
- [[hm()]] - code - scripts/trace-session.mjs
- [[hold()]] - code - src/lib/trading/management.ts
- [[isNewsEvent()]] - code - src/lib/trading/news.ts
- [[live_3]] - code - scripts/verify-news-coverage.mjs
- [[liveCalendarState]] - code - src/lib/trading/news.ts
- [[liveRows]] - code - src/lib/trading/news.ts
- [[management.ts]] - code - src/lib/trading/management.ts
- [[minutesUntilKillzoneChange()]] - code - src/lib/trading/management.ts
- [[news.ts]] - code - src/lib/trading/news.ts
- [[newsRead]] - code - src/lib/trading/news.ts
- [[now_3]] - code - scripts/verify-news-coverage.mjs
- [[probe-closest.mjs]] - code - scripts/probe-closest.mjs
- [[progressRead()]] - code - src/lib/trading/management.ts
- [[releaseSlotNow()]] - code - src/lib/trading/news.ts
- [[releaseSlots()]] - code - src/lib/trading/news.ts
- [[resolveKillzone()]] - code - src/lib/trading/sessions.ts
- [[rows_7]] - code - scripts/probe-closest.mjs
- [[setLiveCalendar()]] - code - src/lib/trading/news.ts
- [[shouldFlatten()]] - code - src/lib/trading/management.ts
- [[top]] - code - scripts/probe-closest.mjs
- [[trace-session.mjs]] - code - scripts/trace-session.mjs
- [[verify-news-coverage.mjs]] - code - scripts/verify-news-coverage.mjs

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/newsts
SORT file.name ASC
```

## Connections to other communities
- 12 edges to [[_COMMUNITY_smc-master.ts]]
- 11 edges to [[_COMMUNITY_paper-manager.ts]]
- 10 edges to [[_COMMUNITY_detectors.ts]]
- 7 edges to [[_COMMUNITY_cases.ts]]
- 7 edges to [[_COMMUNITY_orchestrator.ts]]
- 7 edges to [[_COMMUNITY_room-engine.ts]]
- 5 edges to [[_COMMUNITY_tradingscanner.ts]]
- 4 edges to [[_COMMUNITY_OhlcBar]]
- 3 edges to [[_COMMUNITY_session-brief.ts]]
- 3 edges to [[_COMMUNITY_ghost-book.ts]]
- 2 edges to [[_COMMUNITY_build-desk.ts]]
- 2 edges to [[_COMMUNITY_jsonResponse]]
- 2 edges to [[_COMMUNITY_setup-chart.tsx]]
- 2 edges to [[_COMMUNITY_use-entry-state.ts]]
- 2 edges to [[_COMMUNITY_ref_node_fs]]
- 2 edges to [[_COMMUNITY_structure.ts]]
- 2 edges to [[_COMMUNITY_aplusconfig.ts]]
- 1 edge to [[_COMMUNITY_buildTradingDesk]]
- 1 edge to [[_COMMUNITY_tradovate-orders.ts]]
- 1 edge to [[_COMMUNITY_FloorOverhaul]]
- 1 edge to [[_COMMUNITY_floor-school-contracts.ts]]
- 1 edge to [[_COMMUNITY_verify-smc-master.mjs]]
- 1 edge to [[_COMMUNITY_invest-office.ts]]
- 1 edge to [[_COMMUNITY_live-world.ts]]
- 1 edge to [[_COMMUNITY_build-replay-drills.mjs]]
- 1 edge to [[_COMMUNITY_capture-signals.mjs]]
- 1 edge to [[_COMMUNITY_verify-replay-drills.mjs]]

## Top bridge nodes
- [[news.ts]] - degree 45, connects to 15 communities
- [[management.ts]] - degree 36, connects to 8 communities
- [[probe-closest.mjs]] - degree 16, connects to 8 communities
- [[newsRead]] - degree 19, connects to 7 communities
- [[trace-session.mjs]] - degree 14, connects to 7 communities