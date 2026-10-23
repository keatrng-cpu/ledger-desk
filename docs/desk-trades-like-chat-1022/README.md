# Desk trades like chat (2026-10-22)

Keaton, chat 2026-10-22 21:56 CT: "Make the desk trade like chat and cut reviews to a quick safety check".
See `ai/DECISIONS.md` (2026-10-22 21:56 CT entry) for the rule text.

- Shared rules: `shared/desk-rules.json` `chatSweep` (RULES_HASH 0a692dc19944a8df -> eeb84801a0b5c5b2).
- Desk: `src/lib/smc/chat-sweep.ts`, wired in `src/lib/trading/build-desk.ts` (before the deep-audit seal).
- Brain / Floor: `src/lib/trading/desk-listen.ts` — `strategy.chatSweep`, `brain.chatSweepSeat`, `floor.chatSweepSeat`.
- Watcher: `watcher-chat-sweep.patch` (new `watcher/chat_sweep.py`, gate row `chat_sweep`, min-2 sizing, T1 half + break-even
  manage, `watcher/desk-rules.json` copy, tests). Apply with `patch -p1` in desk-watcher **only when flat**, then restart there.
  Not applied to the live watcher by this PR.
- Shared fixture: `scripts/fixtures/chat-sweep-cases.json` (identical copy in the watcher's `tests/fixtures/`).

## Live verification before enabling (needs Keaton, flat, places orders)

None of this has been checked against live Robinhood. The tests use fakes only. Keaton runs these steps by hand: flat, outside a session, on the Agentic account, with 1 contract.

1. **Open-orders shape and account scope.** Check `rs.orders.get_all_open_option_orders(account_number=AGENTIC_ACCOUNT)`. Does it return only Agentic orders? Do the fields `account_number`/`account`, `legs[].option` (instrument URL holding the option id), `legs[].side`, `legs[].position_effect`, `trigger` (`stop`) and `quantity` match what `broker.open_close_orders` reads? Is a resting stop listed while it is working?
2. **Does RH reject a second close?** With a resting stop-limit close working for the full qty, send a sell-to-close for the same qty. The watcher ASSUMES RH rejects it (contracts reserved). If RH accepts it, the "open orders unreadable" safety sell can double-close and must be changed before enabling.
3. **The cancel-to-replace gap.** Time cancel-confirm-replace of the resting stop (cancel, terminal state seen, new stop accepted with an id). The position has no broker stop during this gap.
4. **Position-read lag vs the trim fill.** After a 1-contract trim fills, how long until `get_open_option_positions` shows the lower qty? Compare with `get_option_order_info(...).processed_quantity`, which the watcher prefers.
5. **Is a BE stop at the entry premium accepted?** Place a stop-limit close with stop = entry premium (clamped under the bid by `clamp_stop_below_bid`). Is it accepted with an order id? Does RH reject or instantly trigger it when the bid is near entry?

Record the results in `ai/DECISIONS.md` before turning the chatSweep management live.
