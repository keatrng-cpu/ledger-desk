---
type: community
cohesion: 0.04
members: 78
---

# OhlcBar

**Cohesion:** 0.04 - loosely connected
**Members:** 78 nodes

## Members
- [[BacktestLayers]] - code - src/lib/market/databento.ts
- [[BookSide]] - code - src/lib/trading/ticket-facts.ts
- [[BuildPlanInput]] - code - src/lib/trading/trade-plan.ts
- [[CardState]] - code - src/lib/trading/card-freshness.ts
- [[CardTape]] - code - src/components/desk/setup-scanner.tsx
- [[DrawSide]] - code - src/lib/trading/draw.ts
- [[ELAPSED_1]] - code - scripts/measure-target-odds.mjs
- [[EntryRead_1]] - code - src/lib/trading/entry-trigger.ts
- [[Expectancy_1]] - code - src/lib/trading/target-odds.ts
- [[FactCondition]] - code - src/lib/trading/ticket-facts.ts
- [[Freshness]] - code - src/lib/trading/card-freshness.ts
- [[KIND_WEIGHT]] - code - src/lib/trading/draw.ts
- [[LiquidityTarget]] - code - src/lib/trading/draw.ts
- [[LtfLead]] - code - src/lib/trading/ltf-lead.ts
- [[LtfReaction]] - code - src/lib/trading/ltf-reaction.ts
- [[MIN_SESSIONS_FOR_BASE_RATE]] - code - src/lib/trading/draw.ts
- [[MIN_SESSIONS_FOR_ODDS]] - code - src/lib/trading/target-odds.ts
- [[OhlcBar_1]] - code - src/lib/market/types.ts
- [[PlanLevel]] - code - src/lib/trading/trade-plan.ts
- [[PlanSide]] - code - src/lib/trading/trade-plan.ts
- [[PlanWorth]] - code - src/lib/trading/trade-plan.ts
- [[RUNGS]] - code - src/lib/trading/ltf-lead.ts
- [[R_MULTIPLES]] - code - scripts/measure-target-odds.mjs
- [[RaceResult]] - code - src/lib/trading/target-odds.ts
- [[RawLevel]] - code - src/lib/trading/draw.ts
- [[Rung]] - code - src/lib/trading/ltf-lead.ts
- [[STRUCT_STOP_ATR]] - code - src/lib/trading/trade-plan.ts
- [[SessionSlice]] - code - src/lib/trading/draw.ts
- [[THIN_SESSIONS]] - code - src/lib/trading/target-odds.ts
- [[TIER_GONE_ATR]] - code - src/lib/trading/entry-trigger.ts
- [[UNDERLIER_OF]] - code - src/lib/trading/ticket-facts.ts
- [[atrOf()]] - code - src/lib/trading/draw.ts
- [[barsFromPrints()]] - code - src/lib/market/print-bars.ts
- [[bestRung()]] - code - src/lib/trading/ltf-lead.ts
- [[biasAlignment()]] - code - src/lib/trading/draw.ts
- [[buildTradePlan()]] - code - src/lib/trading/trade-plan.ts
- [[candidateFor()]] - code - src/lib/trading/ticket-facts.ts
- [[candidateLevels()]] - code - src/lib/trading/draw.ts
- [[card-freshness.ts]] - code - src/lib/trading/card-freshness.ts
- [[counterOf()]] - code - src/lib/trading/ticket-facts.ts
- [[draw.ts]] - code - src/lib/trading/draw.ts
- [[drawOnLiquidity()]] - code - src/lib/trading/draw.ts
- [[drawSideStale()]] - code - src/lib/trading/card-freshness.ts
- [[elapsedFractionOf()]] - code - src/lib/trading/trade-plan.ts
- [[empiricalReachRate()]] - code - src/lib/trading/draw.ts
- [[etSessionKey()]] - code - src/lib/trading/structure.ts
- [[expectedR()]] - code - src/lib/trading/target-odds.ts
- [[fourFacts]] - code - src/lib/trading/ticket-facts.ts
- [[groupSessions()]] - code - src/lib/trading/draw.ts
- [[hist_6]] - code - scripts/measure-target-odds.mjs
- [[inverseAt()]] - code - src/lib/trading/ltf-lead.ts
- [[liquidity()]] - code - src/lib/trading/ltf-lead.ts
- [[ltf-lead.ts]] - code - src/lib/trading/ltf-lead.ts
- [[maxRiskFor()]] - code - src/lib/trading/trade-plan.ts
- [[maxRiskPtsFor()]] - code - src/lib/trading/simulate-path-trade.ts
- [[measure-target-odds.mjs]] - code - scripts/measure-target-odds.mjs
- [[median()_2]] - code - src/lib/trading/draw.ts
- [[medianOf()]] - code - src/lib/trading/trade-plan.ts
- [[mergeCoincident()]] - code - src/lib/trading/draw.ts
- [[planEntryText()]] - code - src/lib/trading/trade-plan.ts
- [[poolName()]] - code - src/lib/trading/ticket-facts.ts
- [[poolTouchBoost()]] - code - src/lib/trading/draw.ts
- [[priceWorth()]] - code - src/lib/trading/trade-plan.ts
- [[print-bars.ts]] - code - src/lib/market/print-bars.ts
- [[printCount()]] - code - src/lib/market/print-bars.ts
- [[prints_1]] - code - src/lib/market/print-bars.ts
- [[raceOdds()]] - code - src/lib/trading/target-odds.ts
- [[readLtfLead()]] - code - src/lib/trading/ltf-lead.ts
- [[remainingExcursions()]] - code - src/lib/trading/draw.ts
- [[round2()_6]] - code - src/lib/trading/draw.ts
- [[round2()_7]] - code - src/lib/trading/trade-plan.ts
- [[runnerWorthIt()]] - code - src/lib/trading/target-odds.ts
- [[symbolOf()]] - code - src/lib/trading/ltf-lead.ts
- [[symbols_3]] - code - scripts/measure-target-odds.mjs
- [[target-odds.ts]] - code - src/lib/trading/target-odds.ts
- [[targetOdds]] - code - src/lib/trading/target-odds.ts
- [[ticket-facts.ts]] - code - src/lib/trading/ticket-facts.ts
- [[trade-plan.ts]] - code - src/lib/trading/trade-plan.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/OhlcBar
SORT file.name ASC
```

## Connections to other communities
- 24 edges to [[_COMMUNITY_build-desk.ts]]
- 21 edges to [[_COMMUNITY_cn]]
- 19 edges to [[_COMMUNITY_detectors.ts]]
- 18 edges to [[_COMMUNITY_tradingscanner.ts]]
- 17 edges to [[_COMMUNITY_smc-master.ts]]
- 10 edges to [[_COMMUNITY_index.tsx]]
- 10 edges to [[_COMMUNITY_live-world.ts]]
- 9 edges to [[_COMMUNITY_buildTradingDesk]]
- 8 edges to [[_COMMUNITY_structure.ts]]
- 7 edges to [[_COMMUNITY_cases.ts]]
- 7 edges to [[_COMMUNITY_simulate-path-trade.ts]]
- 6 edges to [[_COMMUNITY_entry-trigger.ts]]
- 6 edges to [[_COMMUNITY_sleeve-sizing.ts]]
- 5 edges to [[_COMMUNITY_chart-timeframes.ts]]
- 5 edges to [[_COMMUNITY_react]]
- 4 edges to [[_COMMUNITY_news.ts]]
- 4 edges to [[_COMMUNITY_candlestick-pane.tsx]]
- 4 edges to [[_COMMUNITY_paper-manager.ts]]
- 4 edges to [[_COMMUNITY_live-lesson.ts]]
- 3 edges to [[_COMMUNITY_SmcMasterBook]]
- 3 edges to [[_COMMUNITY_veteran-brain.ts]]
- 3 edges to [[_COMMUNITY_aplusconfig.ts]]
- 2 edges to [[_COMMUNITY_tf-ladder.ts]]
- 2 edges to [[_COMMUNITY_spot-cross.ts]]
- 2 edges to [[_COMMUNITY_session-brief.ts]]
- 2 edges to [[_COMMUNITY_SmcArray]]
- 2 edges to [[_COMMUNITY_floor-screens.ts]]
- 2 edges to [[_COMMUNITY_session-backtest.ts]]
- 2 edges to [[_COMMUNITY_databento.ts]]
- 2 edges to [[_COMMUNITY_smcdiscipline.ts]]
- 2 edges to [[_COMMUNITY_shock.ts]]
- 2 edges to [[_COMMUNITY_setup-chart.tsx]]
- 2 edges to [[_COMMUNITY_room-engine.ts]]
- 2 edges to [[_COMMUNITY_setup-chart-panel.tsx]]
- 2 edges to [[_COMMUNITY_verify-target-odds.mjs]]
- 2 edges to [[_COMMUNITY_verify-card-freshness.mjs]]
- 2 edges to [[_COMMUNITY_curriculum.ts]]
- 2 edges to [[_COMMUNITY_build-hit-odds.mjs]]
- 2 edges to [[_COMMUNITY_build-replay-drills.mjs]]
- 1 edge to [[_COMMUNITY_tf-ladder-panel.tsx]]
- 1 edge to [[_COMMUNITY_learn-tab.tsx]]
- 1 edge to [[_COMMUNITY_learning.ts]]
- 1 edge to [[_COMMUNITY_day-context.ts]]
- 1 edge to [[_COMMUNITY_measure-loss-patterns.mts]]
- 1 edge to [[_COMMUNITY_ghost-book.ts]]
- 1 edge to [[_COMMUNITY_hi-alert.ts]]
- 1 edge to [[_COMMUNITY_month-ahead.ts]]
- 1 edge to [[_COMMUNITY_shadow-book.ts]]
- 1 edge to [[_COMMUNITY_week-ahead.ts]]
- 1 edge to [[_COMMUNITY_ROADMAP v2 — from a desk that helps if you look to a desk that runs]]
- 1 edge to [[_COMMUNITY_verify-smc-master.mjs]]
- 1 edge to [[_COMMUNITY_rh-autofire.ts]]
- 1 edge to [[_COMMUNITY_capture-signals.mjs]]
- 1 edge to [[_COMMUNITY_verify-live-lesson.mjs]]
- 1 edge to [[_COMMUNITY_verify-entry-alarm.mjs]]
- 1 edge to [[_COMMUNITY_setup-memory.ts]]
- 1 edge to [[_COMMUNITY_verify-replay-drills.mjs]]
- 1 edge to [[_COMMUNITY_render-setup-chart.mjs]]
- 1 edge to [[_COMMUNITY_ref_node_fs]]
- 1 edge to [[_COMMUNITY_replay-drill.ts]]
- 1 edge to [[_COMMUNITY_options-desk.ts]]
- 1 edge to [[_COMMUNITY_verify-trade-plan.mjs]]

## Top bridge nodes
- [[OhlcBar_1]] - degree 82, connects to 34 communities
- [[trade-plan.ts]] - degree 57, connects to 23 communities
- [[draw.ts]] - degree 57, connects to 18 communities
- [[ticket-facts.ts]] - degree 39, connects to 14 communities
- [[fourFacts]] - degree 18, connects to 8 communities