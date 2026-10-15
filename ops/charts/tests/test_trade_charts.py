import json, os, sys, subprocess
import pandas as pd, numpy as np, pytest
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from trade_charts import smc, trades as T, learn, bars as B, cli

CT = "America/Chicago"
def frame(rows, start="2026-10-15 09:00", tf="5min"):
    idx = pd.date_range(start, periods=len(rows), freq=tf, tz=CT)
    return pd.DataFrame(rows, columns=["open", "high", "low", "close"], index=idx)

def test_fvg_detect_and_invert():
    df = frame([(10, 11, 9, 10.5), (10.5, 14, 10.4, 13.8), (13.8, 15, 12, 14.5), (14.5, 14.6, 11.5, 11.6), (11.6, 11.8, 10, 10.2)])
    g = [x for x in smc.fvgs(df) if x["side"] == "bull"][0]
    assert (g["lo"], g["hi"]) == (11, 12)
    assert g["filled"] == df.index[4]          # traded through the far edge (bar 3 only wicked into it)
    assert g["inverted"] == df.index[4]        # first CLOSE below the low -> bearish iFVG

def test_swings_equal_lows_and_sweep():
    lows = [5, 4, 3, 4, 5, 4, 3.05, 4, 5, 4.5, 2.5, 4]
    df = frame([(l + 1, l + 2, l, l + 1) for l in lows]); df.iloc[10] = (3.6, 4, 2.5, 3.5)
    sw = smc.swings(df.iloc[:9]); pools = smc.equal_levels(sw, 0.1)
    assert any(p["kind"] == "EQL" and p["px"] == 3 for p in pools)
    s = smc.sweeps(df, [dict(kind="EQL", px=3.0, t=df.index[6])])
    assert s and s[0]["kind"] == "SSL" and s[0]["t"] == df.index[10]

def test_closed_never_peeks():
    df = frame([(1, 2, 0, 1)] * 6)
    assert smc.closed(df, df.index[3] + pd.Timedelta(minutes=4), 5).index[-1] == df.index[2]

def test_session_levels_and_premium():
    idx = pd.date_range("2026-10-14 08:30", "2026-10-15 10:00", freq="1min", tz=CT)
    df = pd.DataFrame(dict(open=100.0, high=101.0, low=99.0, close=100.0), index=idx)
    df.loc["2026-10-14 09:00", "high"] = 110; df.loc["2026-10-15 03:00", "low"] = 90; df.loc["2026-10-15 09:00", "high"] = 105
    lv = smc.session_levels(df, pd.Timestamp("2026-10-15 09:30", tz=CT))
    assert lv["PDH"] == 110 and lv["ONL"] == 90 and lv["RTHH"] == 105
    rg = smc.dealing_range(lv, pd.Timestamp("2026-10-15 09:30", tz=CT)); assert rg["name"] == "RTH" and rg["eq"] == 102
    assert smc.session_phase(pd.Timestamp("2026-10-15 13:02", tz=CT)) == "ny_pm"

def test_r_multiple_weighted():
    assert T.r_multiple("long", 100, 98, [dict(qty=1, px=102), dict(qty=1, px=98)]) == 0.0
    assert T.r_multiple("short", 100, 102, [dict(qty=2, px=96)]) == 2.0

def test_live_parse(tmp_path):
    w = tmp_path; (w / "ticks").mkdir()
    al = [dict(ts="2026-10-15T14:02:04-04:00", kind="alert", signal="sig-x", text="FIRE B+ ES long q=0.6499 entry=7782.63 stop=7775.0 tgt=7792.25 rr=1.26 disp=0.69\n1x SPY 2026-10-16 770.0C @ 2.98 debit $298"),
          dict(ts="2026-10-15T14:02:10-04:00", kind="alert", text="FILLED 1 @ 2.96 (filled)"),
          dict(ts="2026-10-15T14:04:55-04:00", kind="alert", text="EXIT 1 @ 2.6: ticket stop 7775.0 hit (px 7775.0)", result={"account_number": "SECRET"})]
    (w / "alerts.log").write_text("\n".join(json.dumps(a) for a in al) + "\n")
    t0 = pd.Timestamp("2026-10-15T14:02:10-04:00").timestamp()
    (w / "ticks" / "2026-10-15.jsonl").write_text(json.dumps(dict(s="ES", t=t0, o=7782.0, h=7782.0, l=7782.0, c=7782.0)) + "\n")
    g = dict(ts=t0 - 30, signal="sig-x", band="B+", q=0.6499, gates=[["fast:agree", True, "brain STAND ES long; 1h bull 4h bear"], ["fast:geometry", True, "long: stop 7775.0 / entry 7782.63 / T1 7792.25 / T2 7874.25"],
                                                                     ["soft:verdict", True, "WOULD block (soft in fast chain): floor verdict WATCH"], ["fast:persist", False, "x"]])
    (w / "gates.log").write_text(json.dumps(g) + "\n")
    [tr] = T.load_live(str(w))
    assert tr["fill_px"] == 7782.0 and tr["exit_px"] == 7775.0 and tr["R"] == -1.0 and tr["pnl_usd"] == -36.0 and tr["t2"] == 7874.25
    assert tr["verdicts"]["brain"] == "STAND" and tr["verdicts"]["floor"] == "WATCH" and tr["gates"]["live_block"] == ["fast:persist"]
    assert "SECRET" not in json.dumps(tr, default=str)      # broker result payload (account numbers) never copied into the record

def test_paper_futures_dedup(tmp_path):
    ev = [dict(at="2026-10-15T13:02:10-05:00", what="entry", px=100, qty=2, chain=dict(signal="sig-p", brain=dict(word="STAND"), floor=dict(verdict="WATCH"))),
          dict(at="2026-10-15T13:05:00-05:00", what="stop", px=98, qty=2, pnl=-1)]
    import csv
    p = tmp_path / "trades.csv"
    with open(p, "w", newline="") as f:
        wr = csv.writer(f); wr.writerow(["id", "alerted", "symbol", "side", "band", "q", "entry", "stop", "t1", "t2", "contracts", "risk$", "status", "filled_at", "exit_events", "commission", "pnl$", "closed_at"])
        for _ in range(2): wr.writerow(["ES-L-1", "2026-10-15T13:02:10-05:00", "ES", "long", "B+", 0.65, 100, 98, 104, 106, 2, 1, "closed", "", json.dumps(ev), 0, -200, ""])
    [tr] = T.load_paper_futures(str(p)); assert tr["R"] == -1.0 and tr["verdicts"]["floor"] == "WATCH"

def test_ticks_bars(tmp_path):
    t = pd.Timestamp("2026-10-15 09:00", tz=CT).timestamp()
    (tmp_path / "2026-10-15.jsonl").write_text("".join(json.dumps(dict(s="MNQ", t=t + i * 15, o=1 + i, h=1 + i, l=1 + i, c=1 + i)) + "\n" for i in range(8)))
    df = B.from_ticks([str(tmp_path)], "NQ", pd.Timestamp("2026-10-15 08:59", tz=CT), pd.Timestamp("2026-10-15 09:05", tz=CT))
    assert len(df) == 2 and df.iloc[0].open == 1 and df.iloc[0].close == 4 and df.iloc[1].high == 8

def test_learn_shrinkage_and_shadow(tmp_path):
    rows = [dict(R=1.0, win=True, ifvg_against=False), dict(R=-1.0, win=False, ifvg_against=True), dict(R=-1.0, win=False, ifvg_against=True)]
    s = learn.split_stats(rows, "ifvg_against", bool)
    assert s["lift_R"] == -2.0 and s["lift_R_shrunk"] == round(-2.0 * 1 / 11, 2)
    proto = tmp_path / "proto"; proto.mkdir(); (proto / "weights.json").write_text("{}")
    learn.proto_feed([], [s], str(proto))
    assert (proto / "weights.json").read_text() == "{}"                      # prototype weights untouched
    w = json.load(open(proto / "extra" / "weights_chart_features.json")); assert w["meta"]["mode"] == "shadow" and w["weights"]["ifvg_against"]["w"] == 0.0

def test_no_order_or_paid_data_paths():
    src = "".join(open(os.path.join(os.path.dirname(__file__), "..", "trade_charts", f)).read() for f in os.listdir(os.path.join(os.path.dirname(__file__), "..", "trade_charts")) if f.endswith(".py"))
    for bad in ("get_range", "Broker", "broker.buy", "broker.sell", "import databento", "get_cost(", "requests.post", "desk-rules.json"):
        assert bad not in src

def test_end_to_end_synthetic(tmp_path, monkeypatch):
    pytest.importorskip("matplotlib")
    rng = np.random.default_rng(1); idx = pd.date_range("2026-10-14 17:00", "2026-10-15 14:00", freq="1min", tz=CT)
    c = 7780 + np.cumsum(rng.normal(0, 0.8, len(idx))); o = np.r_[c[0], c[:-1]]
    df = pd.DataFrame(dict(open=o, high=np.maximum(o, c) + 0.5, low=np.minimum(o, c) - 0.5, close=c), index=idx)
    ex = tmp_path / "bars"; ex.mkdir(); df.to_pickle(ex / "ES_1m.pkl")
    src = dict(glbx=[], archive=[], extra=[str(ex)], ticks=[])
    fill = float(df.loc["2026-10-15 12:30"].close)
    tr = dict(signal="sig-t", chart_id="sig-t", source="live_rh", symbol="ES", side="long", band="B+", q=0.65, entry=fill, stop=fill - 5, t1=fill + 8, t2=fill + 15,
              fill_t=pd.Timestamp("2026-10-15 12:30:30", tz=CT), fill_px=fill, exit_t=pd.Timestamp("2026-10-15 12:50", tz=CT), exit_px=fill - 5, R=-1.0, pnl_usd=-36,
              events=[dict(t=pd.Timestamp("2026-10-15 12:30:30", tz=CT), what="FILL", px=fill, qty=1), dict(t=pd.Timestamp("2026-10-15 12:50", tz=CT), what="EXIT", px=fill - 5, qty=1)],
              verdicts=dict(desk=dict(band="B+", q=0.65), brain="STAND", floor="WATCH"), gates=dict(live_block=[], soft_block=["soft:verdict"], shadow_block=[]), option=None)
    png, side, f = cli.chart_one(tr, str(tmp_path / "out"), sources=src)
    assert os.path.getsize(png) > 20000 and f["data_ok"] and f["session_phase"] == "ny_pm"
    j = json.load(open(side)); assert j["features"]["R"] == -1.0 and "structure_at_entry" in j
    rows, splits = learn.run(str(tmp_path / "out"), None)
    assert len(rows) == 1 and os.path.exists(tmp_path / "out" / "learn" / "report.md")

def test_learn_empty(tmp_path):
    rows, splits = learn.run(str(tmp_path), None)
    assert rows == [] and splits == [] and "Trades: **0**" in open(tmp_path / "learn" / "report.md").read()
