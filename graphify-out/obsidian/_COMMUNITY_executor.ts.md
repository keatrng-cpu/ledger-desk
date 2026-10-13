---
type: community
cohesion: 0.11
members: 30
---

# executor.ts

**Cohesion:** 0.11 - loosely connected
**Members:** 30 nodes

## Members
- [[dot-byClientId()]] - code - src/lib/room/exec/types.ts
- [[dot-cancel()]] - code - src/lib/room/exec/types.ts
- [[dot-get()]] - code - src/lib/room/exec/types.ts
- [[dot-openOrders()]] - code - src/lib/room/exec/types.ts
- [[dot-positions()]] - code - src/lib/room/exec/types.ts
- [[dot-quote()]] - code - src/lib/room/exec/types.ts
- [[dot-submit()]] - code - src/lib/room/exec/types.ts
- [[BrokerAccount]] - code - src/lib/room/exec/types.ts
- [[BrokerPosition]] - code - src/lib/room/exec/types.ts
- [[BrokerQuote]] - code - src/lib/room/exec/types.ts
- [[DesiredPosition]] - code - src/lib/room/exec/intent.ts
- [[ExecDeps]] - code - src/lib/room/exec/executor.ts
- [[ExecFlags]] - code - src/lib/room/exec/limits.ts
- [[ExecLimits]] - code - src/lib/room/exec/limits.ts
- [[GateCtx]] - code - src/lib/room/exec/gates.ts
- [[OptionsBroker]] - code - src/lib/room/exec/types.ts
- [[OrderIntent]] - code - src/lib/room/exec/types.ts
- [[OrderRole]] - code - src/lib/room/exec/types.ts
- [[PATCHABLE]] - code - src/lib/room/exec/exec-sql.ts
- [[PHASES]] - code - src/lib/room/exec/types.ts
- [[Query]] - code - src/lib/room/exec/exec-sql.ts
- [[RowStatus]] - code - src/lib/room/exec/types.ts
- [[StepRequest]] - code - src/lib/room/exec/executor.ts
- [[TERMINAL_STATUS]] - code - src/lib/room/exec/types.ts
- [[checkRun()]] - code - src/lib/room/exec/gates.ts
- [[exec-sql.ts]] - code - src/lib/room/exec/exec-sql.ts
- [[exectypes.ts]] - code - src/lib/room/exec/types.ts
- [[executor.ts]] - code - src/lib/room/exec/executor.ts
- [[msg()]] - code - src/lib/room/exec/executor.ts
- [[rowPatchFromBroker()]] - code - src/lib/room/exec/executor.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/executorts
SORT file.name ASC
```

## Connections to other communities
- 19 edges to [[_COMMUNITY_execStep]]
- 19 edges to [[_COMMUNITY_exec-server.ts]]
- 14 edges to [[_COMMUNITY_gates.ts]]
- 8 edges to [[_COMMUNITY_intent.ts]]
- 7 edges to [[_COMMUNITY_alpaca.ts]]
- 3 edges to [[_COMMUNITY_exec-card.tsx]]
- 3 edges to [[_COMMUNITY_jsonResponse]]
- 3 edges to [[_COMMUNITY_room-engine.ts]]
- 3 edges to [[_COMMUNITY_rh-autofire.ts]]
- 2 edges to [[_COMMUNITY_getSql]]
- 2 edges to [[_COMMUNITY_verify-room-exec.mjs]]
- 1 edge to [[_COMMUNITY_sqlLedger]]
- 1 edge to [[_COMMUNITY_live-world.ts]]
- 1 edge to [[_COMMUNITY_meeting.ts]]
- 1 edge to [[_COMMUNITY_rh-dispatch.ts]]
- 1 edge to [[_COMMUNITY_orchestrator.ts]]

## Top bridge nodes
- [[executor.ts]] - degree 51, connects to 13 communities
- [[exec-sql.ts]] - degree 25, connects to 7 communities
- [[exectypes.ts]] - degree 21, connects to 6 communities
- [[OrderIntent]] - degree 7, connects to 3 communities
- [[BrokerPosition]] - degree 6, connects to 3 communities