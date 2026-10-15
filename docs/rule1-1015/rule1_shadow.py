"""Rule 1 SHADOW logger for desk-watcher (ledger-desk shared/rule1.json, audits/entry-target-1015).

Reads the desk feed's `rule1` tickets and appends what the watcher WOULD have fired to rule1_shadow.jsonl
(contracts, strike at delta 0.5-0.7, entry/stop/target). It never imports the broker, never places or stages an
order, and does not touch gates, firing or the rules hash. One row per (day, symbol, side, at).
The dedupe survives a watcher restart: load_seen() re-reads today's (America/Chicago) rows from the file on start.
"""
import json, os, time
from datetime import datetime
from zoneinfo import ZoneInfo

CT = ZoneInfo("America/Chicago")

FILE = "rule1_shadow.jsonl"


def rows_from_feed(card, seen, now_ms=None):
    out = []
    for tk in (card or {}).get("rule1") or []:
        if not isinstance(tk, dict) or tk.get("mode") != "shadow":
            continue
        k = (tk.get("symbol"), tk.get("side"), tk.get("at"))
        if k in seen:
            continue
        seen.add(k)
        o = tk.get("option") or {}
        d = o.get("delta")
        out.append({
            "ts": now_ms or int(time.time() * 1000), "kind": "rule1_would_fire", "broker": False, "orders": 0,
            "symbol": tk.get("symbol"), "side": tk.get("side"), "at": tk.get("at"), "swept": tk.get("swept"), "bonus": tk.get("bonus"),
            "entry": tk.get("entry"), "stop": tk.get("stop"), "target": tk.get("target"), "runner": tk.get("runner"),
            "underlier": o.get("underlier"), "right": o.get("right"), "strike": o.get("strike"), "delta": d,
            "delta_ok": d is not None and 0.5 <= d <= 0.7, "contracts": o.get("contracts"), "premium": o.get("premium"), "dte": o.get("dte"),
        })
    return out


def log(path_dir, card, seen, now_ms=None):
    rows = rows_from_feed(card, seen, now_ms)
    if rows:
        with open(os.path.join(path_dir, FILE), "a") as f:
            for r in rows:
                f.write(json.dumps(r) + "\n")
    return rows


def _ct_day(ms):
    return datetime.fromtimestamp(ms / 1000, CT).date()


def load_seen(path_dir, now_ms=None):
    """Keys (symbol, side, at) already logged TODAY (CT), so a restarted watcher never re-logs the same ticket."""
    seen = set()
    today = _ct_day(now_ms or int(time.time() * 1000))
    try:
        with open(os.path.join(path_dir, FILE)) as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(r, dict):   # a valid JSON line that is not an object (list, number, null) is skipped
                    continue
                if r.get("kind") == "rule1_would_fire" and isinstance(r.get("ts"), (int, float)) and _ct_day(r["ts"]) == today:
                    seen.add((r.get("symbol"), r.get("side"), r.get("at")))
    except OSError:   # missing, unreadable or a directory: start with an empty set, never crash the watcher
        pass
    return seen
