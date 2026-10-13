---
type: community
cohesion: 0.33
members: 7
---

# sqlLedger

**Cohesion:** 0.33 - loosely connected
**Members:** 7 nodes

## Members
- [[dot-account()]] - code - src/lib/room/exec/types.ts
- [[What it closes]] - document - docs/RH_LIVE_ROUTINE.md
- [[asRows()]] - code - src/lib/execution/rh-ledger.ts
- [[load()_8]] - code - src/lib/execution/rh-ledger.ts
- [[save()_4]] - code - src/lib/execution/rh-ledger.ts
- [[serialized()_1]] - code - src/lib/execution/rh-ledger.ts
- [[sqlLedger()]] - code - src/lib/execution/rh-ledger.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/sqlLedger
SORT file.name ASC
```

## Connections to other communities
- 2 edges to [[_COMMUNITY_getSql]]
- 2 edges to [[_COMMUNITY_rh-dispatch.ts]]
- 1 edge to [[_COMMUNITY_executor.ts]]

## Top bridge nodes
- [[sqlLedger()]] - degree 5, connects to 1 community
- [[What it closes]] - degree 3, connects to 1 community
- [[dot-account()]] - degree 3, connects to 1 community
- [[asRows()]] - degree 2, connects to 1 community