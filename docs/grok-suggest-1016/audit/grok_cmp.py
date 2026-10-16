import json, sys, collections
sys.path.insert(0, ".")
rows = json.load(open("/tmp/replay.json"))["rows"]
G = [json.loads(l) for l in open("grok_real.jsonl")]
ALL = json.load(open("/workspace/ld-grokreader/tests/fixtures/bars-1m-2026-10-12_16.json"))
from datetime import datetime, timezone
def ms(day, at): y,m,d = map(int, day.split("-")); return int(datetime(y,m,d,5,tzinfo=timezone.utc).timestamp()*1000) + at*60000
def outcome(sym, side, e, s, t1, frm, end):
    risk = abs(e - s)
    for b in ALL[sym]:
        if b["t"] < frm or b["t"] > end: continue
        if (b["h"] >= s) if side == "short" else (b["l"] <= s): return -1.0
        if (b["l"] <= t1) if side == "short" else (b["h"] >= t1): return abs(t1 - e) / risk
    last = [b for b in ALL[sym] if b["t"] <= end][-1]
    return ((e - last["c"]) if side == "short" else (last["c"] - e)) / risk
st = collections.Counter(g["status"] for g in G)
ok = [g for g in G if g["status"] == "ok"]
agree = [g for g in ok if g["suggestion"] and g["suggestion"]["side"] == g["scanSide"]]
opp = [g for g in ok if g["suggestion"] and g["suggestion"]["side"] != g["scanSide"]]
null = [g for g in ok if not g["suggestion"]]
f = lambda xs, k="scanR": f"n {len(xs)} W {sum(x[k]>0 for x in xs)} L {sum(x[k]<=0 for x in xs)} netR {sum(x[k] for x in xs):+.2f}"
res = {"status": dict(st), "cost": round(sum(g.get("cost") or 0 for g in G), 4), "ms_p50": sorted(g["ms"] for g in ok)[len(ok)//2] if ok else None, "ms_max": max((g["ms"] for g in ok), default=None)}
print(res)
print("scan R where Grok AGREES:", f(agree)); print("scan R where Grok says NULL (filters):", f(null)); print("Grok opposite side:", len(opp))
print("upper-bound 41 subset — Grok agrees:", f([g for g in agree if g["fireB"]]), "| Grok null:", f([g for g in null if g["fireB"]]))
# Grok's own levels outcome
gr = []
for g in agree + opp:
    s = g["suggestion"]; now = ms(g["day"], g["at"]) + 3000; end = ms(g["day"], 900)
    try: g["grokR"] = round(outcome(g["sym"], s["side"], s["entry"], s["stop"], s["t1"], now, end), 2); gr.append(g)
    except Exception: pass
print("Grok's own levels:", f(gr, "grokR"))
lev = [abs(g["suggestion"]["entry"] - rows[g["idx"]]["entry"]) for g in agree]
print("entry |Grok-scan| median", sorted(lev)[len(lev)//2] if lev else None)
for k in ("mss","htfGapTap","lowerHigh","higherLow"):
    print(k, "agree", f([g for g in agree if g["kind"]==k]), "null", f([g for g in null if g["kind"]==k]))
json.dump({"summary": res, "rows": G}, open("grok_cmp.json","w"), indent=1)
