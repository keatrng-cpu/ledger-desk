#!/usr/bin/env python3
"""q_v2 daily calibration drift monitor (shadow). stdlib only.

Input: JSONL of resolved cards, one per line: {"day": "2026-10-16", "band": "A-", "R": 1.2}
       (band = q_v2 band at the decision, R = realized trade R; the desk feed carries q_v2 per card).
Compares realized win rate and mean R per band with shared/q-v2-expect.json (walk-forward OOS) and flags a band
when the expectation falls outside the realized 95% interval (Wilson for win rate, normal for mean R).
Usage: python3 scripts/qv2_drift.py cards.jsonl [--out report.md]
"""
import json, math, sys, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
Z = 1.96


def wilson(k, n, z=Z):
    if n == 0:
        return (0.0, 1.0)
    p = k / n
    d = 1 + z * z / n
    c = (p + z * z / (2 * n)) / d
    h = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d
    return (c - h, c + h)


def drift(rows, expect):
    out = []
    for band, e in expect["bands"].items():
        rs = [float(r["R"]) for r in rows if r.get("band") == band and r.get("R") is not None]
        n = len(rs)
        if n == 0:
            out.append(dict(band=band, n=0, flag=False, why="no trades"))
            continue
        k = sum(1 for x in rs if x > 0)
        lo, hi = wilson(k, n)
        mr = sum(rs) / n
        se = (e.get("Rsd") or 1.0) / math.sqrt(n)
        rlo, rhi = mr - Z * se, mr + Z * se
        why = []
        if not lo <= e["win"] <= hi:
            why.append(f"win {k/n:.2f} [{lo:.2f},{hi:.2f}] vs exp {e['win']:.2f}")
        if not rlo <= e["R"] <= rhi:
            why.append(f"R {mr:+.2f} [{rlo:+.2f},{rhi:+.2f}] vs exp {e['R']:+.2f}")
        out.append(dict(band=band, n=n, win=round(k / n, 3), R=round(mr, 3), exp_win=e["win"], exp_R=e["R"], flag=bool(why), why="; ".join(why) or "within CI"))
    return out


def report(res, day):
    lines = [f"# q_v2 calibration drift {day}", "", "| band | n | win | exp win | R | exp R | flag | why |", "|---|---|---|---|---|---|---|---|"]
    for r in res:
        lines.append(f"| {r['band']} | {r['n']} | {r.get('win','')} | {r.get('exp_win','')} | {r.get('R','')} | {r.get('exp_R','')} | {'⚠' if r['flag'] else ''} | {r['why']} |")
    return "\n".join(lines) + "\n"


def main(argv):
    if not argv:
        print(__doc__)
        return 2
    rows = [json.loads(l) for l in open(argv[0]) if l.strip()]
    expect = json.load(open(ROOT / "shared" / "q-v2-expect.json"))
    res = drift(rows, expect)
    day = max((r.get("day", "") for r in rows), default="")
    md = report(res, day)
    if "--out" in argv:
        pathlib.Path(argv[argv.index("--out") + 1]).write_text(md)
    print(md)
    return 1 if any(r["flag"] for r in res) else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
