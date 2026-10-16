"""arms proof: replay cards.log through two watcher trees (combo1016 head vs + arms) and diff every non-arm row + the fire/refusal decision.
usage: python replay_arms.py dump <tree> <cards.log> <out.jsonl> [inject]  |  python replay_arms.py diff <a> <b>
inject: every card gets a firing combo1016 read (S2 88, gbmP 0.7, setupId, arms reads) so the arm path runs on every card in BOTH trees."""
import json, os, re, sys
def dump(tree, cards, out, inject=False):
    sys.path.insert(0, tree); os.chdir(tree)
    from watcher import gates
    from watcher.config import Config
    from tests.conftest import _raw_snapshot
    cal = json.load(open(os.path.join(tree, "data", "news-calendar.json")))
    def cfg(d):
        c = Config()
        for k, v in (d or {}).items():
            if hasattr(c, k): setattr(c, k, v)
        return c
    n = 0
    with open(out, "w") as fo:
        for l in open(cards):
            try: c = json.loads(l)
            except Exception: continue
            if "extra" not in c or c.get("broker"): continue
            snap = _raw_snapshot(c["card"]); snap.update(c["extra"]); dayst = c.get("dayst") or {}
            if inject:
                px = next(iter((snap.get("tape_prices") or {}).values()), 100.0) or 100.0
                pl = {"kind": "market", "entry": px, "stop": px - 10, "risk": 10, "legs": [{"frac": 0.5, "R": 1, "px": px + 10}], "trailR": 1}
                snap["combo1016"] = {"S2": 88.0, "gbmP": 0.7, "p": 0.6, "thr": 0.604, "grade": "A", "fire": True, "wouldFire": True, "aPlus": False, "setupId": f"X|{c['now_ms']}",
                                     "plan": {"kind": "market", "entry": px, "stop": px - 10, "t1": px + 10, "t2": px + 20, "partialFrac": 0.5}, "partial": "partial: 3/14 S2 filled, 11/27 GBM missing",
                                     "arms": {"reads": [{"arm": k, "S2": 88.0, "gbmP": 0.7, "fire": True, "plan": pl} for k in ("config1_trail", "config2_e75", "config3_e75_s65", "config2_e75_tier200_400")], "pd": {"pd_cur": -0.5, "pd_ent": 0.5}}}
            old = snap.get("rules_hash")
            if old and old != gates.RULES_HASH:
                sub = lambda v: json.loads(json.dumps(v).replace(old, gates.RULES_HASH)); snap, dayst = sub(snap), sub(dayst)
            try: rows = gates.evaluate_fire(snap, cfg(c.get("cfg")), c["now_ms"], dayst, None, cal)
            except Exception as e: rows = [("replay_error", False, str(e)[:120])]
            fo.write(json.dumps({"ts": c["ts"], "rows": [[a, b, w] for a, b, w in rows]}) + "\n"); n += 1
    print(tree, n, "cards")
_H = re.compile(r"\b[0-9a-f]{16}\b")
ARM = re.compile(r"^shadow:combo1016:(config1_trail|config2_e75_tier200_400|config2_e75|config3_e75_s65|arms_error)(:|$)")
def diff(a, b):
    A = [json.loads(l) for l in open(a)]; B = [json.loads(l) for l in open(b)]
    assert len(A) == len(B)
    rd = fd = rf = 0; arm = {}
    for x, y in zip(A, B):
        yo = [r for r in y["rows"] if not ARM.match(str(r[0]))]
        for r in y["rows"]:
            if ARM.match(str(r[0])):
                if r[0].endswith("arms_error"): kd = r[0]
                else:   # SMC log schema: tag shadow:combo1016:<config>, JSON payload with event + label
                    try: pj = json.loads(r[2]); kd = f"{r[0].split(':', 2)[-1]}:{pj.get('event')}:{pj.get('label')}"
                    except Exception: kd = r[0] + ":unparsed"
                arm[kd] = arm.get(kd, 0) + 1
                assert r[1] is True, r
        n = lambda rs: [[p, q, _H.sub("<h>", str(w))] for p, q, w in rs]
        rd += n(yo) != n(x["rows"])
        fd += all(r[1] is not False for r in yo) != all(r[1] is not False for r in x["rows"])
        rf += [r[0] for r in yo if r[1] is False] != [r[0] for r in x["rows"] if r[1] is False]
    print(json.dumps({"cards": len(A), "non_arm_row_diffs": rd, "fire_diffs": fd, "refusal_diffs": rf, "arm_rows_by_kind": arm}))
if __name__ == "__main__":
    if sys.argv[1] == "dump": dump(sys.argv[2], sys.argv[3], sys.argv[4], len(sys.argv) > 5)
    else: diff(sys.argv[2], sys.argv[3])
