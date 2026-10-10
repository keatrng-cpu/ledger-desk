# Locator

Search this before opening a file. One line is the behavior, the file, and the function that owns it. A miss goes to `docs/code-index.md`, not to a directory walk.

```
rg -n "sweep|stop|robinhood" .ai/locator.md
```

- A newer sweep erases the raid — `src/lib/trading/raid-pair.ts` `namingSweep`, `polaritySweep`
- Displacement must answer that raid — `src/lib/trading/raid-pair.ts` `pairedDisplacement`
- The raid candle is not the shift — `src/lib/trading/raid-pair.ts` `cisdThroughSeries`
- The gap that counts is the one the displacement left — `src/lib/trading/raid-pair.ts` `displacementLeftArray`
- Strong extension vetoes the other side — `src/lib/trading/raid-pair.ts` `strongExtension`
- Higher-timeframe disrespect releases the gate — `src/lib/trading/htf-invalidation.ts` `biasDisrespect`
- Lower-timeframe confirm after the raid — `src/lib/trading/ltf-reaction.ts` `readLtfReaction`
- Judas is 09:30–09:45 and fails closed — `src/lib/trading/judas-window.ts` `readJudas`
- Premium/discount passes if either the impulse leg or the 80-bar window is the correct half — `src/lib/trading/gate-tuning.ts` `preferZone`
- The card grade — `src/lib/trading/scanner.ts` `scanSetups`
- Which model the card is — `src/lib/trading/strategies.ts`
- Brain word versus the desk card — `src/lib/trading/smc-master.ts` `gradeBook`
- Entry, stop, targets — `src/lib/trading/trade-plan.ts`
- One stop on the card — `src/lib/trading/card-plan.ts` `protectiveInvalidation`
- Rest the limit, do not chase — `src/lib/trading/entry-trigger.ts` `readEntry`
- Which contract — `src/lib/trading/options-desk.ts` `pickLiveContract`
- A swing hold, overnight through a week — `src/lib/trading/options-swing.ts` `SWING_SPANS`
- Send and close — `src/lib/execution/rh-cycle.ts`
- The nine lessons, graded live — `src/lib/learn/live-lesson.ts` `readLiveLessons`
- Direction, counter-bias, entry, target — one reader — `src/lib/trading/ticket-facts.ts` `fourFacts`
- Blake's mechanical model — `src/lib/trading/detectors.ts` `detectMechanicalModel`
- The floor narrates and does not gate — `src/lib/room/`
- Live tape — `src/lib/market/databento.ts`, `src/lib/market/live-gateway.ts`
- A shock candle, the headline and the wick — `src/lib/trading/shock.ts` `shockBrief`

Add a line here when a behavior gets a new owner. Do not paste the function.
- The long board, a year-clock card that does not buy — `src/lib/invest/long-board.ts` `gradeLongCard`
- The swept-dollar split, after rent and the sleeve refill — `src/lib/invest/funnel.ts` `splitSweep`
- Closed-hours study: long board, watchlist headlines, a name not on the list, the prediction book — `src/lib/room/off-hours-study.ts` `studyPack`
- The Mead Hall, built once for the Predict tab and the Floor — `src/components/mead/mead-hall-build.ts` `MeadHall`
- Where the Mead Hall stands: its walls, doorway, spots, screens, cameras — `src/lib/room/mead-hall-layout.ts` (the plan is written from it by `scripts/build-mead-plan.mjs`)
- The Floor's Mead Hall: its own lights, its own pass, who is inside it — `src/components/room/floor-mead.ts` `FloorMead`
- The firm's standing reviews (look-through, restricted list, kill-rule record, ledger health, tax lots, funding, memo, funnel, policy, data age) — `src/lib/room/invest-firm.ts` `buildFirm`
- The firm's week, one list for the talk and the board TV — `src/lib/room/invest-read.ts` `firmDay`
- The firm's voices — `src/lib/room/live-voices-invest-firm.ts`
- A click on a market on a hall screen opens its desk panel in the Predict analyzer — `src/components/room/floor-link.ts` `openPredictAt`
- The prediction board the Floor talks about, copied from the signal engine — `src/lib/room/hall-lite.ts` `hallLiteFrom`
- Where the hall's board is held and published — `src/lib/room/hall-store.ts` `setHall` / `hallLiteNow`
- The pull (scanner models into the signal engine) — `src/components/room/hall-read.ts` `loadHallBoard`
- What the five say in the Mead Hall — `src/lib/room/live-voices-mead.ts` `meadBeats`
- Where the five stand in the hall — `src/lib/room/agents.ts` `HALL_HABITS`, `hallSpotOf`
