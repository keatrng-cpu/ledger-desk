
## Update 10/21 11:45 CT
- M-LONG added (2x 724C @1.67, manual close $364, +$30). Day 10/21 3/3 +$177; journal 5 trades +$338.
- `src/lib/trading/chat-trades.ts`: `parseArmedLog` (day from BUY contract date; CORRECTION/FINAL/"closed manually" lines override the script's P&L), `mergeChatTrades`, `chatSetupPriors`, `chatShadowRead`, `chatTradeChartSvg` (closed 1m bars, entry/exit markers, stop/T1/runner/swept).
- `scripts/chat-trades-cli.ts parse|chart|ingest [--apply]` replaces ingest-chat-trades.mjs.
- Review tab: `ChatTradesPanel` + `GET /api/desk/chat-trades` (chat_trades table if migrated, else bundled JSON).
- Floor/Brain shelf: `chatPriorNote` on Nova + Jax (research.ts). Shadow text only; no gate/score/fire reads it.
