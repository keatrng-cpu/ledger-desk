#!/usr/bin/env bash
# Review 2026-10-15 #7: reboot-safe start for the paper loop. Idempotent: supervise.sh holds .sup.lock, so if a
# supervisor is already running this is a no-op (no second loop, the running process is untouched). Honors STOP.
DIR="${PAPER_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$DIR" || exit 1
[ -f STOP ] && { echo "$(date -Is) boot: STOP present, not starting" >> supervisor.log; exit 0; }
if ! flock -n .sup.lock true; then exit 0; fi          # a supervisor already owns the lock
echo "$(date -Is) boot: starting supervisor" >> supervisor.log
setsid ./supervise.sh </dev/null >/dev/null 2>&1 &
