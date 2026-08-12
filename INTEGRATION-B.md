# INTEGRATION-B — wiring left for the integrator

Phase B1–B3 (ROADMAP). Everything below is in files this agent does **not**
own. Each item is exact: file, anchor, and the change.

**Shipped and already live (no action needed):**

| Item | File | State |
|------|------|-------|
| B1 · `pathTakeGate` on the live open path | `src/lib/journal/server.ts` | enforced in `openTrade` |
| B1 · one-book-per-day on the paper open path | `src/lib/trading/paper-manager.ts` | enforced in `openPaperTradeInstant` |
| B2 · time / context stops | `src/lib/trading/management.ts` → `paper-manager.ts` | **on by default** in `managePaperTradesAgainstPrice` |
| B3 · dynamic targets from the draw | `src/lib/trading/management.ts` → `paper-manager.ts` | wired but **inert until §2 below** |

---

## 0. The B1 decision, stated once

`pathTakeGate` (profit-rules.ts) enforces month cap, consecutive-loss
cool-down, blake_mech-long demotion, same-side cap, band floor and
one-book-per-day. It was called from `session-backtest.ts` only.

- **LIVE (`mode: 'live'`) now runs the whole gate.** Live and the backtest are
  finally the same rule set — that comparability is the entire point of B1.
- **PAPER runs one-book-per-day and nothing else.** Paper exists to build the
  sample; the cap / cool-down / band rules throttle the RATE at which evidence
  accumulates while Phase C still needs n≥30. One book per day is a different
  kind of rule: NQ and ES are ~0.9 correlated, so taking both is one idea at
  double risk, and a paper record that allowed it would overstate
  diversification and understate drawdown. Throttling the sample RATE is a
  cost worth paying; corrupting its HONESTY is not.

Enforced in two places because paper has two open paths: the localStorage
one-click book (`openPaperTradeInstant`) and the journal (`openTrade` with
`mode: 'paper'`). `mirrorPaperOpen` is deliberately **not** gated — it mirrors
an open that already passed. Do not call it from anywhere else.

---

## 1. `src/components/journal/log-setup-dialog.tsx` — feed the gate real facts

`openTradeSchema` gained four optional inputs. The dialog sends none of them,
so the gate currently runs on `grade` + journal history alone, and — stated
plainly — **`htfOk` defaults to `true`**, i.e. the absolute HTF gate is *not*
enforced server-side until this lands.

In `submit`, in the `const input: OpenTradeInput = {…}` literal (~line 145):

```ts
        grade: candidate.grade,
+       pathBand: candidate.pathBand,               // finer than grade (A / A-)
+       strategyPrimary:
+         candidate.completeStrategy || candidate.strategyPrimary,
+       htfOk: candidate.htfOk,                     // absolute gate, server-side
+       actionable: candidate.actionable,
        killzone,
```

Until then the gate falls back to parsing `strategy:<id>` out of the `reason`
line the dialog already writes — which is why the blake_mech demotion works
today. `pathBand`/`actionable` only ever *widen* what is allowed, `htfOk` only
narrows.

---

## 2. `src/routes/index.tsx` — pass the draw into the management tick (B3)

Dynamic targets are opt-in-safe: with no `draws`, targets behave exactly as
they did before Phase B. `desk.draws` already exists on the payload
(`build-desk.ts:329`), it just is not handed to the manager.

**Two call sites, same change.** Line ~441 (desk poll) and line ~513 (the 5s
re-check interval):

```ts
-    const { closed } = managePaperTradesAgainstPrice(prices);
+    const { closed } = managePaperTradesAgainstPrice(prices, {
+      draws: {
+        [desk.left.symbol]: desk.draws.left,
+        [desk.right.symbol]: desk.draws.right,
+      },
+    });
```

Keys are resolved the same way prices are (display symbol, contract symbol, or
either with the `M` prefix stripped), so `NQ`/`ES` keys reach `MNQ`/`MES`
positions without further aliasing.

Nothing else in `index.tsx` is required:

- Time/context stops are **already active** — they need only the session clock
  and the bundled news calendar, both deterministic, so shipping them off by
  default would have shipped B2 disabled.
- Flatten closes come back in `closed[]` and are therefore already mirrored by
  the existing `mirrorClosedPaperTrades(closed)` on both paths.
- The one-book rejection already surfaces: `openPaperTradeInstant` returns
  `{ ok: false, error }` and the existing `setPaperToast(\`Paper log failed: …\`)`
  prints it.

Optional polish: `t.manageNote` on a closed `PaperTrade` carries the exit
sentence ("NY AM killzone ends in 4 min — flat by the boundary"). The toast
currently prints only `exitReason` (`flat_killzone_ended`).

---

## 3. `src/components/desk/paper-book-panel.tsx` — surface the new fields

`PaperTrade` gained three optional fields. Nothing breaks without them; they
are simply invisible:

| Field | Meaning |
|-------|---------|
| `killzone` | killzone id at entry (drives the killzone time stop) |
| `mfeR` | max favourable excursion in R — a **price** ratio, never the booked R |
| `manageNote` | latest re-target, or the sentence that closed the trade |

Records written before Phase B have none of them; the code treats absence as
"unknown" and never flattens on unknown.

---

## 4. Live positions are still unmanaged

`shouldFlatten` is pure and takes a structural `ManagedPosition`, so it works
on a live `JournalTrade` too — but there is no live position manager to call
it from, and this agent does not own one. Sketch, wherever the live poll ends
up living (server-side, so the tab does not have to be open):

```ts
const clock = getSessionClock(new Date());
for (const t of await listTrades({ data: { status: "open", mode: "live" } })) {
  const d = shouldFlatten(
    {
      side: t.side, entry: t.entry, stop: t.stop ?? t.entry,
      workingStop: t.stop ?? t.entry, tp1: t.target ?? t.entry,
      tp2: t.target ?? t.entry,
      riskPts: Math.abs(t.entry - (t.stop ?? t.entry)),
      contracts: t.contracts, contractsOpen: t.contracts,
      openedAt: Date.parse(t.openedAt), killzone: t.killzone,
    },
    { now: Date.now(), clock, last: markPrice },
  );
  if (d.flatten) {
    // NOTE: this must remain an ALERT, not an order, until Phase E.
    // The desk does not place or cancel real orders (ROADMAP E, and the
    // note there about credentials).
  }
}
```

**Do not** let this path send broker orders. Phase E is gated on Phase C
reporting an edge; until then a live flatten is a notification to a human.

---

## 5. Hooks for B4 (alerts) / B5 (cron) — owned by another agent

`src/lib/alerts/*` and `src/routes/api/cron/*` were created concurrently and
are not this agent's files. Two of B4's four alert triggers are now
computable without any new logic:

- **"position auto-flattened"** — `managePaperTradesAgainstPrice` returns the
  closed trades; `t.exitReason` starts with `flat_` and `t.manageNote` is the
  ready-made notification body.
- **"news blackout in 15 min"** — `shouldFlatten` already fires
  `news_blackout_imminent` at T-20 with `minutesAway`. For a pure alert with no
  position, call `newsRead(new Date(now + 15 * 60_000))` and check for
  `verdict === "blackout"`.

Constants to reuse rather than re-derive: `NEWS_FLATTEN_LEAD_MIN`,
`KILLZONE_FLATTEN_LEAD_MIN`, `SESSION_END_FLATTEN_LEAD_MIN`,
`MAX_BARS_IN_TRADE`, `MANAGEMENT_BAR_MINUTES`, `PROGRESS_R` — all exported
from `src/lib/trading/management.ts`.

---

## 6. `desk_trades.strategy` (migration 0008) is still unwritten

`openTrade` now *receives* `strategyPrimary` (§1) but deliberately does not
persist it — migration 0008 assigns the writers to INTEGRATION-D. When that
lands, the one-line addition also improves this gate: `readBookCounters` could
then fill `blakeLongTaken/Wins` from real attribution instead of leaving them
at 0 (which keeps blake_mech longs demoted by default — the rule's own
starting state, not an accident).

```sql
-- in the openTrade INSERT column list
   components_present, components_missing, strategy
-- and $18 => data.strategyPrimary ?? null
```

---

## 7. Build state at hand-off

`npm run typecheck` — 0 errors repo-wide. `npm run lint` on the three Phase-B
files — 0 errors, 0 warnings.

Mid-session `typecheck` was briefly red with 4 errors in `src/lib/alerts/` and
`src/routes/api/cron/` (the concurrent B4/B5 work); those were fixed by their
owner before hand-off. Nothing in `management.ts`, `paper-manager.ts` or
`journal/server.ts` was ever implicated.

---

## 8. Tuning note (read before changing a threshold)

Every threshold in `management.ts` is a named, commented constant precisely
because **none of them is measured yet** — n = 0. `MAX_BARS_IN_TRADE = 12`
(60 min) and `PROGRESS_R = 0.25` are reasoned, not fitted. ROADMAP is explicit
that management tuning is fitted to outcome data and that guessing now bakes
in noise. Treat them as placeholders to be re-derived from the Phase C sample,
and change them in `management.ts` only — nothing else hardcodes them.
