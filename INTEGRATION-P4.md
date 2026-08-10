# INTEGRATION-P4 — automation bridge (branch `agents/phase-p4`)

Everything Phase 4 added, and the two wiring steps the integrator owns. Nothing
here edits `src/routes/index.tsx`, the desk components, `scanner.ts`,
`build-desk.ts`, `structure.ts`, `src/lib/journal/**`, or migrations 0002/0003.

## Files added

| File | Role |
|---|---|
| `src/routes/api/engine/journal.ts` | `POST /api/engine/journal` — engine journal ingest |
| `src/routes/api/engine/heartbeat.ts` | `POST /api/engine/heartbeat` — engine liveness |
| `src/lib/bridge/auth-server.ts` | bearer-token gate (503 unset / 401 mismatch, constant-time) |
| `src/lib/bridge/schema.ts` | zod wire schemas + engine→desk field mapping |
| `src/lib/bridge/ingest-server.ts` | parameterized SQL: desk_events insert, batch dedupe, engine_status |
| `src/lib/bridge/paper-server.ts` | server fns: paper cycle commit, status read, paper toggle |
| `src/lib/trading/paper.ts` | pure paper-loop logic (no timers, no I/O) |
| `src/components/bridge/bridge-status.tsx` | status card (not mounted) |
| `migrations/0004_bridge.sql` | `engine_status`, `engine_ingest_batches` |
| `docs/ENGINE_BRIDGE.md` | Python-side contract |
| `.env.example` | `ENGINE_BRIDGE_TOKEN`, `ENGINE_BRIDGE_USER_ID` placeholders |

`src/routeTree.gen.ts` is regenerated (the two API routes) — that file is
generated output, not hand-edited.

## Route architecture — why TanStack Start, not Nitro

`vite.config.ts` registers the Nitro plugin only when `command === "build"`
(comment: enabling it in dev opens a second port and breaks the single-port live
preview). So `server/routes/*` would 404 under `npm run dev` and only exist on
Vercel builds — unusable for a bridge you must test locally. `server/` here holds
Nitro **middleware** only (`grok-pwa.ts`).

TanStack Start server routes (`createFileRoute(...)({ server: { handlers } })`,
supported in `@tanstack/react-start` 1.168 via the `RouteServerOptions`
augmentation) compile in both dev and build, so the endpoints live in
`src/routes/api/engine/*.ts`. Verified: the route tree picked both up and the
endpoints answered live in `vite dev`.

## Wiring step 1 — mount the status card

```tsx
// src/routes/index.tsx
import { BridgeStatus } from "@/components/bridge/bridge-status";

// …anywhere in the section stack (it is self-contained — no props required):
<BridgeStatus />
```

It fetches its own data via `getBridgeStatus()` and refreshes every 30 s, so it
does not need the desk payload and does not add a prop to any existing section.

## Wiring step 2 — drive the paper loop from the existing 30 s poll

The loop is a pure function plus one server call. Suggested shape inside the
existing poll handler in `index.tsx` (after `desk` is refreshed):

```tsx
import { evaluatePaperCycle } from "@/lib/trading/paper";
import { commitPaperCycle, listOpenPaperTrades } from "@/lib/bridge/paper-server";

async function runPaperCycle(desk: DeskPayload) {
  const open = await listOpenPaperTrades();               // OpenPaperTrade[]
  const bars = {
    [desk.left.symbol]: desk.left.bars.at(-1),
    [desk.right.symbol]: desk.right.bars.at(-1),
  };
  const cycle = evaluatePaperCycle(
    desk.scan.candidates,          // SetupCandidate[]
    desk.bias,                     // { left, right }: HtfBiasRead
    open,
    bars,                          // Record<symbol, OhlcBar | undefined>
  );
  if (cycle.entries.length || cycle.exits.length) {
    await commitPaperCycle({ data: { entries: cycle.entries, exits: cycle.exits } });
  }
}
```

Contract notes:

* **Feature-flagged OFF by default.** `commitPaperCycle` re-checks
  `engine_status.paper_enabled` server-side and returns
  `{ opened: 0, closed: 0, skippedDisabled: true }` when the loop is disarmed —
  a stale client cannot write paper trades after the toggle is turned off. The
  caller may still skip the call entirely when the card shows "off".
* `evaluatePaperCycle` is pure: no timers, no fetches, no clock branching. It is
  safe to call every poll, and safe to drive with historical bars for replay.
* Bars key by the symbols in `desk.left.symbol` / `desk.right.symbol`; a missing
  bar for a symbol simply means no exit test that cycle.
* **Data-quality caveat (ROADMAP D7):** `actionable` is not yet gated on feed
  source, so skip the whole cycle when
  `desk.left.source === "synthetic" || desk.right.source === "synthetic"` —
  a paper sample built from synthetic bars proves nothing and would poison the
  ≥100-trade expectancy gate.

### Paper semantics (fixed, deliberately conservative)

| Element | Rule |
|---|---|
| Eligibility | `candidate.actionable === true`, and no open paper trade on the same symbol + side |
| Entry | numeric midpoint of the candidate's half of the dealing range — long: `(low+eq)/2`, short: `(eq+high)/2` |
| Stop | numeric invalidation: **PDL** (long) / **PDH** (short); dealing-range extreme as fallback; candidate skipped if the level sits on the wrong side of entry |
| Target | 2R from entry |
| Size | 1 micro contract (`PAPER_CONTRACTS`) |
| Exit | touch test on the current bar: long stop `bar.l <= stop`, target `bar.h >= target` (mirrored for shorts) |
| Same-bar ambiguity | **stop wins** — intrabar order is unknowable from OHLC, so the adverse path is always assumed |
| PnL | `points × pointValue × contracts − round-turn commission` from `CONTRACTS` in `src/lib/aplus/config.ts`; slippage 0 |
| Labelling | `desk_trades.mode='paper'`, `desk_trades.source='paper'`, `desk_events.source='paper'`, reasons prefixed `PAPER` |

## Paper-mode toggle — where the state lives

In `engine_status.paper_enabled` (migration 0004), **not** a separate settings
table. Rationale: the bridge already owns exactly one row per user there, the
toggle is bridge state, and it lets `POST /api/engine/heartbeat` echo
`paper_enabled` back to the Python engine in the response it is already making —
no extra endpoint, no second source of truth. `engine_status.id` carries the user
id (the `'singleton'` default only exists for a manual single-user insert).

## Schema dependency

`desk_trades` / `desk_events` come from **Phase 1's `migrations/0002_journal.sql`**
and do not exist on this branch. Bridge code is written against the agreed
column contract and typechecks, but any code path that touches those two tables
could not be runtime-verified here. Post-merge smoke test:

```bash
export ENGINE_BRIDGE_TOKEN=<token>
curl -sS -X POST localhost:8080/api/engine/journal \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{"batch_id":"smoke-1","events":[{"ts":"2026-08-10T14:00:00Z","event":"SKIP","symbol":"MNQ","confluence":0.48,"skip_reason":"below floor"}]}'
# expect 201 inserted:1 — then repeat the exact call, expect 200 duplicate:true
```

Also confirm `select count(*) from desk_events where source='engine'` moves by 1,
not 2.

## Environment

Add to `.env` (gitignored; `.env.example` holds the placeholders):

```
ENGINE_BRIDGE_TOKEN=       # unset ⇒ endpoints answer 503 and write nothing
ENGINE_BRIDGE_USER_ID=dev-user
```

On Vercel, set both as project environment variables. `ENGINE_BRIDGE_USER_ID`
must match the desk user whose journal should show the engine rows, otherwise the
rows land on a user nobody is looking at.
