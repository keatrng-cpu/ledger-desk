---
type: community
cohesion: 0.08
members: 32
---

# smoke_live.py

**Cohesion:** 0.08 - loosely connected
**Members:** 32 nodes

## Members
- [[dot-debit_at_ask()]] - code - brainlab/gate.py
- [[dot-debit_at_limit()]] - code - brainlab/gate.py
- [[dot-desk_gates()]] - code - brainlab/gate.py
- [[dot-limit_px()]] - code - brainlab/gate.py
- [[Ask plus the desk's 2 cents. A marketable limit, not a market order.]] - rationale - brainlab/gate.py
- [[BaseModel]] - code
- [[Judge a quote. Never place one. Robinhood on the desk is the only execution…]] - rationale - brainlab/router.py
- [[Load ..gateway.env.local if present so this runs without run-local.ps1.]] - rationale - gateway/smoke_live.py
- [[One-shot Live smoke test. Connects with the real key, subscribes exactly as the…]] - rationale - gateway/smoke_live.py
- [[OrderIntent_1]] - code - brainlab/gate.py
- [[The order schema. A bad quote, a wide spread, a debit outside the envelope, or…]] - rationale - brainlab/gate.py
- [[What the ticket costs at the limit the number the envelope and the buying…]] - rationale - brainlab/gate.py
- [[Write whether the quote is inside the desk's cuts. The return never includes an…]] - rationale - brainlab/router.py
- [[_front()]] - code - gateway/smoke_live.py
- [[databento]] - concept
- [[datetime_4]] - concept
- [[gate.py]] - code - brainlab/gate.py
- [[judge()]] - code - brainlab/router.py
- [[load_env_local()]] - code - gateway/smoke_live.py
- [[main()_6]] - code - gateway/smoke_live.py
- [[model_validator]] - code
- [[ndarray]] - code
- [[noise_z()]] - code - brainlab/gate.py
- [[pydantic]] - concept
- [[review()]] - code - brainlab/router.py
- [[router.py]] - code - brainlab/router.py
- [[scipy]] - concept
- [[smoke_live.py]] - code - gateway/smoke_live.py
- [[sys]] - concept
- [[time]] - concept
- [[typing]] - concept
- [[z of the last return against the ones before it. Too few prints, or a flat…]] - rationale - brainlab/gate.py

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/smoke_livepy
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_floor_ao.py]]
- 3 edges to [[_COMMUNITY_databento_live_gateway.py]]
- 2 edges to [[_COMMUNITY_fills.py]]
- 2 edges to [[_COMMUNITY_selfcheck.py]]
- 2 edges to [[_COMMUNITY_floor_pack.py]]
- 1 edge to [[_COMMUNITY_build_floor.py]]
- 1 edge to [[_COMMUNITY_perfect-entry-backtest.py]]
- 1 edge to [[_COMMUNITY_json]]
- 1 edge to [[_COMMUNITY_smc_ref.py]]
- 1 edge to [[_COMMUNITY_retain.py]]
- 1 edge to [[_COMMUNITY_build-learn-figures.py]]

## Top bridge nodes
- [[sys]] - degree 9, connects to 7 communities
- [[time]] - degree 7, connects to 2 communities
- [[smoke_live.py]] - degree 9, connects to 1 community
- [[gate.py]] - degree 8, connects to 1 community
- [[router.py]] - degree 7, connects to 1 community