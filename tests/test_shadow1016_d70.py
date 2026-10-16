"""Closed-bar / no-lookahead proof for docs/shadow-1016/d70 (synthetic bars; no data files needed)."""
import importlib.util, pathlib
import numpy as np, pandas as pd

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("tfcommon_d70", ROOT / "docs" / "shadow-1016" / "d70" / "tfcommon.py")
C = importlib.util.module_from_spec(spec); spec.loader.exec_module(C)


def _data():
    t0 = pd.Timestamp("2026-09-01 17:00", tz="America/Chicago").value // 1_000_000
    t = np.arange(t0, t0 + 3 * 86_400_000, 60_000, dtype=np.int64)
    px = 100 + np.cumsum(np.sin(np.arange(len(t)) / 7.0))
    t30 = np.arange(t0, t0 + 3 * 86_400_000, 30_000, dtype=np.int64)
    p30 = np.interp(t30, t, px)
    return dict(t=t, o=px, h=px + 0.5, l=px - 0.5, c=px + 0.1, iid=np.zeros(len(t)), t30=t30, o30=p30, c30=p30 + 0.05)


def test_every_timeframe_reads_only_closed_bars():
    D = _data()
    for T in [pd.Timestamp(x, tz="America/Chicago").value // 1_000_000 for x in ("2026-09-03 08:40", "2026-09-03 08:47:30", "2026-09-03 09:00")]:
        ctx = C.tf_context(D, T, 1, None)
        assert set(ctx) == {n for n, _ in C.TFS} == {"30s", "1m", "2m", "3m", "5m", "15m", "30m", "1h", "4h", "1D"}
        for name, r in ctx.items():
            assert r["end"] is not None, name
            assert r["end"] <= T, (name, r["end"] - T)


def test_table_lists_all_timeframes():
    D = _data(); T = pd.Timestamp("2026-09-03 08:40", tz="America/Chicago").value // 1_000_000
    tab = C.tf_table([{"tf": C.tf_context(D, T, 1, None)}])
    for name, _ in C.TFS:
        assert f"| {name} |" in tab
    assert "False" not in tab
