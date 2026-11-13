# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `d749c01`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `a0ef16d`. 1 commit(s) landed after it.
Bookmark after this run: `claude` → `d749c01`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `d749c01` | 2026-11-13T15:08 | session-partner: 10:06 ET mid-session — canary clean, A+-only discipline reminder given | M ai/DECISIONS.md, M ai/NOW.md |
| `a0ef16d` | 2026-11-13T14:24 | agent-sync: bookmark claude at 5bab63c (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `5bab63c` | 2026-11-13T14:24 | session-partner: 09:22 ET premarket — canary clean, today's PPI/A+-only brief given | M ai/DECISIONS.md, M ai/NOW.md |
| `bcd48d9` | 2026-11-13T13:30 | agent-sync: bookmark claude at c4bcf22 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `c4bcf22` | 2026-11-13T13:30 | session-partner: 08:29 ET premarket — canary clean (transient d54ce4d placeholder already self-healed), today's PPI/A+-only brief given | M ai/DECISIONS.md, M ai/NOW.md |
| `f9a6797` | 2026-11-13T07:16 | week-ahead: restamp Dec hike odds post-CPI (~100%) and update this-week range prose (still under seed PWL) | M src/lib/trading/week-ahead.ts |
| `d54ce4d` | 2026-11-13T07:15 | week-ahead: restamp Dec hike odds post-CPI (~100%) and update this-week range prose (still under seed PWL) | M src/lib/trading/week-ahead.ts |
| `f774d52` | 2026-11-12T22:40 | Restore week files after the Nov 12 placeholder restamp (#92) | M ai/DECISIONS.md, M ai/NOW.md, M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `c6c6bc7` | 2026-11-12T15:51 | Restamp Nov 12 claims print: 200k vs ~195k. Sunday post-breakdown under-PWL plan holds. No HTF trend invented. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `046b087` | 2026-11-12T11:35 | Restore week-ahead, month exports, and week-prints after the Nov 10 stub. (#91) | M ai/DECISIONS.md, M ai/NOW.md, M src/data/week-prints.json, M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `6f2d613` | 2026-11-12T15:08 | agent-sync: bookmark claude at 4c145b3 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `4c145b3` | 2026-11-12T15:07 | session-partner: 10:06 ET mid-session — canary STILL FAILED (4th check), A+-only discipline reminder given | M ai/DECISIONS.md, M ai/NOW.md |
| `2a0f223` | 2026-11-12T14:08 | agent-sync: bookmark claude at 6b9c87e (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `6b9c87e` | 2026-11-12T14:07 | session-partner: 09:06 ET premarket — canary STILL FAILED (3rd check), gave CPI-week brief from month-ahead.ts | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `b6f6516` | 2026-11-12T13:07 | agent-sync: bookmark claude at 2dc7c64 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
