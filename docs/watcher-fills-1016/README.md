# Watcher fills → Supabase (follow-up to #32)

| Piece | File |
| --- | --- |
| Endpoint | `src/routes/api/desk/fills.ts`: POST, `WATCHER_STATUS_TOKEN` bearer, owner from env `DESK_OWNER_USER_ID`, refuses shadow/dry-run (422) |
| Core | `src/lib/desk/watcher-fills.ts`: room_orders keyed `(user_id, client_order_id = signal)`, status only moves forward (placed → filled/rejected → closed). On `filled` it calls `recordRealFillFor` (desk_trades, underlier terms, opened once). On `exit` it calls `closeTradeFor`. It stamps `desk_card_journal.signal` |
| Journal | `src/lib/journal/server.ts`: the `recordRealFill` / `closeTrade` bodies are extracted unchanged into `recordRealFillFor` / `closeTradeFor(sql, userId, data)`. The server fns call them |
| Migration | `migrations/0027_card_signal.sql`: additive `signal text` + partial index. **Not applied to prod by this PR**; `npm run build` runs `db:migrate` on deploy after merge |
| Watcher | `docs/watcher-fills-1016/watcher-fills.patch` (against the live tree after #32): `watcher/fills_sink.py` builds the payload from records the daemon already logged plus `state.position`, appends to `outbox.jsonl`, and a background thread POSTs (5 s timeout) and retries every 60 s; 2xx/422 are removed. Skipped when `live` or `fire_enabled` is false, or when the record is shadow. Also carries the notify.py `format_event` try/finally fix. |
| Backfill | `scripts/backfill/fill-sig-85e8feddd99efe46.mts`: dry-run by default; `--apply --url` POSTs placed/filled/exit through the endpoint (idempotent). **Not applied.** |

Env: `DESK_OWNER_USER_ID` (Netlify) must be set or the endpoint returns 503. On the watcher, `WATCHER_STATUS_URL` + `WATCHER_STATUS_TOKEN` are already used for status; the fills URL is derived from it (or set `WATCHER_FILLS_URL`).
Known limit: desk_trades rows are in underlier (ES/MNQ) terms, so their pnl is the futures-equivalent. The option premium, contract and option P&L are in room_orders (`filled_avg_px`, `reasons`) and in desk_trades.`why`.
