"""Strictness replay on the SHIPPED fast-chain code (review: no hand copies). Imports the watcher's fastchain from
WATCHER_DIR (patched copy) and reads every threshold from its desk-rules.json: setup_rows (band/plan/entry/agree/geometry,
target ladder), streak_next (20s hold, dip tolerance, invalidation), fast_rows (persist + soft velocity), velocity_cut.
Mode is forced to 'live' in-process only to evaluate what the chain would do (the shipped rules say shadow).
Not modelled (no data in polls.jsonl): brain side, desk Floor ticket, RH quote/sizing gates, news, plan pin.
Fill: sim.trade market at the next 1m bar open; R:R from the fill is checked with the same gate target on the fill price.
0DTE ATM, $300 debit ($150 when the soft-velocity one-step cut applies). One trade per symbol per 30 min, max 3/day."""
import json, os, sys, datetime as D, collections
sys.path.insert(0, os.environ.get("WATCHER_DIR", "/workspace/dw-unblock2"))
from watcher import fastchain as fc
import sim
fc.FC["mode"] = "live"
def snap(p):
    return {"ok": True, "at": str(p["ts"]), "band": None, "q": p["q"], "symbol": p["sym"], "side": p["side"], "entry": p["entry"],
            "stop_px": p["stop"], "first_target": p["t1"], "t2": p.get("t2"), "tape_prices": {p["sym"]: p["px"]}, "atr": p["atr"],
            "htf_bias": [("1h", p["b1"]), ("4h", p["b4"])], "loss": {"velocity": {"expMin": p.get("velmin")}} if p.get("velmin") is not None else None}
from watcher import gates
def band_of(q): return gates.q_band(q)
P = [json.loads(l) for l in open("polls.jsonl")]
st = None; fires = []; last = {}; day = collections.Counter(); seen = 0
for p in P:
    t = p["ts"]; d = D.datetime.fromtimestamp(t)
    if not (D.time(8, 30) <= d.time() <= D.time(14, 30)) or p["entry"] is None: continue
    s = snap(p); s["band"] = band_of(p["q"]); nm = int(t * 1000)
    st = fc.streak_next(st, s, nm); s["fast_streak"] = st
    rows = fc.fast_rows(s, nm)
    if not all(ok for _, ok, _ in rows): continue
    tgt, which, _ = fc.gate_target(s); px = p["px"]
    if which == "t1": tgt = p["t1"]
    if p["sym"] in last and t - last[p["sym"]] < 1800 or day[d.date()] >= 3: continue
    budget = 150 if fc.velocity_cut(s) else 300
    r = sim.trade(p["sym"], p["side"], t, px, p["stop"], p["t1"], p.get("t2"), dte=0, budget=budget, tag=d.strftime("%m/%d %H:%M:%S") + f" gate={which}")
    if not r or "skip" in r: continue
    e = r["entry"]; rr_fill = ((e - tgt) if p["side"] == "short" else (tgt - e)) / abs(e - p["stop"]) if e != p["stop"] else -1
    if rr_fill < fc.FC["rrMin"]: print("refused at fill (R:R from fill %.2f): %s" % (rr_fill, r["tag"])); continue
    r["budget"] = budget; fires.append(r); last[p["sym"]] = t; day[d.date()] += 1; st = None
for r in fires: print(r)
print("n", len(fires), "win", sum(r["pnl"] > 0 for r in fires), "0DTE $", sum(r["pnl"] for r in fires), "R", round(sum(r["R"] for r in fires), 2))
