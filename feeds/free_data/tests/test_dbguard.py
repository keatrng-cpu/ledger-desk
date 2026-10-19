from datetime import datetime, timezone

import pytest

from feeds.free_data import dbguard

NOW = datetime(2026, 10, 19, 4, 0, tzinfo=timezone.utc)


class Meta:
    def __init__(self, cost):
        self.cost, self.calls = cost, []

    def get_cost(self, **kw):
        self.calls.append(kw)
        return self.cost


class TS:
    def __init__(self):
        self.calls = []

    def get_range(self, path=None, **kw):
        self.calls.append(kw)
        open(path, "wb").write(b"dbn")


class Client:
    def __init__(self, cost):
        self.metadata, self.timeseries = Meta(cost), TS()


ARGS = dict(symbols=["ES.v.0", "NQ.v.0"], schema="trades", start="2026-10-16T13:30:00Z", end="2026-10-16T14:00:00Z")


@pytest.mark.parametrize("cost", [0.01, 1e-9, 5.0])
def test_nonzero_cost_aborts_before_download(tmp_path, cost):
    c = Client(cost)
    with pytest.raises(dbguard.CostAbort):
        dbguard.pull(c, **ARGS, cache_dir=str(tmp_path), now=NOW)
    assert c.timeseries.calls == [] and len(c.metadata.calls) == 1
    assert c.metadata.calls[0]["schema"] == "trades" and c.metadata.calls[0]["symbols"] == ["ES.v.0", "NQ.v.0"]


def test_zero_cost_downloads_once_then_cache(tmp_path):
    c = Client(0.0)
    p = dbguard.pull(c, **ARGS, cache_dir=str(tmp_path), now=NOW)
    assert open(p, "rb").read() == b"dbn" and len(c.timeseries.calls) == 1
    kw = dict(c.timeseries.calls[0]); assert kw == c.metadata.calls[0]      # identical args for cost and pull
    dbguard.pull(c, **ARGS, cache_dir=str(tmp_path), now=NOW)
    assert len(c.timeseries.calls) == 1 and len(c.metadata.calls) == 1     # cached: no second cost/pull
    assert (tmp_path / "cost_log.jsonl").exists()


@pytest.mark.parametrize("over,msg", [
    (dict(start="2025-10-01T00:00:00Z", end="2025-10-02T00:00:00Z"), "older than"),
    (dict(schema="mbo"), "schema"),
    (dict(end="2026-10-20T00:00:00Z"), "future"),
])
def test_guard_refuses(tmp_path, over, msg):
    c = Client(0.0)
    with pytest.raises(dbguard.GuardRefused, match=msg):
        dbguard.pull(c, **{**ARGS, **over}, cache_dir=str(tmp_path), now=NOW)
    assert c.metadata.calls == [] and c.timeseries.calls == []


def test_guard_refuses_other_dataset(tmp_path):
    with pytest.raises(dbguard.GuardRefused):
        dbguard.pull(Client(0.0), **ARGS, dataset="XNAS.ITCH", cache_dir=str(tmp_path), now=NOW)


def test_l0_ohlcv_may_be_older_than_12_months():
    dbguard.guard("GLBX.MDP3", "ohlcv-1m", "2024-01-01T00:00:00Z", "2024-01-02T00:00:00Z", NOW)
