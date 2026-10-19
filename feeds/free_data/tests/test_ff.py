import json
import os
from datetime import datetime
from zoneinfo import ZoneInfo

import pytest

from feeds.free_data import ff_calendar as ff

CT = ZoneInfo("America/Chicago")
FIX = os.path.join(os.path.dirname(__file__), "fixtures", "ff_thisweek_20261018.json")


def rows():
    return ff.normalize(json.load(open(FIX)))


def test_parse_num():
    assert ff.parse_num("1.30M") == 1_300_000 and ff.parse_num("200K") == 200_000 and ff.parse_num("-0.4%") == -0.4
    assert ff.parse_num("67B") == 67e9 and ff.parse_num("") is None and ff.parse_num(None) is None and ff.parse_num("n/a") is None
    assert ff.parse_num("<0.1%") == 0.1


def test_surprise_sign():
    assert ff.surprise_sign("1.35M", "1.30M") == 1
    assert ff.surprise_sign("1.25M", "1.30M") == -1
    assert ff.surprise_sign("1.30M", "1.30M") == 0
    assert ff.surprise_sign("205K", "200K") == 1          # raw sign only, no USD-good/bad interpretation
    assert ff.surprise_sign(None, "1.30M") is None and ff.surprise_sign("1.3M", "") is None


def test_normalize_ct_and_housing_starts_row():
    r = [x for x in rows() if x["title"] == "Housing Starts"][0]
    assert r["ts_ct"] == "2026-10-20T07:30:00-05:00" and r["time_ct"] == "07:30" and r["date_ct"] == "2026-10-20"
    assert r["forecast"] == "1.30M" and r["forecast_num"] == 1_300_000 and r["previous"] == "1.28M"
    assert r["actual"] is None and r["surprise_sign"] is None
    assert r["impact"] == "Low" and r["in_scope"] is False   # FF rates it Low -> outside the USD high/medium scope


def test_scope_is_usd_high_medium():
    sc = ff.scoped(rows())
    assert sc and all(x["country"] == "USD" and x["impact"] in ("High", "Medium") for x in sc)
    assert any(x["title"] == "Unemployment Claims" for x in sc)


def test_actual_present_gives_surprise():
    ev = [{"title": "X", "country": "USD", "date": "2026-10-22T08:30:00-04:00", "impact": "High", "forecast": "200K",
           "previous": "199K", "actual": "190K"}]
    r = ff.normalize(ev)[0]
    assert r["surprise_sign"] == -1 and r["in_scope"]


def test_print_window_0730_ct():
    rs = rows()
    at = lambda h, m: datetime(2026, 10, 20, h, m, tzinfo=CT)
    assert ff.print_window(rs, at(7, 24))[0] is False
    flag, hits = ff.print_window(rs, at(7, 25))
    assert flag and {h["title"] for h in hits} == {"Housing Starts", "Building Permits"}
    assert ff.print_window(rs, at(7, 45))[0] is True and ff.print_window(rs, at(7, 46))[0] is False
    assert ff.print_window(rs, datetime(2026, 10, 23, 8, 45, tzinfo=CT))[0] is False   # 08:45 CT PMI is not a 07:30 print


class _Resp:
    def __init__(self, code, body=None, headers=None):
        self.status_code, self._b, self.headers = code, body, headers or {}

    def json(self):
        return self._b


class _Sess:
    def __init__(self, resp):
        self.resp, self.calls = resp, 0

    def get(self, *a, **k):
        self.calls += 1
        return self.resp


def test_fetch_caches_15min_and_backs_off_on_429(tmp_path):
    body = json.load(open(FIX))
    s = _Sess(_Resp(200, body, {"ETag": "x"}))
    ev, m = ff.fetch(str(tmp_path), now=1000.0, session=s)
    assert m["source"] == "network" and len(ev) == len(body) and s.calls == 1
    ev, m = ff.fetch(str(tmp_path), now=1000.0 + 899, session=s)
    assert m["source"] == "cache" and s.calls == 1             # < 15 min -> no request
    s429 = _Sess(_Resp(429, headers={"Retry-After": "3600"}))
    ev, m = ff.fetch(str(tmp_path), now=1000.0 + 901, session=s429)
    assert m["source"] == "cache-backoff" and len(ev) == len(body) and s429.calls == 1
    ev, m = ff.fetch(str(tmp_path), now=1000.0 + 2000, session=s429)
    assert m["source"] == "cache-backoff" and s429.calls == 1  # still backing off -> no request
    ev, m = ff.fetch(str(tmp_path), now=1000.0 + 901 + 3601, session=s)
    assert m["source"] == "network" and s.calls == 2


def test_fetch_error_falls_back_to_cache(tmp_path):
    body = json.load(open(FIX))
    ff.fetch(str(tmp_path), now=1000.0, session=_Sess(_Resp(200, body)))

    class Boom:
        def get(self, *a, **k):
            raise ConnectionError("down")
    ev, m = ff.fetch(str(tmp_path), now=5000.0, session=Boom())
    assert m["source"] == "cache-after-error" and len(ev) == len(body)
