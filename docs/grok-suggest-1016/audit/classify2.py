import json, collections
from datetime import datetime, timezone, timedelta
rows = json.load(open("/tmp/replay.json"))["rows"]; snap = json.load(open("snap2.json"))
def ms(day, at):
    y,m,d = map(int, day.split("-")); return int(datetime(y,m,d,5,tzinfo=timezone.utc).timestamp()*1000) + at*60000
ct = lambda s: (datetime.fromtimestamp(s, timezone.utc) - timedelta(hours=5)).strftime("%m/%d %H:%M:%S CT")
OK = ["A+","A","A-","B+"]
out = []
for r in rows:
    s = snap.get(str(ms(r["day"], r["at"]) + 3000)) or {}
    ev = {"cards_row": ct(s["row_ts"]) if s.get("row_ts") else None}
    g = s.get("gate_row")
    ev["gates_row"] = f"{ct(g[0])} {g[1]} band {g[2]} q {g[3]} failing {','.join(g[4][:6])}" if g else None
    if not s.get("scanner") and not s.get("row_ts"):
        cause = "UNPROVEN: no cards.log row at this moment"
    else:
        sc = [x for x in (s.get("scanner") or []) if x.get("symbol") == r["sym"] and x.get("side") == r["side"]]
        br = s.get("brain") or {}
        ev["brain"] = f"{br.get('word')} {br.get('symbol')} {br.get('side')} missing '{br.get('missing')}'"
        if not sc:
            cause = "PROVEN: no desk card on that symbol/side in cards.log scanner[]"
        else:
            c = sc[0]; caps = c.get("capReasons") or []
            ev["card"] = f"{c.get('strategy')} entry {c.get('entry')} band {c.get('pathBand')} q {c.get('q')} q_scan {c.get('q_scan')} actionable {c.get('actionable')}"
            ev["caps"] = [f"[{x.get('stage')}] {x.get('why')}" for x in caps]
            W = " ".join(ev["caps"])
            if c.get("actionable") and c.get("pathBand") in OK: cause = "PROVEN: desk HAD an actionable B+ card (scan not a miss)"
            elif "Played out" in W or "invalidated" in W.lower(): cause = "PROVEN: card sealed C — played out/invalidated on its OLD entry (capReasons)"
            elif "chase" in W.lower(): cause = "PROVEN: chase cap — entry anchored past (capReasons)"
            elif "[ltfArm cap]" in W or "LTF" in W: cause = "PROVEN: LTF arm/reversal cap (capReasons)"
            elif not caps and c.get("pathBand") not in OK: cause = f"PROVEN: graded {c.get('pathBand')} by base score, q {c.get('q')} < 0.60, no cap rows"
            elif c.get("pathBand") in OK: cause = "PROVEN: B+ but actionable=false (brain/floor in row)"
            else: cause = "UNPROVEN: row present, cause not explicit"
    out.append({**{k: r[k] for k in ("day","sym","at","side","kind","entry","rr1","fireB","r")}, "cause": cause, "evidence": ev})
json.dump(out, open("diff_evidence.json","w"), indent=1)
norm = lambda c: c.split(", q")[0] if c.startswith("PROVEN: graded") else c
for title, sel in (("all 122", out), ("upper-bound 41", [o for o in out if o["fireB"]])):
    print("\n##", title)
    for k, v in collections.Counter(norm(o["cause"]) for o in sel).most_common(): print(f"{v:4d}  {k}")
cov = [o for o in out if "brain" in o["evidence"]]
print("\nbrain words in rows:", collections.Counter(o["evidence"]["brain"].split(" missing ")[0].split()[0] for o in cov), collections.Counter(o["evidence"]["brain"].split("missing ")[1] for o in cov).most_common(4))
