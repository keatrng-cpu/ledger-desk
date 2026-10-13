# Accuracy review: chore/doc-drift-known-dark @ 96ea3bec8b4febe5d0de43a5ac7a22e53bcda7d3

Base: main bef486df4eaba78832a7c430ab84fb985f24a4dc. Author: Trading Stand. Reviewed read-only on 2026-10-12.

## Verdict: CHANGES

## Claims
(a) **TRUE, with a stale line reference.** `src/lib/aplus/config.ts:83` now says `$50-$550`. The constants are `RH_MIN_DEBIT_TOTAL = 50` and `RH_MAX_DEBIT_TOTAL = 550` at `src/lib/execution/rh-autofire-gates.ts:137-138`. They are not at line 115.

(b) **PARTLY FALSE.**
- Removing `auth/verify.server.ts` is correct. It is imported at `src/routes/api/rh/connect.ts:10` and `src/routes/api/rh/callback.ts:7`, and dynamically at `src/lib/auth/middleware.ts:41`.
- Removing `market/tape-trust.ts` is correct. It is imported at `src/lib/trading/scanner.ts:61`.
- Adding `floor-ik.ts` and `floor-locomotion.ts` is correct. rg finds them only in `scripts/verify-floor-*.mjs`.
- Adding `rh-http.ts`, `rh-ledger.ts` and `rh-mcp.ts` is **wrong**. All three are reached by live code through dynamic `await import()`:
  - `rh-ledger`: `src/routes/api/cron/exec-flatten.ts:52`, `room-step.ts:121`, `rh-manage.ts:197`, `src/lib/execution/rh-server.ts:39`
  - `rh-mcp`: `exec-flatten.ts:53`, `room-step.ts:122`, `rh-manage.ts:210`, `rh-server.ts:40`, `src/lib/execution/option-marks.ts:61`
  - `rh-http`: `src/lib/execution/option-marks.ts:69`, `rh-mcp.ts:298`

  The guard's import detection (`scripts/verify-repo-guards.mjs:181` and after) misses dynamic `import()`, so it reports them as dark when they are not. The new comment at `verify-repo-guards.mjs:279-280`, "not imported from src/ UI or live loops", is false: the cron routes are live loops. The header also says "This list may only ever SHRINK", and this change adds 5 entries.

  Fix: teach the guard to match `import("...")` and keep these three off KNOWN_DARK. Or, at the least, say truthfully that they are listed only because the guard cannot see dynamic imports.

(c) **TRUE.** Only `scripts/verify-repo-guards.mjs` (inventory and comments) and `src/lib/aplus/config.ts` (one comment line) change. There is no runtime behavior change.

(d) **TRUE.**
- tsc: 0 errors.
- rh-autofire-gates: 261/0, run via `npx tsx`. Plain `node` fails with ERR_UNKNOWN_FILE_EXTENSION.
- repo-guards: 56/1. The only failure is "smc-master fails the clean layer during Judas unless judas-window released it", which is item (c) of `scripts/verify-baseline.json` repo-guards (failing: 3).
- On bef486d, repo-guards is 54/3: the 5 new-dark failure, the 2 now-wired failure, and the same Judas failure.
- Follow-up: the baseline count of 3 should drop to 1 after merge.

(e) `git merge-tree --write-tree origin/main 96ea3bec`: clean, tree 3fd4f0f9a64479bed7a7f1d73bfe3193db87e0f7. origin/main is still bef486d.

## Re-check b0cee82 (b0cee82af106b58c7b9b68eb4534189c74ae1226)

### Verdict: APPROVE, with two optional nits

1. **Dynamic imports.** The guard regex at `scripts/verify-repo-guards.mjs:204-205` is now `(?:from|import\s*\(?|require\()\s*["']…`. It matches both `import("…")` and `import('…')`.
   - It does not match template literals such as ``import(`…`)``, and the code doesn't say why. That is acceptable: `rg 'import\(\s*`' src` finds none in the repo, and a template path with `${…}` can't be checked statically anyway.
   - The new pattern isn't vacuous. With `await import("./isolation.server")` removed from `src/lib/auth/middleware.ts:40`, the guard went to 55/2 and flagged `isolation.server.ts` as NEW dark. Reverted, and the tree is clean.
   - A second mutation, removing `rh-server.ts:39` `import("./rh-ledger")`, correctly did not flag. rh-ledger is still imported by the cron routes.
2. **rh-http, rh-ledger and rh-mcp are off KNOWN_DARK**, and the false "not imported from … live loops" comment has been removed.
3. **isolation.server.ts is off the list.** It is dynamically imported at `src/lib/auth/middleware.ts:40`.
4. **floor-ik and floor-locomotion stay listed, and they really are unwired.** The only mentions in src are doc comments in `src/lib/room/floor-feet.ts:9,19,197`, which are not imports. The new regex still classes both as dark, and the guard shows no "now wired" failure.
5. **Baseline.** `scripts/verify-baseline.json` repo-guards now says `failing: 1` (was 3). The why-text names Judas as the only remaining failure.
6. **Tests.**
   - tsc: 0 errors.
   - rh-autofire-gates (`npx tsx`): 261 passed / 0 failed.
   - repo-guards: 56 passed / 1 failed. The failure is Judas only.
7. **Merge.** `git merge-tree --write-tree origin/main b0cee82a`: clean. origin/main is still bef486d.

### Nits (optional)
- `scripts/verify-repo-guards.mjs:283` still says "(inventory refresh; guards unchanged)". This delta did change the guard regex, so that line is now stale.
- Add a one-line comment next to the regex saying template-literal imports are intentionally not matched.
