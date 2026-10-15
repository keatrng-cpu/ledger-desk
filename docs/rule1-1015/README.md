# Rule 1 — shadow ticket (open30 key sweep)

**Mode: SHADOW.** Rule 1 builds a ticket and logs it beside the desk plan. It never fires live orders.

- **Config:** `shared/rule1.json`. Kept out of `shared/desk-rules.json`, so **RULES_HASH is unchanged (`a4bfcb65c88badcd`, main after #24)**. A test asserts this.
- **Engine:** `src/lib/trading/rule1.ts`, which builds `desk.rule1[]`. It is carried on the wire and in `MasterInput.rule1` (read-only for brain/Floor). `scripts/rule1.py` is the Python mirror.
- **Daily report and shadow ledger:**
  ```
  python3 scripts/rule1.py replay --bars <1m bars json> --day YYYY-MM-DD --cards <desk cards jsonl> --ledger rule1-ledger.jsonl --out report.md
  ```
  See `report-2026-10-13.md` for an example.
- **Watcher:** `watcher.patch` adds `watcher/rule1_shadow.py`. That module logs `rule1_would_fire` rows to `rule1_shadow.jsonl` (broker False, orders 0). The dedupe survives restarts: on the first poll the daemon seeds it from today's (CT) rows in that file (`load_seen`). The patch is NOT applied to the live watcher. Apply it manually with `git apply docs/rule1-1015/watcher.patch` after review.

## Follow-up: load_seen hardening
`watcher-load-seen.patch` applies on top of the live watcher after #29 (`watcher.patch` is already live; do not re-apply it). load_seen opens the log with `errors="replace"` and catches `(OSError, ValueError)`; tests cover undecodable bytes and a reader ValueError. Rules hash unchanged (a4bfcb65c88badcd).
