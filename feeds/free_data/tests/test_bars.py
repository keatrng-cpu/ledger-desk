from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from feeds.free_data.bars import NS, TradeBarBuilder, bars_from_trades, session_of, side_char

ET = ZoneInfo("America/New_York")


def ns(h, m, s=0.0, day=16):
    return int(datetime(2026, 10, day, h, m, 0, tzinfo=timezone.utc).timestamp() * NS + s * NS)


def test_side_char_variants():
    assert side_char("B") == "B" and side_char(b"A") == "A" and side_char(ord("N")) == "N" and side_char(None) == "N"
    assert side_char("x") == "N"


def test_30s_and_1m_bars_ohlcv_delta_and_cvd_sign():
    tr = [
        (ns(14, 0, 1), 100.00, 2, "B"),   # buy aggressor +2
        (ns(14, 0, 10), 101.00, 3, "A"),  # sell aggressor -3
        (ns(14, 0, 29.9), 99.50, 1, "N"), # no side 0
        (ns(14, 0, 30), 102.00, 5, "B"),  # exactly at 30s boundary -> next 30s bar
        (ns(14, 0, 59), 101.50, 4, "A"),
        (ns(14, 1, 0), 103.00, 1, "B"),   # closes 14:00:30 30s bar and the 14:00 1m bar
    ]
    bars = bars_from_trades(tr, "ES")
    b30 = [b for b in bars if b.interval_s == 30]
    b60 = [b for b in bars if b.interval_s == 60]
    assert len(b30) == 2 and len(b60) == 1             # the 14:01 bars are still open -> withheld
    a, b = b30
    assert (a.open, a.high, a.low, a.close, a.volume) == (100.0, 101.0, 99.5, 99.5, 6)
    assert (a.buy_vol, a.sell_vol, a.unknown_vol, a.delta) == (2, 3, 1, -1)
    assert (b.open, b.close, b.delta) == (102.0, 101.5, 1)
    assert a.cvd == -1 and b.cvd == 0                  # session CVD = running sum of closed deltas
    m = b60[0]
    assert (m.open, m.high, m.low, m.close, m.volume, m.delta, m.cvd, m.trades) == (100.0, 102.0, 99.5, 101.5, 15, 0, 0, 5)
    assert m.delta == a.delta + b.delta


def test_closed_bars_only_no_lookahead_prefix_invariance():
    import random
    rnd = random.Random(7)
    t0 = ns(14, 0)
    tr, t = [], t0
    for _ in range(600):
        t += rnd.randint(1, 900) * 1_000_000
        tr.append((t, 100 + rnd.randint(-20, 20) * 0.25, rnd.randint(1, 5), rnd.choice("BAN")))
    full = bars_from_trades(tr, "NQ")
    for cut in (50, 200, 333, 599):
        pre = bars_from_trades(tr[:cut], "NQ")
        last_ts = tr[cut - 1][0]
        assert all(b.end_ns <= last_ts for b in pre)            # nothing emitted before it closed
        assert [b.to_dict() for b in pre] == [b.to_dict() for b in full[:len(pre)]]   # later trades never revise a bar
        for b in pre:                                            # a bar holds only trades inside [start, end)
            vol = sum(sz for ts, _, sz, _ in tr[:cut] if b.start_ns <= ts < b.end_ns)
            assert vol == b.volume


def test_on_clock_closes_after_grace_only():
    bb = TradeBarBuilder("ES", (30, 60), grace_ms=1500)
    assert bb.on_trade(ns(14, 0, 5), 100, 1, "B") == []
    assert bb.on_clock(ns(14, 0, 31)) == []                   # 30s bar ended at :30, grace 1.5s not yet passed
    out = bb.on_clock(ns(14, 0, 31.5))
    assert [b.interval_s for b in out] == [30]
    out = bb.on_clock(ns(14, 1, 1.5))
    assert [b.interval_s for b in out] == [60] and out[0].delta == 1


def test_late_trade_dropped_and_emitted_bar_immutable():
    bb = TradeBarBuilder("ES", (30,), grace_ms=0)
    bb.on_trade(ns(14, 0, 1), 100, 1, "B")
    closed = bb.on_trade(ns(14, 0, 31), 101, 1, "A")
    assert len(closed) == 1 and closed[0].volume == 1
    assert bb.on_trade(ns(14, 0, 2), 99, 7, "A") == []         # belongs to the closed bar -> dropped
    assert bb.late_trades == 1 and closed[0].volume == 1


def test_session_cvd_resets_at_18_et():
    # 2026-10-16 is EDT: 17:59 ET = 21:59 UTC, 18:00 ET = 22:00 UTC
    assert session_of(ns(21, 59)) == "2026-10-16" and session_of(ns(22, 0)) == "2026-10-17"
    tr = [(ns(21, 58, 10), 100, 5, "B"), (ns(22, 0, 10), 100, 2, "A"), (ns(22, 1, 10), 100, 1, "B")]
    bars = bars_from_trades(tr, "ES", (60,), until_ns=ns(22, 3))
    assert [(b.session, b.delta, b.cvd) for b in bars] == [("2026-10-16", 5, 5), ("2026-10-17", -2, -2), ("2026-10-17", 1, -1)]


def test_empty_interval_emits_no_bar_cvd_carries():
    tr = [(ns(14, 0, 1), 100, 3, "B"), (ns(14, 5, 1), 100, 1, "A")]
    bars = bars_from_trades(tr, "ES", (60,), until_ns=ns(14, 6, 1))
    assert [b.cvd for b in bars] == [3, 2] and bars[1].start_ns - bars[0].start_ns == 5 * 60 * NS
