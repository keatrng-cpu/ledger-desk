import json, collections, re
why = collections.Counter(); n = 0; hi = 0; verd = collections.Counter(); ph = collections.Counter(); ok_none=collections.Counter()
for l in open("/workspace/desk-watcher/cards.log"):
    try: r = json.loads(l)
    except Exception: continue
    card = r.get("card") or {}; w = card.get("wire") or {}; s = w.get("strategy") or {}
    if not s: continue
    n += 1; verd[(w.get("floor") or {}).get("verdict")] += 1; ph[(w.get("execution") or {}).get("phase")] += 1
    if s.get("band") in ("A+", "A", "A-", "B+"):
        hi += 1
        g = s.get("guards") or {}
        for x in (g.get("live") or []): why[x["rule"]] += 1
        if not (g.get("live")): why["(no live guard; upstream actionable=false)" if not s.get("actionable") else "actionable"] += 1
print(json.dumps({"strategy_polls": n, "band_ge_Bplus": hi, "live_guard_rules_on_Bplus+": why.most_common(), "floor_verdict": verd.most_common(), "phase": ph.most_common()}, indent=0))
