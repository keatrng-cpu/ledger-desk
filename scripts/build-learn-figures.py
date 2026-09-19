#!/usr/bin/env python3
"""Slice August 2026 15m history into the Learn tab's teaching figures.

Finds real windows — FVG, session IRL/ERL, SMT, raid vs breakout, bias
shapes, a priced risk from a chase plan — and writes src/data/learn-figures.json.
Synthetic generators stay as fallback in TS if a key is missing.
"""
from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

ET = timezone(timedelta(hours=-4))  # August 2026 is EDT
ROOT = Path(__file__).resolve().parents[1]
HIST = json.loads((ROOT / "src/data/learn-history.json").read_text())
CASES = json.loads((ROOT / "src/data/learn-cases.json").read_text())
ES = HIST["bars"]["ES"]
NQ = HIST["bars"]["MNQ"]  # NQU6 prints stored as MNQ


def et(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=ET)


def stamp(bars: list, symbol: str) -> str:
    a, b = et(bars[0]["t"]), et(bars[-1]["t"])
    return f"{symbol} 15m · {a.strftime('%a %b %-d %H:%M')}–{b.strftime('%H:%M ET')}"


def ohlc(bars):
    return [{"o": x["o"], "h": x["h"], "l": x["l"], "c": x["c"], "t": x["t"]} for x in bars]


def swing_points(bars, K=2):
    n = len(bars)
    highs, lows = [], []
    for i in range(K, n - K):
        is_h = is_l = True
        for j in range(i - K, i + K + 1):
            if j == i:
                continue
            if bars[j]["h"] >= bars[i]["h"]:
                is_h = False
            if bars[j]["l"] <= bars[i]["l"]:
                is_l = False
        if is_h:
            highs.append(i)
        if is_l:
            lows.append(i)

    def pick(idx, kind):
        if len(idx) >= 2:
            return idx[-2], idx[-1]
        all_i = list(range(n))
        better = (lambda x, y: bars[x]["h"] > bars[y]["h"]) if kind == "h" else (lambda x, y: bars[x]["l"] < bars[y]["l"])
        sorted_i = sorted(all_i, key=lambda i: (0 if better(i, i) else 0, -bars[i]["h"] if kind == "h" else bars[i]["l"]))
        # sort by extremity
        if kind == "h":
            sorted_i = sorted(all_i, key=lambda i: -bars[i]["h"])
        else:
            sorted_i = sorted(all_i, key=lambda i: bars[i]["l"])
        first = sorted_i[0]
        second = next((i for i in sorted_i if abs(i - first) > K), sorted_i[1] if len(sorted_i) > 1 else first)
        return (first, second) if first < second else (second, first)

    iH1, iH2 = pick(highs, "h")
    iL1, iL2 = pick(lows, "l")
    return {
        "h1": bars[iH1]["h"],
        "h2": bars[iH2]["h"],
        "l1": bars[iL1]["l"],
        "l2": bars[iL2]["l"],
        "iH1": iH1,
        "iH2": iH2,
        "iL1": iL1,
        "iL2": iL2,
    }


def structure_of(bars):
    s = swing_points(bars)
    if s["h2"] > s["h1"] and s["l2"] > s["l1"]:
        return "bull", s
    if s["h2"] < s["h1"] and s["l2"] < s["l1"]:
        return "bear", s
    return "neutral", s


def swing_marks(s):
    return [
        {"kind": "point", "bar": s["iH1"], "price": s["h1"], "label": "prior high", "tone": "neutral"},
        {
            "kind": "point",
            "bar": s["iH2"],
            "price": s["h2"],
            "label": "HIGHER high" if s["h2"] > s["h1"] else "LOWER high",
            "tone": "good" if s["h2"] > s["h1"] else "bad",
        },
        {"kind": "point", "bar": s["iL1"], "price": s["l1"], "label": "prior low", "tone": "neutral"},
        {
            "kind": "point",
            "bar": s["iL2"],
            "price": s["l2"],
            "label": "HIGHER low" if s["l2"] > s["l1"] else "LOWER low",
            "tone": "good" if s["l2"] > s["l1"] else "bad",
        },
    ]


def ny_am(bar):
    d = et(bar["t"])
    m = d.hour * 60 + d.minute
    return 9 * 60 <= m <= 16 * 60


def find_fvg(bars, symbol, bull=True, min_gap=2.0):
    best = None
    for i in range(1, len(bars) - 10):
        a, mid, c = bars[i], bars[i + 1], bars[i + 2]
        if not ny_am(mid):
            continue
        if bull:
            gap_bot, gap_top = a["h"], c["l"]
            if gap_top - gap_bot < min_gap:
                continue
            body = abs(mid["c"] - mid["o"])
        else:
            gap_bot, gap_top = c["h"], a["l"]
            if gap_top - gap_bot < min_gap:
                continue
            body = abs(mid["c"] - mid["o"])
        lo, hi = max(0, i - 6), min(len(bars), i + 12)
        sl = bars[lo:hi]
        mid_i = i - lo + 1
        score = (gap_top - gap_bot) * (1.2 if 9 * 60 + 30 <= et(mid["t"]).hour * 60 + et(mid["t"]).minute <= 11 * 60 else 1)
        score *= 1 + body / max(mid["h"] - mid["l"], 0.25)
        if best is None or score > best[0]:
            best = (
                score,
                sl,
                {
                    "kind": "zone",
                    "top": max(gap_top, gap_bot),
                    "bottom": min(gap_top, gap_bot),
                    "label": "FVG",
                    "tone": "accent",
                    "from": mid_i - 1,
                },
                mid_i,
            )
    return best


def find_session(bars):
    """Best RTH session with a wide range and a clear internal swing."""
    days = {}
    for b in bars:
        d = et(b["t"])
        if d.weekday() >= 5:
            continue
        m = d.hour * 60 + d.minute
        if m < 9 * 60 + 30 or m > 16 * 60:
            continue
        days.setdefault(d.date().isoformat(), []).append(b)
    best = None
    for day, sl in days.items():
        if len(sl) < 16:
            continue
        hi = max(x["h"] for x in sl)
        lo = min(x["l"] for x in sl)
        rng = hi - lo
        n = len(sl)
        first_peak = max(x["h"] for x in sl[: max(6, n // 3)])
        pull_low = min(x["l"] for x in sl[n // 3 : (2 * n) // 3] or sl)
        # internals must sit strictly inside ERL
        if not (lo + rng * 0.08 < pull_low < hi - rng * 0.08):
            continue
        if not (lo + rng * 0.08 < first_peak < hi - rng * 0.08):
            continue
        if first_peak >= hi - 0.25 or pull_low <= lo + 0.25:
            continue
        score = rng
        if best is None or score > best[0]:
            best = (score, sl, hi, lo, first_peak, pull_low, day)
    return best


def aligned(a, b):
    ta = {x["t"]: x for x in a}
    tb = {x["t"]: x for x in b}
    keys = sorted(set(ta) & set(tb))
    return [ta[k] for k in keys], [tb[k] for k in keys]


def find_smt(es, nq, win=24):
    es, nq = aligned(es, nq)
    best = None
    for i in range(0, len(es) - win):
        e = es[i : i + win]
        n = nq[i : i + win]
        if not ny_am(e[win // 2]):
            continue
        se = swing_points(e)
        sn = swing_points(n)
        # NQ HH, ES LH — the classic SMT short crack
        if sn["h2"] > sn["h1"] and se["h2"] < se["h1"] and (sn["h2"] - sn["h1"]) > 8:
            score = (sn["h2"] - sn["h1"]) + (se["h1"] - se["h2"])
            if best is None or score > best[0]:
                best = (score, e, n, se, sn)
    return best


def find_structure(bars, want, win=22, min_range=8):
    best = None
    for i in range(0, len(bars) - win):
        sl = bars[i : i + win]
        if not ny_am(sl[win // 2]):
            continue
        st, s = structure_of(sl)
        if st != want and not (want == "expansion" or want == "coil"):
            continue
        if want == "expansion":
            if not (s["h2"] > s["h1"] and s["l2"] < s["l1"]):
                continue
        elif want == "coil":
            if not (s["h2"] < s["h1"] and s["l2"] > s["l1"]):
                continue
        elif st != want:
            continue
        rng = max(x["h"] for x in sl) - min(x["l"] for x in sl)
        if rng < min_range:
            continue
        # prefer distinct swings (not adjacent)
        sep = min(abs(s["iH2"] - s["iH1"]), abs(s["iL2"] - s["iL1"]))
        score = rng * sep
        if best is None or score > best[0]:
            best = (score, sl, s, st)
    return best


def find_raid(bars, side="bsl", win=20):
    """Wick through a prior pool, close back inside."""
    best = None
    for i in range(8, len(bars) - 6):
        if not ny_am(bars[i]):
            continue
        prior = bars[i - 8 : i]
        bar = bars[i]
        if side == "bsl":
            pool = max(x["h"] for x in prior)
            if bar["h"] <= pool or bar["c"] >= pool:
                continue
            pierce = bar["h"] - pool
        else:
            pool = min(x["l"] for x in prior)
            if bar["l"] >= pool or bar["c"] <= pool:
                continue
            pierce = pool - bar["l"]
        if pierce < 0.5:
            continue
        lo = max(0, i - 10)
        sl = bars[lo : i + 8]
        local = i - lo
        score = pierce * (2 if 9 * 60 + 30 <= et(bar["t"]).hour * 60 + et(bar["t"]).minute <= 11 * 60 else 1)
        if best is None or score > best[0]:
            best = (score, sl, local, pool, bar)
    return best


def find_breakout(bars, win=20):
    best = None
    for i in range(8, len(bars) - 4):
        if not ny_am(bars[i]):
            continue
        prior = bars[i - 8 : i]
        pool = max(x["h"] for x in prior)
        bar = bars[i]
        if bar["c"] <= pool or bar["h"] < pool:
            continue
        nxt = bars[i + 1 : i + 3]
        if not nxt or any(x["c"] < pool for x in nxt):
            continue
        lo = max(0, i - 10)
        sl = bars[lo : i + 6]
        local = i - lo
        score = bar["c"] - pool
        if best is None or score > best[0]:
            best = (score, sl, local, pool, bar)
    return best


def fig(fid, caption, bars, marks, symbol):
    return {
        "id": fid,
        "caption": f"{caption}  {stamp(bars, symbol)}",
        "bars": ohlc(bars),
        "marks": marks,
        "stamp": stamp(bars, symbol),
        "symbol": symbol,
    }


figures = {}

# ── FVG ──────────────────────────────────────────────────────────────────
fvg = find_fvg(ES, "ESU6", bull=True, min_gap=1.5)
if fvg:
    score, sl, zone, mid_i = fvg
    figures["fvg"] = fig(
        "fvg",
        "Three-bar gap: bar 1 high never meets bar 3 low.",
        sl,
        [
            zone,
            {"kind": "point", "bar": mid_i, "price": sl[mid_i]["c"], "label": "displacement", "tone": "accent"},
        ],
        "ESU6",
    )
    print("fvg", figures["fvg"]["stamp"], "gap", round(zone["top"] - zone["bottom"], 2))

# ── Liquidity / IRL vs ERL ───────────────────────────────────────────────
sess = find_session(ES)
if sess:
    score, sl, hi, lo, peak, plow, day = sess
    figures["liquidity"] = fig(
        "liquidity",
        "ERL is the session edges. IRL is everything between.",
        sl,
        [
            {"kind": "level", "price": hi, "label": f"ERL high {hi:.2f}", "tone": "bad"},
            {"kind": "level", "price": lo, "label": f"ERL low {lo:.2f}", "tone": "good"},
            {"kind": "level", "price": peak, "label": f"IRL high {peak:.2f}", "tone": "neutral", "dash": True},
            {"kind": "level", "price": plow, "label": f"IRL low {plow:.2f}", "tone": "neutral", "dash": True},
        ],
        "ESU6",
    )
    print("liquidity", figures["liquidity"]["stamp"], "H", hi, "L", lo)

# ── SMT ──────────────────────────────────────────────────────────────────
smt = find_smt(ES, NQ)
if smt:
    score, e, n, se, sn = smt
    figures["smt-nq"] = fig(
        "smt-nq",
        "NQ — takes the prior high.",
        n,
        [
            {"kind": "level", "price": sn["h1"], "label": f"prior {sn['h1']:.0f}", "tone": "neutral", "dash": True},
            {"kind": "point", "bar": sn["iH2"], "price": sn["h2"], "label": f"HH {sn['h2']:.0f}", "tone": "bad"},
        ],
        "NQU6",
    )
    figures["smt-es"] = fig(
        "smt-es",
        "ES — same window, lower high. That disagreement is the crack.",
        e,
        [
            {"kind": "level", "price": se["h1"], "label": f"prior {se['h1']:.2f}", "tone": "neutral", "dash": True},
            {"kind": "point", "bar": se["iH2"], "price": se["h2"], "label": f"LH {se['h2']:.2f}", "tone": "good"},
        ],
        "ESU6",
    )
    print("smt", figures["smt-nq"]["stamp"], "NQ HH", sn["h1"], "→", sn["h2"], "ES", se["h1"], "→", se["h2"])

# ── Risk from a real chase (Aug 5 MNQ WAIT, rr 1.79, -1R) ───────────────
risk_case = next(
    (k for k in CASES["cases"] if k["decisionEt"].startswith("Wed, Aug 5") and k["symbol"] == "MNQ"),
    CASES["cases"][0],
)
plan = (risk_case.get("chase") or {}).get("plan") or risk_case.get("plan")
rbars = risk_case["bars"]
# show ~18 bars around decision
di = risk_case["decisionIndex"]
lo = max(0, di - 12)
hi = min(len(rbars), di + 8)
sl = rbars[lo:hi]
local = di - lo
if plan:
    entry, stop = plan["entry"], plan["stop"]
    risk_pts = abs(stop - entry)
    short = plan["side"] == "short"
    r1 = entry - risk_pts if short else entry + risk_pts
    r2 = entry - 2 * risk_pts if short else entry + 2 * risk_pts
    raid = max(x["h"] for x in sl[: local + 1]) if short else min(x["l"] for x in sl[: local + 1])
    figures["risk"] = fig(
        "risk",
        f"Stop {stop:.2f} beyond the raid. 1R={risk_pts:.2f}pt. Chase {risk_case['chase']['outcome']} {risk_case['chase']['r']:+.2f}R.",
        sl,
        [
            {"kind": "zone", "top": max(stop, entry), "bottom": min(stop, entry), "label": "1R risk", "tone": "bad"},
            {"kind": "zone", "top": max(entry, r1), "bottom": min(entry, r1), "label": "1R", "tone": "good"},
            {"kind": "level", "price": stop, "label": f"stop {stop:.2f}", "tone": "bad"},
            {"kind": "level", "price": entry, "label": f"entry {entry:.2f}", "tone": "accent", "dash": True},
            {"kind": "split", "bar": local, "label": "decision", "tone": "warn"},
        ],
        "NQU6",
    )
    print("risk", figures["risk"]["stamp"], "entry", entry, "stop", stop, "R", risk_case["chase"]["r"])

# ── Bias windows ─────────────────────────────────────────────────────────
for want, fid, caption in [
    ("bull", "bias-bull", "HH and HL. Both conditions."),
    ("bear", "bias-bear", "LH and LL."),
    ("expansion", "bias-expansion", "HH and LL — expansion. No trend."),
    ("coil", "bias-coil", "LH and HL — compression. No trend."),
]:
    hit = find_structure(ES if want != "bull" else NQ, want, win=22, min_range=12 if want != "coil" else 6)
    if not hit:
        hit = find_structure(ES, want, win=26, min_range=4)
    if hit:
        score, sl, s, st = hit
        figures[fid] = fig(fid, caption, sl, swing_marks(s), "ESU6" if sl is ES or sl[0] in ES else "NQU6")
        # symbol guess
        figures[fid]["symbol"] = "ESU6" if abs(sl[0]["c"] - ES[0]["c"]) < abs(sl[0]["c"] - NQ[0]["c"]) else "NQU6"
        figures[fid]["caption"] = f"{caption}  {stamp(sl, figures[fid]['symbol'])}"
        print(fid, figures[fid]["stamp"], "struct", st, "HH" if s["h2"]>s["h1"] else "LH", "HL" if s["l2"]>s["l1"] else "LL")
    else:
        print("MISS", fid)

# ── Sweep vs breakout ────────────────────────────────────────────────────
raid = find_raid(ES, "bsl")
if raid:
    score, sl, local, pool, bar = raid
    figures["sweep-clean"] = fig(
        "sweep-clean",
        f"Wick through {pool:.2f}, close back inside {bar['c']:.2f}.",
        sl,
        [
            {"kind": "level", "price": pool, "label": f"BSL {pool:.2f}", "tone": "bad"},
            {"kind": "point", "bar": local, "price": bar["h"], "label": "raid", "tone": "warn"},
        ],
        "ESU6",
    )
    print("sweep-clean", figures["sweep-clean"]["stamp"], "pool", pool, "wick", bar["h"], "close", bar["c"])

ssl = find_raid(ES, "ssl")
if ssl:
    score, sl, local, pool, bar = ssl
    figures["sweep-polarity"] = fig(
        "sweep-polarity",
        f"SSL raid {pool:.2f} — arms a LONG, not a short.",
        sl,
        [
            {"kind": "level", "price": pool, "label": f"SSL {pool:.2f}", "tone": "good"},
            {"kind": "point", "bar": local, "price": bar["l"], "label": "sellside raid", "tone": "warn"},
        ],
        "ESU6",
    )
    print("sweep-polarity", figures["sweep-polarity"]["stamp"])

brk = find_breakout(ES)
if brk:
    score, sl, local, pool, bar = brk
    figures["sweep-breakout"] = fig(
        "sweep-breakout",
        f"Close {bar['c']:.2f} beyond {pool:.2f} and holds. Acceptance, not a raid.",
        sl,
        [
            {"kind": "level", "price": pool, "label": f"level {pool:.2f}", "tone": "bad"},
            {"kind": "point", "bar": local, "price": bar["c"], "label": "close through", "tone": "bad"},
        ],
        "ESU6",
    )
    print("sweep-breakout", figures["sweep-breakout"]["stamp"])

# ── Range halves: pick a wide window, mark EQ ────────────────────────────
hit = find_structure(ES, "bear", win=24, min_range=15) or find_structure(ES, "bull", win=24, min_range=15)
if hit:
    score, sl, s, st = hit
    hi, lo = max(x["h"] for x in sl), min(x["l"] for x in sl)
    eq = (hi + lo) / 2
    last = sl[-1]["c"]
    figures["range-premium-short"] = fig(
        "range-premium-short",
        f"EQ {eq:.2f}. Last {last:.2f} is {'premium' if last>eq else 'discount'}.",
        sl,
        [
            {"kind": "zone", "top": hi, "bottom": eq, "label": "premium", "tone": "bad"},
            {"kind": "zone", "top": eq, "bottom": lo, "label": "discount", "tone": "good"},
            {"kind": "level", "price": eq, "label": f"EQ {eq:.2f}", "tone": "accent", "dash": True},
        ],
        "ESU6",
    )
    figures["range-discount-short"] = figures["range-premium-short"]  # same picture, copy caption in TS
    figures["range-eq"] = figures["range-premium-short"]
    print("range", figures["range-premium-short"]["stamp"], "EQ", eq, "last", last)

# ── Retrace: FVG then later bars trade back into it ──────────────────────
best_rt = None
for i in range(2, len(ES) - 14):
    a, mid, c = ES[i - 2], ES[i - 1], ES[i]
    if not ny_am(mid):
        continue
    bot, top = a["h"], c["l"]
    if top - bot < 1.5:
        continue
    # look forward for a bar that trades into the gap
    for j in range(i + 1, min(len(ES), i + 12)):
        b = ES[j]
        into = b["l"] <= top and b["h"] >= bot
        if into:
            lo = max(0, i - 8)
            sl = ES[lo : j + 4]
            local_gap = (i - 2) - lo
            local_in = j - lo
            score = (top - bot) * (1 if ny_am(b) else 0.5)
            if best_rt is None or score > best_rt[0]:
                best_rt = (score, sl, bot, top, local_gap, local_in)
            break
if best_rt:
    score, sl, bot, top, g, inn = best_rt
    figures["retrace-into"] = fig(
        "retrace-into",
        f"Price returns into the gap {bot:.2f}–{top:.2f}. That is the entry.",
        sl,
        [
            {"kind": "zone", "top": top, "bottom": bot, "label": "array", "tone": "accent", "from": g},
            {"kind": "point", "bar": inn, "price": sl[inn]["c"], "label": "in the array", "tone": "good"},
            {"kind": "split", "bar": g + 2, "label": "after displacement", "tone": "warn"},
        ],
        "ESU6",
    )
    print("retrace-into", figures["retrace-into"]["stamp"])

out = {
    "builtAt": datetime.now(timezone.utc).isoformat(),
    "historyCapturedAt": HIST["capturedAt"],
    "source": HIST["source"],
    "contracts": HIST["contracts"],
    "month": "2026-08",
    "figures": figures,
}
path = ROOT / "src/data/learn-figures.json"
path.write_text(json.dumps(out))
print("wrote", path, "n", len(figures), "bytes", path.stat().st_size)
print("ids", sorted(figures))
