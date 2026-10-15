#!/usr/bin/env python3
"""Nightly lightweight backtest of the paper-trend lane over the cached GLBX NQ 1m history ($0; no other datasets).
Replays trend_paper.step() unchanged, one simulated call per day at 14:52 CT, with fetch() limited to bars <= the
simulated clock (no lookahead past 14:52). Writes /var/lib/ledger-backtest/<date>.json + latest.json."""
import datetime as D, json, os, sys, types
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE); sys.path.insert(0, os.path.join(HERE, "paper"))
import trend_paper as tp
from common import load_env, CT
HIST = os.environ.get("HIST_DIR", "/var/lib/ledger-archive/hist"); OUT = os.environ.get("BT_DIR", "/var/lib/ledger-backtest")

def load_bars(path):
    import pandas as pd
    df = pd.read_parquet(path, columns=["open", "high", "low", "close"]); df.index = df.index.tz_convert("America/Chicago")
    return [dict(t=i.to_pydatetime(), o=float(r[0]), h=float(r[1]), l=float(r[2]), c=float(r[3])) for i, r in zip(df.index, df.to_numpy())]

def run(bars, days, tmp):
    clock = {"now": None}
    class FakeDT(D.datetime):
        @classmethod
        def now(cls, tz=None): return clock["now"].astimezone(tz) if tz else clock["now"]
    tp.D = types.SimpleNamespace(datetime=FakeDT, date=D.date, time=D.time, timedelta=D.timedelta, timezone=D.timezone)
    tp.CSV = os.path.join(tmp, "trades.csv"); tp.JL = os.path.join(tmp, "events.jsonl"); tp.ST = os.path.join(tmp, "state.json")
    tp.history = lambda today: [b for b in bars if D.datetime.combine(today - D.timedelta(days=40), D.time(0), CT) <= b["t"] < D.datetime.combine(today, D.time(0), CT) - D.timedelta(hours=7)]   # same 40d window as tp.history
    tp.fetch = lambda start, end=None: [b for b in bars if b["t"] >= start and (end is None or b["t"] < end) and b["t"] <= clock["now"]]
    import fastpath; fastpath.install(tp)
    res = []
    for d in days:
        clock["now"] = D.datetime.combine(d, D.time(14, 52), CT); s = {}
        try: tp.step(d, s); r = s.get(str(d), {})
        except Exception as e: r = {"error": repr(e)[:200]}
        res.append(dict(date=str(d), score=(r.get("signal") or {}).get("score"), why=r.get("why"), result=r.get("result"), error=r.get("error")))
    return res

def main():
    load_env(); os.makedirs(OUT, exist_ok=True); tmp = os.path.join(OUT, ".scratch"); os.makedirs(tmp, exist_ok=True)
    for f in os.listdir(tmp): os.remove(os.path.join(tmp, f))
    bars = load_bars(os.path.join(HIST, "NQ_1m.parquet"))
    alld = sorted({b["t"].date() for b in bars if b["t"].weekday() < 5})
    days = alld[-int(os.environ.get("BT_DAYS", "20")):]
    res = run(bars, days, tmp); tr = [r["result"] for r in res if r["result"]]
    summ = dict(generated=D.datetime.now(CT).isoformat(timespec="seconds"), days=len(days), trades=len(tr), errors=sum(1 for r in res if r["error"]),
                usd=round(sum(t["usd_1mnq"] for t in tr), 2), R=round(sum(t["R"] for t in tr), 2), wins=sum(1 for t in tr if t["R"] > 0), per_day=res)
    p = os.path.join(OUT, f"{D.date.today()}.json"); json.dump(summ, open(p, "w"), indent=1, default=str)
    json.dump(summ, open(os.path.join(OUT, "latest.json"), "w"), indent=1, default=str)
    print(json.dumps({k: v for k, v in summ.items() if k != "per_day"}))

if __name__ == "__main__": main()
