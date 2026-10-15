# Rule 1 — shadow ticket (open30 key sweep)

**Mode: SHADOW.** Rule 1 builds a ticket and logs it beside the desk plan. It never fires live orders.

- **Config:** `shared/rule1.json`. Kept out of `shared/desk-rules.json`, so **RULES_HASH is unchanged (`ca0d07e10a5d85d4`)**. A test asserts this.
- **Engine:** `src/lib/trading/rule1.ts`, which builds `desk.rule1[]`. It is carried on the wire and in `MasterInput.rule1` (read-only for brain/Floor). `scripts/rule1.py` is the Python mirror.
- **Daily report and shadow ledger:**
  ```
  python3 scripts/rule1.py replay --bars <1m bars json> --day YYYY-MM-DD --cards <desk cards jsonl> --ledger rule1-ledger.jsonl --out report.md
  ```
  See `report-2026-10-13.md` for an example.
- **Watcher:** `watcher.patch` adds `watcher/rule1_shadow.py`. That module logs `rule1_would_fire` rows to `rule1_shadow.jsonl` (broker False, orders 0). The patch is NOT applied to the live watcher. Apply it manually with `git apply docs/rule1-1015/watcher.patch` after review.
