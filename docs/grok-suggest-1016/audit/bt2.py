import sys, json, inspect, numpy as np, pandas as pd
sys.path.insert(0, "/workspace/bt13w"); import sim
from bt import review_and_trade, IS, OOS, HOLD
S = {s: pd.read_pickle(f"scan_{s}.pkl") for s in ("ES", "NQ")}
IDX = {s: {sd: np.sort(S[s][S[s].side == sd].i.values) for sd in (-1, 1)} for s in S}
def agree(sym, side, i, w=15):
    a = IDX[sym][side]; k = np.searchsorted(a, i - w); return k < len(a) and a[k] <= i
BUMP = 0.0; AGREE_ONLY = True
def bump_pts(sym, side, i):
    if BUMP <= 0 or not agree(sym, side, i): return 0
    return int(np.floor(BUMP / 0.05 + 1e-9))     # q proxy = 0.40 + 0.05 x points (bandEdges B+ 0.60 = 4 pts, A- 0.65 = 5 pts)
src = inspect.getsource(sim.run).replace("g_=gname(p,cap)", "g_=gname(p+bump_pts(sym,side,i),cap)")
ns = dict(vars(sim)); ns["bump_pts"] = bump_pts; exec(src, ns); run = ns["run"]
def st(t, p): return sim.stats(t, *p)
def row(name, t):
    return {"variant": name, **{k: st(t, p) for k, p in (("IS", IS), ("OOS", OOS), ("HOLD", HOLD))}}
from multiprocessing import Pool
BUMPS=(0.0,0.03,0.05,0.08,0.10,0.15,0.20,0.25,0.30,0.40,0.50,0.60)
def job(arg):
    fx,b=arg; globals()["BUMP"]=b
    t,_=run(list(fx)); return fx,b,t
if __name__=="__main__":
    out=[]
    with Pool(8) as P: R=P.map(job,[(fx,b) for fx in ((),(2,3,10)) for b in BUMPS])
    base={fx:t for fx,b,t in R if b==0.0}
    key=lambda d: set(zip(d.sym,d.day.astype(str),d.i)) if len(d) else set()
    for fx,b,t in R:
        r=row(f"{'desk' if not fx else 'desk+reanchor{2,3,10}'} bump +{b:.2f} (+{int(np.floor(b/0.05+1e-9))} pts)",t)
        bk=key(base[fx]); add=t[[k not in bk for k in zip(t.sym,t.day.astype(str),t.i)]] if len(t) else t
        r["added_vs_b0"]={k:st(add,p) for k,p in (("IS",IS),("OOS",OOS),("HOLD",HOLD))}; r["fx"]=list(fx); r["bump"]=b
        out.append(r)
    BUMP=0.0
    # scan cards carry their own card (all rules / per rule), and union with desk when desk is flat
    sc = {}
    for s in ("ES", "NQ"): sc[s] = review_and_trade(s, S[s])
    scan_all = pd.concat([sc[s] for s in sc]); scan_tr = scan_all[scan_all.trade == True]
    out.append(row("scan cards alone (all rules)", scan_tr))
    for k in ("mss", "gap", "lhl"):
        out.append(row(f"scan cards alone: {k}", scan_tr[scan_tr.kind == k]))
        for sd, nm in ((-1, "short"), (1, "long")): out.append(row(f"scan cards alone: {k} {nm}", scan_tr[(scan_tr.kind == k) & (scan_tr.side == sd)]))
    def union(desk_t):
        parts = [desk_t.assign(src="desk")]
        for s in ("ES", "NQ"):
            d = desk_t[desk_t.sym == s]; iv = list(zip(d.i, d.i + 120)) if len(d) else []
            busy = (lambda i, iv=iv: any(a <= i <= b for a, b in iv))
            parts.append(review_and_trade(s, S[s], busy_until=busy).query("trade == True").assign(src="scan"))
        return pd.concat(parts, ignore_index=True)
    out.append(row("desk + scan carries own card when desk flat", union(base[()])))
    json.dump(out, open("bt_results.json", "w"), indent=1, default=float)
    print("done")
