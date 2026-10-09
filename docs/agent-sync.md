# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `42838117`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `b0bb785`. 14 commit(s) landed after it.
Bookmark after this run: `claude` → `42838117`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `42838117` | 2026-10-09T11:41 | Merge remote-tracking branch 'origin/main' | — |
| `09931a8b` | 2026-10-09T11:34 | Merge origin/main: declare screens.invest, which 18 typecheck errors needed | M src/components/room/floor-screens.ts |
| `41a4beb8` | 2026-10-09T16:32 | keep the chart marks from painting over each other | M src/components/desk/setup-chart-panel.tsx, M src/components/desk/setup-chart.tsx |
| `ffea297e` | 2026-10-09T11:31 | Merge remote-tracking branch 'origin/main' | — |
| `8f07af44` | 2026-10-09T16:25 | show the live Robinhood ask on the floor, the brain, and the desk | A src/components/desk/option-marks.tsx, M src/components/desk/options-swing-panel.tsx, M src/components/desk/veteran-brain.tsx, M src/components/room/floor-screens.ts, M src/lib/desk/mcp-server.ts, A src/lib/execution/option-marks.ts, M src/lib/room/live-types.ts, M src/lib/room/live-world.ts, M src/lib/trading/build-desk.ts, M src/lib/trading/desk-listen.ts |
| `b86abb5b` | 2026-10-09T11:18 | Merge origin/main: Grok's swing spans, and tsc back to 0 | — |
| `f07b6b4e` | 2026-10-09T16:12 | stop screen text from drawing on top of itself | M src/components/room/floor-screens.ts |
| `df2a8caa` | 2026-10-09T16:09 | put the live swing grades on the wall beside the charts | M src/components/room/floor-scene.ts, M src/components/room/floor-screens.ts, M src/components/room/room-engine.ts, M src/data/floor-layout.json |
| `f93ba028` | 2026-10-09T11:07 | the bar opens on the ticket, and the Learn tab is nine live lessons | M .ai/locator.md, M CLAUDE.md, M docs/agent-sync.json, M docs/agent-sync.md, M scripts/verify-baseline.json, A scripts/verify-live-lesson.mjs, A src/components/desk/brain-word.tsx, A src/components/desk/four-facts-board.tsx, A src/components/desk/option-ticket.tsx, M src/components/desk/options-swing-panel.tsx, M src/components/learn/learn-tab.tsx, A src/components/learn/live-lessons.tsx, M src/components/room/floor-scene.ts, M src/lib/aplus/confluence.ts, A src/lib/learn/live-lesson.ts, M src/lib/room/brain-feed.ts, M src/lib/room/live-talk.ts, M src/lib/room/live-types.ts, M src/lib/room/live-voices.ts, M src/lib/room/live-world.ts, M src/lib/trading/market-narrative.ts, M src/lib/trading/options-desk.ts, M src/lib/trading/school-brief.ts, M src/lib/trading/score-drivers.ts, M src/lib/trading/strategies.ts, A src/lib/trading/ticket-facts.ts, M src/routes/index.tsx |
| `c12116fe` | 2026-10-09T16:01 | arm a swing only after the raid, a later shift, and agreement | M src/lib/trading/options-swing.ts |
| `57d09f27` | 2026-10-09T15:59 | grade each swing hold as its own card | M .ai/locator.md, M src/components/desk/options-swing-panel.tsx, M src/lib/trading/options-desk.ts, M src/lib/trading/options-swing.ts |
| `1713b317` | 2026-10-09T15:38 | take a contract when the pool pays the 40 percent trim | M src/lib/trading/options-desk.ts, M src/lib/trading/options-knowledge.ts |
| `14d91403` | 2026-10-09T15:36 | grade the chain on debit cleared, spread, and the afternoon clock | M .ai/locator.md, M src/components/desk/options-swing-panel.tsx, M src/lib/trading/options-desk.ts, A src/lib/trading/options-knowledge.ts |
| `5293507e` | 2026-10-09T15:19 | rank the live chain by expected return, not by the middle of a delta band | M .ai/locator.md, M src/lib/trading/options-desk.ts |
| `b0bb7850` | 2026-10-09T14:57 | keep seated people in their chairs and stop the cat face-planting | M src/components/room/floor-scene.ts |

## New files in those commits

- `src/components/desk/option-marks.tsx` in `8f07af44`
- `src/lib/execution/option-marks.ts` in `8f07af44`
- `scripts/verify-live-lesson.mjs` in `f93ba028`
- `src/components/desk/brain-word.tsx` in `f93ba028`
- `src/components/desk/four-facts-board.tsx` in `f93ba028`
- `src/components/desk/option-ticket.tsx` in `f93ba028`
- `src/components/learn/live-lessons.tsx` in `f93ba028`
- `src/lib/learn/live-lesson.ts` in `f93ba028`
- `src/lib/trading/ticket-facts.ts` in `f93ba028`
- `src/lib/trading/options-knowledge.ts` in `14d91403`

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
- grok last bookmarked `f1725f0`.
