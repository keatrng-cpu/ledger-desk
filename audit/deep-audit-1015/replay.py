"""Deep-audit fix replay: cards.log (10/13-15) + paper ledger through the NEW kill rules. Read-only on live files."""
import json, sys, datetime as dt, bisect
# Optional cut: python3 replay.py <unix_ts>  — only cards.log rows before it (the log keeps growing; the PR numbers used the commit-time cut)
CUT = float(sys.argv[1]) if len(sys.argv) > 1 else None
sys.path.insert(0, "/workspace/pf-deepfix")
import paper as P
ALERT = {"A+", "A", "A-"}
polls = []
seen = {}   # (sym, side, entry) -> {"touched": bool, "t1hit": bool, "stop_hit": bool}
removed = {"invalidated": 0, "played_out": 0, "stale": 0}; old_alert = new_alert = 0; added = 0
alert_removed_examples = []
for l in open("/workspace/desk-watcher/cards.log"):
    try: r = json.loads(l)
    except Exception: continue
    c = r.get("card") or {}; w = c.get("wire") or {}; s = w.get("strategy") or {}
    if not s or s.get("entry") is None: continue
    if CUT is not None and r.get("ts", 0) >= CUT: continue
    tape = w.get("tape") or {}; side = s.get("side"); sym = s.get("symbol")
    px = next(((tape.get(k) or {}).get("price") for k in ("left", "right") if (tape.get(k) or {}).get("symbol") == sym), None)
    lags = [(tape.get(k) or {}).get("lagSec") for k in ("left", "right")]
    e, st, t1 = s.get("entry"), s.get("stopPx"), s.get("target")
    key = (sym, side, round(e, 2)); k = seen.setdefault(key, {"touched": False, "t1": False, "stop": False})
    L = side == "long"
    if px is not None:
        if (L and px <= e) or (not L and px >= e): k["touched"] = True
        if t1 is not None and not k["touched"] and ((L and px >= t1) or (not L and px <= t1)): k["t1"] = True
        if st is not None and ((L and px <= st) or (not L and px >= st)): k["stop"] = True
    why = None
    if px is not None and st is not None and ((L and px <= st) or (not L and px >= st)): why = "invalidated"
    elif k["t1"] and not k["touched"]: why = "played_out"
    elif any(x is None or x > 30 for x in lags): why = "stale"
    was = s.get("band") in ALERT
    old_alert += was
    if why: removed[why] += 1
    now_ok = s.get("band") in ALERT and not why   # computed from the new rules, not assumed
    new_alert += now_ok
    added += (now_ok and not was)                  # the new rules only kill, so this should stay 0 — but it is counted
    if was and why and len(alert_removed_examples) < 8: alert_removed_examples.append((c.get("at"), sym, side, s.get("band"), e, st, t1, px, why))
    polls.append((r["ts"], sym, side, s.get("band"), why))
polls.sort(key=lambda p: p[0]); ts = [p[0] for p in polls]
def card_at(iso):
    t = dt.datetime.fromisoformat(iso).timestamp(); i = bisect.bisect_right(ts, t) - 1
    return polls[i] if i >= 0 and t - ts[i] <= 120 else None   # no card within 120 s = unknown, trade kept
L = json.load(open("/workspace/paper-futures/ledger.json"))
rows = []
for t in L["closed"]:
    f = t.get("filled_at"); a = t["alerted"]
    exp = P.pending_expired({"alerted": a}, P._et(f)) if f else None
    p = card_at(f) if f else None
    BR = ["A+", "A", "A-", "B+", "B", "C"]
    dead = None
    if not p: dead = None
    if p:
        _, sym, side, band, why = p
        if P.base(sym) != P.base(t["symbol"]) or side != t["side"]: dead = f"card is now {sym} {side}"
        elif band not in BR or BR.index(band) > 3: dead = f"card band {band}"
        elif why: dead = f"desk would kill: {why}"
    # #1 refusal computed from the ledger: the fill price is at/through the stop (long fill <= stop, short fill >= stop)
    fp, sp_ = t.get("fill_price") or t.get("entry"), t.get("stop")
    stop_through = "fill through stop -> refused (#1, paper.py:157)" if fp is not None and sp_ is not None and ((t["side"] == "long" and fp <= sp_) or (t["side"] == "short" and fp >= sp_)) else None
    pnl = t["pnl$"]; mnq = None
    if t["id"].startswith("MNQ") and t["symbol"] == "NQ":
        dist = abs(t["entry"] - t["stop"]); n = int(t.get("risk_cap", 2000) // (dist * 2))
        mnq = round(pnl * (n * 2) / (t["contracts"] * 20), 2)
    keep = not (exp or dead or stop_through)
    rows.append({"card_known": bool(p), "id": t["id"], "pnl$": pnl, "R": t.get("result_R"), "expired": exp, "dead_at_touch": dead, "refused": stop_through, "kept": keep, "pnl_if_booked_MNQ": mnq})
kept = [r for r in rows if r["kept"]]; cut = [r for r in rows if not r["kept"]]
out = {"polls": len(polls), "alert_eligible_old": old_alert, "alert_eligible_new": new_alert, "alerts_added": added,
       "polls_killed": removed, "removed_examples": alert_removed_examples,
       "paper": rows, "paper_old_pnl": round(sum(r["pnl$"] for r in rows), 2), "paper_new_pnl": round(sum(r["pnl$"] for r in kept), 2),
       "removed_trades": [(r["id"], r["pnl$"]) for r in cut],
       # computed: a trade the new rules would add is a ledger fill the OLD rules refused/expired that the new ones keep;
       # the ledger only holds fills the old rules took, so this is empty by construction (it cannot see trades never taken)
       "added_trades": [(r["id"], r["pnl$"]) for r in rows if r["kept"] and r.get("old_refused")],
       "caveats": ["pending expiry 3h was chosen AFTER seeing this data (post-hoc fit); the ES-1924 removal depends on it",
                   f"{sum(1 for r in rows if not r['card_known'])} of {len(rows)} fills had no card within 120 s, so 'no winners lost' is untested for them",
                   "cards.log grows; pass a unix ts cut to reproduce the commit-time numbers"]}
json.dump(out, open("replay.json", "w"), indent=1, default=str)
print(json.dumps({k: v for k, v in out.items() if k != "paper"}, indent=1, default=str))
for r in rows: print(r)
