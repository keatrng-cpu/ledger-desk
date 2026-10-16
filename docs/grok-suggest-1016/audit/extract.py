import json, re, bisect, sys
rows = json.load(open("/tmp/replay.json"))["rows"]
from datetime import datetime, timezone
def ms(day, at):
    y,m,d = map(int, day.split("-")); return int(datetime(y,m,d,5,tzinfo=timezone.utc).timestamp()*1000) + at*60000
targets = sorted({ms(r["day"], r["at"]) + 3000 for r in rows})
want = {}  # target -> best (dt, rec)
rx = re.compile(r'"now_ms": (\d+)')
with open("/workspace/desk-watcher/cards.log", "rb") as f:
    for line in f:
        m = rx.search(line[:120].decode("utf-8","replace"))
        if not m: continue
        t = int(m.group(1)); i = bisect.bisect_left(targets, t - 120000)
        hit = [x for x in targets[i:i+3] if 0 <= t - x <= 120000]
        if not hit: continue
        for x in hit:
            if x not in want:
                try: d = json.loads(line)
                except Exception: continue
                c = d.get("card") or {}
                want[x] = {"dt_s": round((t-x)/1000,1), "scanner": c.get("scanner"), "brain": c.get("brain"), "floor": c.get("floor"), "skips": (d.get("dayst") or {}).get("skips", [])[-3:]}
json.dump({str(k): v for k, v in want.items()}, open("snap.json", "w"))
print("targets", len(targets), "found", len(want))
