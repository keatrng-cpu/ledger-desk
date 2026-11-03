# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `1924855`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `40253b7`. 2 commit(s) landed after it.
Bookmark after this run: `claude` → `1924855`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `1924855` | 2026-11-03T15:08 | session-partner: 10:07 ET mid-session — canary still CLEAR, 5th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |
| `02be442` | 2026-11-03T14:08 | agent-sync: bookmark claude at 40253b7 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `40253b7` | 2026-11-03T14:08 | session-partner: 09:06 ET premarket — canary CLEAR, 4th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |
| `08f2827` | 2026-11-03T13:13 | agent-sync: bookmark claude at 10952fa (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `10952fa` | 2026-11-03T13:12 | session-partner: 08:10 ET premarket — canary CLEAR, 3rd consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `e0b8da4` | 2026-11-02T15:51 | Restamp Nov 2: ISM Mfg 55.5 printed. Sunday post-PWL plan holds; no bias change. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `d1e3ad8` | 2026-11-02T15:11 | agent-sync: bookmark claude at 790361c (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `790361c` | 2026-11-02T15:11 | session-partner: 10:10 ET mid-session — canary still CLEAR, 2nd clean run today | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `7651b57` | 2026-11-02T13:54 | agent-sync: bookmark claude at d4391ca (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `d4391ca` | 2026-11-02T13:54 | session-partner: 08:51 ET premarket — canary CLEAR, closes the 9+ run week-ahead.ts truncation chain | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `37ff8a0` | 2026-11-01T22:24 | Sunday restamp Nov 1: add Nov 2–6 NFP week plan and November month plan. | M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `f19a6ef` | 2026-10-30T20:51 | Restamp Oct 30: ECI Q3 +0.8% in-line. Cash broke PWL; Sunday inside-week invalidated on downside. Days restored with actuals. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `1ad3e06` | 2026-10-30T15:26 | agent-sync: bookmark claude at 1499e9c (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `1499e9c` | 2026-10-30T15:26 | session-partner: 11:23 ET close-out — canary still failed, 3rd run today | M ai/DECISIONS.md, M ai/NOW.md |
| `81865d3` | 2026-10-30T14:18 | agent-sync: bookmark claude at f647970 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
