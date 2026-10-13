# Accuracy review: fix/livequote-asof-failclosed @ 8fabe05ff06ccb784381d8890ef612472d837ec2

- Owner: Trading Stand
- Base: main 0a9b8a3a5d568f2c00f18676cc9d16c275450c2e
- Reviewed read-only on 2026-10-12. Live-trading critical: fires at the 10-13 open.

## Verdict: CHANGES

### Blocking: a quote stamped in the future passes the gate
The new guard is at `src/lib/execution/rh-autofire.ts:172`. The age check is at `:173`: `nowMs - asOfMs > RH_LIVE_QUOTE_MAX_AGE_MS`. A future `asOfMs` gives a negative age, so it passes. I ran `evaluateRhLiveQuote` directly with now = 1.76e12:

| asOfMs | Result | Refused by |
|---|---|---|
| missing / undefined | refused | guard :172 |
| null | refused | guard :172 |
| NaN | refused | guard :172 |
| Infinity | refused | guard :172 |
| -Infinity | refused | guard :172 |
| string | refused | guard :172 (typeof check) |
| 0 | refused | age :173 ("1760000000s old") |
| negative (-5) | refused | age :173 |
| now - 31s | refused | age :173 (31s > 30s) |
| now - 1s | ok, limit 2.02 | n/a |
| **now + 1h** | **ok, limit 2.02** | **not refused** |
| **now + 1y** | **ok, limit 2.02** | **not refused** |

**Fix:** also refuse when `asOfMs > nowMs + small skew` (for example 5s). One way is `const age = nowMs - q.asOfMs; if (!(age >= -5_000 && age <= RH_LIVE_QUOTE_MAX_AGE_MS)) refuse`. Add gate cases for the future value, plus -Infinity, a string, 0 and a negative value.

**Mitigation today:** in the live path, `rh-mcp.ts:247` and `rh-http.ts:111` stamp `asOfMs: Date.now()` locally. The live dispatch cannot produce a future stamp today.

**Pre-existing issue, worth flagging:** because of that local stamp, the age check measures our fetch age, not the broker's quote time. The 30s staleness check never sees a stale broker quote.

### Both entry points use the guard, and nothing bypasses it
- **Propose:** `proposeRhLiveOption` → `rh-autofire.ts:280` `evaluateRhLiveQuote(args.liveQuote, nowMs)`, which refuses with `gate: "live_quote"` (:281-288).
- **Final placement check:** `mayPlaceAfterReview` → `rh-autofire.ts:339`, which refuses at :340.
- **Other callers:**
  - `buildRhReviewPlaceShape` (:215) also calls the guard. It is only reached after the propose check at :290.
  - The only path that places an order is `rh-dispatch.ts:372` `mayPlaceAfterReview(...)` → :386 `if (!may.ok) return`, and only then claim and place.
  - `manager-live-loop.ts:157,222` and `rh-autofire.ts:587` pass `liveQuote` through to propose.
- A finite but stale `asOfMs` is still refused by age (31s case above).

### The spread-aware limit from 34f54793 is unchanged
The diff only touches the `asOfMs` lines at :172-173; mid, spread and walked at :169-171 are untouched. Probe: bid 1.0 / ask 2.0 gives limit 1.50 (mid, since spread > 15%), and bid 1.9 / ask 2.0 gives 2.02 (ask + 0.02).

### The 8 new gate cases are non-vacuous
The cases are at `scripts/verify-rh-autofire-gates.mjs:340-343` (propose) and `:397-399` (review); each block covers missing, null, NaN and Infinity.
- **Mutation 1:** swapping in main's old guard (`git show origin/main:src/lib/execution/rh-autofire.ts`) gave 261 pass / 8 fail, all 8 new cases.
- **Mutation 2:** deleting only line :172 failed 6 of them. null still refuses through the now-unconditional age line.
- Both reverted, and the tree is clean.

### Baseline (2): verified
`scripts/verify-baseline.json` gains a `session-event` entry: failing 1, Judas reason, since 2026-10-12. The single failure is "no TAKE inside Judas across 151 real Judas bars — got 1 want 0", the same cause as the repo-guards Judas entry.

### Docs (1): verified at the named lines
- `CLAUDE.md:55`: BP ≥ $50 and the $50–$550 envelope.
- `ai/NOW.md:47`: 50/550 with `(:137-138)`, which matches `rh-autofire-gates.ts:137-138`.
- `docs/RH_LIVE_ROUTINE.md`: 9 lines changed, including :53 and :106.
- The BP floor really is $50: `manager-account.ts:96` `envelopeMinUsd: RH_MIN_DEBIT_TOTAL`.

**Not in this diff (non-blocking cleanup):** `rg '\$150'` still finds stale min-debit or BP-floor comments in:
- `rh-autofire.ts:4,9,361,484`
- `rh-autofire-gates.ts:11,15,21,219`
- `manager-account.ts:8,9,19,39,183,197`
- `manager-room-feed.ts:16,159`
- `options-swing-panel.tsx:109`
- `debate.ts:8`
- `rh-account.ts:53,55`
- `screen-flash.tsx:13`
- `brainlab/gate.py:6`
- `brainlab/selfcheck.py:80,106`
- `verify-rh-path-fire.mjs:176`

(The sleeve-sizing, trade-plan and setup-memory $150 mentions refer to the risk budget, not the debit floor.) Separately, CLAUDE.md:55 still says "A+ only ≥ 10:00 rules", which ad9d7a02 removed.

### No other behavior change
The only `src/` change is the 2-line guard; everything else is docs, the baseline file and tests.

### Tests
- tsc: 0 errors.
- rh-autofire-gates: 269/0.
- manager-live-loop: 58/0.
- rh-dispatch: 39/0.
- rh-cycle: 79/0.
- repo-guards: 56/1 (Judas).
- session-event: 35/1 (Judas).

### Merge
`git merge-tree --write-tree origin/main 8fabe05f` is clean (tree 7d68995f677007a2f520b41211b7be5498b9e0d2). origin/main is still 0a9b8a3a.
