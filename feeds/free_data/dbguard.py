"""Cost-guarded Databento HISTORICAL pulls. The $0 comes from this guard, not from the plan alone.

Every pull: (1) dataset must be GLBX.MDP3 and schema in shared/free-data.json historical.allowedSchemas; (2) L1
schemas (trades/tbbo/mbp-1) must start inside the last `l1MaxAgeDays` (360 < 365, margin for the plan's rolling
12-month window); (3) metadata.get_cost is called with the IDENTICAL arguments and the pull aborts (nothing
downloaded) unless the estimate is exactly 0.0; (4) the result is cached as DBN under cacheDir and never re-pulled.
Each cost check is appended to <cacheDir>/cost_log.jsonl. Do not call timeseries.get_range anywhere else.
"""
from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timedelta, timezone

from . import load_config


class CostAbort(RuntimeError):
    pass


class GuardRefused(ValueError):
    pass


def _ts(v) -> datetime:
    if isinstance(v, datetime):
        return v if v.tzinfo else v.replace(tzinfo=timezone.utc)
    s = str(v).replace("Z", "+00:00")
    d = datetime.fromisoformat(s)
    return d if d.tzinfo else d.replace(tzinfo=timezone.utc)


def guard(dataset: str, schema: str, start, end, now: datetime | None = None, cfg: dict | None = None) -> None:
    h = (cfg or load_config())["historical"]
    if dataset != "GLBX.MDP3":
        raise GuardRefused(f"dataset {dataset} not allowed")
    if schema not in h["allowedSchemas"]:
        raise GuardRefused(f"schema {schema} not allowed")
    now = now or datetime.now(timezone.utc)
    s, e = _ts(start), _ts(end)
    if e <= s:
        raise GuardRefused("end must be after start")
    if e > now + timedelta(minutes=1):
        raise GuardRefused("end is in the future")
    if schema in h["l1Schemas"] and s < now - timedelta(days=int(h["l1MaxAgeDays"])):
        raise GuardRefused(f"{schema} start {s.isoformat()} older than {h['l1MaxAgeDays']}d (12-month plan window)")


def cache_path(cache_dir: str, kw: dict) -> str:
    key = json.dumps({k: kw[k] for k in sorted(kw)}, default=str, sort_keys=True)
    hx = hashlib.sha256(key.encode()).hexdigest()[:16]
    sym = "-".join(s.replace(".", "_") for s in kw["symbols"])
    return os.path.join(cache_dir, f"{kw['schema']}_{sym}_{hx}.dbn.zst")


def pull(client, *, symbols, schema: str, start, end, dataset: str = "GLBX.MDP3", stype_in: str = "continuous",
         cache_dir: str | None = None, now: datetime | None = None, cfg: dict | None = None) -> str:
    """Return the path of a cached DBN file for the request. Raises GuardRefused / CostAbort before any download."""
    cfg = cfg or load_config()
    cache_dir = cache_dir or cfg["historical"]["cacheDir"]
    guard(dataset, schema, start, end, now, cfg)
    kw = dict(dataset=dataset, symbols=list(symbols), schema=schema, stype_in=stype_in,
              start=_ts(start).isoformat(), end=_ts(end).isoformat())
    path = cache_path(cache_dir, kw)
    if os.path.exists(path):
        return path
    os.makedirs(cache_dir, exist_ok=True)
    cost = float(client.metadata.get_cost(**kw))
    with open(os.path.join(cache_dir, "cost_log.jsonl"), "a") as f:
        f.write(json.dumps({"at": time.time(), "cost_usd": cost, **kw}) + "\n")
    if cost != float(cfg["historical"]["maxCostUsd"]) or cost != 0.0:
        raise CostAbort(f"get_cost={cost} for {kw} -- aborting, nothing downloaded")
    tmp = path + ".part"
    client.timeseries.get_range(**kw, path=tmp)
    os.replace(tmp, path)
    return path


def iter_trades(path: str):
    """Yield (ts_recv_ns, price, size, side_char, instrument_id) from a cached trades/tbbo DBN file (ts_recv: the
    timestamp Databento buckets ohlcv bars on, see bars.py)."""
    import databento as db
    from .bars import side_char
    store = db.DBNStore.from_file(path)
    for r in store:
        if hasattr(r, "price") and hasattr(r, "size"):
            yield int(r.ts_recv), float(r.pretty_price), int(r.size), side_char(r.side), int(r.instrument_id)


def symbol_map(path: str) -> dict[int, str]:
    """instrument_id -> requested continuous symbol root (ES.v.0 -> ES) from the DBN metadata mappings."""
    import databento as db
    store = db.DBNStore.from_file(path)
    out: dict[int, str] = {}
    for m in store.metadata.mappings.items() if isinstance(store.metadata.mappings, dict) else []:
        raw, ivs = m
        root = raw.split(".")[0]
        for iv in ivs:
            try:
                out[int(iv["symbol"])] = root
            except (KeyError, ValueError, TypeError):
                pass
    return out
