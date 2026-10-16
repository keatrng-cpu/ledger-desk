# Connectors (10-16): Slack alerts, Sentry, Supabase trade-log audit

Side channels only. Nothing here changes `shared/desk-rules.json` (RULES_HASH stays `a4bfcb65c88badcd`), the
fire / gate / order logic, or the live watcher process. Every connector is a **no-op until its env var is set**.

## Env vars Keaton sets

| Var | Where | Effect when unset |
| --- | --- | --- |
| `SLACK_DESK_WEBHOOK_URL` | Netlify → Site configuration → Environment variables (Functions scope) **and** the watcher's env file read by `desk-watcher.service` / `run.sh` | no Slack posts |
| `SENTRY_DSN` | same two places (a separate Sentry project per side is fine: one Node, one Python) | no Sentry, `@sentry/node` / `sentry-sdk` never loaded |

The Slack value is an Incoming Webhook URL (Slack app → Incoming Webhooks → channel e.g. `#desk-alerts`).

## Desk (Netlify functions)
- `src/lib/notify/desk-alert.ts` — shared notifier: event types, formatting, dedupe (10 min per event key), rate limit (6 / min / instance, overflow counted), scrub.
- `src/lib/notify/scrub.ts` — redacts secret-named env values, RH/Databento/Supabase/Slack keys, JWTs, bearer tokens, DB URLs, account numbers.
- `src/lib/notify/sentry.ts` — `initSentry` / `captureError`, `beforeSend` scrub, no PII, no tracing.
- `src/lib/notify/preopen.ts` + `netlify/functions/desk-preopen.mjs` — 08:20 CT pre-open check (cron 13:20 and 14:20 UTC, DST-gated): watcher heartbeat fresh and `rules_hash` == desk RULES_HASH → PASS/FAIL, plus `watcher_down` / `rules_hash_mismatch` events. Reads only the public `/api/desk/watcher` feed.
- `netlify/functions/room-step.mjs` — failures now go to Sentry (CRON_SECRET handling untouched).

## Watcher (patch, NOT applied live)
`docs/connectors-1016/watcher-notify.patch` adds `watcher/notify.py` (Python twin of desk-alert), `watcher/monitoring.py` (sentry-sdk),
`tests/test_notify.py`, pins `sentry-sdk==2.72.0` in `requirements.lock`, and three hooks in `daemon.py`: `log()` forwards each record to
`notify.on_record` (thread, never raises), `run()` captures step errors, `main()` inits Sentry. Events: card FIRE / ARM (grade, side, entry/stop/T1),
FILLED, order rejected (`fire_blocked` / `manage_blocked`), daily stop (`day_loss`) and weekly lock (`weekly_lock`) refusals, rules-hash mismatch,
Rule1 shadow (`rule1_would_fire`), daemon stop.

Apply at a flat window (no position), after a STOP:
```
cd /workspace/desk-watcher && patch -p1 --dry-run < <repo>/docs/connectors-1016/watcher-notify.patch && patch -p1 < ...
.venv/bin/pip install -r requirements.lock && .venv/bin/python -m pytest -q -o testpaths=tests
```

## Supabase audit
`npx tsx scripts/audit/trade-log-audit.mts --watcher-dir /workspace/desk-watcher [--supabase-json export.json] --out report.md`
Read-only (`BEGIN READ ONLY`, SELECTs only) on `desk_card_journal`, `desk_trades`, `room_orders`, `desk_watcher_status`. Exit 2 when gaps exist.

### Review fixes (Accuracy Review on #32)
- Slack POST and the pre-open feed fetch carry `AbortSignal.timeout(5000)`; the watcher uses `requests` `timeout=5`.
- Dedupe keys are recorded only after Slack returns 2xx (an in-flight set stops concurrent duplicates), so a failed or timed-out post is retried.
- The audit matches fills by signal / RH order id first, then by ET day + symbol (ES→SPY, MNQ→QQQ) + side + entry. A fallback match is reported as WARN, not GAP.
- `@sentry/node` is marked external in `netlify.toml`. esbuild size of room-step is 4.8 KB external vs 2.2 MB inlined.
- Audit DB TLS is verified by default. Supabase certs chain to Supabase's own root CA, so pass `--ca prod-ca-2021.crt` or `SUPABASE_CA_CERT` (Dashboard → Database → SSL Configuration). `--insecure-tls` is an explicit, labelled opt-out.
