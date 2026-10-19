"""Free data feeds (shadow / log-only). Nothing in this package reads or writes shared/desk-rules.json, places orders,
or feeds a gate. Config: shared/free-data.json. See docs/free-data-1018/README.md."""
import json as _json
import os as _os

_HERE = _os.path.dirname(_os.path.abspath(__file__))
CONFIG_PATH = _os.environ.get("FREE_DATA_CONFIG") or _os.path.normpath(_os.path.join(_HERE, "..", "..", "shared", "free-data.json"))


def load_config(path=None):
    with open(path or CONFIG_PATH, encoding="utf-8") as f:
        cfg = _json.load(f)
    assert cfg.get("mode") == "shadow" and cfg.get("live") is False, "free-data must stay shadow/log-only"
    return cfg
