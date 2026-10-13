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

## Re-check 024f8ed (024f8edd3168ca1c7e2a04a4cc4473b7f540ed47)

### Verdict: CHANGES (docs only)
The code fix is correct and approvable. `CLAUDE.md:55` misstates how the live RH gate treats news. See (c).

### Quote-time gate: verified
`src/lib/execution/rh-autofire.ts`:
- :173 `const age = nowMs - q.asOfMs`
- :174-176 refuse when `age < -RH_LIVE_QUOTE_MAX_FUTURE_SKEW_MS`, with its own reason: "Live quote is stamped Ns in the future (> 5s clock skew) — fail closed."
- :177-179 refuse unless `age >= -5000 && age <= RH_LIVE_QUOTE_MAX_AGE_MS`
- :184 `RH_LIVE_QUOTE_MAX_FUTURE_SKEW_MS = 5_000`. It is declared after the function, but at module scope and only read at call time, so it is safe.

Direct calls (now = 1.76e12):

| asOfMs vs now | Result |
|---|---|
| +4s | ok |
| +5s | ok |
| +5.001s | refused (future) |
| +6s | refused (future) |
| +1h | refused (future) |
| +1y | refused (future) |
| -29s | ok |
| -30s | ok |
| -31s | refused (31s old) |

### New gate cases: verified
- They sit at both propose (`scripts/verify-rh-autofire-gates.mjs:340`) and review (`:397`): -Infinity, string, future +1h, future +1y, 0 and -1.
- **Mutation:** I removed the skew check, restoring the old one-sided `age > MAX`. Result: 277 pass / 4 fail, exactly the future +1h/+1y cases at propose and review. Reverted, and the tree is clean.
- -Infinity, string, 0 and -1 are refused by the type/finite guard at :172 or the age check. They are regression pins, not skew-specific, and they all pass.

### (b) The TS $150 edits are comment-only
`git diff -U0 8fabe05f..024f8edd -- '*.ts' '*.tsx'` with comment lines filtered out leaves only:
- the guard change in `rh-autofire.ts`
- `manager-account.ts:39`, where only the trailing `// 150` comment becomes `// 50 (RH_MIN_DEBIT_TOTAL)`

### brainlab MIN_DEBIT
- `brainlab/gate.py:25` `MIN_DEBIT = 150.0` is real code, used at `gate.py:107` (`cost < MIN_DEBIT`).
- brainlab is the offline Python/Streamlit lab: `streamlit run brainlab/app.py`. Per CLAUDE.md:237 it has "no order path in Python". Nothing in `src/` imports or calls it; src only mentions it in comments.
- **So the mismatch does not affect live trading.** It does make `verify-lab-constants` fail: "debit floor ($): Python 150 = TypeScript 50" (21/1). That failure is already in the baseline as "lab-constants failing 1, not yet diagnosed", so the cause is now known.
- **Fix:** set `MIN_DEBIT = 50.0`, then update `brainlab/selfcheck.py:80,106`.

### (c) The CLAUDE.md:55 rewrite matches ad9d7a02, but not the current live gate
- **The clock part is true.** There are no `aplus_after_10` / `after_11` refusals left anywhere in `src/`.
- **The +0.05 lift and the one-contract cut exist:**
  - `rh-autofire-gates.ts:69` `RH_EVENT_CONFIDENCE_LIFT = 0.05`
  - `:72-76` `confidenceFloorFor`
  - `:94-97` `contractsAfterEvent` → `Math.max(1, n - 1)`
  - Callers are only in the desk card: `options-desk.ts:1633` (reason text, "Size is cut") and `:1705` (`shrinkTicket` when `pressured` = news, shock-tail, clock or day card).
- **The news part is false for the live gate.** `rh-autofire-gates.ts:438-440` hard-refuses on `newsBlackout` with "News / session blackout — stand down". 2ea6f3b8 ("the $150–$550 envelope is enforced again") restored that refusal after ad9d7a02. It is pinned by `verify-rh-autofire-gates.mjs:177-178`: "blackout refuses an A+ too". So "news does not refuse B+ and higher" is wrong for the RH live path. The raised bar and the size cut apply only on the desk card.
- **Fix:** reword CLAUDE.md:55 to say the live RH gate refuses on a news blackout (`rh-autofire-gates.ts:438`), and that the clock no longer refuses. The +0.05 bar and the one-contract cut apply to the desk ticket (`options-desk.ts:1633,1705`).

### No other behavior change
Since 8fabe05f, the only code change is the skew/age guard.

### Tests
- tsc: 0 errors.
- rh-autofire-gates: 281/0.
- manager-live-loop: 58/0.
- rh-dispatch: 39/0.
- rh-cycle: 79/0.
- repo-guards: 56/1 (Judas).
- session-event: 35/1 (Judas).
- lab-constants: 21/1 (MIN_DEBIT, already in the baseline).

### Merge
`git merge-tree --write-tree origin/main 024f8edd` is clean (tree 322a9c5848d5b091404f74ac2888fe7186f2da97). origin/main is still 0a9b8a3a.
