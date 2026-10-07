"""Fixture checks. No network. A mutant that drops the swing test fails here.

    python3 brainlab/selfcheck.py
"""

from __future__ import annotations

import sys
import tempfile
from pathlib import Path

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bars import mt5_bars  # noqa: E402
from intake import parse_issue, render  # noqa: E402
from legs import atr, legs, say  # noqa: E402
from memory import recall, remember  # noqa: E402

fail = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global fail
    if not ok:
        fail += 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else ' — ' + detail}")


high = [10, 11, 12, 13, 14, 20, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 6, 7, 8, 9]
low = [h - 1 for h in high]
close = [(h + l) / 2 for h, l in zip(high, low)]
open_ = close[:]
idx = pd.date_range("2026-01-01", periods=20, freq="h")
df = pd.DataFrame({"open": open_, "high": high, "low": low, "close": close}, index=idx)

found = legs(df)
check("a high and a low make one leg", len(found) >= 1 and found[0]["high"] == 20 and found[0]["low"] == 4, str(found[:1]))
check("the leg's prices are prints from the bars", all(x["high"] in high and x["low"] in low for x in found))
scale = atr(df)
check("ATR is a series from these bars", len(scale) == len(df) and scale.notna().any())
line = say("MNQ", df)
check("the sentence names the high that printed", "20.00" in line and "MNQ" in line, line)

parsed = parse_issue("MNQ short idea", "sweep of the high then a 1m inverse")
check("an issue with MNQ short is read as that", parsed["symbol"] == "MNQ" and parsed["side"] == "short")
check("an issue with no symbol is not given one", parse_issue("hello", "just a note")["symbol"] is None)
check("the comment says it is not an order", "not an order" in render(parsed))

try:
    mt5_bars("MNQ")
    check("MetaTrader 5 fails closed when the terminal is absent", False, "it returned bars")
except RuntimeError as e:
    check("MetaTrader 5 fails closed when the terminal is absent", "Windows" in str(e), str(e))

with tempfile.TemporaryDirectory() as tmp:
    remember("sample", "MNQ short after the sweep, then the 1 minute inverse.", Path(tmp))
    hits = recall("inverse after a sweep", path=Path(tmp))
    check("a stored note comes back", any("inverse" in h["text"] for h in hits), str(hits))

print(f"\n{fail} failed" if fail else "\nall passed")
sys.exit(1 if fail else 0)
