#!/bin/bash
# Install / update the ledger-desk ops services on the VPS. Idempotent. Run as root from a checkout of ops/vps:
#   sudo ./install.sh            (add --no-start to install without enabling)
# Never touches ledger-gateway.service or its .env (read only via EnvironmentFile, by PID 1).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"; DST=/opt/ledger-ops; PY=/opt/ledger-gateway/venv/bin/python
[ "$(id -u)" = 0 ] || { echo "run as root"; exit 1; }
[ -x "$PY" ] || { echo "missing $PY (gateway venv)"; exit 1; }
id ledgerops >/dev/null 2>&1 || useradd --system --home /nonexistent --shell /usr/sbin/nologin ledgerops
install -d -o root -g root -m 755 "$DST" "$DST/paper" "$DST/venv"   # venv = bind-mount point
install -m 644 "$SRC"/common.py "$SRC"/watchdog.py "$SRC"/dbhist.py "$SRC"/archive.py "$SRC"/backtest.py "$DST"/
install -m 644 "$SRC"/paper/trend_paper.py "$SRC"/paper/vps_trend.py "$SRC"/paper/fastpath.py "$DST/paper/"
for d in /var/lib/ledger-watchdog /var/lib/ledger-paper /var/lib/ledger-backtest /var/lib/ledger-archive /var/lib/ledger-archive/hist /var/log/ledger-ops; do
  install -d -o ledgerops -g ledgerops -m 750 "$d"; done
install -m 644 "$SRC"/systemd/tmpfiles-ledger.conf /etc/tmpfiles.d/ledger-ops.conf && systemd-tmpfiles --create /etc/tmpfiles.d/ledger-ops.conf
# schema (idempotent)
set -a; . /opt/ledger-gateway/.env; set +a
"$PY" -c "import os,psycopg;c=psycopg.connect(os.environ['DATABASE_URL'],autocommit=True);c.execute(open('$SRC/sql/001_ops_monitoring.sql').read());print('schema ok')"
unset DATABENTO_API_KEY DATABASE_URL
# caps, logs
install -d /etc/systemd/journald.conf.d && install -m 644 "$SRC"/systemd/journald-ledger.conf /etc/systemd/journald.conf.d/ledger.conf
systemctl restart systemd-journald
install -m 644 "$SRC"/systemd/logrotate-ledger /etc/logrotate.d/ledger-ops
# swap: add 1 GB only when the host has none
if [ -z "$(swapon --show --noheadings)" ]; then
  fallocate -l 1G /swapfile-ledger && chmod 600 /swapfile-ledger && mkswap /swapfile-ledger && swapon /swapfile-ledger
  grep -q swapfile-ledger /etc/fstab || echo '/swapfile-ledger none swap sw 0 0' >> /etc/fstab
else echo "swap present: $(swapon --show --noheadings | tr -s ' ')"; fi
for u in ledger-watchdog.service ledger-watchdog.timer ledger-paper-trend.service ledger-backtest.service ledger-backtest.timer ledger-archive.service ledger-archive.timer; do
  install -m 644 "$SRC/systemd/$u" /etc/systemd/system/; done
systemctl daemon-reload
if [ "${1:-}" != "--no-start" ]; then
  systemctl enable --now ledger-watchdog.timer ledger-backtest.timer ledger-archive.timer
  systemctl enable ledger-paper-trend.service && systemctl restart ledger-paper-trend.service
fi
systemctl --no-pager list-timers 'ledger-*'
