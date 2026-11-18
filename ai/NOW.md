# NOW — ledger-desk current truth
**As of:** 2026-11-18 · **Maintainer:** Cursor agent · **Repo:** `keatrng-cpu/ledger-desk`
**Tree:** `main` tip `31a330f` is still the stub. This branch restores the plan files and refuses the next stub. Not merged. Release Watch and Accuracy Review gate GO/NO-GO. Issue #7.
> Current truth only. History is `ai/DECISIONS.md`. Keep under 150 lines.

## Canary
`cf4089c0` replaced `src/lib/trading/week-ahead.ts` (718 lines) and `src/data/week-prints.json` (443 lines) with `PLACEHOLDER_AHEAD` / `PLACEHOLDER_PRINTS`. `31a330f` renamed those tokens to `READ_FROM_FILE_AHEAD` / `READ_FROM_FILE_PRINTS`. Both commits are titled "Restamp Nov 18 cash close" and were pushed at 15:52 CT. CI run 44405903950 failed typecheck (TS1005). Netlify prod deploys of that tip failed. Live site is still deploy `5cb85d1d`.

Last good bodies: `5cb85d1d` (merge of PR #93). `month-ahead.ts` was not touched by the stub commits and is unchanged here.

## Nov 18 figures re-applied
Source is the commit message of `cf4089c0` and `31a330f` (identical). The diffs contain only the tokens, no file body.

Stamped on the Wednesday row and as two `week-prints.json` rows:
- Housing Starts (Oct) actual `1.309M +9.9%`. The "(Oct)" name is the existing 2026-11-18 calendar row, not a new series.
- FOMC Minutes (Oct meeting) actual `nearly all expect Dec hike`.
- NQ session `~26.92k-27.33k` on the Wednesday `likelyTape` / `pathNote` only. Seed PWH/PWL were not overwritten.
- Sunday post-breakdown under-PWL holds.
- Dec hike odds `~95% 25bp` on the Wednesday row only.

## Left at the last good value
Not in the restamp commits, so not invented:
- Housing Starts consensus, prior, SAAR vs raw, and whether +9.9% is MoM or YoY. `vs` is `—`.
- FOMC minutes quote, vote, or URL beyond "nearly all expect Dec hike".
- ES session range.
- Week-level `htfBias` / `macro` still say Dec hike odds `~95-96%` (CME FedWatch Nov 17). The cash-close line did not say to replace that sentence.
- `src/lib/trading/month-ahead.ts`. `src/lib/aplus/config.ts`.

## Guard
There is no restamp script in the repo. The writer is the cash-close restamp, which rewrites the whole file and, when the body does not come back, commits the token. Same class as `$(cat /tmp/...)` and `FULL_CONTENT_FROM_FILE`.

`scripts/plan-file-guard.mjs` refuses a `READ_FROM_FILE_*` (and the older tokens) on write (`stamp-actuals.mjs`), on commit (`scripts/hooks/pre-commit`), and on push (`pre-push --range`). It also refuses a shrink of more than half of `week-ahead.ts`, `month-ahead.ts`, `week-prints.json`, or `news-calendar.json`. CI runs `--worktree` before typecheck. `verify-plan-stubs.mjs` is in `verify-all`.

## Live constraints
- If copy and `src/lib/aplus/config.ts` disagree, code wins. Agents do not change those numbers.
- Do not lower the confluence floor. A+ is the 0.75 edge. B+ live stays behind `evaluateRhBplusGate`.
- This patch places no order.
- No invented fills or future actuals.

## Owners
Issue #7: Accuracy Review then Release Watch then Design Atelier merge to `main`. This branch does not merge itself.
