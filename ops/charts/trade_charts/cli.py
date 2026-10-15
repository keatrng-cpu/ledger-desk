"""python -m trade_charts {backfill,exit,learn,nightly} — chart + sidecar + learning loop. Read-only on every input."""
import argparse, json, os, sys, time, traceback
import pandas as pd
from . import trades as T, analyze as A, learn

CT = "America/Chicago"
def cfg_from_env():
    e = os.environ.get
    return dict(watcher_dir=e("TC_WATCHER_DIR", "/workspace/desk-watcher"),
                paper_futures_csv=e("TC_PAPER_FUTURES_CSV", "/workspace/paper-futures/trades.csv"),
                paper_trend_events=e("TC_PAPER_TREND_EVENTS", "/workspace/paper-trend/events.jsonl"),
                vps_paper_events=e("TC_VPS_PAPER_EVENTS", "/var/lib/ledger-paper/events.jsonl"),
                out=e("TC_OUT", "/workspace/trade-charts"), proto=e("TC_PROTO_DIR", "/workspace/proto-weighting"))

def _safe(s): return "".join(c if c.isalnum() or c in "-_." else "_" for c in str(s))

def chart_one(tr, out_root, sources=None, render=True):
    day = f"{tr['fill_t']:%Y-%m-%d}"; d = os.path.join(out_root, day); os.makedirs(d, exist_ok=True)
    stem = _safe(tr["chart_id"]); png = os.path.join(d, stem + ".png"); side = os.path.join(d, stem + ".json")
    fr, st, f = A.analyze(tr, sources)
    drawn = None
    if render and f.get("data_ok"):
        try:
            from . import render as Rn
            drawn = Rn.render(tr, fr, st, f, png)
        except ImportError as ex: st["render_error"] = f"matplotlib missing: {ex}"
    keep = {k: st[k] for k in ("bar_sources", "atr5", "atr1", "levels", "range", "pools", "sweeps", "ifvg_against", "in_fvg", "in_ob", "htf", "render_error") if k in st}
    keep["fvg5_at_entry"] = [g for g in st.get("fvg5", []) if g["formed"] + pd.Timedelta(minutes=5) <= tr["fill_t"]][-8:]
    keep["obs_at_entry"] = [o for o in st.get("obs", []) if o["disp_t"] + pd.Timedelta(minutes=5) <= tr["fill_t"]][-5:]
    rec = dict(schema=1, chart=drawn, trade={k: v for k, v in tr.items()}, features=f, structure_at_entry=keep,
               generated=pd.Timestamp.now(tz=CT).isoformat(timespec="seconds"))
    tmp = side + ".tmp"; json.dump(A._iso(rec), open(tmp, "w"), indent=1, default=str); os.replace(tmp, side)
    return png if drawn else None, side, f

def _one(args):
    t, out, render = args
    try:
        png, side, f = chart_one(t, out, render=render)
        return dict(id=t["chart_id"], png=png, json=side, R=t.get("R"), data_ok=f.get("data_ok"))
    except Exception as ex:
        traceback.print_exc(); return dict(id=t.get("chart_id"), error=repr(ex)[:300])

def main(argv=None):
    ap = argparse.ArgumentParser(prog="trade_charts")
    ap.add_argument("cmd", choices=["backfill", "exit", "learn", "nightly"])
    ap.add_argument("--since"); ap.add_argument("--until"); ap.add_argument("--signal"); ap.add_argument("--no-render", action="store_true")
    ap.add_argument("--delay", type=float, default=0, help="seconds to wait first (watcher hook: let post-exit bars land)")
    a = ap.parse_args(argv); c = cfg_from_env()
    if a.delay: time.sleep(min(a.delay, 600))
    since = T.ts(a.since) if a.since else None; until = T.ts(a.until) if a.until else None
    if a.cmd == "exit":     # watcher hook: chart the most recent closed live trade (or --signal), then refresh learning
        tr = [t for t in T.load_live(c["watcher_dir"], pd.Timestamp.now(tz=CT) - pd.Timedelta(days=1)) if not a.signal or t["signal"] == a.signal][-1:]
    elif a.cmd in ("backfill", "nightly"):
        if a.cmd == "nightly" and not since: since = pd.Timestamp.now(tz=CT).normalize() - pd.Timedelta(days=1)
        tr = T.load_all(c, since, until)
    else: tr = []
    res = []
    # one short-lived child per trade (spawn): peak RSS = one trade's bars + one figure, never the sum (VPS MemoryMax=300M)
    import multiprocessing as mp
    if len(tr) > 1 and os.environ.get("TC_INPROC") != "1":
        with mp.get_context("spawn").Pool(1, maxtasksperchild=1) as pool:
            res = pool.map(_one, [(t, c["out"], not a.no_render) for t in tr], chunksize=1)
    else:
        res = [_one((t, c["out"], not a.no_render)) for t in tr]
    if a.cmd in ("learn", "nightly", "exit", "backfill"):
        rows, _ = learn.run(c["out"], c["proto"]); res.append(dict(learn_rows=len(rows), report=os.path.join(c["out"], "learn", "report.md")))
    print(json.dumps(res, default=str, indent=1))
    return 0 if not any("error" in r for r in res) else 1

if __name__ == "__main__": sys.exit(main())
