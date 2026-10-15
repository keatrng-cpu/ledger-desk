#!/usr/bin/env python3
"""Nightly trade charts + shadow learning report on the VPS (~18:05 ET weekdays, after archive + backtest).

$0 / no paid data: this job makes NO Databento (or any network) call — the unit runs with PrivateNetwork=yes. Bars come
only from the archive's day files, which ops/vps/archive.py pulled through dbhist.pull() (metadata.get_cost checked
first, CostAbort if > $0). As a second guard, the archive dir is used only if the last archive.log record reports
cost_usd == 0; otherwise bars fall back to nothing and trades are skipped (sidecars say data_ok=false)."""
import json, os, sys
HERE = os.path.dirname(os.path.abspath(__file__))
ARCH_LOG = os.environ.get("ARCHIVE_LOG", "/var/log/ledger-ops/archive.log")

def archive_cost_ok(path=ARCH_LOG):
    """True only when the newest archive.log record has cost_usd exactly 0 (missing log/field -> False)."""
    try:
        last = None
        with open(path) as f:
            for line in f:
                if line.strip().startswith("{"): last = line
        rec = json.loads(last) if last else {}
        return "cost_usd" in rec and float(rec["cost_usd"]) == 0.0
    except Exception:
        return False

def main(argv=None):
    sys.path.insert(0, os.environ.get("TC_SRC", os.path.join(HERE, "charts")))
    os.environ.setdefault("TC_OUT", "/var/lib/ledger-charts"); os.environ.setdefault("TC_VPS_PAPER_EVENTS", "/var/lib/ledger-paper/events.jsonl")
    for k in ("TC_WATCHER_DIR", "TC_PAPER_FUTURES_CSV", "TC_PAPER_TREND_EVENTS", "TC_PROTO_DIR", "TC_GLBX_DIRS", "TC_TICK_DIRS", "TC_EXTRA_BAR_DIRS"):
        os.environ.setdefault(k, "/nonexistent")          # box-only inputs: absent on the VPS
    os.environ["TC_ARCHIVE_DIRS"] = os.environ.get("ARCHIVE_DIR", "/var/lib/ledger-archive") if archive_cost_ok() else "/nonexistent"
    from trade_charts import cli
    return cli.main(list(argv if argv is not None else sys.argv[1:]) or ["nightly"])

if __name__ == "__main__": sys.exit(main())
