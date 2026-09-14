"""
One-shot Live smoke test. Connects with the real key, subscribes exactly as
the gateway does (GLBX.MDP3 / ohlcv-1s / continuous ES.c.0 + NQ.c.0), prints
the first N price records, and exits. Writes NOTHING to Postgres.

This is the "verify against the real thing before the first unattended run"
check the gateway's module docstring asks for: it proves (1) the key has a
live CME entitlement, (2) the `for record in client` idiom yields records on
the installed databento version, (3) the symbology map resolves instrument_id
-> "ES"/"NQ", and (4) the ohlcv-1s record exposes open/high/low/close/volume.

Usage (from gateway/):
    python smoke_live.py            # reads 10 records or 60s, whichever first
    python smoke_live.py 25 120     # 25 records / 120s

Works any time Globex is trading (not just the desk window) - it ignores the
09:20-11:00 gate on purpose; that gate is the gateway's job, not this test's.
"""

from __future__ import annotations

import os
import sys
import time
from datetime import datetime, timezone

try:
    import databento as db
except ImportError:
    print('databento not installed - pip install -r requirements.txt', file=sys.stderr)
    raise SystemExit(2)

DATASET = os.environ.get("DATABENTO_DATASET", "GLBX.MDP3")
SYMBOLS = ["ES.c.0", "NQ.c.0"]
SCHEMA = "ohlcv-1s"


def load_env_local() -> None:
    """Load ../gateway/.env.local if present so this runs without run-local.ps1."""
    here = os.path.dirname(os.path.abspath(__file__))
    p = os.path.join(here, ".env.local")
    if not os.path.exists(p):
        return
    with open(p, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def main() -> int:
    load_env_local()
    key = (os.environ.get("DATABENTO_API_KEY") or "").strip()
    if not key:
        print("DATABENTO_API_KEY is not set (put it in gateway/.env.local)", file=sys.stderr)
        return 1
    want = int(sys.argv[1]) if len(sys.argv) > 1 else 10
    budget_s = float(sys.argv[2]) if len(sys.argv) > 2 else 60.0

    print(f"databento {db.__version__} | dataset={DATASET} schema={SCHEMA} symbols={SYMBOLS}")
    print(f"key ...{key[-4:]} | want {want} records within {budget_s:.0f}s | {datetime.now(timezone.utc).isoformat()}")

    client = db.Live(key=key)
    client.subscribe(dataset=DATASET, schema=SCHEMA, stype_in="continuous", symbols=SYMBOLS)
    print("subscribed - waiting for records...")

    t0 = time.monotonic()
    got = 0
    seen_types: dict[str, int] = {}
    unresolved = 0
    for record in client:
        rtype = type(record).__name__
        seen_types[rtype] = seen_types.get(rtype, 0) + 1

        iid = getattr(record, "instrument_id", None)
        sym = client.symbology_map.get(iid) if (hasattr(client, "symbology_map") and iid is not None) else None
        if sym is None and hasattr(client, "symbology"):
            sym = client.symbology.get(iid)  # older attribute name

        close = getattr(record, "pretty_close", None)
        if close is None:
            close = getattr(record, "close", None)
        if close is None:
            # SymbolMappingMsg / SystemMsg / ErrorMsg etc. - show them once, keep going
            if rtype in ("ErrorMsg", "SystemMsg") or seen_types[rtype] == 1:
                msg = getattr(record, "msg", None) or getattr(record, "err", None) or ""
                print(f"  [{rtype}] {msg}".rstrip())
            if time.monotonic() - t0 > budget_s:
                break
            continue

        if sym is None:
            unresolved += 1
        ts = getattr(record, "pretty_ts_event", None) or getattr(record, "ts_event", None)
        if hasattr(ts, "isoformat"):
            ts_iso = str(ts)
        else:
            ts_iso = datetime.fromtimestamp(ts / 1e9, tz=timezone.utc).isoformat() if ts else "?"
        o = getattr(record, "pretty_open", record.open)
        h = getattr(record, "pretty_high", record.high)
        l = getattr(record, "pretty_low", record.low)  # noqa: E741
        print(
            f"  {sym or f'iid={iid}'}  {ts_iso}  "
            f"O={float(o):.2f} H={float(h):.2f} L={float(l):.2f} C={float(close):.2f} V={record.volume}"
        )
        got += 1
        if got >= want or time.monotonic() - t0 > budget_s:
            break

    try:
        client.stop()
    except Exception:  # noqa: BLE001
        pass

    print(f"\nrecord types seen: {seen_types}")
    print(f"price records: {got} | unresolved symbols: {unresolved} | elapsed {time.monotonic() - t0:.1f}s")
    if got == 0:
        print("FAIL: no price records. If ErrorMsg above says 'not entitled' the key lacks live CME; "
              "if silent, Globex may be in its daily 17:00-18:00 ET halt.", file=sys.stderr)
        return 3
    if unresolved:
        print("WARN: some records had no symbol mapping - the gateway skips those on purpose; "
              "if ALL are unresolved the symbology attribute name changed in this databento version.", file=sys.stderr)
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
