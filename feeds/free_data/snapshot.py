"""Build the LOG-ONLY free-data feature snapshot (free-features.json) the desk/watcher shadow rows read.

  python -m feeds.free_data.snapshot --out /workspace/data/free-feeds/free-features.json [--bars live_bars.jsonl]

Sections: ff (FF weekly calendar, USD rows normalized to CT, next scoped print, 07:30 CT print-window flag),
vix (term structure), xasset (ZN/6E closed 1m, cost-guarded), orderflow (latest closed 30s/1m bar per symbol with
delta + session CVD, from a live_bars.jsonl written by live_trades.py or the paper loop). `live` is always false.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from . import load_config, ff_calendar, vix as vixm

CT = ZoneInfo("America/Chicago")


def latest_bars(path: str | None, max_lines=4000) -> dict:
    if not path or not os.path.exists(path):
        return {}
    with open(path, "rb") as f:
        f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 400_000))
        lines = f.read().decode(errors="ignore").splitlines()[-max_lines:]
    out: dict = {}
    for ln in lines:
        try:
            b = json.loads(ln)
        except ValueError:
            continue
        out.setdefault(b["symbol"], {})[f"{b['interval_s']}s"] = {k: b.get(k) for k in (
            "start_ct", "open", "high", "low", "close", "volume", "delta", "cvd", "session", "trades")}
    return out


XASSET_WINDOW_S = 3600      # round the pull window to the hour: one cache file / get_cost / cost_log row per hour
XASSET_KEEP_FILES = 6       # prune older xasset DBN caches (cost_log.jsonl is never pruned)


def xasset_window(data_end_utc: datetime, lookbacks_min, window_s: int = XASSET_WINDOW_S):
    """(start, end) with end floored to the window boundary, so every call within the same hour maps to the same
    request (same cache file, no new get_cost). Closed bars only: end <= data end."""
    e = data_end_utc.astimezone(timezone.utc).replace(microsecond=0)
    end = datetime.fromtimestamp((int(e.timestamp()) // window_s) * window_s, tz=timezone.utc)
    return end - timedelta(minutes=max(lookbacks_min) + 30), end


def prune_cache(cache_dir: str, keep: int = XASSET_KEEP_FILES) -> int:
    try:
        files = [os.path.join(cache_dir, f) for f in os.listdir(cache_dir) if f.endswith(".dbn.zst")]
    except OSError:
        return 0
    files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    n = 0
    for p in files[keep:]:
        try:
            os.remove(p); n += 1
        except OSError:
            pass
    return n


def xasset_read(cfg, now_utc: datetime) -> dict:
    try:
        import databento as db
        from . import dbguard, xasset
        client = db.Historical(os.environ["DATABENTO_API_KEY"])
        end = client.metadata.get_dataset_range(dataset="GLBX.MDP3")["schema"]["ohlcv-1m"]["end"]
        data_end = datetime.fromisoformat(end[:19]).replace(tzinfo=timezone.utc)
        start, end_dt = xasset_window(data_end, cfg["crossAsset"]["lookbacksMin"])
        cdir = os.path.join(cfg["historical"]["cacheDir"], "xasset")
        p = dbguard.pull(client, symbols=[f"{s}.v.0" for s in cfg["crossAsset"]["symbols"]], schema="ohlcv-1m",
                         start=start, end=end_dt, cfg=cfg, cache_dir=cdir)
        prune_cache(cdir)
        ser = xasset.closes_from_dbn(p)
        as_of = int(end_dt.timestamp() * 1e9)
        return {s: xasset.read(ser.get(s, []), as_of, cfg["crossAsset"]["lookbacksMin"]) for s in cfg["crossAsset"]["symbols"]} | {
            "data_end_utc": end_dt.isoformat(), "window_s": XASSET_WINDOW_S}
    except Exception as ex:
        return {"error": repr(ex)[:200]}


def build(cache_dir: str, now_ct: datetime, bars_path: str | None = None, with_xasset=True, cfg=None) -> dict:
    cfg = cfg or load_config()
    try:
        ev, meta = ff_calendar.fetch(cache_dir, cfg=cfg)   # never raises; belt and braces
    except Exception as ex:
        ev, meta = [], {"source": "cache-after-error", "status": "empty", "error": repr(ex)[:200]}
    rows = ff_calendar.normalize(ev, cfg)
    usd = [r for r in rows if r["country"] == "USD"]
    flag, hits = ff_calendar.print_window(rows, now_ct, cfg)
    series = vixm.fetch(cache_dir, cfg=cfg)
    snap = {
        "asOf": now_ct.astimezone(CT).isoformat(), "mode": "shadow", "live": False, "version": cfg["version"],
        "ff": {"source": meta.get("source"), "status": meta.get("status"), "fetchedAt": meta.get("fetched_at"), "usd": usd,
               "scoped": ff_calendar.scoped(rows), "nextPrint": ff_calendar.next_print(rows, now_ct),
               "printWindow": {"flag": flag, "events": [h["title"] for h in hits]},
               "actualsAvailable": any(r["actual"] is not None for r in rows)},
        "vix": vixm.term_structure(series, now_ct, cfg),
        "orderflow": latest_bars(bars_path),
    }
    if with_xasset:
        snap["xasset"] = xasset_read(cfg, datetime.now(timezone.utc))
    return snap


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="/workspace/data/free-feeds/free-features.json")
    ap.add_argument("--cache", default="/workspace/data/free-feeds")
    ap.add_argument("--bars")
    ap.add_argument("--no-xasset", action="store_true")
    a = ap.parse_args(argv)
    snap = build(a.cache, datetime.now(CT), a.bars, not a.no_xasset)
    tmp = a.out + ".part"
    with open(tmp, "w") as f:
        json.dump(snap, f, indent=1, default=str)
    os.replace(tmp, a.out)
    print(json.dumps({k: snap[k] for k in ("asOf", "vix")}, default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
