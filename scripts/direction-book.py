#!/usr/bin/env python3
"""Direction first, then an entry. Sep 2022–Sep 2026. Rules fixed before the run.

Every trade, in this order:
  1. 1H and 4H agree. The last gap interaction on each is the same side.
     Respected bullish gap or disrespected bearish gap = bull.
     Respected bearish gap or disrespected bullish gap = bear.
  2. The draw is already resting: nearest unswept liquidity, or the nearest
     open opposing gap, in that direction.
  3. The sweep is of a pool against the draw. External (prior day, Asia,
     London) or internal (a confirmed 1H swing, including equal highs/lows).

Entry, only 09:30–11:30 ET, two per day across ES and MNQ:
  IFVG — a gap in the sweep leg is closed through by a body.
  HOLD — a gap forms with the bias and a later bar trades into it and closes back out.

The win is the draw printing before the sweep-wick stop. One-to-one is recorded
on the same trades and is not the target. A bar that touches both is a loss.
15-minute bars cannot see a 1-minute inverse. 2020 and 2021 are not in the file.
"""
from __future__ import annotations

import json
from collections import defaultdict
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/data/history-4y.json"
OUT = ROOT / "src/data/perfect-entry-book.json"


def dt(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, ET)


def minute_of(ms: int) -> int:
    d = dt(ms)
    return d.hour * 60 + d.minute


def day_key(ms: int) -> str:
    return dt(ms).strftime("%Y-%m-%d")


def year_of(ms: int) -> int:
    return dt(ms).year


def load():
    raw = json.load(open(SRC))
    books = {}
    for sym in ("ES", "MNQ"):
        books[sym] = list(raw["bars"][sym])
    return raw["window"], books


def closed_candles(bars, minutes):
    span = minutes * 60 * 1000
    out = []
    cur = None
    key = None
    for b in bars:
        k = b["t"] // span
        if k != key:
            if cur is not None:
                out.append(cur)
            key = k
            cur = {"t": b["t"], "end": b["t"] + span, "o": b["o"], "h": b["h"], "l": b["l"], "c": b["c"]}
        else:
            cur["h"] = max(cur["h"], b["h"])
            cur["l"] = min(cur["l"], b["l"])
            cur["c"] = b["c"]
    return out


def gap_events(candles):
    """Events on candle j: the most recent gap interaction as of that close."""
    fvgs = []
    events = {}
    last = None
    for i in range(2, len(candles)):
        a, c = candles[i - 2], candles[i]
        if a["h"] < c["l"]:
            fvgs.append({"side": "bull", "top": c["l"], "bot": a["h"], "born": i})
        elif a["l"] > c["h"]:
            fvgs.append({"side": "bear", "top": a["l"], "bot": c["h"], "born": i})
        touched = None
        for g in fvgs:
            if g["born"] >= i or g.get("dead"):
                continue
            bar = candles[i]
            if bar["h"] < g["bot"] or bar["l"] > g["top"]:
                continue
            if g["side"] == "bull" and bar["c"] < g["bot"]:
                g["dead"] = i
                touched = ("bear", i)
            elif g["side"] == "bear" and bar["c"] > g["top"]:
                g["dead"] = i
                touched = ("bull", i)
            elif g["side"] == "bull" and bar["c"] >= g["bot"]:
                touched = ("bull", i)
            elif g["side"] == "bear" and bar["c"] <= g["top"]:
                touched = ("bear", i)
        if touched is not None:
            last = touched
        if last is not None and i - last[1] <= 8:
            events[candles[i]["end"]] = last[0]
    return events, fvgs, candles


def bias_series(events, candles):
    return [(c["end"], events.get(c["end"])) for c in candles]


def bias_asof(series, ts):
    lo, hi = 0, len(series) - 1
    ans = None
    while lo <= hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= ts:
            ans = series[mid][1]
            lo = mid + 1
        else:
            hi = mid - 1
    return ans


def open_gaps(fvgs, candles, ts, side):
    """Open opposing gaps in the draw direction. side is the trade side."""
    end_i = -1
    for n, c in enumerate(candles):
        if c["end"] <= ts:
            end_i = n
        else:
            break
    if end_i < 0:
        return []
    want = "bear" if side == "bull" else "bull"
    out = []
    for g in fvgs:
        if g["side"] != want or g["born"] >= end_i:
            continue
        # dead flag was set while scanning forward past ts; recompute causally
        killed = False
        for j in range(g["born"] + 1, end_i + 1):
            bar = candles[j]
            if g["side"] == "bull" and bar["c"] < g["bot"]:
                killed = True
                break
            if g["side"] == "bear" and bar["c"] > g["top"]:
                killed = True
                break
        if killed:
            continue
        mid = (g["top"] + g["bot"]) / 2
        out.append(mid)
    return out


def rth_days(bars):
    days = defaultdict(list)
    for b in bars:
        d = dt(b["t"])
        if d.weekday() >= 5:
            continue
        m = d.hour * 60 + d.minute
        if 9 * 60 + 30 <= m < 16 * 60:
            days[day_key(b["t"])].append(b)
    return days


def session_extreme(bars, start, end, field):
    xs = [b[field] for b in bars if start <= b["t"] < end]
    if not xs:
        return None
    return max(xs) if field == "h" else min(xs)


def swings(candles):
    pts = []
    for i in range(1, len(candles) - 1):
        if candles[i]["h"] > candles[i - 1]["h"] and candles[i]["h"] > candles[i + 1]["h"]:
            pts.append({"kind": "high", "px": candles[i]["h"], "at": candles[i + 1]["end"]})
        if candles[i]["l"] < candles[i - 1]["l"] and candles[i]["l"] < candles[i + 1]["l"]:
            pts.append({"kind": "low", "px": candles[i]["l"], "at": candles[i + 1]["end"]})
    return pts


def fvg_15(bars, i):
    if i < 2:
        return None
    a, c = bars[i - 2], bars[i]
    if a["h"] < c["l"]:
        return {"side": "bull", "top": c["l"], "bot": a["h"], "i": i}
    if a["l"] > c["h"]:
        return {"side": "bear", "top": a["l"], "bot": c["h"], "i": i}
    return None


def walk(bars, i, side, entry, stop, target):
    risk = (entry - stop) if side == "bull" else (stop - entry)
    reward = (target - entry) if side == "bull" else (entry - target)
    if risk <= 0 or reward <= 0:
        return None
    one = entry + risk if side == "bull" else entry - risk
    day = day_key(bars[i]["t"])
    hit_one = False
    for j in range(i + 1, len(bars)):
        b = bars[j]
        m = minute_of(b["t"])
        if day_key(b["t"]) != day or m >= 16 * 60:
            prev = bars[j - 1]["c"]
            r = ((prev - entry) if side == "bull" else (entry - prev)) / risk
            return {"r": round(r, 3), "win": False, "one": hit_one, "exit": "flat", "rr": round(reward / risk, 3)}
        if side == "bull":
            stopped = b["l"] <= stop
            drew = b["h"] >= target
            one_hit = b["h"] >= one
        else:
            stopped = b["h"] >= stop
            drew = b["l"] <= target
            one_hit = b["l"] <= one
        if stopped and drew:
            return {"r": -1.0, "win": False, "one": False, "exit": "both", "rr": round(reward / risk, 3)}
        if stopped:
            return {"r": -1.0, "win": False, "one": hit_one, "exit": "stop", "rr": round(reward / risk, 3)}
        if one_hit:
            hit_one = True
        if drew:
            return {"r": round(reward / risk, 3), "win": True, "one": True, "exit": "draw", "rr": round(reward / risk, 3)}
    return None


def collect(books):
    prepared = {}
    rth = {}
    for sym, bars in books.items():
        h1 = closed_candles(bars, 60)
        h4 = closed_candles(bars, 240)
        e1, g1, c1 = gap_events(h1)
        e4, g4, c4 = gap_events(h4)
        prepared[sym] = {
            "bars": bars,
            "h1": (bias_series(e1, c1), g1, c1),
            "h4": (bias_series(e4, c4), g4, c4),
            "swings": swings(h1),
        }
        rth[sym] = rth_days(bars)
    days = sorted(set(rth["ES"]) & set(rth["MNQ"]))
    signals = []
    funnel = defaultdict(int)
    for dk in days:
        for sym in ("ES", "MNQ"):
            bars = prepared[sym]["bars"]
            day_bars = rth[sym][dk]
            if len(day_bars) < 8:
                continue
            # index of each rth bar in the full book
            stamp = {b["t"]: n for n, b in enumerate(bars)}
            prev_days = [d for d in days if d < dk]
            if not prev_days:
                continue
            prev = rth[sym][prev_days[-1]]
            pdh = max(b["h"] for b in prev)
            pdl = min(b["l"] for b in prev)
            open_ms = day_bars[0]["t"]
            # Asia: prior 18:00 to 03:00. London: 03:00 to 09:30.
            midnight = datetime.strptime(dk, "%Y-%m-%d").replace(tzinfo=ET)
            asia_start = int((midnight - timedelta(hours=6)).timestamp() * 1000)
            asia_end = int((midnight + timedelta(hours=3)).timestamp() * 1000)
            london_end = open_ms
            asia_h = session_extreme(bars, asia_start, asia_end, "h")
            asia_l = session_extreme(bars, asia_start, asia_end, "l")
            lon_h = session_extreme(bars, asia_end, london_end, "h")
            lon_l = session_extreme(bars, asia_end, london_end, "l")
            s1, g1, c1 = prepared[sym]["h1"]
            s4, g4, c4 = prepared[sym]["h4"]
            external = [("high", pdh, "erl"), ("low", pdl, "erl")]
            for px, name in ((asia_h, "erl"), (lon_h, "erl")):
                if px is not None:
                    external.append(("high", px, name))
            for px, name in ((asia_l, "erl"), (lon_l, "erl")):
                if px is not None:
                    external.append(("low", px, name))
            recent = open_ms - 5 * 24 * 60 * 60 * 1000
            for s in prepared[sym]["swings"]:
                if recent <= s["at"] < open_ms:
                    external.append((s["kind"], s["px"], "irl"))
            # equal highs / lows among the last swings
            highs = [p for k, p, sc in external if k == "high"]
            lows = [p for k, p, sc in external if k == "low"]
            for i in range(stamp[day_bars[0]["t"]], stamp[day_bars[-1]["t"]] + 1):
                b = bars[i]
                m = minute_of(b["t"])
                if m < 9 * 60 + 30 or m >= 11 * 60 + 30:
                    continue
                if day_key(b["t"]) != dk:
                    continue
                funnel["window"] += 1
                side = bias_asof(s1, b["t"])
                side4 = bias_asof(s4, b["t"])
                if side is None or side != side4:
                    funnel["no_bias"] += 1
                    continue
                funnel["bias"] += 1
                # resting pools: not traded through since 18:00 prior
                resting = []
                for kind, px, scope in external:
                    taken = False
                    for q in bars[max(0, i - 80) : i]:
                        if q["t"] < asia_start:
                            continue
                        if kind == "high" and q["h"] >= px:
                            taken = True
                            break
                        if kind == "low" and q["l"] <= px:
                            taken = True
                            break
                    if not taken:
                        resting.append((kind, px, scope))
                against = "low" if side == "bull" else "high"
                swept = None
                for kind, px, scope in resting:
                    if kind != against:
                        continue
                    if against == "low" and b["l"] < px:
                        if swept is None or px < swept[1]:
                            swept = (kind, px, scope)
                    if against == "high" and b["h"] > px:
                        if swept is None or px > swept[1]:
                            swept = (kind, px, scope)
                if swept is None:
                    funnel["no_sweep"] += 1
                    continue
                funnel["sweep"] += 1
                # entry variations after this sweep, up to 6 bars and 11:30
                entry = None
                for k in range(i + 1, min(i + 7, len(bars))):
                    bk = bars[k]
                    if day_key(bk["t"]) != dk or minute_of(bk["t"]) >= 11 * 60 + 30:
                        break
                    # IFVG: a gap born in the four bars into the sweep, against the bias
                    for n in range(max(2, i - 4), i + 1):
                        g = fvg_15(bars, n)
                        if g is None:
                            continue
                        if side == "bull" and g["side"] == "bear" and bk["c"] > g["top"]:
                            entry = ("ifvg", k, bk["c"])
                            break
                        if side == "bear" and g["side"] == "bull" and bk["c"] < g["bot"]:
                            entry = ("ifvg", k, bk["c"])
                            break
                    if entry:
                        break
                    # HOLD: a gap that formed after the sweep, then a later bar respects it
                    for n in range(i + 1, k):
                        g = fvg_15(bars, n)
                        if g is None or n >= k:
                            continue
                        if side == "bull" and g["side"] == "bull" and bk["l"] <= g["top"] and bk["c"] > g["top"]:
                            entry = ("hold", k, bk["c"])
                            break
                        if side == "bear" and g["side"] == "bear" and bk["h"] >= g["bot"] and bk["c"] < g["bot"]:
                            entry = ("hold", k, bk["c"])
                            break
                    if entry:
                        break
                if entry is None:
                    funnel["no_entry"] += 1
                    continue
                model, k, px = entry
                stop = b["l"] if side == "bull" else b["h"]
                # draw, known at the entry bar, not including pools this entry already passed
                pools = []
                for kind, pp, scope in resting:
                    if side == "bull" and kind == "high" and pp > px:
                        pools.append(pp)
                    if side == "bear" and kind == "low" and pp < px:
                        pools.append(pp)
                gaps = open_gaps(g1, c1, bars[k]["t"], side) + open_gaps(g4, c4, bars[k]["t"], side)
                if side == "bull":
                    gaps = [g for g in gaps if g > px]
                else:
                    gaps = [g for g in gaps if g < px]
                cands = pools + gaps
                if not cands:
                    funnel["no_draw"] += 1
                    continue
                target = min(cands) if side == "bull" else max(cands)
                tr = walk(bars, k, side, px, stop, target)
                if tr is None:
                    funnel["bad_geometry"] += 1
                    continue
                funnel["signal"] += 1
                tr.update({
                    "symbol": sym,
                    "side": side,
                    "date": dk,
                    "year": year_of(bars[k]["t"]),
                    "t": bars[k]["t"],
                    "model": model,
                    "scope": swept[2],
                })
                signals.append(tr)
    signals.sort(key=lambda t: (t["t"], t["symbol"]))
    return signals, funnel


def take_two(signals):
    out = []
    per = defaultdict(int)
    for t in signals:
        if per[t["date"]] >= 2:
            continue
        per[t["date"]] += 1
        out.append(t)
    return out


def stats(rows, win_key="win"):
    n = len(rows)
    wins = sum(1 for t in rows if t[win_key])
    sr = sum(t["r"] for t in rows)
    return {
        "n": n,
        "wins": wins,
        "wr": (wins / n) if n else None,
        "sumR": round(sr, 3),
        "expR": round(sr / n, 3) if n else None,
    }


def one_stats(rows):
    n = len(rows)
    wins = sum(1 for t in rows if t["one"] and t["exit"] != "both")
    # one-to-one R is +1 or -1, flats that never printed 1R are the mtm only if not stopped
    sr = 0.0
    for t in rows:
        if t["exit"] == "stop" or t["exit"] == "both":
            sr += -1
        elif t["one"]:
            sr += 1
        else:
            sr += min(t["r"], 0.99)
    return {"n": n, "wins": wins, "wr": (wins / n) if n else None, "expR": round(sr / n, 3) if n else None}


def pack(rows):
    full = stats(rows)
    h2 = stats([t for t in rows if t["year"] >= 2025])
    return {**full, "h2": h2, "one": one_stats(rows), "oneH2": one_stats([t for t in rows if t["year"] >= 2025])}


def main():
    window, books = load()
    signals, funnel = collect(books)
    book = take_two(signals)
    ifvg = [t for t in book if t["model"] == "ifvg"]
    hold = [t for t in book if t["model"] == "hold"]
    erl = [t for t in book if t["scope"] == "erl"]
    irl = [t for t in book if t["scope"] == "irl"]
    print("FUNNEL", dict(funnel))
    print("SIGNALS", len(signals), "TAKEN", len(book))
    for name, rows in (
        ("two-a-day", book),
        ("ifvg", ifvg),
        ("hold", hold),
        ("external", erl),
        ("internal", irl),
        ("uncapped", signals),
    ):
        print(name, pack(rows))
    taken = pack(book)
    cleared = bool(
        taken["h2"]["n"] >= 30
        and taken["h2"]["wr"] is not None
        and taken["h2"]["wr"] >= 0.68
        and taken["h2"]["expR"] is not None
        and taken["h2"]["expR"] > 0
    )
    def row(who, check, rows):
        st = stats(rows)
        return {"who": who, "check": check, **st, "h2": stats([t for t in rows if t["year"] >= 2025])}
    ladder = [
        row("Gemma", "1H and 4H gaps agree. Draw is the resting liquidity or the open gap.", book),
        row("Vince", "Inverse of the gap in the sweep leg.", ifvg),
        row("Jax", "Gap forms with the bias and holds.", hold),
        row("Sterling", "Sweep was external liquidity.", erl),
        row("Nova", "Sweep was an internal swing.", irl),
    ]
    out = {
        "version": 2,
        "window": window,
        "target": 0.68,
        "cleared": cleared,
        "test": "Draw before the sweep stop. Entries 09:30–11:30 ET, two a day.",
        "note": "Sep 2022 through Sep 2026. Direction is the higher-timeframe gap, the resting liquidity, and whether that gap is respected. Entries are the inverse or a gap that holds. 68% was the target on the second half of the two-a-day book. It is a result only if cleared is true.",
        "ladder": ladder,
        "book": taken,
        "uncapped": pack(signals),
        "funnel": dict(funnel),
    }
    OUT.write_text(json.dumps(out))
    print("cleared", cleared)


if __name__ == "__main__":
    main()
