import json
import os
import re

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
PKG = os.path.join(ROOT, "feeds", "free_data")


def test_config_is_shadow_and_outside_rules():
    cfg = json.load(open(os.path.join(ROOT, "shared", "free-data.json")))
    assert cfg["mode"] == "shadow" and cfg["live"] is False
    rules = open(os.path.join(ROOT, "shared", "desk-rules.json")).read()
    assert "free-data" not in rules and "freeData" not in rules


def test_package_never_touches_rules_brokers_or_orders():
    for fn in os.listdir(PKG):
        if fn.endswith(".py"):
            src = open(os.path.join(PKG, fn)).read()
            assert not re.search(r"""["'][^"'\n]*desk-rules\.json["']""", src), fn          # no path literal to the rules file
            assert not re.search(r"^\s*(from|import)\s+\S*(broker|robin_stocks|execution)", src, re.M), fn
            assert not re.search(r"\b(place_order|submit_order|order_buy|order_sell)\s*\(", src), fn
