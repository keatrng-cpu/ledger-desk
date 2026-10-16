# Grok suggestion cards + proposals (follow-up on #45)

Grok **cannot fire and cannot change rules.** Default off, behind two flags: `GROK_READER` (desk, the reads) and `GROK_SUGGEST_FIRE` (watcher, live vs shadow). **RULES_HASH stays `a4bfcb65c88badcd`**, so no paired watcher deploy is needed for the hash.

| unit | change |
|---|---|
| Desk | `src/lib/grok-reader/suggest.ts`. Grok replies with strict JSON (`suggestion: {symbol, side, entry, stop, t1, setup, confidence}`, `proposals[]`, `read`); any defect drops it. The deterministic `reviewSuggestion` runs as soon as the read lands (p50 0.12 ms). It only uses existing rule values: stop/T1 from structure (gap edge / swing, floored at `minStopAtr`×ATR15; T1 = nearest opposing pool), `rrMin`, a closed-bar re-check (last closed 1m within `entryZoneAtr`×ATR15 of entry, stop and T1 untouched since the read). Band: the desk card's band for that symbol/side, else B+. **A- or better → normal gates. B+ → only with Brain TAKE on the same symbol/side, q ≥ 0.60 (`bandEdges.B+`), no veto.** Missed-check calls are deduped to one per setup per day (#22 setup-spent). Output: `payload.grokSuggest`, `payload.grokProposals`. |
| Brain | `wire.grokSuggest` → `MasterInput.grokSuggest`. The Master seat adds one narrative line per suggestion (display only, never a check). |
| Floor / Brain tab | `GrokReadLine` shows suggestion cards (mode, review decision/route, Trading Stand status). |
| Watcher | `watcher-grok-suggest.patch` (**not applied**): `watcher/grok_suggest.py` + a hook in `daemon._rule1_shadow`. On the first poll that sees a suggestion it re-checks the same risk limits as any card ($650 debit, $150 day loss, weekly lock, Agentic only, STOP file) and freshness (≤ 90 s, `fast.maxActionableAgeS`). It writes `grok_suggest_shadow.jsonl` (`would_fire`, `read_to_decision_s`, `orders: 0`) and a `grok_suggest_stand` notify line. `GROK_SUGGEST_FIRE=1` only sets `live_ready`. **The hand-off to the existing fire path is deliberately not wired** (the watcher owner needs to add it plus a `_grok_risk()` adapter). |
| Trading Stand | Async: `[grok-suggest-stand]` log line (desk) + `grok_suggest_stand` notify (watcher). Not in the fire path. |
| Proposals | `[grok-proposal]` log + `payload.grokProposals` (`status: "proposed"`), from Grok and from the detector. Each needs a backtest (`scripts/grok-suggest-replay.mts` is the harness) before anything is implemented. |

## Replay 10/12–10/16 (`npx tsx scripts/grok-suggest-replay.mts`, summary in `replay-summary.json`)
Offline: no xAI calls. Grok is proxied by the missed-setup pre-screen turned into strict JSON, with read = flag + 3 s. Bars are Yahoo 1m (`tests/fixtures/bars-1m-2026-10-12_16.json`); 10/16 runs to 11:20 CT. Outcomes: first touch of stop/T1 on 1m (stop first if both hit in one bar), else marked at 15:00 CT.
- Suggestions: **122** (≈24/day across ES+MNQ).
- Would-fire **as specified: 0**. Historic brain words aren't in the repo, so no B+ suggestion can meet Brain TAKE, and no desk A- card is known.
- Would-fire **upper bound (Brain TAKE assumed): 41**, 16 W / 25 L, **+8.69R** (+0.21R/trade). By day: +0.07, +7.59, −0.70, −6.54, +8.27R. The other 81 failed only on rr from structure.
- Desk comparator on the same bars: Rule 1 shadow 4 tickets, 1 W / 3 L, −2.83R. The real desk had 1 live fire in the window (10/15 ES long, −$36 option P&L).
- 10/16 MNQ: 09:45 gap tap (+3.26R), 10:00 lower high (+1.83R) and 10:45 tap would fire. The 08:30/08:35 shorts fail rr: by the closed bar the structural stop (30,086) was too far from price.
- Latency: desk review p50 0.12 ms, max 26 ms. Read → desk decision is under 1 ms after the Grok reply, then one watcher poll.
