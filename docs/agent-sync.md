# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `d5d45f7`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `d5d45f7`. 15 commit(s) landed after it.
Bookmark after this run: `claude` → `d5d45f7`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `d5d45f7` | 2026-10-28T14:09 | session-partner: 10:08 ET mid-session — canary clean, A+-only restated | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `5e1669a` | 2026-10-28T12:10 | week-ahead: add Oct 26–30 FOMC week plan | M src/lib/trading/week-ahead.ts |
| `c80e11a` | 2026-10-27T15:17 | agent-sync: bookmark claude at 09524a9 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `09524a9` | 2026-10-27T15:16 | session-partner: 11:16 ET close-out — canary clean, trade-log flagged again | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `6c9a0b8` | 2026-10-27T14:48 | agent-sync: bookmark claude at 4a3123d (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `4a3123d` | 2026-10-27T14:48 | session-partner: 10:39 ET mid-session — canary fixed, 3-day main breakage restored | M ai/DECISIONS.md, M ai/NOW.md |
| `39b3af6` | 2026-10-27T14:47 | agent-sync: bookmark claude at b89ad16 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `b89ad16` | 2026-10-27T14:46 | fix: restore week-ahead.ts and month-ahead.ts after 3-day main breakage | M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `8678172` | 2026-10-27T13:12 | agent-sync: bookmark claude at fe7017b (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `fe7017b` | 2026-10-27T13:12 | session-partner: 09:09 ET premarket — canary still failed 3rd day, corrected month-ahead.ts restore SHA (bda6b63, not 1e5d8b4) | M ai/DECISIONS.md, M ai/NOW.md |
| `227abe7` | 2026-10-27T12:11 | Tuesday restamp 2026-10-27: no ISM/JOLTS/ADP/claims/NFP printed. Durable Goods due 08:30 (not stamp). Next hard FOMC Wed 14:00. Plan unchanged. PATH floor 0.65. | M src/data/week-prints.json |
| `36ce8c5` | 2026-10-26T20:51 | Monday restamp 2026-10-26: no ISM/JOLTS/ADP/claims/NFP printed; Chicago NA I 0.07, Dallas Mfg 13.4 (not stamp series). Plan unchanged. | M src/data/week-prints.json |
| `dd56c32` | 2026-10-26T15:19 | agent-sync: bookmark claude at 9f2dc50 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `9f2dc50` | 2026-10-26T15:19 | session-partner: 11:17 ET close-out — canary still failed, unfixed through entire live session | M ai/DECISIONS.md, M ai/NOW.md |
| `7701f94` | 2026-10-26T14:17 | agent-sync: bookmark claude at e68f89e (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
