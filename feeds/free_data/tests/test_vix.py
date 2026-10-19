from datetime import datetime
from zoneinfo import ZoneInfo

from feeds.free_data import vix

CT = ZoneInfo("America/Chicago")
CSV = "DATE,OPEN,HIGH,LOW,CLOSE\n10/15/2026,1,1,1,{a}\n10/16/2026,1,1,1,{b}\n10/19/2026,1,1,1,{c}\n"


def test_ratios_and_regimes():
    r = vix.ratios(19.99, 20.12, 20.50)
    assert r["vix9d_vix"] == round(20.12 / 19.99, 4) and r["vix_vix3m"] == round(19.99 / 20.50, 4)
    assert r["regime"] == "flat" and r["front_inverted"] is True
    assert vix.ratios(15, 13, 18)["regime"] == "contango" and vix.ratios(15, 13, 18)["front_inverted"] is False
    assert vix.ratios(30, 33, 28)["regime"] == "backwardation"
    assert vix.ratios(18, 17, 20)["regime"] == "flat"          # 0.9 boundary is flat
    assert vix.ratios(17.99, 17, 20)["regime"] == "contango"


def test_parse_csv():
    s = vix.parse_csv(CSV.format(a=16.46, b=19.99, c=21))
    assert s == {"2026-10-15": 16.46, "2026-10-16": 19.99, "2026-10-19": 21.0}


def test_term_structure_closed_days_only():
    ser = {"VIX": vix.parse_csv(CSV.format(a=16.46, b=19.99, c=25)),
           "VIX9D": vix.parse_csv(CSV.format(a=13.97, b=20.12, c=30)),
           "VIX3M": vix.parse_csv(CSV.format(a=18.49, b=20.50, c=22))}
    pre = vix.term_structure(ser, datetime(2026, 10, 19, 10, 0, tzinfo=CT))   # today's row exists but not settled
    assert pre["date"] == "2026-10-16" and pre["regime"] == "flat" and pre["prev"]["date"] == "2026-10-15"
    post = vix.term_structure(ser, datetime(2026, 10, 19, 15, 30, tzinfo=CT))
    assert post["date"] == "2026-10-19" and post["regime"] == "backwardation"
