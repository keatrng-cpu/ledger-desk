---
type: community
cohesion: 0.18
members: 11
---

# 2. SHARED CONTRACTS

**Cohesion:** 0.18 - loosely connected
**Members:** 11 nodes

## Members
- [[2. SHARED CONTRACTS]] - document - docs/DESK_25_BUILD_PLAN.md
- [[2.1 The single plan object (item 16  1) — `card-plan.ts`, owner 2B]] - document - docs/DESK_25_BUILD_PLAN.md
- [[2.2 Detectors (owner 1A)]] - document - docs/DESK_25_BUILD_PLAN.md
- [[2.3 Pipeline (owner 2A)]] - document - docs/DESK_25_BUILD_PLAN.md
- [[2.4 Canon  master (owner 2B)]] - document - docs/DESK_25_BUILD_PLAN.md
- [[2.5 Replay (owner 4)]] - document - docs/DESK_25_BUILD_PLAN.md
- [[2.7 Options chain (owner 3A) and freshness  news (owner 1C)]] - document - docs/DESK_25_BUILD_PLAN.md
- [[CardPlan]] - code - src/lib/trading/card-plan.ts
- [[DeskOpen]] - code - src/lib/execution/rh-tools.ts
- [[DisplacementEvent]] - code - src/lib/trading/detectors.ts
- [[RhHeld]] - code - src/lib/execution/rh-cycle.ts

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/2_SHARED_CONTRACTS
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_rh-dispatch.ts]]
- 3 edges to [[_COMMUNITY_tradingscanner.ts]]
- 3 edges to [[_COMMUNITY_detectors.ts]]
- 2 edges to [[_COMMUNITY_smc-master.ts]]
- 1 edge to [[_COMMUNITY_manager-live-loop.ts]]
- 1 edge to [[_COMMUNITY_verify-rh-cycle.mjs]]
- 1 edge to [[_COMMUNITY_getSql]]
- 1 edge to [[_COMMUNITY_strategy-grade.ts]]
- 1 edge to [[_COMMUNITY_paper-manager.ts]]

## Top bridge nodes
- [[RhHeld]] - degree 5, connects to 4 communities
- [[2. SHARED CONTRACTS]] - degree 13, connects to 3 communities
- [[DeskOpen]] - degree 4, connects to 2 communities
- [[2.1 The single plan object (item 16  1) — `card-plan.ts`, owner 2B]] - degree 3, connects to 2 communities
- [[CardPlan]] - degree 3, connects to 2 communities