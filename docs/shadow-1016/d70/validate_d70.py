"""Validation for the Rule 1 SHADOW d.7 0DTE ticket (overnight-1016 #1). Closed bars only, all timeframes 30s..1D.

Same Rule 1 events (scripts/rule1.py), two tickets per event, built by the desk's model (src/lib/trading/rule1-d70.ts,
mirrored below): 0DTE strike at |delta| 0.70 vs 0.50 (ATM), IV = 1.2 x 5m-range sigma, <= 4 contracts, debit <= $650,
a 1-lot over the cap = no trade. Exit when the futures exit (stop / 3R / 14:55 CT), repriced by Black-Scholes with the
remaining time; spread max($0.01, 2%) per side; $0.65/contract/side. Run: python3 validate_d70.py [events.json]
"""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tfcommon as C

CFG = json.load(open(os.path.join(C.ROOT, "shared", "rule1-d70.json")))
R1 = json.load(open(os.path.join(C.ROOT, "shared", "rule1.json")))["option"]


_RV = {}


def rv20(sym, day):
    """1.2 x 20-session realized vol from daily settlements strictly BEFORE `day` (closed), roll gaps dropped (the study's IV)."""
    if sym not in _RV:
        import pandas as pd
        d = pd.read_parquet(f"{C.DATA}/{sym}_1d.parquet"); d.index = d.index.strftime("%Y-%m-%d")
        r = np.log(d.close).diff(); r[d.instrument_id != d.instrument_id.shift()] = np.nan
        _RV[sym] = r
    r = _RV[sym]; x = r[r.index < day].dropna().iloc[-20:]
    return float(x.std(ddof=1) * math.sqrt(252)) if len(x) >= 10 else None


MODEL = os.environ.get("IV_MODEL", "desk")   # desk = 1.2 x 5m-range sigma (what the desk ships); rv20 = 1.2 x 20-day realized (the study)


def leg(delta, sym, side, px, atr5, min_ct, day=None):
    ratio = R1["ratio"][sym]; S = px * ratio
    tau = max(1, 900 - min_ct) / (252 * 390)
    sig = R1["ivOverRealized"] * (atr5 / (1.6 * px)) * math.sqrt(78 * 252)
    if MODEL == "rv20":
        rv = rv20(sym, day); sig = R1["ivOverRealized"] * rv if rv else sig
    z = C.R._ninv(delta); v = sig * math.sqrt(tau)
    K = round(S * math.exp(-z * v + 0.5 * v * v) if side == "long" else S * math.exp(z * v + 0.5 * v * v))
    return S, K, tau, sig, ratio


def price(side, S, K, tau, sig):
    c = C.R.bs_call(S, K, tau, sig)
    return c if side == "long" else c - S + K


def pnl(e, delta):
    tk = e["tk"]; side = tk["side"]; mn = C.R.ct_parts(tk["at"])[0]
    S, K, tau, sig, ratio = leg(delta, e["sym"], side, tk["entry"], e["atr5"], mn, e["day"])
    p0 = price(side, S, K, tau, sig)
    n = min(CFG["maxContracts"], int(CFG["debitCap"] // (p0 * 100))) if p0 > 0 else 0
    if n < 1: return None
    tau1 = max(0.0, (900 - C.R.ct_parts(e["ex_t"])[0])) / (252 * 390)
    p1 = price(side, e["ex_px"] * ratio, K, max(tau1, 1e-7), sig)
    buy = p0 + max(CFG["spreadMin"], CFG["spreadPct"] * p0); sell = max(0.0, p1 - max(CFG["spreadMin"], CFG["spreadPct"] * p1))
    return n * 100 * (sell - buy) - 2 * CFG["feePerContractSide"] * n


def main(cache):
    o = C.events(cache); ev = o["events"]
    weeks = (np.datetime64(o["meta"]["end"]) - np.datetime64(o["meta"]["start"])).astype(int) / 7
    test = [e for e in ev if e["day"] >= "2019-01-01"]
    res = {}
    for name, d in (("d.7 0DTE", CFG["delta"]), ("ATM 0DTE (d.5)", CFG["compareDelta"])):
        p = [(e, pnl(e, d)) for e in test]
        tr = [(e, x) for e, x in p if x is not None]
        res[name] = dict(tickets=len(test), traded=len(tr), cap_blocked=len(test) - len(tr), usd=sum(x for _, x in tr),
                         per_wk=sum(x for _, x in tr) / weeks, per_tr=np.mean([x for _, x in tr]) if tr else float("nan"),
                         ES=sum(x for e, x in tr if e["sym"] == "ES") / weeks, NQ=sum(x for e, x in tr if e["sym"] == "NQ") / weeks,
                         y2026=sum(x for e, x in tr if e["day"] >= "2026-01-01"), p=p)
    paired = [(a[1], b[1]) for a, b in zip(res["d.7 0DTE"]["p"], res["ATM 0DTE (d.5)"]["p"])]
    diff = [(a or 0) - (b or 0) for a, b in paired]
    t = np.mean(diff) / (np.std(diff, ddof=1) / math.sqrt(len(diff)))
    L = [f"# Validation: Rule 1 SHADOW d.7 0DTE ticket (overnight-1016 #1), IV model = {MODEL}", "",
         f"Events: {len(test)} Rule 1 tickets, ES+NQ, {o['meta']['start']} to {o['meta']['end']} ({weeks:.0f} weeks, {len(test)/weeks:.2f}/wk); {o['meta']['rolls']} roll-crossing sym-days skipped.",
         "Decision time T = ticket.at (the displacement 5m close). Every bar read closed at or before T (table below).", "",
         "| ticket | tickets | traded | cap-blocked | $/wk | $/trade | ES $/wk | NQ $/wk | 2026 $ total |", "|---|---|---|---|---|---|---|---|---|"]
    for k, r in res.items():
        L.append(f"| {k} | {r['tickets']} | {r['traded']} | {r['cap_blocked']} | {r['per_wk']:+.1f} | {r['per_tr']:+.1f} | {r['ES']:+.1f} | {r['NQ']:+.1f} | {r['y2026']:+.0f} |")
    L += ["", f"Paired d.7 - ATM per ticket: mean ${np.mean(diff):+.1f}, t = {t:.2f}, n = {len(diff)} (cap-blocked = $0).", "",
          "## Timeframes used (30s..1D, closed bars only, no lookahead)", "", C.tf_table(test), "",
          "## d.7 $/trade by closed-bar agreement on each timeframe (all read together at T)", "",
          "| tf | n agree | $/trade agree | n against | $/trade against |", "|---|---|---|---|---|"]
    p7 = res["d.7 0DTE"]["p"]
    for name, _ in C.TFS:
        a = [x for e, x in p7 if x is not None and e["tf"][name]["ok"] is True]; b = [x for e, x in p7 if x is not None and e["tf"][name]["ok"] is False]
        L.append(f"| {name} | {len(a)} | {np.mean(a) if a else float('nan'):+.1f} | {len(b)} | {np.mean(b) if b else float('nan'):+.1f} |")
    L += ["", "Conditions: Rule 1 = 08:30-09:00 CT key sweep (ON/PD high-low untouched 2h before) then 5m displacement body >= 1.5x mean 12-bar range;",
          "market at the 5m close; stop = 15-min 1m structure +/- 0.02x range; target 3R; exit 14:55 CT. 1m bars feed Rule 1 only once closed (t+60s <= now).",
          "Cost model note: the desk model uses IV = 1.2 x 5m-range sigma (cheaper than the study's 1.2 x 20-day realized), so absolute $ differ from the report; the ticket ordering is what this checks.",
          "The timeframe table is context and proof only: no timeframe filter is applied to the shadow ticket."]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    print(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.json")))
