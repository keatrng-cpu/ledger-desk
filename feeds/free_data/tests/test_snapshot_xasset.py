import os
import time
from datetime import datetime, timedelta, timezone

from feeds.free_data import snapshot


def test_window_rounds_to_the_hour_so_one_request_per_hour():
    lb = (30, 60)
    a = snapshot.xasset_window(datetime(2026, 10, 19, 14, 1, tzinfo=timezone.utc), lb)
    b = snapshot.xasset_window(datetime(2026, 10, 19, 14, 59, 30, tzinfo=timezone.utc), lb)
    c = snapshot.xasset_window(datetime(2026, 10, 19, 15, 0, tzinfo=timezone.utc), lb)
    assert a == b and a[1] == datetime(2026, 10, 19, 14, 0, tzinfo=timezone.utc)
    assert c[1] - a[1] == timedelta(hours=1)
    assert a[1] - a[0] == timedelta(minutes=90)
    assert a[1] <= datetime(2026, 10, 19, 14, 1, tzinfo=timezone.utc)     # never past the data end (closed bars)


def test_prune_keeps_newest_and_never_cost_log(tmp_path):
    now = time.time()
    for i in range(10):
        p = tmp_path / f"ohlcv-1m_x_{i}.dbn.zst"; p.write_text("x"); os.utime(p, (now - i * 60, now - i * 60))
    (tmp_path / "cost_log.jsonl").write_text("{}\n")
    assert snapshot.prune_cache(str(tmp_path), keep=3) == 7
    left = sorted(os.listdir(tmp_path))
    assert "cost_log.jsonl" in left and len(left) == 4 and "ohlcv-1m_x_0.dbn.zst" in left
