# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `f158bb1`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `6142377`. 3 commit(s) landed after it.
Bookmark after this run: `claude` → `f158bb1`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `f158bb1` | 2026-11-27T14:07 | Nov 27 09:06 ET session-partner run: integrity canary tripped, trader notified | M ai/DECISIONS.md, M ai/NOW.md |
| `5d55d66` | 2026-11-27T07:16 | Update week-ahead: stamp this-week ES high ~7334, add Nov30-Dec4 NFP week plan with prior PWH/PWL, extend news-calendar for ISM/JOLTS/ADP/claims/NFP. No invented prints. PATH floor 0.65 intact. | M src/data/news-calendar.json, M src/lib/trading/week-ahead.ts |
| `765058f` | 2026-11-27T13:08 | agent-sync: bookmark claude post-push | M docs/agent-sync.json, M docs/agent-sync.md |
| `6142377` | 2026-11-27T13:07 | Nov 27 premarket (08:06 ET) session-partner run: Friday early-close brief, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `0fda0b9` | 2026-11-26T15:07 | agent-sync: bookmark claude post-push | M docs/agent-sync.json, M docs/agent-sync.md |
| `5a2309e` | 2026-11-26T15:07 | Nov 26 10:06 ET session-partner run: Thanksgiving holiday confirmed, no trade, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `75a5ebf` | 2026-11-26T14:07 | agent-sync: bookmark claude at 826c6c6 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `826c6c6` | 2026-11-26T14:07 | Nov 26 premarket (09:06 ET) session-partner run: Thanksgiving closure, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `c19891a` | 2026-11-26T13:13 | Restamp Thanksgiving week range and Dec hike odds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `f99ba36` | 2026-11-25T16:54 | Merge pull request #97 from keatrng-cpu/fix/week-ahead-exports-1125 | — |
| `fc99902` | 2026-11-25T16:40 | Restore weekDayFor, weekAheadFocusLine, and overlayWeekAhead after Nov 25 restamp | M src/lib/trading/week-ahead.ts |
| `37bbc0d` | 2026-11-25T15:55 | Restamp Nov 25 day plan with printed actuals; Sunday under-PWL holds | M src/lib/trading/week-ahead.ts |
| `14e8287` | 2026-11-25T15:53 | Restamp Nov 25 day plan with printed actuals; Sunday under-PWL holds | M src/lib/trading/week-ahead.ts |
| `3d62208` | 2026-11-25T15:53 | Restamp Nov 25 prints: claims 189k, PCE core 3.3% y/y, GDP +4.3%, durables +0.2% | M src/data/week-prints.json |
| `c272b13` | 2026-11-25T15:51 | Restamp Nov 25 prints: claims 189k, PCE core 3.3% y/y, GDP +4.3%, durables +0.2% | M src/data/week-prints.json |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
