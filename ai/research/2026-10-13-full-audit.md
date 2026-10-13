# ledger-desk full audit — 2026-10-13 (base main 3860e498)

Live evidence: /api/desk/card and LedgerDesk read_scanner at 10:21–10:28 ET. Watcher log (/workspace/desk-watcher/alerts.log, read only) shows why every B+ check failed. Ranked by trading impact. Status is FIXED, PARTIAL or OPEN.

## P0: kills trades or misstates the card
1. **F1 Entry null on every card in the NY AM hour (FIXED).** `scanner.ts:1044` defines silver-bullet hours as 10:00–11:00 and 14:00–15:00 ET. The old code at ~L1065 then nulled `entryPx` for every model in those hours unless the gap had formed in that same hour. It also nulled `entryPx` whenever price was more than 2 gap-heights (or 8 pts) away.
   - Effect: `wire.strategy.entry` was null, so there was no plan RR. The brain said "Target priced ≥ 1:1" and the Floor showed "No entry price".
   - Fix: keep the real array price and add `entryResting` (`scanner.ts:1071`). The Floor still holds a resting limit as WATCH (`options-desk.ts:1682`), so no safety gate was loosened. The silver-bullet tag is now a note only.
2. **F3 Band and q disagreed (FIXED).** `pathBand` came from profit-path and veto stamps, `q` from confluence, and the two were never reconciled. Live: ES long showed path B+ with q 0.737, MNQ showed path B+ with q 0.217/0.567.
   - Fix: `sealBand` (`discipline.ts`, called at `build-desk.ts:1147`) runs after every cap. The band is then exactly `bandFromQ(q)`. A cap that pushed the band below q's band clamps q to that band's ceiling and keeps `qRaw`. Below B+ is never actionable. `skip` is preserved.
   - Also fixed: the wire had used Unicode "A−" while the scanner uses ASCII "A-". It is ASCII everywhere now.
3. **F2 / F7 Wire strategy ≠ brain book ≠ best card (FIXED).** The wire took `candidates[0]` (MNQ q 0.57) while the brain's book was ES long (q 0.74). The thesis line then read "same book — brain was on the other side", which was false because it was a different symbol.
   - Fix: candidates are sorted by actionable, then band, then q. `wire.strategy` is the brain's book when that book is on the board (`desk-listen.ts:154`). The mismatch text now names the brain's symbol.
4. **F4 `wire.shock` was always present (FIXED).** It is set for tail reads too, so the watcher's `shock_active` treated every tail as a live shock window. `wire.shock.active` now carries the real window flag.
5. **F5 No 1h/4h bias on the card (FIXED).** The watcher reads `strategy.bias1h/bias4h` or `wire.htf`. Both are added from the shared MTF context.
6. **F6 No chop flag (FIXED).** `wire.strategy.chop` comes from discipline R7 `isChop`.

## P1: contradictions between seats
7. **SMT leader/laggard semantics (FIXED text).** Fix 1 (3860e498~) moved credit to the holder (`smtLed === false`) at `smc-canon.ts:640`, `scanner.ts:642` and `smc-master` rank. But the scanner's note still said "Trade the book that led", and veteran-brain (`veteran-brain.ts:1326`) said "laggard — the other book led". Both are re-worded to the holder semantics.
   - OPEN: the flag name `SMT_TRADES_THE_LEADER` (`smc-canon.ts:377`) and the comments in `smt-level.ts:137` / `ltf-lead.ts:143` are stale. The behaviour is consistent, but they should be renamed.
8. **F9 MTF array counts were noise (FIXED).** The 15m rung counted 271 IFVGs over the whole history. Only live arrays at most 30 bars old are counted now (`mtf-context.ts:152`).
9. **Fastest-SMT lead flips (OPEN, design).** The live list had 1m bullish, 2m/3m bearish and 5m/30m/4h bullish at the same time. `smtLead = smt[0]` (1m) drives the SMT cap and the Floor override. Proposal: a majority/HTF-weighted lead, with 1m used only as the trigger. Not changed without Accuracy sign-off.
10. **Stop vs T1 geometry (OPEN, numbers).** Live MNQ long had stop 30591 ("beyond the raid", about 3.3 × ATR15 = 48.7 away) and T1 30792 about 39 pts above price, so RR ≈ 0.28. The stop is anchored to the raid's wick while the entry is the current array, so R is huge and T1 sits near. Discipline R2 (T1 < 1R → B) correctly demotes it. The real fix is to use a structural stop beyond the entry array's origin when the raid is more than 2 × ATR away, or to select T2 as the target. This changes RR stats, so it is flagged for Accuracy.
11. **Brain graded before discipline (OPEN).** `gradeSmcMaster` runs before `applyDiscipline` and `sealBand` (plans must exist first), so the brain's `mustPass` can't see the discipline caps. The Floor and the wire read the sealed band. A second brain pass after sealing would close this.
12. **Out-of-session nulling (KEPT).** `scanner.ts:1617` nulls entries outside the live window on purpose. That is a safety rule and was not touched.

## P2: dead or unused paths
- `scanner.ts` `void smt; void book;` (~L639): computed inputs that are discarded.
- `scanner.ts` `void hot` (earlier removal): the hot shortcut is dead.
- `desk-listen.ts` used to compute its own band (duplicate). It now uses `discipline.bandFromQ`.
- `wire.strategy.stop` is text only ("Stop N — …"). The watcher parses it. A numeric `stopPx` would be safer (OPEN; adding it would not break the watcher).

## Safety stops: unchanged
liveQuote freshness and asOfMs, BP, news ±15m, account lock 995386158, daily cap, the 1-position rule, flat at 15:30, out-of-session entry nulling, and Floor WATCH on a resting limit.

## P0 (added 10:33 ET, Keaton's live case): ES long against an LTF reversal (FIXED)
The desk held an ES long while the 5m bull FVG had inverted into a bearish IFVG and the 1m had displaced down after a spike-and-fade. Nothing in the scanner, brain or Floor read LTF reversals.
- New `ltfReversalsOf` / `ltfReversalOf` in `mtf-context.ts`. The side is killed by either of:
  - (A) a 5m IFVG against the side, at most 6 bars old;
  - (B) a 1m rejection wick (at least 50% of the bar's range) at the 30-bar high or low, then within 10 bars a body of at least 1 × ATR1m closing beyond the wick bar.
- When a side is killed:
  - that side's card is capped at C and is not actionable, and the veto is named;
  - the opposite side gets +0.03 q;
  - the MTF alignment flips the LTF leg;
  - the brain's book on the killed side becomes STAND.
- The kill is temporary. A long re-arms only when this happens in order: an SSL sweep (a bar takes every low since the kill and closes back above it), then a 1m body of at least 1 × ATR in the side's direction, then a close back through the far edge of the opposing array. A re-armed card is capped at A-; mirror rules apply for shorts.
- Test fixture: `scripts/fixtures/card-2026-10-13-1033et.json`, the live card at 14:34Z. Tests in `scripts/ltf-reversal.test.mjs` cover kill → rebuild → A-.
