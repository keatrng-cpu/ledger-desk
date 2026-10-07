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
from quotes import parse_quote  # noqa: E402
from router import judge  # noqa: E402
from gitnote import assert_paths, commit_notes, write_note  # noqa: E402
from fills import mark_filled, record  # noqa: E402
import numpy as np  # noqa: E402
import subprocess  # noqa: E402

fail = 0


def check(name: str, ok: bool, detail: str = "") -> None:
    global fail
    if not ok:
        fail += 1
    print(f"  {'ok  ' if ok else 'FAIL'} {name}{'' if ok else ' — ' + detail}")


def _raises(fn) -> bool:
    try:
        fn()
    except ValueError:
        return True
    return False


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

calm = list(np.linspace(100, 101, 40))
with tempfile.TemporaryDirectory() as gate_dir:
    db = Path(gate_dir) / "fills.sqlite"
    fresh = {
    "symbol": "QQQ",
    "expiration": "2026-10-08",
    "strike": 500,
    "right": "put",
    "qty": 1,
    "debit": 200,
    "buying_power": 800,
    "bid": 1.00,
    "ask": 1.05,
    "quote_ts_ms": 1_000,
    "now_ms": 1_000,
    "closes": calm,
}
    held = judge(fresh, db)
    check("a clean quote is usable and not sent", held["status"] == "usable" and held["sent"] is False and abs(held["limit"] - 1.07) < 1e-9, str(held))
    wide = judge({**fresh, "ask": 1.50}, db)
    check("a wide spread is unusable", wide["status"] == "unusable" and "wide_spread" in wide["reason"], wide["reason"])
    poor = judge({**fresh, "buying_power": 100}, db)
    check("debit over buying power is unusable", poor["status"] == "unusable" and "buying_power" in poor["reason"], poor["reason"])
    spike = judge({**fresh, "closes": [100.0] * 30 + [130.0]}, db)
    check("a noisy print is unusable", spike["status"] == "unusable" and spike["reason"] == "noise", spike["reason"])

check("a socket message without a bid is not a quote", _raises(lambda: parse_quote('{"ask": 1}')))
got = parse_quote('{"bid": 1.0, "ask": 1.05, "ts_ms": 5}')
check("a socket message keeps the bid, ask, and time", got == {"bid": 1.0, "ask": 1.05, "ts_ms": 5}, str(got))

try:
    assert_paths(["src/lib/aplus/config.ts"])
    check("the floor file cannot be committed", False)
except RuntimeError as e:
    check("the floor file cannot be committed", "floor" in str(e), str(e))

with tempfile.TemporaryDirectory() as repo_dir:
    root = Path(repo_dir)
    subprocess.check_call(["git", "init", "-q"], cwd=root)
    subprocess.check_call(["git", "config", "user.email", "lab@desk"], cwd=root)
    subprocess.check_call(["git", "config", "user.name", "lab"], cwd=root)
    (root / "README.md").write_text("x\n", encoding="utf-8")
    subprocess.check_call(["git", "add", "README.md"], cwd=root)
    subprocess.check_call(["git", "commit", "-qm", "init"], cwd=root)
    import git as gitlib

    note = write_note(root, "2026-10-07", ["QQQ puts: 1 fill, slip 0.03 per contract."])
    sha = commit_notes(gitlib.Repo(root), ["brainlab/slippage/2026-10-07.md"], "slippage note")
    check("a slippage note can be committed", bool(sha) and note.exists())

with tempfile.TemporaryDirectory() as tmp:
    db = Path(tmp) / "fills.sqlite"
    tid = record(symbol="QQQ", right="put", status="sent", reason="", signal_at_ms=1, intended_px=1.07, path=db)
    slip = mark_filled(tid, 1.10, 2, db)
    check("slippage is fill minus the limit", abs(slip - 0.03) < 1e-9, str(slip))

blob = "\n".join(p.read_text(encoding="utf-8") for p in Path(__file__).resolve().parent.glob("*.py") if p.name != "selfcheck.py")
check("the lab has no order call", "order_buy" not in blob and "order_sell" not in blob and "place_option" not in blob)


print(f"\n{fail} failed" if fail else "\nall passed")
sys.exit(1 if fail else 0)
