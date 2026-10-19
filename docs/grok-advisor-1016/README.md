# Grok SHADOW advisor (prompt v2) — 2026-10-16

Grok never fires, blocks or changes a rule. RULES_HASH a4bfcb65c88badcd unchanged; config lives in `shared/grok-reader.json → advisor`.
Every flag is off by default: `GROK_ADVISOR` (advisor calls), `GROK_ADVISOR_SUPABASE` (table writes), `X_PULSE` (news poller).

| Piece | File |
|---|---|
| Prompt v2 + strict parser + routing + fire-and-forget kick | `src/lib/grok-reader/advisor.ts` |
| Scoring harness (closed bars after decision, promotion gate ≥15 OOS cases beating desk on R AND WR) | `src/lib/grok-reader/grade.ts` |
| X pulse design + stub, news tag ±15 min | `src/lib/grok-reader/xpulse.ts` |
| Supabase shadow tables (NOT applied) | `migrations/0011_grok_advisor_shadow.sql` |
| Seat/log lines | `master-seat.ts` (Brain/Floor narrative), `desk-listen.ts` (`wire.grokAdvice`), `watcher-grok-advice.patch` (log-only; changes together with the wire) |
| Offline backtest | `scripts/grok-advisor-replay.mts`, result `advisor_v2_replay.jsonl` |
| Tests | `scripts/grok-advisor.test.mjs` |

**Prompt v2 changes (from §6):** nearest open zones per timeframe 1m–4h (2 per rung, HTF first); the 08:30–11:00 CT window is stated as context and "never reject for time alone"; PDH/PDL (previous session RTH), ONH/ONL, PWH/PWL (n/a unless a full prior week is on the tape); SMT against the other index; desk card grade/q/actionable plus blockers (missing, vetoes, caps) verbatim; Brain seat verdict; volume (n/a — the feed has none); no confidence field.

**Types:** MISGRADED and WRONGLY_BLOCKED need a desk card. WRONGLY_BLOCKED must copy a real blocker from the card, or the row is dropped. NEW_SETUP needs no card. AGREE is logged and never routed.

**Routing:** `$GROK_ADVISOR_DIR` (default `/workspace/audits/grok-suggest`) gets `suggestions.jsonl` (every row) and `inbox.jsonl` (`to: ["trading-stand","smc-data-analysis"]`, one short note per non-AGREE row). Both bots read the inbox. Nothing posts to Slack. Supabase writes need `GROK_ADVISOR_SUPABASE=1` plus `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`, and the 0011 migration applied (ask first).

**X pulse:** a poller runs every 60 s from 07:00 to 15:00 CT. It uses X v2 recent search (`X_BEARER_TOKEN`) or the X connector's `search_posts_all`, over squawk accounts with since_id paging. It classifies posts by keyword (high/medium/low), writes them to `x_pulse`, and the advisor tags a row when a high-impact pulse falls within ±15 min. That's a tag only. In this PR the poller is a stub: no cron, and nothing writes to `x_pulse`.
