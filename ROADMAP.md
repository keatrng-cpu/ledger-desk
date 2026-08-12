# ROADMAP v2 — from "a desk that helps if you look" to "a desk that runs"

Supersedes v1 (phases 0–4: journal, risk governor, detectors, replay, engine
bridge, analytics, draw-on-liquidity — all shipped). Written 2026-08-11 against
commit `093de49`, with every claim below checked against the code, not assumed.

---

## The one thing that decides everything

There are ~35,000 lines of machinery here and **n = 0 measured trades**.

Every item on the wish list is a *capability*. None of them is an *edge*. The
engine's own calibration is still the only measurement that exists, and it says:
843 candidates scored, best 0.6353, **cleared 0** at floor 0.75. The desk has
never been shown to make money — on paper or live.

That forces the sequencing. Three of the six requested areas **cannot be built
correctly without a sample first**:

- Per-strategy WR at n≥30 (§7) *is* a sample. It cannot be authored, only earned.
- Auto-execution (§4) multiplies whatever expectancy exists. Negative × leverage
  = faster loss. It is the **last** thing to build, not the next.
- Management tuning (§5) — time stops, partial-off points — is fitted to
  outcome data. Guessing them now bakes in noise.

So: **make the numbers trustworthy → automate the loop that generates the
sample → read the sample → only then let it fire orders.**

If only one phase ever ships, ship **Phase B**. It is what turns this from a
dashboard into a system that produces evidence while you sleep.

---

## Phase A — One scoring path (2–3 days)

*Requested as §3. Partly a false alarm; the real defect is narrower and worse.*

**Verified state.** `build-desk.ts:173` and `session-backtest.ts:722,889` both
call `scanSetups(…, leftBars, rightBars)` — live and backtest **already share
one path**. The outlier is `replay.ts:241`: `scanSetups(read, peerRead, clock)`
with **no bars**. Inside the scanner that means `barsL = []`, so
`summarizeDetectors([])` returns nothing, `assessConditions([])` gates on
nothing, and the draw engine is skipped (needs ≥30 bars). **The calibration
harness — the tool whose entire job is answering "what does floor 0.50 admit?"
— scores every candidate with the detector stack switched off.** Its numbers do
not describe the desk that trades.

- [ ] **A1. Feed replay the bars.** Pass the prefix slices already in scope at
      `replay.ts:241`. No-lookahead is preserved (they are prefixes). Expect the
      calibration output to move materially — re-baseline after, and treat every
      prior replay number as void.
- [ ] **A2. Invalidate the mechanical sequence.** `detectors.ts` has **zero**
      reset/timeout logic (grep-confirmed). A `retest_ready` from 350 bars ago
      outranks a fresh `inverted` because rank beats recency
      (`detectors.ts:626-632`). Add: expiry when the displacement window closes
      unfilled, invalidation on a contrary sweep/structure break, and recency as
      a tiebreak *within* a rank. Currently harmless only because the full
      detector set is not yet scoring live — A3 makes it live, so A2 lands first.
- [ ] **A3. One scorer, one signature.** Extract `scoreCandidates(read, peer,
      clock, bars, peerBars, opts)` used verbatim by live, replay, backtest and
      the paper loop. Adding a component must be impossible to add to one caller
      and forget in another. A single unit test asserts identical output for
      identical inputs across all four entry points.
- [ ] **A4. Retire the dead second implementation.** `trading/paper.ts` (280
      lines) is reachable only by a type-only import; `bridge/paper-server.ts`
      `commitPaperCycle` has zero callers. Delete or wire — do not leave a
      second paper engine lying next to the real one.

**Done when:** the same bars produce the same grade in all four contexts, and
the calibration table is regenerated with detectors on.

---

## Phase B — The desk runs itself (4–6 days) ← **highest leverage**

*Requested as §6 (automation) + §5 (management). Merged, because an unenforced
rule and an unwatched alert are the same failure: they need you to be looking.*

**Verified state.** No cron, no notifications, no service worker, nothing
scheduled — this is greenfield. Meanwhile `profit-rules.ts:190` `pathTakeGate`
(month cap, consecutive-loss cool-down, blake demotion, one-book-per-day) is
called from **`session-backtest.ts` only**. *The backtest is run under stricter
rules than the live desk enforces*, so backtest PnL already describes a system
you are not trading.

- [ ] **B1. Promote `pathTakeGate` to the live open path.** Same function, same
      inputs, enforced in `openTrade` / paper open — not advisory UI. This alone
      makes backtest and live comparable, which nothing else in this plan can
      substitute for.
- [ ] **B2. Time and context stops.** Flat by killzone end; flat at N bars if
      the thesis has not triggered; **auto-flat before a news blackout** (the
      calendar and `newsRead` already exist and already gate entries — they do
      not yet gate *open positions*).
- [ ] **B3. Dynamic targets from the draw.** Targets are fixed at entry today.
      Re-rank against `drawOnLiquidity` each poll; take partial at the nearest
      pool / EQ rather than a fixed R; trail the runner to the next unswept
      level. This is the payoff for building the draw engine.
- [ ] **B4. Alerts that reach you.** Web Push (service worker, VAPID) on: setup
      armed (sweep → displace → MSS → retest complete), halt hit, position
      auto-flattened, news blackout in 15 min. Requires HTTPS + a stored
      subscription; free.
- [ ] **B5. Scheduled jobs.** 09:15 ET killzone checklist; 16:15 ET forced
      review of the day's skips and closed R; Sunday 18:00 ET auto week-backtest
      → brain update. Vercel Cron is the cheapest host given the existing deploy.
- [ ] **B6. Close the snapshot loop.** `captureSnapshot` writes on every log;
      `listSnapshots`/`getSnapshot` have **zero callers**. The
      hindsight-prevention data is accumulating with no viewer. Build the review
      screen — it is the input to B5's evening review.

**Done when:** a full session can pass with the tab closed and, on reopening,
the journal, the halts, the flats and the review are all already correct.

---

## Phase C — Evidence (runs continuously from Phase B; read at n≥30)

*Requested as §7.*

- [ ] **C1. Per-strategy scoreboard.** Group the existing analytics by
      `strategyPrimary`. Show `n`, WR, expectancy — and render "—" until n≥30.
      The infrastructure exists; it needs the grouping and the sample.
- [ ] **C2. Regime matrix — when NOT to use each model.** Cross strategy ×
      `conditions.regime` × killzone. The cell that says "mechanical, chop,
      lunch = −0.4R over 40 trades" is worth more than any new strategy.
- [ ] **C3. Promotion/demotion by measurement.** Auto-demote a strategy whose
      trailing-30 expectancy goes negative; auto-promote at n≥30 and >+0.2R.
      Replaces hand-tuned constants like the hardcoded blake demotion.
- [ ] **C4. Book coverage.** Do not add books before C1 shows the two current
      ones are profitable. If ES persistently lags, encode it as a rule
      ("ES only when it lags NQ") rather than adding instruments.

**Done when:** you can name, with n≥30 behind it, the one setup/session/regime
combination that actually pays — and the desk refuses the rest.

---

## Phase D — Friction (do the cheap ones NOW, in parallel)

*Requested as §8. Small, and it currently corrupts the evidence.*

- [ ] **D1. One world, not two.** Paper works signed-out (localStorage);
      analytics and the mirror require auth. So the record splits silently:
      clear the browser and the working book resets while the DB history
      survives. Fix: on login, reconcile localStorage → `desk_trades` (the
      mirror is already idempotent, so a backfill pass is safe), and show an
      explicit "N trades not yet mirrored — sign in to save" badge when
      signed-out. **Highest priority in this phase.**
- [ ] **D2. Stale preview.** Build-ID badge and no-cache headers landed
      (`5bdb8dc`, `fb1fcac`). If it recurs it is the sandbox serving a stale
      origin, not the app — verify by comparing the badge to the deployed SHA
      before debugging anything else.
- [ ] **D3. Agent sync.** Two agents pushed 44 and 2 commits into the same files
      and produced a 5-file conflict, two `drawOnLiquidity` implementations, and
      two paper engines. Convention: branch per agent, `main` only via merge,
      and a `CONTRACTS.md` naming who owns which module.
- [ ] **D4. Feed coherence.** Charts poll 2s; the desk polls 30s; **paper
      stop/TP fills are evaluated against the 30s-stale quote** while you watch
      the 2s price. Evaluate fills against the fast feed or state the lag on the
      panel.

---

## Phase E — Execution (LAST — gated, not scheduled)

*Requested as §4.*

**This is deliberately last, and I would push back on building it before
Phase C reports.** Auto-execution multiplies expectancy. The measured
expectancy today is unknown; the engine's own calibration cleared zero trades.
Automating entry into an unproven edge converts a slow manual loss into a fast
automatic one, and a broker API bug costs real money in seconds rather than
showing a wrong number on a screen.

**Unlock gate (all four, no exceptions):**
1. ≥100 mirrored paper trades,
2. positive expectancy on the **live-mode** analytics report,
3. Phase A shipped (paper and live scored identically),
4. B1 shipped (same rules enforced on both).

- [ ] **E1. Order-ticket parity.** One `OrderIntent` type; paper and live differ
      only in the adapter. Prove parity in paper first.
- [ ] **E2. Broker adapter behind a kill switch.** Tradovate/Rithmic for futures.
      Server-side, idempotent (client order id), reconciling (poll fills, never
      assume), hard daily max-loss at the adapter, and a one-click flatten-all
      that does not depend on the UI being open.
- [ ] **E3. Options swing under the same gates.** HTF + news + lag rules that
      govern futures must govern options; add chain/DTE/delta selection and
      management. No separate rule set.
- [ ] **E4. Shadow mode ≥2 weeks.** Adapter computes and logs the order it
      *would* place, live, without sending. Diff against what you actually did.
      Only after that diff is boring does it get to send.

**Note on my role:** I will build, test and document this. I will not place
trades, hold broker credentials, or run the live adapter for you — those stay
under your hand, and credentials belong in the broker's own flow, never in
this repo.

---

## Sequencing

```
NOW      D1 (split record)  ·  A1+A2 (replay honest, mechanical expires)
NEXT     B1 (rules enforced live)  ·  A3 (one scorer)  ·  B6 (snapshot viewer)
THEN     B2 B3 (management)  ·  B4 B5 (alerts, schedules)   → sample accumulates
READ     C1 C2 (at n>=30)  → C3 C4
LAST     E, only if C says there is an edge
```

D2–D4 and A4 are cheap; slot them into any gap.

**The trap to avoid:** every item in Phases B and E makes the desk *do more*.
Only Phase C tells you whether doing more is worth doing at all. Build the
measurement loop before the machinery it is supposed to measure.
