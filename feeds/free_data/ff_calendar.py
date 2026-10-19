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


def _read_json(p, default):
    """Corrupt / truncated / wrong-type JSON never raises: returns `default`."""
    try:
        with open(p) as f:
            v = json.load(f)
        return v if isinstance(v, type(default)) else default
    except (OSError, ValueError):
        return default


def _save_meta(meta_p, meta):
    try:
        tmp = meta_p + ".part"
        with open(tmp, "w") as f:
            json.dump(meta, f)
        os.replace(tmp, meta_p)
    except OSError:
        pass


def fetch(cache_dir: str, now: float | None = None, session=None, cfg=None):
    """Return (events, meta). NEVER raises (snapshot.build relies on it; parity with TS refresh(): keep last good).
    meta.source in {cache, network, cache-after-error, cache-backoff}; meta.status is a flag:
    ok | stale (served cache after a failure) | empty (failure and no usable cache)."""
    c = (cfg or load_config())["ffCalendar"]
    now = now or time.time()
    path = os.path.join(cache_dir, "ff_calendar_thisweek.json")
    meta_p = os.path.join(cache_dir, "ff_calendar_meta.json")
    try:
        os.makedirs(cache_dir, exist_ok=True)
    except OSError:
        pass
    meta = _read_json(meta_p, {})
    if os.path.exists(meta_p) and not meta:
        meta = {"meta_reset": "corrupt meta ignored"}

    def cached(src, err=None):
        ev = _read_json(path, [])
        out = {**meta, "source": src}
        out["status"] = "ok" if src in ("cache", "network") and ev else ("stale" if ev else "empty")
        if err:
            out["error"] = err
        return ev, out

    try:
        has_cache = bool(_read_json(path, []))
        if has_cache and now - os.path.getmtime(path) < c["minFetchIntervalS"]:
            return cached("cache")
        try:
            backoff = float(meta.get("backoff_until", 0) or 0)
        except (TypeError, ValueError):
            backoff = 0.0
        if now < backoff:
            return cached("cache-backoff")
        if session is None:
            import requests
            session = requests
        headers = {"User-Agent": UA}
        if has_cache:   # conditional GET only when a 304 could be served from cache
            if meta.get("etag"):
                headers["If-None-Match"] = meta["etag"]
            if meta.get("last_modified"):
                headers["If-Modified-Since"] = meta["last_modified"]
        try:
            r = session.get(c["url"], headers=headers, timeout=10)
        except Exception as ex:  # network error -> cache
            meta["last_error"] = repr(ex)[:200]
            _save_meta(meta_p, meta)
            return cached("cache-after-error", "network")
        meta["last_status"], meta["last_attempt"] = r.status_code, now
        if r.status_code == 429:
            ra = r.headers.get("Retry-After")
            wait = float(ra) if ra and str(ra).isdigit() else float(c["backoff429S"])
            meta["backoff_until"] = now + max(wait, float(c["minFetchIntervalS"]))
            _save_meta(meta_p, meta)
            return cached("cache-backoff", "429")
        if r.status_code == 304:
            if not has_cache:   # 304 but nothing to serve: drop validators so the next try is a full GET
                meta.pop("etag", None); meta.pop("last_modified", None)
                _save_meta(meta_p, meta)
                return cached("cache-after-error", "304-no-cache")
            os.utime(path, (now, now))
            _save_meta(meta_p, meta)
            return cached("cache")
        if r.status_code != 200:
            _save_meta(meta_p, meta)
            return cached("cache-after-error", f"http-{r.status_code}")
        try:
            ev = r.json()   # FF answers 200 with an HTML "Request Denied" page when it throttles
        except Exception:
            ev = None
        if not isinstance(ev, list):
            meta["last_error"] = "non-json 200 (Request Denied?)"
            meta["backoff_until"] = now + float(c["minFetchIntervalS"])
            _save_meta(meta_p, meta)
            return cached("cache-after-error", "denied-html")
        tmp = path + ".part"
        with open(tmp, "w") as f:
            json.dump(ev, f)
        os.replace(tmp, path)
        os.utime(path, (now, now))
        meta.update(etag=r.headers.get("ETag"), last_modified=r.headers.get("Last-Modified"), fetched_at=now, backoff_until=0)
        meta.pop("last_error", None)
        _save_meta(meta_p, meta)
        return ev, {**meta, "source": "network", "status": "ok"}
    except Exception as ex:   # last resort: never raise into snapshot.build
        return cached("cache-after-error", f"unexpected:{ex.__class__.__name__}")
