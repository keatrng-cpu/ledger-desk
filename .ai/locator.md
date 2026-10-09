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
- The card grade — `src/lib/trading/scanner.ts` `scanSetups`
- Which model the card is — `src/lib/trading/strategies.ts`
- Brain word versus the desk card — `src/lib/trading/smc-master.ts` `gradeBook`
- Entry, stop, targets — `src/lib/trading/trade-plan.ts`
- One stop on the card — `src/lib/trading/card-plan.ts` `protectiveInvalidation`
- Rest the limit, do not chase — `src/lib/trading/entry-trigger.ts` `readEntry`
- The Robinhood ticket — `src/lib/trading/options-desk.ts`
- Send and close — `src/lib/execution/rh-cycle.ts`
- A handed ticket — `src/lib/trading/options-desk.ts` `gateHand`
- The floor narrates and does not gate — `src/lib/room/`
- Live tape — `src/lib/market/databento.ts`, `src/lib/market/live-gateway.ts`
- A shock candle, the headline and the wick — `src/lib/trading/shock.ts` `shockBrief`

Add a line here when a behavior gets a new owner. Do not paste the function.
