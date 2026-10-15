#!/usr/bin/env python3
"""Rule 1 SHADOW ticket: Python mirror of src/lib/trading/rule1.ts + shadow ledger + daily report (stdlib only).

Never places orders. Config: shared/rule1.json (outside desk-rules.json, so the rules hash is unchanged).

  python3 scripts/rule1.py replay --bars bars.json --day 2026-10-13 [--cards polls.jsonl] [--ledger rule1_ledger.jsonl] [--out report.md]

bars.json: {"ES": [{"t": ms, "o":..,"h":..,"l":..,"c":..}, ...], "MNQ": [...]} (1m, epoch ms, the desk's own format).
cards (optional): desk card snapshots as JSONL with ts (s), sym, side, entry, stop, t1, t2; the first card per symbol/side
after 08:30 CT is the desk plan compared against Rule 1.
"""
import json, math, sys, pathlib, datetime as dt
from zoneinfo import ZoneInfo

ROOT = pathlib.Path(__file__).resolve().parents[1]
CFG = json.load(open(ROOT / "shared" / "rule1.json"))
CT = ZoneInfo("America/Chicago")
MIN = 60_000


def ct_parts(ms):
    d = dt.datetime.fromtimestamp(ms / 1000, CT)
    return d.hour * 60 + d.minute, d.strftime("%Y-%m-%d")


def to5m(m1):
    out = []
    for b in m1:
        t = (b["t"] // (5 * MIN)) * 5 * MIN
        if out and out[-1]["t"] == t:
            o = out[-1]; o["h"] = max(o["h"], b["h"]); o["l"] = min(o["l"], b["l"]); o["c"] = b["c"]
        else:
            out.append(dict(t=t, o=b["o"], h=b["h"], l=b["l"], c=b["c"]))
    return out


def key_levels(m1, day):
    days = sorted({ct_parts(b["t"])[1] for b in m1})
    pday = days[days.index(day) - 1] if day in days and days.index(day) > 0 else None
    on, pd = [], []
    for b in m1:
        mn, d = ct_parts(b["t"])
        if (d == day and mn < 510) or (d == pday and mn >= 1020): on.append(b)
        if d == pday and 510 <= mn < 900: pd.append(b)
    f = lambda xs, k, fn: fn(x[k] for x in xs) if xs else None
    return dict(onh=f(on, "h", max), onl=f(on, "l", min), pdh=f(pd, "h", max), pdl=f(pd, "l", min))


def _ncdf(x): return 0.5 * (1 + math.erf(x / math.sqrt(2)))


def _ninv(p):
    lo, hi = -8.0, 8.0
    for _ in range(80):
        m = (lo + hi) / 2
        lo, hi = (m, hi) if _ncdf(m) < p else (lo, m)
    return (lo + hi) / 2


def bs_call(S, K, tau, sig):
    v = sig * math.sqrt(max(tau, 1e-7)); d1 = (math.log(S / K) + 0.5 * v * v) / v
    return S * _ncdf(d1) - K * _ncdf(d1 - v)


def pick_option(symbol, side, px, atr5, min_ct, under_px=None):
    o = CFG["option"]; root = "".join(ch for ch in symbol if ch.isalpha())
    ratio = o["ratio"].get(root); und = o["underlier"].get(root)
    if not ratio or not und: return None
    S = under_px or px * ratio
    dte = 0 if min_ct < 810 else 1
    tau = ((900 - min_ct) + dte * 390) / (252 * 390)
    sig = o["ivOverRealized"] * (atr5 / (1.6 * px)) * math.sqrt(78 * 252)
    z = _ninv(o["delta"]); v = sig * math.sqrt(tau)
    K = S * math.exp(-z * v + 0.5 * v * v) if side == "long" else S * math.exp(z * v + 0.5 * v * v)
    strike = round(K)
    prem = bs_call(S, strike, tau, sig) if side == "long" else bs_call(S, strike, tau, sig) - S + strike
    n = max(1, min(o["maxContracts"], int(o["debitCap"] // (prem * 100)))) if prem > 0 else 1
    return dict(underlier=und, right="call" if side == "long" else "put", delta=o["delta"], strike=strike, premium=round(prem, 2), contracts=n, dte=dte)


def rule1_ticket(symbol, m1, now_ms, under_px=None):
    closed1 = [b for b in m1 if b["t"] + MIN <= now_ms]
    if not closed1: return None
    day = ct_parts(now_ms)[1]
    lv = key_levels(closed1, day)
    b5 = [b for b in to5m(closed1) if b["t"] + 5 * MIN <= now_ms]
    A, LB, CL = CFG["atrBars5"], CFG["sweepLookbackBars5"], CFG["sweepCleanBars5"]
    for k in range(CL + LB, len(b5)):
        b = b5[k]; mn, d = ct_parts(b["t"])
        if d != day or not (CFG["window"]["fromMin"] <= mn < CFG["window"]["toMin"]): continue
        rng = sum(x["h"] - x["l"] for x in b5[k - A:k]) / A
        if not rng > 0: continue
        body = b["c"] - b["o"]
        if abs(body) < CFG["dispBodyAtr"] * rng: continue
        side = "long" if body > 0 else "short"
        win, pre = b5[k - LB:k + 1], b5[k - LB - CL:k - LB]
        cands = [("ONL", lv["onl"]), ("PDL", lv["pdl"])] if side == "long" else [("ONH", lv["onh"]), ("PDH", lv["pdh"])]
        hit = None
        for nm, L in cands:
            if L is None: continue
            if side == "long" and min(x["l"] for x in win) < L and min(x["l"] for x in pre) >= L: hit = (nm, L); break
            if side == "short" and max(x["h"] for x in win) > L and max(x["h"] for x in pre) <= L: hit = (nm, L); break
        if not hit: continue
        entry = b["c"]; at = b["t"] + 5 * MIN
        look = [x for x in closed1 if at - CFG["stopLookbackMin"] * MIN <= x["t"] < at]
        if not look: continue
        stop = (min(x["l"] for x in look) - CFG["stopBufferAtr"] * rng) if side == "long" else (max(x["h"] for x in look) + CFG["stopBufferAtr"] * rng)
        risk = entry - stop if side == "long" else stop - entry
        if not risk > 0.05 * rng: continue
        s = 1 if side == "long" else -1
        on = lv["onh"] if side == "long" else lv["onl"]
        runner = on if on is not None and s * (on - entry) >= CFG["runnerMinR"] * risk else None
        r2 = lambda x: round(x * 100) / 100
        return dict(mode="shadow", version=CFG["version"], symbol=symbol, side=side, at=at, dispAt=b["t"], swept=hit[0], level=hit[1],
                    bodyAtr=round(abs(body) / rng, 2), bonus=abs(body) >= CFG["bonusBodyAtr"] * rng, entry=r2(entry), stop=r2(stop),
                    riskPts=r2(risk), target=r2(entry + s * CFG["targetR"] * risk), runner=runner,
                    runnerR=round(s * (runner - entry) / risk, 2) if runner is not None else None,
                    option=pick_option(symbol, side, entry, rng, ct_parts(at)[0], under_px))
    return None


def outcome(tk, m1, end_min=895):
    """Market fill at `at`; stop vs 3R target (and runner level) on later 1m bars; else exit at 14:55 CT. R on initial risk."""
    s = 1 if tk["side"] == "long" else -1; e, st, risk = tk["entry"], tk["stop"], tk["riskPts"]
    day = ct_parts(tk["at"])[1]
    path = [b for b in m1 if b["t"] >= tk["at"] and ct_parts(b["t"])[1] == day and ct_parts(b["t"])[0] < end_min]
    if not path: return dict(R=None, exit="nodata", R_runner=None)
    def run(tgt):
        for b in path:
            lo, hi = (b["l"], b["h"]) if s > 0 else (-b["h"], -b["l"])
            if lo <= s * st: return -1.0, "stop"
            if tgt is not None and hi >= s * tgt: return round(s * (tgt - e) / risk, 3), "target"
        return round(s * (path[-1]["c"] - e) / risk, 3), "time" if ct_parts(path[-1]["t"])[0] >= end_min - 1 else "open"
    R, ex = run(tk["target"])
    Rr, exr = run(tk["runner"]) if tk.get("runner") is not None else (None, None)
    return dict(R=R, exit=ex, R_runner=Rr, exit_runner=exr)


def desk_plan_R(card, m1, fill_win=30, end_min=895):
    """Desk plan: limit at entry within 30 min, stop, 50% at T1 → BE → T2 (else 2R)."""
    s = 1 if card["side"] == "long" else -1; e, st = s * card["entry"], s * card["stop"]; risk = e - st
    if not risk > 0: return None
    t0 = int(card["ts"] * 1000); day = ct_parts(t0)[1]
    path = [b for b in m1 if b["t"] >= t0 and ct_parts(b["t"])[1] == day and ct_parts(b["t"])[0] < end_min]
    P = [((b["h"], b["l"]) if s > 0 else (-b["l"], -b["h"])) + (s * b["c"],) for b in path]
    f = next((i for i, p in enumerate(P[:fill_win]) if p[1] <= e), None)
    if f is None: return dict(R=None, status="nofill")
    t1 = s * card["t1"] if card.get("t1") else e + risk; t2 = s * card["t2"] if card.get("t2") else e + 2 * risk
    half = None
    for i, (hi, lo, c) in enumerate(P[f:]):
        if half is None:
            if lo <= st: return dict(R=-1.0, status="stop")
            if i > 0 and hi >= t1: half = (t1 - e) / risk
        else:
            if hi >= t2: return dict(R=round(0.5 * half + 0.5 * (t2 - e) / risk, 3), status="t2")
            if lo <= e: return dict(R=round(0.5 * half, 3), status="be")
    c = P[-1][2]
    return dict(R=round((0.5 * half + 0.5 * (c - e) / risk) if half is not None else (c - e) / risk, 3), status="time")


def replay(bars, day, cards=None):
    rows = []
    for sym, m1 in bars.items():
        m1 = sorted(m1, key=lambda b: b["t"])
        dayb = [b for b in m1 if ct_parts(b["t"])[1] == day]
        if not dayb: continue
        tk = None
        for b in dayb:  # walk the session like the live desk does (each closed minute)
            mn = ct_parts(b["t"])[0]
            if mn < 510 or mn > 545: continue
            tk = rule1_ticket(sym, m1, b["t"] + MIN)
            if tk: break
        if not tk: rows.append(dict(day=day, symbol=sym, fired=False)); continue
        out = outcome(tk, m1)
        desk = None
        for c in sorted(cards or [], key=lambda c: c["ts"]):
            cs = c.get("sym", "")
            if (cs == sym or cs.lstrip("M") == sym.lstrip("M")) and c.get("side") == tk["side"] and ct_parts(int(c["ts"] * 1000))[1] == day and ct_parts(int(c["ts"] * 1000))[0] >= 510 and c.get("entry") and c.get("stop"):
                desk = dict(entry=c["entry"], stop=c["stop"], t1=c.get("t1"), t2=c.get("t2"), **(desk_plan_R(c, m1) or {})); break
        rows.append(dict(day=day, symbol=sym, fired=True, ticket=tk, **out, desk=desk))
    return rows


def report(rows, day):
    L = [f"# Rule 1 shadow vs desk plan, {day} (CT)", "", "Shadow only. No orders. R on initial risk; desk plan = limit at card entry ≤30 min, 50% at T1 → BE → T2.", "",
         "| symbol | fired | side | swept | entry | stop | 3R target | runner | option | Rule 1 R | runner R | desk plan R |", "|---|---|---|---|---|---|---|---|---|---|---|---|"]
    tot1 = totd = 0.0
    for r in rows:
        if not r["fired"]:
            L.append(f"| {r['symbol']} | no | | | | | | | | | | |"); continue
        t = r["ticket"]; o = t.get("option") or {}
        tm = dt.datetime.fromtimestamp(t["at"] / 1000, CT).strftime("%H:%M")
        opt = f"{o.get('contracts')}× {o.get('underlier')} {o.get('strike')}{(o.get('right') or ' ')[0].upper()} δ{o.get('delta')} {o.get('dte')}DTE ~${o.get('premium')}" if o else "—"
        d = r.get("desk") or {}
        L.append(f"| {r['symbol']} | {tm}{' ★bonus' if t['bonus'] else ''} | {t['side']} | {t['swept']} {t['level']} | {t['entry']} | {t['stop']} | {t['target']} | {t['runner'] if t['runner'] is not None else '—'} | {opt} | {r['R']} ({r['exit']}) | {r.get('R_runner')} | {d.get('R')} ({d.get('status', 'no card')}) |")
        tot1 += r["R"] or 0; totd += d.get("R") or 0
    L += ["", f"**Total:** Rule 1 {round(tot1, 3)}R vs desk plan {round(totd, 3)}R."]
    return "\n".join(L) + "\n"


def main(a):
    if not a or a[0] != "replay":
        print(__doc__); return 2
    g = lambda k, d=None: a[a.index(k) + 1] if k in a else d
    bars = json.load(open(g("--bars"))); day = g("--day")
    cards = [json.loads(l) for l in open(g("--cards"))] if g("--cards") else None
    rows = replay(bars, day, cards)
    if g("--ledger"):
        with open(g("--ledger"), "a") as f:
            for r in rows: f.write(json.dumps(r) + "\n")
    md = report(rows, day)
    if g("--out"): pathlib.Path(g("--out")).write_text(md)
    print(md); return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
