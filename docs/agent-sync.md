# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `30fbe5a`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `a910f6d`. 1 commit(s) landed after it.
Bookmark after this run: `claude` → `30fbe5a`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `30fbe5a` | 2026-11-16T13:08 | agent-sync: bookmark claude at a910f6d (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `a910f6d` | 2026-11-16T13:08 | session-partner: 08:06 ET premarket — canary clean, today's Empire Manufacturing/A+-only brief given | M ai/DECISIONS.md, M ai/NOW.md |
| `1d7b286` | 2026-11-15T16:22 | Sunday restamp Nov 15: restamp Nov month Fed path post-CPI/PPI | M src/lib/trading/month-ahead.ts |
| `28b393a` | 2026-11-15T16:21 | Sunday restamp Nov 15: add Nov 16-20 week plan; restamp Nov month Fed path post-CPI | M src/lib/trading/week-ahead.ts |
| `e582212` | 2026-11-15T16:19 | Sunday restamp Nov 15: add Nov 16-20 week plan; restamp Nov month Fed path post-CPI | M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `739bed6` | 2026-11-13T21:51 | Stamp Fri 2026-11-13 PPI actuals; confirm Sunday under-PWL plan holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `8022f29` | 2026-11-13T15:08 | agent-sync: bookmark claude at d749c01 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `d749c01` | 2026-11-13T15:08 | session-partner: 10:06 ET mid-session — canary clean, A+-only discipline reminder given | M ai/DECISIONS.md, M ai/NOW.md |
| `a0ef16d` | 2026-11-13T14:24 | agent-sync: bookmark claude at 5bab63c (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `5bab63c` | 2026-11-13T14:24 | session-partner: 09:22 ET premarket — canary clean, today's PPI/A+-only brief given | M ai/DECISIONS.md, M ai/NOW.md |
| `bcd48d9` | 2026-11-13T13:30 | agent-sync: bookmark claude at c4bcf22 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `c4bcf22` | 2026-11-13T13:30 | session-partner: 08:29 ET premarket — canary clean (transient d54ce4d placeholder already self-healed), today's PPI/A+-only brief given | M ai/DECISIONS.md, M ai/NOW.md |
| `f9a6797` | 2026-11-13T07:16 | week-ahead: restamp Dec hike odds post-CPI (~100%) and update this-week range prose (still under seed PWL) | M src/lib/trading/week-ahead.ts |
| `d54ce4d` | 2026-11-13T07:15 | week-ahead: restamp Dec hike odds post-CPI (~100%) and update this-week range prose (still under seed PWL) | M src/lib/trading/week-ahead.ts |
| `f774d52` | 2026-11-12T22:40 | Restore week files after the Nov 12 placeholder restamp (#92) | M ai/DECISIONS.md, M ai/NOW.md, M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
