# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `7651b57`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `d4391ca`. 1 commit(s) landed after it.
Bookmark after this run: `claude` → `7651b57`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `7651b57` | 2026-11-02T13:54 | agent-sync: bookmark claude at d4391ca (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `d4391ca` | 2026-11-02T13:54 | session-partner: 08:51 ET premarket — canary CLEAR, closes the 9+ run week-ahead.ts truncation chain | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `37ff8a0` | 2026-11-01T22:24 | Sunday restamp Nov 1: add Nov 2–6 NFP week plan and November month plan. | M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `f19a6ef` | 2026-10-30T20:51 | Restamp Oct 30: ECI Q3 +0.8% in-line. Cash broke PWL; Sunday inside-week invalidated on downside. Days restored with actuals. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `1ad3e06` | 2026-10-30T15:26 | agent-sync: bookmark claude at 1499e9c (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `1499e9c` | 2026-10-30T15:26 | session-partner: 11:23 ET close-out — canary still failed, 3rd run today | M ai/DECISIONS.md, M ai/NOW.md |
| `81865d3` | 2026-10-30T14:18 | agent-sync: bookmark claude at f647970 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `f647970` | 2026-10-30T14:18 | session-partner: 10:15 ET mid-session — canary still failed, a commit landed after the 09:17 flag and did not fix it | M ai/DECISIONS.md, M ai/NOW.md |
| `5924648` | 2026-10-30T13:19 | agent-sync: bookmark claude at 5180c7f (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `5180c7f` | 2026-10-30T13:19 | session-partner: 09:17 ET premarket — canary FAILED, fabricated restore commits found | M ai/DECISIONS.md, M ai/NOW.md |
| `4410467` | 2026-10-30T12:16 | Update week-ahead to Oct 26-30: FOMC hold, GDP +3.4%, PCE hot, claims 194k; ECI pending. Prior-week levels adjusted. | M src/lib/trading/week-ahead.ts |
| `0ad8b10` | 2026-10-29T15:52 | Restore week-ahead.ts with Oct 29 restamp: GDP +3.4% claims 194k PCE hot; inside-week holds | M src/lib/trading/week-ahead.ts |
| `fa49d58` | 2026-10-29T15:51 | Restamp Oct 29: GDP +3.4%, claims 194k, PCE hot; Sunday inside-week holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `b412a65` | 2026-10-29T15:51 | Restamp Oct 29: GDP +3.4%, claims 194k, PCE hot; Sunday inside-week holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `2c1b977` | 2026-10-29T15:09 | agent-sync: bookmark claude at e5d948c (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
