#!/usr/bin/env python3
"""Box-side heartbeat writer (runs on Keaton's box, NOT the VPS). Every 30s upserts ops_heartbeats(source='box')
via Supabase REST (HTTPS 443 only). Read-only on the watcher / paper lane: it never signals or touches them.
Env: SUPABASE_SERVICE_ROLE_KEY, SUPABASE_URL (or DATABASE_URL to derive project ref)."""
import datetime as D, json, os, sys, time, urllib.parse as u, urllib.request as R
W = os.environ.get("WATCHER_DIR", "/workspace/desk-watcher"); P = os.environ.get("PAPER_DIR", "/workspace/paper-trend")
CARD = os.environ.get("CARD_URL", "https://ledgeyourtrades.netlify.app/api/desk/card")

def base():
    v = os.environ.get("HEARTBEAT_SUPABASE_URL") or os.environ.get("SUPABASE_URL", "")
    if v.startswith("https://") and v.rstrip("/").endswith(".supabase.co"): return v.rstrip("/")
    return "https://%s.supabase.co" % u.urlparse(os.environ["DATABASE_URL"]).username.split(".", 1)[-1]

def pid_alive(pidfile):
    try:
        pid = int(open(pidfile).read().split()[0]); os.kill(pid, 0); return pid, True
    except (OSError, ValueError, IndexError): return None, False

def proc_running(needle):
    for d in os.listdir("/proc"):
        if d.isdigit():
            try:
                if needle in open(f"/proc/{d}/cmdline", "rb").read().replace(b"\0", b" ").decode(errors="ignore"): return int(d)
            except OSError: pass
    return None

def mtime(p):
    try: return D.datetime.fromtimestamp(os.path.getmtime(p), D.timezone.utc).isoformat(timespec="seconds")
    except OSError: return None

def last_event(p):
    try:
        with open(p, "rb") as f:
            f.seek(0, 2); f.seek(max(0, f.tell() - 4096)); line = f.read().splitlines()[-1]
        e = json.loads(line); return e.get("at_ct"), e.get("ev")
    except Exception: return None, None

def card():
    t0 = time.time()
    try:
        r = R.urlopen(R.Request(CARD, headers={"User-Agent": "ledger-box-heartbeat"}), timeout=20); b = r.read()
        d = json.loads(b); return dict(ok=bool(d.get("ok", True)), http=r.status, ms=int((time.time() - t0) * 1000), bytes=len(b), at=d.get("at"))
    except Exception as e: return dict(ok=False, err=repr(e)[:160], ms=int((time.time() - t0) * 1000))

def snapshot(do_card=True):
    pid, alive = pid_alive(os.path.join(W, "run.pid"))
    if not alive:
        pid = proc_running("watcher.daemon"); alive = pid is not None
    ts, ev = last_event(os.path.join(P, "events.jsonl"))
    out = dict(watcher_pid=pid, watcher_alive=alive, watcher_log_mtime=mtime(os.path.join(W, "watcher.log")),
               paper_pid=proc_running("trend_paper.py"), paper_last_event_ts=ts, paper_last_event=ev,
               paper_state_mtime=mtime(os.path.join(P, "state.json")))
    if do_card: out["card"] = card()
    return out

def push(payload):
    k = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    body = json.dumps([dict(source="box", payload=payload, updated_at=D.datetime.now(D.timezone.utc).isoformat())]).encode()
    req = R.Request(base() + "/rest/v1/ops_heartbeats?on_conflict=source", data=body, method="POST", headers={
        "apikey": k, "Authorization": "Bearer " + k, "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates,return=minimal"})
    R.urlopen(req, timeout=20).read()

def main():
    every = int(os.environ.get("HEARTBEAT_EVERY_S", "30")); n = 0
    while True:
        try: push(snapshot(do_card=(n % 2 == 0)) | {"interval_s": every})   # card fetch every 60s (100 KB each)
        except Exception as e: print(D.datetime.now().isoformat(timespec="seconds"), "push failed", repr(e)[:160], flush=True)
        n += 1
        if "--once" in sys.argv: return
        time.sleep(every)

if __name__ == "__main__": main()
