#!/usr/bin/env bash
# Runs against a TEMP copy with a fake supervisor; never touches the live dir.
set -e; T=$(mktemp -d); trap 'kill $(cat "$T/starts" 2>/dev/null) 2>/dev/null || true; rm -rf "$T"' EXIT
printf '#!/usr/bin/env bash\ncd "$(dirname "$0")"; exec 9>.sup.lock; flock -n 9 || exit 0; echo $$ >> starts; sleep 30\n' > "$T/supervise.sh"; chmod +x "$T/supervise.sh"
B="$(cd "$(dirname "$0")" && pwd)/start-on-boot.sh"
PAPER_DIR=$T "$B"; sleep 1; PAPER_DIR=$T "$B"; sleep 1
[ "$(wc -l < "$T/starts")" = 1 ] || { echo "FAIL: second boot started another supervisor"; exit 1; }
kill "$(cat "$T/starts")"; sleep 1; touch "$T/STOP"; PAPER_DIR=$T "$B"; sleep 1
[ "$(wc -l < "$T/starts")" = 1 ] || { echo "FAIL: STOP ignored"; exit 1; }
echo "boot tests: 2 passed"
