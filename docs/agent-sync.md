# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `75a5ebf`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `826c6c6`. 1 commit(s) landed after it.
Bookmark after this run: `claude` → `75a5ebf`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `75a5ebf` | 2026-11-26T14:07 | agent-sync: bookmark claude at 826c6c6 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `826c6c6` | 2026-11-26T14:07 | Nov 26 premarket (09:06 ET) session-partner run: Thanksgiving closure, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `c19891a` | 2026-11-26T13:13 | Restamp Thanksgiving week range and Dec hike odds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `f99ba36` | 2026-11-25T16:54 | Merge pull request #97 from keatrng-cpu/fix/week-ahead-exports-1125 | — |
| `fc99902` | 2026-11-25T16:40 | Restore weekDayFor, weekAheadFocusLine, and overlayWeekAhead after Nov 25 restamp | M src/lib/trading/week-ahead.ts |
| `37bbc0d` | 2026-11-25T15:55 | Restamp Nov 25 day plan with printed actuals; Sunday under-PWL holds | M src/lib/trading/week-ahead.ts |
| `14e8287` | 2026-11-25T15:53 | Restamp Nov 25 day plan with printed actuals; Sunday under-PWL holds | M src/lib/trading/week-ahead.ts |
| `3d62208` | 2026-11-25T15:53 | Restamp Nov 25 prints: claims 189k, PCE core 3.3% y/y, GDP +4.3%, durables +0.2% | M src/data/week-prints.json |
| `c272b13` | 2026-11-25T15:51 | Restamp Nov 25 prints: claims 189k, PCE core 3.3% y/y, GDP +4.3%, durables +0.2% | M src/data/week-prints.json |
| `164c45f` | 2026-11-25T15:51 | Restamp Nov 25 prints: claims 189k, PCE core 3.3% y/y, GDP +4.3%, durables +0.2% | M src/data/week-prints.json |
| `f1247b5` | 2026-11-25T14:08 | agent-sync: bookmark claude at b417fae (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `b417fae` | 2026-11-25T14:08 | Nov 25 premarket (09:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `f8fe79d` | 2026-11-25T13:08 | agent-sync: bookmark claude at 8fffae3 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `8fffae3` | 2026-11-25T13:08 | Nov 25 premarket (08:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md |
| `602ed4f` | 2026-11-24T21:51 | restamp Nov 24: Confidence 103.3 surge; NQ/ES still under seed PWL | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
