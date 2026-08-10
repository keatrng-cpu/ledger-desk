# Engine bridge — Trading-Automation → Ledger desk

Python side of the Phase 4 automation bridge. The engine
(<https://github.com/keatrng-cpu/Trading-Automation>) stays the source of truth
for rules and scoring; the desk becomes the monitoring surface and the journal
of record.

Two endpoints, both `POST`, both JSON, both bearer-authenticated.

| Endpoint | Purpose | Writes |
|---|---|---|
| `POST /api/engine/journal` | push journal rows (batched) | `desk_events` (`source='engine'`) |
| `POST /api/engine/heartbeat` | liveness + current mode | `engine_status` (upsert) |

Base URL is the desk origin — `http://localhost:8080` in dev, the Vercel URL
when deployed.

## Auth

```
Authorization: Bearer <token>
Content-Type: application/json
```

`<token>` is the value of the desk's `ENGINE_BRIDGE_TOKEN` environment variable.
Generate one and set it on both sides — never commit it:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

| Situation | Status | Body |
|---|---|---|
| `ENGINE_BRIDGE_TOKEN` unset or blank on the desk | `503` | `{"ok":false,"error":"Bridge unavailable"}` |
| Missing / malformed / wrong bearer token | `401` | `{"ok":false,"error":"Unauthorized"}` |

There is no unauthenticated write path: an unset secret disables the bridge
rather than opening it. The comparison is constant-time over SHA-256 digests, so
neither token length nor a shared prefix leaks through response timing. Error
bodies are deliberately generic — they never say which part of the credential
failed.

### Which user do the rows belong to?

The engine has no browser session, so bridge rows are attributed to
`ENGINE_BRIDGE_USER_ID` (default `dev-user`, the preview user id used across this
repo). Set it to the desk user whose journal should show the engine rows.

## `POST /api/engine/journal`

Body:

```jsonc
{
  "batch_id": "run-2026-08-10T14:00:05Z-0007",  // optional, idempotency key
  "events": [                                    // 1..500 rows
    {
      "ts": "2026-08-10T14:00:05Z",              // ISO-8601, required
      "event": "SKIP",                            // CANDIDATE|SKIP|ENTRY|EXIT|HALT
      "symbol": "MNQ",                            // required
      "confluence": 0.48,                         // optional, 0..1
      "skip_reason": "below confluence floor",    // optional
      "reason": null,                             // optional
      "pnl": null,                                // optional
      "r_multiple": null                          // optional
    }
  ]
}
```

### Field mapping (engine journal vocabulary → desk columns)

| Engine field | `desk_events` column | Notes |
|---|---|---|
| `ts` | `ts` (timestamptz) | normalized to UTC ISO-8601 |
| `event` | `event` | same five-value enum, unchanged |
| `symbol` | `symbol` | |
| `confluence` | `prescore` | the engine's 0–1 confluence score |
| `reason` | `reason` | preferred when present |
| `skip_reason` | `reason` | used only when `reason` is absent |
| `pnl` | `pnl` | |
| `r_multiple` | `r` | |
| — | `source` | always `'engine'` for this endpoint |
| whole row | `payload.raw` | nothing the engine sends is dropped |
| `batch_id` | `payload.batch_id` | provenance, survives independently |

### Responses

| Status | Meaning |
|---|---|
| `201` | rows inserted — `{"ok":true,"inserted":N,"duplicate":false,"batch_id":"…","received":N}` |
| `200` | duplicate `batch_id`, nothing written — `{"ok":true,"inserted":0,"duplicate":true,…}` |
| `400` | invalid JSON or schema violation — `issues[]` names the offending fields |
| `401` / `503` | see Auth |
| `413` | body over 1 MB |
| `500` | `{"ok":false,"error":"Ingest failed"}` (details are logged server-side only) |

### Idempotency semantics

* `batch_id` is optional but **strongly recommended**: it is what makes a retry
  after a network timeout safe.
* The id is claimed with an `insert … on conflict do nothing` on the primary key
  of `engine_ingest_batches`, so two concurrent retries cannot both insert.
* Replay of a known id returns `200` with `duplicate: true` and writes nothing.
* If the event insert fails after the claim, the claim is released so a genuine
  retry of the same id still works.
* **Batches sent without a `batch_id` are never deduplicated** — resending them
  duplicates rows. Use a stable id derived from the run, e.g.
  `f"{run_id}-{cursor}"`, not a random UUID per attempt.
* Batches are capped at **500 events**; larger batches are rejected with `400`.
  Chunk on the engine side.

### curl

```bash
curl -sS -X POST "$DESK_URL/api/engine/journal" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "batch_id": "run-42-0007",
    "events": [
      {"ts":"2026-08-10T14:00:05Z","event":"SKIP","symbol":"MNQ",
       "confluence":0.48,"skip_reason":"below confluence floor"},
      {"ts":"2026-08-10T14:06:00Z","event":"ENTRY","symbol":"ES",
       "confluence":0.71,"reason":"PD array + NY open bias"}
    ]
  }'
```

## `POST /api/engine/heartbeat`

Heartbeats are **not** journal events. The `desk_events.event` enum is the
engine's journal vocabulary — writing a heartbeat as `HALT` would corrupt every
halt count and every metric derived from it. Heartbeats upsert a single
`engine_status` row per user instead.

```jsonc
{
  "mode": "paper",      // live | paper | backtest | idle  (required)
  "symbol": "MNQ",      // optional
  "note": "scan loop ok" // optional, <= 500 chars
}
```

Response `200`:

```json
{"ok":true,"last_seen":"2026-08-10T14:22:23.928Z","mode":"paper",
 "symbol":"MNQ","paper_enabled":false}
```

`paper_enabled` reports whether the **desk-side** paper loop is armed, so the
engine can align its own behaviour without a second endpoint.

Suggested cadence: every 30–60 s. The desk status card shows green under 2
minutes since `last_seen`, amber under 15 minutes, red beyond that (or never).

## Python (requests)

```python
import os
import time
import requests

DESK_URL = os.environ["DESK_URL"]              # e.g. https://ledger-desk.vercel.app
TOKEN = os.environ["ENGINE_BRIDGE_TOKEN"]      # never hardcode: export it
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}
SESSION = requests.Session()


def heartbeat(mode: str, symbol: str | None = None, note: str | None = None) -> dict:
    body = {"mode": mode}
    if symbol:
        body["symbol"] = symbol
    if note:
        body["note"] = note
    r = SESSION.post(f"{DESK_URL}/api/engine/heartbeat", json=body,
                     headers=HEADERS, timeout=10)
    r.raise_for_status()
    return r.json()


def push_journal(rows: list[dict], batch_id: str) -> dict:
    """rows use the engine journal vocabulary; 500 max per call."""
    assert len(rows) <= 500, "chunk to 500 rows per batch"
    for attempt in range(3):
        r = SESSION.post(
            f"{DESK_URL}/api/engine/journal",
            json={"batch_id": batch_id, "events": rows},
            headers=HEADERS,
            timeout=20,
        )
        if r.status_code in (200, 201):
            return r.json()        # duplicate=True means it already landed
        if r.status_code in (400, 401, 413, 503):
            r.raise_for_status()   # not retryable — fix config or payload
        time.sleep(2 ** attempt)   # 5xx / network: retry with the SAME batch_id
    r.raise_for_status()
    return {}


def chunked(rows: list[dict], run_id: str, size: int = 500):
    for i in range(0, len(rows), size):
        yield f"{run_id}-{i // size:04d}", rows[i : i + size]
```

Retry rule: reuse the **same** `batch_id` on every retry of the same rows. A new
id per attempt defeats idempotency and duplicates the journal.

## Unlock ladder (ROADMAP Phase 4)

Live execution is gated behind evidence, in this order — no step may be skipped:

1. **Paper loop on.** Desk-side paper loop armed (`engine_status.paper_enabled`),
   or the engine paper-executes candidates that clear the floor and pushes the
   fills as journal rows. Everything is labelled paper in the data
   (`desk_trades.mode='paper'`, `source='paper'`).
2. **Sample size.** Accumulate **≥ 100 closed paper trades**. Below 100, the
   metrics panel keeps its `statistically weak` badge and no conclusion about
   the 0.50-TEST vs 0.67-calibration floor is admissible.
3. **Positive expectancy.** `computeMetrics()` (`src/lib/aplus/analytics.ts`)
   over that closed paper sample must show positive expectancy R — net of
   commission and slippage, not gross.
4. **Only then** does live execution become a discussion, and it still requires
   an explicit mode switch, broker credentials, and a risk acknowledgement. The
   risk governor (daily 2% / weekly 5% halt, 2 setups per killzone) applies to
   paper exactly as it will to live — if it is not enforced on paper, it is not
   ready for live.

Nothing in this bridge can place a real order. It writes journal rows and a
status row; that is the whole surface.

## Environment (desk side)

| Variable | Default | Meaning |
|---|---|---|
| `ENGINE_BRIDGE_TOKEN` | — (unset ⇒ 503) | shared secret for both endpoints |
| `ENGINE_BRIDGE_USER_ID` | `dev-user` | user id bridge rows are attributed to |

See `.env.example`. `.env` is gitignored; `.env.example` is the only committed
copy and contains placeholders only.
