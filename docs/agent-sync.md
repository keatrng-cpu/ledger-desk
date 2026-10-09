# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `b0bb7850`. Fetched origin. Local main matches origin.

## Since claude last looked

No prior bookmark. This run is the baseline, and the last 15 commits are listed below.
Bookmark after this run: `claude` → `b0bb7850`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `b0bb7850` | 2026-10-09T14:57 | keep seated people in their chairs and stop the cat face-planting | M src/components/room/floor-scene.ts |
| `0c3abe62` | 2026-10-09T14:41 | let a finished model lead, and make the mechanical model Blake's close | M .ai/locator.md, M src/lib/trading/detectors.ts, M src/lib/trading/scanner.ts, M src/lib/trading/strategy-grade.ts |
| `bcd0e928` | 2026-10-09T14:35 | let a named raid take without the half or the higher timeframe standing it down | M .ai/locator.md, M scripts/verify-smc-master.mjs, M src/lib/trading/smc-master.ts |
| `3e61f9ef` | 2026-10-09T14:21 | do not hand a ticket the brain, the entry, and the ask do not share | M .ai/locator.md, M src/lib/trading/desk-listen.ts, M src/lib/trading/options-desk.ts |
| `fd86b3d1` | 2026-10-09T13:37 | let a graded card be placed inside the Judas window | M src/lib/trading/options-desk.ts, M src/lib/trading/smc-master.ts |
| `851ed93e` | 2026-10-09T12:13 | desk: restamp Oct 5–9 notes for Thu NQ week low; UMich not printed | M src/lib/trading/week-ahead.ts |
| `326cf9fd` | 2026-10-08T15:57 | Merge remote-tracking branch 'origin/main' into HEAD | — |
| `961f223a` | 2026-10-08T20:52 | Restamp Thu Oct 8: claims 197k, NQ failed PWH hold. | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `f357e18e` | 2026-10-08T15:20 | Merge branch 'worktree-agent-a6ff34f4323d885b6' into HEAD | — |
| `f30d0ddb` | 2026-10-08T14:18 | one plan object, and the draw is the target | M scripts/verify-card-plan.mjs, A scripts/verify-smc-master.mjs, M src/lib/trading/card-plan.ts, M src/lib/trading/score-drivers.ts, M src/lib/trading/smc-master.ts |
| `157126f4` | 2026-10-08T14:17 | detect on closed bars, and grade the raid against the finer tape | M scripts/verify-desk-enhancements.mjs, M src/lib/trading/build-desk.ts, M src/lib/trading/raid-pair.ts, M src/lib/trading/scanner.ts |
| `783bee4d` | 2026-10-08T14:16 | name each model by its own object and its own hour | M src/lib/trading/engine-weights.ts, M src/lib/trading/smc-canon.ts, M src/lib/trading/smt-level.ts, M src/lib/trading/strategies.ts, M src/lib/trading/strategy-grade.ts |
| `e75ce71e` | 2026-10-08T13:07 | gate: block on what you broke, not on what was already broken | M AGENTS.md, A docs/pending-workflows/desk-gate.yml, M scripts/hooks/pre-push, M scripts/verify-all.mjs, A scripts/verify-baseline.json |
| `f4cd8a2a` | 2026-10-08T12:30 | dispatch: close the fixture through the wick, now that -30% alone does not | M scripts/verify-rh-dispatch.mjs |
| `9c1b7242` | 2026-10-08T12:30 | give the close its own job instead of a seat on somebody else's | M docs/RH_LIVE_ROUTINE.md, A scripts/verify-rh-desk-job.mjs, M src/routeTree.gen.ts, A src/routes/api/cron/rh-manage.ts |

## New files in those commits

- `scripts/verify-smc-master.mjs` in `f30d0ddb`
- `docs/pending-workflows/desk-gate.yml` in `e75ce71e`
- `scripts/verify-baseline.json` in `e75ce71e`
- `scripts/verify-rh-desk-job.mjs` in `9c1b7242`
- `src/routes/api/cron/rh-manage.ts` in `9c1b7242`

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
- grok last bookmarked `f1725f0`.
