# Multi-TF every-close audit (#19)

**Question:** does the desk read the newest CLOSED bar on every rung (1m–4h/1D), with no forming-bar leaks, everywhere it reads charts?

**Finding: the contract holds and is consistent.** The forming bar is dropped at every read path:
- `smc/every-tf.ts` `closedBuckets` — a bucket counts only once its full span has elapsed by `nowMs` (`b.t + srcMs <= nowMs`, then pops a not-yet-elapsed last bucket).
- `smc/mtf-arrays.ts` `rung()` — drops the forming source bar and the forming resampled bucket by time (`t + ms > nowMs ? slice(0,-1)`).
- `smc/mtf-context.ts`, `smc/exec-context.ts`, `smc/seq/*` — read `minute.slice(0, -1)` and resample `.slice(0, -1)` before any swing/structure/array read.
- `backtest/engine.ts` and the detectors are causal (confirmed in the earlier detector audit): swings confirm `width` bars later, FVG status is a single forward pass.

**Two forming-bar reads are intentional (by design, not leaks):**
- `smc/deep-audit.ts` — the current print is deliberately included ("the current print counts") for the plausible-print window.
- `smc/ifvg-flip.ts` — reads the forming bar on purpose to veto a side while price is live inside an inverting gap.

**Added:** `scripts/mtf-closes.test.mjs` — a regression guard pinning the invariant: appending a forming bar does **not** change `closedBuckets` or `mtfArrays`, while a bar whose span has elapsed **does** enter the read. 3/3 green. This is the guarantee behind "reading charts correctly at all timeframe closes."

**No code change needed** — the contract is sound; this adds the missing test so a future edit can't silently break it.
