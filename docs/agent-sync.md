# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `cc3786d`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `af89e57`. 2 commit(s) landed after it.
Bookmark after this run: `claude` → `cc3786d`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `cc3786d` | 2026-11-10T13:14 | week-ahead: update Dec hike odds to ~84% pre-CPI, note BLS no YoY for Oct CPI | M src/lib/trading/week-ahead.ts |
| `7526e0e` | 2026-11-09T14:07 | agent-sync: bookmark claude at af89e57 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `af89e57` | 2026-11-09T14:07 | session-partner: 09:05 ET premarket touch — canary CLEAR, no change since 08:06 | M ai/DECISIONS.md, M ai/NOW.md |
| `6b858ce` | 2026-11-09T13:08 | agent-sync: bookmark claude at ab42436 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `ab42436` | 2026-11-09T13:07 | session-partner: 08:06 ET premarket — canary CLEAR, CPI week brief | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `1f5ddb1` | 2026-11-08T16:19 | Restore month-ahead.ts with post-NFP prose update | M src/lib/trading/month-ahead.ts |
| `b5cbe26` | 2026-11-08T16:18 | Sunday restamp: update Nov month prose for post-NFP hot print and Dec hike odds ~68% | M src/lib/trading/month-ahead.ts |
| `17668f9` | 2026-11-08T16:17 | Sunday restamp: add Nov 9-13 week plan; update Nov month prose for post-NFP odds ~68% | M src/lib/trading/week-ahead.ts |
| `1f46d41` | 2026-11-08T16:16 | Sunday restamp: add Nov 9-13 week plan; update Nov month prose for post-NFP odds ~68% | M src/lib/trading/week-ahead.ts |
| `f293702` | 2026-11-06T15:51 | Restamp Fri Nov 6 NFP plan: hot print, post-PWL holds | M src/lib/trading/week-ahead.ts |
| `3495e6f` | 2026-11-06T15:50 | Restamp Nov 6 NFP + UMich actuals | M src/data/week-prints.json |
| `0145acb` | 2026-11-06T15:08 | agent-sync: bookmark claude at 7f8d0e4 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `7f8d0e4` | 2026-11-06T15:07 | session-partner: 10:06 ET mid-session — canary CLEAR, 11th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `74d23ec` | 2026-11-06T14:15 | agent-sync: bookmark claude at 37ccd8a (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `37ccd8a` | 2026-11-06T14:15 | session-partner: 09:12 ET premarket (2nd touchpoint) — canary CLEAR, 10th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
