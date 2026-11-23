# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `a3db8ea`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `bcbee5c`. 1 commit(s) landed after it.
Bookmark after this run: `claude` → `a3db8ea`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `a3db8ea` | 2026-11-23T15:07 | Nov 23 mid-session (10:06 ET) session-partner run: re-check canary, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `bcbee5c` | 2026-11-23T13:09 | agent-sync: bookmark claude at c6cd994 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `c6cd994` | 2026-11-23T13:08 | Nov 23 premarket session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `78acde1` | 2026-11-22T22:17 | Restamp Nov 22: add Nov 23-27 Thanksgiving week plan; fix pce phase; calendar entries | M src/data/news-calendar.json, M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `63c9f1b` | 2026-11-20T21:51 | Restamp Nov 20: no ISM/JOLTS/ADP/claims/NFP; UMich 51.5 in-line; NQ/ES extended under seed PWL; Sunday plan holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `88209af` | 2026-11-20T13:14 | Restamp Nov 20 odds and weekly range after Waller 50bp lift | M src/lib/trading/week-ahead.ts |
| `2f065cf` | 2026-11-19T21:55 | Restamp Nov 19 claims print and confirm Sunday under-PWL plan holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `0e29037` | 2026-11-18T17:15 | Merge pull request #95 from keatrng-cpu/cursor/accuracy-nov18-followup-ae23 | — |
| `8ab00bf` | 2026-11-18T23:10 | Correct the November FedWatch line and the minutes condition | M src/data/week-prints.json, M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `03e2de7` | 2026-11-18T23:02 | Test the deletion skip without historical git objects | M scripts/plan-file-guard.test.mjs |
| `9dbd128` | 2026-11-18T23:00 | Apply Accuracy Review notes on the Nov 18 restamp | M ai/DECISIONS.md, M ai/NOW.md, M scripts/hooks/pre-push, M scripts/plan-file-guard.mjs, M scripts/plan-file-guard.test.mjs, M src/data/week-prints.json, M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `ea0b6d7` | 2026-11-18T16:54 | Restore Nov 18 week plan and refuse restamp stubs (#94) | M .ai/prompt_rules.md, M .github/workflows/ci.yml, M CLAUDE.md, M ai/DECISIONS.md, M ai/NOW.md, A scripts/hooks/pre-commit, M scripts/hooks/pre-push, A scripts/plan-file-guard.mjs, A scripts/plan-file-guard.test.mjs, M scripts/stamp-actuals.mjs, A scripts/verify-plan-stubs.mjs, M scripts/verify-repo-guards.mjs, M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `31a330f` | 2026-11-18T15:52 | Restamp Nov 18 cash close: Housing Starts 1.309M +9.9%, FOMC Minutes nearly all expect Dec hike. Sunday post-breakdown under-PWL holds (NQ session ~26.92k-27.33k). Dec hike odds ~95% 25bp. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `cf4089c` | 2026-11-18T15:52 | Restamp Nov 18 cash close: Housing Starts 1.309M +9.9%, FOMC Minutes nearly all expect Dec hike. Sunday post-breakdown under-PWL holds (NQ session ~26.92k-27.33k). Dec hike odds ~95% 25bp. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `5cb85d1` | 2026-11-18T09:42 | Merge pull request #93 from keatrng-cpu/fix/restore-week-month-exports-1118 | — |

## New files in those commits

- `scripts/hooks/pre-commit` in `ea0b6d7`
- `scripts/plan-file-guard.mjs` in `ea0b6d7`
- `scripts/plan-file-guard.test.mjs` in `ea0b6d7`
- `scripts/verify-plan-stubs.mjs` in `ea0b6d7`

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
