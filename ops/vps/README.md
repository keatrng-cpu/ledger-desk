# ops/vps — ledger-gateway VPS ops services

Infra only. No trading rules change, no broker client anywhere. `ledger-gateway.service` is never restarted or modified;
its `.env` (0600) is read only by systemd via `EnvironmentFile=` and its venv is bind-mounted **read-only** into each unit.

| unit | what | caps |
|---|---|---|
| `ledger-watchdog.timer` → `.service` (60s) | box heartbeat / watcher / paper lanes / desk API / gateway tick lag & RTH 1m bar gaps / disk / memory | MemoryMax=64M, CPUQuota=50%, Nice=10 |
| `ledger-paper-trend.service` | backup copy of the box paper-trend lane (`paper/trend_paper.py` verbatim + `vps_trend.py` I/O shim), Restart=always | MemoryMax=200M, CPUQuota=50%, Nice=10 |
| `ledger-archive.timer` (Mon–Fri 17:15 ET) | GLBX.MDP3 ohlcv-1m ES/NQ/MNQ (get_cost must be $0 or abort) + live bars + desk card → `/var/lib/ledger-archive/YYYY/MM/DD/`; 60d NQ history cache in `hist/`; retention 3 GB | MemoryMax=200M, CPUQuota=50%, flock |
| `ledger-backtest.timer` (Mon–Fri 17:45 ET) | replays `trend_paper.step()` over the last 20 days of the cache → `/var/lib/ledger-backtest/latest.json` | MemoryMax=300M, CPUQuota=50%, flock |

Batch jobs share `/run/ledger-ops/batch.lock` (serial). journald `SystemMaxUse=200M`; logrotate for `/var/log/ledger-ops/*.log`.
Swap: 1 GB is added only if the host has none (this host already has a 2.3 GB swapfile).

Data guard: `dbhist.guard()` refuses anything except `GLBX.MDP3` / `ohlcv-1m`, and every pull calls `metadata.get_cost` first and
raises `CostAbort` (nothing downloaded) if the cost is > $0.

`paper/fastpath.py` memoises `trend_paper.rth()` (O(n²) inside `context()`); output is identical (tested) and the rule code is untouched.

## Connectivity / heartbeats
The box can only reach 443 and the VPS can't reach the box, so they meet in Supabase:
* box → `box/box_heartbeat.py` (loop via `box/run_heartbeat.sh`, every 30s; card fetch every 60s) upserts `ops_heartbeats(source='box')` over REST
  with the service_role key: watcher pid alive, watcher.log mtime, paper-trend pid / state mtime / last event, desk card fetch status.
* VPS → `watchdog.py` reads that row over `DATABASE_URL`, plus the gateway tables, the desk card API (every 5 min) and the host.

## Alerts (channel: Supabase `ops_alerts`, no email / chat)
One row per incident (partial unique index on `alert_key where state='open'`); while firing only `last_seen_at` updates; when it
clears the row is set `state='resolved'` + `resolved_at` (the recovery notice). Also appended to `/var/log/ledger-ops/alerts.log`.

Poll cheaply:
```
curl -s "https://<ref>.supabase.co/rest/v1/ops_alerts_open?select=*" -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"   # [] = all clear
curl -s ".../rest/v1/ops_heartbeats?source=eq.vps_watchdog&select=updated_at,payload"     # watchdog's own liveness + firing list
ssh lg cat /var/lib/ledger-watchdog/status.json
```
Tables have RLS on and no policies (anon/authenticated revoked).

Test alert: `touch /var/lib/ledger-watchdog/TEST_ALERT` → `test_alert` opens on the next run; `rm` it → resolves.

## Install
```
tar czf - -C ops vps | ssh lg 'mkdir -p /root/ld-ops-src && tar xzf - -C /root/ld-ops-src && /root/ld-ops-src/vps/install.sh'
# box side
cp ops/vps/box/* /workspace/ops-heartbeat/ && nohup /workspace/ops-heartbeat/run_heartbeat.sh >/dev/null 2>&1 &
```
Tests: `python -m pytest -q -o testpaths=tests ops/vps/tests`
