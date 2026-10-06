#!/usr/bin/env python3
"""Five separate years. Real 15m ES and MNQ. No shared study.

Rules are fixed before the run. The target in R is chosen on January–June
only, from a declared set. July–December is the number that counts.
A same-bar stop and target is a loss. A limit that pays inside the fill bar
is a scratch — the path inside that bar is not known.

Each person then names the flaw in their own trades. A refusal is kept only
when the first half saw the leak and the second half got better without it.
"""
from __future__ import annotations

import json
import random
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/data/history-4y.json"
OUT = ROOT / "src/data/crew-years.json"
ET = ZoneInfo("America/New_York")
CREW = ["Gemma", "Jax", "Nova", "Sterling", "Vince"]
TARGETS = [0.8, 1.0, 1.25, 1.5]
# Full calendar years in the Databento file. 2020 and 2021 are not in it.
YEARS = [2023, 2024, 2025]


def et(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, ET)


def minute_of(ms: int) -> int:
    d = et(ms)
    return d.hour * 60 + d.minute


def day_key(ms: int) -> str:
    return et(ms).strftime("%Y-%m-%d")


def weekday(ms: int) -> int:
    return et(ms).weekday()


def load():
    with SRC.open() as f:
        raw = json.load(f)
    books = {}
    for sym in ("ES", "MNQ"):
        bars = []
        for b in raw["bars"][sym]:
            if weekday(b["t"]) >= 5:
                continue
            m = minute_of(b["t"])
            if m < 9 * 60 + 30 or m >= 16 * 60:
                continue
            bars.append(b)
        books[sym] = bars
    return raw["window"], raw["source"], raw["dataset"], books


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


def swing(bars, i, look):
    if i < look:
        return None, None
    window = bars[i - look : i]
    return max(b["h"] for b in window), min(b["l"] for b in window)


class Book:
    def __init__(self, bars):
        self.bars = bars
        self.prior = {}
        self.today = {}
        days = []
        last = None
        acc = None
        for i, b in enumerate(bars):
            dk = day_key(b["t"])
            if dk != last:
                if last is not None:
                    days.append((last, acc))
                last = dk
                acc = [b["h"], b["l"]]
            else:
                acc[0] = max(acc[0], b["h"])
                acc[1] = min(acc[1], b["l"])
            self.today[i] = (acc[0], acc[1])
        if last is not None:
            days.append((last, acc))
        for i in range(1, len(days)):
            self.prior[days[i][0]] = (days[i - 1][1][0], days[i - 1][1][1])


def session_ok(ms: int, who: str) -> bool:
    m = minute_of(ms)
    if m < 9 * 60 + 45 or m >= 15 * 60 + 30:
        return False
    if who == "Sterling" and 11 * 60 <= m < 13 * 60:
        return False
    if who == "Gemma" and 11 * 60 <= m < 13 * 60 + 30:
        return False
    return True


def signals(who: str, book: Book):
    bars = book.bars
    for i in range(30, len(bars) - 2):
        b = bars[i]
        if not session_ok(b["t"], who):
            continue
        a = atr_at(bars, i)
        if not a or a <= 0:
            continue
        hi, lo = swing(bars, i, 12 if who != "Jax" else 8)
        if hi is None:
            continue
        rng = b["h"] - b["l"]
        if who == "Gemma":
            prev = book.prior.get(day_key(b["t"]))
            if not prev:
                continue
            ph, pl = prev
            day_hi, day_lo = book.today[i]
            mid = (day_hi + day_lo) / 2
            if b["l"] < pl and b["c"] > pl and b["c"] < mid and rng >= 1.1 * a:
                stop = b["l"]
                if b["c"] - stop >= 0.25 * a:
                    yield i, "long", stop, i + 1
            elif b["h"] > ph and b["c"] < ph and b["c"] > mid and rng >= 1.1 * a:
                stop = b["h"]
                if stop - b["c"] >= 0.25 * a:
                    yield i, "short", stop, i + 1
            continue
        if who == "Jax":
            if i + 2 >= len(bars):
                continue
            swept_low = b["l"] < lo and b["c"] > lo
            swept_high = b["h"] > hi and b["c"] < hi
            nxt = bars[i + 1]
            if not session_ok(nxt["t"], who):
                continue
            if swept_low and nxt["c"] > b["c"] and (nxt["h"] - nxt["l"]) >= 0.8 * a:
                yield i + 1, "long", min(b["l"], nxt["l"]), i + 2
            elif swept_high and nxt["c"] < b["c"] and (nxt["h"] - nxt["l"]) >= 0.8 * a:
                yield i + 1, "short", max(b["h"], nxt["h"]), i + 2
            continue
        if who == "Nova":
            slope = bars[i]["c"] - bars[i - 20]["c"]
            if b["l"] < lo and b["c"] > lo and rng >= 1.2 * a and slope > 0:
                stop = b["l"]
                risk = b["c"] - stop
                if 0.35 * a <= risk <= 1.15 * a:
                    yield i, "long", stop, i + 1
            elif b["h"] > hi and b["c"] < hi and rng >= 1.2 * a and slope < 0:
                stop = b["h"]
                risk = stop - b["c"]
                if 0.35 * a <= risk <= 1.15 * a:
                    yield i, "short", stop, i + 1
            continue
        if who == "Sterling":
            earlier = bars[i - 6 : i]
            eh = max(x["h"] for x in earlier)
            el = min(x["l"] for x in earlier)
            if b["h"] > eh and b["c"] < eh and rng >= a:
                stop = b["h"]
                if stop - b["c"] >= 0.3 * a:
                    yield i, "short", stop, i + 1
            elif b["l"] < el and b["c"] > el and rng >= a:
                stop = b["l"]
                if b["c"] - stop >= 0.3 * a:
                    yield i, "long", stop, i + 1
            continue
        if who == "Vince":
            if b["l"] < lo and b["c"] > (b["h"] + b["l"]) / 2 and b["c"] > lo and rng >= 1.15 * a:
                yield i, "long", b["l"], i + 1
            elif b["h"] > hi and b["c"] < (b["h"] + b["l"]) / 2 and b["c"] < hi and rng >= 1.15 * a:
                yield i, "short", b["h"], i + 1


def walk(bars, side, stop, entry_i, target_r, limit):
    if entry_i >= len(bars):
        return None
    if limit is None:
        entry = bars[entry_i]["o"]
        start = entry_i
    else:
        entry = None
        start = None
        for j in range(entry_i, min(len(bars), entry_i + 8)):
            bar = bars[j]
            if day_key(bar["t"]) != day_key(bars[entry_i]["t"]) and j != entry_i:
                break
            hit_limit = bar["l"] <= limit if side == "long" else bar["h"] >= limit
            hit_stop = bar["l"] <= stop if side == "long" else bar["h"] >= stop
            if hit_stop and hit_limit:
                return None
            if hit_stop:
                return None
            if hit_limit:
                entry = limit
                start = j
                break
        if entry is None:
            return None
    risk = (entry - stop) if side == "long" else (stop - entry)
    if risk <= 0:
        return None
    target = entry + target_r * risk if side == "long" else entry - target_r * risk
    outcome = None
    exit_px = None
    exit_i = None
    reason = None
    for j in range(start, len(bars)):
        bar = bars[j]
        if minute_of(bar["t"]) >= 15 * 60 + 45 or (j > start and day_key(bar["t"]) != day_key(bars[start]["t"])):
            prev = bars[j - 1] if j > start else bar
            exit_px = prev["c"]
            exit_i = j - 1 if j > start else j
            reason = "flat"
            break
        if side == "long":
            stopped = bar["l"] <= stop
            tgt = bar["h"] >= target
        else:
            stopped = bar["h"] >= stop
            tgt = bar["l"] <= target
        if stopped:
            outcome = -1.0
            exit_px = stop
            exit_i = j
            reason = "stop"
            break
        if tgt:
            outcome = target_r
            exit_px = target
            exit_i = j
            reason = "target"
            break
    if exit_px is None:
        return None
    if outcome is None:
        outcome = ((exit_px - entry) / risk) if side == "long" else ((entry - exit_px) / risk)
    return {
        "t": bars[start]["t"],
        "side": side,
        "r": round(outcome, 3),
        "exit": reason,
        "win": outcome > 0,
        "sameBar": exit_i == start,
    }


def collect(who, year, target_r, books):
    trades = []
    seen = set()
    for sym, book in books.items():
        bars = book.bars
        last_day = None
        count_day = 0
        for sig_i, side, stop, entry_i in signals(who, book):
            if et(bars[sig_i]["t"]).year != year:
                continue
            if entry_i >= len(bars) or et(bars[entry_i]["t"]).year != year:
                continue
            dk = day_key(bars[entry_i]["t"])
            if dk != last_day:
                last_day = dk
                count_day = 0
            if count_day >= 2:
                continue
            limit = None
            if who == "Vince":
                b = bars[sig_i]
                limit = (b["h"] + b["l"]) / 2
            tr = walk(bars, side, stop, entry_i, target_r, limit)
            if not tr:
                continue
            key = (sym, dk, side)
            if key in seen:
                continue
            seen.add(key)
            count_day += 1
            tr["symbol"] = sym
            tr["date"] = dk
            trades.append(tr)
    trades.sort(key=lambda t: t["t"])
    return trades


def stats(trades):
    n = len(trades)
    wins = sum(1 for t in trades if t["win"])
    sum_r = sum(t["r"] for t in trades)
    return {
        "n": n,
        "wins": wins,
        "wr": (wins / n) if n else None,
        "sumR": round(sum_r, 3),
        "expR": round(sum_r / n, 3) if n else None,
    }


def half(trades, which):
    if which == "h1":
        return [t for t in trades if int(t["date"][5:7]) <= 6]
    return [t for t in trades if int(t["date"][5:7]) >= 7]


def scratch_limit_same_bar(trades):
    n = 0
    for t in trades:
        if t.get("sameBar") and t["exit"] == "target":
            t["r"] = 0.0
            t["win"] = False
            t["exit"] = "same-bar"
            n += 1
    return n


def find_flaws(trades):
    flaws = []
    if not trades:
        return flaws, None
    h1, h2 = half(trades, "h1"), half(trades, "h2")
    same = [t for t in trades if t["exit"] == "same-bar"]
    if same:
        flaws.append(
            f"{len(same)} limit fills paid inside the same 15m bar. Counted as scratches. The path inside the bar was not known."
        )
    flats = [t for t in trades if t["exit"] == "flat"]
    if len(flats) >= 12 and len(flats) / len(trades) >= 0.15:
        flaws.append(
            f"{len(flats)} of {len(trades)} never reached a stop or a target. They died at the close. That target is too far for the session."
        )
    s1, s2 = stats(h1), stats(h2)
    if s1["wr"] is not None and s2["wr"] is not None and s1["wr"] - s2["wr"] >= 0.08 and s2["n"] >= 15:
        flaws.append(
            f"January–June won {s1['wr']*100:.0f}%. July–December won {s2['wr']*100:.0f}%. The half that picked the target did not travel."
        )
    cuts = {
        "ES": lambda t: t["symbol"] == "ES",
        "MNQ": lambda t: t["symbol"] == "MNQ",
        "longs": lambda t: t["side"] == "long",
        "shorts": lambda t: t["side"] == "short",
    }
    worst = None
    for name, pred in cuts.items():
        st = stats([t for t in h1 if pred(t)])
        if st["n"] >= 25 and st["expR"] is not None and st["expR"] < 0 and st["wr"] is not None and st["wr"] < 0.48:
            flaws.append(f"First half, {name} were {st['wins']}/{st['n']}, E[R] {st['expR']}. That slice is the leak.")
            if worst is None or st["expR"] < worst[0]:
                worst = (st["expR"], name, pred)
    adopted = None
    if worst:
        name, pred = worst[1], worst[2]
        before, after = stats(h2), stats([t for t in h2 if not pred(t)])
        full_after = stats([t for t in trades if not pred(t)])
        improved = (
            after["n"] >= 30
            and after["expR"] is not None
            and before["expR"] is not None
            and after["expR"] > before["expR"] + 0.05
        )
        if improved:
            flaws.append(
                f"Refusing {name} was decided on the first half. The second half went from E[R] {before['expR']} to {after['expR']} without them ({after['wins']}/{after['n']})."
            )
            adopted = {
                "refuse": name,
                "h2": after,
                "full": full_after,
                "cleared": bool(
                    after["wr"] is not None
                    and after["wr"] >= 0.65
                    and after["expR"] is not None
                    and after["expR"] > 0
                    and full_after["n"] >= 110
                ),
            }
        else:
            flaws.append(
                f"Refusing {name} looked right in the first half. The second half did not get better (E[R] {before['expR']} to {after['expR']}). The leak was not a rule."
            )
    if not flaws:
        flaws.append("No slice in the first half was a clear leak. The result stands as traded.")
    return flaws, adopted


def choose_target(who, year, books):
    best = None
    tried = []
    for r in TARGETS:
        trades = collect(who, year, r, books)
        if who == "Vince":
            scratch_limit_same_bar(trades)
        h1 = stats(half(trades, "h1"))
        tried.append({"targetR": r, "h1": h1})
        ok = h1["n"] >= 40 and h1["wr"] is not None and h1["wr"] >= 0.65 and h1["expR"] is not None and h1["expR"] > 0
        rank = (1 if ok else 0, h1["expR"] if h1["expR"] is not None else -99)
        if best is None or rank > best[0]:
            best = (rank, r, ok)
    return best[1], best[2], tried


def pct(wr):
    return "no trades" if wr is None else f"{wr * 100:.1f}%"


def main():
    window, source, dataset, raw_books = load()
    books = {sym: Book(bars) for sym, bars in raw_books.items()}
    rng = random.Random(20261006)
    assignment = {who: rng.choice(YEARS) for who in CREW}
    people = []
    for who in CREW:
        year = assignment[who]
        target, h1_ok, tried = choose_target(who, year, books)
        trades = collect(who, year, target, books)
        scratched = scratch_limit_same_bar(trades) if who == "Vince" else 0
        full, h1, h2 = stats(trades), stats(half(trades, "h1")), stats(half(trades, "h2"))
        flaws, adopted = find_flaws(trades)
        oos_ok = (
            h1_ok
            and h2["n"] >= 40
            and h2["wr"] is not None
            and h2["wr"] >= 0.65
            and h2["expR"] is not None
            and h2["expR"] > 0
            and full["n"] >= 110
        )
        desk = bool(oos_ok or (adopted and adopted["cleared"]))
        rule = {
            "Gemma": "Yesterday's high or low is swept, the close comes back through it, and price is still in discount or premium.",
            "Jax": "The sweep is not the entry. The next bar has to confirm. The fill is the bar after that.",
            "Nova": "Sweep and displacement, only when the stop is between 0.35 and 1.15 ATR and the last 20 bars agree.",
            "Sterling": "A second push that fails. Lunch is skipped. The stop is the failed extreme.",
            "Vince": "Sweep, displacement, then a limit at the midpoint. A same-bar pay is a scratch.",
        }[who]
        text = (
            f"{year}. {rule} Target {target}R was chosen on January–June only. "
            f"July–December {h2['wins']}/{h2['n']}, {pct(h2['wr'])}, E[R] {h2['expR']}. "
            f"Full year {full['wins']}/{full['n']}. "
            + ("The second half held 65% and paid, so this can sit on the desk. " if oos_ok else
               "It did not hold 65% out of sample. It stays mine. ")
            + "Flaw: " + flaws[0]
        )
        people.append(
            {
                "who": who,
                "year": year,
                "rule": rule,
                "targetR": target,
                "h1Cleared": h1_ok,
                "scratchedSameBar": scratched,
                "desk": desk,
                "skill": text,
                "flaws": flaws,
                "adopted": adopted,
                "h1": h1,
                "h2": h2,
                "full": full,
                "tried": tried,
                "trades": [
                    {"date": t["date"], "symbol": t["symbol"], "side": t["side"], "r": t["r"], "exit": t["exit"], "win": t["win"]}
                    for t in trades
                ],
            }
        )
        print(
            f"{who} {year} {target}R full {full['wins']}/{full['n']} "
            f"WR {pct(full['wr'])} H2 {h2['wins']}/{h2['n']} {pct(h2['wr'])} desk {desk} flaws {len(flaws)}"
        )
        for line in flaws:
            print("  -", line)
    out = {
        "version": 1,
        "source": source,
        "dataset": dataset,
        "file": "src/data/history-4y.json",
        "window": window,
        "seed": 20261006,
        "yearsAvailable": YEARS,
        "note": "Each person is a different rule on a year drawn from 2023, 2024, or 2025. 2020 and 2021 are not in the Databento file. The target is chosen on the first half. The second half is the number that counts. Flaws are measured on that same split.",
        "people": people,
    }
    OUT.write_text(json.dumps(out))
    print("wrote", OUT, OUT.stat().st_size)


if __name__ == "__main__":
    main()
