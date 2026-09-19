#!/usr/bin/env python3
"""Slice July–August 2026 15m history into teaching figures.

HARD RULE: a figure that would teach the wrong shape is not written.
Pivots must be real pivots (K=2, bars on both sides). A point must sit on
its candle. A bull FVG is bar[i].h < bar[i+2].l. A retrace close is INSIDE
the gap. IRL sits strictly inside ERL and the two internals are not the
same line. SMT is HH on one book vs LH on the other in the same window.

Run after learn-history.json + learn-cases.json exist.
"""
from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

ET = timezone(timedelta(hours=-4))  # Jul–Aug 2026 is EDT
K = 2
ROOT = Path(__file__).resolve().parents[1]
HIST = json.loads((ROOT / "src/data/learn-history.json").read_text())
CASES = json.loads((ROOT / "src/data/learn-cases.json").read_text())
ES = HIST["bars"]["ES"]
NQ = HIST["bars"]["MNQ"]


def et(ms: int) -> datetime:
    return datetime.fromtimestamp(ms / 1000, tz=ET)


def stamp(bars: list, symbol: str) -> str:
    a, b = et(bars[0]["t"]), et(bars[-1]["t"])
    return f"{symbol} 15m · {a.strftime('%a %b %-d %H:%M')}–{b.strftime('%H:%M ET')}"


def ohlc(bars):
    return [{"o": x["o"], "h": x["h"], "l": x["l"], "c": x["c"], "t": x["t"]} for x in bars]


def well_formed(b) -> bool:
    return b["h"] >= max(b["o"], b["c"]) - 1e-9 and b["l"] <= min(b["o"], b["c"]) + 1e-9


def ny_rth(bar) -> bool:
    d = et(bar["t"])
    if d.weekday() >= 5:
        return False
    m = d.hour * 60 + d.minute
    return 9 * 60 + 30 <= m <= 16 * 60


def ny_am(bar) -> bool:
    d = et(bar["t"])
    m = d.hour * 60 + d.minute
    return 9 * 60 <= m <= 16 * 60


def pivots(bars, k=K):
    """Real pivots only. No fallback to first/last bar."""
    n = len(bars)
    highs, lows = [], []
    for i in range(k, n - k):
        is_h = is_l = True
        for j in range(i - k, i + k + 1):
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
    return highs, lows


def last_two(idx, min_sep=3):
    if len(idx) < 2:
        return None
    a, b = idx[-2], idx[-1]
    if abs(b - a) < min_sep:
        return None
    return (a, b) if a < b else (b, a)


def structure_strict(bars):
    highs, lows = pivots(bars)
    hh = last_two(highs)
    ll = last_two(lows)
    if not hh or not ll:
        return None
    iH1, iH2 = hh
    iL1, iL2 = ll
    s = {
        "h1": bars[iH1]["h"],
        "h2": bars[iH2]["h"],
        "l1": bars[iL1]["l"],
        "l2": bars[iL2]["l"],
        "iH1": iH1,
        "iH2": iH2,
        "iL1": iL1,
        "iL2": iL2,
    }
    if s["h2"] > s["h1"] and s["l2"] > s["l1"]:
        kind = "bull"
    elif s["h2"] < s["h1"] and s["l2"] < s["l1"]:
        kind = "bear"
    elif s["h2"] > s["h1"] and s["l2"] < s["l1"]:
        kind = "expansion"
    elif s["h2"] < s["h1"] and s["l2"] > s["l1"]:
        kind = "coil"
    else:
        kind = "neutral"
    return kind, s


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


def aligned(a, b):
    ta = {x["t"]: x for x in a}
    tb = {x["t"]: x for x in b}
    keys = sorted(set(ta) & set(tb))
    return [ta[k] for k in keys], [tb[k] for k in keys]


def fig(fid, caption, bars, marks, symbol):
    assert bars and all(well_formed(b) for b in bars), fid
    return {
        "id": fid,
        "caption": f"{caption}  {stamp(bars, symbol)}",
        "bars": ohlc(bars),
        "marks": marks,
        "stamp": stamp(bars, symbol),
        "symbol": symbol,
    }


def assert_figure(f):
    """Refuse to ship a figure that would teach the wrong geometry."""
    bars = f["bars"]
    n = len(bars)
    hi = max(b["h"] for b in bars)
    lo = min(b["l"] for b in bars)
    fid = f["id"]
    if n < 8:
        raise SystemExit(f"{fid}: too short ({n})")
    for b in bars:
        if not well_formed(b):
            raise SystemExit(f"{fid}: ill-formed candle")
    for m in f["marks"]:
        if m["kind"] == "point":
            i = m["bar"]
            if not (0 <= i < n):
                raise SystemExit(f"{fid}: point bar {i} OOB")
            b = bars[i]
            if not (b["l"] - 0.011 <= m["price"] <= b["h"] + 0.011):
                raise SystemExit(f"{fid}: point {m['price']} not on bar {i} [{b['l']},{b['h']}]")
        if m["kind"] == "level":
            if not (lo - 0.05 <= m["price"] <= hi + 0.05):
                raise SystemExit(f"{fid}: level {m['price']} off tape")
        if m["kind"] == "zone":
            if m["top"] < m["bottom"] - 1e-9:
                raise SystemExit(f"{fid}: zone flipped")
            if m["top"] - m["bottom"] < 0.2:
                raise SystemExit(f"{fid}: zone has no height")
        if m["kind"] == "split" and not (0 <= m["bar"] < n):
            raise SystemExit(f"{fid}: split OOB")
    if fid == "fvg":
        zone = next(m for m in f["marks"] if m["kind"] == "zone")
        from_i = zone.get("from", 0)
        # three-bar: bar from_i high to bar from_i+2 low
        if from_i + 2 >= n:
            raise SystemExit("fvg: not a 3-bar")
        a, c = bars[from_i], bars[from_i + 2]
        bot, top = zone["bottom"], zone["top"]
        if abs(a["h"] - bot) > 0.3 and abs(a["h"] - top) > 0.3:
            # bull: zone is [bar1.h, bar3.l]
            if not (abs(min(a["h"], c["l"]) - bot) < 0.3 and abs(max(a["h"], c["l"]) - top) < 0.3):
                raise SystemExit(f"fvg: zone {bot}-{top} != 3-bar {a['h']}/{c['l']}")
    if fid == "liquidity":
        levels = [m for m in f["marks"] if m["kind"] == "level"]
        erl_h = next(m["price"] for m in levels if "ERL high" in m["label"])
        erl_l = next(m["price"] for m in levels if "ERL low" in m["label"])
        irl_h = next(m["price"] for m in levels if "IRL high" in m["label"])
        irl_l = next(m["price"] for m in levels if "IRL low" in m["label"])
        rng = erl_h - erl_l
        if not (erl_l + 0.05 * rng < irl_l < irl_h < erl_h - 0.05 * rng):
            raise SystemExit(f"liquidity: IRL not strictly inside ERL")
        if irl_h - irl_l < 0.12 * rng:
            raise SystemExit(f"liquidity: IRL high/low too close ({irl_h}-{irl_l})")
    if fid == "retrace-into":
        zone = next(m for m in f["marks"] if m["kind"] == "zone")
        pt = next(m for m in f["marks"] if m["kind"] == "point")
        if not (zone["bottom"] - 0.05 <= pt["price"] <= zone["top"] + 0.05):
            raise SystemExit(f"retrace-into: close {pt['price']} not in gap {zone['bottom']}-{zone['top']}")
    if fid.startswith("range-"):
        eq = next(m["price"] for m in f["marks"] if m["kind"] == "level" and m["label"].startswith("EQ"))
        last = bars[-1]["c"]
        if fid == "range-premium-short" and last <= eq:
            raise SystemExit(f"range-premium: last {last} not above EQ {eq}")
        if fid == "range-discount-short" and last >= eq:
            raise SystemExit(f"range-discount: last {last} not below EQ {eq}")
    if fid.startswith("bias-"):
        st = structure_strict(bars)
        if st is None:
            raise SystemExit(f"{fid}: no strict structure")
        kind, s = st
        want = {"bias-bull": "bull", "bias-bear": "bear", "bias-expansion": "expansion", "bias-coil": "coil"}[fid]
        if kind != want:
            raise SystemExit(f"{fid}: tape reads {kind}, claimed {want}")


# ── finders ──────────────────────────────────────────────────────────────


def find_fvg(bars, min_gap=2.0):
    best = None
    for i in range(2, len(bars) - 10):
        a, mid, c = bars[i - 2], bars[i - 1], bars[i]
        if not ny_am(mid):
            continue
        gap_bot, gap_top = a["h"], c["l"]
        if gap_top - gap_bot < min_gap:
            continue
        # displacement: middle body large vs neighbors
        body = abs(mid["c"] - mid["o"])
        if body < (gap_top - gap_bot) * 0.6:
            continue
        lo, hi = max(0, i - 8), min(len(bars), i + 10)
        sl = bars[lo:hi]
        from_i = (i - 2) - lo
        mid_i = (i - 1) - lo
        score = (gap_top - gap_bot) * body
        if 9 * 60 + 30 <= et(mid["t"]).hour * 60 + et(mid["t"]).minute <= 11 * 60:
            score *= 1.4
        if best is None or score > best[0]:
            best = (score, sl, from_i, mid_i, gap_bot, gap_top)
    return best


def find_session(bars):
    days = {}
    for b in bars:
        if not ny_rth(b):
            continue
        days.setdefault(et(b["t"]).date().isoformat(), []).append(b)
    best = None
    for day, sl in days.items():
        if len(sl) < 18:
            continue
        hi = max(x["h"] for x in sl)
        lo = min(x["l"] for x in sl)
        rng = hi - lo
        if rng < 20:
            continue
        highs, lows = pivots(sl, k=1)
        internals_h = [sl[i]["h"] for i in highs if sl[i]["h"] < hi - 0.08 * rng]
        internals_l = [sl[i]["l"] for i in lows if sl[i]["l"] > lo + 0.08 * rng]
        if not internals_h or not internals_l:
            continue
        peak = max(internals_h)
        plow = min(internals_l)
        if peak - plow < 0.18 * rng:
            continue
        if not (lo + 0.06 * rng < plow < peak < hi - 0.06 * rng):
            continue
        score = rng * (peak - plow)
        if best is None or score > best[0]:
            best = (score, sl, hi, lo, peak, plow, day)
    return best


def find_smt(es, nq, win=26):
    es, nq = aligned(es, nq)
    best = None
    for i in range(0, len(es) - win):
        e, n = es[i : i + win], nq[i : i + win]
        if not ny_am(e[win // 2]):
            continue
        se = structure_strict(e)
        sn = structure_strict(n)
        if not se or not sn:
            continue
        _, se = se
        _, sn = sn
        # NQ HH, ES LH
        if sn["h2"] > sn["h1"] + 12 and se["h2"] < se["h1"] - 1.0:
            score = (sn["h2"] - sn["h1"]) + (se["h1"] - se["h2"])
            if best is None or score > best[0]:
                best = (score, e, n, se, sn)
    return best


def find_structure(bars, want, win=24, min_range=10):
    best = None
    for i in range(0, len(bars) - win):
        sl = bars[i : i + win]
        if not ny_am(sl[win // 2]):
            continue
        st = structure_strict(sl)
        if not st:
            continue
        kind, s = st
        if kind != want:
            continue
        rng = max(x["h"] for x in sl) - min(x["l"] for x in sl)
        if rng < min_range:
            continue
        sep = min(abs(s["iH2"] - s["iH1"]), abs(s["iL2"] - s["iL1"]))
        score = rng * sep
        if best is None or score > best[0]:
            best = (score, sl, s, kind)
    return best


def find_raid(bars, side="bsl"):
    best = None
    for i in range(10, len(bars) - 6):
        if not ny_am(bars[i]):
            continue
        prior = bars[i - 8 : i]
        bar = bars[i]
        if side == "bsl":
            pool = max(x["h"] for x in prior)
            if bar["h"] <= pool + 0.25 or bar["c"] >= pool:
                continue
            pierce = bar["h"] - pool
            px = bar["h"]
        else:
            pool = min(x["l"] for x in prior)
            if bar["l"] >= pool - 0.25 or bar["c"] <= pool:
                continue
            pierce = pool - bar["l"]
            px = bar["l"]
        if pierce < 0.75:
            continue
        lo = max(0, i - 10)
        sl = bars[lo : i + 8]
        local = i - lo
        score = pierce
        if 9 * 60 + 30 <= et(bar["t"]).hour * 60 + et(bar["t"]).minute <= 11 * 60:
            score *= 1.3
        if best is None or score > best[0]:
            best = (score, sl, local, pool, px, bar)
    return best


def find_breakout(bars):
    best = None
    for i in range(10, len(bars) - 4):
        if not ny_am(bars[i]):
            continue
        prior = bars[i - 8 : i]
        pool = max(x["h"] for x in prior)
        bar = bars[i]
        if bar["c"] <= pool:
            continue
        nxt = bars[i + 1 : i + 3]
        if len(nxt) < 2 or any(x["c"] < pool for x in nxt):
            continue
        lo = max(0, i - 10)
        sl = bars[lo : i + 3]  # only the two hold bars — later noise is not the lesson
        local = i - lo
        score = bar["c"] - pool
        if best is None or score > best[0]:
            best = (score, sl, local, pool, bar)
    return best


def find_range(bars, want, win=24, min_rng=12):
    best = None
    for i in range(0, len(bars) - win):
        sl = bars[i : i + win]
        if not ny_am(sl[win // 2]):
            continue
        hi = max(x["h"] for x in sl)
        lo = min(x["l"] for x in sl)
        rng = hi - lo
        if rng < min_rng:
            continue
        eq = (hi + lo) / 2
        last = sl[-1]["c"]
        if want == "premium" and last <= eq + 0.08 * rng:
            continue
        if want == "discount" and last >= eq - 0.08 * rng:
            continue
        if want == "eq" and abs(last - eq) > 0.04 * rng:
            continue
        score = rng
        if best is None or score > best[0]:
            best = (score, sl, hi, lo, eq, last)
    return best


def find_retrace(bars, min_gap=1.75):
    best = None
    for i in range(2, len(bars) - 14):
        a, mid, c = bars[i - 2], bars[i - 1], bars[i]
        if not ny_am(mid):
            continue
        bot, top = a["h"], c["l"]
        if top - bot < min_gap:
            continue
        for j in range(i + 1, min(len(bars), i + 12)):
            b = bars[j]
            if not (bot <= b["c"] <= top):
                continue
            lo = max(0, i - 8)
            sl = bars[lo : j + 3]
            g = (i - 2) - lo
            inn = j - lo
            score = (top - bot) * (1.3 if ny_am(b) else 0.6)
            if best is None or score > best[0]:
                best = (score, sl, bot, top, g, inn, b["c"])
            break
    return best


figures = {}
misses = []

fvg = find_fvg(ES)
if fvg:
    score, sl, from_i, mid_i, bot, top = fvg
    figures["fvg"] = fig(
        "fvg",
        f"3-bar FVG {bot:.2f}–{top:.2f}. Bar 1 high never meets bar 3 low.",
        sl,
        [
            {"kind": "zone", "top": top, "bottom": bot, "label": f"FVG {top-bot:.2f}pt", "tone": "accent", "from": from_i},
            {"kind": "point", "bar": mid_i, "price": sl[mid_i]["c"], "label": "displacement", "tone": "accent"},
        ],
        "ESU6",
    )
else:
    misses.append("fvg")

sess = find_session(ES)
if sess:
    score, sl, hi, lo, peak, plow, day = sess
    figures["liquidity"] = fig(
        "liquidity",
        f"ERL {hi:.2f}/{lo:.2f}. IRL {peak:.2f}/{plow:.2f} sits inside.",
        sl,
        [
            {"kind": "level", "price": hi, "label": f"ERL high {hi:.2f}", "tone": "bad"},
            {"kind": "level", "price": lo, "label": f"ERL low {lo:.2f}", "tone": "good"},
            {"kind": "level", "price": peak, "label": f"IRL high {peak:.2f}", "tone": "neutral", "dash": True},
            {"kind": "level", "price": plow, "label": f"IRL low {plow:.2f}", "tone": "neutral", "dash": True},
        ],
        "ESU6",
    )
else:
    misses.append("liquidity")

smt = find_smt(ES, NQ)
if smt:
    score, e, n, se, sn = smt
    figures["smt-nq"] = fig(
        "smt-nq",
        f"NQ HH {sn['h1']:.0f}→{sn['h2']:.0f}.",
        n,
        [
            {"kind": "level", "price": sn["h1"], "label": f"prior {sn['h1']:.0f}", "tone": "neutral", "dash": True},
            {"kind": "point", "bar": sn["iH2"], "price": sn["h2"], "label": f"HH {sn['h2']:.0f}", "tone": "bad"},
        ],
        "NQU6",
    )
    figures["smt-es"] = fig(
        "smt-es",
        f"ES LH {se['h1']:.2f}→{se['h2']:.2f}. Same window. SMT.",
        e,
        [
            {"kind": "level", "price": se["h1"], "label": f"prior {se['h1']:.2f}", "tone": "neutral", "dash": True},
            {"kind": "point", "bar": se["iH2"], "price": se["h2"], "label": f"LH {se['h2']:.2f}", "tone": "good"},
        ],
        "ESU6",
    )
else:
    misses.append("smt")

# Risk: first chase with stop on the correct side and rr1 ≥ 1
risk_case = None
for k in CASES["cases"]:
    ch = k.get("chase") or {}
    p = ch.get("plan")
    if not p:
        continue
    side, entry, stop = p["side"], p["entry"], p["stop"]
    ok = (side == "short" and stop > entry) or (side == "long" and stop < entry)
    if ok and (p.get("rr1") or 0) >= 1:
        risk_case = k
        break
if not risk_case:
    for k in CASES["cases"]:
        p = (k.get("chase") or {}).get("plan")
        if not p:
            continue
        side, entry, stop = p["side"], p["entry"], p["stop"]
        if (side == "short" and stop > entry) or (side == "long" and stop < entry):
            risk_case = k
            break
if risk_case:
    p = risk_case["chase"]["plan"]
    rbars = risk_case["bars"]
    di = risk_case["decisionIndex"]
    lo = max(0, di - 12)
    hi = min(len(rbars), di + 8)
    sl = rbars[lo:hi]
    local = di - lo
    entry, stop = p["entry"], p["stop"]
    risk_pts = abs(stop - entry)
    short = p["side"] == "short"
    r1 = entry - risk_pts if short else entry + risk_pts
    sym = "NQU6" if risk_case["symbol"] == "MNQ" else "ESU6"
    ch = risk_case["chase"]
    figures["risk"] = fig(
        "risk",
        f"Stop {stop:.2f} beyond the raid. 1R={risk_pts:.2f}pt. Chase {ch['outcome']} {ch['r']:+.2f}R.",
        sl,
        [
            {"kind": "zone", "top": max(stop, entry), "bottom": min(stop, entry), "label": "1R risk", "tone": "bad"},
            {"kind": "zone", "top": max(entry, r1), "bottom": min(entry, r1), "label": "1R", "tone": "good"},
            {"kind": "level", "price": stop, "label": f"stop {stop:.2f}", "tone": "bad"},
            {"kind": "level", "price": entry, "label": f"entry {entry:.2f}", "tone": "accent", "dash": True},
            {"kind": "split", "bar": local, "label": "decision", "tone": "warn"},
        ],
        sym,
    )
else:
    misses.append("risk")

for want, fid, caption in [
    ("bull", "bias-bull", "HH and HL. Both conditions."),
    ("bear", "bias-bear", "LH and LL."),
    ("expansion", "bias-expansion", "HH and LL — expansion. No trend."),
    ("coil", "bias-coil", "LH and HL — compression. No trend."),
]:
    hit = find_structure(ES, want, win=24, min_range=8) or find_structure(NQ, want, win=24, min_range=20)
    if hit:
        score, sl, s, kind = hit
        sym = "ESU6" if abs(sl[0]["c"] - ES[0]["c"]) < abs(sl[0]["c"] - NQ[0]["c"]) else "NQU6"
        figures[fid] = fig(fid, caption, sl, swing_marks(s), sym)
    else:
        misses.append(fid)

raid = find_raid(ES, "bsl")
if raid:
    score, sl, local, pool, px, bar = raid
    figures["sweep-clean"] = fig(
        "sweep-clean",
        f"Wick {px:.2f} through BSL {pool:.2f}, close {bar['c']:.2f} back inside.",
        sl,
        [
            {"kind": "level", "price": pool, "label": f"BSL {pool:.2f}", "tone": "bad"},
            {"kind": "point", "bar": local, "price": px, "label": "raid", "tone": "warn"},
        ],
        "ESU6",
    )
else:
    misses.append("sweep-clean")

ssl = find_raid(ES, "ssl")
if ssl:
    score, sl, local, pool, px, bar = ssl
    figures["sweep-polarity"] = fig(
        "sweep-polarity",
        f"SSL raid {pool:.2f} wick {px:.2f}. Arms a LONG, not a short.",
        sl,
        [
            {"kind": "level", "price": pool, "label": f"SSL {pool:.2f}", "tone": "good"},
            {"kind": "point", "bar": local, "price": px, "label": "sellside raid", "tone": "warn"},
        ],
        "ESU6",
    )
else:
    misses.append("sweep-polarity")

brk = find_breakout(ES)
if brk:
    score, sl, local, pool, bar = brk
    figures["sweep-breakout"] = fig(
        "sweep-breakout",
        f"Close {bar['c']:.2f} through {pool:.2f} and holds. Acceptance, not a raid.",
        sl,
        [
            {"kind": "level", "price": pool, "label": f"level {pool:.2f}", "tone": "bad"},
            {"kind": "point", "bar": local, "price": bar["c"], "label": "close through", "tone": "bad"},
        ],
        "ESU6",
    )
else:
    misses.append("sweep-breakout")


def range_fig(fid, caption, hit, tag):
    score, sl, hi, lo, eq, last = hit
    return fig(
        fid,
        caption,
        sl,
        [
            {"kind": "zone", "top": hi, "bottom": eq, "label": "premium", "tone": "bad"},
            {"kind": "zone", "top": eq, "bottom": lo, "label": "discount", "tone": "good"},
            {"kind": "level", "price": eq, "label": f"EQ {eq:.2f}", "tone": "accent", "dash": True},
            {"kind": "point", "bar": len(sl) - 1, "price": last, "label": tag, "tone": "warn"},
        ],
        "ESU6",
    )


p = find_range(ES, "premium")
d = find_range(ES, "discount")
e = find_range(ES, "eq", min_rng=8)
if p:
    figures["range-premium-short"] = range_fig(
        "range-premium-short",
        f"Last {p[5]:.2f} is PREMIUM of EQ {p[4]:.2f}. Shorts live here.",
        p,
        f"{p[5]:.2f} premium",
    )
else:
    misses.append("range-premium-short")
if d:
    figures["range-discount-short"] = range_fig(
        "range-discount-short",
        f"Last {d[5]:.2f} is DISCOUNT of EQ {d[4]:.2f}. A short here is the trap.",
        d,
        f"{d[5]:.2f} discount",
    )
else:
    misses.append("range-discount-short")
if e:
    figures["range-eq"] = range_fig(
        "range-eq",
        f"Last {e[5]:.2f} at EQ {e[4]:.2f}. No R.",
        e,
        f"{e[5]:.2f} ~EQ",
    )
else:
    misses.append("range-eq")

rt = find_retrace(ES)
if rt:
    score, sl, bot, top, g, inn, close = rt
    figures["retrace-into"] = fig(
        "retrace-into",
        f"Close {close:.2f} back inside {bot:.2f}–{top:.2f}. That is the entry.",
        sl,
        [
            {"kind": "zone", "top": top, "bottom": bot, "label": "array", "tone": "accent", "from": g},
            {"kind": "point", "bar": inn, "price": close, "label": "in the array", "tone": "good"},
            {"kind": "split", "bar": g + 2, "label": "after displacement", "tone": "warn"},
        ],
        "ESU6",
    )
else:
    misses.append("retrace-into")

for f in figures.values():
    assert_figure(f)
    print(f["id"], f["stamp"])

if misses:
    print("MISS", misses, file=sys.stderr)
    # Missing is allowed only for optional ids; core must exist.
    core = {"fvg", "liquidity", "smt-nq", "risk", "bias-bull", "bias-bear", "sweep-clean"}
    if core & set(misses) or ( "smt" in misses):
        raise SystemExit(f"core figures missing: {misses}")

out = {
    "builtAt": datetime.now(timezone.utc).isoformat(),
    "historyCapturedAt": HIST["capturedAt"],
    "source": HIST["source"],
    "contracts": HIST["contracts"],
    "month": "2026-07/08",
    "figures": figures,
}
path = ROOT / "src/data/learn-figures.json"
path.write_text(json.dumps(out))
print("wrote", path, "n", len(figures), "bytes", path.stat().st_size)
if misses:
    print("optional misses", misses)
