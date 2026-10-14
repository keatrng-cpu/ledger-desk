#!/usr/bin/env python3
"""deskSeq evidence from the watcher's cards.log (read-only). Usage: seq-cards-evidence.py [cards.log]
F5: polls where the strategy card's book != the brain's book (legacy other-book refusal) by band, per day."""
import json, sys, collections
from datetime import datetime, timezone, timedelta
p = sys.argv[1] if len(sys.argv) > 1 else "/workspace/desk-watcher/cards.log"
ET = timezone(timedelta(hours=-4))
f5 = collections.Counter(); polls = collections.Counter()
for l in open(p):
    try: d = json.loads(l)
    except Exception: continue
    c = d.get("card") or {}; w = c.get("wire") or {}
    day = datetime.fromtimestamp(d["ts"], ET).strftime("%m-%d"); polls[day] += 1
    s = w.get("strategy") or {}; b = {**(w.get("brain") or {}), **(c.get("brain") or {})}
    if not s.get("symbol"): continue
    t = (w.get("floor") or {}).get("ticket") or {}
    UB = {"QQQ": "MNQ", "SPY": "ES"}
    for who, sym, side, band in (("card", s.get("symbol"), s.get("side"), s.get("band")),
                                 ("floor", UB.get(str(t.get("underlier") or "").upper()), {"put": "short", "call": "long"}.get(t.get("side"), t.get("side")), (w.get("floor") or {}).get("verdict"))):
        if sym and b.get("symbol") and b["symbol"] != sym and (b.get("word") or "").upper() in ("STAND", "WAIT"):
            f5[(day, who, sym, side, band)] += 1
print("polls", dict(polls))
print("F5 other-book legacy refusals (day, card book, side, band): polls")
for k, v in sorted(f5.items()): print(" ", k, v)
