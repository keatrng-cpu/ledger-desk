# Exit safety — 2026-10-16

**Rev 2 (fix1016 item 10, Accuracy + Release Watch):**
- must-fix: a **resting-stop fill** now books like the ladder's losing exit — `d['lost']=True` (no B+ rest of day) and fireFix.dayLoss
  pnl, via one `_book_close` path; qty/price from the stop ORDER (`Broker.order_fill`: processed qty, processed_premium), fallback
  stop qty / stop-limit price; booked once per order id (both the `_check_resting_stop` filled branch and the "position gone" branch).
- `_check_resting_stop`: a non-refusal cancel error (timeout / RH 5xx) on resize is caught, logged `resting_stop_cancel_error`, alerted; stop left as is.
- a **re-placed** stop at/above the bid is clamped one tick under the bid (`resting_stop_clamped`).
- should-fixes: closes are booked at the **filled qty from the orders** (not the lagged RH position) and the ladder books the
  **VWAP of its rung fills** (`CloseGuard.history` + `fills_vwap`) — the trim PnL undercount (last rung price × qty) is gone.
- Flags unchanged: `EXIT_SAFE` / `EXIT_SAFE_RESTING_STOP` default OFF. Tests: `tests/test_exitsafe.py` 44 (was 34).

Why: a discretionary QQQ put exit ran with LIVE=0 (Broker dry-run refused the sell) while the entry went out live;
a -$30 stop became -$96 as bid slid 1.47 -> 1.14.

All behind `EXIT_SAFE=1` (default OFF); resting broker stop additionally behind `EXIT_SAFE_RESTING_STOP=1` (default OFF).
Params in `shared/exit-safe.json` (NOT desk-rules.json) — **RULES_HASH a4bfcb65c88badcd unchanged**.

0. **Preflight** — runs BEFORE the signal is marked fired / the fast-chain setup is spent, so a refusal never burns the
   setup. Entry refused (gates.log `exit_path_preflight`) unless the exit broker is the same instance, same LIVE flag,
   sell/cancel/order_state/position_qty callable, session valid (account profile read), and `_guard()` passes.
1. **Resting stop** (`EXIT_SAFE_RESTING_STOP`, default OFF) — after fill, stop-limit sell-to-close at the option stop
   (entry×(1-HARD_STOP_LOSS) unless `opt_stop`), limit = stop − max($0.05, 15%). Every manage cycle it is reconciled:
   filled → logged `exit_by_resting_stop`; expired/cancelled/rejected (incl. **gfd expiry at the close**) → re-placed
   unless past flat-by; RH qty changed (later entry fills, partial trims) → cancel-confirm-replace at the new qty.
   Idempotent: a re-entered post-fill branch never replaces or nulls a working stop. A stop that returns **no order id**
   is never re-sent (`resting_stop_blocked`, alert; script stop stays).
2. **Exit ladder** — clears (cancel + confirm terminal) any resting stop first. Limit at bid; **RH position re-read before
   every rung** and each rung sells only the remaining qty; re-price every 2.5 s (cancel→confirm→replace); cross to
   bid−$0.01 at ≥6 s. Hard deadline 20 s monotonic **and** 23 s wall clock; STOP file checked every iteration.
   **Blocks the daemon loop for up to ~20 s (23 s hard cap)** while running. Never raises. Outcomes:
   - `filled` / `filled_not_flat` / `closed_by_stop` (if the stop filled during a trim, reported as **exit**)
   - `timeout`, `error` (working close confirmed gone) → re-protect whole open position (resting stop if enabled, else alert + script stop)
   - `no_order_id` (sell returned no id — it may be live), `stuck_working` (an order won't confirm cancelled),
     `kill_switch` → **no new order of any kind**, alert, manage manually.

**What "no second sell" means:** at most one close order is *working* at any instant, and a new one is only sent after
the previous one is confirmed terminal by RH. Partial fills are expected: a rung may partially fill, be cancelled, and
the next rung sells the *remaining* RH qty — so several orders can each fill part of the position, but their total
never exceeds the position because the size is re-read from RH before each send. The residual race (an order fills
between RH's terminal report and our next position read) cannot oversell because RH rejects closing more than held.

## RH API limits (robin_stocks 3.4.0)
- **No option stop helper.** `order_sell_stop_limit` / `order_sell_stop_loss` are equities-only. `Broker.place_stop_limit_close`
  posts the options-order payload with `trigger: "stop"`, `stop_price`, `type: "limit"` via robin_stocks' `helper.request_post`
  to `option_orders_url()`. **Unverified against RH** — never sent; test once with 1 contract under supervision before enabling.
  On rejection the daemon alerts and the script-watched stop stays active.
- Spreads: resting stop not supported (refused); ladder still applies.
- Ladder re-price is cancel/replace (RH has no replace endpoint in robin_stocks) — a fill can race a cancel; `CloseGuard`
  reads the terminal state and treats `filled` as closed, so no second sell.

## Watcher
`watcher-exit-safety.patch` (not applied) — rebased onto live v5 (includes order-review-quote-refetch-v5-bplus-brain); `git apply --check` clean against a read-only copy of live. Apply in a copy: `git apply docs/exit-safety-1016/watcher-exit-safety.patch`.
