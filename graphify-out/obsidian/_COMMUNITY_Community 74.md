---
type: community
cohesion: 0.08
members: 42
---

# Community 74

**Cohesion:** 0.08 - loosely connected
**Members:** 42 nodes

## Members
- [[dot-__init__()_2]] - code - gateway/databento_live_gateway.py
- [[dot-_db()]] - code - gateway/databento_live_gateway.py
- [[dot-drop_partial_minutes()]] - code - gateway/databento_live_gateway.py
- [[dot-flush_minute_bar()]] - code - gateway/databento_live_gateway.py
- [[dot-handle_ohlcv1s()]] - code - gateway/databento_live_gateway.py
- [[dot-run_forever()]] - code - gateway/databento_live_gateway.py
- [[dot-run_once()]] - code - gateway/databento_live_gateway.py
- [[dot-stop()]] - code - gateway/databento_live_gateway.py
- [[dot-touch_ticks()]] - code - gateway/databento_live_gateway.py
- [[dot-upsert_tick()]] - code - gateway/databento_live_gateway.py
- [[Connection]] - code
- [[Is there a CME tape right now Sunday before 1700 ET, Friday after 1600, all…]] - rationale - gateway/databento_live_gateway.py
- [[LiveGateway]] - code - gateway/databento_live_gateway.py
- [[Load gateway.env.local then repo .env so this runs without run-local.ps1.]] - rationale - gateway/databento_live_gateway.py
- [[MinuteAgg]] - code - gateway/databento_live_gateway.py
- [[OHLCVMsg.close is DBN int64 (1e-9). pretty_close is the index price.]] - rationale - gateway/databento_live_gateway.py
- [[One connect-subscribe-stream cycle. Raises on disconnecterror — the caller's…]] - rationale - gateway/databento_live_gateway.py
- [[One in-progress 1-minute bar, built from 1s records.]] - rationale - gateway/databento_live_gateway.py
- [[ROADMAP note (2026-08-13) — the live-tick gateway. WHY THIS PROCESS EXISTS AND…]] - rationale - gateway/databento_live_gateway.py
- [[Raw CME symbols (ESZ6, NQZ6, ...) chosen by front_quarterly(). Desk vocabulary…]] - rationale - gateway/databento_live_gateway.py
- [[Re-stamp `received_at` on every tick row whose last print is recent. Called…]] - rationale - gateway/databento_live_gateway.py
- [[Throw away every in-progress 1m aggregate. `self._minute` lives on the instance…]] - rationale - gateway/databento_live_gateway.py
- [[True once today's window end has passed (or it is a weekend) — the scheduled-…]] - rationale - gateway/databento_live_gateway.py
- [[When the socket should be up. 2026-09-23 this used to be a narrow NY-AM…]] - rationale - gateway/databento_live_gateway.py
- [[databento_live_gateway.py]] - code - gateway/databento_live_gateway.py
- [[dataclasses]] - concept
- [[datetime_3]] - code
- [[front_quarterly()]] - code - gateway/databento_live_gateway.py
- [[globex_open()]] - code - gateway/databento_live_gateway.py
- [[in_ny_am_window()]] - code - gateway/databento_live_gateway.py
- [[load_env_local()_1]] - code - gateway/databento_live_gateway.py
- [[logging]] - concept
- [[main()_6]] - code - gateway/databento_live_gateway.py
- [[psycopg]] - concept
- [[rec_px()]] - code - gateway/databento_live_gateway.py
- [[rec_ts()]] - code - gateway/databento_live_gateway.py
- [[resolve_desk_symbol()]] - code - gateway/databento_live_gateway.py
- [[signal]] - concept
- [[third_friday()]] - code - gateway/databento_live_gateway.py
- [[window_closed_for_today()]] - code - gateway/databento_live_gateway.py
- [[window_label()]] - code - gateway/databento_live_gateway.py
- [[zoneinfo]] - concept

## Live Query (requires Dataview plugin)

```dataview
TABLE source_file, type FROM #community/Community_74
SORT file.name ASC
```

## Connections to other communities
- 4 edges to [[_COMMUNITY_Community 225]]
- 1 edge to [[_COMMUNITY_Community 131]]
- 1 edge to [[_COMMUNITY_Community 156]]
- 1 edge to [[_COMMUNITY_Community 192]]

## Top bridge nodes
- [[zoneinfo]] - degree 4, connects to 3 communities
- [[databento_live_gateway.py]] - degree 24, connects to 1 community