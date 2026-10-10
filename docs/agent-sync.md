# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `e1d0fb0`. Fetched origin. Local main matches origin.

## Since grok last looked

Bookmark was `f1725f0`. 61 commit(s) landed after it.
Bookmark after this run: `grok` → `e1d0fb0`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `e1d0fb0` | 2026-10-10T17:25 | let the closed room study the long board and the prediction book | M .ai/locator.md, M docs/code-index.md, A scripts/verify-off-hours-study.mjs, M src/components/room/floor-screens.ts, M src/components/room/room-engine.ts, M src/data/floor-layout.json, M src/lib/room/agents.ts, M src/lib/room/live-talk.ts, M src/lib/room/live-types.ts, M src/lib/room/live-voices-invest.ts, M src/lib/room/live-voices.ts, M src/lib/room/live-world.ts, A src/lib/room/off-hours-study.ts, A src/lib/room/off-hours.ts |
| `2bec8d3` | 2026-10-10T10:44 | floor: get the hair off the eyes, size the head to the body, stop the owner skating | M src/components/room/floor-proto-avatars.ts, M src/components/room/floor-scene.ts |
| `2ad10c7` | 2026-10-09T23:36 | floor: bake the Manager's glass office, the swing TV, the ticker and the clocks | M public/floor/office.glb, M src/data/floor-layout.json |
| `6a8734a` | 2026-10-09T23:16 | read capex and share count off the durability row's yahoo legs | M src/lib/invest/long-board.ts |
| `101c437` | 2026-10-09T23:12 | Merge remote-tracking branch 'origin/main' | — |
| `d31b38f` | 2026-10-09T23:12 | Blender is connected: 5.2.2 plus the Blender Lab MCP add-on | M .claude/skills/desk-data/SKILL.md, M CLAUDE.md |
| `1ebede6` | 2026-10-10T04:05 | make the Invest tab one path: dollars, then names, then the record | M src/components/desk/invest-panel.tsx, M src/components/invest/funnel-card.tsx, M src/components/invest/ipo-card.tsx, M src/components/invest/long-board.tsx, M src/components/invest/research-card.tsx, M src/components/invest/screen-table.tsx |
| `6edd7bd` | 2026-10-10T03:43 | rebalance the sweep so VTI's tech weight is not bought twice | M src/components/room/floor-screens.ts, M src/lib/invest/funnel.ts |
| `81a7dac` | 2026-10-09T20:52 | Restamp Fri Oct 9: UMich 46.3, no new week extreme. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `c1de6ce` | 2026-10-09T20:48 | keep seated gestures in the chair and show the sweep split on the funnel | M src/components/room/floor-scene.ts, M src/components/room/floor-screens.ts |
| `6070c4c` | 2026-10-09T20:40 | split the surviving sweep across the long sleeves | M .ai/locator.md, A scripts/verify-funnel.mjs, M src/components/desk/invest-panel.tsx, A src/components/invest/funnel-card.tsx, A src/lib/invest/funnel.ts |
| `e96f5ac` | 2026-10-09T20:33 | make the Invest tab readable: filter the board, fold the fine print | M src/components/desk/invest-panel.tsx, M src/components/invest/long-board.tsx, M src/components/invest/research-card.tsx, M src/components/invest/screen-table.tsx |
| `a783d08` | 2026-10-09T20:32 | add a long board to the Invest tab that ranks and does not buy | M .ai/locator.md, A scripts/verify-long-board.mjs, M src/components/desk/invest-panel.tsx, A src/components/invest/long-board.tsx, M src/components/room/invest-office-panel.tsx, A src/lib/invest/long-board.ts, M src/lib/invest/marks.ts |
| `736985a` | 2026-10-09T12:38 | Merge remote-tracking branch 'origin/main' | — |
| `5c46f3f` | 2026-10-09T12:38 | route the desk to its own connectors without being asked | A .claude/skills/desk-data/SKILL.md, M CLAUDE.md |

## New files in those commits

- `scripts/verify-off-hours-study.mjs` in `e1d0fb0`
- `src/lib/room/off-hours-study.ts` in `e1d0fb0`
- `src/lib/room/off-hours.ts` in `e1d0fb0`
- `scripts/verify-funnel.mjs` in `6070c4c`
- `src/components/invest/funnel-card.tsx` in `6070c4c`
- `src/lib/invest/funnel.ts` in `6070c4c`
- `scripts/verify-long-board.mjs` in `a783d08`
- `src/components/invest/long-board.tsx` in `a783d08`
- `src/lib/invest/long-board.ts` in `a783d08`
- `.claude/skills/desk-data/SKILL.md` in `5c46f3f`

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
- claude last bookmarked `4283811`.
