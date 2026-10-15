#!/bin/bash
# Install / update the ledger-desk ops services on the VPS. Idempotent. Run as root from a checkout of ops/vps:
#   sudo ./install.sh            (add --no-start to install without enabling)
# Never touches ledger-gateway.service or its .env (read only via EnvironmentFile, by PID 1, for the archive only).
#
# SIDE EFFECTS OUTSIDE /opt/ledger-ops — read before running:
#   * PROD SUPABASE DDL: applies sql/001_ops_monitoring.sql (ops_heartbeats, ops_alerts, view, RLS) and
#     sql/002_ops_roles.sql (creates/alters login roles ledger_ops_paper + ledger_ops_watchdog, grants, RLS policies)
#     on the database in DATABASE_URL — that is the production project. All statements are idempotent.
#   * Role passwords: generated on first run and written to /etc/ledger-ops/{paper,watchdog}.env (0600 root).
#   * journald: writes /etc/systemd/journald.conf.d/ledger.conf and RESTARTS systemd-journald (only when the file
#     changes). Running services keep logging (journald's fd store keeps their stdout streams).
#   * swap: ONLY if the host has no swap, creates /swapfile-ledger (1 GB) and APPENDS a line to /etc/fstab.
#   * /etc/logrotate.d/ledger-ops, /etc/tmpfiles.d/ledger-ops.conf, system user ledgerops, units in /etc/systemd/system.
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
echo "applying ops DDL to PROD Supabase (001 tables, 002 least-privilege roles)"
"$PY" -c "import os,psycopg;c=psycopg.connect(os.environ['DATABASE_URL'],autocommit=True);c.execute(open('$SRC/sql/001_ops_monitoring.sql').read());print('schema ok')"
"$PY" "$SRC/mkroles.py" "$SRC/sql/002_ops_roles.sql"
unset DATABENTO_API_KEY DATABASE_URL
# caps, logs
install -d /etc/systemd/journald.conf.d
if ! cmp -s "$SRC"/systemd/journald-ledger.conf /etc/systemd/journald.conf.d/ledger.conf; then
  install -m 644 "$SRC"/systemd/journald-ledger.conf /etc/systemd/journald.conf.d/ledger.conf
  echo "journald: SystemMaxUse=200M changed -> restarting systemd-journald"; systemctl restart systemd-journald
fi
install -m 644 "$SRC"/systemd/logrotate-ledger /etc/logrotate.d/ledger-ops
# swap: add 1 GB only when the host has none
if [ -z "$(swapon --show --noheadings)" ]; then
  echo "no swap: creating /swapfile-ledger (1 GB) and appending it to /etc/fstab"
  fallocate -l 1G /swapfile-ledger && chmod 600 /swapfile-ledger && mkswap /swapfile-ledger && swapon /swapfile-ledger
  grep -q swapfile-ledger /etc/fstab || echo '/swapfile-ledger none swap sw 0 0' >> /etc/fstab
else echo "swap present: $(swapon --show --noheadings | tr -s ' ')"; fi
for u in ledger-watchdog.service ledger-watchdog.timer ledger-paper-trend.service ledger-backtest.service ledger-backtest.timer ledger-archive.service ledger-archive.timer; do
  install -m 644 "$SRC/systemd/$u" /etc/systemd/system/; done
systemctl daemon-reload
if [ "${1:-}" != "--no-start" ]; then
  systemctl enable --now ledger-watchdog.timer ledger-backtest.timer ledger-archive.timer
  systemctl enable ledger-paper-trend.service && systemctl reset-failed ledger-paper-trend.service 2>/dev/null; systemctl restart ledger-paper-trend.service
fi
systemctl --no-pager list-timers 'ledger-*'
