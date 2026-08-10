# INTEGRATION-P2 — wiring instructions for the desk/scanner integrator

Phase 2 ("one confluence language") shipped three self-contained pieces WITHOUT
touching the files other agents own (`structure.ts`, `scanner.ts`,
`sessions.ts`, `build-desk.ts`, `index.tsx`, desk components, `market/**`).
This file tells the integrator exactly where to mount and wire them.

## What shipped

| Piece | Files |
|---|---|
| OHLC detectors | `src/lib/trading/detectors.ts` |
| Engine ingest | `migrations/0003_engine.sql`, `src/lib/engine/ingest.ts`, edits in `src/components/dashboard/aplus-ops.tsx` (owned by P2) |
| Replay calibration harness | `src/lib/trading/replay.ts`, `src/lib/engine/replay-server.ts`, `src/components/lab/replay-report.tsx` |

## 1. Mount `ReplayReport` in the Lab section

In `src/routes/index.tsx`, the Lab area (the collapsible `showLab` block that
renders `<AplusOps />`) should also render the replay report:

```tsx
import { ReplayReport } from "@/components/lab/replay-report";
// inside the Lab section, below <AplusOps />:
<ReplayReport />
```

No props needed. It loads the latest stored run (`engine_runs` kind
`'replay'`) on mount and has its own "Run replay" button (server fn
`runReplay` — authenticated, fetches real 5d/15m Yahoo bars for MNQ+ES).

## 2. Engine upload is already mounted

The upload control lives inside `AplusOps` (bottom section, all tabs). The
backtest and premarket tabs automatically prefer the latest ingested engine
run over the demo builders and show a green "live engine data · ingested …"
badge; without a run they show the amber DEMO DATA banner. Nothing to wire.

To push data without the UI, call the server fn
`uploadEngineRun({ data: { kind, label?, payload } })` from
`src/lib/engine/ingest.ts` — kinds: `backtest` | `knowledge` | `premarket`
(| `replay`, used by the harness). Payloads are zod-validated against the
shapes in `src/lib/aplus/` (tolerant passthrough of extra fields, hard-fail
on missing core fields).

## 3. Extending the scanner pre-score with detectors (future step)

`summarizeDetectors(bars)` from `src/lib/trading/detectors.ts` returns
counts + latest instances shaped for the scanner. Suggested wiring inside
`scanSetups`'s `build()` (or a wrapper that runs before it):

```ts
import { summarizeDetectors } from "./detectors";
const det = summarizeDetectors(read === left ? leftBars : rightBars);
```

Note: `scanSetups` currently receives only `HtfBiasRead`s — the integrator
must either thread the raw `OhlcBar[]` into it (signature change in
`build-desk.ts` + `scanner.ts`) or compute `summarizeDetectors` in
`build-desk.ts` and pass the summary alongside the bias reads.

Suggested score increments, taken from the engine's display weights in
`src/lib/aplus/confluence.ts` (`COMPONENT_WEIGHTS`) — keep the total headroom
in mind (base 0.22 + existing components already reach ~0.98):

| Detector signal | Condition (long side; mirror for short) | Suggested weight | Engine component |
|---|---|---|---|
| Mechanical model | `det.mechanical.complete && det.mechanical.direction === "long"` | **0.14** | `mechanical_model` (highest weight; fires 4.5% — refuse partials, `complete` flag already enforces that) |
| iFVG | latest inverted FVG acting bullish (`kind === "bear" && inverted`), better with `inversionRetested` | 0.08 | `ifvg` (fires 100% — low info alone, cap the credit) |
| Order block | `det.orderBlock.latest?.kind === "long-side"` (`"bull"`) and `!mitigated` | 0.07 | `order_block` (cold — engine detected 0%) |
| Displacement | `det.displacement.latest?.direction === "bull"` recent (e.g. within 12 bars) | 0.05 | `displacement` |
| Sweep (significant) | `det.sweep.latest?.side === "sellside"` recent | 0.10 | `sweep_significant` — the scanner already scores sweeps off liquidity pools (0.12); replace, don't double-count |

If these are added, either rebalance the existing ad-hoc increments in
`scanner.ts` so the sum of all possible credits stays ≤ ~1.0, or normalize
the final score. Do NOT let any detector bypass the HTF top-down gate — it
remains absolute (CLAUDE.md).

All detector thresholds are documented constants at the top of
`detectors.ts` (`DISPLACEMENT_K = 1.5`, `FVG_MIDDLE_BODY_ATR = 1.0`,
`MM_DISPLACE_WITHIN = 6`, `OB_SCAN_BACK = 3`, `MM_SWING_WIDTH = 3`,
`ATR_PERIOD = 14`).

## 4. Replay harness — API surface for the standalone automation project

- `replayScan(bars, peerBars, { symbol, peerSymbol, maxBars?, warmupBars?, cooldownBars? })`
  → `ReplayOutcome[]` — pure, deterministic, no network.
- `calibrationReport(outcomes)` → buckets (0.4–0.5 / 0.5–0.6 / 0.6–0.7 / 0.7+)
  plus cumulative floor rows (0.50 TEST, 0.60, 0.67 calib, 0.70, 0.75) with
  n / fill rate / win rate at 1R and 2R / expectancy — this answers "what
  does floor 0.50 vs 0.67 admit" with data.
- `runReplay()` (server fn) persists each run to `engine_runs` kind
  `'replay'`; `latestEngineRun({ data: { kind: "replay" } })` reads it back.

Honesty caveats baked into both code comments and the UI: 15m Yahoo bars,
conservative same-bar stop rule (stop checked first; fill-bar target hits
never counted), entry at the zone's proximal edge (EQ), no
slippage/commission — directional evidence only, not a backtest.
