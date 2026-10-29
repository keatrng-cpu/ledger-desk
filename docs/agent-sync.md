# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `94d3217`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `03be8e2`. 2 commit(s) landed after it.
Bookmark after this run: `claude` → `94d3217`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `94d3217` | 2026-10-29T14:38 | session-partner: 10:37 ET mid-session — canary still failed, re-flagged | M ai/DECISIONS.md, M ai/NOW.md |
| `5cc8252` | 2026-10-29T13:25 | agent-sync: bookmark claude at 03be8e2 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `03be8e2` | 2026-10-29T13:24 | session-partner: 09:21 ET premarket — CANARY FAILED, week-ahead.ts gutted by de68d47, flagged to trader, restore pending | M ai/DECISIONS.md, M ai/NOW.md |
| `4bdba1c` | 2026-10-29T07:11 | Add printed actuals: Durable Goods +1.8%, FOMC hold 3.75-4.00% with two hawkish dissents | M src/data/week-prints.json |
| `84d1456` | 2026-10-28T15:51 | Fix week-prints.json restamp for Oct 28 FOMC hold (no ISM/JOLTS/ADP/claims/NFP) | M src/data/week-prints.json |
| `de68d47` | 2026-10-28T15:51 | Restamp Oct 28: FOMC hold 3.75-4.00% 10-2. Inside-week holds; no PWH/PWL take. No ISM/JOLTS/ADP/claims/NFP. Dec hike odds ~85-87%. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `6f309ff` | 2026-10-28T15:18 | agent-sync: bookmark claude at 4eea006 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `4eea006` | 2026-10-28T15:18 | session-partner: 11:17 ET close-out — canary clean, trade-log flagged again | M ai/DECISIONS.md, M ai/NOW.md |
| `e51f77f` | 2026-10-28T14:10 | agent-sync: bookmark claude at d5d45f7 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `d5d45f7` | 2026-10-28T14:09 | session-partner: 10:08 ET mid-session — canary clean, A+-only restated | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `5e1669a` | 2026-10-28T12:10 | week-ahead: add Oct 26–30 FOMC week plan | M src/lib/trading/week-ahead.ts |
| `c80e11a` | 2026-10-27T15:17 | agent-sync: bookmark claude at 09524a9 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `09524a9` | 2026-10-27T15:16 | session-partner: 11:16 ET close-out — canary clean, trade-log flagged again | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `6c9a0b8` | 2026-10-27T14:48 | agent-sync: bookmark claude at 4a3123d (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `4a3123d` | 2026-10-27T14:48 | session-partner: 10:39 ET mid-session — canary fixed, 3-day main breakage restored | M ai/DECISIONS.md, M ai/NOW.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
