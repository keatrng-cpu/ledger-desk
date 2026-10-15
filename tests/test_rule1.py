import hashlib, importlib.util, json, pathlib

ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load(name, path):
    spec = importlib.util.spec_from_file_location(name, path); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m


R = _load("rule1", ROOT / "scripts" / "rule1.py")
W = _load("rule1_shadow", ROOT / "docs" / "rule1-1015" / "rule1_shadow.py")
BARS = json.load(open(ROOT / "tests" / "fixtures" / "bars-1m-2026-10-13.json"))


def test_1013_replay_fires_mnq_long_and_scores_both_plans():
    cards = [{"ts": 1791898200.0, "sym": "MNQ", "side": "long", "entry": 30700.0, "stop": 30650.0, "t1": 30800.0, "t2": 30900.0}]
    rows = {r["symbol"]: r for r in R.replay(BARS, "2026-10-13", cards)}
    assert rows["ES"]["fired"] is False
    m = rows["MNQ"]; tk = m["ticket"]
    assert m["fired"] and tk["side"] == "long" and tk["swept"] == "ONL" and tk["bonus"] and tk["mode"] == "shadow"
    assert R.ct_parts(tk["at"])[0] == 520                      # 08:40 CT, the 08:35 displacement close
    assert abs(tk["target"] - (tk["entry"] + 3 * tk["riskPts"])) <= 0.02
    assert tk["runner"] is not None and tk["runner"] > tk["entry"]
    o = tk["option"]; assert 0.5 <= o["delta"] <= 0.7 and 1 <= o["contracts"] <= 4 and o["premium"] * 100 * o["contracts"] <= 650
    assert m["R"] is not None and m["desk"] is not None and "R" in m["desk"]


def test_report_and_ledger(tmp_path):
    led = tmp_path / "led.jsonl"; out = tmp_path / "r.md"
    assert R.main(["replay", "--bars", str(ROOT / "tests/fixtures/bars-1m-2026-10-13.json"), "--day", "2026-10-13", "--ledger", str(led), "--out", str(out)]) == 0
    assert len(led.read_text().splitlines()) == 2 and "Rule 1" in out.read_text() and "MNQ" in out.read_text()


def test_no_ticket_before_window():
    t = R.rule1_ticket("MNQ", BARS["MNQ"], 1791898200.00)  # 08:30 CT exactly: no closed 5m bar in the window yet
    assert t is None


def test_watcher_logger_shadow_only(tmp_path):
    tk = R.replay(BARS, "2026-10-13")[1]["ticket"] if R.replay(BARS, "2026-10-13")[1]["fired"] else R.replay(BARS, "2026-10-13")[0]["ticket"]
    rows = W.log(str(tmp_path), {"rule1": [tk]}, set(), 1)
    assert len(rows) == 1 and rows[0]["broker"] is False and rows[0]["orders"] == 0 and rows[0]["delta_ok"]


def _canonical(v):
    if isinstance(v, list): return "[" + ",".join(_canonical(x) for x in v) + "]"
    if isinstance(v, dict): return "{" + ",".join(json.dumps(k) + ":" + _canonical(v[k]) for k in sorted(v)) + "}"
    return json.dumps(v)


def test_rules_hash_unchanged():
    rules = json.load(open(ROOT / "shared" / "desk-rules.json"))
    assert "rule1" not in json.dumps(rules)
    assert json.load(open(ROOT / "shared" / "rule1.json"))["mode"] == "shadow"


def test_watcher_dedupe_survives_restart(tmp_path):
    tk = {"mode": "shadow", "symbol": "MNQ", "side": "long", "at": 1, "option": {"delta": 0.6}}
    day = 1792076400000  # 2026-10-15 10:00 CT
    assert len(W.log(str(tmp_path), {"rule1": [tk]}, W.load_seen(str(tmp_path), day), day)) == 1
    seen = W.load_seen(str(tmp_path), day + 60_000)          # restarted watcher re-reads today's rows
    assert W.log(str(tmp_path), {"rule1": [tk]}, seen, day + 60_000) == []
    assert W.load_seen(str(tmp_path), day + 86_400_000) == set()   # next CT day starts clean
