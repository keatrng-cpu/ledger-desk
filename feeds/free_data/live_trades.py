"""Databento LIVE trades (GLBX.MDP3, ES/NQ continuous front month) -> closed 30s/1m bars with delta + session CVD.

LOG-ONLY. Writes one JSON line per CLOSED bar to <out_dir>/live_bars.jsonl. Never imports a broker, never feeds a
gate. Bars are bucketed on ts_recv (parity with Databento ohlcv-1m, see bars.py) and closed by the next trade or by
the wall clock passing end + closeGraceMs.

Cost: live GLBX.MDP3 is believed to be flat-fee on the account's Databento Standard plan (no per-message billing for
CME since 2025-04-16). That CANNOT be verified by API (get_cost covers historical only), so live is refused unless
DATABENTO_LIVE_ALLOWED=1 is set explicitly; see docs/free-data-1018/README.md. Network: the Live API is raw
TCP on port 13000 (glbx-mdp3.lsg.databento.com). `preflight()` checks reachability first; hosts that only allow 443
egress (the box) cannot run this -- use the replay mode there.

  python -m feeds.free_data.live_trades --out /workspace/data/free-feeds            # live
  python -m feeds.free_data.live_trades --replay <trades.dbn.zst> --out /tmp/replay  # historical replay
"""
from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time

from . import load_config
from .bars import TradeBarBuilder, side_char

LIVE_HOST, LIVE_PORT = "glbx-mdp3.lsg.databento.com", 13000
LIVE_ALLOW_ENV = "DATABENTO_LIVE_ALLOWED"


def live_allowed(env=None) -> tuple[bool, str]:
    """Explicit opt-in: live only when DATABENTO_LIVE_ALLOWED is exactly "1" (live cost is not API-verifiable)."""
    v = (os.environ if env is None else env).get(LIVE_ALLOW_ENV)
    if v == "1":
        return True, f"{LIVE_ALLOW_ENV}=1"
    return False, (f"refusing to start Databento LIVE: set {LIVE_ALLOW_ENV}=1 to allow (live is flat-fee on the "
                   "Standard plan per Databento pricing, but that is not verifiable by API)")


def preflight(timeout=5.0) -> tuple[bool, str]:
    try:
        with socket.create_connection((LIVE_HOST, LIVE_PORT), timeout=timeout):
            return True, f"{LIVE_HOST}:{LIVE_PORT} reachable"
    except OSError as ex:
        return False, f"{LIVE_HOST}:{LIVE_PORT} unreachable ({ex.__class__.__name__}) -- this host cannot hold a Databento Live session"


class BarSink:
    def __init__(self, out_dir: str | None, echo=True):
        self.path = os.path.join(out_dir, "live_bars.jsonl") if out_dir else None
        if out_dir:
            os.makedirs(out_dir, exist_ok=True)
        self.echo = echo

    def __call__(self, bars):
        for b in bars:
            if self.path:
                with open(self.path, "a") as f:
                    f.write(json.dumps(b.to_dict()) + "\n")
            if self.echo:
                print("BAR", b.log_line(), flush=True)


class Router:
    """instrument_id -> root symbol -> builder. Roll-safe: the id map comes from SymbolMappingMsg / DBN mappings."""

    def __init__(self, symbols, cfg, sink):
        of = cfg["orderflow"]
        self.builders = {s: TradeBarBuilder(s, of["intervalsS"], of["closeGraceMs"]) for s in symbols}
        self.ids: dict[int, str] = {}
        self.sink = sink

    def map(self, iid: int, symbol: str):
        root = str(symbol).split(".")[0]
        if root in self.builders:
            self.ids[int(iid)] = root

    def trade(self, iid, ts_recv, price, size, side):
        root = self.ids.get(int(iid))
        if root:
            self.sink(self.builders[root].on_trade(int(ts_recv), float(price), int(size), side_char(side)))

    def clock(self, now_ns):
        for b in self.builders.values():
            self.sink(b.on_clock(now_ns))


def replay(path: str, out_dir: str | None, cfg=None, echo=False):
    from .dbguard import iter_trades, symbol_map
    cfg = cfg or load_config()
    sink = BarSink(out_dir, echo)
    r = Router(cfg["orderflow"]["symbols"], cfg, sink)
    for iid, root in symbol_map(path).items():
        r.map(iid, root)
    last = 0
    for ts, px, sz, sd, iid in iter_trades(path):
        r.trade(iid, ts, px, sz, sd)
        last = ts
    return r, last


def run_live(out_dir: str, cfg=None):  # pragma: no cover - needs TCP 13000
    ok, why = live_allowed()
    if not ok:
        print(why, file=sys.stderr, flush=True)
        return 3
    import databento as db
    cfg = cfg or load_config()
    ok, why = preflight()
    print(why, flush=True)
    if not ok:
        return 2
    of = cfg["orderflow"]
    sink = BarSink(out_dir)
    router = Router(of["symbols"], cfg, sink)
    backoff = 1.0
    while True:
        try:
            client = db.Live(key=os.environ["DATABENTO_API_KEY"], heartbeat_interval_s=5)
            client.subscribe(dataset=of["dataset"], schema=of["schema"], stype_in="continuous",
                             symbols=[f"{s}.v.0" for s in of["symbols"]])
            client.start()
            backoff = 1.0
            last_clock = 0.0
            for rec in client:
                name = type(rec).__name__
                if name == "SymbolMappingMsg":
                    router.map(rec.instrument_id, getattr(rec, "stype_in_symbol", ""))
                elif name == "TradeMsg":
                    router.trade(rec.instrument_id, rec.ts_recv, rec.pretty_price, rec.size, rec.side)
                elif name == "ErrorMsg":
                    print("databento error:", getattr(rec, "err", rec), flush=True)
                now = time.time()
                if now - last_clock >= 0.5:
                    router.clock(int(now * 1e9)); last_clock = now
        except KeyboardInterrupt:
            return 0
        except Exception as ex:
            print("live error, reconnecting:", repr(ex)[:200], flush=True)
            time.sleep(backoff); backoff = min(backoff * 2, 60)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/workspace/data/free-feeds")
    ap.add_argument("--replay")
    a = ap.parse_args(argv)
    if a.replay:
        r, last = replay(a.replay, a.out, echo=True)
        return 0
    return run_live(a.out)


if __name__ == "__main__":
    sys.exit(main())
