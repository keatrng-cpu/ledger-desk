#!/usr/bin/env python3
"""One joint book, Sep 2022–Sep 2026. Rules fixed before the run.

Every character owns one check. A trade exists only when all of them pass.
The win is Blake's test: one-to-one prints before the inversion-candle stop.
A bar that touches both is a loss. A same-path scratch is not a win.
2020 and 2021 are not in the file.
"""
from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/data/history-4y.json"
OUT = ROOT / "src/data/perfect-entry-book.json"


def minute_of(ms: int) -> int:
    d = datetime.fromtimestamp(ms / 1000, ET)
    return d.hour * 60 + d.minute


def day_key(ms: int) -> str:
    return datetime.fromtimestamp(ms / 1000, ET).strftime("%Y-%m-%d")


def year_of(ms: int) -> int:
    return datetime.fromtimestamp(ms / 1000, ET).year


def load_rth():
    raw = json.load(open(SRC))
    books = {}
    for sym in ("ES", "MNQ"):
        bars = []
        for b in raw["bars"][sym]:
            d = datetime.fromtimestamp(b["t"] / 1000, ET)
            if d.weekday() >= 5:
                continue
            m = d.hour * 60 + d.minute
            if m < 9 * 60 + 30 or m >= 16 * 60:
                continue
            bars.append(b)
        books[sym] = bars
    return raw["window"], books


def atr_at(bars, i, n=14):
    if i < 1:
        return None
    start = max(1, i - n + 1)
    trs = []
    for k in range(start, i + 1):
        prev = bars[k - 1]["c"]
        h, l = bars[k]["h"], bars[k]["l"]
        trs.append(max(h - l, abs(h - prev), abs(l - prev)))
    return sum(trs) / len(trs) if trs else None


def bucket_close(bars, i, minutes):
    """Last two completed buckets of `minutes`, causal at bar i (bucket of i is open)."""
    end = minute_of(bars[i]["t"])
    # walk backward to the previous bucket boundary
    closes = []
    seen = None
    last_c = None
    for k in range(i - 1, -1, -1):
        m = minute_of(bars[k]["t"])
        # stop if we left the day stack too far
        b = m // minutes
        if seen is None:
            seen = b
            last_c = bars[k]["c"]
            continue
        if b != seen:
            closes.append(last_c)
            if len(closes) == 2:
                return closes[0], closes[1]
            seen = b
            last_c = bars[k]["c"]
        else:
            last_c = bars[k]["c"]
        if i - k > 8 * (minutes // 15) + 20:
            break
    return None, None


def bias(bars, i, minutes):
    a, b = bucket_close(bars, i, minutes)
    if a is None or b is None or a == b:
        return None
    return "up" if a > b else "down"


def drift(prior_closes, day):
    # prior_closes: list of (day, close) in order, not including today
    if len(prior_closes) < 21:
        return None
    # yesterday vs 20 sessions before yesterday
    y = prior_closes[-1][1]
    old = prior_closes[-21][1]
    if y == old:
        return "flat"
    return "up" if y > old else "down"


def equal_in_front(bars, i, side, entry, target, atr):
    tol = 0.2 * atr
    highs = []
    lows = []
    for k in range(max(0, i - 20), i):
        highs.append(bars[k]["h"])
        lows.append(bars[k]["l"])
    if side == "long":
        zone = [h for h in highs if entry < h < target]
        zone.sort()
        for a, b in zip(zone, zone[1:]):
            if abs(a - b) <= tol:
                return True
    else:
        zone = [l for l in lows if target < l < entry]
        zone.sort()
        for a, b in zip(zone, zone[1:]):
            if abs(a - b) <= tol:
                return True
    return False


def already_swept(bars, i, side):
    """A same-side sweep-and-reclaim in the prior 8 bars is the second push."""
    for k in range(max(12, i - 8), i):
        window = bars[k - 12 : k]
        if not window:
            continue
        lo = min(b["l"] for b in window)
        hi = max(b["h"] for b in window)
        b = bars[k]
        if side == "long" and b["l"] < lo and b["c"] > lo:
            return True
        if side == "short" and b["h"] > hi and b["c"] < hi:
            return True
    return False


def walk(bars, i, side, entry, stop, target):
    risk = abs(entry - stop)
    if risk <= 0:
        return None
    day = day_key(bars[i]["t"])
    for j in range(i + 1, len(bars)):
        b = bars[j]
        if day_key(b["t"]) != day or minute_of(b["t"]) >= 15 * 60 + 45:
            prev = bars[j - 1]
            r = (prev["c"] - entry) / risk if side == "long" else (entry - prev["c"]) / risk
            return {"r": round(r, 3), "win": False, "exit": "flat"}
        if side == "long":
            stopped = b["l"] <= stop
            hit = b["h"] >= target
        else:
            stopped = b["h"] >= stop
            hit = b["l"] <= target
        if stopped:
            return {"r": -1.0, "win": False, "exit": "stop"}
        if hit:
            return {"r": 1.0, "win": True, "exit": "target"}
    return None


def collect(books):
    index = {}
    for sym, bars in books.items():
        index[sym] = {b["t"]: n for n, b in enumerate(bars)}
    # session closes for drift
    session_close = {sym: [] for sym in books}
    last_day = {sym: None for sym in books}
    running = {sym: None for sym in books}
    for sym, bars in books.items():
        for b in bars:
            dk = day_key(b["t"])
            if last_day[sym] is None:
                last_day[sym] = dk
                running[sym] = b["c"]
            elif dk != last_day[sym]:
                session_close[sym].append((last_day[sym], running[sym]))
                last_day[sym] = dk
                running[sym] = b["c"]
            else:
                running[sym] = b["c"]
        if last_day[sym]:
            session_close[sym].append((last_day[sym], running[sym]))
    close_before = {}
    for sym, rows in session_close.items():
        acc = []
        for dk, c in rows:
            close_before[(sym, dk)] = list(acc)
            acc.append((dk, c))

    trades = []
    seen_day = set()
    other = {"ES": "MNQ", "MNQ": "ES"}
    for sym, bars in books.items():
        for i in range(40, len(bars) - 2):
            b = bars[i]
            m = minute_of(b["t"])
            if m < 9 * 60 + 30 or m >= 10 * 60 + 50:
                continue
            dk = day_key(b["t"])
            if (sym, dk) in seen_day:
                continue
            a = atr_at(bars, i)
            if not a or a <= 0:
                continue
            window = bars[i - 12 : i]
            lo = min(x["l"] for x in window)
            hi = max(x["h"] for x in window)
            rng = b["h"] - b["l"]
            if rng < a:
                continue
            side = None
            if b["l"] < lo and b["c"] > lo and b["c"] > b["o"]:
                side = "long"
                stop = b["l"]
            elif b["h"] > hi and b["c"] < hi and b["c"] < b["o"]:
                side = "short"
                stop = b["h"]
            if side is None:
                continue
            entry = b["c"]
            risk = abs(entry - stop)
            if risk < 0.25 * a or risk > 2.5 * a:
                continue
            h1 = bias(bars, i, 60)
            h4 = bias(bars, i, 240)
            want = "up" if side == "long" else "down"
            if h1 != want or h4 != want:
                continue
            d = drift(close_before.get((sym, dk), []), dk)
            if d != want:
                continue
            if already_swept(bars, i, side):
                continue
            j = index[other[sym]].get(b["t"])
            if j is None or j < 12:
                continue
            ob = books[other[sym]]
            ow = ob[j - 12 : j]
            if side == "long":
                # they failed to take their swing low
                if ob[j]["l"] < min(x["l"] for x in ow):
                    continue
            else:
                if ob[j]["h"] > max(x["h"] for x in ow):
                    continue
            target = entry + risk if side == "long" else entry - risk
            if equal_in_front(bars, i, side, entry, target, a):
                continue
            tr = walk(bars, i, side, entry, stop, target)
            if not tr:
                continue
            seen_day.add((sym, dk))
            tr.update({"symbol": sym, "side": side, "date": dk, "year": year_of(b["t"])})
            trades.append(tr)
    trades.sort(key=lambda t: t["date"])
    return trades


def stats(rows):
    n = len(rows)
    wins = sum(1 for t in rows if t["win"])
    sr = sum(t["r"] for t in rows)
    return {
        "n": n,
        "wins": wins,
        "wr": (wins / n) if n else None,
        "sumR": round(sr, 3),
        "expR": round(sr / n, 3) if n else None,
    }


def main():
    window, books = load_rth()
    # Each added check is one character. The win rate is one-to-one before the stop.
    index = {sym: {b["t"]: n for n, b in enumerate(bars)} for sym, bars in books.items()}
    before = {}
    for sym, bars in books.items():
        rows = []
        last = None
        run = None
        for b in bars:
            dk = day_key(b["t"])
            if last is None:
                last, run = dk, b["c"]
            elif dk != last:
                rows.append((last, run))
                last, run = dk, b["c"]
            else:
                run = b["c"]
        acc = []
        before[sym] = {}
        for dk, c in rows:
            before[sym][dk] = list(acc)
            acc.append((dk, c))
    other = {"ES": "MNQ", "MNQ": "ES"}
    stages = {k: [] for k in ("inversion", "htf", "drift", "once", "smt", "draw")}
    for sym, bars in books.items():
        seen = set()
        for i in range(40, len(bars) - 2):
            b = bars[i]
            m = minute_of(b["t"])
            if not (9 * 60 + 30 <= m < 10 * 60 + 50):
                continue
            dk = day_key(b["t"])
            if (sym, dk) in seen:
                continue
            a = atr_at(bars, i)
            if not a:
                continue
            w = bars[i - 12 : i]
            lo, hi = min(x["l"] for x in w), max(x["h"] for x in w)
            if (b["h"] - b["l"]) < a:
                continue
            side = None
            if b["l"] < lo and b["c"] > lo and b["c"] > b["o"]:
                side, stop = "long", b["l"]
            elif b["h"] > hi and b["c"] < hi and b["c"] < b["o"]:
                side, stop = "short", b["h"]
            if side is None:
                continue
            entry = b["c"]
            risk = abs(entry - stop)
            if risk < 0.25 * a or risk > 2.5 * a:
                continue
            target = entry + risk if side == "long" else entry - risk
            tr = walk(bars, i, side, entry, stop, target)
            if not tr:
                continue
            tr["year"] = year_of(b["t"])
            passed = ["inversion"]
            want = "up" if side == "long" else "down"
            if bias(bars, i, 60) == want and bias(bars, i, 240) == want:
                passed.append("htf")
            else:
                stages["inversion"].append(tr)
                seen.add((sym, dk))
                continue
            if drift(before[sym].get(dk, []), dk) == want:
                passed.append("drift")
            else:
                for name in passed:
                    stages[name].append(tr)
                seen.add((sym, dk))
                continue
            if not already_swept(bars, i, side):
                passed.append("once")
            else:
                for name in passed:
                    stages[name].append(tr)
                seen.add((sym, dk))
                continue
            j = index[other[sym]].get(b["t"])
            smt_ok = False
            if j is not None and j >= 12:
                ob = books[other[sym]]
                ow = ob[j - 12 : j]
                if side == "long":
                    smt_ok = ob[j]["l"] >= min(x["l"] for x in ow)
                else:
                    smt_ok = ob[j]["h"] <= max(x["h"] for x in ow)
            if smt_ok:
                passed.append("smt")
            else:
                for name in passed:
                    stages[name].append(tr)
                seen.add((sym, dk))
                continue
            if not equal_in_front(bars, i, side, entry, target, a):
                passed.append("draw")
            for name in passed:
                stages[name].append(tr)
            seen.add((sym, dk))

    order = [
        ("Vince", "inversion", "Morning inversion. Body back through the sweep."),
        ("Gemma", "htf", "One-hour and four-hour agree."),
        ("Nova", "drift", "Four-week drift agrees."),
        ("Sterling", "once", "No second push."),
        ("Jax", "smt", "The other index failed the same side."),
        ("All", "draw", "Nothing untaken in front of one-to-one."),
    ]
    ladder = []
    for who, key, label in order:
        st = stats(stages[key])
        h2 = stats([t for t in stages[key] if t["year"] >= 2025])
        ladder.append({"who": who, "check": label, **st, "h2": h2})
        print(who, label, st, "h2", h2)
    last = ladder[-1]
    cleared = bool(last["h2"]["n"] >= 30 and last["h2"]["wr"] is not None and last["h2"]["wr"] >= 0.68 and last["h2"]["expR"] and last["h2"]["expR"] > 0)
    out = {
        "version": 1,
        "window": window,
        "target": 0.68,
        "cleared": cleared,
        "test": "One-to-one before the inversion-candle stop. A bar that touches both is a loss.",
        "note": "Sep 2022 through Sep 2026. All five checks stack. 68% was the target on the second half of the full stack. The stack does not have the trades, and no earlier check reached 68%.",
        "ladder": ladder,
    }
    OUT.write_text(json.dumps(out))
    print("cleared", cleared, "wrote", OUT)


if __name__ == "__main__":
    main()

