"""16-year backtest of the missed-setup scan rules (the stand-in for Grok in the 10/12–16 replay) and the score-influence
variants. Mechanical, closed bars, no lookahead. Reuses /workspace/bt13w cached ES/NQ 1m (2010-07 → 2026-10-16 10:07 CT)
and its desk-candidate proxy (sim.py) for the desk baseline. Research only."""
import sys, json, pickle, numpy as np, pandas as pd
sys.path.insert(0, "/workspace/bt13w"); import sim
COST = sim.COST
IS = ("2010-07-01", "2019-01-01"); OOS = ("2019-01-01", "2026-10-10"); HOLD = ("2026-10-12", "2026-10-17")

def bars(D, mins):
    T = pd.to_datetime(D["T"]); k = (T.view("int64") // (mins * 60_000_000_000))
    df = pd.DataFrame({"k": k, "o": D["o"], "h": D["h"], "l": D["l"], "c": D["cl"], "i": np.arange(len(T))})
    g = df.groupby("k", sort=True).agg(o=("o", "first"), h=("h", "max"), l=("l", "min"), c=("c", "last"), i0=("i", "first"), i1=("i", "last"))
    return g.reset_index()

def scan(sym):
    D = sim.L(sym); tod, day = D["tod"], D["day"]
    b5 = bars(D, 5); b15 = bars(D, 15)
    rng5 = (b5.h - b5.l).values; atr5 = pd.Series(rng5).rolling(14).mean().shift(1).values
    rng15 = (b15.h - b15.l).values; atr15 = pd.Series(rng15).rolling(14).mean().values
    o, h, l, c, i1 = b5.o.values, b5.h.values, b5.l.values, b5.c.values, b5.i1.values
    k15_end = b15.i1.values; h15, l15, c15 = b15.h.values, b15.l.values, b15.c.values
    sigs = []; gaps = []; j15 = 0; n15 = len(b15)
    for x in range(14, len(b5)):
        ie = i1[x]
        # 15m bars closed by this 5m close
        while j15 < n15 and k15_end[j15] <= ie:
            if j15 >= 2:
                if l15[j15 - 2] > h15[j15]: gaps.append([-1, h15[j15], l15[j15 - 2], j15])
                if h15[j15 - 2] < l15[j15]: gaps.append([1, h15[j15 - 2], l15[j15], j15])
            # mitigation by a 15m close through
            gaps = [g for g in gaps if not ((g[0] < 0 and c15[j15] > g[2]) or (g[0] > 0 and c15[j15] < g[1])) and j15 - g[3] < 120][-6:]
            j15 += 1
        t = tod[ie]
        if t < 509 or t > 889: continue          # 5m bars closing 08:30..14:50 CT
        a5 = atr5[x]; a15 = atr15[j15 - 1] if j15 else np.nan
        if not (a5 > 0) or not (a15 > 0): continue
        dy = day[ie]; body = c[x] - o[x]
        lo6 = l[x - 6:x].min(); hi6 = h[x - 6:x].max()
        if -body >= 1.2 * a5 and c[x] < lo6: sigs.append((ie, -1, "mss", hi6))
        if body >= 1.2 * a5 and c[x] > hi6: sigs.append((ie, 1, "mss", lo6))
        tol = max(0.15 * a15, 0.5 * a5)
        for g in gaps:
            if g[3] >= j15 - 1 and False: continue
            if g[0] < 0 and h[x] >= g[1] - tol and c[x] < h[x] - 0.4 * (h[x] - l[x]) and c[x] < g[2]: sigs.append((ie, -1, "gap", g[1]))
            if g[0] > 0 and l[x] <= g[2] + tol and c[x] > l[x] + 0.4 * (h[x] - l[x]) and c[x] > g[1]: sigs.append((ie, 1, "gap", g[2]))
        pH = h[x - 4:x].max(); pL = l[x - 4:x].min(); po, pc = o[x - 1], c[x - 1]
        if po - pc >= 1.2 * a5 and h[x] > pc and h[x] < pH and h[x] < po - 0.5 * (po - pc): sigs.append((ie, -1, "lhl", h[x]))
        if pc - po >= 1.2 * a5 and l[x] < pc and l[x] > pL and l[x] > po + 0.5 * (pc - po): sigs.append((ie, 1, "lhl", l[x]))
    S = pd.DataFrame(sigs, columns=["i", "side", "kind", "level"])
    # attach review inputs (entry = close of the signal bar; stop/T1 from structure, same as reviewSuggestion)
    a15_at = np.interp(S.i.values, k15_end, pd.Series(atr15).bfill().values)
    S["a15"] = a15_at; S["day"] = day[S.i.values]; S["tod"] = tod[S.i.values]
    return S

def review_and_trade(sym, S, busy_until=None, keep=None):
    """reviewSuggestion clone + outcome. keep(row)->bool filters which suggestions may trade."""
    D = sim.L(sym); h, l, c, tod, day = D["h"], D["l"], D["cl"], D["tod"], D["day"]; n = len(c)
    tick = 0.25; out = []; spent = set(); busy = -1
    for r in S.itertuples():
        key = (r.day, r.side, r.kind, round(r.level, 2))
        if key in spent: continue
        spent.add(key)
        i = r.i; e = c[i]; side = r.side
        stop = r.level + tick if side < 0 else r.level - tick
        if side < 0: stop = max(stop, e + tick)
        else: stop = min(stop, e - tick)
        if abs(stop - e) < 0.5 * r.a15: stop = e - side * 0.5 * r.a15
        risk = abs(stop - e)
        hr = slice(max(0, i - 59), i + 1)
        pool = l[hr].min() if side < 0 else h[hr].max()
        t1 = pool if (side < 0 and pool < e - 0.5 * risk) or (side > 0 and pool > e + 0.5 * risk) else e + side * 1.5 * risk
        rr = abs(t1 - e) / risk if risk > 0 else 0
        rec = dict(sym=sym, day=r.day, i=i, tod=r.tod, side=side, kind=r.kind, e=e, s=stop, t1=t1, rr=rr)
        if rr < 1.0: rec.update(trade=False, why="rr"); out.append(rec); continue
        if keep is not None and not keep(rec): rec.update(trade=False, why="filter"); out.append(rec); continue
        if i <= busy or (busy_until is not None and busy_until(i)): rec.update(trade=False, why="busy"); out.append(rec); continue
        cr = COST[sym] / risk; R = None; k = i + 1
        while k < n:
            if (side < 0 and h[k] >= stop) or (side > 0 and l[k] <= stop): R = -1 - cr; break
            if (side < 0 and l[k] <= t1) or (side > 0 and h[k] >= t1): R = rr - cr; break
            if tod[k] >= 895 or day[k] != day[i]: R = (c[k] - e) * side / risk - cr; break
            k += 1
        if R is None: R = (c[n - 1] - e) * side / risk - cr
        busy = k; rec.update(trade=True, R=R, exit_i=k); out.append(rec)
    return pd.DataFrame(out)

def stats(t, p):
    return sim.stats(t, *p)

if __name__ == "__main__":
    res = {}
    allS = {}
    for sym in ("ES", "NQ"):
        S = scan(sym); allS[sym] = S; S.to_pickle(f"scan_{sym}.pkl"); print(sym, "signals", len(S), flush=True)
    json.dump({"n": {k: len(v) for k, v in allS.items()}}, open("scan_counts.json", "w"))
