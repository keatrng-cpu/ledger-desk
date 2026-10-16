# graph-drift-1016 (Graph Keeper audit fixes)

RULES_HASH stays `a4bfcb65c88badcd`: `shared/desk-rules.json` is untouched; `scripts/graph-drift-1016.test.mjs` asserts the hash.

| # | Change | Where |
|---|---|---|
| 1 | `wire.strategy.reasons` (top card) and `wire.cards[].reasons` (every card), last 20 (`WIRE_REASONS_CAP`). Additive. | `src/lib/trading/desk-listen.ts` |
| 2 | `wire.cards[].guards` for every card (additive). Watcher patch logs non-top cards' shadow guards as `shadow:desk:card:<sym>/<side>:<rule>` rows (ok=True, never gate). **Not applied to the live watcher.** | `watcher-guards-per-card.patch` |
| 3 | Reasons shadow: pure sampler (row only when a card's reasons change) + proposed DDL. Not wired, table not created. Kept out of `migrations/` because `scripts/migrate.mjs` applies that folder on build. `desk_card_snap` unchanged. | `docs/graph-drift-1016/reasons-shadow.ts`, `proposed-0028_card_reasons_shadow.sql` |
| 4 | Dead-card kill(): dropped the second `capBand(…,"C")` after `sealBand` (provably identical, exhaustive-grid test). The q_v2 dead-card veto is NOT a duplicate (it covers invalidated/played-out/stale, computeQV2's `vetoed` covers vetoes/ltfKilled, and it appends a delta), so it stays. | `build-desk.ts` |
| 5 | `pathBand` NOT removed: it has a caller (`strategy-grade.ts` `pathBand({…})` inside the template grader, ~L323). | — |
| 6 | One `PROFIT_ACTION_FLOOR` in `src/lib/aplus/config.ts` (= `APLUS_RULES.confluenceFloorCalibration`, 0.65); strategy-grade imports it, profit-path imports and re-exports it. | |
| 7 | Rule 1 comment fixed (only the watcher logs it; brain/Floor show the Δ0.7 line). | `build-desk.ts` |

Not done (per scope): q→band unification (parity table only: `band-parity.md`, regenerate with `npx tsx docs/graph-drift-1016/band-parity.mjs`), seal ceiling (PR #47), Array<> parser fix. Veteran-brain dealing-range fix is a PROPOSED patch only: `PROPOSED-veteran-brain-dealing-own-book.patch`.
