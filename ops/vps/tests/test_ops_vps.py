import datetime as D, json, os, sys, types
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import pytest, common, watchdog, dbhist, archive
UTC = D.timezone.utc
RTH = D.datetime(2026, 10, 15, 15, 0, tzinfo=UTC)      # Thu 11:00 ET / 10:00 CT
NIGHT = D.datetime(2026, 10, 17, 15, 0, tzinfo=UTC)    # Saturday

def host(**k): return dict(disk_pct=32, mem_avail_mb=500, psi_some_avg60=0.0) | k
def hb(age=10, **p):
    t = (RTH - D.timedelta(seconds=age)).isoformat()
    return {"updated_at": t, "payload": dict(watcher_alive=True, watcher_log_mtime=t, watcher_status_mtime=t, paper_pid=1, paper_state_mtime=t, card={"ok": True}) | p}
GW = {"service": "active", "tick_lag_s": {"ES": 1.0, "NQ": 1.0}, "missing": {"ES": [], "NQ": []}}

def ev(now=RTH, h=None, gw=GW, hs=None, card=None, pv=None):
    return watchdog.evaluate(now, hb() if h is None else h, gw, hs or host(), card or {"ok": True}, pv or {"active": True, "state_age_s": 5})

def test_all_green(): assert ev() == {}
def test_heartbeat_stale_only_in_rth():
    assert "box_heartbeat_stale" in ev(h=hb(age=200))
    assert "box_heartbeat_stale" not in watchdog.evaluate(NIGHT, hb(age=99999), GW, host(), {"ok": True}, {"active": True})
def test_missing_heartbeat(): assert "box_heartbeat_stale" in watchdog.evaluate(RTH, None, GW, host(), {"ok": True}, None)
def test_watcher_dead(): assert "watcher_dead" in ev(h=hb(watcher_alive=False))
def test_tick_lag(): assert "tick_lag_NQ" in ev(gw=GW | {"tick_lag_s": {"ES": 1.0, "NQ": 31.0}})
def test_tick_lag_ignored_when_closed(): assert not watchdog.evaluate(NIGHT, None, GW | {"tick_lag_s": {"NQ": 999.0}}, host(), {"ok": True}, None)
def test_bar_gap(): assert "bar_gap_ES" in ev(gw=GW | {"missing": {"ES": [RTH], "NQ": []}})
def test_disk_mem():
    f = ev(hs=host(disk_pct=81, mem_avail_mb=50)); assert "vps_disk" in f and "vps_memory" in f
def test_desk_api(): assert "desk_api_vps" in ev(card={"ok": False, "err": "x"})
def test_paper_vps_down(): assert "paper_vps_down" in ev(pv={"active": False})
def test_missing_minutes():
    s = RTH; bars = [s, s + D.timedelta(minutes=2)]
    assert watchdog.missing_minutes(bars, s, s + D.timedelta(minutes=3)) == [s + D.timedelta(minutes=1)]
def test_globex():
    assert common.globex_open(RTH) and not common.globex_open(NIGHT)
    assert not common.globex_open(D.datetime(2026, 10, 15, 21, 30, tzinfo=UTC))   # 16:30 CT halt
def test_cost_guard_blocks_billed_datasets():
    for ds, sc in [("DBEQ.BASIC", "ohlcv-1m"), ("OPRA.PILLAR", "ohlcv-1m"), ("GLBX.MDP3", "mbo")]:
        with pytest.raises(dbhist.CostAbort): dbhist.guard(ds, sc)
def test_cost_abort_before_download():
    got = []
    cl = types.SimpleNamespace(metadata=types.SimpleNamespace(get_cost=lambda **k: 0.01), timeseries=types.SimpleNamespace(get_range=lambda **k: got.append(1)))
    with pytest.raises(dbhist.CostAbort): dbhist.pull(cl, ["NQ.v.0"], "a", "b")
    assert got == []
def test_reconcile_dedupes():
    class C:
        def __init__(s, ins): s.open = {"vps_disk": 1, "old": 2}; s.ins = ins
        def execute(s, q, a=None):
            return types.SimpleNamespace(fetchall=lambda: list(s.open.items()), fetchone=lambda: s.ins)
    o, r = watchdog.reconcile(C((7,)), {"vps_disk": ("crit", "m", {}), "new": ("warn", "n", {})}, RTH)
    assert [x[0] for x in o] == ["new"] and r == ["old"]
    o, _ = watchdog.reconcile(C(None), {"new": ("warn", "n", {})}, RTH)   # insert lost the race (conflict): not a new incident
    assert o == []

def test_watcher_status_stale_not_log():
    t_old = (RTH - D.timedelta(seconds=400)).isoformat()
    assert "watcher_status_stale" not in ev(h=hb(watcher_log_mtime=t_old))   # quiet log alone is fine
    assert "watcher_status_stale" in ev(h=hb(watcher_status_mtime=t_old))

def test_units_start_limits_and_timers():
    sd = os.path.join(os.path.dirname(__file__), "..", "systemd"); rd = lambda n: open(os.path.join(sd, n)).read()
    assert "StartLimitIntervalSec=600" in rd("ledger-paper-trend.service") and "StartLimitBurst=5" in rd("ledger-paper-trend.service")
    assert "/opt/ledger-gateway/.env" not in rd("ledger-paper-trend.service") + rd("ledger-watchdog.service") + rd("ledger-backtest.service")
    for t in ("ledger-archive.timer", "ledger-backtest.timer"): assert "Persistent=false" in rd(t)
def test_retention(tmp_path):
    for d in ["2026/10/01", "2026/10/02", "2026/10/03"]:
        p = tmp_path / d; p.mkdir(parents=True); (p / "f").write_bytes(b"x" * 1000)
    rm = archive.enforce_retention(str(tmp_path), 2500)
    assert [os.path.basename(x) for x in rm] == ["01"] and (tmp_path / "2026/10/03").exists()

def test_fastpath_rth_identical():
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "paper"))
    import importlib, trend_paper as tp0, fastpath
    tp = importlib.reload(tp0); CT = common.CT
    bars = [dict(t=D.datetime(2026, 10, 1 + i // 1440, 0, 0, tzinfo=CT) + D.timedelta(minutes=i % 1440), o=1, h=1, l=1, c=1) for i in range(3 * 1440)]
    want = {d: tp.rth(bars, d) for d in {b["t"].date() for b in bars}}
    fastpath.install(tp)
    assert all(tp.rth(bars, d) == v for d, v in want.items())

HERE = os.path.join(os.path.dirname(__file__), "..")
def rd(n): return open(os.path.join(HERE, "systemd", n)).read()

def test_charts_unit_caps_and_no_network():
    s = rd("ledger-charts.service")
    assert "MemoryMax=300M" in s and "PrivateNetwork=yes" in s and ".env" not in s and "flock /run/ledger-ops/batch.lock" in s
    assert "Persistent=false" in rd("ledger-charts.timer")
    assert "IPAddressDeny=any" in s and "\nCapabilityBoundingSet=\n" in s and "MemorySwapMax=0" in s
    assert "OnCalendar=Mon..Fri *-*-* 17:20:00 America/New_York" in rd("ledger-charts.timer")
    src = open(os.path.join(HERE, "charts_nightly.py")).read()
    assert "get_range" not in src and "import databento" not in src

def test_charts_archive_cost_guard(tmp_path):
    import importlib.util
    spec = importlib.util.spec_from_file_location("cn", os.path.join(HERE, "charts_nightly.py")); cn = importlib.util.module_from_spec(spec); spec.loader.exec_module(cn)
    p = tmp_path / "archive.log"
    p.write_text('{"day": "2026-10-14", "cost_usd": 0.0}\n{"day": "2026-10-15", "cost_usd": 0.0}\n'); assert cn.archive_cost_ok(str(p))
    p.write_text('{"day": "2026-10-15", "cost_usd": 0.01}\n'); assert not cn.archive_cost_ok(str(p))
    p.write_text('{"day": "2026-10-15", "error": "x"}\n'); assert not cn.archive_cost_ok(str(p))
    assert not cn.archive_cost_ok(str(tmp_path / "missing.log"))

def test_voids_export_unit_role_and_install():
    s = rd("ledger-voids-export.service"); t = rd("ledger-voids-export.timer")
    assert "OnCalendar=Mon..Fri *-*-* 17:10:00 America/New_York" in t and "Persistent=false" in t
    assert "MemoryMax=100M" in s and "TimeoutStartSec=120" in s and "IPAddressDeny=any" in s and "EnvironmentFile=/etc/ledger-ops/voids.env" in s
    assert "export-learn-voids.mjs /var/lib/ledger-charts/learn-voids.json" in s and ".env\n" not in s.replace("voids.env\n", "")
    allow = [l for l in s.splitlines() if l.startswith("IPAddressAllow=")]; assert allow == ["IPAddressAllow=localhost"]   # DB IPs only via drop-in
    c = rd("ledger-charts.service"); assert "PrivateNetwork=yes" in c and "IPAddressDeny=any" in c          # charts stays isolated
    inst = open(os.path.join(HERE, "install.sh")).read()
    assert "ledger-voids-export.service ledger-voids-export.timer" in inst and "ledger-voids-export.timer" in inst.split("enable --now")[1]
    assert "db-allow.conf" in inst and "IPAddressAllow=" in inst
    sql = open(os.path.join(HERE, "sql", "002_ops_roles.sql")).read()
    assert "create role ledger_ops_voids login noinherit" in sql and "alter role ledger_ops_voids set default_transaction_read_only = on" in sql
    voids_sql = sql[sql.index("ledger_ops_voids"):]
    assert "grant select on desk_learn_annotation to ledger_ops_voids" in voids_sql and "insert" not in voids_sql.lower() and "update" not in voids_sql.lower()
    assert "grant select (id, day_key, symbol, side, entry)" in voids_sql
    mk = open(os.path.join(HERE, "mkroles.py")).read(); assert '"voids": "ledger_ops_voids"' in mk
    assert json.load(open(os.path.join(HERE, "voids", "package.json")))["dependencies"]["pg"] == "8.22.0"
    ex = open(os.path.join(HERE, "..", "..", "scripts", "export-learn-voids.mjs")).read()
    assert "begin transaction read only" in ex and "desk_learn_annotation" in ex and "console.log(url" not in ex
