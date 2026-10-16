"""Validation for the Rule 1 SHADOW fire lane (overnight-1016 #2): what the persist exemption is worth, on closed bars.

Same Rule 1 events as the other shadow validations (all timeframes 30s..1D read at T, closed bars only; table below).
Lane decision latency = first card after the bar close + watcher receipt (measured from the watcher's cards.log,
read-only). Legacy = lane + fast:persist hold (20 s minimum) or the 96 s the one live fire spent in persist.
R at each latency: entry at the first 1m close at or after T + latency (0 = the displacement close), stop/3R unchanged.
Run: python3 validate_lane.py [events.json]
"""
import json, math, os, sys
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tfcommon as C

LANE = json.load(open(os.path.join(C.ROOT, "shared", "rule1-lane.json")))


def main(cache):
    o = C.events(cache); ev = o["events"]; C._init()
    b, w = C.card_latency()
    lane_p50 = float(np.median(b) + np.median(w)) if len(b) else 5.0
    lane_p90 = float(np.percentile(b + w, 90)) if len(b) else 11.0
    rows = [("lane p50 (persist exempt)", lane_p50), ("lane p90", lane_p90),
            ("legacy min: lane p50 + 20 s hold", lane_p50 + LANE["legacyPersistHoldS"]),
            ("legacy observed: lane p50 + 96 s", lane_p50 + LANE["observedLivePersistS"]), ("10/15 live fire: 124 s", 124.0)]
    curve = {}
    for k in range(0, 4):   # R at 0..3 whole-minute entry delays (closed 1m fills), per event
        curve[k] = [C.r_at_delay(C._G[e["sym"]], e, k * 60) for e in ev]
    keep = [i for i in range(len(ev)) if all(curve[k][i] is not None for k in curve)]
    mean = lambda k, sym=None: float(np.mean([curve[k][i] for i in keep if sym is None or ev[i]["sym"] == sym]))
    def interp(lat, sym=None):
        k = min(2, int(lat // 60)); f = (lat - 60 * k) / 60
        return mean(k, sym) + (mean(k + 1, sym) - mean(k, sym)) * min(1.0, f)
    b0 = mean(0)
    L = ["# Validation: Rule 1 SHADOW fire lane (overnight-1016 #2)", "",
         f"Events: {len(ev)} Rule 1 tickets ES+NQ {o['meta']['start']}..{o['meta']['end']} ({len(keep)} with all delayed fills). Card latency sample: {len(b)} first-cards-per-minute from cards.log"
         f" (build after the 1m close p50 {np.median(b) if len(b) else float('nan'):.1f} s / p90 {np.percentile(b, 90) if len(b) else float('nan'):.1f} s; watcher receipt p50 {np.median(w) if len(w) else float('nan'):.1f} s).", "",
         "R by whole-minute entry delay (closed 1m fills): " + ", ".join(f"{k} min {mean(k):+.3f}" for k in curve) + ".", "",
         "| path | decision latency s | mean R (interpolated) | delta R vs 0 s | ES | NQ |", "|---|---|---|---|---|---|"]
    for name, lat in rows:
        m = interp(lat)
        L.append(f"| {name} | {lat:.1f} | {m:+.3f} | {m - b0:+.3f} | {interp(lat, 'ES'):+.3f} | {interp(lat, 'NQ'):+.3f} |")
    L += ["", f"Baseline (0 s, entry at the displacement close): mean R {b0:+.3f}.",
          "Fills are on closed 1m bars at 0..3 min; a latency between two whole minutes is linearly interpolated.",
          "", "## Timeframes used (30s..1D, closed bars only, no lookahead)", "", C.tf_table(ev), "",
          "Conditions: Rule 1 as in shared/rule1.json; a delayed entry whose stop traded before the fill counts -1R; exit 14:55 CT.",
          "The lane is SHADOW: these numbers say what the exemption would be worth; nothing fires."]
    return "\n".join(L) + "\n"


if __name__ == "__main__":
    print(main(sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(os.path.abspath(__file__)), "events.json")))
