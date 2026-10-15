"""Pure SMC structure detection on CT-indexed OHLC frames. Every detector only uses bars that had CLOSED by `asof`
(bar open + tf <= asof), so features 'at entry' never peek at later bars."""
import datetime as D
import numpy as np
import pandas as pd

TICK = 0.25
def snap(x, tick=TICK):
    """Round a price to the instrument tick (ES/NQ/MES/MNQ: 0.25)."""
    return None if x is None else round(round(float(x) / tick) * tick, 2)

def swept_at(df, px, hi_side, start=None):
    """First bar (open time) strictly after `start` that trades THROUGH px (high > px for a high, low < px for a low),
    whether or not it closes back. That is when a level/pool stops being resting liquidity. None if never."""
    if px is None or not len(df): return None
    x = df if start is None else df[df.index > pd.Timestamp(start)]
    hit = x[x.high > px] if hi_side else x[x.low < px]
    return hit.index[0] if len(hit) else None

def session_level_ends(t):
    """When each session level is complete (sweeps only count after): PD -> prior 15:00, ON/PM -> 08:30 today."""
    tz = "America/Chicago"; day = trading_day(t); prev = day - D.timedelta(days=1)
    while prev.weekday() >= 5: prev -= D.timedelta(days=1)
    at = lambda d, hh, mm: pd.Timestamp(D.datetime.combine(d, D.time(hh, mm))).tz_localize(tz)
    e = dict(PD=at(prev, 15, 0), ON=at(day, 8, 30), PM=at(day, 8, 30))
    return {k + s: v for k, v in e.items() for s in "HL"}

def mark_swept(m1, levels, pools, t_in):
    """{'PDH': ts, ...} for PD/ON/PM levels traded through after they formed, and pool['swept'] set in place for
    EQH/EQL pools (after the pool's last touch is confirmed). Uses every bar in m1 (drawing, not entry features)."""
    ends = session_level_ends(t_in); out = {}
    for k, v in levels.items():
        if k in ends:
            ts = swept_at(m1, v, k.endswith("H"), max(ends[k], m1.index[0] - pd.Timedelta(minutes=1)) if len(m1) else ends[k])
            if ts is not None: out[k] = ts
    for p in pools:
        p["swept"] = swept_at(m1, p["px"], p["kind"] == "EQH", p.get("t1", p.get("t0")) + pd.Timedelta(minutes=5) if p.get("t1", p.get("t0")) is not None else None)
    return out

def closed(df, asof, tf_min):
    if asof is None or not len(df): return df
    return df[df.index + pd.Timedelta(minutes=tf_min) <= asof]

def atr(df, n=14):
    if not len(df): return float("nan")
    tr = pd.concat([df.high - df.low, (df.high - df.close.shift()).abs(), (df.low - df.close.shift()).abs()], axis=1).max(axis=1)
    return float(tr.tail(n).mean())

def swings(df, n=2):
    """Fractal swings: high/low strictly beyond the n bars on each side. Confirmed n bars after the pivot."""
    out = []; h, l, ix = df.high.values, df.low.values, df.index
    for i in range(n, len(df) - n):
        if h[i] > max(h[i - n:i]) and h[i] >= max(h[i + 1:i + n + 1]): out.append(dict(kind="H", t=ix[i], px=float(h[i]), confirmed=ix[i + n]))
        if l[i] < min(l[i - n:i]) and l[i] <= min(l[i + 1:i + n + 1]): out.append(dict(kind="L", t=ix[i], px=float(l[i]), confirmed=ix[i + n]))
    return out

def equal_levels(sw, tol):
    """Equal highs / equal lows (liquidity pools): two or more same-kind swings within `tol` points."""
    pools = []
    for kind in ("H", "L"):
        xs = [s for s in sw if s["kind"] == kind]
        for i, a in enumerate(xs):
            grp = [a] + [b for b in xs[i + 1:] if abs(b["px"] - a["px"]) <= tol]
            if len(grp) >= 2 and not any(p["kind"] == kind and abs(p["px"] - a["px"]) <= tol and p["t0"] <= a["t"] for p in pools):
                pools.append(dict(kind="EQH" if kind == "H" else "EQL", px=float((max if kind == "H" else min)(g["px"] for g in grp)),
                                  t0=grp[0]["t"], t1=grp[-1]["t"], n=len(grp)))
    return pools

def fvgs(df, min_size=0.0):
    """3-bar fair value gaps. Bull: low[i] > high[i-2]. Inverted (iFVG) when a later bar CLOSES through the far edge:
    a bull FVG closed below its low becomes bearish support->resistance (iFVG bear) and vice versa."""
    out = []; o, h, l, c, ix = df.open.values, df.high.values, df.low.values, df.close.values, df.index
    for i in range(2, len(df)):
        if l[i] > h[i - 2] and l[i] - h[i - 2] >= min_size: out.append(dict(side="bull", lo=float(h[i - 2]), hi=float(l[i]), t=ix[i - 1], formed=ix[i], i=i))
        if h[i] < l[i - 2] and l[i - 2] - h[i] >= min_size: out.append(dict(side="bear", lo=float(h[i]), hi=float(l[i - 2]), t=ix[i - 1], formed=ix[i], i=i))
    for g in out:
        g["inverted"] = None; g["filled"] = None
        for j in range(g.pop("i") + 1, len(df)):
            if g["filled"] is None and ((g["side"] == "bull" and l[j] <= g["lo"]) or (g["side"] == "bear" and h[j] >= g["hi"])): g["filled"] = ix[j]
            if (g["side"] == "bull" and c[j] < g["lo"]) or (g["side"] == "bear" and c[j] > g["hi"]):
                g["inverted"] = ix[j]; break
    return out

def order_blocks(df, a, k=1.5, look=3):
    """OB = last opposite-colour candle within `look` bars before a displacement candle (body >= k*ATR... scaled by
    mean bar range). Broken when a later bar closes beyond the OB's far edge."""
    out = []; o, h, l, c, ix = df.open.values, df.high.values, df.low.values, df.close.values, df.index
    rng = (df.high - df.low).rolling(20, min_periods=5).mean().values
    for i in range(1, len(df)):
        body = c[i] - o[i]; ref = rng[i - 1] if not np.isnan(rng[i - 1]) else a
        if not ref or abs(body) < k * ref: continue
        bull = body > 0
        for j in range(i - 1, max(-1, i - 1 - look), -1):
            if (c[j] < o[j]) == bull:
                ob = dict(side="bull" if bull else "bear", lo=float(l[j]), hi=float(h[j]), t=ix[j], disp_t=ix[i], broken=None)
                for m in range(i + 1, len(df)):
                    if (bull and c[m] < ob["lo"]) or (not bull and c[m] > ob["hi"]): ob["broken"] = ix[m]; break
                out.append(ob); break
    return out

def sweeps(df, levels):
    """A bar that trades through a prior level and closes back on the original side.
    levels: [dict(kind 'H'|'L'|'EQH'|'EQL'|name, px, t)]. BSL sweep = above a high; SSL sweep = below a low."""
    out = []; h, l, c, ix = df.high.values, df.low.values, df.close.values, df.index
    for lv in levels:
        hi_side = lv["kind"] in ("H", "EQH") or lv.get("side") == "high"
        start = lv.get("t1", lv.get("t"))
        for i in range(len(df)):
            if start is not None and ix[i] <= start: continue
            if hi_side and h[i] > lv["px"] and c[i] < lv["px"]:
                out.append(dict(kind="BSL", px=lv["px"], t=ix[i], level=lv.get("name", lv["kind"]))); break
            if not hi_side and l[i] < lv["px"] and c[i] > lv["px"]:
                out.append(dict(kind="SSL", px=lv["px"], t=ix[i], level=lv.get("name", lv["kind"]))); break
            if (hi_side and c[i] > lv["px"]) or (not hi_side and c[i] < lv["px"]): break   # taken cleanly: no longer a sweep candidate
    return out

def bias(df, n=2):
    """HTF bias from structure: last two swing highs and lows: HH+HL bull, LH+LL bear; otherwise close vs 20-bar mean."""
    if len(df) < 8: return "n/a"
    sw = swings(df, n); H = [s["px"] for s in sw if s["kind"] == "H"][-2:]; L = [s["px"] for s in sw if s["kind"] == "L"][-2:]
    if len(H) == 2 and len(L) == 2:
        if H[1] > H[0] and L[1] > L[0]: return "bull"
        if H[1] < H[0] and L[1] < L[0]: return "bear"
    m = df.close.tail(20).mean(); last = df.close.iloc[-1]
    return "bull" if last > m else "bear" if last < m else "range"

def trading_day(t):
    """CME trading day: bars from 17:00 CT belong to the next day."""
    t = pd.Timestamp(t); d = t.date()
    if t.hour >= 17: d = d + D.timedelta(days=1)
    while d.weekday() >= 5: d = d + D.timedelta(days=1)
    return d

def session_levels(m1, t):
    """PDH/PDL (prior RTH 08:30-15:00 CT), overnight (17:00 prior -> 08:30) and premarket (07:00-08:30) high/low,
    and today's RTH range so far. Only bars closed before t."""
    tz = "America/Chicago"; t = pd.Timestamp(t); day = trading_day(t)
    def at(d, hh, mm): return pd.Timestamp(D.datetime.combine(d, D.time(hh, mm))).tz_localize(tz)
    prev = day - D.timedelta(days=1)
    while prev.weekday() >= 5: prev -= D.timedelta(days=1)
    m = closed(m1, t, 1); out = {}
    def hl(a, b, key):
        x = m[(m.index >= a) & (m.index < b)]
        if len(x): out[key + "H"] = float(x.high.max()); out[key + "L"] = float(x.low.min())
    hl(at(prev, 8, 30), at(prev, 15, 0), "PD")
    hl(at(prev, 17, 0) if prev != day else at(day - D.timedelta(days=1), 17, 0), at(day, 8, 30), "ON")
    hl(at(day, 7, 0), at(day, 8, 30), "PM")
    hl(at(day, 8, 30), min(t, at(day, 15, 0)), "RTH")
    return out

def dealing_range(lv, t):
    """Range for EQ/premium: today's RTH range once >= 15 min old, else the overnight range."""
    t = pd.Timestamp(t)
    rth_ok = "RTHH" in lv and (t.hour, t.minute) >= (8, 45) and t.hour < 15
    hi, lo, name = (lv.get("RTHH"), lv.get("RTHL"), "RTH") if rth_ok else (lv.get("ONH"), lv.get("ONL"), "ON")
    if hi is None or lo is None or hi <= lo: return None
    return dict(hi=hi, lo=lo, eq=snap((hi + lo) / 2), name=name)

def session_phase(t):
    t = pd.Timestamp(t); m = t.hour * 60 + t.minute
    if m >= 17 * 60 or m < 60: return "asia"
    if m < 7 * 60: return "london"
    if m < 8 * 60 + 30: return "premarket"
    if m < 10 * 60: return "ny_open"
    if m < 12 * 60: return "ny_mid"
    if m < 15 * 60: return "ny_pm"
    return "post"

def displacement(df, t, side, tf=5, look=6):
    """Largest with-side candle body in the last `look` closed bars before t, in ATR units (0 if none)."""
    c = closed(df, t, tf); x = c.tail(look); a = atr(c)
    if not len(x) or not a or np.isnan(a): return 0.0
    b = (x.close - x.open) * (1 if side == "long" else -1)
    return round(float(max(0.0, b.max()) / a), 2)
