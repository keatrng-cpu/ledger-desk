# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `80b14ef`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `dded774`. 2 commit(s) landed after it.
Bookmark after this run: `claude` → `80b14ef`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `80b14ef` | 2026-11-05T15:08 | session-partner: 10:07 ET mid-session — canary CLEAR, 8th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |
| `1aff340` | 2026-11-05T14:13 | agent-sync: bookmark claude at dded774 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `dded774` | 2026-11-05T14:13 | session-partner: 09:11 ET premarket — canary CLEAR, 7th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |
| `4dc88b9` | 2026-11-04T15:51 | Restamp Nov 4: ADP 86K beat, ISM Svc 54.5 slight miss; post-PWL context holds | M src/lib/trading/week-ahead.ts |
| `f000c4d` | 2026-11-04T15:50 | Restamp Nov 4 actuals: ADP 86K, ISM Svc 54.5 | M src/data/week-prints.json |
| `753e1f1` | 2026-11-04T13:10 | agent-sync: bookmark claude at 3aaa03e (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `3aaa03e` | 2026-11-04T13:09 | session-partner: 08:07 ET premarket — canary CLEAR, 6th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `ff770e5` | 2026-11-04T06:40 | Restore weekDayFor so the three TS2305 imports typecheck (#90) | M ai/DECISIONS.md, M ai/NOW.md, M src/lib/trading/week-ahead.ts |
| `d99760d` | 2026-11-03T15:51 | Restamp Tue 11-03 plan with JOLTS 7.523M; post-PWL break holds | M src/lib/trading/week-ahead.ts |
| `9092310` | 2026-11-03T15:50 | Restamp week-prints with 2026-11-03 JOLTS actual 7.523M | M src/data/week-prints.json |
| `62ff0f7` | 2026-11-03T15:08 | agent-sync: bookmark claude at 1924855 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `1924855` | 2026-11-03T15:08 | session-partner: 10:07 ET mid-session — canary still CLEAR, 5th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |
| `02be442` | 2026-11-03T14:08 | agent-sync: bookmark claude at 40253b7 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `40253b7` | 2026-11-03T14:08 | session-partner: 09:06 ET premarket — canary CLEAR, 4th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |
| `08f2827` | 2026-11-03T13:13 | agent-sync: bookmark claude at 10952fa (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
