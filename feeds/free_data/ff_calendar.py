"""Forex Factory free weekly calendar (nfs.faireconomy.media/ff_calendar_thisweek.json), LOG-ONLY.

Polite fetch: the cached copy is used if it is younger than ffCalendar.minFetchIntervalS (15 min); a 429 sets a
back-off (Retry-After, else backoff429S) persisted next to the cache, during which no request is made. Any fetch
error falls back to the cached copy. The existing news gate (gates.news_blackout / src/lib/trading/news.ts) is NOT
changed; the print-window flag here is a shadow fact only.

The free feed carries title/country/date/impact/forecast/previous. It does NOT carry `actual` (checked 2026-10-18,
JSON and XML). surprise_sign is computed whenever an `actual` value is present (field in the feed, or a later
merge), else it stays None.
"""
from __future__ import annotations

import json
import os
import re
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from . import load_config

CT = ZoneInfo("America/Chicago")
UA = "ledger-desk-free-data/1.0 (cached, <=1 req/15min)"
_NUM = re.compile(r"^\s*([<>]?)\s*(-?\d+(?:\.\d+)?)\s*([KMBT%]?)\s*$", re.I)
_MULT = {"": 1.0, "%": 1.0, "K": 1e3, "M": 1e6, "B": 1e9, "T": 1e12}


def parse_num(v):
    """'1.30M' -> 1300000.0, '200K' -> 200000.0, '-0.2%' -> -0.2, '' / None / unparseable -> None."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = _NUM.match(str(v).replace(",", ""))
    if not m:
        return None
    return float(m.group(2)) * _MULT[m.group(3).upper()]


def surprise_sign(actual, forecast):
    """sign(actual - forecast): +1 above forecast, -1 below, 0 in line, None if either side is missing.
    Raw sign only -- no 'good/bad for USD' interpretation (claims/unemployment are inverse)."""
    a, f = parse_num(actual), parse_num(forecast)
    if a is None or f is None:
        return None
    d = round(a - f, 10)
    return 1 if d > 0 else -1 if d < 0 else 0


def normalize(events, cfg=None):
    c = (cfg or load_config())["ffCalendar"]
    out = []
    for e in events or []:
        try:
            t = datetime.fromisoformat(str(e["date"]))
        except (KeyError, ValueError):
            continue
        ct = t.astimezone(CT)
        actual = e.get("actual")
        row = {
            "title": e.get("title"), "country": e.get("country"), "impact": e.get("impact"),
            "ts_ct": ct.isoformat(), "date_ct": ct.date().isoformat(), "time_ct": ct.strftime("%H:%M"),
            "forecast": e.get("forecast") or None, "previous": e.get("previous") or None, "actual": actual or None,
            "forecast_num": parse_num(e.get("forecast")), "previous_num": parse_num(e.get("previous")),
            "actual_num": parse_num(actual), "surprise_sign": surprise_sign(actual, e.get("forecast")),
            "in_scope": e.get("country") in c["countries"] and e.get("impact") in c["impacts"],
        }
        out.append(row)
    out.sort(key=lambda r: r["ts_ct"])
    return out


def scoped(rows):
    return [r for r in rows if r["in_scope"]]


def print_window(rows, now_ct: datetime, cfg=None):
    """Shadow flag: True when now is within [-beforeMin, +afterMin] of a configured-time (07:30 CT) print in a
    configured country (USD), any impact. Returns (flag, events_in_window)."""
    pw = (cfg or load_config())["ffCalendar"]["printWindow"]
    now_ct = now_ct.astimezone(CT)
    hits = []
    for r in rows:
        if r["country"] not in pw["countries"] or r["time_ct"] not in pw["timesCt"]:
            continue
        t = datetime.fromisoformat(r["ts_ct"])
        if t - timedelta(minutes=pw["beforeMin"]) <= now_ct <= t + timedelta(minutes=pw["afterMin"]):
            hits.append(r)
    return bool(hits), hits


def next_print(rows, now_ct: datetime, scoped_only=True):
    now_ct = now_ct.astimezone(CT)
    for r in rows:
        if scoped_only and not r["in_scope"]:
            continue
        if datetime.fromisoformat(r["ts_ct"]) >= now_ct:
            return r
    return None


def fetch(cache_dir: str, now: float | None = None, session=None, cfg=None):
    """Return (events, meta). meta.source in {cache, network, cache-after-error, cache-backoff}."""
    c = (cfg or load_config())["ffCalendar"]
    now = now or time.time()
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, "ff_calendar_thisweek.json")
    meta_p = os.path.join(cache_dir, "ff_calendar_meta.json")
    meta = json.load(open(meta_p)) if os.path.exists(meta_p) else {}

    def cached(src):
        ev = json.load(open(path)) if os.path.exists(path) else []
        return ev, {**meta, "source": src}

    if os.path.exists(path) and now - os.path.getmtime(path) < c["minFetchIntervalS"]:
        return cached("cache")
    if now < float(meta.get("backoff_until", 0)):
        return cached("cache-backoff")
    if session is None:
        import requests
        session = requests
    headers = {"User-Agent": UA}
    if meta.get("etag"):
        headers["If-None-Match"] = meta["etag"]
    if meta.get("last_modified"):
        headers["If-Modified-Since"] = meta["last_modified"]
    try:
        r = session.get(c["url"], headers=headers, timeout=10)
    except Exception as ex:  # network error -> cache
        meta["last_error"] = repr(ex)[:200]
        json.dump(meta, open(meta_p, "w"))
        return cached("cache-after-error")
    meta["last_status"], meta["last_attempt"] = r.status_code, now
    if r.status_code == 429:
        ra = r.headers.get("Retry-After")
        wait = float(ra) if ra and str(ra).isdigit() else float(c["backoff429S"])
        meta["backoff_until"] = now + max(wait, float(c["minFetchIntervalS"]))
        json.dump(meta, open(meta_p, "w"))
        return cached("cache-backoff")
    if r.status_code == 304:
        os.utime(path, (now, now))
        json.dump(meta, open(meta_p, "w"))
        return cached("cache")
    if r.status_code != 200:
        json.dump(meta, open(meta_p, "w"))
        return cached("cache-after-error")
    ev = r.json()
    tmp = path + ".part"
    with open(tmp, "w") as f:
        json.dump(ev, f)
    os.replace(tmp, path)
    os.utime(path, (now, now))
    meta.update(etag=r.headers.get("ETag"), last_modified=r.headers.get("Last-Modified"), fetched_at=now, backoff_until=0)
    json.dump(meta, open(meta_p, "w"))
    return ev, {**meta, "source": "network"}
