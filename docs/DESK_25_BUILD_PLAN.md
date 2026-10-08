# The 25-item work order: one build plan

Generated 2026-10-08 from a read-only analysis of the tree at fd57236: seven agents, one per file group, then a synthesis pass that re-checked every repo claim against the tree and says so with the line where a group report was wrong.

This is the plan of record. Waves are ordered by dependency. An agent that does not OWN a file raises the edit as a need rather than making it — six files are claimed by several groups and each has exactly one owner below.

---

# LEDGER-DESK — ONE BUILD PLAN FROM SEVEN REPORTS

**Read-only pass. Nothing was edited.** Repo claims below were re-verified against the tree at `fd572361`; where a report was wrong I say so and give the line.

## 0. COVERAGE CHECK

All 25 items appear in a report. None is missing:
- detectors → 5, 6, 7, 12, 15
- master → 1, 10, 11, 13, 14, 16, 24
- rh-cycle → 2, 3, 4, 22
- options-desk → 8, 9, 23, 25
- backtest → 18 (five sub-entries)
- memory-news-lag → 17, 20, 21
- close-job → 19 (seven sub-entries)

## 0b. UNOWNED / MULTI-CLAIMED FILES — ONE AGENT EACH

The earlier pass named two. There are **six**. Assignment is binding; an agent that is not the owner raises the edit as a need, it does not make it.

| File | Claimed by | Owner | Wave | Why this owner |
|---|---|---|---|---|
| `src/lib/trading/raid-pair.ts` (146 ln) | detectors (items 5, 6, 12) | **detectors agent** | 1 | All three edits are mechanical consequences of detector signatures (`confirmWindowBars`, `disp.leftGap`, `armingSweep`). The file imports only `detectors.ts`. No other group needs it. |
| `src/lib/trading/scanner.ts` (1220 ln) | master, memory, detectors, backtest | **pipeline agent** | 2 | Items 21-B1 (split `scoreDirection`'s `bars` into `bars`+`closed`), 14/24 (`add("htf_gap")`, `add("or_raid")`), 15 (`blake_swing`), 5 (`born`/`flipped`) and the backtest `nowMs` thread all land **inside `scoreDirection`** (`scanner.ts:377-393`, `:655-659`, `:724-738`). Split across agents = guaranteed conflict in one function. |
| `src/lib/trading/build-desk.ts` | memory (558-700, 824-905), options (chain attach), master (ordering) | **pipeline agent** | 2 | The `scanSetups` call is `build-desk.ts:670`; `gradeSmcMaster` `:1052`; `attachPlansToCards` `:1062`. Verified. One hand owns the call order. |
| `src/lib/trading/engine-weights.ts`, `strategies.ts`, `strategy-grade.ts` | detectors (`blake_swing`), master (`htf_gap`, `or_raid`, `silver_bullet`) | **pipeline agent** | 2 | Component registry + templates must agree with what scanner emits. Three writers into `RAW_WEIGHTS` is how a key gets lost. |
| `src/lib/trading/smt-level.ts` | master (offered), nobody owns | **master agent** | 2 | 4-line `led: boolean \| null` from the `thisLed` already computed at `:154`. |
| `src/lib/execution/rh-cycle.ts`, `rh-dispatch.ts`, `rh-tools.ts` | **rh-cycle group AND close-job group both claim these** | **single rh-exec agent** | 1 | Not flagged in the task but the worst collision in the set: item 2 adds four required `RhHeld` fields and rewrites the exit ladder while item 19.3 rewrites `placeOrder`'s ledger write and item 19.2 reorders `room-step.ts`. Two agents on `rh-cycle.ts` in one commit is unmergeable. Merge the two groups into one agent. |
| `src/lib/trading/paper-manager.ts` | memory (item 17, five optional fields) | **memory agent** | 1 | Additive, optional, back-compat pattern already there (`cardBand`, `killzone`). |

---

## 1. BUILD ORDER

### WAVE 1 — leaves. No file is read by another Wave-1 agent.

**1A · detectors agent** — `src/lib/trading/detectors.ts`, `src/lib/trading/raid-pair.ts`, `scripts/verify-detectors.mjs` (NEW).
Items 5, 6, 7, 12, 15. First because every other wave consumes its exports. There is **no detector verifier in the repo today** (101 `verify-*.mjs`, none covers `detectors.ts` directly); the four that import it — `verify-sponsored-gap` 41/41, `verify-curriculum` 193/193, `verify-judas-window` 33/33, `verify-desk-enhancements` 168/168 — must all stay green.

**1B · rh-exec agent** — `src/lib/execution/rh-cycle.ts`, `rh-dispatch.ts`, `rh-tools.ts`, `rh-mcp.ts`, `rh-autofire.ts`, `rh-autofire-gates.ts`, `rh-oauth.ts`, `rh-ledger.ts`, `rh-server.ts`, `rh-http.ts`, NEW `rh-runner.ts` / `rh-cron-user.ts` / `rh-close-claim.ts`, `src/routes/api/cron/room-step.ts`, `src/routes/api/rh/*`, `src/lib/room/manager-live-loop.ts`, `docs/RH_LIVE_ROUTINE.md`, `scripts/verify-rh-cycle.mjs` / `verify-rh-dispatch.mjs` / `verify-rh-oauth.mjs` / `verify-rh-closer.mjs` (NEW).
Items 2, 3, 4, 19, 22. Independent of the trading rule set — touches no gate, no band, no score, nothing in `config.ts`. Ships on its own clock.

**1C · memory agent** — `src/lib/trading/news.ts`, `src/data/news-coverage.json` (NEW), `src/lib/news/calendar-live.ts` (NEW), `src/lib/trading/pool-ledger.ts` (NEW), `src/lib/market/freshest.ts`, `src/lib/trading/desk-memory.ts`, `src/lib/trading/paper-manager.ts`, `src/lib/room/desk-atlas.ts` (close-node + edge path only), `src/routes/api/cron/news-calendar.ts` (NEW), `scripts/verify-news-coverage.mjs`, `verify-setup-memory.mjs`, `verify-school-brief.mjs`, `verify-live-gateway.mjs`.
Items 17, 20, 21-B2. Item 21-B1's one-line call site is **deferred to Wave 2** because `build-desk.ts` belongs to the pipeline agent.

### WAVE 2 — the hub. Lands as ONE merge; the tree does not compile until both branches are in (that is the intended handshake).

**2A · pipeline agent** — `scanner.ts`, `build-desk.ts`, `engine-weights.ts`, `strategies.ts`, `strategy-grade.ts`, `scripts/verify-desk-enhancements.mjs`.
Consumes 1A's exports (`confirmWindowBars`, `detectBlakeSwing`, `InducementRead.armingSweep`, `leftGap`). Delivers: closed-bar detection (21-B1), new components `blake_swing` / `htf_gap` / `or_raid`, `StrategyId += "silver_bullet"`, the `closed` 9th arg, `nowMs` threaded into `readLtfReaction` (`scanner.ts:659` currently defaults to `Date.now()`), the optional `desk.chain` field (null) so Wave 3 can land half-wired, and **preservation of the `scanSetups → gradeSmcMaster → attachPlansToCards` order**.

**2B · master agent** — `smc-master.ts`, `smc-canon.ts`, `card-plan.ts`, `score-drivers.ts`, `smt-level.ts`, `scripts/verify-card-plan.mjs`, `scripts/verify-score-drivers.mjs`, `scripts/verify-smc-master.mjs` (NEW — the canon and the master have no verifier today).
Items 16, 1, 10, 11, 13, 14, 24. Disjoint from 2A by file. Depends on 2A only for `RAW_WEIGHTS` keys existing; `verify-score-drivers.mjs` check 8 (`d.length === COMPONENT_KEYS.length`) is the pre-written negative control for a key added without a label.

### WAVE 3 — consumers of the Wave-2 contract.

**3A · options agent** — `options-desk.ts`, `sleeve-sizing.ts`, `spot-cross.ts`, `scripts/verify-sleeve-sizing.mjs`, `options-desk-cap.test.mjs`, `verify-spot-cross.mjs`, `verify-sleeve-migration.mjs`.
Items 8, 9, 23, 25. Needs `RH_LIMIT_SLIP → 0` (Wave 1B) and `desk.chain` (Wave 2A) + a server-side chain fetch.

**3B · room/exec consumers** (optional, display only) — `src/components/room/exec-card.tsx`, `desk-atlas.ts` wire card reading `c.plan.levels` instead of re-parsing strings.

### WAVE 4 — measurement. Must be last.

**4 · backtest agent** — `session-backtest.ts`, `scripts/measure-*.mjs`, NEW `scripts/measure-walkforward.mjs` / `verify-walkforward.mjs`, `src/data/walkforward-report.json`.
Item 18. The re-capture is ~45 min wall clock (12 chunks × 7,806 bars at ~3 bar/s, parallel, offline, zero Databento spend) and **every rule change in Waves 1–3 invalidates it**. One capture after the last rule change, not one per group. Write to `.cache/signals-wf`; do **not** overwrite `.cache/signals` — those 12 chunks (5,049 rows / 93,669 bar-scans, captured 2026-09-24, i.e. pre-`fd57236`) are the only record of pre-tightening behaviour.

### WAVE 5 — re-fit, same agent as Wave 4.

`scripts/build-hit-odds.mjs` and `scripts/build-evidence-pack.mjs` re-run, because **item 1 changes the target rule the shipped P(T1) model was fit on**. `capture-signals.mjs:229` records `t1: p.t1` = `book.plan.t1` = today's `draw.primary`; `build-hit-odds.mjs:90` drops `t1 == null` and fits M0 on "T1 distance in R + stop band". Moving T1 to the next unswept pool systematically lengthens T1 in R, so the card's headline P(T1) is calibrated on a rule that no longer exists until this re-runs. If the re-fit prices the new rule worse, **write it down; do not revert by re-adding a level that was never liquidity.**

---

## 2. SHARED CONTRACTS

Discipline, uniform across waves: **new `RhHeld` / `DisplacementEvent` / `SweepEvent` fields are REQUIRED** (a missed construction site is a compile error); **new `DeskOpen` and `CardPlan` fields are OPTIONAL** (persisted ledger rows and ~40 `c.plan` readers must still load).

### 2.1 The single plan object (item 16 / 1) — `card-plan.ts`, owner 2B

```ts
export type DeskLevelKind = "raid" | "entry" | "stop" | "partial" | "draw" | "runner";
export interface DeskLevel { kind: DeskLevelKind; price: number; label: string }
export interface DeskPool {
  price: number; name: string;
  /** draw.ts RawLevel kind: "pool"|"external"|"prior"|"weekly"|"session"|"range"|"open" */
  kind: string; swept: boolean;
  /** Excursion rate, not the race. Null below the base-rate floor. */
  reachProbability: number | null;
}
export interface RestableLevels {
  symbol: string; side: "long" | "short";
  entry: number; stop: number;
  partial: number | null; t1: number | null; t2: number | null;
  riskPts: number; entryZone: { top: number; bottom: number } | null;
}

// CardPlan gains, ALL OPTIONAL:
//   raid?: { price: number; t: number | null } | null;
//   partial?: number | null;          // EQ of the IMPULSE LEG, never the 80-bar box
//   drawPool?: DeskPool | null;       // what T1 IS
//   runnerPool?: DeskPool | null;     // what T2 IS
//   levels?: DeskLevel[];             // DERIVED in cardPlanFrom, ordered raid→entry→stop→partial→draw→runner

export const LOCATION_KINDS: ReadonlySet<string>;   // {"range","open"} — never a draw on liquidity
export const EXTERNAL_KINDS: ReadonlySet<string>;   // {"external","prior","weekly"} — the runner's class
export function drawPoolsForSide(
  draw: DrawRead, side: "long" | "short" | null, entry: number | null,
): { t1: LiquidityTarget | null; t2: LiquidityTarget | null; why: string };

export function cardPlanFrom(
  plan: TradePlan,
  extras?: { partial?: number | null; drawPool?: DeskPool | null; runnerPool?: DeskPool | null },
): CardPlan;
// attachPlansToCards signature UNCHANGED; its side effect widens from
// invalidation+plan to invalidation+plan+targets+draw. Document in the header.
```

**Hard ordering contract:** `attachPlansToCards` (build-desk.ts:1062) overwrites `c.targets` and `c.draw` after `scanSetups` (:670) wrote them. Verified order today. **2A must not move or re-run the scanner's target write later in the pipeline**, or 2B's overwrite is silently discarded and the three-first-targets bug returns. The verifier asserts `firstNum(c.targets[0]) === c.plan.t1` on a **fully built desk payload**, not only on a hand-built card.

### 2.2 Detectors (owner 1A)

```ts
// Timebase — the two helpers items 5, 6, 7 and 15 all need
export function barMinutes(bars: OhlcBar[]): number;                 // median positive Δt, NaN under 2 bars
export function windowBars(bars: OhlcBar[], minutes: number, fallbackBars: number): number;
export const MM_CONFIRM_WITHIN_MIN = 25;
export function confirmWindowBars(bars: OhlcBar[], minutes?: number): number;
/** @deprecated bar count; the live window is MM_CONFIRM_WITHIN_MIN */
export const MM_DISPLACE_WITHIN = 6;
export const SWEEP_CLUSTER_BARS = 6;        // gradeSweepQuality, value unchanged
export const MITIGATION_CONFIRM_BARS = 6;   // detectMitigationBlock, value unchanged
export function closedBars(bars: OhlcBar[], minutes: number, nowMs: number): OhlcBar[]; // ONE definition, shared with ltf-reaction.ts

// Displacement
export type DisplacementRule = "gap" | "body" | "either";
export const DISPLACEMENT_RULE: { value: DisplacementRule };   // MUTABLE, sweep-script convention
export const DISP_HELD_WITHIN_MIN = 360;
export interface DisplacementEvent {
  index: number; t: number; direction: "bull" | "bear";
  bodySize: number; atr: number; ratio: number; open: number; close: number;
  leftGap: { top: number; bottom: number; confirmIndex: number; confirmT: number } | null; // NEW
  held: boolean;              // NEW
  heldThroughIndex: number;   // NEW — lets a caller tell "held so far" from "held through the window"
  rule: DisplacementRule;     // NEW
}

// Raid confirmation on the minute
export type RaidVerdict = "confirmed" | "breakout" | "not_closed" | "no_touch" | "no_tape";
export interface RaidConfirm {
  verdict: RaidVerdict; confirmed: boolean;    // true ONLY on evidence; never for "no_tape"
  throughIndex: number | null; throughT: number | null;
  closedBackIndex: number | null; closedBackT: number | null;
  minutesOutside: number | null; closesOutside: number; reason: string;
}
export function confirmRaidOnMinute(
  minute: OhlcBar[] | null | undefined,
  sweep: Pick<SweepEvent, "side" | "sweptLevel" | "t">,
  opts?: { nowMs?: number; hostBarMinutes?: number; windowMin?: number },
): RaidConfirm;
export interface TapeRungs { m15: OhlcBar[]; m5?: OhlcBar[] | null; m1?: OhlcBar[] | null; nowMs?: number }
export function detectSweepsAcross(rungs: TapeRungs): SweepEvent[];
// SweepEvent gains: tfMinutes: number   (REQUIRED — every sweep says which rung it came from)
export const RAID_CONFIRM_WINDOW_MIN = 25;
export const SWEEP_DEDUPE_ATR = 0.1;

// Inducement — ADD fields, do not redefine existing ones
export const INDUCEMENT_BEYOND_WINDOW_BARS = 16;
export interface InducementRead {
  inducement: boolean;                 // UNCHANGED meaning
  mainSweep: SweepEvent | null; decoy: SweepEvent | null;
  isInducement: boolean;               // NEW: THIS sweep is the trap
  unsweptBeyond: SwingPoint | null;    // NEW
  armingSweep: SweepEvent | null;      // NEW: null while unsweptBeyond is still unswept
}

// Blake
export const BLAKE_WINDOW_BARS = 16;
export const BLAKE_CONFIRM_WITHIN_MIN = 90;
export interface BlakeSwing {
  side: "long" | "short";
  firstExtreme: SwingPoint; pullback: SwingPoint; takenExtreme: SwingPoint;
  closeIndex: number; closeT: number;
  invalidated: boolean; invalidatedIndex: number | null; invalidatedT: number | null;
}
export interface BlakeRead { present: boolean; swing: BlakeSwing | null }
export function detectBlakeSwing(bars: OhlcBar[], side: "long" | "short", opts?: {...}): BlakeRead;
```

`raid-pair.ts` consequences (same agent, same commit): `:51` `sweep.index + MM_DISPLACE_WITHIN` → `+ confirmWindowBars(bars)`; `:35-39 polaritySweep` returns `read.armingSweep`; `:57-67 displacementLeftArray` reads `disp.leftGap` for the gap case and keeps the order-block branch.

### 2.3 Pipeline (owner 2A)

```ts
// scanner.ts — TRAILING OPTIONAL, so a caller that passes nothing behaves exactly as today
export function scanSetups(
  biasL, biasR, clock, divergence, barsL, barsR, smc,
  minutes?: { left?: OhlcBar[]; right?: OhlcBar[] },
  closed?:  { left?: OhlcBar[]; right?: OhlcBar[] },   // NEW
  nowMs?: number,                                       // NEW — kills readLtfReaction's Date.now() default
): ScanResult;
// scoreDirection's single `bars` splits: bars = LOCATION (impulseZone, entry distance,
// dealing zone, overnightRange), closed = DETECTION (polaritySweep, namingSweep,
// biasDisrespect, smtAtLevel). `closedL ?? barsL` fallback everywhere.

// engine-weights.ts — ComponentKey + RAW_WEIGHTS
//   blake_swing: <= the weight `cisd` carries today
//   htf_gap: 0      (the weight-0 gate pattern ltf_reaction/opening_raid already set, :45-48)
//   or_raid: 0
```

### 2.4 Canon / master (owner 2B)

```ts
// smc-canon.ts
export type EtWindow = readonly [number, number];
export interface ModelRequirement {
  id: StrategyId; windows: readonly EtWindow[] | null;
  pool: "overnight_range" | "opening_range_0930_1000" | null;
  requires: readonly ComponentKey[]; note: string;
}
export const MODEL_REQUIREMENTS: Readonly<Partial<Record<StrategyId, ModelRequirement>>>;
export function modelMayBeNamed(
  id: StrategyId, input: { etMin: number | null; components: readonly string[] },
): { ok: boolean; why: string };
export const SMT_TRADES_THE_HOLDER = true;
export const SILVER_BULLET_EVIDENCE: { window: string; measuredR: 0; note: string; grantsSize: false };
export const OTE_SIZE_CUT_EVIDENCE: { deltaR: 0.06; z: 0.43; source: string; wired: false };
// CanonInput gains: smtLed?: boolean | null

// smt-level.ts
// SmtLevelRead gains: led: boolean | null   (from thisLed at :154; null on the NONE constant)

// smc-master.ts
export function eligibleCandidates(scan: ScanResult, bias: HtfBiasRead, narrative: MarketNarrative): SetupCandidate[];
export function pickGradedBook(books: SmcMasterBook[]): SmcMasterBook | null;
// gradeBook (module-private) gains leading `cand` + trailing `isLeft`; `smtOn` REMOVED;
// pickCandidate REMOVED. gradeSmcMaster(desk) and SmcMasterRead UNCHANGED, so
// build-desk.ts:1052, learn/cases.ts, room/school-contract.ts, capture-signals.mjs,
// diagnose-sequence.mjs and build-shadow-replay.mjs compile untouched.
```

### 2.5 Replay (owner 4)

```ts
export type ReplayExitReason = "no_fill"|"stop"|"stop_close"|"failed_hold"|"t1_be"|"t2"|"hold_expiry";
export interface ReplayRule { fillBars: number; holdBars: number; stopOnClose: boolean; failedHold: boolean; tickSlip: number; t1Fraction: number }
export const SEQUENCE_REPLAY_RULE: ReplayRule;  // {12, 32, false, true, 0.25, 0.5} — PINNED
export interface ReplayPlan { side: "long"|"short"; entry: number; stop: number; t1: number; t2: number|null }
export type ReplayOutcome = ReplayFill | { filled: false; reason: "no_fill" };
export function replaySequenceTake(plan: ReplayPlan, forward: OhlcBar[], rule?: ReplayRule): ReplayOutcome;
export interface SlotGrade { label: string; decisionMs: number; word: string; missing: string; confluence: number|null; take: boolean }
export function firstTakeSlot(slots: SlotGrade[]): SlotGrade | null;  // chronological; NEVER sorts by score
export function quotable(report, want: { trading: string; alerts: string; needs1m?: boolean }): { ok: boolean; reason: string };
```
`measure-walkforward.mjs` imports `replaySequenceTake` and `SEQUENCE_REPLAY_RULE` from `session-backtest.ts` — the window replay and the four-year census run **the same function**. That is the whole point of exporting it.

### 2.6 Exec (owner 1B)

```ts
// rh-cycle.ts — RhHeld gains REQUIRED: t1, raidWick, trimmed, close15, markAgeSec, dte, closing
// RhCycle gains: closeQty: number | null; partial: boolean
export const RH_TRIM_FRAC: number;                      // 0.5 = ROOM_MANDATE.takeProfitCloseFrac
export interface RhExitPolicy { levelTrim: boolean; premiumBackstopOnly: boolean }
export const RH_EXIT_POLICY: RhExitPolicy;              // levelTrim FALSE by default
export function rhTrimQty(quantity: number, frac?: number): number;      // 0 under 2 contracts
export function t1Touched(a): boolean;
export function closeThroughRaid(a): boolean;
export function governingStop(h: Pick<RhHeld,"entry"|"stop"|"trimmed">): number | null;  // THE breakeven move
export function markUsable(h: Pick<RhHeld,"mark"|"markAgeSec">): boolean;                // finite age REQUIRED
export function premiumBackstopActive(h): { active: boolean; why: string };
export interface RhArmedSide { underlier: "QQQ"|"SPY"; optionType: "call"|"put"; side: "long"|"short" }
export function armedFlip(h, armed: RhArmedSide | null | undefined): string | null;       // null armed is NOT a flip
export function rhCarryRefusal(h: Pick<RhHeld,"underlier"|"dte">): string | null;
export const RH_CLOSE_MAX_LIMITS = 3;
export function escalateClose(order: RhOrder, held: RhHeld, attempt: number): RhOrder;
// REMOVED: RH_DAY_FLAT_MIN, RH_PAST_ELEVEN_MIN_PCT

// rh-tools.ts — DeskOpen gains ALL OPTIONAL:
//   t1?, raidWick?, trimmed?, closing?, expiry?, dte?, orderId?, fillState?, replaces?
// RhQuote gains optional delta (parsed in rh-mcp.ts:73-80) — item 9 fails closed without it
// RhTooling gains: cancel(orderId), openOrders()

// rh-dispatch.ts — RhDispatchArgs gains userId?: string (absent = no claim = today's behaviour)
// rh-close-claim.ts
export function claimClose(userId: string, note: RhCloseNote): Promise<boolean>;  // one statement, FAILS OPEN
export function closeDedupeKey(optionId: string, attempt: number): string;
// rh-runner.ts
export function runRhCloser(args: { sql; userId; desk: RhCycleDesk|null; nowMs; tooling?; ledger? }): Promise<RhRunnerOut>;
// rh-cron-user.ts
export function rhCronUserId(env?): { ok: true; userId: string } | { ok: false; why: string };
// decideRhCycle args gain: armed?: RhArmedSide | null
```

**Exit ladder, final order** (desk-owned position): `forceClose` → `armedFlip` → 15:30 → `levelHit(governingStop)` → `closeThroughRaid` → `failedHold` (only when `!trimmed`) → T1 trim (PARTIAL) → premium backstop (conditioned) → manage.

### 2.7 Options chain (owner 3A) and freshness / news (owner 1C)

```ts
export type ChainSource = "robinhood" | "alpaca_opra" | "alpaca_indicative";
export interface ChainContract {
  occ: string; brokerId: string | null; underlier: SwingUnderlier; type: OptionSide;
  strike: number; expiry: string; dte: number;
  bid: number | null; ask: number;      // ask > 0 or the row is refused
  delta: number | null;                  // signed, as the chain reports it
  asOfMs: number; source: ChainSource;
}
export interface ChainRead { SPY: ChainContract[]; QQQ: ChainContract[]; asOfMs: number; source: ChainSource }
export const CHAIN_MAX_AGE_MS = 30_000;
export function pickChainContract(chain, req): ChainContract | null;   // refuses; never a neighbour
export function sizeFromChain(args): { ok: true; contracts; eachUsd; totalUsd; lossAtInvalidationUsd; lines }
                                   | { ok: false; reason; wantedContracts; wantedDebitUsd };
export const SKIP_WHEN_WICK_OUTGROWS_CAP = true;   // trader's preference, switchable
// sleeve-sizing.ts: SizeInput gains debitCapUsd?: number (default MAX_DEBIT_USD)
// DeskPayload gains chain?: ChainRead | null  (added as null by 2A so 3A lands half-wired)
// OCC is written and re-parsed with src/lib/room/exec/occ.ts — do NOT write a second OCC writer.

// freshest.ts
export function barAgeSec(closed: OhlcBar[], interval: string|number, nowMs: number): number | null;
export const STRUCTURE_MAX_BEHIND_BARS = 1;
export function structureBehind(closed, interval, nowMs, maxBars?): { behind: boolean; bars: number|null; ageSec: number|null };

// news.ts
export interface NewsCoverage { confirmedFrom: string; confirmedThrough: string; confirmedAt: string; sources: string[] }
// NewsRead gains: blind: boolean; blindReason: string | null
export const UNVERIFIED_RELEASE_SLOTS_ET = ["08:30","10:00","14:00"];
// newsRead's existing 2-arg call sites keep working (build-desk.ts:742 unaffected)

// pool-ledger.ts
export interface PoolProvenance { symbol; side; sweep; entryZone; drawName; drawPrice; drawKind; strategy; band; killzone }
export interface PoolTouch { id; poolKey; tradeId; at; tradeDate; symbol; side; sweep; ... }
export function poolKeyOf(symbol: string, drawKind: string|null, drawPrice: number|null): string | null; // null on unnamed
```

---

## 3. CONTRADICTIONS AND DANGERS

### 3.1 ITEM 4 — holding 1 DTE past 15:30. **REFUSE AS WRITTEN.** The rh-cycle group is right and this is the clearest call in the set.

`rh-cycle.ts:18` `RH_FLATTEN_MIN = 15*60+30`, applied unconditionally at `:152` — **verified**. Implemented literally, item 4 puts a 0–1 DTE ATM long through **17h15m** with no exit (65h15m on a Friday), and the −25% working stop **provably does not exist** in that window: QQQ/SPY options do not trade 16:15→09:30 (`overnight-swing.ts:37-53`); only SPX/XSP/VIX/RUT get Cboe GTH 20:15–09:25, limit-only. Measured: `overnight-swing.ts:155-166`, 499 nights, median **−34% per night for 1DTE ATM**, −17% for 2DTE, and `MIN_DTE_TOMORROW = 2`. Expiry day is worse — the broker force-sells from 15:30 and OCC auto-exercises at $0.01 ITM. CLAUDE.md's own RH row already says a 15% brake on 1 DTE is a **clock**: theta alone removes it inside ~3.6h.

**Safe alternative (ship this):** keep the flatten unconditional; add `RhHeld.dte` and `rhCarryRefusal(held)` so the **reason string states why a carry is impossible**, and pin it with a negative control that FAILS if anyone later implements the carry — `held({ dte: 1, mark: 21000, stop: 21030, t1: 20950, raidWick: 21025, failedHold: false })` at 15:40 must still be `phase: "close"`.

### 3.2 ITEM 19 — unattended live closing. **The job already exists AND IT CAN OPEN, NOT ONLY CLOSE.** This is the single most dangerous standing fact in the whole set and it is live right now.

`/api/cron/room-step` builds its own room cycle (`room-step.ts:92-96`), pushes it into a **real** manager feed (`createRoomManagerFeed()` … `feed.pushRoom(...)`, `:125-129`) and hands `feed.getState()` to `runRhDesk` (`:138`). With every tab closed and nobody watching, that cron can reach `phase: "place"` and send a **buy-to-open** — and the arms default **ON when unset** (`RH_LIVE_ARMED` / `RH_OPTIONS_AUTOFIRE_ENABLED`, documented at `RH_LIVE_ROUTINE.md:77`). Item 19 asked for a *closer*; what is deployed is wider than the ask.

Also live, today, independent of any change here:
- **A submitted close disowns the position instantly.** `placeOrder` (`rh-dispatch.ts:170-189`) passes `opened: null` for a close, so `:183` drops the `rh_desk_book` row the moment the sell is **submitted**, not filled. A GFD limit at bid−$0.05 that never fills leaves a real 0–1 DTE contract with **no stop, no retry, no escalation, and no row saying it exists.**
- **A close has no mutual exclusion.** The 60s claim at `rh-dispatch.ts:387` guards the OPEN path only. Browser poll + cron + (after 19.2) the closer = three senders, kept apart only by the lease short-circuit at `room-step.ts:63` — the very check 19.2 removes from the close path.
- **Two concurrent token refreshes delete the sign-in.** `ensureAccess` (`rh-oauth.ts:225-247`) has no lock and no CAS, and on 400/401 calls `dropOauth` blind. A loser of the race deletes the closer's only credential, the route still returns 200, and a position sits unmanaged until a person notices.
- **A defaulted `CRON_USER_ID` disables the closer silently.** `cronUserId()` falls back to `ENGINE_BRIDGE_USER_ID` then `"dev-user"`; a wrong identity finds no `rh_oauth` row, which looks exactly like "nothing to do".

**Safe alternatives, all shippable in Wave 1B:** run the closer **first** and **close-only** (`manager: null` + `blockNewEntries: true`); keep the row while a close is in flight and escalate (limit → limit−slip → market after 3); claim each close attempt via the existing `claimAlert` one-statement upsert, **failing open** if the ledger is down; single-flight the token refresh with a CAS on `updated_at` and never drop unless the refresh token is byte-identical to the one that was sent; refuse to run on a defaulted identity; write one `alert_log` row per run so "did not fire" and "fired and found nothing" are distinguishable. **Add `RH_CRON_MAY_OPEN`, default FALSE** — the opposite default convention to `RH_LIVE_ARMED`, deliberately, because closing unattended reduces risk and opening unattended adds it. Say so in the doc. **Whether a closed tab may OPEN a 0–1 DTE option is the trader's written call, not a code decision.**

### 3.3 Everything else that fights measured evidence

| # | The spec says | The repo measured | Safe alternative |
|---|---|---|---|
| 7 | 15m wicks get called raids that the 1m closed outside | **1.1% / 1.7%.** `detectSweeps` already requires the 15m CLOSE back inside (`detectors.ts:546, :556`) and the 15m close *is* the last 1m close. Confirmed 349/354 MNQ, 352/362 ES. Expanding the arming rung multiplies NY AM raids **2.9x (5m) / 11.9x (1m)** with zero evidence | Build `confirmRaidOnMinute` with the **tri-state** verdict (`"no_tape"` is neither pass nor refusal). 5m-rung pools **LABELLED, not ARMING**. Do not add the 1m rung. If anyone collapses the tri-state to a boolean the desk refuses every raid outside gateway hours and in every backtest, and it will look like a quiet session |
| 5 | "gap left, close held" | The hold window is a **free parameter that decides everything**: 1 bar 19,207 events / 24 bars 7,920 / rest-of-history 402. At 24 bars the new rule is **1.70x** today's displacement rate and the overlap with today's events is **1,738 of a 10,840 union (16%)** — a different detector, not a tweak. It loosens `scanner.ts:529 displacement`, `:532 mss`, all 3,674 order blocks, the smc-board tape and the 0.14-weight mechanical model | Ship with `DISPLACEMENT_RULE.value = "body"` (today's behaviour) as the **default**, `"gap"` behind the switch, and let the Wave 4 census decide. `DISP_HELD_WITHIN_MIN = 360` is the trader's number |
| 6 | Confirm window should be wall-clock | Correct in principle, but on the 15m series the desk actually grades, 25 min resolves to **1 bar** — the mechanical model (highest weight, 0.14) may stop completing, silently removing the best-defined setup and pushing the board onto weaker models | Land the helpers and the deprecation in Wave 1, but hold the substitution at `detectors.ts:1097-1102` / `:1214` behind the census. Leave `gradeSweepQuality` (`:804`) and `detectMitigationBlock` (`:962`) alone |
| 1 | T1 = next unswept pool, not the box EQ | Correct on **correctness** — the 80-bar box EQ is a location (`draw.ts:169-173`, and `smc-master.ts:218-227` says so in its own comment) and a card showing three different first targets is indefensible. But it moves T1 **farther**, and the repo measured "T1 ≥ 2R filter is WORSE (−0.18R vs −0.105R) — farther first targets are reached less often", while M0's strongest reliable effect is farther T1 in R **−12.8 pts per sd** | Do it, **print the expectancy cost on the commit**, and re-fit `build-hit-odds.mjs` + `build-evidence-pack.mjs` in the same wave. Do not revert by re-adding a level that was never liquidity |
| 2 | Trim half at the futures T1 on the option | `exits.ts:14-18, :52`: on the OPTION, **−$0.70 a fill** vs the mandate alone (n 146 NY AM, **z −0.64**), negative in both NY AM halves, −$0.51 all-session. The +0.50R/t figure is the FUTURES book on 122 plans and is not evidence for the option. z −0.64 is far under the repo's |z| ≥ 2 bar, so it is **undecided**, not an improvement | Build the mechanism (the cycle literally cannot scale today — that is the real defect), put the trigger behind `RH_EXIT_POLICY.levelTrim` **default OFF**, quote the measurement next to the switch. Note it cannot exist below 2 contracts, so every B+ ticket is unaffected |
| 3 | Defer the premium stop to the level | Verified: `rh-cycle.ts:153` fires **before** `levelHit` at `:154`. Correct to re-order — CLAUDE.md: "Exit on the LEVEL … the 15% is a disaster backstop". **But** it raises worst case per ticket from ~25% to ~100% of the debit: at `RH_MAX_DEBIT_TOTAL = 550` that is up to **$550 instead of ~$137**, and on 0–1 DTE a one-ATR stop frequently *is* the whole premium. CLAUDE.md states outright: "the trader has to pick one" of 15% / 25% | **BLOCKING trader decision.** Build `markUsable` requiring a **finite** `markAgeSec` (never `== null \|\| …`) so an unwired or NaN age reads unusable and the backstop stays live; ship behind `RH_EXIT_POLICY.premiumBackstopOnly` so `false` restores today's ladder in one flip |
| 22 | The foreign branch should close | `rh-cycle.ts:145-147` verified. Implemented literally, the system sells **the trader's own hand-placed positions** | Leave the foreign branch closing nothing; widen only its reason. Build `armedFlip` for desk-owned positions, and **fail the other way on purpose**: `armed == null` is NOT a flip, because no armed read is the normal state for most of the session and treating it as a flip market-sells the whole book every time the scanner goes quiet, on every poll |
| 9 | Over-cap ticket → SKIP; `maxContracts` 2 → 4 | Skip contradicts a **deliberate** decision, not a measurement: `manager-room-feed.ts:161` shrinks on purpose and `verify-no-bot-entry.mjs:13-14` pins that as the fix for a real live-drill bug. The nearest measured precedent runs against skipping (the EV gate "trades a quarter as often; that is its proven effect", z 0.59). **2 → 4 doubles the size envelope** | Both behind switches. Do not merge `maxContracts` 2→4 until the full contract grid test is green — that test is the only thing between "the wick decides the size" and "the wick multiplies the size" |
| 13 | Equilibrium cards should wait | **Already true.** `smc-master.ts:386-388` forces `pd_half` to `wait` whenever a dealing range exists, and `ignorable` (`:640-645`, verified: `pathOk && htfPass && conf >= 0.8 && (pd_half \|\| dol) && state === "fail"`) requires `fail`, so it never fires on equilibrium | Do the actionable half only: drop `pd_half` from `ignorable`, keep `dol`. Direction of error is safe (TAKE → STAND only). Cost is frequency on a desk already at **23 TAKEs in 5,049 cards over four years** |
| 18 | Stop on a close through the wick | Measured **worse on win rate**: the group's own read-only replay of the 23 captured TAKEs — touch stop as coded 22 fills / WR 22.7% / −0.446R (reproduces `evidence-pack.json word.TAKE.exp = −0.446` exactly, which validates the sim); close stop WR **18.2%** / −0.277R; touch stop + the **shipped** failed-hold exit −0.242R. The exit already in the tree at z = 2.6 beats it, and the A+ unlock is a **win-rate** threshold | `stopOnClose: false` by default; publish all three variants |
| 18 | Four decision slots, best taken | **Hindsight.** Verified `session-backtest.ts:654-659` four slots and `:829-835` `snaps.sort(pathEligible → confluence → sessionBars); pick = snaps[0]`. The bars are causal and `assertCausal` is correct — the bias is in the **selection**. The file prints "Causal integrity: pass" beside it, which is why this number is the most likely to be believed | `firstTakeSlot` — chronological, first TAKE wins, never sorts by score. Keep all slots in the row for diagnosis only. Expect trade count and win rate to **fall**; print the old numbers beside the new |
| 18 | Band may stand in for the sequence | `session-backtest.ts:768-784` has **two fallbacks with no gate at all** (`pool.find(c => c.strategyComplete) ?? pool[0]`), and `:806` runs an effective floor of **0.60** (`PROFIT_ACTION_FLOOR − 0.05`) while printing a "0.65 only" pass beside it | One predicate: `book.word === "TAKE"`. Delete both fallbacks and the −0.05 clause |
| 21 | "Lag of more than one closed bar → WAIT" | **Already done and stricter.** `QUOTE_EXECUTION_MAX_LAG_SEC = 120` (`types.ts:123`, verified), applied `build-desk.ts:845`, enforced `:887` (`c.actionable = false`), propagating through `path-alarm.ts:44/:180` → `smc-master.ts:636 pathOk` → `:667 word = "WAIT"`. Read literally the item would move 120 s → **900 s**, a 7.5x relaxation of the gate that stops a fill being priced on a stale print | **DECLINE the 120 s change.** Build the genuinely ungated thing instead: `barAgeSec` / `structureBehind` (bar age ≠ quote lag ≠ fetch age) |
| 20 | Fail closed on unverified news dates | Verified: `news.ts:88-89` defaults to `"clear"` and the loop can only upgrade on a match — absence of evidence read as evidence of absence. Direction of the fix is safe (a false blind costs opportunity, zero capital). **The real risk is human**: a gate that stands the desk down because a file was not stamped trains the trader to ignore blackouts | Scope the blind to the three recurring slots the file itself uses, name it as *missing coverage* and not as a release, and keep the stamping a Sunday hand pass — never a fetch |
| 17 | Remember the pool a close took | Must **never** become a gate: "own-side daily objective already taken 0.00R", "opposite pool already raided +0.09R z=0.57" — both far inside |z| ≥ 2 | Write-and-read-for-review ledger. `recordPoolTouch` must be try/catch'd inside `ingestPaperFill` or a throw breaks the paper close path |
| 12 | The trap must not arm | Refuses **12.1% MNQ / 9.2% ES** of same-polarity sweeps. Too generous a window and the desk silently stops trading on a tenth to a quarter of raids — the 2026-09-21 precedent (18 gate variants, **0 takes**) took a dedicated diagnostic to see | Must be a **model-definition** fix (which sweep IS the raid), never a fit discount or band drop — that would re-open the hole closed on 2026-10-02 when `applyVeto` was deliberately made a flag |
| 15 | Blake = the swing-pair body-close inversion | Blake goes from ~80% of bars to **1.31%**. Correct direction for a model on paper/B+ — but the long re-promotion counter (`profit-rules.ts:87`, n ≥ 15 at WR ≥ 0.55) then effectively never completes | Ship it; state plainly that the re-promotion path is now unreachable and that is the trader's call |
| 24 | Name the silver bullet | CLAUDE.md: 10:00–11:00 is **flat**; 03:00–04:00 is −0.32R/−0.45R. This is a **naming** fix, not an edge. The one real risk: completing a template adds +0.03 fit and lifts the not-complete clamp (`strategy-grade.ts:279-283`), so a false `or_raid` can turn a C into B+/A− | `or_raid` weight 0, `SILVER_BULLET_EVIDENCE.grantsSize = false`, only the 10–11 window added |
| 25 | Resting limit instead of a marketable order | **Already true by construction** — verified `rh-cycle.ts:173-188` is the only open-order site and hardcodes `type: "limit"`; the only `market` order in the file is a close. And `ceTouch !== true` is a hard refusal at `rh-autofire-gates.ts:383-385`. But **neither is tested anywhere**, so one edit could turn the open into a market order with every verifier green | Pin both with tests. Do **not** add a resting-limit path for `sweep_displace` — that state means the displacement left **no array**, so building one requires inventing an entry level, which is the class of defect `fd57236` closed |
| 23 | Price must be at the array before sending | Clause 1 done (above). **Clause 3 is an open live money hole right now**: a GFD limit at ask+$0.02 goes out on the touch, the plan dies at 10:12, and nothing in the repo can retract it — no cancel, no order read, no working state. It can fill at 14:50 on a dead thesis | Highest-priority exec work after the closer. Needs a one-call fact first: does the Robinhood MCP expose a cancel tool? |
| 10 / 11 | Pick by grade; the laggard stands down | Low risk, correct. The pick never sets a price or a size, and `smtLed` moves only an **optional** factor (`smc-canon.ts:529 must: false`), so it can shift the A+/A boundary (`:565`) but never the word. Closing the `smtOn` leak (`structure.ts:1117` relative-strength spread lighting SMT with no divergence) can only **remove** a passing optional factor | Ship. Guard one case: a pick that promotes a card whose `plan` is null would blank the chart |

---

## 4. NUMBERS

**`src/lib/aplus/config.ts` is not touched by any item in any wave.** The 0.65 floor, the bands, the risk ladder and the halts are unchanged.

| Constant | File:line | Old | New | Why |
|---|---|---|---|---|
| `FVG_MIDDLE_BODY_ATR` | `detectors.ts:40` | 1.0 | **0** | Item 5. At 1.0 the gap rule yields 3,453 events vs 7,920 at 0 (MNQ 4y) — the magnitude gate the item removes would still do most of the work and "even when the body is ordinary" would be false. Constant stays exported; `middleBodyAtrRatio` stays on `FvgResult` |
| `DISP_HELD_WITHIN_MIN` | `detectors.ts` NEW ~69 | — | **360 min** | Item 5 hold window = `MM_MAX_ARMED_AGE` (24 bars on 15m). **THE TRADER'S NUMBER** — it alone moves the event count from 19,207 to 402 |
| `DISPLACEMENT_RULE.value` | `detectors.ts` NEW | — | **`"body"`** (switch to `"gap"`) | Default must be today's behaviour until the Wave 4 census |
| `MM_CONFIRM_WITHIN_MIN` | `detectors.ts` NEW ~53 | — | **25 min** | Item 6; five 5m closes = "a handful". **THE TRADER'S NUMBER**: on 15m it resolves to 1 bar, 5m to 5, 1m to 25 |
| `MM_DISPLACE_WITHIN` | `detectors.ts:53` | 6 | **6, `@deprecated`** | Kept for the curriculum and the sweep scripts; same pattern as `DISPLACEMENT_K` and `RECENT_SWEEP_BARS` |
| `RAID_CONFIRM_WINDOW_MIN` | `detectors.ts` NEW | — | **25** | Item 7; measured confirmation rate at that window 98.6% / 97.2% |
| `SWEEP_DEDUPE_ATR` | `detectors.ts` NEW | — | **0.1** | Item 7; two rungs calling the same price the same pool |
| `INDUCEMENT_BEYOND_WINDOW_BARS` | `detectors.ts` NEW ~589 | — | **16** | Item 12; = existing `INDUCEMENT_WINDOW_BARS` so the two halves of one concept share one horizon |
| `BLAKE_WINDOW_BARS` | `detectors.ts` NEW | — | **16** | Item 15; = `MITIGATION_WINDOW_BARS` (`:913`) — literally the same swing-pair horizon, mirrored |
| `BLAKE_CONFIRM_WITHIN_MIN` | `detectors.ts` NEW | — | **90 min** | Item 15; = 6 bars on 15m, the exact window the 1.31% / 610 / 618 measurement used |
| `RAW_WEIGHTS.blake_swing` | `engine-weights.ts` NEW | — | **= `cisd`'s weight, no higher** | Rarer and better defined, not a stronger claim; no measured expectancy |
| `RAW_WEIGHTS.htf_gap` | `engine-weights.ts` NEW | — | **0** | Item 14; weight-0 gate pattern (`ltf_reaction`, `opening_raid`, `:45-48`) |
| `RAW_WEIGHTS.or_raid` | `engine-weights.ts` NEW | — | **0** | Item 24; same pattern |
| `ignorable` scope | `smc-master.ts:643` | `pd_half \|\| dol` | **`dol`** | Item 13. The `0.8` literal is unchanged in value; only its scope narrows. `pd_half` reaches `fail` only when `dealing == null`, i.e. no location read at all |
| `LOCATION_KINDS` / `EXTERNAL_KINDS` | `card-plan.ts` NEW | unfiltered list | `{"range","open"}` / `{"external","prior","weekly"}` | Item 1; `draw.ts:162-188` pushes "range" from the 80-bar box and "open" from the midnight / 08:30 / 09:30 opens. `KIND_WEIGHT` is **not** touched |
| Patty windows | `strategy-grade.ts:320-322`, `strategies.ts:207-211` | hard-coded twice | **one read of `MODEL_REQUIREMENTS.patty.windows`** | Same values (09:45–11:00, 13:30–14:30), one definition |
| Silver bullet window | `smc-canon.ts` NEW | — | **`[10*60, 11*60]`** | Only the flat window. 03:00–04:00 (−0.32R/−0.45R) and 14:00–15:00 deliberately not added |
| `PROFIT_ACTION_FLOOR − 0.05` | `session-backtest.ts:806` | 0.60 effective | **clause DELETED** (0.65) | The file was replaying at 0.60 while printing a "0.65 only" pass |
| `SEQUENCE_REPLAY_RULE` | `session-backtest.ts` NEW | — | `fillBars 12, holdBars 32, t1Fraction 0.5, tickSlip 0.25, stopOnClose false, failedHold true` | **PINNED by equality test.** Each has a four-year paired measurement; a sweep that nudges one to improve the win rate breaks the build |
| `RH_TRIM_FRAC` | `rh-cycle.ts` NEW | — | **0.5** | Taken from `ROOM_MANDATE.takeProfitCloseFrac` (`mandate.ts:15`), not invented |
| `RH_EXIT_POLICY.levelTrim` | `rh-cycle.ts` NEW | — | **false** | Measured −$0.70/fill, z −0.64 — undecided, not an improvement |
| `RH_EXIT_POLICY.premiumBackstopOnly` | `rh-cycle.ts` NEW | — | **true** (false = today's ladder) | **Trader-blocked** pending the 15%-vs-25% pick |
| `RH_DISASTER_PCT` | `rh-cycle.ts:16` | 0.25 | **0.25 unchanged** | Only re-ordered and conditioned |
| `RH_FLATTEN_MIN` | `rh-cycle.ts:18` | 15:30 | **15:30 unchanged** | Deliberately. See 3.1 |
| `RH_DAY_FLAT_MIN` | `rh-cycle.ts:17` | 11*60 | **DELETED** | Read by no production path — only `verify-rh-cycle.mjs`. Its doc line contradicts the standing rule "the book does not flatten at 11:00" |
| `RH_PAST_ELEVEN_MIN_PCT` | `rh-cycle.ts:20` | 0.5 | **DELETED** | Same |
| `RH_CLOSE_MAX_LIMITS` | `rh-cycle.ts` NEW | — | **3** | Not a new number: the Alpaca executor already does "market after 3 limit attempts". Step reuses `CLOSE_SLIP = 0.05` |
| `RH_ACCESS_MARGIN_MS` | `rh-oauth.ts:231` | inline 60_000 | **120_000** | With a one-minute cron and a sub-second browser poll, 60 s guarantees several callers inside the refresh window. The CAS fixes the race; this reduces how often it is entered |
| `RH_REFRESH_LOCK_MS` | `rh-oauth.ts` NEW | — | **20_000** | A claimed refresh that has not finished may be retaken, so a crashed winner cannot wedge the desk shut |
| `RH_MAX_TAPE_AGE_SEC` | `rh-autofire-gates.ts:152` | 30 | **30, reused** | Item 3's mark-freshness bound; no new number |
| `RH_LIMIT_SLIP` | `rh-autofire.ts:157` | 0.02 | **0** | Items 8, 23, 25: the limit is the live **ask**. Keeps the `spread > 0.15 → mid` branch, which becomes strictly tighter. Alpaca's `entrySlipUsd` (`exec/limits.ts:23`) is separate and untouched |
| `maxContracts(dte)` | `options-desk.ts:350-354` | 0→1, ≤2→2, else 2 | **0→1, else `RH_MAX_CONTRACTS` (4)** | **DANGEROUS.** The flat 2 is why a one-point and a twenty-point wick buy the same guess — but this doubles the envelope. Gated on the full contract-grid test |
| `SizeInput.debitCapUsd` | `sleeve-sizing.ts:194` | const `MAX_DEBIT_USD` | **param, default `MAX_DEBIT_USD`** | Lets `options-desk` pass its already-clamped $550 instead of mutating a constant |
| `CHAIN_MAX_AGE_MS` | `options-desk.ts` NEW | — | **30_000** | Matches `RH_LIVE_QUOTE_MAX_AGE_MS` |
| `SKIP_WHEN_WICK_OUTGROWS_CAP` | `options-desk.ts` NEW | — | **true, switchable** | Trader's preference, contradicts a deliberate shrink decision |
| `QUOTE_EXECUTION_MAX_LAG_SEC` | `types.ts:123` | 120 | **120 — CHANGE DECLINED** | See 3.3 |
| `STRUCTURE_MAX_BEHIND_BARS` | `freshest.ts` NEW | — | **1** | Bar age, the metric that is genuinely ungated |
| `UNVERIFIED_RELEASE_SLOTS_ET` | `news.ts` NEW | — | **["08:30","10:00","14:00"]** | Not tuned: all 43 `high` rows in `news-calendar.json` sit at these three ET slots |
| `POOL_MAX_TOUCHES` / `POOL_HORIZON_DAYS` | `pool-ledger.ts` NEW | — | **200 / 90** | Storage bounds (mirrors `desk-memory.ts:92 MAX_FILLS`); no decision keys on them |
| `RH_CRON_MAY_OPEN` | `.env.example` NEW | — | **unset/blank = close-only** | Opposite default convention to `RH_LIVE_ARMED`, on purpose. Trader's written word flips it |

---

## 5. WHAT CANNOT BE DONE WITH WHAT IS ON DISK

Blunt. The backtest group is right on every count and this is the most important honest finding in the set.

1. **A four-year 1-minute-confirmed walk-forward is impossible.** Verified inventory: `src/data/history-4y.json` is **15m** (14.05 MB, 2022-09-01→2026-08-31, continuous `NQ.c.0` / `ES.c.0`). The only 1m file is `src/data/learn-history-1m.json` — **two months** (2026-07-01→2026-09-01), 38,324 / 38,323 bars, 5.67 MB, pinned to single contracts `ESU6` / `NQU6` so it does not stitch rolls. `.cache/history-4y-5m.json` is 5m and **gitignored** — local to one machine. There is no 1m tape before 2026-07-01 anywhere.
2. **Consequence nobody has written down: the `ltf_reaction` / 1m-5m must layer has never fired in any four-year number in this repo.** Verified independently — `scripts/capture-signals.mjs:269` calls `scanSetups(biasL, biasR, clock, smtStack.primary, slice, peerSlice, smc)` with **seven** arguments; the minute slice is the eighth. So `readLtfReaction` returns `{confirmed:false, reason:"No 1m tape"}` on all 93,669 bar-scans. Every four-year claim — `evidence-pack.json`, `hit-odds-model.json`, `room-time-odds.json`, `room-ev-test.json`, the tf-tier results — was computed with that must layer permanently off. `walkforward-report.json` must carry `tape.interval: "15m"` and `ltfMustEvaluable: false` as **machine-readable** fields, and `quotable()` must refuse a 1m claim.
3. **The only path to a 1m census:** `npx tsx scripts/capture-history.mjs --years 4 --interval 1 --out .cache/history-4y-1m.json` — ~2.8M rows, ~96 requests, ~250–400 MB JSON, resumable, flat-rate (Databento CME $199/mo, not metered), **cannot be committed**. Trader's decision.
4. **The four-year TAKE population is not a sample.** 23 TAKEs in 5,049 deduped cards over four years ≈ five trades a year. No walk-forward can be built on it; the census is a **census**, and must be labelled one.
5. **No VIX history in the repo** → every option number uses a fixed VIX per run. Do not substitute a plausible VIX.
6. **No option chain history** → every option EV figure is "model debit, fixed IV, no chain, no skew, no IV crush". That label goes on every line.
7. **No four-year news calendar** → the `clean` must is unenforceable before 2026-08-12, and item 20's blind rule cannot be back-tested at all. `caveats` says so.
8. **Unknown, one call to settle:** does the Robinhood MCP expose a cancel tool (`tools/list` on an authenticated session)? Item 23 clause 3's entire design depends on the answer, and that clause is an open live-money hole.

---

## 6. THE SMALLEST SAFE FIRST WAVE

Six changes. None can turn a STAND into a TAKE. None changes a size, a band or a floor. Every one removes a thing the desk currently states that is not true, and each has a verifier with a control that **fails on today's tree**.

| # | Change | Owner | Verifier + control |
|---|---|---|---|
| **21-B1** | Stop the scanner detecting on the **forming bar**. `closedL`/`closedR` already exist at `build-desk.ts:635-636` and are simply not passed. Add the trailing optional `closed` arg; inside, `assessConditions(closedL ?? barsL)`, `summarizeDetectors(closedL ?? barsL)`, and split `scoreDirection`'s `bars` into `bars` (LOCATION — keep the live print, per the measured +0.119R/card entry-location result) and `closed` (DETECTION). The `?? barsL` fallback means the two halves can land independently | **pipeline agent** (exception: this one file pair in Wave 1, since nothing else touches `scanner.ts` yet) | `verify-desk-enhancements.mjs`, **differential against the real engine**: a 15m series whose closed bars are quiet and whose **forming** bar alone wicks the prior low and closes 2+ ATR down. Today that phantom sweep + phantom displacement produces a card. Second control: the same bar, once genuinely closed, must detect |
| **19.5 + 19.6** | Delete `RH_DAY_FLAT_MIN` and `RH_PAST_ELEVEN_MIN_PCT` (dead in `src`), fix `docs/RH_LIVE_ROUTINE.md:189`'s claim of an 11:00 flatten the code does not have, and invert the one red assertion | rh-exec | `verify-rh-cycle.mjs` goes **24/1 → 24/0** (confirmed red today: "11:00 closes a position under +50%"). New `posture` guards: the doc must not match `/11:00 ET while under/` and the constants must be gone. Leaving a red verifier is how someone "fixes" it by **adding** an 11:00 flatten and starts closing winners at 11:00 unattended |
| **19.4** | Per-contract, per-attempt close claim via the existing `claimAlert` one-statement upsert (`position_flattened` kind, no migration), **failing open** if the ledger is down | rh-exec | NEW `verify-rh-closer.mjs` on PGLite with the real migration: same optionId+attempt → true then false; attempt 1 then 2 → true, true; two `runRhDesk` via `Promise.all` with one `userId` → **one** order placed |
| **25** | Pin, with tests only, two behaviours that are already correct and completely untested: no open order can ever be `type: "market"`, and no open order can be constructed with `ceTouch !== true` | options + rh-exec (tests only) | `verify-rh-dispatch.mjs` / `verify-rh-path-fire.mjs`, driven over the grid of every narrative confirmation state × `priceSource` × optionId present/absent. Each test ships with the mutation that must make it fail, since nothing fails "without the fix" |
| **13.1** | Drop `pd_half` from `smc-master.ts:643`'s `ignorable`; keep `dol` | master | NEW `verify-smc-master.mjs`: a card with `bias.dealing === null`, no impulse leg, fit 0.85, `pathOk`, `htfPass`, every other must passing → `word !== "TAKE"`, `missing === "POI in correct half"`. Paired control: the **same** card with `dol` failing instead → `word === "TAKE"`, so this cannot be mistaken for a blanket tightening |
| **18-D** | Kill the hindsight slot selection: `firstTakeSlot`, chronological, first TAKE wins. Keep all four slots in the row for diagnosis. Print the old selection's numbers beside the new | backtest | NEW `verify-walkforward.mjs` NC17: four slots in order, 09:45 `{take:true, conf:0.66}` and 10:30 `{take:true, conf:0.94}` → must return **09:45**. Today's `snaps.sort` returns 10:30. NC18: no slot takes → null, and the day is a **skip**, not `pool[0]` |

**Deliberately excluded from the first wave, with the reason:** item 5 (1.70x displacement rate, 16% overlap — a different detector), item 6's substitution (25 min = 1 bar on the graded series; may silently kill the 0.14-weight model), items 1 / 16 (moves the number the 50%-at-T1 rule fires on, and needs the hit-odds re-fit in the same commit), item 3 (worst case per ticket 25% → 100% of debit; the 15%-vs-25% pick is the trader's), item 4 (refused outright), item 9's `maxContracts` 2→4, item 19's open path (`RH_CRON_MAY_OPEN` default is a trader decision, not a code decision), item 20 (ship only once `news-coverage.json` has been hand-stamped — an unstamped file turns the fix into a blanket stand-down and trains the trader to ignore blackouts).

**Three answers needed from the trader before Wave 1B/3A can finish:** (a) 15%-of-debit or −25%-of-premium — one number, not two; (b) may a closed tab **open** a 0–1 DTE option, or only close one; (c) over-cap ticket — skip, or shrink as `manager-room-feed.ts:161` deliberately does today.