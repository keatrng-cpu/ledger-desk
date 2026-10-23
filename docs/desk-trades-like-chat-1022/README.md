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
