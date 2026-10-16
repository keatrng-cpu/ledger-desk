"""Validation for the push path SHADOW (overnight-1016 #3): signal -> decision latency, poll vs push, and what it is worth.

Poll path (measured, read-only from the watcher's cards.log): first card built after each 1m close (build_s) + the
watcher's receipt of that card (recv_s, 1 s poll). Push path (modelled until the live push_shadow.jsonl has rows):
build_s + SSE transit = checkMs/2 (the stream's re-read) + PUSH_NET_S (default 0.5 s for the internal card read and
the network). Target: bar close -> decision < targetS (10 s). R per latency uses the same Rule 1 events and closed 1m
fills as the lane validation; all timeframes 30s..1D read at T, closed bars only (table below).
Run: python3 validate_push.py [events.json]
"""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tfcommon as C

PUSH = json.load(open(os.path.join(C.ROOT, "shared", "push-shadow.json")))
NET = float(os.environ.get("PUSH_NET_S", "0.5"))


def main(cache):
    o = C.events(cache); ev = o["events"]; C._init()
    b, w = C.card_latency()
    if not len(b):
        return "cards.log not found: no latency sample\n"
    poll = b + w; push = b + PUSH["checkMs"] / 2000 + NET
    curve = {k: [C.r_at_delay(C._G[e["sym"]], e, k * 60) for e in ev] for k in range(2)}
    keep = [i for i in range(len(ev)) if curve[0][i] is not None and curve[1][i] is not None]
    r0 = float(np.mean([curve[0][i] for i in keep])); r1 = float(np.mean([curve[1][i] for i in keep]))
    rl = lambda s: r0 + (r1 - r0) * min(1.0, s / 60)
    L = ["# Validation: push path SHADOW (overnight-1016 #3)", "",
         f"Latency sample: {len(b)} minutes (first card per 1m bar, cards.log). Rule 1 events: {len(ev)} ({o['meta']['start']}..{o['meta']['end']}).", "",
         f"| path | bar close -> decision p50 s | p90 s | max s | share < {PUSH['targetS']} s | mean R at p50 | mean R at p90 |", "|---|---|---|---|---|---|---|"]
    for name, x in (("poll (measured)", poll), (f"push (modelled: build + {PUSH['checkMs']/2000:.2f} + {NET:.2f} s)", push), ("desk build only (floor)", b)):
        p50, p90 = np.median(x), np.percentile(x, 90)
        L.append(f"| {name} | {p50:.1f} | {p90:.1f} | {x.max():.1f} | {np.mean(x < PUSH['targetS']):.0%} | {rl(p50):+.4f} | {rl(p90):+.4f} |")
    L += ["", f"R curve: entry at the displacement close {r0:+.3f}R, one closed 1m bar later {r1:+.3f}R (linear in between).",
          f"Push saves the poll receipt (p50 {np.median(w):.1f} s); the build itself (p50 {np.median(b):.1f} s / p90 {np.percentile(b, 90):.1f} s) dominates and is unchanged by push.",
          "", "## Timeframes used (30s..1D, closed bars only, no lookahead)", "", C.tf_table(ev), "",
          "Conditions: Rule 1 as in shared/rule1.json; fills on closed 1m bars; exit 14:55 CT. SHADOW: push events are logged, never gated or fired."]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    print(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.json")))
