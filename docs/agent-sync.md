# Agent sync

Grok and Claude share one `main`. Read this before editing. Regenerate it with `node scripts/agent-sync.mjs --agent grok` or `--agent claude`.

HEAD `f621621`. Fetched origin. Local main matches origin.

## Since claude last looked

Bookmark was `b42734d`. 1 commit(s) landed after it.
Bookmark after this run: `claude` → `f621621`.

## Last 15 commits

| SHA | When (UTC) | What | Files |
|---|---|---|---|
| `f621621` | 2026-11-24T14:08 | Nov 24 premarket (09:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `b42734d` | 2026-11-24T13:14 | week-ahead: sync Dec hike odds ~96% 25bp and this-week range under seed PWL | M src/lib/trading/week-ahead.ts |
| `7df1487` | 2026-11-24T13:07 | agent-sync: bookmark claude at 1cb7bf5 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `1cb7bf5` | 2026-11-24T13:07 | Nov 24 premarket (08:06 ET) session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `a1d7be5` | 2026-11-23T21:54 | restamp 2026-11-23: Flash PMI 54.6; NQ/ES under seed PWL; Sunday plan holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `ce10baf` | 2026-11-23T15:53 | restamp 2026-11-23: no ISM/JOLTS/ADP/claims/NFP; Flash PMI 54.6; session under PWL | M src/data/week-prints.json |
| `be935b1` | 2026-11-23T15:52 | restamp 2026-11-23: no ISM/JOLTS/ADP/claims/NFP; Flash PMI 54.6; session under PWL | M src/data/week-prints.json |
| `f7c621b` | 2026-11-23T15:08 | agent-sync: bookmark claude at a3db8ea (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `a3db8ea` | 2026-11-23T15:07 | Nov 23 mid-session (10:06 ET) session-partner run: re-check canary, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `bcbee5c` | 2026-11-23T13:09 | agent-sync: bookmark claude at c6cd994 (post-push) | M docs/agent-sync.json, M docs/agent-sync.md |
| `c6cd994` | 2026-11-23T13:08 | Nov 23 premarket session-partner run: update memory, sync bookmark | M ai/DECISIONS.md, M ai/NOW.md, M docs/agent-sync.json, M docs/agent-sync.md |
| `78acde1` | 2026-11-22T22:17 | Restamp Nov 22: add Nov 23-27 Thanksgiving week plan; fix pce phase; calendar entries | M src/data/news-calendar.json, M src/lib/trading/month-ahead.ts, M src/lib/trading/week-ahead.ts |
| `63c9f1b` | 2026-11-20T21:51 | Restamp Nov 20: no ISM/JOLTS/ADP/claims/NFP; UMich 51.5 in-line; NQ/ES extended under seed PWL; Sunday plan holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |
| `88209af` | 2026-11-20T13:14 | Restamp Nov 20 odds and weekly range after Waller 50bp lift | M src/lib/trading/week-ahead.ts |
| `2f065cf` | 2026-11-19T21:55 | Restamp Nov 19 claims print and confirm Sunday under-PWL plan holds | M src/data/week-prints.json, M src/lib/trading/week-ahead.ts |

## New files in those commits

None.

## Before you edit

- If origin is ahead, `git pull --rebase origin main`, then run this script again.
- A file in the table is unseen until you have read its diff: `git show SHA -- path`.
- Do not redo a commit already on main. Do not revert the other agent's commit to land yours.
- Push to `main` when the change is done, then run this script once more so the bookmark matches what you pushed.
