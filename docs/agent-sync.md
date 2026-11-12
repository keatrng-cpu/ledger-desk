# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `6b9c87e`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `6b9c87e`. 15 commit(s) landed after it.
Bookmark after this run: `claude` → `6b9c87e`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `6b9c87e` | 2026-11-12T14:07 | session-partner: 09:06 ET premarket — canary STILL FAILED (3rd check), gave CPI-week brief from month-ahead.ts | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `b6f6516` | 2026-11-12T13:07 | agent-sync: bookmark claude at 2dc7c64 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `2dc7c64` | 2026-11-12T13:07 | session-partner: 08:06 ET pre-premarket — truncation STILL unresolved overnight, 2nd notice | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `3b2fdad` | 2026-11-11T15:08 | agent-sync: bookmark claude at 98df51d (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `98df51d` | 2026-11-11T15:07 | session-partner: 10:05 ET mid-session — CANARY FAILED, week-ahead.ts truncated to stub | M ai/DECISIONS.md, M ai/NOW.md |
| `45c9c3a` | 2026-11-10T15:52 | Restamp Nov 10 plan with hot CPI actuals; Sunday post-breakdown under-PWL story holds | M src/lib/trading/week-ahead.ts |
| `db6e12b` | 2026-11-10T15:51 | Restamp Nov 10 plan with hot CPI actuals; Sunday post-breakdown under-PWL story holds | M src/lib/trading/week-ahead.ts |
| `efaf1e7` | 2026-11-10T15:51 | Fix week-prints.json with actual CPI stamp (hot +0.4% m/m / core +0.3%) | M src/data/week-prints.json |
| `e4deea3` | 2026-11-10T15:51 | Restamp week-prints with Nov 10 CPI actuals (hot +0.4% / core +0.3%) | M src/data/week-prints.json |
| `7d62a28` | 2026-11-10T15:08 | agent-sync: bookmark claude at 9c0ddf2 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `9c0ddf2` | 2026-11-10T15:07 | session-partner: 10:06 ET mid-session — canary CLEAR, 12th consecutive clean run | M ai/DECISIONS.md, M ai/NOW.md |
| `fae1b12` | 2026-11-10T14:07 | agent-sync: bookmark claude at 1dc50d1 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `1dc50d1` | 2026-11-10T14:07 | agent-sync: bookmark claude at cc3786d (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `6c051dc` | 2026-11-10T14:07 | session-partner: 09:06 ET premarket — canary CLEAR, CPI day brief, read cc3786d | M ai/DECISIONS.md, M ai/NOW.md |
| `cc3786d` | 2026-11-10T13:14 | week-ahead: update Dec hike odds to ~84% pre-CPI, note BLS no YoY for Oct CPI | M src/lib/trading/week-ahead.ts |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
