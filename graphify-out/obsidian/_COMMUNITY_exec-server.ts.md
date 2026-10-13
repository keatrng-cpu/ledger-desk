---
type: community
cohesion: 0.16
members: 30
---

# exec-server.ts

**Cohesion:** 0.16 - loosely connected
**Members:** 30 nodes

## Members
- [[BridgeHooks]] - code - src/components/room/exec-bridge.ts
- [[EXEC_FLAGS]] - code - src/lib/room/exec/limits.ts
- [[EXEC_LIMITS]] - code - src/lib/room/exec/limits.ts
- [[Evidence]] - code - src/lib/room/exec/gates.ts
- [[ExecStatus]] - code - src/lib/room/exec/exec-server.ts
- [[ExecUi]] - code - src/components/room/exec-bridge.ts
- [[LIVE_EVIDENCE]] - code - src/lib/room/exec/limits.ts
- [[StepResult]] - code - src/lib/room/exec/executor.ts
- [[Void]] - code - src/lib/room/exec/executor.ts
- [[deviceId()]] - code - src/components/room/exec-bridge.ts
- [[evidenceOf()]] - code - src/lib/room/exec/gates.ts
- [[exec-bridge.ts]] - code - src/components/room/exec-bridge.ts
- [[exec-schema.ts]] - code - src/lib/room/exec/exec-schema.ts
- [[exec-server.ts]] - code - src/lib/room/exec/exec-server.ts
- [[execAfterCycle()]] - code - src/components/room/exec-bridge.ts
- [[execFlatten()]] - code - src/components/room/exec-bridge.ts
- [[execStepFn]] - code - src/lib/room/exec/exec-server.ts
- [[getExecState]] - code - src/lib/room/exec/exec-server.ts
- [[intentSchema]] - code - src/lib/room/exec/exec-schema.ts
- [[limits.ts]] - code - src/lib/room/exec/limits.ts
- [[liveReadiness]] - code - src/lib/room/exec/gates.ts
- [[rhArmed()]] - code - src/lib/room/exec/exec-server.ts
- [[runStep()]] - code - src/components/room/exec-bridge.ts
- [[schedulePoll()]] - code - src/components/room/exec-bridge.ts
- [[setExecKill]] - code - src/lib/room/exec/exec-server.ts
- [[setExecPhase]] - code - src/lib/room/exec/exec-server.ts
- [[stepSchema]] - code - src/lib/room/exec/exec-schema.ts
- [[storeFor()]] - code - src/lib/room/exec/exec-server.ts
- [[useExecStore]] - code - src/components/room/exec-bridge.ts
- [[why()]] - code - src/components/room/exec-bridge.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/exec-serverts
SORT file.name ASC
```

## Connections to other communities
- 19 edges to [[_COMMUNITY_executor.ts]]
- 14 edges to [[_COMMUNITY_execStep]]
- 10 edges to [[_COMMUNITY_gates.ts]]
- 8 edges to [[_COMMUNITY_room-engine.ts]]
- 6 edges to [[_COMMUNITY_live-world.ts]]
- 6 edges to [[_COMMUNITY_orchestrator.ts]]
- 5 edges to [[_COMMUNITY_intent.ts]]
- 5 edges to [[_COMMUNITY_@tanstackreact-start]]
- 5 edges to [[_COMMUNITY_verify-paper-step.mjs]]
- 4 edges to [[_COMMUNITY_exec-card.tsx]]
- 4 edges to [[_COMMUNITY_rh-dispatch.ts]]
- 4 edges to [[_COMMUNITY_goal.ts]]
- 3 edges to [[_COMMUNITY_getSql]]
- 3 edges to [[_COMMUNITY_trading-floor-tab.tsx]]
- 2 edges to [[_COMMUNITY_live-talk.ts]]
- 2 edges to [[_COMMUNITY_verify-room-exec.mjs]]
- 2 edges to [[_COMMUNITY_audit.ts]]
- 2 edges to [[_COMMUNITY_floor-screens.ts]]
- 2 edges to [[_COMMUNITY_live-voices.ts]]
- 1 edge to [[_COMMUNITY_package.json]]
- 1 edge to [[_COMMUNITY_rh-autofire.ts]]
- 1 edge to [[_COMMUNITY_verify-audit.mjs]]
- 1 edge to [[_COMMUNITY_verify-goal.mjs]]
- 1 edge to [[_COMMUNITY_verify-lab-constants.mjs]]

## Top bridge nodes
- [[limits.ts]] - degree 24, connects to 14 communities
- [[exec-server.ts]] - degree 39, connects to 9 communities
- [[exec-bridge.ts]] - degree 33, connects to 9 communities
- [[EXEC_LIMITS]] - degree 12, connects to 8 communities
- [[EXEC_FLAGS]] - degree 8, connects to 5 communities