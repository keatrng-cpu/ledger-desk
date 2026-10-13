---
type: community
cohesion: 0.06
members: 52
---

# databento_live_gateway.py

**Cohesion:** 0.06 - loosely connected
**Members:** 52 nodes

## Members
- [[dot-__init__()_3]] - code - gateway/databento_live_gateway.py
- [[dot-_db()]] - code - gateway/databento_live_gateway.py
- [[dot-drop_partial_minutes()]] - code - gateway/databento_live_gateway.py
- [[dot-flush_minute_bar()]] - code - gateway/databento_live_gateway.py
- [[dot-handle_ohlcv1s()]] - code - gateway/databento_live_gateway.py
- [[dot-run_forever()]] - code - gateway/databento_live_gateway.py
- [[dot-run_once()]] - code - gateway/databento_live_gateway.py
- [[dot-stop()]] - code - gateway/databento_live_gateway.py
- [[dot-touch_ticks()]] - code - gateway/databento_live_gateway.py
- [[dot-upsert_tick()]] - code - gateway/databento_live_gateway.py
- [[Before you spend anything]] - document - gateway/README.md
- [[Connection]] - code
- [[Environment variables]] - document - gateway/README.md
- [[Is there a CME tape right now Sunday before 1700 ET, Friday after 1600, all…]] - rationale - gateway/databento_live_gateway.py
- [[Live tick gateway]] - document - gateway/README.md
- [[LiveGateway]] - code - gateway/databento_live_gateway.py
- [[Load gateway.env.local then repo .env so this runs without run-local.ps1.]] - rationale - gateway/databento_live_gateway.py
- [[MinuteAgg]] - code - gateway/databento_live_gateway.py
- [[OHLCVMsg.close is DBN int64 (1e-9). pretty_close is the index price.]] - rationale - gateway/databento_live_gateway.py
- [[One connect-subscribe-stream cycle. Raises on disconnecterror — the caller's…]] - rationale - gateway/databento_live_gateway.py
- [[One in-progress 1-minute bar, built from 1s records.]] - rationale - gateway/databento_live_gateway.py
- [[Option A — run it on the desk PC, free (Windows Task Scheduler)]] - document - gateway/README.md
- [[Option B — any host that runs a long-lived process]] - document - gateway/README.md
- [[Option C — the container in this directory]] - document - gateway/README.md
- [[Pruning]] - document - gateway/README.md
- [[ROADMAP note (2026-08-13) — the live-tick gateway. WHY THIS PROCESS EXISTS AND…]] - rationale - gateway/databento_live_gateway.py
- [[Raw CME symbols (ESZ6, NQZ6, ...) chosen by front_quarterly(). Desk vocabulary…]] - rationale - gateway/databento_live_gateway.py
- [[Re-stamp `received_at` on every tick row whose last print is recent. Called…]] - rationale - gateway/databento_live_gateway.py
- [[Throw away every in-progress 1m aggregate. `self._minute` lives on the instance…]] - rationale - gateway/databento_live_gateway.py
- [[True once today's window end has passed (or it is a weekend) — the scheduled-…]] - rationale - gateway/databento_live_gateway.py
- [[Verifying it's actually working]] - document - gateway/README.md
- [[What it does]] - document - gateway/README.md
- [[When the socket should be up. 2026-09-23 this used to be a narrow NY-AM…]] - rationale - gateway/databento_live_gateway.py
- [[databento_live_gateway.py]] - code - gateway/databento_live_gateway.py
- [[dataclasses]] - concept
- [[datetime_3]] - code
- [[front_quarterly()]] - code - gateway/databento_live_gateway.py
- [[gatewayREADME]] - document - gateway/README.md
- [[globex_open()]] - code - gateway/databento_live_gateway.py
- [[in_ny_am_window()]] - code - gateway/databento_live_gateway.py
- [[load_env_local()_1]] - code - gateway/databento_live_gateway.py
- [[logging]] - concept
- [[main()_9]] - code - gateway/databento_live_gateway.py
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
TABLE source_file, type FROM #community/databento_live_gatewaypy
SORT file.name ASC
```

## Connections to other communities
- 3 edges to [[_COMMUNITY_smoke_live.py]]
- 1 edge to [[_COMMUNITY_direction-book.py]]
- 1 edge to [[_COMMUNITY_crew-year-backtest.py]]
- 1 edge to [[_COMMUNITY_perfect-entry-backtest.py]]
- 1 edge to [[_COMMUNITY_floor_pack.py]]

## Top bridge nodes
- [[zoneinfo]] - degree 4, connects to 3 communities
- [[databento_live_gateway.py]] - degree 24, connects to 2 communities