# INTEGRATION-E — D1 (one record) + E1 (order parity) + E4 (shadow log)

Everything below is ADDITIVE. No exported symbol was renamed or removed;
`src/routes/index.tsx` compiles unchanged and its existing `mirrorPaperOpen` /
`mirrorPaperClose` calls keep working exactly as they do today. The wiring
steps are for the integrator who owns that file.

## Files

| File | Role |
|---|---|
| `src/lib/journal/paper-mirror.ts` | **changed (additive)** — row writes extracted to `mirrorOpenRow` / `mirrorCloseRow`; schemas exported as `paperOpenSchema` / `paperCloseSchema` |
| `src/lib/journal/paper-backfill.ts` | **new** — D1: pure diff planner, `backfillPaperTrades`, `unmirroredCount()` |
| `src/lib/execution/order-intent.ts` | **new** — E1: the shared `OrderIntent` type + builders (pure) |
| `src/lib/execution/shadow.ts` | **new** — E4: records the intent that WOULD have been placed. Sends nothing |
| `migrations/0009_shadow.sql` | **new** — `shadow_orders` |

`paper-mirror.ts` refactor in one line: the two server functions are now thin
auth wrappers around `mirrorOpenRow` / `mirrorCloseRow`, so the backfill reuses
the **same** insert, the same conflict rule and the same server-side
`computeTradePnl` close math instead of owning a second copy of any of them.

---

## D1 — what was actually broken

The paper book (`trading/paper-manager.ts`) is localStorage and works signed
**out**; the mirror and every analytic that reads it require auth. So the record
forked in both directions:

- trades taken while signed out never reached `desk_trades` — the Phase-E
  unlock evidence was missing exactly those trades;
- clearing browser storage reset the working book while the DB history
  survived, so the two disagreed and neither was complete.

The fix diffs the local book against what the DB already holds and replays only
the difference, through the idempotent writes the live mirror already uses.

### Wiring step 1 — backfill on login / on mount when signed in

`syncPaperBookToDb()` does the whole loop (read remote → diff → commit → mark)
and **never throws**: signed out or DB down it returns `{ ok: false, error }`
and the working book is untouched. It is safe to call repeatedly — every write
underneath is `on conflict do nothing` / close-only-if-open.

```tsx
// src/routes/index.tsx
import { syncPaperBookToDb, unmirroredCount } from "@/lib/journal/paper-backfill";

const [unsaved, setUnsaved] = useState(0);

// Mount + whenever the session changes (login is the important one) + after
// any paper event, so a trade taken while offline lands as soon as auth exists.
useEffect(() => {
  let cancelled = false;
  const run = () => {
    void syncPaperBookToDb().then((res) => {
      if (!cancelled) setUnsaved(res.pending);
    });
  };
  run();
  window.addEventListener("ledger-paper", run);
  return () => {
    cancelled = true;
    window.removeEventListener("ledger-paper", run);
  };
}, [session?.user?.id]); // re-runs on sign-in; harmless when signed out
```

If a session object is not in scope where the paper panel lives, mount-only plus
the `ledger-paper` listener is enough — the first paper action after signing in
triggers the pass.

### Wiring step 2 — the "not yet saved" badge

`unmirroredCount()` is synchronous and returns **0 during SSR** (no
localStorage). Read it in an effect / from the `syncPaperBookToDb()` result, not
during render, or the first paint will disagree with hydration.

```tsx
{unsaved > 0 && (
  <span className="text-amber-400">
    {unsaved} trade{unsaved === 1 ? "" : "s"} not yet saved — sign in
  </span>
)}
```

Recompute after each paper event with `setUnsaved(unmirroredCount())`; the
effect above already does it via the `ledger-paper` listener.

### Contract notes (D1)

- **Symbol.** `PaperTrade.symbol` is the RESOLVED contract (`MES`/`MNQ`);
  `displaySymbol` is the label (`ES`/`NQ`). The planner sends `symbol`. Sending
  the label prices a micro at full-size economics — the 10x PnL bug — and
  `index.tsx` already gets this right at line ~379; keep it that way.
- **Order.** Opens are applied before closes inside one call, so a trade opened
  AND closed while signed out lands complete in a single round trip.
- **Caps.** `PAPER_BACKFILL_MAX = 100` opens and 100 closes per call (zod
  enforced). A larger book truncates the plan and `syncPaperBookToDb()` loops
  (max 4 passes) until it is drained.
- **Unusable rows.** A trade the mirror cannot accept (no exit price on a closed
  trade, non-finite entry/stop, bad size) is counted in `plan.unusable` and
  skipped — never closed at an invented level.
- **`planPaperBackfill(book, remote)` is pure** — no localStorage, no network.
  Unit-test it directly; it is the whole D1 decision.

---

## E1 — `OrderIntent`

One ticket shape for paper and (future) live, so the two differ only in the
adapter. Pure module: no I/O, no network, no SDK.

```ts
import {
  orderIntentFromPaperLevels, // pre-trade, from buildPaperLevels()
  orderIntentFromPaperTrade,  // post-open, from a PaperTrade
  buildOrderIntent,           // explicit numbers
  tryBuildOrderIntent,        // non-throwing, for poll loops
} from "@/lib/execution/order-intent";
```

- Carries symbol (resolved), side, entry type, qty, stop, target legs,
  time-in-force, a client-generated idempotency key, and the risk figures
  (points, point value, per-contract, dollars, round-turn commission, % of
  equity).
- Target legs follow `APLUS_RULES.scaleOut` — half at TP1, runner at TP2, whole
  order at TP1 when qty is 1 — i.e. what the paper book actually trades, not an
  idealised version.
- `clientOrderId` defaults to the **paper trade id**, so the book row, the
  `desk_trades` row and the shadow record share one identity.
- An unknown symbol is a hard error with **no fallback to MNQ** (unlike
  `contractSpec`, which falls back deliberately for display math). Inverted
  stops, wrong-side targets, and legs that do not sum to qty are refused.

---

## E4 — shadow mode (records; sends nothing)

`shadow_orders` stores the `OrderIntent` the desk would have placed, with the
decision timestamp and the desk context, so it can be diffed against what the
human actually did.

```tsx
import { recordShadowOrder } from "@/lib/execution/shadow";
import { tryBuildOrderIntent } from "@/lib/execution/order-intent";

// Wherever an armed setup is evaluated (the 30s poll is the natural home):
const intent = tryBuildOrderIntent({ /* levels from buildPaperLevels */ });
if (intent) {
  void recordShadowOrder({ data: { intent, source: "desk" } }).catch(() => undefined);
}
```

Row id is the intent's `clientOrderId`, so re-evaluating the same armed setup on
every poll writes ONE row, not one per poll. `listShadowOrders({ data: { since } })`
reads it back for review.

**Deliberately non-sending.** There is no broker API client, no HTTP client, no
socket and no credential handling anywhere in `src/lib/execution/` — the only
side effect is one database row. A real adapter is gated on ROADMAP Phase E's
four unlock conditions (≥100 mirrored paper trades · positive **live-mode**
expectancy · Phase A shipped · B1 shipped), plus E4's own "≥2 weeks where this
diff is boring". Nothing in this branch moves toward transmitting.

---

## Verified (real PGLite, `migrations/*.sql` 0001→0009 applied in order)

`npm run typecheck` and `npm run lint`: **0 errors** from these files. (Two
pre-existing typecheck errors live in other agents' files —
`src/lib/alerts/client.ts:117` and `src/routes/api/cron/checklist.ts:133`.)

| Check | Result |
|---|---|
| Signed-out book of 3 (1 open, 2 closed) backfills once | `opened=3 closed=2` → 3 rows, 2 closed, 2 `EXIT` events |
| Re-diff after the pass | `opens=0 closes=0 durable=3` |
| Replay of the same batch (double mount / retry) | `opened=0 closed=0`, row and event counts unchanged |
| ES-labelled trade (`displaySymbol=ES`, `symbol=MES`) | stored `MES`, +10pt × 2ct = **$98.00** net (`r=1.96`) — **not** the $992 an ES point value would book |
| Full stop-out, MNQ 3ct, 10pt risk ($60) | pnl **−$63.00**, **r = −1.0500** — worse than −1.00R, commission included |
| Late close of an already-mirrored open | `opened=0 closed=1`, pnl $158.00, r 1.9750 |
| Another user closing the same trade id | refused (`false`), row still open |
| `shadow_orders` round trip | intent in = intent out (deep equal, re-validates against `orderIntentSchema`); duplicate write = no-op, 1 row |
| `buildOrderIntent` guards | unknown symbol refused (no MNQ fallback); inverted stop refused; ES risk $500 vs MES $50 on identical levels |
