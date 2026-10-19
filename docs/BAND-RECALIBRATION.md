# Band recalibration — making A+ reachable and meaningful

## The problem
The grade is `fit = structureQ·0.4 + modelQ·0.55 + bonuses` (`strategy-grade.ts`),
and `pathBand` calls A+ at `fit >= PROFIT_A_PLUS` (0.75, = `APLUS_RULES.aPlusThreshold`)
on a **complete** template, A− at `PROFIT_ACTION_FLOOR` (0.65). But the confluence
snapshot (`CONFLUENCE_KNOWLEDGE`) recorded **best fit 0.635 over 843 scored
candidates, A+ cleared 0**. So A+ at 0.75 is unreachable by construction — an empty
band. The fix is to recut the edges to the **achievable** fit distribution so A+ is
the genuinely-best cards, not an impossible threshold.

## Why it's co-firing, not dead components
An earlier read blamed never-firing components (`order_block`, `breaker`,
`mitigation`, `propulsion`, `mechanical_model`) and the always-on `ifvg`. But the
live score (`structureLayerScore`) is a ratio over **`SMC_STRUCTURE_KEYS`** only
(structure, mss, displacement, cisd, mid_bias, htf2_bias, daily_bias, weekly_pd, pd,
opening_bias) — none of those dead components are in it, and neither is `ifvg`. So
they don't cap the live score. What caps it is **co-firing**: the ten structure
keys rarely fire together (displacement 13%, mss 22%, htf2_bias 22% …), so a high
`structureQ` is rare, and `fit` tops out well under 0.75.

`scripts/recalibrate-band.mts` demonstrates this directly:
- **Monte-Carlo (independence)** — sampling each component at its marginal fire rate
  gives fit p90 ≈ 0.78 and A+ occupancy ≈ 18%. Independence **overstates** co-firing.
- **Reality (the 843-sample backtest)** — best 0.635, A+ = 0%. Components are
  positively *and* negatively correlated in ways independence misses.

The truth is between, so the real recut **must** run on real scored candidates, not
the independence estimate. The percentile method is identical either way.

## The method
1. Run the scorer over history and collect, per evaluated setup, `{ strategyId,
   components, htfOk, kzOk, condOk }` (the same scored-candidate stream the 843-sample
   `CONFLUENCE_KNOWLEDGE` came from).
2. `npx tsx scripts/recalibrate-band.mts --from candidates.json --md ai/band-recal.md`
   drives the **real** `gradeStrategyAgainstMarket` over them, reports the `fit`
   distribution, the current-edge band occupancy (shows A+ ≈ 0), and recommends:
   - `aPlusThreshold` = the p95 of achievable fit (A+ = the top ~5% of complete setups),
   - `confluenceFloor` (A−) = p70, with A = floor+0.03 and B+ = floor−0.05 falling out
     of `pathBand`'s fixed offsets (tune the percentiles with `--aplus-pct` etc. to hit
     a target monthly take count — frequency without lowering the real bar).
3. It also lists any `SMC_STRUCTURE_KEYS` firing below `--drop-below`% as removal
   candidates (none did in the snapshot; revisit on real data).

## Applying it (gated — not automatic)
The script **applies nothing**. Promotion edits `APLUS_RULES.aPlusThreshold` and
`confluenceFloor` in `src/lib/aplus/config.ts` (which drive `pathBand`), and is a
**Release-Watch + Trading-Stand** change behind an **Accuracy-Review GO** — never
auto-merged, never without a fresh `--from` run on real candidates. Config header
says "AI never changes these numbers"; this produces the *recommendation* the gate
acts on.

## Needs (owner split)
- **Codex**: instrument the scorer to emit the scored-candidate stream to a file
  (small), then run `--from` on a backtest window. (The backtest currently emits
  trades, not scored candidates.)
- **You**: run it on real data, decide the target frequency/percentiles, approve the
  `APLUS_RULES` change through the gate.
- **Claude**: the method + script (this), and reviewing the chosen edges for sanity.
