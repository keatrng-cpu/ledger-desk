"""Shared helpers for ledger-desk VPS ops services. Never logs secrets."""
import datetime as D, json, os
from zoneinfo import ZoneInfo
ET = ZoneInfo("America/New_York"); CT = ZoneInfo("America/Chicago"); UTC = D.timezone.utc

def load_env(path="/opt/ledger-gateway/.env"):
    """Fill os.environ from the gateway .env (systemd EnvironmentFile normally does this)."""
    try:
        for line in open(path):
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1); os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))
    except OSError:
        pass

def rth_et(now):
    """True during 09:30-16:00 ET on weekdays."""
    n = now.astimezone(ET)
    return n.weekday() < 5 and D.time(9, 30) <= n.time() < D.time(16, 0)

def globex_open(now, tz=CT):
    """CME Globex equity futures: Sun 17:00 - Fri 16:00, daily halt 16:00-17:00 (CME clock is CT;
    the gateway's own copy uses the same hours on the ET clock, so callers check both)."""
    n = now.astimezone(tz); wd = n.weekday(); t = n.time()
    if wd == 5: return False
    if wd == 6: return t >= D.time(17)
    if wd == 4 and t >= D.time(16): return False
    return not (D.time(16) <= t < D.time(17))

def jlog(path, **kw):
    kw.setdefault("ts", D.datetime.now(UTC).isoformat(timespec="seconds"))
    with open(path, "a") as f: f.write(json.dumps(kw, default=str) + "\n")
