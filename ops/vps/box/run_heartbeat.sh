#!/bin/bash
# Box has no cron: run as a supervised loop. Start: nohup ops/vps/box/run_heartbeat.sh >/dev/null 2>&1 &   Stop: touch $HOME/.ledger-heartbeat.STOP
cd "$(dirname "$0")"; LOG=${HB_LOG:-/workspace/ops-heartbeat.log}; echo $$ > ${HB_PID:-/workspace/ops-heartbeat.pid}
while [ ! -f "$HOME/.ledger-heartbeat.STOP" ]; do
  python3 box_heartbeat.py >> "$LOG" 2>&1; echo "$(date -Is) heartbeat exited $?, restart in 10s" >> "$LOG"; sleep 10
  [ "$(stat -c%s "$LOG" 2>/dev/null || echo 0)" -gt 5000000 ] && mv -f "$LOG" "$LOG.1"
done
