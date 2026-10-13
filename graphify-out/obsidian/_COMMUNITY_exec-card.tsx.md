---
type: community
cohesion: 0.27
members: 12
---

# exec-card.tsx

**Cohesion:** 0.27 - loosely connected
**Members:** 12 nodes

## Members
- [[ExecCard()]] - code - src/components/room/exec-card.tsx
- [[OccParts]] - code - src/lib/room/exec/occ.ts
- [[OccType]] - code - src/lib/room/exec/occ.ts
- [[OrderRow()]] - code - src/components/room/exec-card.tsx
- [[PHASES_1]] - code - src/components/room/exec-card.tsx
- [[STATUS_COLOR]] - code - src/components/room/exec-card.tsx
- [[contractLabel()]] - code - src/components/room/exec-card.tsx
- [[etTime()_2]] - code - src/components/room/exec-card.tsx
- [[exec-card.tsx]] - code - src/components/room/exec-card.tsx
- [[flattenBroker()]] - code - src/components/room/room-engine.ts
- [[occ.ts]] - code - src/lib/room/exec/occ.ts
- [[parseOcc()]] - code - src/lib/room/exec/occ.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/exec-cardtsx
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_exec-server.ts]]
- 4 edges to [[_COMMUNITY_room-engine.ts]]
- 3 edges to [[_COMMUNITY_execStep]]
- 3 edges to [[_COMMUNITY_getSql]]
- 3 edges to [[_COMMUNITY_trading-floor-tab.tsx]]
- 3 edges to [[_COMMUNITY_executor.ts]]
- 2 edges to [[_COMMUNITY_intent.ts]]
- 2 edges to [[_COMMUNITY_react]]
- 1 edge to [[_COMMUNITY_verify-room-exec.mjs]]
- 1 edge to [[_COMMUNITY_gates.ts]]

## Top bridge nodes
- [[exec-card.tsx]] - degree 20, connects to 7 communities
- [[occ.ts]] - degree 9, connects to 4 communities
- [[ExecCard()]] - degree 8, connects to 3 communities
- [[flattenBroker()]] - degree 6, connects to 2 communities
- [[parseOcc()]] - degree 5, connects to 2 communities