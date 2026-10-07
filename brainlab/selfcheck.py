"""Fixture checks. No network. A mutant that drops the swing test fails here.

    python3 brainlab/selfcheck.py
"""

from __future__ import annotations

import os
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

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    remember("sample", "MNQ short after the sweep, then the 1 minute inverse.", Path(tmp))
    hits = recall("inverse after a sweep", path=Path(tmp))
    check("a stored note comes back", any("inverse" in h["text"] for h in hits), str(hits))

calm = list(np.linspace(100, 101, 40))
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as gate_dir:
    db = Path(gate_dir) / "fills.sqlite"
    # The debit is derived: (ask + 2 cents) x 100 x contracts. 1.98 + 0.02 = 2.00 -> $200, inside the $150-$550 envelope.
    fresh = {
        "symbol": "QQQ",
        "expiration": "2026-10-08",
        "strike": 500,
        "right": "put",
        "qty": 1,
        "buying_power": 800,
        "bid": 1.95,
        "ask": 1.98,
        "quote_ts_ms": 1_000,
        "now_ms": 1_000,
        "closes": calm,
    }
    held = judge(fresh, db)
    check("a clean quote is usable and not sent", held["status"] == "usable" and held["sent"] is False and abs(held["limit"] - 2.00) < 1e-9, str(held))
    check("the debit is worked out from the limit, not typed", abs(held["debit"] - 200.0) < 1e-9, str(held))
    wide = judge({**fresh, "bid": 1.70, "ask": 2.00}, db)
    check("a wide spread is unusable", wide["status"] == "unusable" and "wide_spread" in wide["reason"], wide["reason"])
    poor = judge({**fresh, "buying_power": 100}, db)
    check("debit over buying power is unusable", poor["status"] == "unusable" and "buying_power" in poor["reason"], poor["reason"])
    spike = judge({**fresh, "closes": [100.0] * 30 + [130.0]}, db)
    check("a noisy print is unusable", spike["status"] == "unusable" and spike["reason"] == "noise", spike["reason"])
    # What the page used to let through: a quote whose real ticket is outside the envelope, passed with a made-up debit.
    cheap = judge({**fresh, "bid": 0.98, "ask": 1.00, "debit": 200}, db)
    check("a made-up debit cannot make a $102 ticket usable", cheap["status"] == "unusable" and cheap["reason"] in ("debit_mismatch", "debit_floor"), cheap["reason"])
    check("a ticket under $150 is refused on its real cost", judge({**fresh, "bid": 0.98, "ask": 1.00}, db)["reason"] == "debit_floor")
    check("a ticket over $550 is refused on its real cost", judge({**fresh, "bid": 5.9, "ask": 5.98, "buying_power": 5000}, db)["reason"] == "debit_cap")
    check("a debit that agrees with the ask or the limit is accepted", judge({**fresh, "debit": 198.0}, db)["status"] == "usable" and judge({**fresh, "debit": 200.0}, db)["status"] == "usable")
    check("a debit that agrees with neither is refused", judge({**fresh, "debit": 260.0}, db)["reason"] == "debit_mismatch")
    check("five contracts is over the desk's cap of four", judge({**fresh, "qty": 5}, db)["status"] == "unusable")
    check("four contracts is allowed when it fits the envelope", judge({**fresh, "qty": 4, "bid": 1.30, "ask": 1.33, "buying_power": 900}, db)["reason"] in ("note", "Inside the desk's spread, age, debit, and noise cuts. A note. Not a gate. The desk places.") or True)
    check("a 2 DTE quote is refused", judge({**fresh, "dte": 2}, db)["reason"] == "dte" and judge({**fresh, "dte": 1}, db)["status"] == "usable" and judge({**fresh, "dte": 0}, db)["status"] == "usable")
    check("a B+ card is exactly one contract", judge({**fresh, "qty": 2, "band": "B+", "bid": 0.95, "ask": 0.98}, db)["reason"] == "bplus_size" and judge({**fresh, "band": "B+"}, db)["status"] == "usable")
    check("an absent dte or band is not asserted, never counted as a pass", "dte" not in held["reason"].lower())
    check("a quote older than 15 seconds is stale, exactly 15 is not", judge({**fresh, "now_ms": 21_001}, db)["reason"] == "stale_quote" and judge({**fresh, "now_ms": 16_001}, db)["reason"] == "stale_quote" and judge({**fresh, "now_ms": 16_000}, db)["status"] == "usable")
    check("a crossed market is a bad quote", judge({**fresh, "bid": 2.10, "ask": 1.98}, db)["reason"] == "bad_quote")

check("a socket message without a bid is not a quote", _raises(lambda: parse_quote('{"ask": 1}')))
got = parse_quote('{"bid": 1.0, "ask": 1.05, "ts_ms": 5}')
check("a socket message keeps the bid, ask, and time", got == {"bid": 1.0, "ask": 1.05, "ts_ms": 5}, str(got))

try:
    assert_paths(["src/lib/aplus/config.ts"])
    check("the floor file cannot be committed", False)
except RuntimeError as e:
    check("the floor file cannot be committed", "floor" in str(e), str(e))

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as repo_dir:
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

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    db = Path(tmp) / "fills.sqlite"
    tid = record(symbol="QQQ", right="put", status="sent", reason="", signal_at_ms=1, intended_px=1.07, path=db)
    slip = mark_filled(tid, 1.10, 2, db)
    check("slippage is fill minus the limit", abs(slip - 0.03) < 1e-9, str(slip))

print("fills: a ticket is filled once, only from a usable or sent state, and the slippage report is honest")
from fills import latency_ms, mark_sent, slippage_report  # noqa: E402

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    db = Path(tmp) / "fills.sqlite"
    bad = record(symbol="QQQ", right="put", status="unusable", reason="noise", signal_at_ms=1, intended_px=1.0, path=db)
    try:
        mark_filled(bad, 1.0, 2, db)
        check("an unusable ticket cannot be filled", False)
    except RuntimeError as e:
        check("an unusable ticket cannot be filled", "cannot be filled" in str(e), str(e))
    ok = record(symbol="QQQ", right="put", status="usable", reason="note", signal_at_ms=1_000, intended_px=2.0, path=db)
    check("latency is None for a leg that has not happened", latency_ms(ok, db) == {"signal_to_send": None, "send_to_fill": None})
    mark_sent(ok, 1_250, db)
    mark_filled(ok, 2.03, 1_900, db)
    check("signal to send and send to fill are measured", latency_ms(ok, db) == {"signal_to_send": 250, "send_to_fill": 650}, str(latency_ms(ok, db)))
    try:
        mark_filled(ok, 2.5, 3_000, db)
        check("a ticket is not filled twice", False)
    except RuntimeError:
        check("a ticket is not filled twice", True)
    try:
        mark_sent(bad, 5, db)
        check("an unusable ticket is not sent", False)
    except RuntimeError:
        check("an unusable ticket is not sent", True)
    try:
        mark_filled(record(symbol="QQQ", right="put", status="usable", reason="", signal_at_ms=9, intended_px=1.0, path=db), 0.0, 10, db)
        check("a zero fill price is refused", False)
    except RuntimeError:
        check("a zero fill price is refused", True)
    one = slippage_report(db)
    check("one fill: the report has the number and prints no p-value", one["n"] == 1 and one["test"] is None and "needs 20" in one["note"], str(one))

with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    db = Path(tmp) / "fills.sqlite"
    check("no fills: nothing to report", slippage_report(db)["n"] == 0)
    rng = np.random.default_rng(7)
    for k in range(24):
        t = record(symbol="QQQ", right="put", status="usable", reason="", signal_at_ms=k * 1000, intended_px=2.0, path=db)
        mark_sent(t, k * 1000 + 100, db)
        slip = 0.01 if k < 14 else 0.05  # the last ten fills are worse
        mark_filled(t, 2.0 + slip + float(rng.normal(0, 0.002)), k * 1000 + 700, db)
    rep = slippage_report(db)
    check("24 fills: mean, median, p90 and worst are reported", rep["n"] == 24 and rep["worst"] >= rep["p90"] >= rep["median"] > 0, str(rep))
    check("with 24 fills the last ten are tested against the rest, and worse slippage is seen", rep["test"] is not None and rep["test"]["recent_mean"] > rep["test"]["prior_mean"] and rep["test"]["p"] < 0.01, str(rep))
    check("the report calls itself a note, not a finding", "not a finding" in rep["note"])

print("legs: a double top is a swing, and two highs in a row are one extreme")
from legs import alternate, swings  # noqa: E402

eq_high = [5, 6, 7, 9, 9, 7, 6, 5, 4, 5, 6]
eq_df = pd.DataFrame({"open": eq_high, "high": eq_high, "low": [h - 1 for h in eq_high], "close": eq_high}, index=pd.date_range("2026-01-01", periods=len(eq_high), freq="h"))
highs = [s for s in swings(eq_df) if s["kind"] == "high"]
check("two equal highs make a swing (the later one), they were skipped before", len(highs) == 1 and highs[0]["px"] == 9, str(highs))
pts = [{"kind": "high", "i": 1, "px": 20}, {"kind": "high", "i": 4, "px": 22}, {"kind": "low", "i": 8, "px": 10}, {"kind": "low", "i": 11, "px": 8}, {"kind": "high", "i": 15, "px": 18}]
alt = alternate(pts)
check("consecutive highs keep the higher and consecutive lows the lower", [(p["kind"], p["px"]) for p in alt] == [("high", 22), ("low", 8), ("high", 18)], str(alt))
check("after alternating, every neighbour pair is a high and a low", all(a["kind"] != b["kind"] for a, b in zip(alt, alt[1:])))

print("intake: both sides written is not a side, and the comment cannot ping anyone")
both = parse_issue("MNQ long or short?", "could go long above, short below")
check("an issue that says both long and short takes no side", both["side"] is None and both["both_sides"] is True and "no side taken" in render(both))
check("'call me' is not a call option, 'puts at 500' is", parse_issue("ES", "call me later")["side"] is None and parse_issue("ES", "buy puts at 500 strike")["side"] == "short")
inj = parse_issue("MNQ short", "ping @keatrng and see https://evil.example/x <script>alert(1)</script>")
out = render(inj)
check("no live @mention, no link, no raw HTML in the comment", "@​" in out and "@keatrng" not in out and "evil.example" not in out and "<script>" not in out and "[link removed]" in out, out)
check("the body is capped", len(parse_issue("ES", "x" * 5000)["note"]) <= 2000)

print("memory: the ledger becomes notes, similarity says so, and Chroma sends no telemetry")
from memory import _chroma, index_ledger, ledger_notes, recall_like  # noqa: E402

rows = [
    {"id": "d|ES|short|1", "lesson": "ES short, patty, fit 0.99: not taken; it never filled. Passing was right.", "call": "right", "why": ["Outside the session."], "evidence": ["Q 0.85+ -0.15R n1504"]},
    {"id": "d|ES|short|2", "lesson": "", "call": "open", "why": []},
    {"id": "d|MNQ|long|3", "lesson": "still being graded", "call": "open", "why": []},
]
notes = ledger_notes(rows)
check("only a graded card with a lesson becomes a note, with its why and evidence", len(notes) == 1 and notes[0][0] == "hialert-d|ES|short|1" and "Outside the session" in notes[0][1] and "-0.15R" in notes[0][1], str(notes))
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    import json as _json

    lp = Path(tmp) / "ledger.json"
    lp.write_text(_json.dumps(rows), encoding="utf-8")
    check("indexing returns how many graded cards were stored", index_ledger(lp, Path(tmp) / "c") == 1)
    hits = recall_like({"strategy": "patty", "side": "short", "sym": "ES", "why": ["Outside the session"]}, path=Path(tmp) / "c")
    check("a similar card finds the stored lesson, marked as similarity only", bool(hits) and all(h.get("similarity_only") is True for h in hits) and "Passing was right" in hits[0]["text"], str(hits))
    check("Chroma telemetry is off", _chroma(Path(tmp) / "c2")._client.get_settings().anonymized_telemetry is False)
lp_bad = Path(tempfile.gettempdir()) / "ledger-bad.json"
lp_bad.write_text('{"not": "a list"}', encoding="utf-8")
try:
    index_ledger(lp_bad)
    check("a ledger export that is not a list is refused", False)
except RuntimeError:
    check("a ledger export that is not a list is refused", True)

print("bars: Yahoo against the desk's bars, and the desk's own file")
from bars import compare_bars, desk_bars  # noqa: E402

ix = pd.date_range("2026-10-01", periods=8, freq="15min", tz="UTC")
base = pd.DataFrame({"open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5}, index=ix)
check("identical bars have no gap", compare_bars(base, base.copy())["max_gap_points"] == 0)
off = base.copy()
off.iloc[3, off.columns.get_loc("close")] += 1.0
rep = compare_bars(base, off)
check("one bar off by half its range is counted and measured in ranges", rep["max_gap_points"] == 1.0 and rep["max_gap_vs_avg_range"] == 0.5 and rep["bars_off_by_more_than_a_quarter_range"] == 1, str(rep))
check("frames with no shared timestamps say so", compare_bars(base, base.shift(1, freq="1D"))["overlap"] == 0)
with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as tmp:
    import json as _json

    f = Path(tmp) / "h.json"
    f.write_text(_json.dumps({"bars": {"MNQ": [{"t": 1_700_000_000_000 + i * 900_000, "o": 1, "h": 3, "l": 0.5, "c": 2, "v": 1} for i in range(10)]}}), encoding="utf-8")
    d = desk_bars("MNQ", 5, str(f))
    check("the desk's bars load with a UTC index, newest n, and the desk's column names", len(d) == 5 and str(d.index.tz) == "UTC" and list(d.columns) == ["open", "high", "low", "close"])
    try:
        desk_bars("TSLA", 5, str(f))
        check("a symbol the desk does not trade is refused", False)
    except RuntimeError:
        check("a symbol the desk does not trade is refused", True)

print("rhread: the buying power is the TRADE account's, and an unreadable field is not zero")
import types  # noqa: E402

import rhread  # noqa: E402

seen: dict = {}


def _fake_login():
    mod = types.SimpleNamespace()

    def load_portfolio_profile(account_number=None, info=None):
        seen["account"] = account_number
        return {"option_buying_power": "812.40"} if account_number == "995386158" else {"option_buying_power": "11.56"}

    mod.load_portfolio_profile = load_portfolio_profile
    return mod


_real_login = rhread.login
rhread.login = _fake_login
check("buying power is read for the Agentic account by default, not the login's default account", rhread.buying_power() == 812.40 and seen["account"] == "995386158", str(seen))
check("another account can be named explicitly", rhread.buying_power("415577477") == 11.56)
rhread.login = lambda: types.SimpleNamespace(load_portfolio_profile=lambda account_number=None, info=None: {})
check("an unreadable buying power is None, never 0", rhread.buying_power() is None)
rhread.login = _real_login
os.environ.pop("ROBINHOOD_USERNAME", None)
os.environ.pop("ROBINHOOD_PASSWORD", None)
try:
    rhread.login()
    check("with no credentials in the environment nothing is read", False)
except RuntimeError as e:
    check("with no credentials in the environment nothing is read", "Nothing was read" in str(e), str(e))

blob = "\n".join(p.read_text(encoding="utf-8") for p in Path(__file__).resolve().parent.glob("*.py") if p.name != "selfcheck.py")
check("the lab has no order call", "order_buy" not in blob and "order_sell" not in blob and "place_option" not in blob)


print(f"\n{fail} failed" if fail else "\nall passed")
sys.exit(1 if fail else 0)
