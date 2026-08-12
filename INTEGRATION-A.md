# INTEGRATION-A — Phase A: one scoring path

Phase A of ROADMAP v2 (A1–A4). Deterministic TypeScript only, no LLM scoring.
Everything below was verified against real MNQ/ES 5d/15m Yahoo bars
(355 bars per book, 2026-08-06 → 2026-08-12) with a throwaway harness that has
since been deleted.

**Nothing was committed. All changes are in the working tree.**

## Files changed

| File | Change |
|---|---|
| `src/lib/trading/detectors.ts` | A2 — mechanical-model expiry + invalidation, new selection rule |
| `src/lib/trading/scanner.ts` | A3 — `scoreCandidates` extracted; `scanSetups` is now a façade; sweep/mechanical components gated on liveness |
| `src/lib/trading/replay.ts` | A1 — passes bar prefixes + swing divergence to the scorer |
| `src/lib/bridge/paper-server.ts` | A4 — dead `commitPaperCycle` / `paperPnl` removed, `OpenPaperTrade` inlined |
| `src/lib/trading/paper.ts` | A4 — **DELETED** (280 lines, dead second paper engine) |

`npm run typecheck` → 0 errors. `npm run lint` → 0 errors (38 pre-existing
warnings, none introduced here).

---

## A1 — replay now scores the desk that actually trades

`replay.ts:241` called `scanSetups(read, peerRead, clock)` with no bars. Inside
the scanner that meant `barsL = []`, so `summarizeDetectors([])` returned
nothing, `assessConditions([])` gated on nothing, and the draw engine was
skipped (needs ≥30 bars). It now calls:

```ts
scoreCandidates(read, peerRead, clock, {
  divergence: smtDivergence(slice, peerSlice),
  leftBars: slice,
  rightBars: peerSlice,
});
```

`slice` is `bars[0..i]` and `peerSlice` is every peer bar with `t <= bars[i].t`
— both are strict **prefixes**, so this adds no lookahead. Verified
empirically, not just by inspection: replaying the truncated series at K = 150,
220 and 300 produced signal tuples `(t, side, prescore, grade)` byte-identical
to the full run for every bar both runs reached.

The swing-divergence read was added too — it was cheaply available and replay
was previously running SMT off the `changePct`-spread fallback only.

### ⚠️ Every prior replay/calibration number is void

Same bars, same code path, before vs after:

| | BEFORE (detectors off) | AFTER (detectors on) |
|---|---|---|
| outcomes | 16 | **89** |
| grades | B × 16 | **A+ × 18, A- × 11, B × 60** |
| best prescore | 0.6400 | **0.9900** |
| mean prescore | 0.6055 | 0.6289 |

Floor table (cumulative "what does this floor admit"):

| floor | BEFORE admitted | AFTER admitted | AFTER res1R | AFTER WR 1R | AFTER E 1R | AFTER res2R | AFTER WR 2R | AFTER E 2R |
|---|---|---|---|---|---|---|---|---|
| 0.50 | 16 (100%) | 70 (78.7%) | 48 | 47.9% | −0.042 | 42 | 40.5% | +0.214 |
| 0.60 | 7 (43.8%) | 45 (50.6%) | 29 | 51.7% | +0.034 | 25 | 44.0% | +0.320 |
| 0.65 | **0** | 37 (41.6%) | 24 | 62.5% | +0.250 | 20 | 55.0% | +0.650 |
| 0.70 | **0** | 28 (31.5%) | 17 | 47.1% | −0.059 | 14 | 35.7% | +0.071 |
| 0.75 | **0** | 19 (21.3%) | 12 | 50.0% | 0.000 | 10 | 40.0% | +0.200 |

The headline: **before this change the calibration table could not answer its
own question.** Floors 0.65/0.70/0.75 admitted zero candidates because nothing
could score that high with the detector stack switched off. The tool whose
entire job is "what does floor X admit?" returned n = 0 for every floor above
0.60. It now returns 37/28/19.

Read the win rates as directional only — the largest resolved sample here is
n = 48, well under the n ≥ 30 per-cell bar Phase C sets, and 5d/15m is one
week of tape. Do **not** move `APLUS_RULES.confluenceFloor` off this table.
Re-baseline over a longer range before treating any of it as evidence.

**For whoever owns `src/components/lab/replay-report.tsx`** (not touched here):
the UI should state that stored `engine_runs` rows of kind `'replay'` written
before this change describe the detector-off scorer and are not comparable to
new ones. A run marker / date cutoff in that component is the cheap fix.

---

## A2 — the mechanical sequence can now die

`detectors.ts` had **zero** reset/timeout logic. A sequence that reached
`swept` stayed `swept` forever, and because the selection rule ranked purely by
state (recency was only a tiebreak *within* an equal rank) a `retest_ready`
from 350 bars ago permanently outranked a fresh `inverted`.

### New constants (both named, commented, exported)

| Constant | Value | Meaning |
|---|---|---|
| `MM_MAX_ARMED_AGE` | 24 bars (6h at 15m) | armed sequence (`displaced`/`inverted`/`retest_ready`) expires if the retest never arrives |
| `MM_MAX_COMPLETE_AGE` | 8 bars (2h at 15m) | a completed retest stops being a live signal |

The displacement-window expiry reuses the existing `MM_DISPLACE_WITHIN` (6) —
no new knob.

### New fields on `MechanicalSequence`

```ts
complete: boolean;       // NOW MEANS legsComplete && alive
legsComplete: boolean;   // raw four-leg presence, diagnostics only
alive: boolean;          // not expired, not invalidated
invalidation: MechanicalInvalidation | null;
ageBars: number;         // most recent leg → last bar
```

**`complete` changed meaning.** It used to mean "all four legs present"; it now
means "all four legs present *and still live*". This is deliberate: `complete`
is the field the scorer reads, so a dead model must not light it.
`legsComplete` preserves the old semantics for anything that wants it.
Downstream readers of `.complete` — `scanner.ts:193`, `market-narrative.ts:276,
288,305`, `session-backtest.ts:846` — all pick up the corrected behaviour with
no edits, which is the intent.

### Invalidation rules, in evaluation order

1. `structure_break` — price **closed** beyond the sweep's own wick extreme.
   That level is what the model is predicated on holding (it is also the
   trade's stop). Scanned from the bar after the sweep, i.e. it applies before
   arming too.
2. `contrary_sweep` — the opposite pool was swept after this sequence armed.
3. `displacement_window_closed` — `swept` with no qualifying displacement
   inside `MM_DISPLACE_WITHIN` bars. Leg 2 can never arrive; the sequence is
   structurally dead.
4. `stale_armed` — armed longer than `MM_MAX_ARMED_AGE` with no retest.
5. `stale_complete` — retest older than `MM_MAX_COMPLETE_AGE`.

Price-action invalidation is checked before mere ageing so the reported reason
is the informative one.

### New selection rule

```
ALIVE first  →  then state rank  →  then recency
```

A dead sequence is still *returned* (with the furthest state it reached plus
`invalidation`) when nothing live exists, so the desk can say **why** there is
no mechanical setup rather than silently showing `idle`. `idle` is seeded
`alive: false` so any live sequence beats it outright.

### Measured effect on real bars

Walking every prefix of the cached MNQ/ES series:

| Book | prefixes with a sequence | reported sequence is dead | dead **and** `legsComplete` (old code would have set `complete: true`) | genuinely live complete | oldest dead pick |
|---|---|---|---|---|---|
| MNQ | 275 | 133 (48.4%) | **104** | 6 | 80 bars (20h) |
| ES | 275 | 174 (63.3%) | **50** | **0** | 148 bars (37h) |

Invalidation reasons: `structure_break` 127/164, `contrary_sweep` 6/10.

**Behaviour change the integrator must expect:** the `mechanical_model`
component (engine weight 0.14, the highest in `engine-weights.ts`) will fire
far less often. On this week of tape ES had **zero** genuinely live complete
mechanical models across five sessions, where the old code would have reported
50. Fewer mechanical setups on the desk is the *correction*, not a regression —
those 154 were expired or already stopped out. If the desk suddenly looks
quiet, this is why.

The synthetic proofs (deleted with the harness) confirmed each threshold
exactly: alive at `ageBars` 24, dead at 28 for `stale_armed`; alive at 3, dead
at 20 for `displacement_window_closed`; and in the ancient-`retest_ready`
vs fresh-`inverted` construction the detector flipped from reporting a 325-bar-old
LONG to the 5-bar-old SHORT.

---

## A3 — one scorer

`scanner.ts` now exports:

```ts
export function scoreCandidates(
  left: HtfBiasRead,
  right: HtfBiasRead,
  clock: SessionClock,
  opts: ScoreCandidatesOptions = {},   // { divergence?, leftBars?, rightBars? }
): ScanResult
```

`scanSetups(left, right, clock, divergence?, leftBars?, rightBars?)` still
exists with its exact original signature and now does nothing but forward to
`scoreCandidates`. **Existing callers are untouched** —
`build-desk.ts:173`, `session-backtest.ts:722` and `session-backtest.ts:889`
all still compile and behave identically (verified: the positional call and the
options call produce byte-identical `ScanResult` on the same inputs).

Callers now differ only in what they pass. For contrast, on the same bars:

| Call shape | best confluence | conditions |
|---|---|---|
| with bars (live / backtest / replay today) | **0.6666** | trending / normal, tradeable |
| without bars (the pre-A1 replay shape) | 0.3700 | dead / low, **not** tradeable |

**Convention for anyone adding a scoring component:** add it inside
`scoreCandidates`. Do not add a parameter to `scanSetups` — extend
`ScoreCandidatesOptions` instead, so every caller gets the field or explicitly
omits it.

Two liveness gates were added inside the scorer at the same time:

- `mechanical_model` — unchanged code, but `det.mechanical.complete` now
  implies alive (see A2).
- `sweep_significant` — now requires `det.mechanical.alive`. Previously a sweep
  whose sequence had been dead for hundreds of bars kept lighting it.

Still open from ROADMAP A3: a unit test asserting identical output across all
four entry points. The repo's `npm run test` runner only globs
`scripts/**/*.test.mjs`, and `scripts/` is outside this phase's file ownership,
so the assertion was made with a throwaway harness instead. Whoever owns
`scripts/` should port it — it is ~20 lines.

---

## A4 — the dead second paper engine is gone

Verified by grep before deleting:

- `src/lib/trading/paper.ts` — 280 lines, 16 exports. Reachable only via one
  **type-only** import in `bridge/paper-server.ts`; every runtime export
  (`evaluatePaperCycle`, `buildIntent`, `evaluateOpenTrade`, …) was called only
  from within the file itself.
- `commitPaperCycle` — zero callers.
- `paperPnl` — called only by `commitPaperCycle`.

All deleted. `PAPER_SOURCE` and `PaperCommitResult` went with them (no external
users). The `computeTradePnl` import is gone with `paperPnl`.

**Kept and unchanged:** `listOpenPaperTrades`, `getBridgeStatus`,
`togglePaperMode`, `PAPER_MODE`, `BridgeStatusPayload`, `BridgeStatusError`.
`bridge-status.tsx` imports `getBridgeStatus` + `togglePaperMode` and is
unaffected.

The `OpenPaperTrade` interface was the only type still needed; it is now
declared inline in `paper-server.ts`.

⚠️ **Naming trap left in place:** there are two different functions called
`listOpenPaperTrades`. The server one (`bridge/paper-server.ts`) reads
`desk_trades`; the desk-UI one (`trading/paper-manager.ts`) reads the
localStorage book and is what `routes/index.tsx`, `veteran-brain.ts` and
`paper-book-panel.tsx` actually call. A comment now flags this at the server
definition. Note that the server-side `listOpenPaperTrades` currently has **no
importers at all** — it survives only because it is a live server fn and this
phase was scoped not to change the bridge's API surface. It is a candidate for
deletion once ROADMAP D1 ("one world, not two") decides whether the paper book
lives in localStorage or the DB.

The live paper loop is `src/lib/trading/paper-manager.ts`. There is now exactly
one paper engine.

---

## What to do next

1. Re-run the replay from the Lab and **re-baseline**. Discard every stored
   `engine_runs` row of kind `'replay'` written before this change.
2. Expect a quieter desk (A2). If mechanical setups look too rare over a longer
   sample, the knob to revisit is `MM_MAX_ARMED_AGE`, not the invalidation
   rules — `structure_break` accounted for ~95% of deaths and it is the trade's
   own stop level.
3. ROADMAP A3's unit test still wants a home in `scripts/`.
4. Phase A does not change live trading behaviour beyond the two liveness gates
   in the scorer. B1 (`pathTakeGate` on the live open path) is still the item
   that makes backtest and live comparable.
