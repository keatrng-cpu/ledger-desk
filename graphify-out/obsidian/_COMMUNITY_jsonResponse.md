---
type: community
cohesion: 0.11
members: 61
---

# jsonResponse

**Cohesion:** 0.11 - loosely connected
**Members:** 61 nodes

## Members
- [[3 · build-desk checklist risk item + scanner suppression]] - document - INTEGRATION-P1.md
- [[CronAuthResult]] - code - src/lib/alerts/cron.ts
- [[CronRunResult]] - code - src/lib/alerts/cron.ts
- [[EMPTY_3]] - code - src/lib/alerts/cron-stats-server.ts
- [[HaltBanner()]] - code - src/components/journal/halt-banner.tsx
- [[KILLZONE_WINDOWS]] - code - src/lib/journal/risk.ts
- [[KillzoneId]] - code - src/lib/trading/sessions.ts
- [[ModeStats]] - code - src/lib/alerts/cron-stats-server.ts
- [[RiskState]] - code - src/lib/journal/risk.ts
- [[SessionJobResult]] - code - src/lib/alerts/trigger-server.ts
- [[SessionSegment]] - code - src/lib/room/floor-props.ts
- [[StatsRow]] - code - src/lib/alerts/cron-stats-server.ts
- [[What shipped_1]] - document - INTEGRATION-P1.md
- [[authorizeCronRequest()]] - code - src/lib/alerts/cron.ts
- [[checkScheduledJobs]] - code - src/lib/alerts/trigger-server.ts
- [[checklist.ts]] - code - src/routes/api/cron/checklist.ts
- [[computeLiveRiskState()]] - code - src/lib/journal/server.ts
- [[computeRiskFlags()]] - code - src/lib/journal/risk.ts
- [[cron-stats-server.ts]] - code - src/lib/alerts/cron-stats-server.ts
- [[cron.ts]] - code - src/lib/alerts/cron.ts
- [[cronSecret()]] - code - src/lib/alerts/cron.ts
- [[cronUserId()]] - code - src/lib/alerts/cron.ts
- [[currentKillzoneWindow()]] - code - src/lib/journal/risk.ts
- [[envValue()_1]] - code - src/lib/alerts/cron.ts
- [[etDateParts()]] - code - src/lib/journal/risk.ts
- [[etOffsetMs()_1]] - code - src/lib/journal/risk.ts
- [[etParts()]] - code - src/lib/trading/sessions.ts
- [[etWallToUtc()]] - code - src/lib/journal/risk.ts
- [[etWindow_1]] - code - src/lib/alerts/cron.ts
- [[exec-flatten.ts]] - code - src/routes/api/cron/exec-flatten.ts
- [[fmtR()_1]] - code - src/lib/alerts/cron-stats-server.ts
- [[fmtWr()]] - code - src/lib/alerts/cron-stats-server.ts
- [[getSessionClock()]] - code - src/lib/trading/sessions.ts
- [[halt-banner.tsx]] - code - src/components/journal/halt-banner.tsx
- [[handle()_2]] - code - src/routes/api/cron/exec-flatten.ts
- [[handle()_3]] - code - src/routes/api/cron/rh-manage.ts
- [[handleChecklist()]] - code - src/routes/api/cron/checklist.ts
- [[handleHandoff()]] - code - src/routes/api/desk/handoff.ts
- [[handleReview()]] - code - src/routes/api/cron/review.ts
- [[handleWeekly()]] - code - src/routes/api/cron/weekly.ts
- [[handoff.ts]] - code - src/routes/api/desk/handoff.ts
- [[isForced()]] - code - src/lib/alerts/cron.ts
- [[jsonResponse()]] - code - src/lib/bridge/auth-server.ts
- [[newsBlackoutInput]] - code - src/lib/alerts/trigger-server.ts
- [[pad2()_3]] - code - src/lib/alerts/cron.ts
- [[positionFlattenedInput]] - code - src/lib/alerts/trigger-server.ts
- [[review.ts]] - code - src/routes/api/cron/review.ts
- [[risk.ts]] - code - src/lib/journal/risk.ts
- [[run()_3]] - code - src/routes/api/cron/rh-manage.ts
- [[runChecklist()]] - code - src/lib/alerts/trigger-server.ts
- [[runReview()]] - code - src/lib/alerts/trigger-server.ts
- [[runWeekly()]] - code - src/lib/alerts/trigger-server.ts
- [[safetyNetDue()]] - code - src/lib/room/exec/safety-net.ts
- [[secureEquals()]] - code - src/lib/alerts/cron.ts
- [[setupArmedInput]] - code - src/lib/alerts/trigger-server.ts
- [[src_lib_alerts_cron_jsonresponse]] - concept
- [[tradingDayStart()]] - code - src/lib/journal/risk.ts
- [[tradingWeekStart()]] - code - src/lib/journal/risk.ts
- [[trigger-server.ts]] - code - src/lib/alerts/trigger-server.ts
- [[weekly.ts]] - code - src/routes/api/cron/weekly.ts
- [[windowStats]] - code - src/lib/alerts/cron-stats-server.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/jsonResponse
SORT file.name ASC
```

## Connections to other communities
- 22 edges to [[_COMMUNITY_room-engine.ts]]
- 21 edges to [[_COMMUNITY_send-server.ts]]
- 19 edges to [[_COMMUNITY_routeTree.gen.ts]]
- 15 edges to [[_COMMUNITY_rh-dispatch.ts]]
- 13 edges to [[_COMMUNITY_journalserver.ts]]
- 10 edges to [[_COMMUNITY_getSql]]
- 10 edges to [[_COMMUNITY_apideskfast.ts]]
- 9 edges to [[_COMMUNITY_veteran-brain.ts]]
- 9 edges to [[_COMMUNITY_orchestrator.ts]]
- 8 edges to [[_COMMUNITY_paper-manager.ts]]
- 7 edges to [[_COMMUNITY_index.tsx]]
- 7 edges to [[_COMMUNITY_schema.ts]]
- 6 edges to [[_COMMUNITY_execStep]]
- 5 edges to [[_COMMUNITY_aplusconfig.ts]]
- 5 edges to [[_COMMUNITY_buildTradingDesk]]
- 4 edges to [[_COMMUNITY_ghost-book.ts]]
- 4 edges to [[_COMMUNITY_rh-mcp.ts]]
- 4 edges to [[_COMMUNITY_@tanstackreact-start]]
- 3 edges to [[_COMMUNITY_cases.ts]]
- 3 edges to [[_COMMUNITY_verify-paper-step.mjs]]
- 3 edges to [[_COMMUNITY_rh-oauth.ts]]
- 3 edges to [[_COMMUNITY_tradovate-orders.ts]]
- 3 edges to [[_COMMUNITY_build-desk.ts]]
- 3 edges to [[_COMMUNITY_executor.ts]]
- 3 edges to [[_COMMUNITY_options-swing-panel.tsx]]
- 2 edges to [[_COMMUNITY_floor-school-contracts.ts]]
- 2 edges to [[_COMMUNITY_news.ts]]
- 2 edges to [[_COMMUNITY_structure.ts]]
- 2 edges to [[_COMMUNITY_session-backtest.ts]]
- 2 edges to [[_COMMUNITY_INTEGRATION-P1 — Journal + active risk governor]]
- 1 edge to [[_COMMUNITY_smc-master.ts]]
- 1 edge to [[_COMMUNITY_mead-screens.ts]]
- 1 edge to [[_COMMUNITY_rh-autofire.ts]]
- 1 edge to [[_COMMUNITY_react]]

## Top bridge nodes
- [[risk.ts]] - degree 30, connects to 10 communities
- [[getSessionClock()]] - degree 22, connects to 10 communities
- [[exec-flatten.ts]] - degree 25, connects to 8 communities
- [[cron.ts]] - degree 30, connects to 7 communities
- [[run()_3]] - degree 18, connects to 7 communities