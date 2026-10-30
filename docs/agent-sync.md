# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `5180c7f`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `e5d948c`. 6 commit(s) landed after it.
Bookmark after this run: `claude` → `5180c7f`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `5180c7f` | 2026-10-30T13:19 | session-partner: 09:17 ET premarket — canary FAILED, fabricated restore commits found | M ai/DECISIONS.md, M ai/NOW.md |
| `4410467` | 2026-10-30T12:16 | Update week-ahead to Oct 26-30: FOMC hold, GDP +3.4%, PCE hot, claims 194k; ECI pending. Prior-week levels adjusted. | M src/lib/trading/week-ahead.ts |
| `0ad8b10` | 2026-10-29T15:52 | Restore week-ahead.ts with Oct 29 restamp: GDP +3.4% claims 194k PCE hot; inside-week holds | M src/lib/trading/week-ahead.ts |
| `fa49d58` | 2026-10-29T15:51 | Restamp Oct 29: GDP +3.4%, claims 194k, PCE hot; Sunday inside-week holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `b412a65` | 2026-10-29T15:51 | Restamp Oct 29: GDP +3.4%, claims 194k, PCE hot; Sunday inside-week holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `2c1b977` | 2026-10-29T15:09 | agent-sync: bookmark claude at e5d948c (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `e5d948c` | 2026-10-29T15:09 | session-partner: 11:07 ET close-out — canary still failed (3rd run), escalated again | M ai/DECISIONS.md, M ai/NOW.md |
| `00dc6fb` | 2026-10-29T14:39 | agent-sync: bookmark claude at 94d3217 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `94d3217` | 2026-10-29T14:38 | session-partner: 10:37 ET mid-session — canary still failed, re-flagged | M ai/DECISIONS.md, M ai/NOW.md |
| `5cc8252` | 2026-10-29T13:25 | agent-sync: bookmark claude at 03be8e2 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `03be8e2` | 2026-10-29T13:24 | session-partner: 09:21 ET premarket — CANARY FAILED, week-ahead.ts gutted by de68d47, flagged to trader, restore pending | M ai/DECISIONS.md, M ai/NOW.md |
| `4bdba1c` | 2026-10-29T07:11 | Add printed actuals: Durable Goods +1.8%, FOMC hold 3.75-4.00% with two hawkish dissents | M src/data/week-prints.json |
| `84d1456` | 2026-10-28T15:51 | Fix week-prints.json restamp for Oct 28 FOMC hold (no ISM/JOLTS/ADP/claims/NFP) | M src/data/week-prints.json |
| `de68d47` | 2026-10-28T15:51 | Restamp Oct 28: FOMC hold 3.75-4.00% 10-2. Inside-week holds; no PWH/PWL take. No ISM/JOLTS/ADP/claims/NFP. Dec hike odds ~85-87%. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `6f309ff` | 2026-10-28T15:18 | agent-sync: bookmark claude at 4eea006 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
