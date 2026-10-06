# Merge-gate review: fix/desk-bootstrap @ 0e7d3ad

**SHA:** `0e7d3addaf9336b1bb294f899968691ee3ba4dff`. Base is `008cbec`, which is the tip of origin/main, so the branch is 0 behind and 1 ahead and fast-forwards cleanly.
**Date:** 2026-10-06. Read-only review in my own worktree `/workspace/ld-bootstrap` (removed afterwards). I pushed nothing and edited nothing.

## Verdict: **CHANGES** (one blocking item, small to fix)

The hang fix itself is correct. However, the soft-failed risk path fails **open** on a timeout or DB error. A known halt can disappear from the desk, and the entry button can light up. That breaks the "timeouts must fail closed" requirement.

## Scope (6)
Four files changed, +63/−14: `src/routes/index.tsx`, `src/lib/db.ts`, `src/components/room/room-engine.ts`, `src/components/room/floor-screens.ts`.
- No changes to netlify.toml, package files, `src/lib/execution/**` (rh-autofire.ts, rh-autofire-gates.ts, apex-autofire.ts), the bridge, the env code or the gate constants. `git diff 008cbec 0e7d3ad -- <those files>` is empty.
- There is no unrelated drift.
- Note: the `finally` that clears loading and deskInFlight (`index.tsx:1155-1157`) already existed. It is not new in this diff.

## (1) Honest timeout states
- OK: the desk call has a 35s hard bound (`index.tsx:223-245`, `1100-1106`). A timeout goes to `describeDeskError` (`:206`), and `finally` releases `deskInFlight` (`:1156`). A late result from a timed-out request is dropped, because the wrapper has already rejected. No cached data is re-stamped.
- OK: pulse and news are deferred until the first desk (`room-engine.ts:681,683,705`). On failure they leave `pulse` and `news` unset ("no pulse" / "no headlines" per the existing catch comments, `:692-694`, `:716-718`). Nothing synthetic is filled in.
- **BLOCKING B1 (fail-open, honesty):** when risk times out, the risk value becomes `null` (`index.tsx:1108-1110`). `publishDesk(held, null)` (`:1120`) then **overwrites** the known risk in the synapse, because `risk !== undefined ? risk : get().risk` (`desk-synapse.ts:511-515`). The veteran brain then loses its "Risk halt" veto (`veteran-brain.ts:549-559`). So a user who was halted sees the halt veto vanish on any poll where risk takes more than 12s.
- **BLOCKING B1b:** the new `connectionTimeoutMillis: 8000` (`db.ts:139`) turns a Neon stall into a thrown error. Before, it was a hang, and the desk sat at "loading", which is closed. Now `loadRisk`'s catch maps **every** error to `"no-session"` (`index.tsx:925-929`), and `entryAllowed` becomes `true` for "no-session" (`:933-938`). That shows the actionable take button (`setup-scanner.tsx:892`) and drops the "risk governor" blocker (`:355`). This path was unreachable before this branch, because the desk never mounted while risk hung.
  - Suggested fix:
    1. On a client risk timeout, pass `undefined` instead of `null` to `publishDesk`, so the last-known risk is kept.
    2. In `loadRisk`, tell auth-absent apart from transport/timeout errors. On a transport error, keep the previous state, or add an `"unknown"` state that blocks entry and shows "risk unavailable · since HH:MM".
- SHOULD-FIX S1 (existing before this branch, but the new timeout path is invisible): the error banner only renders when `!desk` (`index.tsx:1788`). Once a desk exists, a timed-out rebuild shows nothing, with no stale label and no `fetchedAt` age. The lag dot uses the payload's `lagSec` (`session-hud.tsx:175-182`, tones at `:90-135`), and the quote poll keeps the last quotes on failure ("keep last quotes"). So a stale build can keep a green dot. Fix: show a "Desk stale · built HH:MM:SS · <reason>" strip when `error && desk`.
- SHOULD-FIX S2: the quote poll has no client timeout of its own. If its in-flight request hangs, the quote poll freezes. This is outside this diff.

## (2) Gates failing closed
- The order, arm and env paths have not changed (see Scope).
- The RH gates are pure functions and do not touch the DB:
  - liveQuote fails closed at propose and mayPlace (`rh-autofire.ts:203,267-268,326-327`)
  - PATH-fire freshness check (`:507`)
  - BP staleness check (`rh-autofire-gates.ts:195-225`)
  - tape staleness check (`:354`)

  A client timeout cannot feed them data, and they do not default to allow.
- Apex autofire runs on the server: `openTrade` recomputes halts there (`apex-autofire.ts:194-232`). A DB connect timeout throws and is refused, which is closed.
- So no order or arm can result from B1. The fail-open in B1 is in the **UI gate and the advisory veto**, and Keaton trades from those during the open.

## (3) Neon pool
- 8s connect timeout under a 12s risk budget and a ~26s edge. Reasonable.
- `pool.query` acquires and releases a connection by itself, so there is no leak.
- Errors propagate, and there is no fallback to PGLite on query errors (`db.ts:291-297`).
- The journal and analytics panels show errors instead of empty stats (`journal-panel.tsx:130`, `analytics-panel.tsx:700`, `discipline-panel.tsx:62`).
- SHOULD-FIX S3: there is no `pool.on('error')` handler. An idle-client error can crash the function (this was already the case). There is also no `query_timeout` or `statement_timeout`, so a query that hangs after connecting is still bounded only by the client and the edge.

## (4) Timeout values and retries
- Desk timeout is 35s, above the 14-22s build and the ~26s edge, so a real 504 still surfaces first. Risk timeout is 12s.
- Retries are not in a loop. They come from the existing cadence (`msUntilNextDeskPoll`, about every 30s) plus the visibility change, and they are guarded by `deskInFlight`. The guard is released only after the 35s timeout, by which point the edge has already killed the server request. No hammering.

## (5) VIX
- `drawWindow` now sets `v = null` when VIX is missing. That gives no clouds, no storm and no rain (`floor-screens.ts:815-817,841,867`).
- The stars still draw at night, which is correct for a clear sky.
- `floor-scene.ts:2636,2650` uses `?? 0`, which means no storm and normal lighting, consistent with no weather.
- A grep found no other default VIX. Only drill fixtures (`drill.ts`) and orchestrator placeholders with `vix: 0` (`orchestrator.ts:867-868`), which are out of scope.

## (7) Suites (NODE_OPTIONS=--max-old-space-size=2048, one at a time; free memory checked, at least 9.4GB available each time)

| suite | result |
|---|---|
| tsc --noEmit | 0 errors |
| verify-rh-autofire-gates | 218/0 |
| verify-rh-path-fire | 111/0 |
| verify-manager-live-loop | 58/0 |
| verify-floor-rh-account | 21/0 |
| verify-room-exec | 222/0 |
| verify-repo-guards | 59/0 |
| verify-live-talk | 111/0 |
| verify-autofire-gates | 22/0 |
| verify-desk-cadence | 11/0 |
| verify-desk-enhancements, verify-room, npm test (units) | NOT RUN (interrupted when the wrap-up was requested) |

No suite covers withClientTimeout or loadRisk, so B1 has no test.

---

## Re-review 00c071e

**SHA:** `00c071e4eb758fda93708c122c982b05ebfad76d`. It builds on 0e7d3ad (confirmed as an ancestor, so there was no force-push). origin/main is still `008cbec`, so this fast-forwards with 0 behind.
**Setup:** read-only, in my own worktree `/workspace/ld-bootstrap2` with its own `npm ci` (removed afterwards). 2GB cap, and I ran `free -m` before every suite: at least 6.8GB was available each time. I killed no processes.

### Verdict: **APPROVE**
B1 and B1b are fixed. The should-fix items below are not blocking. S4 is the one closest to the "never reads as clear" line.

### B1: every risk-error path ends with entry blocked and the halt kept
- The desk no longer waits on risk:
  - `void loadRisk()` runs on its own (`index.tsx:1122`).
  - `publishDesk(held)` is called with no risk argument (`:1141`).
  - The synapse merges through `resolvePublishedRisk`, which keeps the previous risk when the argument is `undefined` (`desk-synapse.ts:512-518`; `desk-fetch-guard.ts` resolvePublishedRisk).
  - So a slow risk read can no longer wipe a known halt. The brain's "Risk halt" veto (`veteran-brain.ts:549-559`) and the `HaltBanner` (fed by `risk`, which is only set on "ok") both survive.
- `loadRisk` (`index.tsx:907-947`) reads the governor through `readRiskGoverned` with a 12s budget, using `Promise.allSettled`, so it never rejects. Each failure type lands here:

  | Failure | Result |
  |---|---|
  | Hang, or client timeout (`ClientTimeoutError`) | "unknown" |
  | Network error, 5xx, pg connect timeout or query_timeout | "unknown" |
  | Better Auth DB failure (it rethrows as `INTERNAL_SERVER_ERROR` "Failed to get session", see `better-auth/dist/api/routes/session.mjs` getSession catch) | "unknown" |
  | Synchronous throw | "unknown" |
  | Server `UnauthorizedError` (`verify.server.ts:36-41,94`) | "no-session" |
  | Settings or discretion failure | discretion becomes neutral; the gate is not affected |
  | A stale (superseded) read | dropped (`riskSeq`) |

  In the "unknown" branch (`:944`), publishRisk is not called and `risk` is not touched.
- The entry gate is `riskEntryAllowed` (`index.tsx:949`; `desk-fetch-guard.ts` riskEntryAllowed). "loading" and "unknown" return false, and "ok" with a null risk also returns false.
  - The take button needs `entryAllowed` (`setup-scanner.tsx:898`).
  - The blocker strip shows "risk unknown · since HH:MM:SS ET" (`setup-scanner.tsx:358`, reason built at `index.tsx:950`).
  - A red banner reads "Risk governor unreachable … entry blocked" (`index.tsx:1831`).
  - SetupScanner has only one call site (`index.tsx:1919-1924`), and it passes both props.
- The test file pins this end to end: `scripts/desk-fetch-guard.test.mjs` "timeout end-to-end: halted user…", plus the wiring tests.

### 401 precision
- `isSignedOutError` returns false for a `ClientTimeoutError`. It returns true for `name === "UnauthorizedError"`, for status or statusCode 401, or for a message matching `\bunauthori[sz]ed\b`.
- A 5xx, network or pg error does not match, so it is classed "unknown".
- **S5 (should-fix):** the message regex is a substring match. Anchor it to the exact `^Unauthorized$` the server emits, so an upstream error text that merely mentions "unauthorized" can't flip the gate open.

### Stale strip and lag dot
- `{error && desk}` now renders "Desk stale · built HH:MM:SS ET · <reason>" (`index.tsx:1822`; `deskStaleLine`). The error is cleared only on the next success (`:1111-1112`, `:1139`).
  - It shows the build time (the asOf), not "Ns ago". Adding the age would be a nice extra; it is not blocking.
- The lag dot and the chips now use `effectiveLagSec`, which is the payload lag plus the time since `fetchedAtMs` (`session-hud.tsx:174-181,385,393,399`). `LiveQuote.fetchedAtMs` exists (`market/types.ts:35`). So a frozen quote ages out of green: amber after 15s, red after 2 min. The HUD re-renders every second through `wallNow`.
- The quote poll is now bounded at 8s (`index.tsx:235,1313-1318`).

### Pool (S3)
- `query_timeout: 10_000` and `pool.on('error')` were added (`db.ts:140-157`). The comment explains why `statement_timeout` is not sent as a startup parameter (the Neon pooler rejects it).
- **S6:** the separate Better Auth pool `new Pool({ connectionString })` (`auth/server.ts:178`) has no connect timeout and no error handler. A hang there still ends as "unknown" after 12s, which is closed. The idle-error crash risk was already there before this branch.

### Remaining should-fix
- **S4:** the veteran brain and posture text use the last-known risk without an "unknown" marker.
  - If the last read was clear, or there has been no read since boot, the brain's veto list shows "None" while the governor is unknown.
  - The take button and blocker are closed and the red banner is up, so no action is open. Still, an advisory surface reads clear. Suggested fix: add a "risk unknown" veto when the gate state is "unknown".
- **S7:** a genuine 401 after a known halt gives "no-session", which allows entry (the server still rejects the write). This was the behaviour before this branch too.
- **S8 (repo hygiene, not this branch):**
  - `tsx` is imported by the `*.test.mjs` files (including the new one), but it is not in `package.json`. A clean `npm ci` fails the test until tsx is installed.
  - `npm test`'s glob `'scripts/**/*.test.mjs'` does not expand on Node 20.

### Scope
- Seven files changed, +538/−71: index.tsx, desk-synapse.ts, session-hud.tsx, setup-scanner.tsx, db.ts, plus the new desk-fetch-guard.ts and its test.
- `git diff 008cbec 00c071e -- src/lib/execution src/lib/bridge netlify.toml package.json package-lock.json` is empty. There are no changes to execution, env or gate files.

### Suites (one at a time, NODE_OPTIONS=--max-old-space-size=2048)

| suite | result |
|---|---|
| tsc --noEmit | 0 errors |
| desk-fetch-guard.test.mjs | 20/0 (after a `--no-save` install of tsx in my worktree; see S8) |
| units (`node --test scripts/*.test.mjs`, 8 files) | 59/0 |
| rh-autofire-gates | 218/0 |
| rh-path-fire | 111/0 |
| manager-live-loop | 58/0 |
| floor-rh-account | 21/0 |
| room-exec | 222/0 |
| repo-guards | 59/0 |
| desk-cadence | 11/0 |
| desk-enhancements | 223/0 |
| live-talk | 111/0 |
| autofire-gates | 22/0 |
