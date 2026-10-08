# Dependency graph

Read this instead of tracing imports. An arrow is a call, not a suggestion to merge the files.

```
market (databento, yahoo, gateway)
  -> build-desk.ts          assembles one payload
  -> scanner.ts             grades each side
       raid-pair.ts         the raid and the displacement that answers it
       detectors.ts         sweeps, gaps, displacement
       smc-canon.ts         named models
       strategies.ts        which model the card is
  -> smc-master.ts          the one book and the brain word
  -> trade-plan.ts          entry, stop, targets
  -> options-desk.ts        the Robinhood ticket
  -> desk-listen.ts         the wire Grok reads
  -> room/                 reads the desk. Does not change the grade
  -> execution/rh-cycle.ts  sends and closes. Does not regrade
```

`src/lib/aplus/config.ts` is read by the grade and the ticket. Nothing writes it.

A change in `detectors.ts` or `raid-pair.ts` reaches the card, the brain, and the ticket. A change in `room/` does not. Do not "fix" a grade by editing the floor.
