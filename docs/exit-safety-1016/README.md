# Exit safety — 2026-10-16

Why: a discretionary QQQ put exit ran with LIVE=0 (Broker dry-run refused the sell) while the entry went out live;
a -$30 stop became -$96 as bid slid 1.47 -> 1.14.

All behind `EXIT_SAFE=1` (default OFF); resting broker stop additionally behind `EXIT_SAFE_RESTING_STOP=1` (default OFF).
Params in `shared/exit-safe.json` (NOT desk-rules.json) — **RULES_HASH a4bfcb65c88badcd unchanged**.

0. **Preflight** — entry refused (gates.log `exit_path_preflight`) unless the exit broker is the same instance, same LIVE
   flag, sell/cancel/order_state/position_qty callable, session valid (account profile read), and `_guard()` passes.
1. **Resting stop** — after fill, stop-limit sell-to-close at the option stop (entry×(1-HARD_STOP_LOSS) unless `opt_stop`),
   limit = stop − max($0.05, 15%). Cancelled and confirmed terminal by `CloseGuard` before any T1/time/discretionary exit;
   if it already filled, no ladder sell is sent. Trim re-places the stop for the remaining qty.
2. **Exit ladder** — limit at bid, re-price to fresh bid every 2.5 s (cancel→confirm→replace), cross to bid−$0.01 at ≥6 s,
   20 s cap (then cancel + alert), confirm fill and RH position flat.

## RH API limits (robin_stocks 3.4.0)
- **No option stop helper.** `order_sell_stop_limit` / `order_sell_stop_loss` are equities-only. `Broker.place_stop_limit_close`
  posts the options-order payload with `trigger: "stop"`, `stop_price`, `type: "limit"` via robin_stocks' `helper.request_post`
  to `option_orders_url()`. **Unverified against RH** — never sent; test once with 1 contract under supervision before enabling.
  On rejection the daemon alerts and the script-watched stop stays active.
- Spreads: resting stop not supported (refused); ladder still applies.
- Ladder re-price is cancel/replace (RH has no replace endpoint in robin_stocks) — a fill can race a cancel; `CloseGuard`
  reads the terminal state and treats `filled` as closed, so no second sell.

## Watcher
`watcher-exit-safety.patch` (not applied). Apply in a copy: `git apply docs/exit-safety-1016/watcher-exit-safety.patch`.
