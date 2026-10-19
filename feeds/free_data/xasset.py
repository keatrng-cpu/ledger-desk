"""Cross-asset 1m reads (ZN, 6E) from cost-guarded Databento ohlcv-1m. LOG-ONLY. Closed bars only: a bar stamped
`start` is used only when start + 60 s <= as_of."""
from __future__ import annotations

from datetime import datetime, timezone

NS = 1_000_000_000


def closes_from_dbn(path: str) -> dict[str, list[tuple[int, float]]]:
    import databento as db
    from .dbguard import symbol_map
    m = symbol_map(path)
    out: dict[str, list[tuple[int, float]]] = {}
    for r in db.DBNStore.from_file(path):
        root = m.get(int(r.instrument_id))
        if root:
            out.setdefault(root, []).append((int(r.ts_event), float(r.pretty_close)))
    for v in out.values():
        v.sort()
    return out


def read(series: list[tuple[int, float]], as_of_ns: int, lookbacks_min=(30, 60)) -> dict | None:
    closed = [(t, c) for t, c in series if t + 60 * NS <= as_of_ns]
    if not closed:
        return None
    t_last, c_last = closed[-1]
    out = {"last_bar_utc": datetime.fromtimestamp(t_last / NS, tz=timezone.utc).isoformat(), "close": c_last}
    for lb in lookbacks_min:
        tgt = t_last - lb * 60 * NS
        prior = [c for t, c in closed if t <= tgt]
        out[f"chg_{lb}m_pct"] = round((c_last / prior[-1] - 1) * 100, 4) if prior and prior[-1] else None
    return out
