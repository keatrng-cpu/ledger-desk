#!/usr/bin/env python3
"""Nightly archive (~17:15 ET weekdays): the day's GLBX 1m bars for ES/NQ/MNQ ($0, get_cost checked first — abort if > 0),
the gateway's own live 1m bars, desk card snapshots, and the rolling history cache used by the VPS paper lane.
Layout: /var/lib/ledger-archive/YYYY/MM/DD/{glbx_ohlcv1m.parquet, live_bars_1m.parquet, desk_card.json.gz}.
Retention: oldest day dirs are deleted while the archive (excluding hist/) exceeds ARCHIVE_MAX_GB (3)."""
import datetime as D, gzip, json, os, shutil, sys, urllib.request as R
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import load_env, ET, UTC, jlog
import dbhist
ROOT = os.environ.get("ARCHIVE_DIR", "/var/lib/ledger-archive"); MAX = float(os.environ.get("ARCHIVE_MAX_GB", "3")) * 2**30
CARD = os.environ.get("CARD_URL", "https://ledgeyourtrades.netlify.app/api/desk/card"); LOG = "/var/log/ledger-ops/archive.log"

def dir_size(p):
    return sum(os.path.getsize(os.path.join(a, f)) for a, _, fs in os.walk(p) for f in fs)

def day_dirs(root):
    out = []
    for y in sorted(os.listdir(root)) if os.path.isdir(root) else []:
        if not y.isdigit(): continue
        for m in sorted(os.listdir(os.path.join(root, y))):
            for d in sorted(os.listdir(os.path.join(root, y, m))): out.append(os.path.join(root, y, m, d))
    return out

def enforce_retention(root, max_bytes, keep_min=1):
    removed = []; dirs = day_dirs(root)
    while len(dirs) > keep_min and sum(dir_size(d) for d in dirs) > max_bytes:
        d = dirs.pop(0); shutil.rmtree(d); removed.append(d)
    return removed

def main(day=None):
    load_env(); import psycopg
    day = day or D.datetime.now(ET).date()
    start = D.datetime.combine(day - D.timedelta(days=1), D.time(18), ET).astimezone(UTC)   # Globex session: prior 18:00 ET ...
    end = min(D.datetime.combine(day, D.time(17), ET).astimezone(UTC), D.datetime.now(UTC) - D.timedelta(minutes=20))
    out = os.path.join(ROOT, f"{day:%Y/%m/%d}"); os.makedirs(out, exist_ok=True); os.makedirs(os.path.join(ROOT, "hist"), exist_ok=True)
    rep = dict(day=str(day))
    cl = dbhist.client()
    df, cost = dbhist.pull(cl, list(dbhist.ROOTS.values()), start.isoformat(), end.isoformat())   # raises CostAbort if > $0
    df.to_parquet(os.path.join(out, "glbx_ohlcv1m.parquet"), compression="zstd"); rep.update(glbx_rows=len(df), cost_usd=cost)
    import pandas as pd
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=15) as c:
        rows = c.execute("select symbol,bar_time,o,h,l,c from live_market_bars_1m where bar_time>=%s and bar_time<%s order by 1,2", (start, end)).fetchall()
    pd.DataFrame(rows, columns=["symbol", "bar_time", "o", "h", "l", "c"]).to_parquet(os.path.join(out, "live_bars_1m.parquet"), compression="zstd"); rep["live_rows"] = len(rows)
    try:
        b = R.urlopen(R.Request(CARD, headers={"User-Agent": "ledger-vps-archive"}), timeout=30).read()
        with gzip.open(os.path.join(out, "desk_card.json.gz"), "wb") as f: f.write(b)
        rep["card_bytes"] = len(b)
    except Exception as e: rep["card_error"] = repr(e)[:160]
    for root in ("NQ",):   # rolling 60d cache for the VPS paper lane + backtest
        h, c2 = dbhist.refresh_history(os.path.join(ROOT, "hist", f"{root}_1m.parquet"), root, cl=cl); rep[f"hist_{root}_rows"] = len(h); rep["cost_usd"] += c2
    rep["removed"] = enforce_retention(ROOT, MAX); rep["archive_bytes"] = dir_size(ROOT)
    jlog(LOG, **rep); print(json.dumps(rep, default=str))

if __name__ == "__main__":
    a = [x for x in sys.argv[1:] if not x.startswith("-")]
    main(D.date.fromisoformat(a[0]) if a else None)
