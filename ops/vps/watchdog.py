#!/usr/bin/env python3
"""ledger-desk VPS watchdog (oneshot, systemd timer every 60s).
Checks: box watcher heartbeat (via Supabase ops_heartbeats), paper lanes (box + VPS), desk API, gateway tick lag /
1m bar gaps, VPS disk + memory pressure. Alert channel: Supabase ops_alerts (one row per incident; recovery closes it),
plus /var/log/ledger-ops/alerts.log and a cheap poll file /var/lib/ledger-watchdog/status.json.
Sends no email / chat. Read-only against ledger-gateway.service."""
import datetime as D, json, os, shutil, subprocess, sys, time, urllib.request as R
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import ET, CT, UTC, rth_et, globex_open, jlog, load_env

LOG_DIR = os.environ.get("OPS_LOG_DIR", "/var/log/ledger-ops"); STATE_DIR = os.environ.get("WATCHDOG_STATE", "/var/lib/ledger-watchdog")
CARD = os.environ.get("CARD_URL", "https://ledgeyourtrades.netlify.app/api/desk/card")
PAPER_DIR = os.environ.get("PAPER_DIR", "/var/lib/ledger-paper")
T = dict(hb_stale_s=180, paper_stale_s=180, tick_lag_s=30, bar_gap_window_min=15, disk_pct=80, mem_avail_mb=80, psi_some_avg60=20.0, card_every_s=300)

def _age(iso, now):
    if not iso: return None
    try: return (now - D.datetime.fromisoformat(str(iso)).astimezone(UTC)).total_seconds()
    except ValueError: return None

def missing_minutes(bar_times, start, end):
    """Whole UTC minutes in [start,end) with no bar."""
    have = {b.astimezone(UTC).replace(second=0, microsecond=0) for b in bar_times}
    m, out = start.replace(second=0, microsecond=0), []
    while m < end:
        if m not in have: out.append(m)
        m += D.timedelta(minutes=1)
    return out

def evaluate(now, hb, gw, host, card, paper_vps):
    """Pure: returns {alert_key: (severity, message, detail)} for every condition currently FIRING."""
    f = {}; rth = rth_et(now)
    if rth:
        age = _age(hb.get("updated_at") if hb else None, now)
        if age is None or age > T["hb_stale_s"]:
            f["box_heartbeat_stale"] = ("crit", f"box heartbeat stale ({'never' if age is None else int(age)}s)", {"age_s": age})
        else:
            p = hb["payload"]
            if not p.get("watcher_alive"): f["watcher_dead"] = ("crit", "desk-watcher pid not alive on box", {"pid": p.get("watcher_pid")})
            la = _age(p.get("watcher_log_mtime"), now)
            if la is None or la > T["hb_stale_s"]: f["watcher_log_stale"] = ("crit", f"watcher.log not written for {la and int(la)}s", {"age_s": la})
            if not p.get("paper_pid"): f["paper_box_down"] = ("warn", "box paper-trend lane not running", {})
            # trend lane only acts 08:30-15:00 CT and polls every 30s; state.json is rewritten each poll
            n_ct = now.astimezone(CT)
            if D.time(8, 30) <= n_ct.time() < D.time(15):
                sa = _age(p.get("paper_state_mtime"), now)
                if sa is None or sa > T["paper_stale_s"]: f["paper_box_stale"] = ("warn", f"box paper lane state not updated for {sa and int(sa)}s", {"age_s": sa})
            c = p.get("card") or {}
            if c and not c.get("ok"): f["desk_api_box"] = ("warn", "desk card fetch failing from box", {"err": c.get("err"), "http": c.get("http")})
    if paper_vps is not None:
        if not paper_vps.get("active"): f["paper_vps_down"] = ("warn", "VPS paper-trend service not active", paper_vps)
        elif rth and D.time(8, 30) <= now.astimezone(CT).time() < D.time(15):
            a = paper_vps.get("state_age_s")
            if a is None or a > T["paper_stale_s"]: f["paper_vps_stale"] = ("warn", f"VPS paper lane state stale {a and int(a)}s", paper_vps)
    if card is not None and not card.get("ok"): f["desk_api_vps"] = ("warn", "desk card API failing from VPS", card)
    if gw.get("db_error"): f["gateway_db"] = ("crit", "cannot read gateway tables", {"err": gw["db_error"]})
    if gw.get("service") != "active": f["gateway_service"] = ("crit", f"ledger-gateway.service is {gw.get('service')}", {})
    if globex_open(now) and globex_open(now, ET):   # open by CME clock AND the gateway's ET clock
        for s, lag in (gw.get("tick_lag_s") or {}).items():
            if lag > T["tick_lag_s"]: f[f"tick_lag_{s}"] = ("crit", f"{s} tick lag {lag:.0f}s > {T['tick_lag_s']}s", {"lag_s": lag})
        if not gw.get("tick_lag_s") and not gw.get("db_error"): f["tick_missing"] = ("crit", "no databento_live tick rows", {})
    if rth:   # thin overnight minutes legitimately print no bar, so gaps are checked in RTH only
        for s, miss in (gw.get("missing") or {}).items():
            if miss: f[f"bar_gap_{s}"] = ("warn", f"{s} missing {len(miss)} 1m bars in last {T['bar_gap_window_min']}m", {"missing": [m.isoformat() for m in miss][:20]})
    if host["disk_pct"] > T["disk_pct"]: f["vps_disk"] = ("crit", f"VPS disk {host['disk_pct']:.0f}% > {T['disk_pct']}%", host)
    if host["mem_avail_mb"] < T["mem_avail_mb"] or host.get("psi_some_avg60", 0) > T["psi_some_avg60"]:
        f["vps_memory"] = ("warn", f"VPS memory pressure (avail {host['mem_avail_mb']}MB, psi60 {host.get('psi_some_avg60')})", host)
    if os.path.exists(os.path.join(STATE_DIR, "TEST_ALERT")): f["test_alert"] = ("info", "synthetic test alert (touch/remove TEST_ALERT)", {})
    return f

# ---------- collectors ----------
def host_stats():
    du = shutil.disk_usage("/"); mi = {l.split(":")[0]: int(l.split()[1]) for l in open("/proc/meminfo")}
    psi = 0.0
    try: psi = float(open("/proc/pressure/memory").readline().split()[2].split("=")[1])
    except Exception: pass
    return dict(disk_pct=round(100 * du.used / du.total, 1), disk_used_gb=round(du.used / 2**30, 2), mem_avail_mb=mi["MemAvailable"] // 1024,
                swap_used_mb=(mi["SwapTotal"] - mi["SwapFree"]) // 1024, psi_some_avg60=psi, load1=os.getloadavg()[0])

def unit_active(u):
    return subprocess.run(["systemctl", "is-active", u], capture_output=True, text=True).stdout.strip()

def gateway(c, now):
    g = {"service": unit_active("ledger-gateway")}
    try:
        g["tick_lag_s"] = {s: float(l) for s, l in c.execute("select symbol, extract(epoch from now()-received_at) from live_market_ticks where source='databento_live'")}
        end = now.replace(second=0, microsecond=0) - D.timedelta(minutes=1); start = end - D.timedelta(minutes=T["bar_gap_window_min"])
        rows = c.execute("select symbol, bar_time from live_market_bars_1m where bar_time>=%s and bar_time<%s", (start, end)).fetchall()
        g["missing"] = {s: missing_minutes([b for x, b in rows if x == s], start, end) for s in g["tick_lag_s"]}
    except Exception as e: g["db_error"] = repr(e)[:200]
    return g

def card_check():
    t0 = time.time()
    try:
        r = R.urlopen(R.Request(CARD, headers={"User-Agent": "ledger-vps-watchdog"}), timeout=25); d = json.loads(r.read())
        return dict(ok=bool(d.get("ok", True)), http=r.status, ms=int((time.time() - t0) * 1000))
    except Exception as e: return dict(ok=False, err=repr(e)[:160])

def paper_vps_status(now):
    st = os.path.join(PAPER_DIR, "state.json")
    a = (now.timestamp() - os.path.getmtime(st)) if os.path.exists(st) else None
    return dict(active=unit_active("ledger-paper-trend") == "active", state_age_s=a)

# ---------- incident bookkeeping ----------
def reconcile(c, firing, now):
    """Open new incidents, refresh open ones, resolve cleared ones. Unique partial index = once per incident."""
    opened, resolved = [], []
    open_rows = dict(c.execute("select alert_key, id from ops_alerts where state='open'").fetchall())
    for k, (sev, msg, det) in firing.items():
        if k in open_rows: c.execute("update ops_alerts set last_seen_at=now(), message=%s where id=%s", (msg, open_rows[k]))
        else:
            c.execute("insert into ops_alerts(alert_key,severity,message,detail) values (%s,%s,%s,%s::jsonb) on conflict do nothing",
                      (k, sev, msg, json.dumps(det, default=str))); opened.append((k, sev, msg))
    for k, i in open_rows.items():
        if k not in firing:
            c.execute("update ops_alerts set state='resolved', resolved_at=now(), notified_resolved=true where id=%s", (i,)); resolved.append(k)
    return opened, resolved

def main():
    load_env(); import psycopg
    now = D.datetime.now(UTC); os.makedirs(LOG_DIR, exist_ok=True); os.makedirs(STATE_DIR, exist_ok=True)
    cache = os.path.join(STATE_DIR, "card.json"); card = None
    try: card = json.load(open(cache))
    except Exception: pass
    if not card or now.timestamp() - card.get("_t", 0) > T["card_every_s"]:
        card = card_check() | {"_t": now.timestamp()}; json.dump(card, open(cache, "w"))
    host = host_stats()
    with psycopg.connect(os.environ["DATABASE_URL"], connect_timeout=15, autocommit=True) as c:
        r = c.execute("select payload, updated_at from ops_heartbeats where source='box'").fetchone()
        hb = {"payload": r[0], "updated_at": r[1].isoformat()} if r else None
        gw = gateway(c, now)
        firing = evaluate(now, hb, gw, host, {k: v for k, v in card.items() if k != "_t"}, paper_vps_status(now))
        opened, resolved = reconcile(c, firing, now)
        c.execute("insert into ops_heartbeats(source,payload,updated_at) values ('vps_watchdog',%s::jsonb,now()) on conflict (source) do update set payload=excluded.payload, updated_at=now()",
                  (json.dumps({"firing": sorted(firing), "host": host}, default=str),))
    for k, sev, msg in opened: jlog(os.path.join(LOG_DIR, "alerts.log"), event="OPEN", key=k, severity=sev, message=msg); print(f"ALERT OPEN {k}: {msg}")
    for k in resolved: jlog(os.path.join(LOG_DIR, "alerts.log"), event="RESOLVED", key=k); print(f"ALERT RESOLVED {k}")
    status = dict(ts=now.isoformat(timespec="seconds"), ok=not firing, firing={k: v[1] for k, v in firing.items()}, host=host,
                  hb_age_s=_age(hb and hb["updated_at"], now), tick_lag_s=gw.get("tick_lag_s"))
    tmp = os.path.join(STATE_DIR, "status.json.tmp"); json.dump(status, open(tmp, "w"), default=str); os.replace(tmp, os.path.join(STATE_DIR, "status.json"))
    print(json.dumps({"ok": status["ok"], "firing": sorted(firing), "disk_pct": host["disk_pct"], "mem_avail_mb": host["mem_avail_mb"]}))

if __name__ == "__main__": main()
