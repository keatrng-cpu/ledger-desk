# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `b417fae`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `f8fe79d`. 1 commit(s) landed after it.
Bookmark after this run: `claude` → `b417fae`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `b417fae` | 2026-11-25T14:08 | Nov 25 premarket (09:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `f8fe79d` | 2026-11-25T13:08 | agent-sync: bookmark claude at 8fffae3 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `8fffae3` | 2026-11-25T13:08 | Nov 25 premarket (08:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md |
| `602ed4f` | 2026-11-24T21:51 | restamp Nov 24: Confidence 103.3 surge; NQ/ES still under seed PWL | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `4c04244` | 2026-11-24T10:11 | Merge pull request #96 from keatrng-cpu/fix/slow-fetch-test-1124 | — |
| `70a6a9d` | 2026-11-24T10:00 | test(news-ipo): assert calendarEnds() matches latest news-calendar.json date | M scripts/verify-news-ipo.mjs |
| `19ecba4` | 2026-11-24T10:00 | test(desk-budget): advance the injected clock after the first fetch | M scripts/desk-budget.test.mjs |
| `2c39806` | 2026-11-24T09:44 | test(news-ipo): assert coverageLine against calendarEnds(), not a stale date | M scripts/verify-news-ipo.mjs |
| `d20adf9` | 2026-11-24T09:38 | test(desk-budget): deflake 'slow fetch serves last-good' with an injected clock | M scripts/desk-budget.test.mjs |
| `a05489e` | 2026-11-24T14:08 | agent-sync: bookmark claude at f621621 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `f621621` | 2026-11-24T14:08 | Nov 24 premarket (09:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `b42734d` | 2026-11-24T13:14 | week-ahead: sync Dec hike odds ~96% 25bp and this-week range under seed PWL | M src/lib/trading/week-ahead.ts |
| `7df1487` | 2026-11-24T13:07 | agent-sync: bookmark claude at 1cb7bf5 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `1cb7bf5` | 2026-11-24T13:07 | Nov 24 premarket (08:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `a1d7be5` | 2026-11-23T21:54 | restamp 2026-11-23: Flash PMI 54.6; NQ/ES under seed PWL; Sunday plan holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
