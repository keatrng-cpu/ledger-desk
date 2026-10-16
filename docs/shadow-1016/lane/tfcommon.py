"""Shared engine for the 2026-10-16 shadow validations (Rule 1 events + all-timeframe closed-bar context).

Signals: scripts/rule1.py (the desk's Python mirror), walked minute by minute 08:31-09:05 CT on 1m bars that CLOSED
before each decision time (rule1_ticket drops bars with t + 60s > now). Days whose slice crosses a contract roll
(instrument_id change) are skipped. Timeframes 30s..1D are read AS OF the decision time T = ticket.at:
for each tf the last bar whose END (label + tf) <= T, never a bar still forming. 30s/1s exist only from 2026-08-16.
"""
import json, math, os, sys
from concurrent.futures import ProcessPoolExecutor
import numpy as np, pandas as pd

ROOT = os.environ.get("LD_ROOT", os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..")))
DATA = os.environ.get("DB_DATA", "/workspace/data/databento")
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import rule1 as R  # noqa: E402

MIN = 60_000
TFS = [("30s", 30_000), ("1m", 60_000), ("2m", 120_000), ("3m", 180_000), ("5m", 300_000), ("15m", 900_000),
       ("30m", 1_800_000), ("1h", 3_600_000), ("4h", 14_400_000), ("1D", None)]
SYMS = {"ES": "ES", "NQ": "NQ"}


def load(sym):
    m = pd.read_parquet(f"{DATA}/{sym}_1m.parquet")
    t = (m.index.asi8 // 1_000_000).astype(np.int64)
    s = pd.read_parquet(f"{DATA}/{sym}_30s.parquet")
    return dict(t=t, o=m.open.values, h=m.high.values, l=m.low.values, c=m.close.values, iid=m.instrument_id.values,
                t30=(s.index.asi8 // 1_000_000).astype(np.int64), o30=s.open.values, c30=s.close.values)


def ct_day_bounds(day):
    d = pd.Timestamp(day, tz="America/Chicago")
    return d


def _bars(D, i0, i1):
    return [dict(t=int(D["t"][k]), o=float(D["o"][k]), h=float(D["h"][k]), l=float(D["l"][k]), c=float(D["c"][k])) for k in range(i0, i1)]


def day_event(args):
    sym, day, prev = args
    D = _G[sym]
    d0 = pd.Timestamp(prev, tz="America/Chicago") + pd.Timedelta(hours=8, minutes=30)
    d1 = pd.Timestamp(day, tz="America/Chicago") + pd.Timedelta(hours=15)
    i0, i1 = np.searchsorted(D["t"], [d0.value // 1_000_000, d1.value // 1_000_000])
    if i1 - i0 < 300: return None
    if len(set(D["iid"][i0:i1].tolist())) > 1: return ("roll", sym, day)
    m1 = _bars(D, i0, i1)
    base = pd.Timestamp(day, tz="America/Chicago").value // 1_000_000
    tk = None
    for mn in range(511, 546):
        now = base + mn * MIN
        upto = [b for b in m1 if b["t"] + MIN <= now]
        tk = R.rule1_ticket(sym, upto, now)
        if tk: break
    if not tk: return None
    path = [b for b in m1 if b["t"] >= tk["at"]]
    # stop / 3R / 14:55 CT exit with exit time (stop checked first on a bar that has both)
    s = 1 if tk["side"] == "long" else -1; e, st, tg = tk["entry"], tk["stop"], tk["target"]
    ex_px, ex_t, ex = None, None, "time"
    for b in path:
        if R.ct_parts(b["t"])[0] >= 895: break
        lo, hi = (b["l"], b["h"]) if s > 0 else (-b["h"], -b["l"])
        if lo <= s * st: ex_px, ex_t, ex = st, b["t"] + MIN, "stop"; break
        if hi >= s * tg: ex_px, ex_t, ex = tg, b["t"] + MIN, "target"; break
        ex_px, ex_t = b["c"], b["t"] + MIN
    if ex_px is None: return None
    look = [b for b in m1 if b["t"] < tk["dispAt"]][-12 * 5:]
    b5 = [x for x in R.to5m(look)][-12:]
    atr5 = sum(x["h"] - x["l"] for x in b5) / max(1, len(b5))
    return dict(sym=sym, day=day, tk=tk, exit=ex, ex_px=ex_px, ex_t=ex_t, atr5=atr5, R=round(s * (ex_px - e) / tk["riskPts"], 4),
                tf=tf_context(D, tk["at"], s, m1))


def tf_context(D, T, s, m1):
    """Per timeframe: the last bar that CLOSED at or before T (label+tf <= T), its direction vs the side, and the proof."""
    out = {}
    for name, ms in TFS:
        if name == "30s":
            j = np.searchsorted(D["t30"], T - ms, side="right") - 1
            if j < 0 or D["t30"][j] + ms > T or T - D["t30"][j] > 3_600_000:
                out[name] = dict(ok=None, end=None); continue
            out[name] = dict(ok=bool(s * (D["c30"][j] - D["o30"][j]) > 0), end=int(D["t30"][j] + ms), T=T); continue
        if name == "1D":   # CT session 17:00 -> 16:00; the last closed session ends at 16:00 CT before T
            tc = pd.Timestamp(T, unit="ms", tz="UTC").tz_convert("America/Chicago")
            end = (tc.normalize() - pd.Timedelta(hours=8)).value // 1_000_000       # 16:00 CT the prior calendar day
            for _ in range(5):                                                       # walk back over weekends/holidays
                beg = end - 23 * 3_600_000
                i0, i1 = np.searchsorted(D["t"], [beg, end])
                if i1 - i0 > 60: break
                end -= 86_400_000
            if i1 <= i0: out[name] = dict(ok=None, end=None); continue
            out[name] = dict(ok=bool(s * (D["c"][i1 - 1] - D["o"][i0]) > 0), end=int(D["t"][i1 - 1] + MIN), T=T); continue
        lbl = (T // ms) * ms - ms                       # CT offsets are whole hours, so UTC-floored buckets align for <= 1h
        if name == "4h":                                 # 4h anchored at 17:00 CT (as the derived files)
            tc = pd.Timestamp(T, unit="ms", tz="UTC").tz_convert("America/Chicago")
            a = (tc.normalize() - pd.Timedelta(hours=7)).value // 1_000_000
            lbl = a + ((T - a) // ms) * ms - ms
        i0, i1 = np.searchsorted(D["t"], [lbl, lbl + ms])
        if i1 <= i0: out[name] = dict(ok=None, end=None); continue
        out[name] = dict(ok=bool(s * (D["c"][i1 - 1] - D["o"][i0]) > 0), end=int(D["t"][i1 - 1] + MIN), T=T)
    return out


_G = {}


def _init():
    for s in SYMS: _G[s] = load(s)


def events(cache=None, start="2019-01-02", end="2026-10-15"):
    if cache and os.path.exists(cache):
        return json.load(open(cache))
    _init()
    jobs = []
    for s in SYMS:
        days = sorted(set(pd.to_datetime(_G[s]["t"], unit="ms", utc=True).tz_convert("America/Chicago").strftime("%Y-%m-%d")))
        days = [d for d in days if start <= d <= end and pd.Timestamp(d).dayofweek < 5]
        jobs += [(s, d, p) for p, d in zip(days, days[1:])]
    with ProcessPoolExecutor(8, initializer=_init) as ex:
        res = list(ex.map(day_event, jobs, chunksize=16))
    ev = [r for r in res if isinstance(r, dict)]
    meta = dict(days=len(jobs), rolls=sum(1 for r in res if isinstance(r, tuple)), start=start, end=end)
    out = dict(meta=meta, events=ev)
    if cache: json.dump(out, open(cache, "w"))
    return out


def tf_table(ev):
    """Markdown proof: which timeframes were read, from what, and that every bar used closed at or before T."""
    L = ["| tf | source | events with a closed bar | bar end <= decision T (all) | max(bar end - T) s | agrees with side |", "|---|---|---|---|---|---|"]
    for name, _ in TFS:
        rows = [e["tf"][name] for e in ev if e["tf"][name]["end"] is not None]
        src = "Databento 30s file (2026-08-16 on)" if name == "30s" else ("1m -> CT session 17:00-16:00" if name == "1D" else ("1m -> 4h anchored 17:00 CT" if name == "4h" else ("Databento 1m" if name == "1m" else f"1m -> {name} left-label")))
        ok = all(r["end"] <= r["T"] for r in rows)
        mx = max(((r["end"] - r["T"]) / 1000 for r in rows), default=float("nan"))
        ag = sum(1 for r in rows if r["ok"]) / len(rows) if rows else float("nan")
        L.append(f"| {name} | {src} | {len(rows)} | {ok} | {mx:.0f} | {ag:.0%} |")
    return "\n".join(L)


def card_latency(cards_log=os.environ.get("CARDS_LOG", "/workspace/desk-watcher/cards.log")):
    """Read-only: from the watcher's cards.log, the FIRST card built in each 1m bar -> (build_s after the 1m close,
    watcher_recv_s after the build). Returns arrays; empty when the log is absent."""
    first = {}
    try:
        with open(cards_log, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    r = json.loads(line)
                except ValueError:
                    continue
                at = (r.get("card") or {}).get("at"); nm = r.get("now_ms")
                if not at or not isinstance(nm, (int, float)):
                    continue
                t = pd.Timestamp(at).value // 1_000_000
                m = t // 60_000
                if m not in first or t < first[m][0]:
                    first[m] = (t, nm)
    except OSError:
        pass
    b = np.array([(t - m * 60_000) / 1000 for m, (t, nm) in first.items()])
    w = np.array([(nm - t) / 1000 for m, (t, nm) in first.items()])
    return b, w


def r_at_delay(D, e, delay_s):
    """R of the event when the market entry happens delay_s after T (entry = 1m close at the first bar end >= T+delay,
    delay 0 = the displacement close). Stop / 3R target unchanged, R on the original risk; stop touched before the
    delayed entry = -1R. Closed bars only: the entry bar must have ended by the entry time."""
    tk = e["tk"]; s = 1 if tk["side"] == "long" else -1; risk = tk["riskPts"]; T = tk["at"]
    i = np.searchsorted(D["t"], T)
    if delay_s <= 0:
        entry = tk["entry"]; j = i
    else:
        k = int(math.ceil(delay_s / 60))
        j = i + k
        if j > len(D["t"]) or D["t"][j - 1] + MIN > T + k * MIN: return None
        for q in range(i, j):
            lo = D["l"][q] if s > 0 else -D["h"][q]
            if lo <= s * tk["stop"]: return -1.0
        entry = D["c"][j - 1]
    end = (pd.Timestamp(e["day"], tz="America/Chicago") + pd.Timedelta(hours=14, minutes=55)).value // 1_000_000
    last = entry
    for q in range(j, len(D["t"])):
        if D["t"][q] >= end: break
        lo, hi = (D["l"][q], D["h"][q]) if s > 0 else (-D["h"][q], -D["l"][q])
        if lo <= s * tk["stop"]: return s * (tk["stop"] - entry) / risk
        if hi >= s * tk["target"]: return s * (tk["target"] - entry) / risk
        last = D["c"][q]
    return s * (last - entry) / risk
