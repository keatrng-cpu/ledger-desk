# keep the exact cards.log row ts + nearest gates.log row (<=60s after) per suggestion moment
import json, re, bisect
from datetime import datetime, timezone
rows = json.load(open("/tmp/replay.json"))["rows"]
def ms(day, at):
    y,m,d = map(int, day.split("-")); return int(datetime(y,m,d,5,tzinfo=timezone.utc).timestamp()*1000) + at*60000
T = sorted({ms(r["day"], r["at"]) + 3000 for r in rows})
snap = json.load(open("snap.json"))
rx = re.compile(r'"now_ms": (\d+)')
for line in open("/workspace/desk-watcher/cards.log", "rb"):
    m = rx.search(line[:120].decode("utf-8","replace"))
    if not m: continue
    t = int(m.group(1)); i = bisect.bisect_left(T, t - 120000)
    for x in T[i:i+3]:
        s = snap.get(str(x))
        if s and 0 <= t - x <= 120000 and "row_ts" not in s:
            s["row_ts"] = json.loads(line)["ts"]
G = []
for line in open("/workspace/desk-watcher/gates.log"):
    try: d = json.loads(line)
    except Exception: continue
    G.append((d["ts"], d.get("signal"), d.get("band"), d.get("q"), [g[0] for g in d.get("gates", []) if g[1] is False]))
G.sort(); gt = [g[0] for g in G]
for x in T:
    k = bisect.bisect_left(gt, x / 1000); g = G[k] if k < len(G) and G[k][0] - x / 1000 <= 60 else None
    snap.setdefault(str(x), None)
    if snap[str(x)] is not None: snap[str(x)]["gate_row"] = g
    else: snap[str(x)] = {"gate_row": g, "scanner": None, "nolog": True}
json.dump(snap, open("snap2.json", "w"))
print("ok", sum(1 for v in snap.values() if v and v.get("gate_row")))
