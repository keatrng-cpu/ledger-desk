# Deep audit 2026-10-15 — fixes (branch fix/deep-audit-1015, base main c3e60bc3)

Source findings: `/workspace/audits/deep-audit-1015/report.md` (19 items). Nothing here is deployed. The live watcher
(PID 1496884), `/workspace/paper-futures`, orders and paper pending orders were not touched.
Watcher and paper-futures are not in this repo, so their changes ship as patches here:
`watcher.patch` (built and tested in a copy at /workspace/dw-deepfix, never started) and `paper-futures.patch`
(built in /workspace/pf-deepfix). Apply them only after review.

## Per item
| # | Status | Where | Tests |
|---|---|---|---|
| 1 adverse late entry | FIXED. `entryStateOf` has a new `invalidated` state (price at or through the stop). The final build-desk seal kills the card: actionable=false, band C, sorted last, and the brain book goes to STAND. Paper's existing fill-through-stop refusal (paper.py step) now has a test. | entry-state.ts, deep-audit.ts `invalidationOf`, build-desk.ts seal | deep-audit.test #1; paper `test_fill_through_stop_refused` |
| 2 T1 already traded | FIXED. `sinceEntry` = the 1m bars since entry was last traded (240-bar window, 30-bar fallback). It is passed at build-desk:1385 and in the seal. T1 traded before the fill caps the card at C, and the watcher withholds the alert. | build-desk.ts, deep-audit.ts `barsSinceEntry` | #2 |
| 3 paper pendings | FIXED (patch). A pending order expires at the 15:50 ET flat, at the CME session roll (18:00 ET), or after 3 h. At touch it needs the current card to have the same symbol, side and plan_key at B+ or better, or it is cancelled. | paper-futures.patch | 10 paper tests |
| 4 journal duplicates | FIXED. The row id is day+symbol+side+structural anchor (raid/sweep price on `wire.strategy.anchor`), no longer the entry. The row is written AFTER the final Master seat, so its verdict is the one the card shipped with. Invalidated and stale cards are not journaled. | card-journal.ts, card.ts, desk-listen.ts | #4 |
| 5 ticket side/underlier | FIXED. `ticketCheck`: a ticket whose underlier or right contradicts the card is removed from `floor.ticket` and shown as `floor.otherBookTicket`, labelled as Floor's SMT other-book ticket. It is never handed. | desk-listen.ts | #5/#6 |
| 6 DTE / live ask | PARTIAL. A ticket must be ≤1 DTE and ≤ the optExec.dteByTime want (floored at 1), or it is blocked from the hand. A missing live ask is FLAGGED in `floor.ticketCheck` and not blocked, because the watcher prices on the RH chain. A 0-contract ticket is blocked. Not done: live chain pricing and per-poll debit recompute, which need options-desk changes. floorDte stays shadow in rules. | desk-listen.ts | #5/#6 |
| 7 gates never/always pass | ANALYSED + logging fix. See below. | watcher.patch (`hygiene.compact_gates`, parity test updated) | hygiene tests |
| 10 endpoint latency | FIXED (per warm instance). `sharedDeskBuild`: concurrent callers share the in-flight build, and a finished build is reused for 1 s. Card, read_desk, read_brain and read_floor all go through fetchTradingDesk, so they now share one build. A slim watcher card is not done. | desk-tick-cache.ts, build-desk.ts | #10 |
| 12 stale tape | FIXED. Lag over 30 s or unknown means every card is capped at C, not actionable, with a "STALE TAPE" reason and `wire.strategy.staleTape`. The hand is blocked. The watcher withholds DESK alerts. | build-desk.ts seal, desk-listen.ts, watcher | #12, hygiene |
| 13 card live after stop | FIXED with #1. A stop that printed in the bars since entry also kills the card. | deep-audit.ts | #1/#13 |
| 14 stop text vs number | FIXED. The text is rendered from `plan.stop` after all mutation, both in the seal and on the wire. | deep-audit.ts `stopText`, desk-listen.ts | #14 |
| 15 tick rounding | FIXED. In the seal, entry rounds toward the market, the stop away from entry, and targets toward entry. Risk and R:R are recomputed. | deep-audit.ts `roundPlan` | #15 |
| 16 level hysteresis | FIXED (warm instance). Levels are pinned per symbol+side+strategy+anchor and change only on a newer closed 15m bar. | deep-audit.ts `pinLevels` | #16 |
| 17 DST | FIXED. All 13 hardcoded `-04:00` uses become `etParse()` through `etWallToEpochMs`. | session-backtest.ts | #17 |
| 18 hygiene | FIXED (patch). status.json now drops forbidden keys instead of refusing the whole file (`scrubbed_keys` is recorded; an unmaskable account number is still refused). atExtreme falls back to the buffer's own extremes. Spike rows are logged only when failed or at an extreme, with the rest counted. bplus_caution is logged on ok flips only. NEAR-MISS sends once per card fingerprint per 30 min. Stale or dead cards do not alert. The paper outbox reports its backlog. It still needs PAPER_JOURNAL_URL/TOKEN set (Keaton). | watcher.patch, paper-futures.patch | hygiene + status tests |
| 19 MNQ vs NQ | FIXED (patch). Paper books the card's contract. A full-size card may step DOWN to its micro, never up. `contract`/`card_symbol` are recorded, and closed rows also carry `qty`/`pnl`/`r`. | paper-futures.patch | 3 paper tests |
| 8, 9, 11 | Not in the priority list and not touched. #9 is partly addressed because the seal stamps entryState on every candidate after the sort. |

Skipped as covered elsewhere: gap-fill (#16 PR), two-sided ladder (#17 PR, display-only; its crossed-stop invalidation is
on the ladder, while this PR kills the *card*, with no shared code), EV/grade (feat/ev-fire-grade), and the review batch.

## Out of scope in this PR (explicit)
- Items **8, 9 and 11** of the source report are NOT addressed here. They are listed as out of scope, and the "19 items" claim is withdrawn: 16 are addressed.
- Plan flip (#30) is handled in `fix/fire-unblock-1015` and is not duplicated here.

## Accuracy review fixes (reviews/2026-10-15-deep-audit-pr19.md)
- Committed `node_modules` symlink removed (and `/node_modules` ignored). watcher.patch is regenerated without `__pycache__`/`.pyc`/runtime `data/`, and `git apply` applies it cleanly to a fresh copy of the live watcher.
- Expiry picker (`optexec.pick_expiry`): intraday takes today's expiry exactly; if late or there is none, it blocks. Swing takes the nearest expiry ≥1 day out, so a Friday 1DTE swing gets Monday and never today's 0DTE. Tests are pinned to a Friday and to Thanksgiving.
- Intraday picker respects `intradayTicket.deltaBand` 0.45–0.55 (`optexec.pick_intraday`), then 1 OTM, never a spread.
- options-desk: with the rule off, the lanes use their pre-rule DTE/delta (path 1DTE Δ0.35–0.45, Judas 0DTE Δ0.35–0.5).
- The brain is forced to STAND on played-out and price-unknown cards too, not only invalidated/stale. The card re-sort is stable: only dead cards move back, and live cards keep scanner order.
- The watcher no longer suppresses alerts on `missed` alone. It suppresses on `playedOut` (new wire flag) and invalidated.
- Stale boundary: the wire uses `tapeStale()` too, so exactly 30 s counts as fresh on both sides.
- `invalidationOf`: a missing price is `unknown` and the card is not actionable. Played out is read from the FIRST entry touch, so a T1 hit followed by a return to entry does not revive the card.
- draw.ts mergeCoincident: a coincident cluster with any swept member is marked swept (it was `every`).
- Sizing at real 0DTE prices: the watcher sizes QQQ 0DTE ATM at $2.44 to 2 contracts under $650 on A+/A (1 on A-/B+), capped at the desk's wanted count. The desk allows 2 for 0DTE when the rule is live (was 1). See the report for the desk risk-budget caveat.

## Ticket structure (owner rule, Keaton 2026-10-15; supersedes the edge-research-1015 1DTE pick)
- **Shared rule `optExec.intradayTicket` (live):** `dte: 0`, `strike: ATM`, `fallback: OTM_1`, delta 0.45–0.55, `debitSpread: false`, and `lateBlockEt: 15:25` (= session.zeroDteCutoffEt; RH blocks new 0DTE opens at 15:30 ET). 1DTE+ is for swing-classified cards only.
- **Desk (options-desk.ts):** the path/continuation and Judas/killzone lanes build 0DTE ATM. From `lateBlockEt` they STAND with "0DTE impractical… intraday blocked, not rolled to 1DTE" and hand no ticket. The SMT lead (horizon `swing`, 2–5 sessions) is back on its own 5DTE. Event and swing spans are unchanged. The vertical fallback returns null, so no spreads.
- **Floor/brain (smc-unity `floorDteRead`, desk-listen `ticketCheck`, deep-audit `dteFitsPlan`):** an intraday ticket wants 0 all session, and 1DTE+ intraday is flagged. `lateBlocked` makes the ticket unhandable late; it is never rolled to 1. `dteFitsPlan(intraday) === 0`, `dteFitsPlan(swing) >= 1`.
- **Watcher (patch):** `optexec.is_intraday_ticket` (dte 0, not horizon swing) and `intraday_late_blocked` (from lateBlockEt, or whenever `min_dte_now` already forbids 0DTE, e.g. loss.option.preferDte1MinLeft). `dte_target` returns 0, or None (block) when late. `pick_contracts` takes only an exact 0DTE expiry; if late or there is none, it returns no contracts (blocked, `v.intraday_block` says why). The picker goes ATM first, then 1 OTM if the cap needs it, with no delta-band ITM pick and no spread fallback. Swing tickets keep the old path (delta band, spread fallback, dteByTime). The rules copy is byte-identical to shared.
- **Desk bug (T2 not beyond T1):** a long card showed T2 29878.75 below T1 30174. `orderTargets` (card-plan.ts) drops a T2 that is not beyond T1 (long t2>t1, short t2<t1). build-desk runs it over every card and book plan at the end. `planTargetText` never prints such a T2.
- **Tests:** deep-audit.test (0DTE block, late block, dteFitsPlan, T2 ordering), smc-unity.test (F10 floor DTE), watcher `test_intraday_ticket.py` (rewritten) and `test_optexec` (dte_target).
- **rulesHash:** main `e7338987cbc7eea5` → PR #19 (1DTE) `47c62fe3d2355d3d` → now `7d151e5fed7fe3eb`.
- **Run parity against this branch:** `LEDGER_DESK_DIR=<this checkout>` for watcher pytest and `WATCHER_DIR=<patched watcher>` for npm test. Against the unpatched live watcher, the two rules-parity tests fail by design until the patch is applied with the merge.

## #7 gates (gates.log 4,784 rows, cards.log 4,081 strategy polls, 10/13–10/15)
- **Never True:** `verdict` (ARMED), `phase` (hand), `actionable` (0/1,333), `bplus_caution` (0/130), `fast:persist` (0/3,451).
  `account`, `no_position`, `no_working_order`, `live_quote`, `sizing` and `buying_power` are broker-stage gates. They are `None` (unverified) in dry-run, not failures.
- **Why:** Floor was WATCH 2,935 and STAND 1,115, never ARMED, so phase is never `hand` and the hard path cannot fire. That is upstream (#8), not a gate bug.
  On polls graded B+ or better (471), actionable was cleared by the live `late` guard 310 times and upstream 91 times; it was true 70 times.
  `bplus_caution` needs brain TAKE, and brain said TAKE 0 times after 10/13.
- **Decision:** keep the hard gates. They are the design: no hand without ARMED. The fix belongs in Floor/brain calibration (#8), which is out of scope here.
- **Always True:** `exec_account`, `card_age`, `brain` (soft), `htf_bias`, `entry`, `news`, `entries_day`, `t1_rr`, plus about 45 `shadow:`/`soft:` rows.
  The shadow/soft passes without a WOULD-block are now logged as one `quiet` counter (`hygiene.compact_gates`). Hard gates and every would-block row are still logged. The parity replay compacts the same way.

## Replay (`replay.py <unix_ts>` → `replay.json`; numbers below are cut at the 5b5153d7 commit time, ts 1792074565)
- **Desk polls:** 4,101 at that cut (cards.log keeps growing, so an uncut run gives larger counts; the earlier 4,081/152 figure came from an earlier cut). The new kills hit 197 polls through the stop, 160 played out (T1 before fill) and 222 stale tape.
  Alert-eligible polls (A+/A/A-) go from 62 to 15. **Alerts added: computed, 0.** The seal only lowers bands and clears actionable, so this is 0 by construction, but it is now counted, not hard-coded.
- **Paper (7 closed trades):** 2 are removed and both are losers: ES-L-20261013-1924 (-$2,050, pending expired >3 h) and MNQ-L-20261014-143343 (-$8,540, "desk would kill: invalidated"; the hard-coded refusal by trade id is gone). P&L goes from -$6,104 to +$4,486.
  **Added trades: computed, empty.** The ledger only holds fills the old rules took, so it cannot show trades that were never taken.
  **Caveats:** (1) the **3 h pending expiry was fit post-hoc**, after seeing this data, and the ES-1924 removal depends on it. (2) **6 of the 7 fills** had no cards.log poll within 120 s, so "no winner removed" is untested for 6 of 7; those trades are kept.
- **#19:** MNQ-L-143343 booked as 10 MNQ is the same dollar risk as 1 NQ ($2,080 cap). The fix corrects the symbol/schema, not the loss.
