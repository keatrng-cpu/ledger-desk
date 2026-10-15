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
    rows, splits = learn.run(str(tmp_path / "out"), None, (set(), set()))
    assert len(rows) == 1 and os.path.exists(tmp_path / "out" / "learn" / "report.md")

def test_learn_empty(tmp_path):
    rows, splits = learn.run(str(tmp_path), None, (set(), set()))
    assert rows == [] and splits == [] and "Trades: **0**" in open(tmp_path / "learn" / "report.md").read()

# ---- review fixes (PR #25 Accuracy CHANGES) ----
def test_eq_snaps_to_tick():
    assert smc.snap(7754.375) in (7754.25, 7754.5) and smc.snap(7754.1) == 7754.0 and smc.snap(7754.13) == 7754.25
    rg = smc.dealing_range(dict(ONH=7790.25, ONL=7718.0), pd.Timestamp("2026-10-15 08:00", tz=CT))
    assert rg["eq"] * 4 == int(rg["eq"] * 4)                                 # (7790.25+7718)/2 = 7754.125 -> on the 0.25 grid
    for hi, lo in ((100.25, 99.0), (30805.75, 30700.0), (7792.5, 7768.25)):
        e = smc.dealing_range(dict(ONH=hi, ONL=lo), pd.Timestamp("2026-10-15 08:00", tz=CT))["eq"]
        assert abs(e * 4 - round(e * 4)) < 1e-9 and abs(e - (hi + lo) / 2) <= 0.125

def test_swept_at_and_mark_swept():
    df = frame([(100, 101, 99, 100), (100, 101.5, 99.5, 100.5), (100.5, 102.5, 100, 102), (102, 102.2, 98.5, 99)])
    assert smc.swept_at(df, 102.0, True) == df.index[2]                       # traded through, close irrelevant
    assert smc.swept_at(df, 102.0, True, start=df.index[3]) is None and smc.swept_at(df, 102.0, True, start=df.index[2]) == df.index[3]           # only bars strictly after start
    assert smc.swept_at(df, 99.0, False) == df.index[3] and smc.swept_at(df, 90, False) is None
    idx = pd.date_range("2026-10-14 08:30", "2026-10-15 11:00", freq="1min", tz=CT)
    m1 = pd.DataFrame(dict(open=100.0, high=101.0, low=99.0, close=100.0), index=idx)
    m1.loc["2026-10-14 09:00", "high"] = 110; m1.loc["2026-10-15 10:15", "high"] = 111           # PDH 110 taken at 10:15 today
    t = pd.Timestamp("2026-10-15 10:30", tz=CT); lv = smc.session_levels(m1, t)
    pools = [dict(kind="EQL", px=98.0, t0=idx[10], t1=idx[20], n=2), dict(kind="EQH", px=100.5, t0=idx[10], t1=idx[20], n=2)]
    sw = smc.mark_swept(m1, lv, pools, t)
    assert sw["PDH"] == pd.Timestamp("2026-10-15 10:15", tz=CT) and "PDL" not in sw
    assert pools[0]["swept"] is None and pools[1]["swept"] is not None       # EQH 100.5 traded through by the 101 highs

def _render_case(tmp_path):
    rng = np.random.default_rng(1); idx = pd.date_range("2026-10-14 17:00", "2026-10-15 14:00", freq="1min", tz=CT)
    c = 7780 + np.cumsum(rng.normal(0, 0.8, len(idx))); o = np.r_[c[0], c[:-1]]
    df = pd.DataFrame(dict(open=o, high=np.maximum(o, c) + 0.5, low=np.minimum(o, c) - 0.5, close=c), index=idx)
    fill = float(df.loc["2026-10-15 12:30"].close)
    tr = dict(signal="sig-t", chart_id="sig-t", source="live_rh", symbol="ES", side="long", band="B+", q=0.65, entry=fill, stop=fill - 5, t1=fill + 8, t2=fill + 15,
              fill_t=pd.Timestamp("2026-10-15 12:30:30", tz=CT), fill_px=fill, exit_t=pd.Timestamp("2026-10-15 12:50", tz=CT), exit_px=fill - 5, R=-1.0, pnl_usd=-36,
              events=[dict(t=pd.Timestamp("2026-10-15 12:30:30", tz=CT), what="FILL", px=fill, qty=1), dict(t=pd.Timestamp("2026-10-15 12:50", tz=CT), what="EXIT", px=fill - 5, qty=1, why="ticket stop hit")],
              verdicts=dict(desk=dict(band="B+", q=0.65), brain="STAND", floor="WATCH"), gates=dict(live_block=[], soft_block=[], shadow_block=[]), option=None)
    return df, tr, fill

def test_render_swept_level_dimmed_and_labelled(tmp_path):
    pytest.importorskip("matplotlib")
    import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
    from trade_charts import render as Rn
    df, tr, fill = _render_case(tmp_path)
    fr = {"1m": df, "5m": B.resample(df, "5min")}
    sw_t = pd.Timestamp("2026-10-15 12:40", tz=CT)
    st = dict(levels=dict(PDH=fill + 1, ONL=fill - 3), levels_swept=dict(PDH=sw_t), range=dict(hi=fill + 4, lo=fill - 4, eq=smc.snap(fill), name="ON"),
              pools=[dict(kind="EQL", px=fill - 2, t0=df.index[-200], t1=df.index[-190], n=2, swept=sw_t)])
    fig, ax = plt.subplots()
    Rn.draw_panel(ax, fr, st, tr, "1m", pd.Timestamp("2026-10-15 12:20", tz=CT), pd.Timestamp("2026-10-15 12:55", tz=CT), True)
    texts = [t.get_text() for t in ax.texts]
    assert "PDH %.2f swept 12:40 CT" % (fill + 1) in texts
    assert "EQL (liquidity) %.2f swept 12:40 CT" % (fill - 2) in texts
    assert not any(t.startswith("ONL") for t in texts)                       # resting level: drawn faint, not labelled
    dashed = [l for l in ax.lines if l.get_alpha() is not None and l.get_alpha() <= 0.35 and abs(l.get_ydata()[0] - (fill + 1)) < 1e-9]
    assert dashed                                                            # dimmed after the sweep
    assert any(t.startswith("EQ ") and float(t.split()[1]) * 4 == round(float(t.split()[1]) * 4) for t in texts)
    assert len(texts) <= Rn.MAX_LABELS + 3                                  # few labels (+ event numbers)
    plt.close(fig)

def test_summary_plain_english():
    from trade_charts import analyze as A
    t_in = pd.Timestamp("2026-10-15 13:02:10", tz=CT)
    tr = dict(side="long", band="B+", fill_t=t_in, R=-1.0, exit_px=7775.0, stop=7775.0, events=[dict(why="ticket stop 7775.0 hit")])
    st = dict(sweeps=[dict(kind="SSL", px=7768.5, t=t_in - pd.Timedelta(minutes=20))],
              ifvg_after=[dict(side="bull", tf="1m", inverted=pd.Timestamp("2026-10-15 13:02", tz=CT), inv_close=pd.Timestamp("2026-10-15 13:03", tz=CT)),
                          dict(side="bull", tf="1m", inverted=pd.Timestamp("2026-10-15 13:04", tz=CT), inv_close=pd.Timestamp("2026-10-15 13:05", tz=CT))])
    s = A.summary(tr, st, dict(data_ok=True, premium_pct=87.2, wrong_half=True))
    assert s.startswith("Long B+ after sweep of 7768.5 low in deep premium") and "inverted at 13:03/13:05" in s and "stopped \u22121R" in s and "Lesson:" in s

def _sidecar(root, day, cid, R, **trade):
    d = root / day; d.mkdir(parents=True, exist_ok=True)
    t = dict(signal=cid, chart_id=cid, symbol="ES", side="long", entry=7782.63, fill_t=f"{day}T13:02:10-05:00", exit_t=f"{day}T13:05:00-05:00"); t.update(trade)
    (d / f"{cid}.json").write_text(json.dumps(dict(trade=t, features=dict(data_ok=True, R=R, win=R > 0, ifvg_against=R < 0), chart=None)))
    (d / f"{cid}.png").write_bytes(b"\x89PNG" + b"0" * 100)

def _export(path, voids, age_h=0, **kw):
    import datetime as D
    t = (D.datetime.now(D.timezone.utc) - D.timedelta(hours=age_h)).isoformat()
    doc = dict(ok=True, source="desk_learn_annotation", exported_at=t, n=len(voids), voids=voids); doc.update(kw); path.write_text(json.dumps(doc))

def test_learn_skips_voided(tmp_path, monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False); monkeypatch.delenv("TC_VOIDS_EXPORT", raising=False)
    _sidecar(tmp_path, "2026-10-15", "keep-1", 1.0); _sidecar(tmp_path, "2026-10-15", "void-id", -4.1)
    _sidecar(tmp_path, "2026-10-14", "void-twin", -2.0, entry=7790.004); _sidecar(tmp_path, "2026-10-14", "void-flag", -1.0, voided=True)
    _export(tmp_path / "learn-voids.json", [dict(src="desk_card_journal", row_id="void-id"),
                                             dict(src="desk_card_journal", row_id="2026-10-14:ES:long:7790", day_key="2026-10-14", symbol="ES", side="long", entry=7790.0)])
    assert [r["chart_id"] for r in learn.build_table(str(tmp_path))] == ["keep-1"]
    proto = tmp_path / "proto"; proto.mkdir()
    rows, _ = learn.run(str(tmp_path), str(proto))
    assert len(rows) == 1 and json.load(open(proto / "extra" / "weights_chart_features.json"))["meta"]["n_trades"] == 1

@pytest.mark.parametrize("bad", ["missing", "stale", "notok", "garbage"])
def test_learn_refuses_without_voids(tmp_path, monkeypatch, bad):
    monkeypatch.delenv("DATABASE_URL", raising=False); monkeypatch.delenv("TC_VOIDS_EXPORT", raising=False)
    _sidecar(tmp_path, "2026-10-15", "keep-1", 1.0); p = tmp_path / "learn-voids.json"
    if bad == "stale": _export(p, [], age_h=48)
    if bad == "notok": _export(p, [], ok=False)
    if bad == "garbage": p.write_text("{")
    proto = tmp_path / "proto"; proto.mkdir()
    with pytest.raises(learn.VoidsUnavailable): learn.run(str(tmp_path), str(proto))
    assert not (tmp_path / "learn").exists() and not (proto / "extra").exists()     # wrote nothing
    monkeypatch.setenv("TC_OUT", str(tmp_path)); monkeypatch.setenv("TC_PROTO_DIR", str(proto))
    assert cli.main(["learn"]) == 3 and not (tmp_path / "learn").exists()

def test_atomic_writes_and_lock(tmp_path):
    p = tmp_path / "a" / "x.json"; learn.atomic_write(str(p), "1"); learn.atomic_write(str(p), "2")
    assert p.read_text() == "2" and [f.name for f in p.parent.iterdir()] == ["x.json"]   # no tmp leftovers
    import fcntl
    with learn.locked(str(tmp_path)):
        fh = open(tmp_path / ".learn.lock")
        with pytest.raises(BlockingIOError): fcntl.flock(fh, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fh.close()
    src = open(os.path.join(os.path.dirname(__file__), "..", "trade_charts", "learn.py")).read()
    assert 'open(path, "w")' not in src and 'open(os.path.join(out, "weights_chart_features.json"), "w")' not in src

def test_hook_patch_drops_home():
    s = open(os.path.join(os.path.dirname(__file__), "..", "watcher-exit-hook.patch")).read()
    line = next(l for l in s.splitlines() if "env = {k: v" in l)
    assert '"HOME"' not in line and '"PATH"' in line

def test_publish_index_caps_and_whitelist(tmp_path):
    from trade_charts import publish as P
    src = tmp_path / "src"; _sidecar(src, "2026-10-14", "a-old", 1.0); _sidecar(src, "2026-10-15", "b-new", -1.0, option=dict(account="SECRET"))
    big = src / "2026-10-15"; _sidecar(src, "2026-10-15", "c-big", 1.0); (big / "c-big.png").write_bytes(b"0" * (P.MAX_PNG + 1))
    dest = tmp_path / "public" / "trade-charts"; dest.mkdir(parents=True); (dest / "stale.png").write_bytes(b"x"); (dest / "index.json").write_text("{}")
    out = P.publish(str(src), str(dest))
    idx = json.load(open(dest / "index.json"))
    assert [t["id"] for t in idx["trades"]] == ["b-new", "a-old"] and out["n"] == 2   # newest first, oversize skipped
    assert not (dest / "stale.png").exists() and (dest / "2026-10-15" / "b-new.png").exists()
    assert "SECRET" not in (dest / "2026-10-15" / "b-new.json").read_text()

def test_publish_strips_live_dollars_and_guards_dest(tmp_path):
    from trade_charts import publish as P
    src = tmp_path / "src"; _sidecar(src, "2026-10-15", "live-1", -1.0, source="live_rh", pnl_usd=-36.0, opt_fill=2.96, option=dict(underlier="SPY", strike=770))
    _sidecar(src, "2026-10-15", "paper-1", 0.4, source="paper_futures", pnl_usd=120.0)
    dest = tmp_path / "trade-charts"; P.publish(str(src), str(dest))
    blob = (dest / "index.json").read_text() + "".join(p.read_text() for p in dest.glob("*/*.json"))
    assert "pnl_usd\": -36" not in blob and "-36" not in blob and "SPY" not in blob and "2.96" not in blob and "770" not in blob
    idx = {t["id"]: t for t in json.load(open(dest / "index.json"))["trades"]}
    assert "paper_pnl_usd" not in idx["live-1"] and "pnl_usd" not in idx["live-1"] and idx["paper-1"]["paper_pnl_usd"] == 120.0
    for bad in (tmp_path, tmp_path / "src"):                                   # wrong --dest: refuse, delete nothing
        with pytest.raises(SystemExit): P.publish(str(src), str(bad))
    assert (src / "2026-10-15" / "live-1.png").exists()
    (tmp_path / "x" / "trade-charts").mkdir(parents=True); (tmp_path / "x" / "trade-charts" / "keep.txt").write_text("1")
    with pytest.raises(SystemExit): P.publish(str(src), str(tmp_path / "x" / "trade-charts"))   # non-empty, no index.json

def test_png_text_has_no_live_dollars_or_option(tmp_path):
    pytest.importorskip("matplotlib")
    from trade_charts import render as Rn
    import matplotlib.pyplot as plt
    df, tr, fill = _render_case(tmp_path)
    tr.update(option=dict(n=1, underlier="SPY", exp="2026-10-16", strike=770.0, cp="C"), opt_fill=2.96)
    seen = []; orig = plt.Figure.savefig
    def grab(self, *a, **k): seen.extend(t.get_text() for t in self.findobj(lambda o: hasattr(o, "get_text"))); return orig(self, *a, **k)
    plt.Figure.savefig = grab
    try:
        st = dict(levels={}, range=None, pools=[], htf={})
        Rn.render(tr, {"1m": df, "5m": B.resample(df, "5min"), "15m": B.resample(df, "15min")}, st, dict(data_ok=False), str(tmp_path / "x.png"))
    finally: plt.Figure.savefig = orig
    txt = "\n".join(seen)
    assert "$" not in txt and "-36" not in txt and "SPY" not in txt and "filled" not in txt and "2.96" not in txt and "-1.00R" in txt
    tr.update(source="paper_futures"); assert "paper $ -36" in Rn.legend_text(tr, st, dict(data_ok=False))
