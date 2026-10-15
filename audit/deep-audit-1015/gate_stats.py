import json, collections, sys
c = collections.Counter(); p = collections.Counter(); n = 0
cond = collections.Counter()   # gate failing given everything else
for l in open("/workspace/desk-watcher/gates.log"):
    try: r = json.loads(l)
    except Exception: continue
    n += 1
    for g, ok, w in r.get("gates") or []:
        c[g] += 1
        if ok is True: p[g] += 1
rows = sorted(((g, p[g], c[g]) for g in c), key=lambda x: x[1] / x[2])
never = [x for x in rows if x[1] == 0]; always = [x for x in rows if x[1] == x[2]]
print(json.dumps({"rows": n, "never": never, "always_count": len(always), "always": always, "rare": [x for x in rows if 0 < x[1] / x[2] < 0.05]}, indent=0))
