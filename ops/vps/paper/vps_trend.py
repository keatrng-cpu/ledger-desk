#!/usr/bin/env python3
"""VPS backup copy of the box paper-trend lane. PAPER ONLY: imports trend_paper.py unchanged (same rule code) and only
swaps the I/O: bars come from the gateway's Postgres table over the local DATABASE_URL (no service_role key on the VPS),
prior-day history from the Databento GLBX 1m cache kept by the nightly job, and output goes to $PAPER_DIR.
There is no broker client anywhere in this process."""
import datetime as D, os, sys
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.dirname(HERE))
import trend_paper as tp
from common import load_env

OUT = os.environ.get("PAPER_DIR", "/var/lib/ledger-paper"); HIST = os.environ.get("HIST_DIR", "/var/lib/ledger-archive/hist")
_conn = None

def pg_fetch(start, end=None):
    global _conn
    import psycopg
    if _conn is None or _conn.closed: _conn = psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=15, autocommit=True)
    q = "select bar_time,o,h,l,c from live_market_bars_1m where symbol=%s and bar_time>=%s" + (" and bar_time<%s" if end else "") + " order by bar_time"
    a = (tp.SYM, start) + ((end,) if end else ())
    try: rows = _conn.execute(q, a).fetchall()
    except Exception: _conn = None; raise
    return [dict(t=t.astimezone(tp.CT), o=float(o), h=float(h), l=float(l), c=float(c)) for t, o, h, l, c in rows]

def wire():
    os.makedirs(OUT, exist_ok=True)
    tp.CSV = os.path.join(OUT, "trades.csv"); tp.JL = os.path.join(OUT, "events.jsonl"); tp.ST = os.path.join(OUT, "state.json")
    tp.DBN = os.path.join(HIST, "NQ_1m.parquet"); tp.fetch = pg_fetch
    import fastpath; fastpath.install(tp)

if __name__ == "__main__":
    wire(); tp.main()   # env: /etc/ledger-ops/paper.env (DATABASE_URL for the read-only role only)
