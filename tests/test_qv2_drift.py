import importlib.util, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("qv2_drift", ROOT / "scripts" / "qv2_drift.py")
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
EXP = {"bands": {"A": {"n": 1000, "win": 0.42, "R": 0.16, "Rsd": 1.3}}}


def test_within_ci_not_flagged():
    rows = [{"band": "A", "R": 2.0}] * 42 + [{"band": "A", "R": -1.0}] * 58
    r = m.drift(rows, EXP)[0]
    assert r["n"] == 100 and not r["flag"]


def test_bad_band_flagged():
    rows = [{"band": "A", "R": -1.0}] * 60 + [{"band": "A", "R": 1.0}] * 5
    assert m.drift(rows, EXP)[0]["flag"]


def test_wilson_bounds():
    lo, hi = m.wilson(5, 10)
    assert 0.2 < lo < 0.5 < hi < 0.8


def test_expectation_file_monotone_R_from_B_plus():
    e = json.load(open(ROOT / "shared" / "q-v2-expect.json"))["bands"]
    order = [b for b in ["B", "B+", "A-", "A", "A+"] if b in e]
    rs = [e[b]["R"] for b in order]
    assert rs == sorted(rs), rs


def test_qv2_config_shadow_and_edges_raise_only():
    c = json.load(open(ROOT / "shared" / "q-v2.json"))
    r = json.load(open(ROOT / "shared" / "desk-rules.json"))
    assert c["mode"] == "shadow"
    for k, v in r["bandEdges"].items():
        assert c["bandEdges"][k] >= v
    w = c["weights"]
    assert w["smt"] == 0 and w["pd"] == 0 and w["order_block"] == 0 and w["fvg_tap"] == 0 and w["ifvg"] == 3
    assert c["factorCap"] <= 0.07
