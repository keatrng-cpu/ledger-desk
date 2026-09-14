"""
ROADMAP note (2026-08-13) — the live-tick gateway.

WHY THIS PROCESS EXISTS AND WHY IT IS NOT PART OF THE WEB APP
The desk (ledger-desk) runs on Netlify: stateless functions, no persistent
connection, spins down between requests. Databento's real-time feed is a
socket-based Live API with no REST/snapshot alternative (confirmed against
Databento's own public roadmap, which has an OPEN feature request for exactly
that — "expose intraday and current trading session historical data over
historical (HTTP) API" — meaning it does not exist today). So a real-time
feed needs something that can hold a connection continuously. That is what
this file is: a small, single-purpose, always-on process, separate from the
web app, that does exactly one job — stay connected and write.

WHY THIS IS PYTHON, NOT TYPESCRIPT, IN AN OTHERWISE TYPESCRIPT REPO
Databento ships official client libraries for Python, Rust and C++. There is
no official Node.js/TypeScript client, and the Live API itself is a raw
binary protocol over TCP — hand-rolling that parser for a financial feed is
not something to do casually. Use the vendor's tested client. This is a
deliberate, stated choice, not an accident: the repo's own reference engine
(Trading-Automation) is already Python, so this does not introduce a new
ecosystem, just a second small process in one that already exists.

WHAT IT DOES
Connects once, subscribes to 1-second OHLCV bars for ES and NQ continuous
front-month contracts on GLBX.MDP3, and on every record:
  - upserts the latest price into `live_market_ticks` (one row per symbol)
  - appends closed 1-minute bars into `live_market_bars_1m`, aggregated from
    the 1s bars (Databento's schemas are fixed intervals; nothing here
    invents a 1m bar from ticks by hand)
Both tables are read by src/lib/market/live-gateway.ts, which is paranoid
about freshness (see migrations/0011_live_gateway.sql) — a gateway that dies
silently produces STALE rows, and the TypeScript reader is what refuses to
trust them, not this script. This script's only job is to write honestly and
reconnect when it drops.

*** VERIFIED AGAINST A REAL CONNECTION 2026-09-14 ***
databento 0.83.0 Live: `for record in client` yields OHLCVMsg after subscribe
(no explicit start()). Symbology is `client.symbology_map` (instrument_id →
"ESU6"/"NQU6", not "ES"/"NQ"). Prices are DBN int64 — use pretty_close /
pretty_open / pretty_high / pretty_low, never raw close (that is 1e-9 units
and would write 29173000000000 into Postgres). smoke_live.py is the check.

DEPLOYMENT
Any host that can run a long-lived Python process: Fly.io, Railway, a small
VPS. Needs DATABASE_URL (same Postgres this whole app already uses) and
DATABENTO_API_KEY. See gateway/README.md.
"""

from __future__ import annotations

import logging
import os
import signal
import sys
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import psycopg

try:
    import databento as db
except ImportError:  # pragma: no cover
    print('databento package not installed — pip install "databento>=0.34"', file=sys.stderr)
    raise

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    datefmt="%Y-%m-%dT%H:%M:%S%z",
)
log = logging.getLogger("live_gateway")


def load_env_local() -> None:
    """Load gateway/.env.local then repo .env so this runs without run-local.ps1."""
    here = os.path.dirname(os.path.abspath(__file__))
    for p in (os.path.join(here, ".env.local"), os.path.join(here, "..", ".env")):
        if not os.path.exists(p):
            continue
        with open(p, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


load_env_local()

DATASET = os.environ.get("DATABENTO_DATASET", "GLBX.MDP3")
SYMBOLS = ["ES.c.0", "NQ.c.0"]
# 1s OHLCV — the finest fixed-interval schema Databento offers. Aggregated up
# into 1m bars below rather than requested as ohlcv-1m directly, so the tick
# table (which needs sub-second freshness) and the bar table share one
# subscription instead of opening two connections.
SCHEMA = "ohlcv-1s"

# Stream only NY AM. Desk PATH lives 09:30–11:00 ET (Judas 09:30–09:45 is
# no-entry, so the socket is up for the raid but the first fill is ~09:45).
# Holding the Live socket all session is wasted CME messages. 09:20 matches the
# premarket-brief slot in CLAUDE.md; the 08:30 news candle is NOT covered live —
# the desk reads that from Databento historical / Yahoo like every other bar.
NY_AM_TZ = ZoneInfo("America/New_York")
NY_AM_START = (9, 20)  # 09:20 ET
NY_AM_END = (11, 0)  # 11:00 ET
WINDOW_POLL_SEC = 30

# When "1": exit 0 once today's window has closed (or if started after it),
# instead of idling until tomorrow. This is the mode for a scheduled local run
# (Windows Task Scheduler at 08:15 CT / 09:15 ET) — the process should not
# linger overnight on a desk PC. Unset = original always-on behaviour for a
# VPS / Fly.io host.
EXIT_AFTER_WINDOW = os.environ.get("GATEWAY_EXIT_AFTER_WINDOW", "").strip() == "1"

# TEST ONLY. When "1": ignore the NY AM window entirely so an operator can
# prove the socket -> Postgres write path for a minute at any hour Globex is
# open (e.g. `timeout 60 python databento_live_gateway.py`). Never set this on
# the scheduled task or a VPS — it would stream (and pay for) the whole session.
FORCE_WINDOW = os.environ.get("GATEWAY_FORCE_WINDOW", "").strip() == "1"

# Reconnect backoff. Never spin hot against the vendor on a bad key/network.
RECONNECT_MIN_SEC = 2
RECONNECT_MAX_SEC = 60


def resolve_desk_symbol(dbn_symbol: str) -> str | None:
    """Databento Live maps continuous ES.c.0 / NQ.c.0 to the front month
    (ESU6, NQU6 in Sep 2026). Desk vocabulary is ES / NQ. MNQ is the same
    NQ print — live-gateway.ts remaps MNQ → NQ on read."""
    if not dbn_symbol:
        return None
    root = dbn_symbol.strip().upper().split(".")[0]
    month = "FGHJKMNQUVXZ"
    if root == "ES" or (root.startswith("ES") and len(root) >= 3 and root[2] in month):
        return "ES"
    if root == "NQ" or (root.startswith("NQ") and len(root) >= 3 and root[2] in month):
        return "NQ"
    return None


def rec_px(rec, pretty: str, raw: str) -> float:  # noqa: ANN001
    """OHLCVMsg.close is DBN int64 (1e-9). pretty_close is the index price."""
    v = getattr(rec, pretty, None)
    if v is not None:
        return float(v)
    n = float(getattr(rec, raw, 0) or 0)
    if abs(n) > 1e8:  # raw DBN units leaked through
        n = n / 1e9
    return n


def rec_ts(rec) -> datetime:  # noqa: ANN001
    ts = getattr(rec, "pretty_ts_event", None)
    if ts is not None:
        if hasattr(ts, "to_pydatetime"):
            # warn=False: pandas otherwise emits "Discarding nonzero
            # nanoseconds" on every 1s record. Microsecond precision is fine.
            dt = ts.to_pydatetime(warn=False)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        if isinstance(ts, datetime):
            return ts if ts.tzinfo else ts.replace(tzinfo=timezone.utc)
    ns = getattr(rec, "ts_event", None) or (
        getattr(rec, "hd", None) and rec.hd.ts_event
    )
    if ns:
        return datetime.fromtimestamp(int(ns) / 1e9, tz=timezone.utc)
    return datetime.now(timezone.utc)


@dataclass
class MinuteAgg:
    """One in-progress 1-minute bar, built from 1s records."""

    minute_start_ns: int
    o: float
    h: float
    l: float  # noqa: E741 — matches the desk's OhlcBar field name
    c: float
    v: int


def window_label() -> str:
    return f"{NY_AM_START[0]:02d}:{NY_AM_START[1]:02d}-{NY_AM_END[0]:02d}:{NY_AM_END[1]:02d} ET"


def in_ny_am_window(now: datetime | None = None) -> bool:
    """Weekday NY_AM_START–NY_AM_END America/New_York."""
    if FORCE_WINDOW and now is None:
        return True
    n = (now or datetime.now(timezone.utc)).astimezone(NY_AM_TZ)
    if n.weekday() >= 5:
        return False
    start = n.replace(
        hour=NY_AM_START[0], minute=NY_AM_START[1], second=0, microsecond=0
    )
    end = n.replace(hour=NY_AM_END[0], minute=NY_AM_END[1], second=0, microsecond=0)
    return start <= n < end


def window_closed_for_today(now: datetime | None = None) -> bool:
    """True once today's window end has passed (or it is a weekend) — the
    scheduled-run mode uses this to exit instead of idling to tomorrow."""
    if FORCE_WINDOW and now is None:
        return False
    n = (now or datetime.now(timezone.utc)).astimezone(NY_AM_TZ)
    if n.weekday() >= 5:
        return True
    end = n.replace(hour=NY_AM_END[0], minute=NY_AM_END[1], second=0, microsecond=0)
    return n >= end


class LiveGateway:
    def __init__(self, dsn: str, api_key: str) -> None:
        self._dsn = dsn
        self._api_key = api_key
        self._conn: psycopg.Connection | None = None
        self._minute: dict[str, MinuteAgg] = {}
        self._running = True

    def _db(self) -> psycopg.Connection:
        if self._conn is None or self._conn.closed:
            self._conn = psycopg.connect(self._dsn, autocommit=True)
        return self._conn

    def stop(self, *_a: object) -> None:
        log.info("stop requested")
        self._running = False

    def upsert_tick(self, symbol: str, price: float, ts_event: datetime) -> None:
        with self._db().cursor() as cur:
            cur.execute(
                """
                insert into live_market_ticks (symbol, price, bid, ask, ts, received_at, source)
                values (%s, %s, null, null, %s, now(), 'databento_live')
                on conflict (symbol) do update
                  set price = excluded.price,
                      ts = excluded.ts,
                      received_at = now()
                """,
                (symbol, price, ts_event),
            )

    def flush_minute_bar(self, symbol: str, agg: MinuteAgg) -> None:
        bar_time = datetime.fromtimestamp(agg.minute_start_ns / 1e9, tz=timezone.utc)
        with self._db().cursor() as cur:
            cur.execute(
                """
                insert into live_market_bars_1m (symbol, bar_time, o, h, l, c, v, received_at, source)
                values (%s, %s, %s, %s, %s, %s, %s, now(), 'databento_live')
                on conflict (symbol, bar_time) do update
                  set o = excluded.o, h = excluded.h, l = excluded.l, c = excluded.c,
                      v = excluded.v, received_at = now()
                """,
                (symbol, bar_time, agg.o, agg.h, agg.l, agg.c, agg.v),
            )
        log.info("1m bar %s %s O=%.2f H=%.2f L=%.2f C=%.2f V=%d",
                  symbol, bar_time.isoformat(), agg.o, agg.h, agg.l, agg.c, agg.v)

    def handle_ohlcv1s(self, symbol: str, rec) -> None:  # noqa: ANN001 — dbn record type
        price = rec_px(rec, "pretty_close", "close")
        ts_dt = rec_ts(rec)

        # Tick table: always the latest print, every record.
        self.upsert_tick(symbol, price, ts_dt)

        # 1m aggregation from 1s bars.
        minute_ns = (int(ts_dt.timestamp()) // 60) * 60 * 1_000_000_000
        cur = self._minute.get(symbol)
        o = rec_px(rec, "pretty_open", "open")
        h = rec_px(rec, "pretty_high", "high")
        l = rec_px(rec, "pretty_low", "low")  # noqa: E741
        v = int(rec.volume) if hasattr(rec, "volume") else 0

        if cur is None or cur.minute_start_ns != minute_ns:
            if cur is not None:
                self.flush_minute_bar(symbol, cur)
            self._minute[symbol] = MinuteAgg(
                minute_start_ns=minute_ns, o=o, h=h, l=l, c=price, v=v
            )
        else:
            cur.h = max(cur.h, h)
            cur.l = min(cur.l, l)
            cur.c = price
            cur.v += v

    def run_once(self) -> None:
        """One connect-subscribe-stream cycle. Raises on disconnect/error —
        the caller's reconnect loop decides what happens next."""
        client = db.Live(key=self._api_key)
        client.subscribe(
            dataset=DATASET,
            schema=SCHEMA,
            stype_in="continuous",
            symbols=SYMBOLS,
        )
        log.info("subscribed: dataset=%s schema=%s symbols=%s", DATASET, SCHEMA, SYMBOLS)

        for record in client:
            if not self._running:
                break
            if not in_ny_am_window():
                log.info("NY AM window closed — dropping live socket")
                break
            # Only price records reach the aggregator. A SymbolMappingMsg
            # carries an instrument_id that DOES resolve (the client registers
            # the mapping before yielding the message), so the symbol check
            # below is not enough on its own — first run 2026-09-14 wrote
            # O=0 / L=0 minute bars because the mapping message seeded the
            # MinuteAgg with zeros and min() kept them.
            if not isinstance(record, db.OHLCVMsg):
                continue
            mapping = getattr(client, "symbology_map", None) or getattr(
                client, "symbology", None
            )
            dbn_symbol = None
            instrument_id = getattr(record, "instrument_id", None)
            if mapping is not None and instrument_id is not None:
                dbn_symbol = mapping.get(instrument_id)
            if dbn_symbol is None:
                # Symbol-mapping record or one we can't resolve yet — skip,
                # do not guess. A wrong symbol on a price row is worse than
                # a dropped record.
                continue
            desk_symbol = resolve_desk_symbol(dbn_symbol)
            if desk_symbol is None:
                continue
            try:
                self.handle_ohlcv1s(desk_symbol, record)
            except Exception:  # noqa: BLE001 — one bad record must not kill the stream
                log.exception("failed to process record for %s", desk_symbol)

    def run_forever(self) -> None:
        backoff = RECONNECT_MIN_SEC
        while self._running:
            if not in_ny_am_window():
                if EXIT_AFTER_WINDOW and window_closed_for_today():
                    log.info("window %s closed for today — exiting (GATEWAY_EXIT_AFTER_WINDOW=1)", window_label())
                    return
                log.info("outside %s — live socket idle", window_label())
                time.sleep(WINDOW_POLL_SEC)
                backoff = RECONNECT_MIN_SEC
                continue
            try:
                self.run_once()
                backoff = RECONNECT_MIN_SEC  # clean iteration exit -> reset
            except Exception:  # noqa: BLE001 — log and reconnect, never crash silent
                log.exception("stream error — reconnecting in %ss", backoff)
            if not self._running:
                break
            time.sleep(backoff)
            backoff = min(RECONNECT_MAX_SEC, backoff * 2)


def main() -> int:
    load_env_local()
    dsn = os.environ.get("DATABASE_URL")
    api_key = os.environ.get("DATABENTO_API_KEY")
    if not dsn:
        print("DATABASE_URL is not set", file=sys.stderr)
        return 1
    if not api_key:
        print("DATABENTO_API_KEY is not set", file=sys.stderr)
        return 1

    gateway = LiveGateway(dsn=dsn, api_key=api_key)
    signal.signal(signal.SIGTERM, gateway.stop)
    signal.signal(signal.SIGINT, gateway.stop)
    log.info("starting live gateway: dataset=%s symbols=%s", DATASET, SYMBOLS)
    gateway.run_forever()
    log.info("stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
