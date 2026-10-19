"""Closed-bar builder from CME trades with aggressor side -> 30s / 1m OHLCV + per-bar delta + session CVD.

Rules (tested in tests/test_bars.py):
  * A bar covers [start, start+interval) by the trade's ts_recv (UTC ns) -- the same bucketing Databento uses for
    ohlcv-1m: built from ts_recv, our 1m bars match GLBX ohlcv-1m exactly (180/180 ES+NQ bars, 10/16 08:30-10:00 CT;
    bucketing by ts_event gave 6 mismatches). A trade stamped exactly at `end` belongs to the
    NEXT bar. Bars are emitted ONLY once closed: when a trade at/after `end` arrives, or when the clock passes
    end + grace. An open bar is never exposed, so nothing downstream can read a partial (lookahead) bar.
  * A trade older than the bar currently open (i.e. it belongs to an already-emitted bar) is dropped and counted in
    `late_trades`; emitted bars are immutable.
  * Aggressor side (Databento TradeMsg.side): 'B' = buyer lifted the offer -> +size, 'A' = seller hit the bid ->
    -size, 'N' = no side -> 0 (counted in `unknown_vol`).
  * Session CVD = running sum of closed-bar deltas since the Globex open (18:00 America/New_York). Resets when a bar
    starts in a new session. Intervals with no trades emit no bar (same as Databento ohlcv-*), CVD carries over.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict, field
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
CT = ZoneInfo("America/Chicago")
NS = 1_000_000_000
SIDE_SIGN = {"B": 1, "A": -1, "N": 0}


def session_of(ts_ns: int, open_hour_et: int = 18) -> str:
    """Globex trading date (ET) a timestamp belongs to: at/after 18:00 ET counts toward the next calendar day."""
    et = datetime.fromtimestamp(ts_ns / NS, tz=timezone.utc).astimezone(ET)
    d = et.date() + (timedelta(days=1) if et.hour >= open_hour_et else timedelta(0))
    return d.isoformat()


def side_char(side) -> str:
    if isinstance(side, (bytes, bytearray)):
        side = side.decode()
    if isinstance(side, int):
        side = chr(side)
    s = str(getattr(side, "value", side) or "N")
    return s[:1].upper() if s[:1].upper() in SIDE_SIGN else "N"


@dataclass
class ClosedBar:
    symbol: str
    interval_s: int
    start_ns: int
    end_ns: int
    open: float
    high: float
    low: float
    close: float
    volume: int
    buy_vol: int
    sell_vol: int
    unknown_vol: int
    delta: int
    cvd: int
    trades: int
    session: str

    @property
    def start_utc(self) -> datetime:
        return datetime.fromtimestamp(self.start_ns / NS, tz=timezone.utc)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["start_ct"] = self.start_utc.astimezone(CT).isoformat()
        d["start_et"] = self.start_utc.astimezone(ET).isoformat()
        return d

    def log_line(self) -> str:
        t = self.start_utc.astimezone(CT).strftime("%H:%M:%S")
        return (f"{self.symbol} {self.interval_s}s {t} CT o={self.open:.2f} h={self.high:.2f} l={self.low:.2f} c={self.close:.2f} "
                f"v={self.volume} buy={self.buy_vol} sell={self.sell_vol} delta={self.delta:+d} cvd={self.cvd:+d} n={self.trades}")


@dataclass
class _Open:
    start_ns: int
    o: float
    h: float
    l: float
    c: float
    v: int = 0
    buy: int = 0
    sell: int = 0
    unk: int = 0
    n: int = 0


@dataclass
class _Lane:
    interval_s: int
    cur: _Open | None = None
    cvd: int = 0
    session: str | None = None
    last_end_ns: int = 0          # end of the last emitted bar (late-trade fence)


class TradeBarBuilder:
    def __init__(self, symbol: str, intervals_s=(30, 60), grace_ms: int = 1500, session_open_hour_et: int = 18):
        assert all(60 % i == 0 or i % 60 == 0 for i in intervals_s), "intervals must align to the minute"
        self.symbol = symbol
        self.grace_ns = int(grace_ms) * 1_000_000
        self.open_hour = session_open_hour_et
        self.lanes = {int(i): _Lane(int(i)) for i in intervals_s}
        self.late_trades = 0
        self.last_trade_ns = 0

    # -- internals --
    def _close(self, lane: _Lane) -> ClosedBar:
        b = lane.cur
        sess = session_of(b.start_ns, self.open_hour)
        if lane.session != sess:
            lane.session, lane.cvd = sess, 0
        delta = b.buy - b.sell
        lane.cvd += delta
        end = b.start_ns + lane.interval_s * NS
        lane.last_end_ns, lane.cur = end, None
        return ClosedBar(self.symbol, lane.interval_s, b.start_ns, end, b.o, b.h, b.l, b.c, b.v, b.buy, b.sell, b.unk, delta,
                         lane.cvd, b.n, sess)

    # -- api --
    def on_trade(self, ts_ns: int, price: float, size: int, side) -> list[ClosedBar]:
        out: list[ClosedBar] = []
        sgn = SIDE_SIGN[side_char(side)]
        size = int(size)
        for lane in self.lanes.values():
            iv = lane.interval_s * NS
            start = ts_ns - ts_ns % iv
            if lane.cur is not None and start > lane.cur.start_ns:
                out.append(self._close(lane))
            if ts_ns < lane.last_end_ns or (lane.cur is not None and start < lane.cur.start_ns):
                self.late_trades += 1 if lane.interval_s == min(self.lanes) else 0
                continue
            if lane.cur is None:
                lane.cur = _Open(start, price, price, price, price)
            b = lane.cur
            b.h, b.l, b.c = max(b.h, price), min(b.l, price), price
            b.v += size; b.n += 1
            if sgn > 0: b.buy += size
            elif sgn < 0: b.sell += size
            else: b.unk += size
        self.last_trade_ns = max(self.last_trade_ns, ts_ns)
        out.sort(key=lambda x: (x.end_ns, x.interval_s))
        return out

    def on_clock(self, now_ns: int) -> list[ClosedBar]:
        """Close any open bar whose end + grace is at/before `now_ns` (wall clock or feed heartbeat)."""
        out = []
        for lane in self.lanes.values():
            if lane.cur is not None and lane.cur.start_ns + lane.interval_s * NS + self.grace_ns <= now_ns:
                out.append(self._close(lane))
        out.sort(key=lambda x: (x.end_ns, x.interval_s))
        return out


def bars_from_trades(trades, symbol: str, intervals_s=(30, 60), until_ns: int | None = None) -> list[ClosedBar]:
    """Batch helper (historical/replay): trades = iterable of (ts_ns, price, size, side). Only bars that CLOSED by
    `until_ns` (default: the last trade's ts) are returned -- the trailing open bar is withheld."""
    b = TradeBarBuilder(symbol, intervals_s, grace_ms=0)
    out: list[ClosedBar] = []
    for ts, px, sz, sd in trades:
        out += b.on_trade(int(ts), float(px), int(sz), sd)
    if until_ns is not None:
        out += b.on_clock(int(until_ns))
    return out
