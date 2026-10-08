# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `f1725f0`. Fetched origin. Local main is not origin. Push or rebase before you treat this as shared.

## Since grok last looked

Bookmark was `f1725f0`. 12 commit(s) landed after it.
Bookmark after this run: `grok` → `f1725f0`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `f1725f0` | 2026-10-08T15:34 | show both agents the commits the other just shipped | A .claude/skills/agent-sync/SKILL.md, M AGENTS.md, M CLAUDE.md, M ROADMAP.md, A scripts/agent-sync.mjs |
| `e291185` | 2026-10-08T10:23 | sequence: drop two comparisons that could never be false, so main typechecks again | M src/lib/trading/smc-canon.ts |
| `6d58141` | 2026-10-08T15:22 | price the entry at the gap close, not a nearby fit | M src/lib/trading/desk-listen.ts, M src/lib/trading/detectors.ts, M src/lib/trading/ltf-reaction.ts, M src/lib/trading/scanner.ts, M src/lib/trading/strategies.ts, M src/lib/trading/trade-plan.ts |
| `495ece2` | 2026-10-08T10:19 | brain: a line's time means when it last changed, so the book hands back the line that moved | M scripts/verify-brain-nerve.mjs, M src/lib/room/desk-atlas.ts |
| `fd57236` | 2026-10-08T15:00 | make the take match the model, not a nearby component | M src/lib/trading/build-desk.ts, M src/lib/trading/engine-weights.ts, M src/lib/trading/market-narrative.ts, M src/lib/trading/scanner.ts, M src/lib/trading/score-drivers.ts, M src/lib/trading/smc-canon.ts, M src/lib/trading/smc-master.ts, M src/lib/trading/strategies.ts, M src/lib/trading/strategy-grade.ts |
| `dc446cb` | 2026-10-08T14:36 | put the tape, the strategy, the chart, the floor, and Grok on one card | M src/lib/desk/grok-report.ts, M src/lib/desk/mcp-server.ts, M src/lib/room/desk-atlas.ts, M src/lib/trading/desk-listen.ts |
| `7b65993` | 2026-10-08T14:34 | release the higher frame once structure or the extension has left it | M src/lib/room/meeting.ts, M src/lib/trading/htf-invalidation.ts |
| `f0e5839` | 2026-10-08T14:32 | drop a fade that has no reversal inside the extension | M src/lib/trading/profit-path.ts, M src/lib/trading/raid-pair.ts, M src/lib/trading/scanner.ts, M src/lib/trading/smc-master.ts, M src/lib/trading/strategy-grade.ts |
| `e27942f` | 2026-10-08T14:27 | grade the raid that armed the trade, not the latest tag | M src/lib/execution/rh-cycle.ts, M src/lib/room/meeting.ts, M src/lib/room/orchestrator.ts, M src/lib/trading/build-desk.ts, M src/lib/trading/gate-tuning.ts, M src/lib/trading/market-narrative.ts, M src/lib/trading/options-desk.ts, A src/lib/trading/raid-pair.ts, M src/lib/trading/scanner.ts, M src/lib/trading/sessions.ts, M src/lib/trading/smc-canon.ts, M src/lib/trading/smc-master.ts, M src/lib/trading/strategies.ts |
| `a48a178` | 2026-10-08T14:16 | restore the session clock import the desk build dropped | M src/lib/trading/build-desk.ts |
| `909eda4` | 2026-10-08T14:14 | release a spent short and read the lower-timeframe reaction | M src/lib/room/meeting.ts, M src/lib/room/orchestrator.ts, M src/lib/trading/build-desk.ts, M src/lib/trading/chart-timeframes.ts, M src/lib/trading/htf-invalidation.ts, A src/lib/trading/ltf-reaction.ts, M src/lib/trading/options-desk.ts, M src/lib/trading/scanner.ts, M src/lib/trading/smc-master.ts |
| `270f36b` | 2026-10-08T13:43 | lower the options debit floor to $50 | — |

## New files in those commits

- `.claude/skills/agent-sync/SKILL.md` in `f1725f0`
- `scripts/agent-sync.mjs` in `f1725f0`
- `src/lib/trading/raid-pair.ts` in `e27942f`
- `src/lib/trading/ltf-reaction.ts` in `909eda4`

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
