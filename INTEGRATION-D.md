# INTEGRATION-D — Phase C (evidence)

ROADMAP Phase C: the per-strategy scoreboard (C1), the regime matrix (C2),
promotion/demotion by measurement (C3), and the per-symbol read that gates book
coverage (C4).

Files touched — nothing else in the repo was edited:

| File | Change |
|---|---|
| `migrations/0008_strategy.sql` | **new** — `desk_trades.strategy`, `desk_trades.regime`, two partial indexes |
| `src/lib/journal/analytics.ts` | C1/C2/C3 aggregates + `strategyVerdict` (pure) |
| `src/lib/journal/analytics-server.ts` | reads the two new columns; adds them to the CSV export |
| `src/components/journal/analytics-panel.tsx` | scoreboard, matrix, verdict pills, prominent per-symbol block |

`AnalyticsPanel` is already mounted in the "risk" category of
`src/routes/index.tsx`. **No route change is required** — the new sections
render inside the existing panel and take no new props.

---

## The one thing that matters

The desk has **n = 0 measured trades**. Everything below is built so that stays
visible rather than getting papered over. Three independent gates, all of which
render `—` rather than a number:

| Gate | Constant | Value | Governs |
|---|---|---|---|
| Bucket readable | `MIN_MEANINGFUL_N` | 20 | win rate, profit factor, every matrix cell |
| Strategy claim | `MIN_STRATEGY_N` | 30 | per-strategy **expectancy**, promotion |
| Full sample | `STATISTICALLY_MEANINGFUL_N` | 100 | the panel-wide "not proven" banner |

A strategy at n=29 shows its win rate and its net PnL but its expectancy column
reads `—`, because expectancy is the number that makes someone abandon a model.

Verified against a seeded PGLite database (migrations applied in order, synthetic
closed trades, real `buildAnalytics`): a `patty` row at **n=2 / 100% WR / +2.00R
raw** renders `win —`, `expectancy —`, matrix cell `—`, verdict
`insufficient-data`. That was the point of the exercise.

---

## 1. The migration (0008)

```sql
alter table desk_trades add column if not exists strategy text;
alter table desk_trades add column if not exists regime text;
```

Plus `desk_trades_strategy_idx` and `desk_trades_regime_cell_idx`, both partial
on `status = 'closed'`.

- Nullable, no backfill, no default. Rows written before this migration
  genuinely have no attribution; defaulting them to `'mechanical'` /
  `'trending'` would fabricate the exact evidence Phase C exists to measure.
- Additive only — `add column if not exists` — so its position between
  `0007_alerts.sql` and `0009_shadow.sql` (both landed by other agents while
  this was in flight) is irrelevant. It applies once via `scripts/migrate.mjs`
  on deploy and via the PGLite pass in `src/lib/db.ts` in preview. Confirmed
  applying cleanly in a fresh PGLite run alongside 0001–0009.
- Existing migrations were not modified.

## 2. Wiring the writers — **the integrator owns this**

Until a writer populates the columns, the scoreboard correctly reports **0
attributed trades** and the matrix renders empty with the note *"This is a
wiring gap, not a trading result."* That message is deliberate: it distinguishes
"nothing traded" from "nothing recorded".

Three insert sites, none of them mine:

**`src/lib/journal/server.ts`** (`logTrade`, ~line 370) — add `strategy`,
`regime` to the column list and the params array, and to the input schema:

```ts
strategy: z.string().max(64).nullable().optional(),   // SetupCandidate.strategyPrimary
regime:   z.enum(["trending", "ranging", "dead"]).nullable().optional(), // MarketConditions.regime
```

Both values are already on the scanner output at log time —
`candidate.strategyPrimary` and `scan.conditions.left.regime` (or `.right` for
the ES book). `log-setup-dialog.tsx` already has the candidate in hand.

**`src/lib/journal/paper-mirror.ts`** (`mirrorPaperOpen`, ~line 60) — its
`openSchema` **already accepts `strategy`** but currently folds it into the
`reason` column (`data.reason ?? data.strategy ?? null`). Change it to write the
real column and add `regime` alongside.

**`src/lib/bridge/paper-server.ts`** (~line 138) — same two columns from the
engine payload if it carries them; leave null if it does not. Null is honest.

Values must be the raw ids, not labels: `mechanical`, `blake_mech`, `tjr`,
`judas`, `pdi`, `patty`, `continuation`, `ronan`, `smt` (see
`STRATEGY_TEMPLATES` in `src/lib/trading/strategy-grade.ts`); regimes
`trending | ranging | dead`; killzones `asia | london | ny_am | ny_lunch |
ny_pm | dead`. The matrix orders its axes by those exact ids.

## 3. C3 handoff — `strategyVerdict` replaces the hardcoded blake demotion

`src/lib/trading/profit-rules.ts` is **not mine and was not touched.** It
currently hardcodes:

```ts
export const DEMOTED_LONG_STRATEGIES = ["blake_mech"] as const;
export function blakeLongRecovered(c: BookCounters): boolean { … n >= 15 && WR >= 0.55 }
```

That is somebody's memory of a bad week compiled into a constant. It demotes one
named strategy, in one direction, on a win-rate threshold that no sample chose.
The replacement is measured and applies to every model equally:

```ts
import { strategyVerdict } from "@/lib/journal/analytics";

const v = strategyVerdict("blake_mech", closedBlakeTrades); // any length, any order
// v.verdict: "promote" | "demote" | "hold" | "insufficient-data"
// v.n, v.measuredN, v.expectancyR, v.winRate, v.netPnl, v.tradesNeeded, v.reason
```

Rules, in evaluation order (all constants exported from `analytics.ts`):

1. `n < MIN_VERDICT_N` (20), or no trade in the window carried a defined R →
   **insufficient-data**. Nothing changes. This is the common case today.
2. trailing-30 expectancy `< 0` → **demote**.
3. `n >= MIN_STRATEGY_N` (30) **and** expectancy `> PROMOTE_EXPECTANCY_R`
   (+0.20R) → **promote**.
4. otherwise → **hold**.

The asymmetry is deliberate. Demotion reduces exposure, so it clears at n≥20;
promotion adds it, so it needs n≥30. Neither fires below 20: a −0.40R read over
n=3 is the same noise as a +100% win rate over n=2, and acting on it retires a
working model on three unlucky fills.

`strategyVerdict` is pure, total and takes the trailing 30 by close time itself
— a caller cannot hand it a stale or unsorted window. `strategyVerdicts(trades)`
returns one verdict per attributed strategy and is already on every
`AnalyticsReport` as `verdicts`.

**Suggested handoff** (integrator's call, `profit-rules.ts` is not mine): have
`pathTakeGate` read a verdict map instead of `isBlakeLongDemoted`, treating
`demote` as the existing `forceBand: "B+"` path and `insufficient-data` as "no
opinion — leave the current band alone". Until the sample exists, every verdict
is `insufficient-data`, so swapping it in changes **no behaviour today** — which
is the safe way to make the swap.

## 4. C4 — no new instruments

Nothing was added. `bySymbol` is now rendered as its own block at the top of the
report body (`Per-symbol expectancy · book coverage`) instead of one table among
six, with each symbol's distance to the 30-trade bar on its face, and a readout
line that states the rule:

> Book coverage: no instrument has reached n=30 (largest MNQ, n=25). Do not add
> instruments — the current book is unproven.

(verbatim from the seeded run; with a real book the numbers change, the rule
does not). Once every symbol clears n=30 positive, the line flips to *"Instrument
count is now a data question rather than a guess"* — which is the only condition
under which C4 unlocks.

## 5. What the panel gained

- **Per-symbol expectancy** — stat tiles, `—` below n=20, "N more to the bar".
- **Per-strategy scoreboard** — n · win · net · PF · expectancy (gated at 30) ·
  trailing-30 verdict pill (hover for the numbers). Unattributed trades are
  counted in a warning line under the table, never bucketed into a fake row.
- **Regime matrix** — rows are strategy × regime, columns are killzones, every
  cell carries its own `n`, `—` below 20. Underneath it, a red **"Stop taking
  these"** list of the readable losing combinations, worst first. On the seeded
  run that list read exactly:
  `mechanical · dead · ny lunch = -0.40R over 40 trades`.
- The old standalone `By symbol` table was removed from the six-table grid (it
  is now the prominent block); pre-score, killzone, grade, side and weekday are
  unchanged.

## 6. Verification

Throwaway harness (written, run, deleted): seeded a fresh PGLite instance,
applied `migrations/*.sql` 0001→0009 in order, inserted 147 synthetic closed
trades — 97 live across 2 strategies × 2 regimes × 2 killzones plus an n=2 /
100% WR trap and 5 unattributed rows, 50 paper under a different strategy — then
read them back through the exact SQL and row mapping in `analytics-server.ts`
and ran the real `buildAnalytics`. 17/17 checks passed:

- n=2 / 100% WR renders `—` for win rate, expectancy and its matrix cell;
  verdict `insufficient-data`.
- Strategy expectancy hidden for every strategy below n=30, shown at or above.
- Live report `n=97`, strategies `[mechanical, tjr, patty]`; paper report
  `n=50`, strategies `[judas]`. No leakage in either direction.
- `mechanical` (trailing-30 −0.40R) → **demote**; `tjr` (trailing-30 +0.27R at
  n=30) → **promote**.
- The n=8 losing cell stayed out of the "stop taking" list; the n=40 one is in it.

`npm run typecheck` — 0 errors. `npm run lint` — 0 errors (38 pre-existing
warnings elsewhere in the repo; the three owned files report 0 problems).

## 7. Known limits

- Every number is `—` until trades accumulate. That is the design, not a defect.
- Attribution is not retroactive. Trades logged before the writers are wired
  stay unattributed forever and are reported as such.
- The scoreboard is all-time within the analytics window; the verdict is
  trailing-30. They are labelled separately in the UI and can legitimately
  disagree — a model can be positive over 60 trades and demoting over its last 30.
- `strategyVerdict` weighs every trade in the window equally. No decay, no
  regime adjustment. Adding either before there is a sample would be fitting to
  noise.
