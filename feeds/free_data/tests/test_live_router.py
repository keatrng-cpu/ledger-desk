from feeds.free_data import load_config
from feeds.free_data.bars import NS
from feeds.free_data.live_trades import Router


def test_router_maps_continuous_ids_and_emits_closed_bars_only():
    got = []
    r = Router(["ES", "NQ"], load_config(), got.extend)
    r.map(10252, "ES.v.0"); r.map(261401, "NQ.v.0"); r.map(999, "ZN.v.0")
    t0 = 1792170000 * NS                                  # minute aligned
    r.trade(10252, t0 + 1 * NS, 7780.0, 2, "B")
    r.trade(999, t0 + 2 * NS, 110.0, 9, "A")              # unmapped root -> ignored
    r.trade(261401, t0 + 3 * NS, 29800.0, 1, "A")
    assert got == []                                       # nothing closed yet
    r.clock(t0 + 30 * NS + 1_500_000_000)                  # 30s bars close after grace
    assert sorted((b.symbol, b.interval_s, b.delta) for b in got) == [("ES", 30, 2), ("NQ", 30, -1)]
    r.trade(10252, t0 + 61 * NS, 7781.0, 1, "A")          # closes ES 1m
    assert ("ES", 60, 2, 2) in [(b.symbol, b.interval_s, b.delta, b.cvd) for b in got]
