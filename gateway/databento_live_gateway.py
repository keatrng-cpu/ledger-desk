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

*** NOT YET RUN AGAINST A REAL CONNECTION ***
Written against Databento's documented Live API shape (`db.Live()`,
`.subscribe(dataset=, schema=, stype_in="continuous", symbols=[...])`,
continuous `.c.0` symbology is confirmed supported on Live as of their own
2026 blog post on the feature). The exact record-iteration idiom below
(`for record in client:`) is the package's standard streaming pattern to the
best of available knowledge, but the specific docs page confirming it could
not be fully retrieved while writing this. BEFORE THE FIRST REAL RUN:
  1. pip install -e ".[databento]"  (or: pip install databento>=0.34)
  2. Read https://databento.com/docs/api-reference-live/client/live and
     confirm the iteration/callback shape matches what is below — adjust if
     the installed version's API differs.
  3. Run with DATABENTO_API_KEY set and watch the log for the first few
     records before trusting it unattended.
This mirrors the existing house discipline in aplus/connect.py's
check_databento() — verify against the real thing before relying on it.

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

DATASET = os.environ.get("DATABENTO_DATASET", "GLBX.MDP3")
SYMBOLS = ["ES.c.0", "NQ.c.0"]
# 1s OHLCV — the finest fixed-interval schema Databento offers. Aggregated up
# into 1m bars below rather than requested as ohlcv-1m directly, so the tick
# table (which needs sub-second freshness) and the bar table share one
# subscription instead of opening two connections.
SCHEMA = "ohlcv-1s"

# Reconnect backoff. Never spin hot against the vendor on a bad key/network.
RECONNECT_MIN_SEC = 2
RECONNECT_MAX_SEC = 60


def resolve_desk_symbol(dbn_symbol: str) -> str | None:
    """Databento's continuous root ('ES', 'NQ') back to this desk's
    IndexSymbol vocabulary. MNQ has no direct continuous mapping requested
    here — the desk's MNQ read already comes from ES/NQ-derived structure
    elsewhere; this gateway only ever needs to feed ES and NQ ticks."""
    root = dbn_symbol.split(".")[0]
    if root in ("ES", "NQ"):
        return root
    return None


@dataclass
class MinuteAgg:
    """One in-progress 1-minute bar, built from 1s records."""

    minute_start_ns: int
    o: float
    h: float
    l: float  # noqa: E741 — matches the desk's OhlcBar field name
    c: float
    v: int


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
        price = float(rec.close) if hasattr(rec, "close") else float(rec.price)
        ts_event = getattr(rec, "ts_event", None) or getattr(rec, "hd", None) and rec.hd.ts_event
        ts_dt = (
            datetime.fromtimestamp(ts_event / 1e9, tz=timezone.utc)
            if ts_event
            else datetime.now(timezone.utc)
        )

        # Tick table: always the latest print, every record.
        self.upsert_tick(symbol, price, ts_dt)

        # 1m aggregation from 1s bars.
        minute_ns = (int(ts_dt.timestamp()) // 60) * 60 * 1_000_000_000
        cur = self._minute.get(symbol)
        o = float(rec.open) if hasattr(rec, "open") else price
        h = float(rec.high) if hasattr(rec, "high") else price
        l = float(rec.low) if hasattr(rec, "low") else price  # noqa: E741
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

        # Standard streaming idiom for this client — SEE THE MODULE
        # DOCSTRING: verify this against the installed package version's
        # docs before the first real run.
        for record in client:
            if not self._running:
                break
            symbol_map = getattr(client, "symbology", None)
            dbn_symbol = None
            instrument_id = getattr(record, "instrument_id", None)
            if symbol_map is not None and instrument_id is not None:
                dbn_symbol = symbol_map.get(instrument_id)
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
