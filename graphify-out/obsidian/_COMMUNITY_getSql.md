---
type: community
cohesion: 0.06
members: 54
---

# getSql

**Cohesion:** 0.06 - loosely connected
**Members:** 54 nodes

## Members
- [[A4 — the dead second paper engine is gone]] - document - INTEGRATION-A.md
- [[BridgeStatusError]] - code - src/lib/bridge/paper-server.ts
- [[BridgeStatusPayload]] - code - src/lib/bridge/paper-server.ts
- [[Database (server-only)]] - document - .grok/skills/neon/SKILL.md
- [[Env vars — do not create a `.env` file]] - document - .grok/skills/neon/SKILL.md
- [[Migrations]] - document - .grok/skills/neon/SKILL.md
- [[NOTE this is the SERVER book. The desk UI's `listOpenPaperTrades` is a]] - rationale - src/lib/bridge/paper-server.ts
- [[Neon Postgres]] - document - .grok/skills/neon/SKILL.md
- [[OpenPaperTrade]] - code - src/lib/bridge/paper-server.ts
- [[PAPER_MODE]] - code - src/lib/bridge/paper-server.ts
- [[PaperTradeRow]] - code - src/lib/bridge/paper-server.ts
- [[Preview ↔ production parity]] - document - .grok/skills/neon/SKILL.md
- [[RUNTIME_URL_VARS]] - code - src/lib/db.ts
- [[Run]] - code - src/lib/db.ts
- [[Sql]] - code - src/lib/db.ts
- [[StorageHealth]] - code - src/lib/journal/storage-health.ts
- [[cmd, arg]] - code - scripts/calibration.mts
- [[asDesk()]] - code - src/lib/execution/rh-server.ts
- [[asManager()]] - code - src/lib/execution/rh-server.ts
- [[cache_2]] - code - src/lib/execution/rh-ledger.ts
- [[calibration.mts]] - code - scripts/calibration.mts
- [[countEngineEventsToday()]] - code - src/lib/bridge/ingest-server.ts
- [[createNeonSql()]] - code - src/lib/db.ts
- [[createPgliteSql()]] - code - src/lib/db.ts
- [[createSql()]] - code - src/lib/db.ts
- [[databaseUrlVar]] - code - src/lib/db.ts
- [[db.ts]] - code - src/lib/db.ts
- [[dbSource]] - code - src/lib/db.ts
- [[ensureDbReady()]] - code - src/lib/db.ts
- [[firstConfigured()]] - code - src/lib/db.ts
- [[getBridgeStatus]] - code - src/lib/bridge/paper-server.ts
- [[getChainHealth]] - code - src/lib/journal/attest-fn.ts
- [[getPglite()]] - code - src/lib/db.ts
- [[getSql()]] - code - src/lib/db.ts
- [[globalBoot]] - code - src/lib/db.ts
- [[globalRef]] - code - src/lib/db.ts
- [[identity()]] - code - src/lib/db.ts
- [[isServerless()]] - code - src/lib/db.ts
- [[listOpenPaperTrades]] - code - src/lib/bridge/paper-server.ts
- [[neonSKILL]] - document - .grok/skills/neon/SKILL.md
- [[num()_9]] - code - src/lib/bridge/paper-server.ts
- [[paper-server.ts]] - code - src/lib/bridge/paper-server.ts
- [[pg_1]] - code - pg
- [[readEngineStatus()]] - code - src/lib/bridge/ingest-server.ts
- [[resolved]] - code - src/lib/db.ts
- [[rh-ledger.ts]] - code - src/lib/execution/rh-ledger.ts
- [[rh-server.ts]] - code - src/lib/execution/rh-server.ts
- [[rhLinkStatus]] - code - src/lib/execution/rh-server.ts
- [[rows_12]] - code - scripts/calibration.mts
- [[setPaperEnabled()]] - code - src/lib/bridge/ingest-server.ts
- [[stepRhDesk]] - code - src/lib/execution/rh-server.ts
- [[storage-health.ts]] - code - src/lib/journal/storage-health.ts
- [[toSql()]] - code - src/lib/db.ts
- [[togglePaperMode]] - code - src/lib/bridge/paper-server.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/getSql
SORT file.name ASC
```

## Connections to other communities
- 22 edges to [[_COMMUNITY_@tanstackreact-start]]
- 12 edges to [[_COMMUNITY_rh-dispatch.ts]]
- 12 edges to [[_COMMUNITY_journalserver.ts]]
- 10 edges to [[_COMMUNITY_jsonResponse]]
- 10 edges to [[_COMMUNITY_room-engine.ts]]
- 9 edges to [[_COMMUNITY_paper-backfill.ts]]
- 9 edges to [[_COMMUNITY_tradovate-orders.ts]]
- 8 edges to [[_COMMUNITY_rh-oauth.ts]]
- 8 edges to [[_COMMUNITY_schema.ts]]
- 7 edges to [[_COMMUNITY_send-server.ts]]
- 6 edges to [[_COMMUNITY_cn]]
- 6 edges to [[_COMMUNITY_grok-report.ts]]
- 6 edges to [[_COMMUNITY_apideskfast.ts]]
- 5 edges to [[_COMMUNITY_card-journal.ts]]
- 5 edges to [[_COMMUNITY_analytics-panel.tsx]]
- 5 edges to [[_COMMUNITY_build-desk.ts]]
- 5 edges to [[_COMMUNITY_claude-server.ts]]
- 4 edges to [[_COMMUNITY_rh-mcp.ts]]
- 4 edges to [[_COMMUNITY_alertsserver.ts]]
- 4 edges to [[_COMMUNITY_snapshot-review.tsx]]
- 4 edges to [[_COMMUNITY_rh-autofire.ts]]
- 3 edges to [[_COMMUNITY_learning.ts]]
- 3 edges to [[_COMMUNITY_attest.ts]]
- 3 edges to [[_COMMUNITY_authclient.ts]]
- 3 edges to [[_COMMUNITY_buildTradingDesk]]
- 3 edges to [[_COMMUNITY_exec-server.ts]]
- 3 edges to [[_COMMUNITY_authserver.ts]]
- 3 edges to [[_COMMUNITY_dual-index-charts.tsx]]
- 3 edges to [[_COMMUNITY_ingest.ts]]
- 3 edges to [[_COMMUNITY_index.tsx]]
- 3 edges to [[_COMMUNITY_exec-card.tsx]]
- 3 edges to [[_COMMUNITY_use-entry-state.ts]]
- 3 edges to [[_COMMUNITY_verify-rh-desk-job.mjs]]
- 2 edges to [[_COMMUNITY_tradingscanner.ts]]
- 2 edges to [[_COMMUNITY_smcdiscipline.ts]]
- 2 edges to [[_COMMUNITY_manager-feed.ts]]
- 2 edges to [[_COMMUNITY_store.ts]]
- 2 edges to [[_COMMUNITY_snapshot.ts]]
- 2 edges to [[_COMMUNITY_shadow-store.ts]]
- 2 edges to [[_COMMUNITY_dot-path]]
- 2 edges to [[_COMMUNITY_sqlLedger]]
- 2 edges to [[_COMMUNITY_routeTree.gen.ts]]
- 2 edges to [[_COMMUNITY_executor.ts]]
- 1 edge to [[_COMMUNITY_2. SHARED CONTRACTS]]
- 1 edge to [[_COMMUNITY_render-mead-attachments.mjs]]
- 1 edge to [[_COMMUNITY_ref_node_url]]
- 1 edge to [[_COMMUNITY_LazyPGliteDriver]]
- 1 edge to [[_COMMUNITY_react]]
- 1 edge to [[_COMMUNITY_aplusconfig.ts]]
- 1 edge to [[_COMMUNITY_paper-manager.ts]]
- 1 edge to [[_COMMUNITY_order-intent.ts]]
- 1 edge to [[_COMMUNITY_ref_node_fs]]
- 1 edge to [[_COMMUNITY_ref_node_path]]
- 1 edge to [[_COMMUNITY_manager-live-loop.ts]]

## Top bridge nodes
- [[db.ts]] - degree 82, connects to 27 communities
- [[getSql()]] - degree 94, connects to 22 communities
- [[Sql]] - degree 16, connects to 12 communities
- [[rh-server.ts]] - degree 24, connects to 11 communities
- [[rh-ledger.ts]] - degree 25, connects to 10 communities